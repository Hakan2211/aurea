/* The execute half of scene assembly (AUREA-NEXT-PLAN N1.1).
 *
 * A batch walks one scene through the passes the crew playbook runs by hand:
 *   1. voice + board together (TTS is cheap, boards are the gate-1 material),
 *   2. render every shot whose board AND voices actually landed,
 *   3. cut: lay approved takes, re-laid in script order.
 * Each pass re-plans from the production on disk, so a pass only acts on what
 * the previous one really delivered — a failed board skips that shot's render
 * and leaves the rest of the batch alone.
 *
 * The runner never enqueues on its own. It drives the same tRPC procedures the
 * Desk and the MCP tools call (table read, board generate, render shot), handed
 * in as `AssemblyVerbs`, so there is one path to every job. Batches live in
 * memory: a studiod restart revives the queue itself, and re-running assemble
 * is the resume (finished work plans as done, queued work as inflight). */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  planSceneAssembly,
  type AssemblyBatch,
  type AssemblyPlan,
  type AssemblyStep,
  type ImageAspect,
  type Job,
  type SceneAssemble,
  sceneAssembleSchema,
  type VideoPreset,
} from "@aurea/shared";
import type { JobEngine } from "./jobs.js";
import type { StudioStore } from "./studio.js";
import type { TimelineStore } from "./timeline.js";

/** the procedures a batch drives — bound to a tRPC caller in the router */
export interface AssemblyVerbs {
  tableRead(input: { project: string; sceneId: string; lineIds: string[] }): Promise<{
    queued: Array<{ job: Job; shotId: string; lineId: string }>;
    skipped: Array<{ lineId: string; reason: string }>;
  }>;
  board(input: { project: string; shotId: string; aspect: ImageAspect }): Promise<Job>;
  render(input: { project: string; shotId: string; preset: string }): Promise<{ job: Job }>;
}

export interface AssemblyDeps {
  engine: Pick<JobEngine, "snapshot" | "tagBatch" | "cancel" | "get">;
  studio: Pick<StudioStore, "getScene" | "getBible" | "approvedTakeAssets" | "getShotContext">;
  timelines: Pick<TimelineStore, "get" | "addClip" | "orderVideoTrack">;
  presets: (project: string) => VideoPreset[];
  /** the verbs bound to an in-process caller — server.ts supplies it, since
   * the router can't name its own caller type from inside itself */
  verbs?: () => AssemblyVerbs;
  /** how often a pass re-reads the queue while it waits (ms) */
  pollMs?: number;
}

const BATCH_CAP = 20;
const terminal = (j: Job | undefined) => !j || j.status === "completed" || j.status === "failed";

export class AssemblyRunner extends EventEmitter {
  private batches = new Map<string, AssemblyBatch>();
  private canceled = new Set<string>();

  constructor(private deps: AssemblyDeps) {
    super();
  }

  plan(raw: SceneAssemble): AssemblyPlan {
    const input = sceneAssembleSchema.parse(raw);
    const scene = this.deps.studio.getScene(input.project, input.sceneId);
    const video = this.deps.timelines.get(input.project).tracks.find((t) => t.kind === "video");
    return planSceneAssembly({
      project: input.project,
      scene,
      bible: this.deps.studio.getBible(input.project),
      presets: this.deps.presets(input.project),
      jobs: this.deps.engine.snapshot(),
      timelineAssets: video?.clips.map((c) => c.asset) ?? [],
      options: { through: input.through, lane: input.lane, lanes: input.lanes },
    });
  }

  get(id: string): AssemblyBatch | undefined {
    return this.batches.get(id);
  }

  /** newest first */
  list(project?: string): AssemblyBatch[] {
    return [...this.batches.values()].filter((b) => !project || b.project === project).reverse();
  }

  /** Stop the batch: no further passes, and its own queued/running jobs are
   * canceled. Finished takes stay on their shots. */
  cancel(id: string): AssemblyBatch | undefined {
    const batch = this.batches.get(id);
    if (!batch || batch.status !== "running") return batch;
    this.canceled.add(id);
    for (const step of batch.steps) {
      for (const jobId of step.jobIds) {
        if (!terminal(this.deps.engine.get(jobId))) this.deps.engine.cancel(jobId);
      }
    }
    this.finish(batch, "canceled", "Canceled — re-run assemble to pick up where it stopped.");
    return batch;
  }

