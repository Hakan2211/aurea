/* JobEngine — the single GPU owner (PRD Part 2). Holds the queue, enforces
 * one exclusive job at a time, and streams snapshots to subscribers.
 *
 * Execution: jobs with a payload run on a matching engine adapter (videofast
 * batch pipeline today; ComfyUI sidecar, TTS venvs next). Jobs without one —
 * UI demo enqueues — fall back to the simulated worker so the queue plumbing
 * stays demonstrable without a GPU pipeline installed.
 *
 * The queue is persisted to <dataRoot>/jobs.json: history survives restarts,
 * and jobs that were queued or mid-run when studiod died come back queued —
 * a restart resumes the queue rather than losing it (cancel is how you stop
 * a job on purpose). */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { jobSchema, type EnqueueJobResolved, type Job, type JobPriority } from "@aurea/shared";
import type { AdapterRun, EngineAdapter } from "./adapters/types.js";
import type { GpuLock } from "./gpulock.js";

const PRIORITY_RANK: Record<JobPriority, number> = { interactive: 0, preview: 1, batch: 2 };

/** progress points per tick, by how heavy the job kind typically is */
const TICK_RATE: Record<Job["kind"], number> = { video: 1.6, image: 6, tts: 9, music: 4 };

const STAGES: Record<Job["kind"], string[]> = {
  video: ["Sampling", "Upscaling", "Encoding"],
  image: ["Sampling", "Decoding"],
  tts: ["Synthesizing"],
  music: ["Composing", "Mixing"],
};

export const TICK_MS = 800;

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

interface TrackedJob extends Job {
  startedAt?: number;
  /** insertion counter for stable FIFO within a priority band */
  seq: number;
}

/** how many finished jobs the persisted history keeps */
const HISTORY_CAP = 100;
const SAVE_DEBOUNCE_MS = 300;

export interface JobEngineOptions {
  adapters?: EngineAdapter[];
  /** persistence file, resolved per save so a dataRoot change carries the history along */
  storeFile?: () => string;
  /** move a finished adapter job's artifact into its project; returns the new path */
  importOutput?: (job: Job) => string | undefined;
  /** shared .gpu.lock interop with the legacy videofast CLI (see gpulock.ts) */
  gpuLock?: GpuLock;
}

export class JobEngine extends EventEmitter {
  private jobs = new Map<string, TrackedJob>();
  private seq = 0;
  private timer: NodeJS.Timeout;
  /** live adapter execution per running job id */
  private execs = new Map<string, AdapterRun>();
  private adapters: EngineAdapter[];
  private saveTimer: NodeJS.Timeout | undefined;

  constructor(private opts: JobEngineOptions = {}) {
    super();
    this.adapters = opts.adapters ?? [];
    for (const job of this.load()) {
      // whatever was in flight when the last studiod died goes back in line
      const revived: TrackedJob =
        job.status === "running" || job.status === "queued"
          ? { ...job, status: "queued", progress: 0, stage: undefined, eta: undefined, elapsed: undefined, seq: this.seq++ }
          : { ...job, seq: this.seq++ };
      this.jobs.set(revived.id, revived);
    }
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref();
  }

  /** running first, queued by priority then FIFO, finished last */
  snapshot(): Job[] {
    const rank = (j: TrackedJob) =>
      j.status === "running" ? 0 : j.status === "queued" ? 1 : 2;
    return [...this.jobs.values()]
      .sort(
        (a, b) =>
          rank(a) - rank(b) ||
          PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
          a.seq - b.seq,
      )
      .map(({ startedAt: _s, seq: _q, ...job }) => job);
  }

  enqueue(input: EnqueueJobResolved): Job {
    const job: TrackedJob = {
      id: `j-${randomUUID().slice(0, 8)}`,
      status: "queued",
      progress: 0,
      seq: this.seq++,
      ...input,
    };
    this.jobs.set(job.id, job);
    this.publish();
    return this.find(job.id)!;
  }

  cancel(id: string): Job | undefined {
    const job = this.jobs.get(id);
    if (!job || (job.status !== "queued" && job.status !== "running")) return this.find(id);
    this.execs.get(id)?.cancel();
    job.status = "failed";
    job.error = "Canceled by user";
    job.stage = undefined;
    job.eta = undefined;
    this.publish();
    return this.find(id);
  }

  retry(id: string): Job | undefined {
    const job = this.jobs.get(id);
    if (!job || job.status !== "failed") return this.find(id);
    job.status = "queued";
    job.progress = 0;
    job.error = undefined;
    job.elapsed = undefined;
    job.output = undefined;
    job.seq = this.seq++;
    this.publish();
    return this.find(id);
  }

  close() {
    clearInterval(this.timer);
    for (const exec of this.execs.values()) exec.cancel();
    this.execs.clear();
    this.opts.gpuLock?.release();
    clearTimeout(this.saveTimer);
    this.save();
    this.removeAllListeners();
  }

