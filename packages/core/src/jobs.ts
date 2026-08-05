/* JobEngine — the single GPU owner (PRD Part 2). Holds the queue, streams
 * snapshots to subscribers, and starts queued jobs when the GpuScheduler
 * admits them: one exclusive "gpu"-class job at a time, "cpu"-class jobs
 * concurrently beside it, FIFO within each lane (an open lane may pass a
 * blocked one, a later job never passes an earlier one in its own lane).
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
import { jobSchema, type AssetMeta, type EnqueueJobResolved, type Job, type JobPriority } from "@aurea/shared";
import type { AdapterRun, EngineAdapter } from "./adapters/types.js";
import { GpuScheduler, type JobResources, type ResourceClass } from "./scheduler.js";

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

/** the wait reason a queued job shows while the queue is held */
const PAUSED_STAGE = "Queue paused";

/** how many finished jobs the persisted history keeps */
const HISTORY_CAP = 100;
const SAVE_DEBOUNCE_MS = 300;

export interface JobEngineOptions {
  adapters?: EngineAdapter[];
  /** persistence file, resolved per save so a dataRoot change carries the history along */
  storeFile?: () => string;
  /** move a finished adapter job's artifact into its project; returns the new
   * path. `meta` is the adapter's own provenance, merged over what the job
   * payload already explains. */
  importOutput?: (job: Job, meta?: AssetMeta) => string | undefined;
  /** admission control (lanes, VRAM preflight, legacy-lock interop);
   * defaults to a bare scheduler — gpu lane exclusive, no preflight */
  scheduler?: GpuScheduler;
}

export class JobEngine extends EventEmitter {
  private jobs = new Map<string, TrackedJob>();
  private seq = 0;
  private timer: NodeJS.Timeout;
  /** live adapter execution per running job id */
  private execs = new Map<string, AdapterRun>();
  private adapters: EngineAdapter[];
  private saveTimer: NodeJS.Timeout | undefined;
  private scheduler: GpuScheduler;
  /** admission is held; running jobs finish */
  private paused = false;

  constructor(private opts: JobEngineOptions = {}) {
    super();
    this.adapters = opts.adapters ?? [];
    this.scheduler = opts.scheduler ?? new GpuScheduler();
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

  /** Drop a finished job out of the history — the queue's delete key. A live
   * job has to be canceled first: deleting one would strand its adapter run
   * with nothing left to record the result on. */
  dismiss(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.status === "queued" || job.status === "running") return false;
    this.jobs.delete(id);
    this.publish();
    return true;
  }

  /** clear the whole history in one go; live jobs stay */
  clearFinished(): number {
    let removed = 0;
    for (const [id, job] of this.jobs) {
      if (job.status === "completed" || job.status === "failed") {
        this.jobs.delete(id);
        removed++;
      }
    }
    if (removed) this.publish();
    return removed;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Hold the line: queued jobs stop being admitted, whatever is already
   * running is left alone (a half-rendered take is worth more than an idle
   * GPU). Deliberately not persisted — a restart always comes back running. */
  setPaused(paused: boolean): boolean {
    if (this.paused === paused) return this.paused;
    this.paused = paused;
    if (!paused) {
      // the badge is ours, so it's ours to take off — a real wait reason gets
      // rewritten by the next admission pass anyway
      for (const job of this.jobs.values()) {
        if (job.status === "queued" && job.stage === PAUSED_STAGE) job.stage = undefined;
      }
    }
    this.publish();
    return this.paused;
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
    this.scheduler.close();
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
    // snapshot lists finished oldest-first — keep the newest slice, or a full
    // history silently evicts every job that finishes after the cap is hit
    const keep = new Set(finished.slice(-HISTORY_CAP).map((j) => j.id));
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

  /** what this job will occupy — its adapter's declaration, or the exclusive
   * gpu lane for adapterless (simulated) jobs */
  private resourcesFor(job: TrackedJob): { adapter?: EngineAdapter; res: JobResources } {
    const adapter = this.adapters.find((a) => a.canRun(job));
    return { adapter, res: adapter?.resources?.(job) ?? { klass: "gpu" } };
  }

  private tick() {
    let changed = false;
    const running = [...this.jobs.values()].filter((j) => j.status === "running");
    for (const job of running) {
      if (this.execs.has(job.id)) {
        // adapter pushes progress; the tick only keeps the wall clock moving
        if (job.startedAt) job.elapsed = fmtDuration(Date.now() - job.startedAt);
      } else {
        this.advance(job);
      }
      changed = true;
    }
    // admission: FIFO within each lane; a blocked lane never reorders, but an
    // open lane may start jobs past it
    const queued = [...this.jobs.values()]
      .filter((j) => j.status === "queued")
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.seq - b.seq);
    if (this.paused) {
      for (const job of queued) {
        if (job.stage !== PAUSED_STAGE) {
          job.stage = PAUSED_STAGE;
          changed = true;
        }
      }
      if (changed) this.publish();
      return;
    }
    const runningRes = running.map((j) => this.resourcesFor(j).res);
    const blocked = new Set<ResourceClass>();
    for (const next of queued) {
      const { adapter, res } = this.resourcesFor(next);
      if (blocked.has(res.klass)) continue;
      const verdict = this.scheduler.admit(res, runningRes);
      if (!verdict.ok) {
        blocked.add(res.klass);
        // surface the wait reason (external batch, VRAM) on the lane head
        if (next.stage !== verdict.stage) {
          next.stage = verdict.stage;
          changed = true;
        }
        continue;
      }
      next.status = "running";
      next.startedAt = Date.now();
      next.progress = 0;
      next.stage = undefined;
      if (adapter) {
        this.scheduler.started(next, res);
        this.startAdapter(next, adapter);
      }
      runningRes.push(res);
      changed = true;
    }
    if (changed) this.publish();
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
      .then(({ output, meta }) => {
        if (job.status !== "running") return; // canceled while finishing
        job.status = "completed";
        job.progress = 100;
        job.stage = undefined;
        job.eta = undefined;
        job.output = output;
        if (output && this.opts.importOutput) {
          try {
            // pull the artifact into the project's assets tree (library picks it up)
            job.output = this.opts.importOutput({ ...job }, meta) ?? output;
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
        this.scheduler.finished(job); // releases the legacy lock if this job held it
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
