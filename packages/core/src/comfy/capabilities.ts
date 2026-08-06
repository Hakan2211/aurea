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

/* --- adapter LoRAs (regular model LoRAs, not IC) --------------------------
 * Everything in the LoraLoaderModelOnly combo that is NOT plumbing: the
 * distilled LoRA is the pipeline itself, IC-LoRAs ride the guide track, and
 * the Gemma LoRA belongs to the prompt-enhance branch. What is left is what a
 * user may stack on the model — style/subject adapters, and (when Lightricks
 * ships 22b versions) the camera-control set. */
const INFRA_LORA = /ic-lora|distilled|gemma/i;

/** camera-control LoRAs, keyed by move. As of 2026-08 Lightricks has only
 * published these for the 19b base model — a 19b LoRA does not load on the
 * 22b 2.3 transformer, so this probe is expected to find nothing today. The
 * moment compatible weights land in the lora folder, the moves light up. */
export const CAMERA_MOVES = [
  "dolly-in",
  "dolly-out",
  "dolly-left",
  "dolly-right",
  "jib-up",
  "jib-down",
  "static",
] as const;
export type CameraMove = (typeof CAMERA_MOVES)[number];
const CAMERA_LORA_MARKER: Record<CameraMove, RegExp> = {
  "dolly-in": /camera.control.dolly.in(?!.*out)/i,
  "dolly-out": /camera.control.dolly.out/i,
  "dolly-left": /camera.control.dolly.left/i,
  "dolly-right": /camera.control.dolly.right/i,
  "jib-up": /camera.control.jib.up/i,
  "jib-down": /camera.control.jib.down/i,
  static: /camera.control.static/i,
};

/** which camera moves this install has weights for (usually {} — see above) */
export function resolveCameraLoras(loraOptions: string[]): Partial<Record<CameraMove, string>> {
  const found: Partial<Record<CameraMove, string>> = {};
  for (const move of CAMERA_MOVES) {
    const hit = loraOptions.find((o) => CAMERA_LORA_MARKER[move].test(o));
    if (hit) found[move] = hit;
  }
  return found;
}

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
  /** end-frame / mid-shot keyframe guides (core LTXVAddGuide path) */
  endFrame: boolean;
  /** stackable adapter LoRAs the user may pick from (infra filtered out) */
  availableLoras: string[];
  /** camera-control weights present, by move — see resolveCameraLoras */
  cameraLoras: Partial<Record<CameraMove, string>>;
  /** one line for the UI when something is missing */
  note?: string;
}

const NONE = {
  director: false,
  perfPatches: false,
  nag: false,
  multiRef: false,
  icLora: false,
  endFrame: false,
  availableLoras: [] as string[],
  cameraLoras: {} as Partial<Record<CameraMove, string>>,
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

  const [director, perfPatches, nag, refTrack, loras, endFrame] = await Promise.all([
    client.hasNodes(DIRECTOR_NODES),
    client.hasNodes(PERF_NODES),
    client.hasNodes(NAG_NODES),
    hasRefTrack(client),
    client.comboOptions("LoraLoaderModelOnly", "lora_name"),
    // core LTX nodes — present on any install with the LTX pipeline at all,
    // but probed rather than assumed so a stripped install degrades politely
    client.hasNodes(["LTXVAddGuide", "LTXVCropGuides"]),
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
    endFrame,
    availableLoras: loras.filter((l) => !INFRA_LORA.test(l)),
    cameraLoras: resolveCameraLoras(loras),
  };

  const missing: string[] = [];
  if (!director) missing.push("WhatDreamsCost-ComfyUI (Director timeline)");
  if (!endFrame) missing.push("core LTX video nodes (end-frame guides)");
  if (!perfPatches) missing.push("comfyui-kjnodes (attention patches)");
  // only worth mentioning to someone who has the Director at all
  if (director && !refTrack) missing.push("WhatDreamsCost-ComfyUI v2.0.4+ (cast references)");
  if (director && !hasIngredients) missing.push("the LTX Ingredients IC-LoRA");
  if (missing.length) capabilities.note = `Not installed: ${missing.join(", ")}.`;

  return capabilities;
}

/* --- the MiniMax-H3 instance ------------------------------------------------
 * H3 runs on its OWN ComfyUI (0.30+) — a separate install with a separate
 * python, so nothing probed above says anything about it. The only optional
 * capability there today is SageAttention, which the KJ patch node provides
 * and which roughly doubles H3's render speed when the `sageattention`
 * package is installed in THAT python. */

export interface MinimaxCapabilities {
  /** the H3 ComfyUI answered the probe */
  reachable: boolean;
  /** the KJ Sage patch node is present — the speed toggle can be offered */
  sage: boolean;
  note?: string;
}

export async function probeMinimaxCapabilities(url: string): Promise<MinimaxCapabilities> {
  if (!url.trim()) {
    return {
      reachable: false,
      sage: false,
      note: "No MiniMax-H3 ComfyUI configured — set its URL in Settings → Engines.",
    };
  }
  const client = new ComfyClient(url);
  if (!(await client.health())) {
    return { reachable: false, sage: false, note: `No ComfyUI answering at ${url}.` };
  }
  const sage = await client.hasNode("PathchSageAttentionKJ");
  return {
    reachable: true,
    sage,
    note: sage
      ? undefined
      : "comfyui-kjnodes is not installed on the MiniMax ComfyUI — the Sage speed toggle needs it.",
  };
}
