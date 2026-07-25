/* The Director graph — the same two-stage LTX 2.3 render as the shipped
 * template, with a timeline in front of it.
 *
 * Everything that decides how the picture looks is copied verbatim from
 * ltx23-template.ts: the sigma schedules, cfg 1, the distilled LoRA at 0.5,
 * the ×2 spatial upscaler, tiled decode. What changes is where the
 * conditioning comes from — an LTXDirector node that turns a timeline into
 * keyframe guides, per-beat prompts and an audio latent with a per-segment
 * noise mask.
 *
 * Built in code rather than shipped as an exported blob because the graph
 * varies with the shot (motion track on/off, retake mode, tuning); a frozen
 * template would fight that. Wiring follows the "LTX Director CS" reference
 * workflow, adjusted for the non-CS node surface actually installed:
 * LTXDirector has 8 outputs and no `negative`, so the negative conditioning
 * comes from a plain CLIPTextEncode the way the stock template does it. */

import type { ComfyGraph } from "./client.js";
import { NO_TUNING, applyTuning, type RenderTuning } from "./tuning.js";
import type { LtxModelNames } from "./video-graphs.js";
import type { TimelineNodeInputs } from "./director-timeline.js";

/** loader names an external ComfyUI carries — the ones the proven template
 * hardcodes, so a stock install needs no configuration */
export const LTX23_EXTERNAL: LtxModelNames = {
  checkpoint: "ltx-2.3-22b-dev-fp8.safetensors",
  distillLora: "ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors",
  textEncoder: "gemma_3_12B_it_fp4_mixed.safetensors",
  upscaler: "ltx-2.3-spatial-upscaler-x2-1.1.safetensors",
};

/** base pass: 8 steps down the distilled schedule */
const SIGMAS_BASE = "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0";
/** refine pass over the upscaled latent */
const SIGMAS_REFINE = "0.85, 0.7250, 0.4219, 0.0";
/** the distilled LoRA is trained for cfg 1 — raising it burns the image */
const CFG = 1;
const DISTILL_STRENGTH = 0.5;
/** H.264 CRF applied to each guide image: a pristine frame makes LTX lock to
 * it too hard and stop moving. The Director node's own default. */
const GUIDE_COMPRESSION = 18;
/** the base pass runs at half resolution, the refine at full */
const BASE_SCALE = 0.5;
/** the relay paper's default — a hard boundary between prompt beats */
const EPSILON_DEFAULT = 0.001;

/** the node declares min 0.0001 / max 0.99 and ComfyUI rejects the graph
 * outside that, so a bad slider value fails here rather than at queue time */
const clampEpsilon = (e: number | undefined) =>
  e === undefined || !Number.isFinite(e) ? EPSILON_DEFAULT : Math.min(0.99, Math.max(0.0001, e));

/** node ids — stable, readable, and namespaced so tuning can splice safely */
const ID = {
  ckpt: "ckpt",
  textEncoder: "text_encoder",
  audioVae: "audio_vae",
  upscaler: "upscaler",
  lora: "distill_lora",
  director: "director",
  negative: "negative",
  conditioning: "conditioning",
  guide1: "guide_base",
  concat1: "concat_base",
  guider1: "guider_base",
  sampler1: "sampler_base",
  ksampler1: "ksampler_base",
  sigmas1: "sigmas_base",
  noise1: "noise_base",
  split1: "split_base",
  crop1: "crop_base",
  upsample: "upsample",
  guide2: "guide_refine",
  concat2: "concat_refine",
  guider2: "guider_refine",
  sampler2: "sampler_refine",
  ksampler2: "ksampler_refine",
  sigmas2: "sigmas_refine",
  noise2: "noise_refine",
  split2: "split_refine",
  crop2: "crop_refine",
  decodeVideo: "decode_video",
  decodeAudio: "decode_audio",
  createVideo: "create_video",
  save: "save",
} as const;

