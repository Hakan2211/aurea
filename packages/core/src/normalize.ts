/* normalize_project (production experience plan P4) — project hygiene.
 *
 * Two rules run automatically and only once: the sequence canvas is adopted
 * from the FIRST clip laid on an empty timeline (addClip), and the base track
 * is re-laid in script order on the NEXT approval (approveShot). A project
 * that got its first clip before either rule existed — `zoo-logic` after the
 * pilot: 1280×720 with FN15-4 ahead of FN15-3 — has nothing that fires them
 * again. This is the explicit override: adopt a canvas, re-lay the base track
 * in the production's own order, and re-export at the delivery loudness.
 * Dry-run prints the diff and changes nothing.
 *
 * The plan is pure (`planNormalize` over facts already gathered) so the diff
 * is unit-tested; `normalizeProject` gathers the facts and applies it. */

import fs from "node:fs";
import path from "node:path";
import { parseCanvas, type Job, type Timeline, type VideoPreset } from "@aurea/shared";
import { describeExport, probeMedia, sequenceEnd } from "./adapters/ffmpeg-export.js";
import type { JobEngine } from "./jobs.js";
import type { ProjectStore } from "./projects.js";
import type { PromptLibrary } from "./promptlib.js";
import type { SettingsStore } from "./settings.js";
import type { StudioStore } from "./studio.js";
import type { TimelineStore } from "./timeline.js";

export interface Canvas {
  width: number;
  height: number;
}

export interface NormalizeFacts {
  timeline: Timeline;
  /** the approved takes in production order, with the canvas each was
   * rendered at (null when the file could not be probed) */
  approved: Array<{ shotId: string; title: string; asset: string; canvas: Canvas | null }>;
  /** the lane named by the caller, if it exists */
  lane: VideoPreset | null;
  /** the caller asked for a lane that does not exist */
  laneMissing?: string;
}

export interface NormalizePlan {
  canvas: {
    from: Canvas;
    to: Canvas | null;
    /** where `to` came from */
    source: "lane" | "takes" | "unchanged" | "unknown";
    detail: string;
  };
  order: {
    /** clip labels on the base track, as laid now */
    before: string[];
    /** …and as the production orders them */
    after: string[];
    changed: boolean;
    /** approved takes that are not on the sequence at all (approve_shot lays
     * them; normalize does not invent clips) */
    missing: string[];
    /** clips on the base track that belong to no approved shot — hand-placed
     * cutaways, kept at the end in their own order */
    extra: string[];
  };
  notes: string[];
}

/** the canvas most of the takes were rendered at; ties go to the first */
export function majorityCanvas(canvases: Array<Canvas | null>): Canvas | null {
  const counts = new Map<string, { canvas: Canvas; n: number; first: number }>();
  canvases.forEach((c, i) => {
    if (!c) return;
    const key = `${c.width}x${c.height}`;
    const cur = counts.get(key);
    if (cur) cur.n++;
    else counts.set(key, { canvas: c, n: 1, first: i });
  });
  const best = [...counts.values()].sort((a, b) => b.n - a.n || a.first - b.first)[0];
  return best?.canvas ?? null;
}

