/* Shot spec → LTXDirector node inputs.
 *
 * The Director node normally gets its state from a drag-and-drop editor inside
 * ComfyUI, which writes four inputs: a `timeline_data` JSON blob plus three
 * flat strings the editor keeps in sync with it. We author shots in Aurea
 * instead, so this module writes those four inputs directly. Everything here
 * is derived from reading the pack's own parser (ltx_director.py) — the
 * non-obvious rules it enforces are called out at each site.
 *
 * Pure and synchronous: no ComfyUI, no filesystem. Callers stage their media
 * first (ComfyClient.uploadInput) and pass the staged input-relative names. */

/** LTX's temporal stride: a clip is 8n+1 pixel frames, and anything else gets
 * silently rounded by the graph — better to round here where we can tell the
 * user what they actually get. */
export const FRAME_QUANTUM = 8;

/** round UP to the next valid LTX length, so a 5s ask is never short-changed */
export function snapFrames(frames: number): number {
  const n = Math.max(1, Math.round(frames));
  return Math.ceil((n - 1) / FRAME_QUANTUM) * FRAME_QUANTUM + 1;
}

/** LTX wants both dimensions divisible by 32 */
export function snapSize(px: number): number {
  return Math.max(32, Math.floor(px / 32) * 32);
}

export const secToFrames = (sec: number, fps: number) => Math.max(0, Math.round(sec * fps));

export interface TimelineKeyframe {
  /** staged ComfyUI input name, e.g. "aurea/shot-kf0.png" */
  file: string;
  /** which frame this image is pinned to */
  atFrame: number;
  /** 0..1 — how hard the guide holds. 1 = locked, lower = a suggestion. */
  strength: number;
}

export interface TimelinePromptZone {
  prompt: string;
  /** pixel frames this beat covers; the zones tile the clip in order */
  lengthFrames: number;
}

export interface TimelineAudioSegment {
  /** staged ComfyUI input name of a voice take */
  file: string;
  atFrame: number;
  lengthFrames: number;
  /** skip this many frames into the source before using it */
  trimStartFrames?: number;
}

export interface TimelineMotionSegment {
  /** staged ComfyUI input name of the motion reference video */
  file: string;
  atFrame: number;
  lengthFrames: number;
}

export interface TimelineRetake {
  /** staged name of the mp4 being fixed */
  file: string;
  atFrame: number;
  lengthFrames: number;
  prompt: string;
  /** total length of the source video, which the node needs up front */
  sourceDurationFrames: number;
  strength?: number;
}

export interface TimelineInput {
  /** anchors cast, wardrobe and style across every beat */
  globalPrompt: string;
  fps: number;
  /** total clip length; snapped by the caller via snapFrames */
  durationFrames: number;
  keyframes?: TimelineKeyframe[];
  promptZones?: TimelinePromptZone[];
  audio?: TimelineAudioSegment[];
  motion?: TimelineMotionSegment[];
  retake?: TimelineRetake;
}

/** the four node inputs, ready to drop into the graph */
export interface TimelineNodeInputs {
  timeline_data: string;
  local_prompts: string;
  segment_lengths: string;
  guide_strength: string;
}

interface ImageSegment {
  id: string;
  start: number;
  length: number;
  type: "image";
  imageFile: string;
  isEndFrame: boolean;
  prompt: string;
}

