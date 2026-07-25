/* Render tuning — optional model-level changes that apply to every LTX graph
 * we build, kept in one place so the proven template and the Director graph
 * can't drift apart. All of them need comfyui-kjnodes; callers gate on
 * VideoCapabilities.perfPatches before passing them through.
 *
 *   chunkFeedForward — splits each transformer block's feed-forward into N
 *       chunks. Pure torch, no extra dependencies. Benchmarked 2026-07-25 on
 *       a 3090 Ti: neutral on a small shot, ~23% FASTER on a large one (see
 *       videofast/docs/PRODUCTION-PIPELINE.md), presumably because it stops
 *       large activations thrashing an allocator already at 23/24 GB. The one
 *       knob that earns its default-on.
 *   sageAttention — INT8 attention kernels. The node raises at execute time
 *       unless `sageattention` is installed in ComfyUI's python; D:\.venv has
 *       neither it nor triton, so this is unproven here and stays off behind
 *       an install hint.
 *   sampler — "euler" is what the shipped template has always used; "cfg_pp"
 *       runs an ancestral base pass and a cfg++ refine, the pairing the
 *       official 2.3 workflows moved to. Measurably slower (it does more
 *       work), so its case is picture quality — judge it by eye, not clock.
 *   nag — normalized attention guidance, which gives the negative prompt
 *       teeth at cfg 1, where classifier-free guidance does nothing. Costs a
 *       ~15s patch step per render.
 *
 * NO_TUNING below is the "change nothing" baseline used when a caller passes
 * no tuning at all — distinct from the SETTINGS default (see
 * settings.engines.videoTuning), where chunkFeedForward is on. */

import type { ComfyGraph } from "./client.js";

export interface RenderTuning {
  chunkFeedForward: boolean;
  sageAttention: boolean;
  sampler: "euler" | "cfg_pp";
  nag: boolean;
}

export const NO_TUNING: RenderTuning = {
  chunkFeedForward: false,
  sageAttention: false,
  sampler: "euler",
  nag: false,
};

/** NAG's published defaults (KJNodes LTX2_NAG) */
const NAG_SCALE = 11;
const NAG_ALPHA = 0.25;
const NAG_TAU = 2.5;
/** feed-forward chunking: 4 chunks over blocks wider than 4096 */
const FF_CHUNKS = 4;
const FF_DIM_THRESHOLD = 4096;

/** Where in a graph the tuning attaches. Ids are graph-specific, so each
 * builder describes its own model chain rather than hard-coding node names. */
export interface TuningAnchors {
  /** MODEL output the chain is spliced in after — usually the distilled LoRA */
  source: [string, number];
  /** [nodeId, inputName] pairs repointed at the tuned model. Anything left
   * out keeps the untuned model — the Gemma prompt-enhance branch wants the
   * plain one, since it is doing text generation, not diffusion. */
  consumers: Array<[string, string]>;
  /** negative conditioning feeding NAG; without it NAG is skipped */
  negative?: [string, number];
  /** KSamplerSelect node of the low-res base pass */
  baseSampler?: string;
  /** KSamplerSelect node of the high-res refine pass */
  refineSampler?: string;
}

/** Mutates `graph` in place. With an all-off tuning it does nothing and leaves
 * the graph byte-identical — which is what keeps the default render path
 * exactly as verified. */
export function applyTuning(graph: ComfyGraph, tuning: RenderTuning, anchors: TuningAnchors): void {
  if (tuning.sampler === "cfg_pp") {
    // ancestral on the base pass adds motion/detail variance; cfg++ sharpens
    // the refine without raising cfg above 1 (the distilled LoRA's rule)
    setSampler(graph, anchors.baseSampler, "euler_ancestral_cfg_pp");
    setSampler(graph, anchors.refineSampler, "euler_cfg_pp");
  }

  let model = anchors.source;
  const add = (id: string, class_type: string, inputs: Record<string, unknown>) => {
    graph[id] = { class_type, inputs: { ...inputs, model } };
    model = [id, 0];
  };

  if (tuning.sageAttention) {
    add("aurea:sage", "PathchSageAttentionKJ", { sage_attention: "auto", allow_compile: false });
    add("aurea:sage_mem", "LTX2MemoryEfficientSageAttentionPatch", { triton_kernels: false });
  }
  if (tuning.chunkFeedForward) {
    add("aurea:chunk_ff", "LTXVChunkFeedForward", {
      chunks: FF_CHUNKS,
      dim_threshold: FF_DIM_THRESHOLD,
    });
  }
  if (tuning.nag && anchors.negative) {
    add("aurea:nag", "LTX2_NAG", {
      nag_scale: NAG_SCALE,
      nag_alpha: NAG_ALPHA,
      nag_tau: NAG_TAU,
      nag_cond_video: anchors.negative,
      nag_cond_audio: anchors.negative,
      inplace: true,
    });
  }

  if (model === anchors.source) return; // nothing spliced in
  for (const [nodeId, inputName] of anchors.consumers) {
    if (graph[nodeId]) graph[nodeId].inputs[inputName] = model;
  }
}

function setSampler(graph: ComfyGraph, nodeId: string | undefined, name: string): void {
  if (nodeId && graph[nodeId]) graph[nodeId].inputs.sampler_name = name;
}