  start(raw: SceneAssemble, verbs: AssemblyVerbs | undefined = this.deps.verbs?.()): AssemblyBatch {
    const input = sceneAssembleSchema.parse(raw);
    if (!verbs) throw new Error("scene assembly has no verbs bound in this studiod");
    const clash = this.list(input.project).find((b) => b.sceneId === input.sceneId && b.status === "running");
    if (clash) throw new Error(`scene "${input.sceneId}" is already assembling (batch ${clash.id}) — cancel it or wait`);
    const plan = this.plan(input);
    const batch: AssemblyBatch = {
      id: `asm-${randomUUID().slice(0, 8)}`,
      project: input.project,
      sceneId: input.sceneId,
      through: input.through,
      status: "running",
      phase: "voice+board",
      startedAt: new Date().toISOString(),
      steps: plan.steps.map((s) => ({ ...s, jobIds: [...s.jobIds] })),
    };
    this.batches.set(batch.id, batch);
    while (this.batches.size > BATCH_CAP) this.batches.delete(this.batches.keys().next().value!);
    this.publish(batch);
    this.run(batch, input, verbs).catch((err: unknown) => {
      batch.error = err instanceof Error ? err.message : String(err);
      this.finish(batch, "finished", `Stopped on an error: ${batch.error}`);
    });
    return batch;
  }

  /** resolves once the batch is no longer running (tests, scripts) */
  async settled(id: string): Promise<AssemblyBatch> {
    for (;;) {
      const b = this.batches.get(id);
      if (!b || b.status !== "running") return b!;
      await this.sleep();
    }
  }

  /* ---------- the passes ---------- */

  private async run(batch: AssemblyBatch, input: ReturnType<typeof sceneAssembleSchema.parse>, verbs: AssemblyVerbs) {
    const { project, sceneId } = input;

    /* 1 · voice + board */
    const voiceSteps = batch.steps.filter((s) => s.kind === "voice" && s.status === "todo");
    const lineIds = voiceSteps.flatMap((s) => s.lineIds ?? []);
    if (lineIds.length) {
      try {
        const r = await verbs.tableRead({ project, sceneId, lineIds });
        for (const step of voiceSteps) {
          const mine = r.queued.filter((q) => step.lineIds?.includes(q.lineId));
          const skipped = r.skipped.filter((s) => step.lineIds?.includes(s.lineId));
          step.jobIds.push(...mine.map((q) => q.job.id));
          if (mine.length) step.status = "queued";
          else {
            step.status = "failed";
            step.reason = skipped[0]?.reason ?? "nothing was queued";
          }
        }
      } catch (err) {
        for (const step of voiceSteps) this.fail(step, err);
      }
    }
    for (const step of batch.steps.filter((s) => s.kind === "board" && s.status === "todo")) {
      if (this.canceled.has(batch.id)) return;
      try {
        const job = await verbs.board({ project, shotId: step.shotId, aspect: step.aspect ?? "16:9" });
        step.jobIds.push(job.id);
        step.status = "queued";
      } catch (err) {
        this.fail(step, err);
      }
    }
    this.tag(batch);
    await this.waitPass(batch, ["voice", "board"]);
    if (this.canceled.has(batch.id)) return;

    if (input.through === "board") {
      const boarded = batch.steps.filter((s) => s.kind === "board" && (s.status === "completed" || s.status === "done")).length;
      return this.finish(batch, "finished", this.gateSummary(batch, `${boarded} shot${boarded === 1 ? "" : "s"} boarded — review the boards on the Desk (gate 1), then assemble through render.`));
    }

    /* 2 · render — re-planned, so only shots whose board and voices landed go */
    batch.phase = "render";
    const fresh = this.plan(input);
    const ready = (shotId: string) =>
      fresh.steps.every((s) => s.shotId !== shotId || s.kind === "render" || s.kind === "cut" || s.status === "done");
    const renders = fresh.steps.filter((s) => s.kind === "render").map((s) => ({ ...s, jobIds: [...s.jobIds] }));
    batch.steps = [...batch.steps.filter((s) => s.kind !== "render"), ...renders];
    for (const step of renders.filter((s) => s.status === "todo")) {
      if (this.canceled.has(batch.id)) return;
      if (!ready(step.shotId)) {
        step.status = "skipped";
        step.reason = "its board or voices didn't land — fix those and re-run";
        continue;
      }
      try {
        const { job } = await verbs.render({ project, shotId: step.shotId, preset: step.lane! });
        step.jobIds.push(job.id);
        step.status = "queued";
      } catch (err) {
        this.fail(step, err);
      }
    }
    this.tag(batch);
    await this.waitPass(batch, ["render"]);
    if (this.canceled.has(batch.id)) return;

    if (input.through === "render") {
      const n = renders.filter((s) => s.status === "completed" || s.status === "done").length;
      return this.finish(batch, "finished", this.gateSummary(batch, `${n} shot${n === 1 ? "" : "s"} rendered — review and approve takes on the Desk (gate 2), then assemble through cut.`));
    }

    /* 3 · cut — approved takes only, then script order */
    batch.phase = "cut";
    const cuts = this.plan(input).steps.filter((s) => s.kind === "cut").map((s) => ({ ...s }));
    batch.steps = [...batch.steps.filter((s) => s.kind !== "cut"), ...cuts];
    for (const step of cuts.filter((s) => s.status === "todo")) {
      try {
        const { shot } = this.deps.studio.getShotContext(project, step.shotId);
        const take = shot.videoTakes.find((t) => t.id === shot.selectedTake)!;
        await this.deps.timelines.addClip(project, { asset: take.asset, track: "video", label: shot.title || shot.id });
        step.status = "completed";
      } catch (err) {
        this.fail(step, err);
      }
    }
    this.deps.timelines.orderVideoTrack(project, this.deps.studio.approvedTakeAssets(project));
    const laid = cuts.filter((s) => s.status === "completed" || s.status === "done").length;
    const waiting = cuts.filter((s) => s.status === "blocked").length;
    this.finish(
      batch,
      "finished",
      this.gateSummary(
        batch,
        `${laid} approved take${laid === 1 ? "" : "s"} on the cut in script order` +
          (waiting ? `; ${waiting} shot${waiting === 1 ? "" : "s"} still await your verdict` : "") +
          ". Export with Normalize to lane.",
      ),
    );
  }