export function planNormalize(facts: NormalizeFacts): NormalizePlan {
  const notes: string[] = [];
  const from = { width: facts.timeline.width, height: facts.timeline.height };

  /* ---- canvas ---- */
  let to: Canvas | null = null;
  let source: NormalizePlan["canvas"]["source"] = "unknown";
  let detail = "";
  if (facts.laneMissing) notes.push(`No render lane "${facts.laneMissing}" — the takes' own canvas is used instead.`);
  const laneCanvas = facts.lane ? parseCanvas(facts.lane.payload.resolution) : null;
  if (facts.lane && !laneCanvas) notes.push(`Lane "${facts.lane.id}" names no canvas — the takes' own canvas is used instead.`);
  if (laneCanvas) {
    to = laneCanvas;
    source = "lane";
    detail = `lane "${facts.lane!.id}" (${facts.lane!.payload.resolution})`;
  } else {
    const takes = majorityCanvas(facts.approved.map((a) => a.canvas));
    if (takes) {
      to = takes;
      source = "takes";
      const n = facts.approved.filter((a) => a.canvas && a.canvas.width === takes.width && a.canvas.height === takes.height).length;
      detail = `${n} of ${facts.approved.length} approved takes are ${takes.width}×${takes.height}`;
    } else {
      detail = facts.approved.length
        ? "no approved take could be probed — canvas left as it is"
        : "no approved takes — canvas left as it is";
    }
  }
  if (to && to.width === from.width && to.height === from.height) {
    source = "unchanged";
    detail = `already ${from.width}×${from.height} (${detail})`;
    to = null;
  }
  const mismatched = to
    ? facts.approved.filter((a) => a.canvas && (a.canvas.width !== to!.width || a.canvas.height !== to!.height))
    : [];
  if (mismatched.length) {
    notes.push(
      `${mismatched.length} approved take${mismatched.length === 1 ? " was" : "s were"} rendered at another canvas and will letterbox: ${mismatched.map((m) => `${m.title} (${m.canvas!.width}×${m.canvas!.height})`).join(", ")}.`,
    );
  }

  /* ---- order ---- */
  const track = facts.timeline.tracks.find((t) => t.kind === "video");
  const clips = track ? [...track.clips].sort((a, b) => a.start - b.start) : [];
  const before = clips.map((c) => c.label || path.basename(c.asset));
  const onTrack = new Set(clips.map((c) => c.asset));
  const rank = new Map(facts.approved.map((a, i) => [a.asset, i]));
  const ordered = clips
    .map((clip, i) => ({ clip, i, rank: rank.get(clip.asset) ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(({ clip }) => clip);
  const after = ordered.map((c) => c.label || path.basename(c.asset));
  const missing = facts.approved.filter((a) => !onTrack.has(a.asset)).map((a) => a.title);
  const extra = clips.filter((c) => !rank.has(c.asset)).map((c) => c.label || path.basename(c.asset));
  const changed = before.some((l, i) => l !== after[i]);
  if (missing.length) notes.push(`Not on the sequence: ${missing.join(", ")} — approve_shot lays a take; normalize only re-orders what is there.`);
  if (extra.length) notes.push(`Kept at the end, not an approved take: ${extra.join(", ")}.`);
  if (!clips.length) notes.push("The base track is empty — nothing to re-lay.");

  return {
    canvas: { from, to, source, detail },
    order: { before, after, changed, missing, extra },
    notes,
  };
}

export interface NormalizeDeps {
  settings: SettingsStore;
  projects: ProjectStore;
  studio: StudioStore;
  timelines: TimelineStore;
  prompts: PromptLibrary;
  engine: JobEngine;
}

export interface NormalizeResult {
  plan: NormalizePlan;
  applied: boolean;
  timeline: Timeline;
  /** the export job, when one was enqueued */
  job: Job | null;
}

export async function gatherNormalizeFacts(
  deps: Pick<NormalizeDeps, "settings" | "studio" | "timelines" | "prompts">,
  project: string,
  laneId?: string,
): Promise<NormalizeFacts> {
  const dataRoot = deps.settings.get().storage.dataRoot;
  const timeline = deps.timelines.get(project);
  const approved = [];
  for (const a of deps.studio.approvedTakes(project)) {
    const file = path.join(dataRoot, a.asset);
    const probe = fs.existsSync(file) ? await probeMedia(file).catch(() => null) : null;
    approved.push({
      ...a,
      canvas: probe?.width && probe.height ? { width: probe.width, height: probe.height } : null,
    });
  }
  const lane = laneId ? (deps.prompts.videoPresets(project).find((p) => p.id === laneId) ?? null) : null;
  return { timeline, approved, lane, ...(laneId && !lane ? { laneMissing: laneId } : {}) };
}

export async function normalizeProject(
  deps: NormalizeDeps,
  input: { project: string; lane?: string; dryRun?: boolean; export?: boolean; loudnessLufs?: number | null },
): Promise<NormalizeResult> {
  const facts = await gatherNormalizeFacts(deps, input.project, input.lane);
  const plan = planNormalize(facts);
  if (input.dryRun) return { plan, applied: false, timeline: facts.timeline, job: null };

  let timeline = facts.timeline;
  if (plan.canvas.to) timeline = deps.timelines.setCanvas(input.project, plan.canvas.to.width, plan.canvas.to.height);
  if (plan.order.changed) {
    timeline = deps.timelines.orderVideoTrack(
      input.project,
      facts.approved.map((a) => a.asset),
    );
  }

  let job: Job | null = null;
  const wantExport = input.export ?? true;
  if (wantExport) {
    if (sequenceEnd(timeline) <= 0) {
      plan.notes.push("Export skipped — the sequence is empty.");
    } else {
      const name = deps.projects.list().find((p) => p.id === input.project)?.name ?? input.project;
      const lufs = input.loudnessLufs === undefined ? -16 : input.loudnessLufs;
      job = deps.engine.enqueue({
        title: `Export — ${name}`,
        kind: "video",
        engine: "ffmpeg",
        priority: "interactive",
        detail: describeExport(timeline),
        project: `/${input.project}`,
        payload: { type: "export", project: input.project, timeline, loudnessLufs: lufs },
      });
      plan.notes.push(
        lufs === null ? "Export queued at the mix's own level." : `Export queued at ${lufs} LUFS.`,
      );
    }
  }
  return { plan, applied: true, timeline, job };
}
