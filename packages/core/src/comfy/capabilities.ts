/* What can this ComfyUI actually do?
 *
 * The LTX 2.3 surface Aurea drives is spread across custom node packs the user
 * may or may not have: the WhatDreamsCost Director (timeline keyframes, prompt
 * relay, an audio track), KJNodes' attention patches, and — for multi-subject
 * @char references — a newer "CS" fork plus the Licon MSR LoRA. Rather than
 * guess, or fail deep inside a queued render, every feature is gated on a
 * probe: /object_info/<class> for nodes, a combo list for weights.
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
/** the CS fork's additions, needed for multi-subject reference */
export const MULTIREF_NODES = ["LTXDirectorCS", "CleanLatentSliceCS"];

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

/** Licon Multiple-Subject-Reference LoRA, however the user filed it */
const MSR_LORA = /licon.*msr|msr.*licon/i;
/** the IC-LoRAs that carry motion onto a keyframe */
const IC_LORA = /ic-lora.*(union-control|motion-track)/i;

export interface VideoCapabilities {
  mode: "managed" | "external";
  /** a ComfyUI answered the probe — everything below is meaningless if false */
  reachable: boolean;
  /** timeline renders: keyframes, prompt zones, audio track, motion, retake */
  director: boolean;
  /** SageAttention + chunked feed-forward + attention tuner */
  perfPatches: boolean;
  nag: boolean;
  /** @char multi-subject reference: CS nodes AND the MSR LoRA */
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

  const [director, perfPatches, nag, csNodes, loras] = await Promise.all([
    client.hasNodes(DIRECTOR_NODES),
    client.hasNodes(PERF_NODES),
    client.hasNodes(NAG_NODES),
    client.hasNodes(MULTIREF_NODES),
    client.comboOptions("LoraLoaderModelOnly", "lora_name"),
  ]);

  const hasMsr = loras.some((l) => MSR_LORA.test(l));
  const capabilities: VideoCapabilities = {
    mode,
    reachable: true,
    director,
    perfPatches,
    nag,
    multiRef: csNodes && hasMsr,
    icLora: loras.some((l) => IC_LORA.test(l)),
  };

  const missing: string[] = [];
  if (!director) missing.push("WhatDreamsCost-ComfyUI (Director timeline)");
  if (!perfPatches) missing.push("comfyui-kjnodes (attention patches)");
  if (csNodes && !hasMsr) missing.push("the Licon MSR LoRA");
  else if (!csNodes && director) missing.push("the CS node fork (multi-subject refs)");
  if (missing.length) capabilities.note = `Not installed: ${missing.join(", ")}.`;

  return capabilities;
}
