/* What can this ComfyUI actually do?
 *
 * The LTX 2.3 surface Aurea drives is spread across custom node packs the user
 * may or may not have: the WhatDreamsCost Director (timeline keyframes, prompt
 * relay, an audio track), KJNodes' attention patches, and — for multi-subject
 * references — a Director pack new enough to put stills on its IC-LoRA track
 * plus the LTX Ingredients IC-LoRA. Rather than guess, or fail deep inside a
 * queued render, every feature is gated on a probe: /object_info/<class> for
 * nodes, a combo list for weights, an output name for a pack version.
 *
 * Probes are passive. They never boot the managed sidecar (see
 * ComfyService.idleUrl) — a cold managed engine reports "unknown, not
 * reachable" and the UI says so. */

import { ComfyClient } from "./client.js";

/** the Director timeline stack — keyframes, prompt zones, audio track */
export const DIRECTOR_NODES = ["LTXDirector", "LTXDirectorGuide", "LTXDirectorCropGuides"];
/** KJNodes attention/memory patches, applied after the distilled LoRA */
export const PERF_NODES = [
  "PathchSageAttentionKJ",
  "LTX2MemoryEfficientSageAttentionPatch",
  "LTX2AttentionTunerPatch",
  "LTXVChunkFeedForward",
];
/** normalized attention guidance — negative prompting that bites at cfg 1 */
export const NAG_NODES = ["LTX2_NAG"];

/* --- how the multi-subject probe works, and why it looks like this ----------
 * Multi-subject reference was planned around a "CS" fork of the Director plus
 * Licon's MSR LoRA. That fork never shipped. What shipped instead (pack v2.0.4,
 * 2026-07-14) is reference support through the LTX **Ingredients** IC-LoRA: a
 * still dropped on the IC-LoRA track is repeated into a guide, and the model
 * reads the subjects out of it. The pack's author says outright he tried MSR and
 * BFS first and found Ingredients the most stable, so this is the supported path
 * rather than a substitute for one.
 *
 * It needs two things, probed separately so the UI can say which is missing:
 *   1. a pack that accepts a still on that track — python decides by file
 *      extension, so an older pack silently treats the png as a video and dies
 *      in ffmpeg. There's no version endpoint; the marker is the `filename`
 *      output v2.0.4 added to LoadVideoUI, which lands in the same commit.
 *   2. the ingredients weight itself, which is a gated download. */
const REF_PACK_MARKER = { node: "LoadVideoUI", output: "filename" } as const;

/** Drop any tuning this ComfyUI can't actually execute. The chunked
 * feed-forward default in particular must not turn a working install into a
 * failing one just because it lacks KJNodes — an unavailable performance
 * default is a no-op, not an error. SageAttention is left alone on purpose:
 * it is never a default, so a user who turned it on deserves to hear that the
 * python package is missing rather than have it silently ignored. */
export async function resolveTuning<T extends { chunkFeedForward: boolean; nag: boolean }>(
  client: { hasNode(classType: string): Promise<boolean> },
  tuning: T,
): Promise<T> {
  const [chunk, nag] = await Promise.all([
    tuning.chunkFeedForward ? client.hasNode("LTXVChunkFeedForward") : Promise.resolve(false),
    tuning.nag ? client.hasNode("LTX2_NAG") : Promise.resolve(false),
  ]);
  return { ...tuning, chunkFeedForward: chunk, nag };
}

/** the Ingredients IC-LoRA — subjects, props and settings read off a sheet */
const INGREDIENTS_LORA = /ic-lora.*ingredient/i;
/** the IC-LoRAs that carry motion onto a keyframe */
const IC_LORA = /ic-lora.*(union-control|motion-track)/i;

/** which behaviour each IC-LoRA carries: `union` control follows the reference
 * loosely (a whole scene's staging), `motionTrack` tracks its movement closely
 * (a dance, a specific gesture) */
export type IcLoraKind = "union" | "motionTrack";
const IC_LORA_MARKER: Record<IcLoraKind, RegExp> = {
  union: /union-control/i,
  motionTrack: /motion-track/i,
};