/** LTXDirector output slots. Verified against the pack at v2.0.4, which left
 * them untouched — cast references arrived as a new kind of segment on the
 * existing IC-LoRA track rather than as new node surface. */
const OUT = {
  model: 0,
  positive: 1,
  videoLatent: 2,
  audioLatent: 3,
  guideData: 4,
  motionGuideData: 5,
  frameRate: 6,
  combinedAudio: 7,
} as const;

/** LTXDirectorGuide output slots */
const GUIDE_OUT = { positive: 0, negative: 1, latent: 2, model: 3 } as const;

export interface DirectorGraphSpec {
  timeline: TimelineNodeInputs;
  negativePrompt: string;
  fps: number;
  /** already snapped to 8n+1 */
  durationFrames: number;
  /** already snapped to ÷32 */
  width: number;
  height: number;
  seed: number;
  /** prompt-zone boundary softness. The relay builds a gaussian window whose
   * sigma is 1/ln(1/epsilon), so 0.001 is a hard cut between beats and 0.5 a
   * long dissolve. Ignored when the shot has no prompt zones. */
  epsilon?: number;
  /** the shot has voice takes on its audio lane */
  hasCustomAudio: boolean;
  /** fill the gaps between takes with generated sound */
  inpaintAudio: boolean;
  /** the shot has something on its IC-LoRA track — a motion reference whose
   * movement is transferred, or a cast sheet whose subjects are. The node reads
   * both from `motionSegments` and tells them apart by file extension, so one
   * flag turns the track on for either. */
  hasIcLoraTrack: boolean;
  /** IC-LoRA carrying that track — motion-track / union-control for movement,
   * ingredients for a cast sheet; "None" disables it. There is one slot, so a
   * shot gets one or the other. Must be a name the running ComfyUI offers for
   * LTXDirectorGuide.ic_lora_name — see resolveIcLora(), which is why this is a
   * resolved string and not a kind. */
  icLora?: string;
  /** weight the IC-LoRA is loaded at (1 = as trained). Distinct from the
   * per-segment motion strength, which rides in timeline_data. */
  icLoraStrength?: number;
  /** take the audio from the motion reference instead of the audio lane */
  overrideAudio?: boolean;
  /** the shot is a retake: an existing take with one window re-rendered. The
   * guide nodes auto-detect it from timeline_data, but saying so explicitly
   * keeps a hand-built timeline from silently rendering as a fresh shot. */
  isRetake?: boolean;
  /** how a keyframe whose aspect doesn't match the shot is fitted. "crop"
   * fills the frame without distorting faces, which is almost always what a
   * shot wants; "stretch to fit" is there for deliberate effect. */
  resizeMethod?: "crop" | "maintain aspect ratio" | "stretch to fit" | "pad";
  /** managed loader names; null = the external install's conventional ones */
  models: LtxModelNames | null;
  tuning?: RenderTuning;
  /** where SaveVideo writes inside ComfyUI's output tree */
  filenamePrefix?: string;
}