  /** wait until every queued/inflight job of these kinds is finished, then
   * settle each step from its jobs */
  private async waitPass(batch: AssemblyBatch, kinds: AssemblyStep["kind"][]) {
    const steps = batch.steps.filter((s) => kinds.includes(s.kind) && (s.status === "queued" || s.status === "inflight"));
    for (;;) {
      if (this.canceled.has(batch.id)) return;
      const open = steps.filter((s) => s.jobIds.some((id) => !terminal(this.deps.engine.get(id))));
      for (const step of steps) {
        if (open.includes(step) || (step.status !== "queued" && step.status !== "inflight")) continue;
        const jobs = step.jobIds.map((id) => this.deps.engine.get(id));
        const failed = jobs.find((j) => j?.status === "failed");
        if (jobs.length === 0 || jobs.some((j) => !j)) {
          step.status = "failed";
          step.reason = "its job was dismissed from the queue";
        } else if (failed) {
          step.status = "failed";
          step.reason = failed.error ?? "job failed";
        } else step.status = "completed";
      }
      this.publish(batch);
      if (open.length === 0) return;
      await this.sleep();
    }
  }

  private tag(batch: AssemblyBatch) {
    for (const step of batch.steps) {
      if (step.status === "queued") for (const id of step.jobIds) this.deps.engine.tagBatch(id, batch.id);
    }
    this.publish(batch);
  }

  private fail(step: AssemblyStep, err: unknown) {
    step.status = "failed";
    step.reason = err instanceof Error ? err.message : String(err);
  }

  private gateSummary(batch: AssemblyBatch, head: string): string {
    const failed = batch.steps.filter((s) => s.status === "failed" || s.status === "skipped").length;
    const blocked = batch.steps.filter((s) => s.status === "blocked" && s.kind !== "cut").length;
    const tail = [
      failed ? `${failed} step${failed === 1 ? "" : "s"} failed or skipped` : "",
      blocked ? `${blocked} blocked` : "",
    ].filter(Boolean);
    return tail.length ? `${head} ${tail.join(", ")} — see the steps; re-run assemble after fixing them.` : head;
  }

  private finish(batch: AssemblyBatch, status: AssemblyBatch["status"], summary: string) {
    if (batch.status !== "running") return;
    batch.status = status;
    batch.phase = "done";
    batch.summary = summary;
    batch.finishedAt = new Date().toISOString();
    this.publish(batch);
  }

  private publish(batch: AssemblyBatch) {
    this.emit("update", batch);
  }

  private sleep() {
    return new Promise<void>((resolve) => setTimeout(resolve, this.deps.pollMs ?? 1000));
  }
}
