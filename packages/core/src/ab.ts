/* AbStore — the A/B render queue (VIDEO-SPEED-RELIABILITY §2.3, upgrade plan
 * §5.1). Every speed and quality experiment on the list has the same shape:
 * render the SAME shot N ways, back to back, and compare. Doing that by hand
 * means retyping a payload, remembering which take was which, and trusting a
 * stopwatch — so the numbers never actually got written down.
 *
 * This is the machinery instead: one base payload + N overrides go in, N video
 * jobs come out at `batch` priority (an experiment never jumps the queue in
 * front of work you asked for) sharing ONE seed, and the run record collects
 * each variant's wall clock and output as the queue moves.
 *
 * Folder-is-the-database, like the rest of dataRoot:
 *
 *   <dataRoot>/ab/<id>/run.json
 *
 * The record is authoritative once every variant has settled: job history is
 * capped at 100 entries, so a run read back next week can no longer be
 * reconstructed from the queue. Timings therefore get written as they happen,
 * not derived on read. */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  abRunSchema,
  abRunSettled,
  videoAbSchema,
  type AbRun,
  type AbVariant,
  type Job,
  type JobPayload,
  type VideoAb,
} from "@aurea/shared";
import type { SettingsStore } from "./settings.js";
import type { JobEngine } from "./jobs.js";
import { labEnqueue } from "./labs.js";

type VideoInput = Omit<Extract<JobPayload, { type: "video" }>, "type">;

/** a run id that sorts by time in a directory listing */
const runId = () =>
  `${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 13)}-${randomUUID().slice(0, 6)}`;

export class AbStore {
  /** ids of runs already written as settled — nothing left to sync */
  private done = new Set<string>();

  constructor(
    private settings: SettingsStore,
    private engine: JobEngine,
  ) {
    this.engine.on("snapshot", (jobs: Job[]) => this.sync(jobs));
  }

  private root(): string {
    return path.join(this.settings.get().storage.dataRoot, "ab");
  }
  private file(id: string): string {
    return path.join(this.root(), id, "run.json");
  }

  /* ---------- create ---------- */

  create(input: VideoAb): AbRun {
    // parsed here, not just at the tRPC edge, so an MCP tool or a script that
    // calls the store directly gets the same defaults the route does
    const parsed = videoAbSchema.parse(input);
    // One seed for the whole run. Without it the variants differ by noise as
    // much as by the change under test, and the comparison says nothing.
    // The seed SPRAY is the one exception: there the seed is what is being
    // compared, so each variant draws its own (or brings one).
    const spray = parsed.seedPolicy === "spray";
    const draw = () => Math.floor(Math.random() * 2_147_483_647);
    const seed = parsed.seed ?? draw();
    const id = runId();
    const base = { ...(parsed.base as VideoInput), seed };
    const variants: AbVariant[] = [];
    for (const [i, variant] of parsed.variants.entries()) {
      const own = spray ? ((variant.overrides as { seed?: number }).seed ?? draw()) : seed;
      const payload: JobPayload = {
        type: "video",
        ...base,
        ...(variant.overrides as Partial<VideoInput>),
        // a variant may not move the seed: that is the control
        seed: own,
      };
      const enq = labEnqueue(payload, parsed.project);
      const job = this.engine.enqueue({
        ...enq,
        // experiments queue behind anything you actually asked for
        priority: "batch",
        title: `${spray ? "Sketch" : "A/B"} ${i + 1}/${parsed.variants.length} — ${variant.label}`,
        detail: [`A/B · ${parsed.title}`, enq.detail].filter(Boolean).join(" · "),
      });
      variants.push({
        label: variant.label,
        jobId: job.id,
        overrides: variant.overrides,
        status: job.status,
        seed: own,
      });
    }
    const run = abRunSchema.parse({
      id,
      project: parsed.project,
      title: parsed.title,
      notes: parsed.notes,
      createdAt: new Date().toISOString(),
      seed,
      seedPolicy: parsed.seedPolicy,
      engine: base.engine ?? "ltx2",
      base,
      variants,
    });
    this.write(run);
    return run;
  }

  /* ---------- read ---------- */

  list(project?: string): AbRun[] {
    if (!fs.existsSync(this.root())) return [];
    const runs: AbRun[] = [];
    for (const entry of fs.readdirSync(this.root())) {
      const run = this.read(entry);
      if (run && (!project || run.project === project)) runs.push(run);
    }
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): AbRun | null {
    return this.read(id);
  }

  remove(id: string): boolean {
    const dir = path.join(this.root(), id);
    if (!fs.existsSync(dir)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    this.done.delete(id);
    return true;
  }

  /* ---------- sync ---------- */

  /** Fold the live queue into every unsettled run. Cheap enough to run on
   * every snapshot: only runs with a job still in flight are re-read, and a
   * run whose variants have all stopped is never touched again. */
  private sync(jobs: Job[]): void {
    if (!fs.existsSync(this.root())) return;
    const byId = new Map(jobs.map((j) => [j.id, j]));
    const now = new Date().toISOString();
    for (const entry of fs.readdirSync(this.root())) {
      if (this.done.has(entry)) continue;
      const run = this.read(entry);
      if (!run) continue;
      if (abRunSettled(run)) {
        this.done.add(entry);
        continue;
      }
      let changed = false;
      for (const variant of run.variants) {
        if (variant.status === "completed" || variant.status === "failed") continue;
        const job = byId.get(variant.jobId);
        if (!job) {
          /* The job fell out of the history before it finished — a studiod
           * restart clears nothing, but a hand-cleared queue does. Record it
           * as failed rather than leaving the run unsettled forever. */
          variant.status = "failed";
          variant.error = "job is no longer in the queue";
          variant.finishedAt = now;
          changed = true;
          continue;
        }
        if (job.status === "running" && !variant.startedAt) {
          variant.startedAt = now;
          changed = true;
        }
        if (job.status !== variant.status) {
          variant.status = job.status;
          changed = true;
        }
        if (job.status === "completed" || job.status === "failed") {
          variant.finishedAt = now;
          variant.output = job.output;
          variant.error = job.error;
          if (variant.startedAt) {
            variant.renderMs = Date.parse(now) - Date.parse(variant.startedAt);
          }
          changed = true;
        }
      }
      if (changed) this.write(run);
      if (abRunSettled(run)) this.done.add(entry);
    }
  }

  /* ---------- plumbing ---------- */

  private read(id: string): AbRun | null {
    try {
      return abRunSchema.parse(JSON.parse(fs.readFileSync(this.file(id), "utf8")));
    } catch {
      return null; // not a run directory, or hand-edited past parsing
    }
  }

  private write(run: AbRun): void {
    const target = this.file(run.id);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(run, null, 2));
    fs.renameSync(tmp, target);
  }
}
