/* Scene assembly (AUREA-NEXT-PLAN N1.1, Phase 3 of the 2026-11 plan).
 *
 * The plan half of the plan → execute orchestrator: given one scene, which
 * lines still need voicing, which shots still need boarding, which boarded
 * shots can render in which lane, and which approved takes still need to be
 * laid on the cut. Pure, so studiod (scene.assemblePlan / the runner), the
 * Desk's confirm dialog and the tests all read the same steps.
 *
 * It does only the work a shot is MISSING (the playbook's ground rule), so
 * re-running assemble after a failure is the resume: finished work is "done",
 * work already in the queue is "inflight" and is waited on, never re-queued.
 *
 * The two human gates stay human. `through` says how far a run goes: "board"
 * (the default) stops once the boards are in, for gate 1. "render" stops once
 * the takes are in, for gate 2. "cut" only lays takes a human has APPROVED.
 * Nothing here approves anything. */

import { z } from "zod";
import { resolveKeyframeRefs } from "./storyboard.js";
import type { Bible, ImageAspect, Job, Scene, Shot, VideoPreset } from "./index.js";

export const assemblyThroughSchema = z.enum(["board", "render", "cut"]);
export type AssemblyThrough = z.infer<typeof assemblyThroughSchema>;

export const sceneAssembleSchema = z.object({
  project: z.string().min(1),
  sceneId: z.string().min(1),
  /** how far this run goes. "board" = gate 1 (review the boards), "render" =
   * gate 2 (review the takes), "cut" = also lay APPROVED takes on the sequence */
  through: assemblyThroughSchema.default("board"),
  /** one render lane for every shot (e.g. "zoo-field-note"); omitted = picked
   * per shot from who speaks in it */
  lane: z.string().optional(),
  /** per-shot lane overrides, shotId → lane id; beats `lane` */
  lanes: z.record(z.string(), z.string()).default({}),
});
export type SceneAssemble = z.input<typeof sceneAssembleSchema>;

export const assemblyGetSchema = z.object({ id: z.string().min(1) });
export const assemblyListSchema = z.object({ project: z.string().optional() });

export type AssemblyStepKind = "voice" | "board" | "render" | "cut";

/** todo = this run will queue it; inflight = already in the queue (waited on);
 * done = already on the shot; blocked = can't run, `reason` says why; later =
 * past this run's `through`. A running batch adds queued/failed/skipped. */
export type AssemblyStepStatus =
  | "todo"
  | "inflight"
  | "done"
  | "blocked"
  | "later"
  | "queued"
  | "completed"
  | "failed"
  | "skipped";

export interface AssemblyStep {
  id: string;
  kind: AssemblyStepKind;
  shotId: string;
  shotTitle: string;
  status: AssemblyStepStatus;
  /** voice steps: the script lines it voices */
  lineIds?: string[];
  /** render steps: the lane id it renders in */
  lane?: string;
  /** board steps: the still's aspect (follows the lane's canvas) */
  aspect?: ImageAspect;
  reason?: string;
  /** rough GPU seconds this step costs (0 when nothing will be queued) */
  estSec: number;
  /** jobs this step queued or waits on */
  jobIds: string[];
}

export interface AssemblyPlan {
  project: string;
  sceneId: string;
  slugline: string;
  through: AssemblyThrough;
  steps: AssemblyStep[];
  /** what this run will queue, in GPU seconds (todo steps only) */
  estSec: number;
  notes: string[];
}

/** The three documentary lanes, picked by who speaks (the playbook's lane
 * table). A Field Note or any other single-lane episode passes `lane`. */
export const ASSEMBLY_LANES = {
  broll: "zoo-broll-insert",
  single: "zoo-interview-single",
  coverage: "zoo-room-coverage",
} as const;

/* Rough GPU seconds per step, from measured runs on the 3090 Ti:
 * LTX 2.5 interview 8s = 4m17s (≈32 s per output second, ZOOLOGIC-EPISODE-
 * FACTORY.md), H3 draft 4s ≈ 2m30s warm (≈37 s/s). TTS and qwen-edit boards
 * from the FN15 pilot; boards re-measured 2026-11-10 on S1E01 sc1: qwen-edit
 * 4 min with 2 refs, 8½–10+ min with 3 (≈5 min average). These are
 * for the confirm dialog, not a promise. */
const EST = { ttsLine: 20, board: 300, ltxPerSec: 32, h3PerSec: 37, defaultRenderSec: 6 };

export function spokenLines(shot: Shot) {
  return shot.scriptLines.filter((l) => !!l.character && !!l.text.trim());
}