export function directorGraph(spec: DirectorGraphSpec): ComfyGraph {
  const m = spec.models ?? LTX23_EXTERNAL;
  const seconds = spec.durationFrames / spec.fps;
  const link = (id: string, slot = 0): [string, number] => [id, slot];
  const graph: ComfyGraph = {};
  const node = (id: string, class_type: string, inputs: Record<string, unknown>) => {
    graph[id] = { class_type, inputs };
  };

  /* ---------- loaders ---------- */
  node(ID.ckpt, "CheckpointLoaderSimple", { ckpt_name: m.checkpoint });
  node(ID.textEncoder, "LTXAVTextEncoderLoader", {
    ckpt_name: m.checkpoint,
    text_encoder: m.textEncoder,
    device: "default",
  });
  node(ID.audioVae, "LTXVAudioVAELoader", { ckpt_name: m.checkpoint });
  node(ID.upscaler, "LatentUpscaleModelLoader", { model_name: m.upscaler });
  node(ID.lora, "LoraLoaderModelOnly", {
    lora_name: m.distillLora,
    strength_model: DISTILL_STRENGTH,
    model: link(ID.ckpt, 0),
  });

  /* ---------- the timeline ----------
   * global_prompt is left empty on purpose: the node falls back to the one
   * inside timeline_data, which is where our builder already put it, and the
   * input is declared force_input so a literal would be the odd path. */
  node(ID.director, "LTXDirector", {
    model: link(ID.lora, 0),
    clip: link(ID.textEncoder, 0),
    audio_vae: link(ID.audioVae, 0),
    global_prompt: "",
    start_second: 0,
    end_second: seconds,
    duration_seconds: seconds,
    start_frame: 0,
    end_frame: spec.durationFrames,
    duration_frames: spec.durationFrames,
    timeline_data: spec.timeline.timeline_data,
    local_prompts: spec.timeline.local_prompts,
    segment_lengths: spec.timeline.segment_lengths,
    guide_strength: spec.timeline.guide_strength,
    epsilon: clampEpsilon(spec.epsilon),
    frame_rate: spec.fps,
    display_mode: "frames",
    custom_width: spec.width,
    custom_height: spec.height,
    resize_method: spec.resizeMethod ?? "crop",
    divisible_by: 32,
    img_compression: GUIDE_COMPRESSION,
    use_custom_audio: spec.hasCustomAudio,
    inpaint_audio: spec.inpaintAudio,
    use_custom_motion: spec.hasIcLoraTrack,
    // lifts the motion reference's own audio onto the shot — the node then
    // reads the motion segments as the audio track and masks to match
    override_audio: !!spec.overrideAudio,
  });

  node(ID.negative, "CLIPTextEncode", {
    text: spec.negativePrompt,
    clip: link(ID.textEncoder, 0),
  });
  node(ID.conditioning, "LTXVConditioning", {
    positive: link(ID.director, OUT.positive),
    negative: link(ID.negative, 0),
    frame_rate: spec.fps,
  });

  /* ---------- stage 1 · base pass at half resolution ---------- */
  guideNode(ID.guide1, {
    positive: link(ID.conditioning, 0),
    negative: link(ID.conditioning, 1),
    latent: link(ID.director, OUT.videoLatent),
    scale_by: BASE_SCALE,
  });
  node(ID.concat1, "LTXVConcatAVLatent", {
    video_latent: link(ID.guide1, GUIDE_OUT.latent),
    audio_latent: link(ID.director, OUT.audioLatent),
  });
  samplerChain(1, ID.guide1, ID.concat1, SIGMAS_BASE, spec.seed);
  node(ID.crop1, "LTXDirectorCropGuides", {
    positive: link(ID.guide1, GUIDE_OUT.positive),
    negative: link(ID.guide1, GUIDE_OUT.negative),
    latent: link(ID.split1, 0),
  });

  /* ---------- stage 2 · refine over the upscaled latent ----------
   * the guides are re-inserted at full resolution (the reference workflow
   * does this too) so the keyframes survive the upscale */
  node(ID.upsample, "LTXVLatentUpsampler", {
    samples: link(ID.crop1, 2),
    upscale_model: link(ID.upscaler, 0),
    vae: link(ID.ckpt, 2),
  });
  guideNode(ID.guide2, {
    positive: link(ID.conditioning, 0),
    negative: link(ID.conditioning, 1),
    latent: link(ID.upsample, 0),
    scale_by: 1,
  });
  node(ID.concat2, "LTXVConcatAVLatent", {
    video_latent: link(ID.guide2, GUIDE_OUT.latent),
    audio_latent: link(ID.split1, 1),
  });
  samplerChain(2, ID.guide2, ID.concat2, SIGMAS_REFINE, spec.seed);
  node(ID.crop2, "LTXDirectorCropGuides", {
    positive: link(ID.guide2, GUIDE_OUT.positive),
    negative: link(ID.guide2, GUIDE_OUT.negative),
    latent: link(ID.split2, 0),
  });

  /* ---------- decode ---------- */
  node(ID.decodeVideo, "VAEDecodeTiled", {
    samples: link(ID.crop2, 2),
    vae: link(ID.ckpt, 2),
    tile_size: 768,
    overlap: 64,
    temporal_size: 4096,
    temporal_overlap: 4,
  });
  node(ID.decodeAudio, "LTXVAudioVAEDecode", {
    samples: link(ID.split2, 1),
    audio_vae: link(ID.audioVae, 0),
  });
  node(ID.createVideo, "CreateVideo", {
    images: link(ID.decodeVideo, 0),
    audio: link(ID.decodeAudio, 0),
    fps: spec.fps,
    bit_depth: 8,
  });
  node(ID.save, "SaveVideo", {
    video: link(ID.createVideo, 0),
    filename_prefix: spec.filenamePrefix ?? "aurea/shot",
    format: "auto",
    codec: "auto",
  });

  applyTuning(graph, spec.tuning ?? NO_TUNING, {
    // the Director hands out an already-patched model (prompt relay), so the
    // tuning splices in after it rather than after the LoRA
    source: [ID.director, OUT.model],
    consumers: [
      [ID.guide1, "model"],
      [ID.guide2, "model"],
    ],
    negative: [ID.negative, 0],
    baseSampler: ID.ksampler1,
    refineSampler: ID.ksampler2,
  });

  return graph;

  /* ---------- helpers ---------- */

  function guideNode(
    id: string,
    args: {
      positive: [string, number];
      negative: [string, number];
      latent: [string, number];
      scale_by: number;
    },
  ) {
    node(id, "LTXDirectorGuide", {
      ...args,
      vae: link(ID.ckpt, 2),
      guide_data: link(ID.director, OUT.guideData),
      motion_guide_data: link(ID.director, OUT.motionGuideData),
      model: link(ID.director, OUT.model),
      ic_lora_name: spec.hasIcLoraTrack ? (spec.icLora ?? "None") : "None",
      ic_lora_strength: spec.icLoraStrength ?? 1,
      upscale_method: "bicubic",
      image_attention_strength: 1,
      crop: "center",
      auto_snap_ic_grid: true,
      use_tiled_encode: false,
      tile_size: 256,
      tile_overlap: 64,
      retake_mode: !!spec.isRetake, // also auto-detected from timeline_data
    });
  }

  /** noise → guider → sampler for one pass; both passes share a seed so a
   * re-render with the same spec is reproducible */
  function samplerChain(
    pass: 1 | 2,
    guideId: string,
    latentId: string,
    sigmas: string,
    seed: number,
  ) {
    const ids =
      pass === 1
        ? { noise: ID.noise1, guider: ID.guider1, ks: ID.ksampler1, sig: ID.sigmas1, s: ID.sampler1, split: ID.split1 }
        : { noise: ID.noise2, guider: ID.guider2, ks: ID.ksampler2, sig: ID.sigmas2, s: ID.sampler2, split: ID.split2 };
    node(ids.noise, "RandomNoise", { noise_seed: seed });
    node(ids.ks, "KSamplerSelect", { sampler_name: "euler" });
    node(ids.sig, "ManualSigmas", { sigmas });
    node(ids.guider, "CFGGuider", {
      model: link(guideId, GUIDE_OUT.model),
      positive: link(guideId, GUIDE_OUT.positive),
      negative: link(guideId, GUIDE_OUT.negative),
      cfg: CFG,
    });
    node(ids.s, "SamplerCustomAdvanced", {
      noise: link(ids.noise, 0),
      guider: link(ids.guider, 0),
      sampler: link(ids.ks, 0),
      sigmas: link(ids.sig, 0),
      latent_image: link(latentId, 0),
    });
    node(ids.split, "LTXVSeparateAVLatent", { av_latent: link(ids.s, 0) });
  }
}