  private find(id: string): Job | undefined {
    return this.snapshot().find((j) => j.id === id);
  }

  private publish() {
    this.emit("snapshot", this.snapshot());
    if (!this.opts.storeFile) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), SAVE_DEBOUNCE_MS);
    this.saveTimer.unref();
  }

  /* ---------- persistence ---------- */

  private load(): Job[] {
    if (!this.opts.storeFile) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(this.opts.storeFile(), "utf8"));
      return z.array(jobSchema).parse(raw);
    } catch {
      return [];
    }
  }

  private save(): void {
    if (!this.opts.storeFile) return;
    const finished = this.snapshot().filter(
      (j) => j.status === "completed" || j.status === "failed",
    );
    const keep = new Set(finished.slice(0, HISTORY_CAP).map((j) => j.id));
    const jobs = this.snapshot().filter(
      (j) => j.status === "running" || j.status === "queued" || keep.has(j.id),
    );
    try {
      const file = this.opts.storeFile();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(jobs, null, 2));
      fs.renameSync(tmp, file);
    } catch {
      // history is best-effort; the live queue keeps working without it
    }
  }

  private tick() {
    const running = [...this.jobs.values()].find((j) => j.status === "running");
    if (running) {
      if (this.execs.has(running.id)) {
        // adapter pushes progress; the tick only keeps the wall clock moving
        if (running.startedAt) running.elapsed = fmtDuration(Date.now() - running.startedAt);
      } else {
        this.advance(running);
      }
      this.publish();
      return;
    }
    const next = [...this.jobs.values()]
      .filter((j) => j.status === "queued")
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.seq - b.seq)[0];
    if (next) {
      const adapter = this.adapters.find((a) => a.canRun(next));
      if (adapter && this.opts.gpuLock) {
        const held = this.opts.gpuLock.heldByOther();
        if (held) {
          // an external videofast batch owns the GPU — hold the queue, don't fail
          const stage = `Waiting for GPU — external batch ${held.batchId} (pid ${held.pid})`;
          if (next.stage !== stage) {
            next.stage = stage;
            this.publish();
          }
          return;
        }
      }
      next.status = "running";
      next.startedAt = Date.now();
      next.progress = 0;
      next.stage = undefined;
      if (adapter) {
        // videofast jobs skip this: the spawned run-batch.ts takes the lock itself
        if (next.payload?.type !== "videofast") this.opts.gpuLock?.acquire(`aurea:${next.id}`);
        this.startAdapter(next, adapter);
      }
      this.publish();
    }
  }

  /* ---------- adapter execution ---------- */

  private startAdapter(job: TrackedJob, adapter: EngineAdapter) {
    const run = adapter.start(job, (p) => {
      if (job.status !== "running") return;
      if (p.progress !== undefined) job.progress = Math.min(100, Math.max(0, Math.round(p.progress)));
      if (p.stage !== undefined) job.stage = p.stage;
      if (p.detail !== undefined) job.detail = p.detail;
      this.publish();
    });
    this.execs.set(job.id, run);
    run.done
      .then(({ output }) => {
        if (job.status !== "running") return; // canceled while finishing
        job.status = "completed";
        job.progress = 100;
        job.stage = undefined;
        job.eta = undefined;
        job.output = output;
        if (output && this.opts.importOutput) {
          try {
            // pull the artifact into the project's assets tree (library picks it up)
            job.output = this.opts.importOutput({ ...job }) ?? output;
          } catch {
            // delivery stays valid at the adapter's original path
          }
        }
      })
      .catch((err: unknown) => {
        if (job.status !== "running") return; // cancel() already recorded the reason
        job.status = "failed";
        job.error = err instanceof Error ? err.message : String(err);
        job.stage = undefined;
        job.eta = undefined;
      })
      .finally(() => {
        this.execs.delete(job.id);
        this.opts.gpuLock?.release(); // no-op unless this process holds it
        this.publish();
      });
  }

  /* ---------- simulated worker (fallback for jobs without a payload) ---------- */

  private advance(job: TrackedJob) {
    const rate = TICK_RATE[job.kind];
    job.progress = Math.min(100, Math.round(job.progress + rate * (0.7 + Math.random() * 0.6)));
    const stages = STAGES[job.kind];
    job.stage = stages[Math.min(stages.length - 1, Math.floor((job.progress / 100) * stages.length))];
    if (job.startedAt) job.elapsed = fmtDuration(Date.now() - job.startedAt);
    const remainingTicks = (100 - job.progress) / rate;
    job.eta = fmtDuration(remainingTicks * TICK_MS);
    if (job.progress >= 100) {
      job.status = "completed";
      job.progress = 100;
      job.stage = undefined;
      job.eta = undefined;
    }
  }
}