/** lane by who speaks: nobody → B-roll, one voice → interview single, a
 * conversation → room coverage */
export function laneForShot(shot: Shot): string {
  const speakers = new Set(spokenLines(shot).map((l) => l.character));
  if (speakers.size === 0) return ASSEMBLY_LANES.broll;
  if (speakers.size === 1) return ASSEMBLY_LANES.single;
  return ASSEMBLY_LANES.coverage;
}

/** the board's aspect follows the lane's canvas, so a 9:16 lane gets a 9:16 still */
export function laneAspect(preset: VideoPreset | undefined): ImageAspect {
  const res = preset?.payload.resolution ?? "";
  if (res.includes("9:16")) return "9:16";
  const m = /(\d+)\s*[×x]\s*(\d+)/.exec(res);
  if (m && Number(m[2]) > Number(m[1])) return "9:16";
  return "16:9";
}

export function estimateRenderSec(preset: VideoPreset | undefined): number {
  const seconds = preset?.payload.durationSec ?? EST.defaultRenderSec;
  const perSec = preset?.payload.engine === "minimax-h3" ? EST.h3PerSec : EST.ltxPerSec;
  return Math.round(seconds * perSec);
}

export interface AssemblyPlanInput {
  project: string;
  scene: Scene;
  bible: Bible;
  /** video presets (render lanes) visible to this project */
  presets: VideoPreset[];
  /** the live queue — queued/running jobs on this scene's shots are inflight */
  jobs: Job[];
  /** library relPaths on the sequence's video track */
  timelineAssets: string[];
  options: { through: AssemblyThrough; lane?: string; lanes?: Record<string, string> };
}

const live = (j: Job) => j.status === "queued" || j.status === "running";