/** The exact name this ComfyUI wants for an IC-LoRA, or null if it hasn't got
 * one. Asking the node rather than composing a path matters: the options come
 * from a directory walk, so on Windows they arrive with BACKSLASH separators
 * ("ltxv\ltx2\…") and ComfyUI validates a combo input against that list
 * verbatim — a forward-slash guess is rejected before the render starts. */
export async function resolveIcLora(
  client: { comboOptions(classType: string, input: string): Promise<string[]> },
  kind: IcLoraKind,
): Promise<string | null> {
  const options = await client.comboOptions("LTXDirectorGuide", "ic_lora_name");
  const marker = IC_LORA_MARKER[kind];
  return options.find((o) => IC_LORA.test(o) && marker.test(o)) ?? null;
}

/** Same deal for the Ingredients IC-LoRA, which carries reference subjects
 * instead of motion. It occupies the same `ic_lora_name` slot — one IC-LoRA per
 * render — which is why a shot can reference the cast or transfer motion, but
 * not both at once. */
export async function resolveIngredientsLora(client: {
  comboOptions(classType: string, input: string): Promise<string[]>;
}): Promise<string | null> {
  const options = await client.comboOptions("LTXDirectorGuide", "ic_lora_name");
  return options.find((o) => INGREDIENTS_LORA.test(o)) ?? null;
}

/** Does this Director pack accept a still on its IC-LoRA track? (see
 * REF_PACK_MARKER — an added output stands in for a version number) */
export async function hasRefTrack(client: {
  outputNames(classType: string): Promise<string[]>;
}): Promise<boolean> {
  const names = await client.outputNames(REF_PACK_MARKER.node);
  return names.includes(REF_PACK_MARKER.output);
}

export interface VideoCapabilities {
  mode: "managed" | "external";
  /** a ComfyUI answered the probe — everything below is meaningless if false */
  reachable: boolean;
  /** timeline renders: keyframes, prompt zones, audio track, motion, retake */
  director: boolean;
  /** SageAttention + chunked feed-forward + attention tuner */
  perfPatches: boolean;
  nag: boolean;
  /** cast references off a sheet: a pack that takes stills on the IC-LoRA
   * track AND the Ingredients IC-LoRA */
  multiRef: boolean;
  /** motion transfer weights are present */
  icLora: boolean;
  /** one line for the UI when something is missing */
  note?: string;
}

const NONE = {
  director: false,
  perfPatches: false,
  nag: false,
  multiRef: false,
  icLora: false,
} as const;

export async function probeVideoCapabilities(
  url: string | null,
  mode: "managed" | "external",
): Promise<VideoCapabilities> {
  if (!url) {
    return {
      mode,
      reachable: false,
      ...NONE,
      note:
        mode === "managed"
          ? "The managed engine is asleep — start a render, or switch Settings → Engines → Video to external to see what your ComfyUI supports."
          : "ComfyUI is not reachable — start it to enable Director mode.",
    };
  }

  const client = new ComfyClient(url);
  if (!(await client.health())) {
    return {
      mode,
      reachable: false,
      ...NONE,
      note: `No ComfyUI answering at ${url}.`,
    };
  }

  const [director, perfPatches, nag, refTrack, loras] = await Promise.all([
    client.hasNodes(DIRECTOR_NODES),
    client.hasNodes(PERF_NODES),
    client.hasNodes(NAG_NODES),
    hasRefTrack(client),
    client.comboOptions("LoraLoaderModelOnly", "lora_name"),
  ]);

  const hasIngredients = loras.some((l) => INGREDIENTS_LORA.test(l));
  const capabilities: VideoCapabilities = {
    mode,
    reachable: true,
    director,
    perfPatches,
    nag,
    multiRef: refTrack && hasIngredients,
    icLora: loras.some((l) => IC_LORA.test(l)),
  };

  const missing: string[] = [];
  if (!director) missing.push("WhatDreamsCost-ComfyUI (Director timeline)");
  if (!perfPatches) missing.push("comfyui-kjnodes (attention patches)");
  // only worth mentioning to someone who has the Director at all
  if (director && !refTrack) missing.push("WhatDreamsCost-ComfyUI v2.0.4+ (cast references)");
  if (director && !hasIngredients) missing.push("the LTX Ingredients IC-LoRA");
  if (missing.length) capabilities.note = `Not installed: ${missing.join(", ")}.`;

  return capabilities;
}