export function buildTimelineData(input: TimelineInput): TimelineNodeInputs {
  const duration = Math.max(1, Math.round(input.durationFrames));

  /* --- image guides ---------------------------------------------------
   * The node models a guide as a block [start, start+length) and pins the
   * image at the block's start, or at its last frame when isEndFrame is set.
   * We always want an image at one exact frame, so every segment is a
   * one-frame block with isEndFrame off — an "end frame" is just a keyframe
   * at duration-1. That keeps insert_frame == atFrame for every case,
   * including the last frame, with no block arithmetic to get wrong.
   *
   * Order matters twice over: the node sorts segments by start and then
   * indexes guide_strength positionally, so the strengths string has to be
   * built from the SAME sorted order, not authoring order. */
  const keyframes = [...(input.keyframes ?? [])]
    .filter((k) => k.atFrame < duration)
    .sort((a, b) => a.atFrame - b.atFrame);

  const segments: ImageSegment[] = keyframes.map((k, i) => ({
    id: `kf${i}`,
    start: clamp(Math.round(k.atFrame), 0, duration - 1),
    length: 1,
    type: "image",
    imageFile: k.file,
    isEndFrame: false,
    prompt: "",
  }));
  const guide_strength = keyframes.map((k) => round3(clamp(k.strength, 0, 1))).join(", ");

  /* --- prompt zones ---------------------------------------------------
   * "a|b|c" with a matching comma list of pixel-frame lengths. The node
   * raises if the counts disagree, and an empty local_prompts makes it fall
   * back to the global prompt alone — which is exactly what a keyframes-only
   * shot wants, so we emit empty strings rather than a single fake zone. */
  const zones = fitZones(
    (input.promptZones ?? []).filter((z) => z.prompt.trim().length > 0),
    duration,
  );
  const local_prompts = zones.map((z) => z.prompt.replace(/\|/g, "/").trim()).join("|");
  const segment_lengths = zones.map((z) => z.lengthFrames).join(", ");

  const timeline = {
    global_prompt: input.globalPrompt,
    segments,
    audioSegments: fitAudio(input.audio ?? [], duration),
    motionSegments: (input.motion ?? []).map((m) => ({
      videoFile: m.file,
      start: Math.max(0, Math.round(m.atFrame)),
      length: Math.max(1, Math.round(m.lengthFrames)),
      trimStart: 0,
    })),
    ...retakeFields(input.retake),
  };

  return {
    timeline_data: JSON.stringify(timeline),
    local_prompts,
    segment_lengths,
    guide_strength,
  };
}

/** Zones tile the clip in order, and prompts must stay in lockstep with
 * lengths — the node raises outright if the two counts disagree. So a zone
 * that starts past the end of the clip is dropped WITH its prompt, and the
 * last surviving zone is stretched to the boundary: the lengths then sum to
 * exactly the clip instead of being silently clamped, which would otherwise
 * show up as a final beat that never arrives. */
function fitZones(zones: TimelinePromptZone[], duration: number): TimelinePromptZone[] {
  const fitted: TimelinePromptZone[] = [];
  let cursor = 0;
  for (const zone of zones) {
    if (cursor >= duration) break;
    const lengthFrames = Math.min(Math.max(1, Math.round(zone.lengthFrames)), duration - cursor);
    fitted.push({ prompt: zone.prompt, lengthFrames });
    cursor += lengthFrames;
  }
  if (fitted.length === 0) return [];
  if (cursor < duration) fitted[fitted.length - 1].lengthFrames += duration - cursor;
  return fitted;
}

/** Voice takes are laid onto the shot's own waveform: the node decodes each
 * file, cuts [trimStart, trimStart+length) out of it, and ADDS that at `start`
 * — so two takes that overlap are heard together rather than one replacing the
 * other, and a take running past the end is truncated.
 *
 * We do that truncation here instead of leaving it to the node, because the
 * same numbers drive the audio noise mask: the mask is 0 wherever a take sits
 * (locked, so it drives lip-sync) and 1 in the gaps (LTX scores those itself
 * when inpaint_audio is on). A segment claiming length past the end of the
 * shot would mask frames that don't exist, and the timeline we hand back would
 * no longer describe what the user hears. A take that starts at or after the
 * end is dropped outright — it has nowhere to land. */
function fitAudio(audio: TimelineAudioSegment[], duration: number) {
  const fitted = [];
  for (const a of audio) {
    const start = Math.max(0, Math.round(a.atFrame));
    if (start >= duration) continue;
    const length = Math.min(Math.max(1, Math.round(a.lengthFrames)), duration - start);
    fitted.push({
      audioFile: a.file,
      start,
      length,
      trimStart: Math.max(0, Math.round(a.trimStartFrames ?? 0)),
    });
  }
  return fitted;
}

function retakeFields(retake: TimelineRetake | undefined) {
  if (!retake) return { retakeMode: false };
  return {
    retakeMode: true,
    retakeStart: Math.max(0, Math.round(retake.atFrame)),
    retakeLength: Math.max(1, Math.round(retake.lengthFrames)),
    retakePrompt: retake.prompt,
    retakeStrength: retake.strength ?? 1,
    retake_global_prompt: "",
    retakeVideo: {
      fileName: retake.file.split("/").pop() ?? retake.file,
      imageFile: retake.file,
      videoDurationFrames: Math.max(1, Math.round(retake.sourceDurationFrames)),
    },
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;