export function planSceneAssembly(input: AssemblyPlanInput): AssemblyPlan {
  const { scene, bible, options } = input;
  const through = options.through;
  const reach = { board: 0, render: 1, cut: 2 }[through];
  const presetById = new Map(input.presets.map((p) => [p.id, p]));
  const onTimeline = new Set(input.timelineAssets);
  const steps: AssemblyStep[] = [];
  const notes: string[] = [];

  // what the queue already holds for this scene, keyed the way delivery keys it
  const inflight = { voice: new Map<string, string[]>(), board: new Map<string, string[]>(), render: new Map<string, string[]>() };
  const push = (m: Map<string, string[]>, k: string, id: string) => m.set(k, [...(m.get(k) ?? []), id]);
  for (const job of input.jobs.filter(live)) {
    const p = job.payload;
    if (!p || !("board" in p) || !p.board) continue;
    if (p.type === "tts" && p.board.lineId) push(inflight.voice, p.board.lineId, job.id);
    else if (p.type === "image") push(inflight.board, p.board.shotId, job.id);
    else if (p.type === "video" && !("preview" in p.board && p.board.preview)) push(inflight.render, p.board.shotId, job.id);
  }

  for (const shot of scene.shots) {
    const title = shot.title || shot.id;
    const base = { shotId: shot.id, shotTitle: title, estSec: 0, jobIds: [] as string[] };
    const laneId = options.lanes?.[shot.id] ?? options.lane ?? laneForShot(shot);
    const preset = presetById.get(laneId);

    /* ---- voice: spoken lines without a take of their own ----
     * A shot that already has a full take (or is approved) needs no voices
     * for this run — its takes may predate line tagging (pre-P0 voTakes carry
     * no lineId), and re-voicing them would only queue TTS nobody renders. */
    const rendered = shot.videoTakes.some((t) => !t.preview) || shot.status === "approved";
    const voiced = new Set(shot.voTakes.map((t) => t.lineId).filter(Boolean));
    const unvoiced = rendered ? [] : spokenLines(shot).filter((l) => !voiced.has(l.id));
    const toVoice: string[] = [];
    const voiceInflight: string[] = [];
    const uncast: string[] = [];
    for (const line of unvoiced) {
      const jobs = inflight.voice.get(line.id);
      if (jobs) {
        voiceInflight.push(...jobs);
        continue;
      }
      const character = bible.characters.find((c) => c.id === line.character);
      if (character?.voice.voiceId) toVoice.push(line.id);
      else uncast.push(character?.name ?? line.character!);
    }
    if (spokenLines(shot).length > 0) {
      if (toVoice.length) {
        steps.push({ ...base, id: `voice:${shot.id}`, kind: "voice", status: "todo", lineIds: toVoice, estSec: toVoice.length * EST.ttsLine });
      } else if (voiceInflight.length) {
        steps.push({ ...base, id: `voice:${shot.id}`, kind: "voice", status: "inflight", jobIds: voiceInflight });
      } else if (!uncast.length) {
        steps.push({ ...base, id: `voice:${shot.id}`, kind: "voice", status: "done" });
      }
      if (uncast.length) {
        steps.push({
          ...base,
          id: `voice-uncast:${shot.id}`,
          kind: "voice",
          status: "blocked",
          reason: `${[...new Set(uncast)].join(", ")} ha${uncast.length === 1 ? "s" : "ve"} no cast voice — cast one in /bible`,
        });
      }
    }
    const voiceReady = uncast.length === 0;

    /* ---- board: no keyframe yet ---- */
    let boardReady = shot.keyframes.length > 0;
    const aspect = laneAspect(preset);
    if (boardReady) {
      steps.push({ ...base, id: `board:${shot.id}`, kind: "board", status: "done" });
    } else if (inflight.board.has(shot.id)) {
      steps.push({ ...base, id: `board:${shot.id}`, kind: "board", status: "inflight", aspect, jobIds: inflight.board.get(shot.id)! });
      boardReady = true; // it will be, once that job lands
    } else if (resolveKeyframeRefs(shot, scene, bible).length === 0) {
      steps.push({
        ...base,
        id: `board:${shot.id}`,
        kind: "board",
        status: "blocked",
        aspect,
        reason: "no reference images — give the shot characters or a location with bible refs",
      });
    } else {
      steps.push({ ...base, id: `board:${shot.id}`, kind: "board", status: "todo", aspect, estSec: EST.board });
      boardReady = true;
    }

    /* ---- render: boarded, voiced, no full take yet ---- */
    const renderStep = { ...base, id: `render:${shot.id}`, kind: "render" as const, lane: laneId };
    if (rendered) {
      steps.push({ ...renderStep, status: "done" });
    } else if (inflight.render.has(shot.id)) {
      steps.push({ ...renderStep, status: "inflight", jobIds: inflight.render.get(shot.id)! });
    } else if (!preset) {
      steps.push({ ...renderStep, status: "blocked", reason: `unknown render lane "${laneId}"` });
    } else if (!boardReady) {
      steps.push({ ...renderStep, status: "blocked", reason: "needs a board first" });
    } else if (!voiceReady) {
      steps.push({ ...renderStep, status: "blocked", reason: "its lines can't all be voiced yet" });
    } else if (reach < 1) {
      steps.push({ ...renderStep, status: "later", reason: "after gate 1 — review the boards, then assemble through render", estSec: estimateRenderSec(preset) });
    } else {
      steps.push({ ...renderStep, status: "todo", estSec: estimateRenderSec(preset) });
    }

    /* ---- cut: approved takes only (gate 2 is a human's) ---- */
    if (reach >= 2) {
      const take = shot.status === "approved" ? shot.videoTakes.find((t) => t.id === shot.selectedTake) : undefined;
      const cutStep = { ...base, id: `cut:${shot.id}`, kind: "cut" as const };
      if (take && onTimeline.has(take.asset)) steps.push({ ...cutStep, status: "done" });
      else if (take) steps.push({ ...cutStep, status: "todo" });
      else steps.push({ ...cutStep, status: "blocked", reason: "awaiting your verdict — approve a take on the Desk" });
    }
  }

  if (scene.shots.length === 0) notes.push("This scene has no shots yet — break it down in the Writers Room first.");
  if (through === "board") notes.push("Stops at gate 1: once the boards are in, review them, then assemble again through render.");
  if (through === "render") notes.push("Stops at gate 2: approve takes on the Desk, then assemble through cut to lay them in script order.");
  if (through === "cut") notes.push("Only approved takes are laid; the cut is re-laid in script order. Export with Normalize to lane.");

  return {
    project: input.project,
    sceneId: scene.id,
    slugline: scene.slugline,
    through,
    steps,
    estSec: steps.filter((s) => s.status === "todo").reduce((sum, s) => sum + s.estSec, 0),
    notes,
  };
}

/* ---------- a running batch ---------- */

export type AssemblyBatchStatus = "running" | "finished" | "canceled";

export interface AssemblyBatch {
  id: string;
  project: string;
  sceneId: string;
  through: AssemblyThrough;
  status: AssemblyBatchStatus;
  /** which pass is running now */
  phase: "voice+board" | "render" | "cut" | "done";
  startedAt: string;
  finishedAt?: string;
  steps: AssemblyStep[];
  /** what a human does next (gate reached, failures to look at) */
  summary?: string;
  error?: string;
}
