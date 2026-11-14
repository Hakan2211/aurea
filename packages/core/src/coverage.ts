/* CoverageStore — the record of every coverage pass, and the thing the canon
 * library's Angles tab reads.
 *
 * Folder-is-the-database, like `ab/` next to it:
 *
 *   <dataRoot>/coverage/<id>/run.json
 *
 * The record exists for the same reason the A/B one does: job history is
 * capped at 100 entries, so a sheet opened next month can no longer ask the
 * queue what it was of. Everything the tab needs — the plate, the location,
 * the eight angle assets — is written here as the job settles.
 *
 * The angle assets are filled in from the IMPORTED folder rather than from
 * the adapter's scratch dir: the deliverable is a library asset a shot can be
 * boarded off, and until importOutput has run there is nothing to point at. */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  COVERAGE_ANGLES,
  coverageFileName,
  coverageRunSchema,
  type CoverageRun,
  type CoverageStart,
  type Job,
  type JobPayload,
  coverageStartSchema,
} from "@aurea/shared";
import type { SettingsStore } from "./settings.js";
import type { JobEngine } from "./jobs.js";
import { labEnqueue } from "./labs.js";

/** a run id that sorts by time in a directory listing */
const runId = () =>
  `${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 13)}-${randomUUID().slice(0, 6)}`;

export class CoverageStore {
  /** ids already written as settled — nothing left to sync */
  private done = new Set<string>();

  constructor(
    private settings: SettingsStore,
    private engine: JobEngine,
  ) {
    this.engine.on("snapshot", (jobs: Job[]) => this.sync(jobs));
  }

  private root(): string {
    return path.join(this.settings.get().storage.dataRoot, "coverage");
  }
  private file(id: string): string {
    return path.join(this.root(), id, "run.json");
  }

  /* ---------- create ---------- */

  create(input: CoverageStart): CoverageRun {
    const parsed = coverageStartSchema.parse(input);
    const { project, ...rest } = parsed;
    const seed = rest.seed ?? Math.floor(Math.random() * 2_147_483_647);
    const payload: JobPayload = { type: "coverage", ...rest, seed };
    const enq = labEnqueue(payload, project);
    const job = this.engine.enqueue({
      ...enq,
      /* A coverage pass is preparation for work, not the work — it queues
       * behind a render someone is waiting on, and ahead of an experiment. */
      priority: "preview",
    });
    const run = coverageRunSchema.parse({
      id: runId(),
      project,
      createdAt: new Date().toISOString(),
      source: rest.source,
      subject: rest.subject,
      location: rest.location,
      seed,
      jobId: job.id,
      status: job.status,
      angles: COVERAGE_ANGLES.map((a) => ({ id: a.id, deg: a.deg, frame: a.frame })),
    });
    this.write(run);
    return run;
  }

  /* ---------- read ---------- */

  list(project?: string, location?: string): CoverageRun[] {
    if (!fs.existsSync(this.root())) return [];
    const runs: CoverageRun[] = [];
    for (const entry of fs.readdirSync(this.root())) {
      const run = this.read(entry);
      if (!run) continue;
      if (project && run.project !== project) continue;
      if (location !== undefined && run.location !== location) continue;
      runs.push(run);
    }
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): CoverageRun | null {
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

  private sync(jobs: Job[]): void {
    if (!fs.existsSync(this.root())) return;
    const byId = new Map(jobs.map((j) => [j.id, j]));
    for (const entry of fs.readdirSync(this.root())) {
      if (this.done.has(entry)) continue;
      const run = this.read(entry);
      if (!run) continue;
      if (run.status === "completed" || run.status === "failed") {
        this.done.add(entry);
        continue;
      }
      const job = byId.get(run.jobId);
      if (!job) {
        // fell out of a hand-cleared queue before it finished — settle it as
        // failed rather than leaving the tab waiting forever
        run.status = "failed";
        run.error = "job is no longer in the queue";
        this.write(run);
        this.done.add(entry);
        continue;
      }
      if (job.status === run.status) continue;
      run.status = job.status;
      run.error = job.error;
      if (job.status === "completed" && job.output) this.attach(run, job.output);
      this.write(run);
      if (job.status === "completed" || job.status === "failed") this.done.add(entry);
    }
  }

  /** Point the record at the imported library assets.
   *
   * `job.output` is the primary imported file — the first angle — so its
   * folder is the coverage folder. Matching on the filename stem rather than
   * position is what makes a partial import (a file that failed to copy)
   * visible as a missing angle instead of a silently shifted one. */
  private attach(run: CoverageRun, output: string): void {
    const dataRoot = this.settings.get().storage.dataRoot;
    const dir = path.dirname(output);
    if (!fs.existsSync(dir)) return;
    const rel = (file: string) => path.relative(dataRoot, file).split(path.sep).join("/");
    const names = fs.readdirSync(dir);
    run.angles = COVERAGE_ANGLES.map((angle, i) => {
      const stem = coverageFileName(angle, i);
      const hit = names.find((n) => path.basename(n, path.extname(n)).startsWith(stem));
      return {
        id: angle.id,
        deg: angle.deg,
        frame: angle.frame,
        ...(hit ? { asset: rel(path.join(dir, hit)) } : {}),
      };
    });
    const sheet = names.find((n) => path.basename(n, path.extname(n)).startsWith("sheet"));
    if (sheet) run.sheet = rel(path.join(dir, sheet));
  }

  /* ---------- plumbing ---------- */

  private read(id: string): CoverageRun | null {
    try {
      return coverageRunSchema.parse(JSON.parse(fs.readFileSync(this.file(id), "utf8")));
    } catch {
      return null; // not a run directory, or hand-edited past parsing
    }
  }

  private write(run: CoverageRun): void {
    const target = this.file(run.id);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(run, null, 2));
    fs.renameSync(tmp, target);
  }
}
