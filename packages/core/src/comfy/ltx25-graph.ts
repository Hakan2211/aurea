/* LTX 2.5 video graph — built node-by-node from the official ComfyUI 0.32
 * "video_ltx2_5_i2v/t2v/flf2v" templates (Comfy-Org/workflow_templates
 * @1956e1c), with the UI plumbing (math nodes, primitives, switches) resolved
 * here in TypeScript instead of in the graph.
 *
 * Differences from the 2.3 pipeline this sits next to (video-graphs.ts):
 *   - the distilled transformer IS the fast model — no distilled LoRA pass
 *   - separate loaders: UNETLoader + CLIPLoader(type ltxv) + 2× VAELoader
 *     replace CheckpointLoaderSimple / LTXAVTextEncoderLoader
 *   - guidance goes through LTXVDualCFGGuider (video_cfg / audio_cfg)
 *   - the soundtrack starts from LTXVEmptyLatentAudio — no staged silent wav.
 *     With a voice take it starts from LTXVAudioVAEEncode instead, noise-masked
 *     to 0 so the audio drives the render (ia2v); 2.3 stages a silent wav and
 *     flips a mask, 2.5 just swaps the source node
 *   - prompt enhancement runs on a small Gemma 4 E2B encoder when that file
 *     is installed, not on a LoRA over the main encoder
 *
 * Shared bones: two-pass base → ×2 latent upscale → refine, ManualSigmas
 * (the 8-step distilled schedule and the 0.85/0.725/0.4219 refine schedule
 * are IDENTICAL to 2.3's), AV concat/separate, LTXVAddGuide/LTXVCropGuides
 * for end frames and mid-shot anchors. */

import path from "node:path";
import type { ComfyGraph } from "./client.js";
import { NO_TUNING, applyTuning, type RenderTuning } from "./tuning.js";

export interface Ltx25ModelNames {
  transformer: string;
  textEncoder: string;
  videoVae: string;
  audioVae: string;
  upscaler: string;
}

const rel = (...parts: string[]) => parts.join(path.sep);

/** registry-relative names (see models/registry.ts ltx-25-22b-int8) */
export const LTX25_MANAGED: Ltx25ModelNames = {
  transformer: rel(
    "ltx-25-22b-int8",
    "diffusion_models",
    "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
  ),
  textEncoder: rel(
    "ltx-25-22b-int8",
    "text_encoders",
    "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
  ),
  videoVae: rel("ltx-25-22b-int8", "vae", "ltx-2.5-video-vae-bf16.safetensors"),
  audioVae: rel("ltx-25-22b-int8", "vae", "ltx-2.5-audio-vae-bf16.safetensors"),
  upscaler: rel(
    "ltx-25-22b-int8",
    "latent_upscale_models",
    "ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors",
  ),
};

/** what a conventional install (or a linked root like D:\models) calls them */
export const LTX25_EXTERNAL: Ltx25ModelNames = {
  transformer: "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
  textEncoder: "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
  videoVae: "ltx-2.5-video-vae-bf16.safetensors",
  audioVae: "ltx-2.5-audio-vae-bf16.safetensors",
  upscaler: "ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors",
};

/** the official template's negative — same wording the 2.3 pipeline uses */
export const LTX25_DEFAULT_NEGATIVE =
  "pc game, console game, video game, cartoon, childish, ugly";

/** the template's sigma schedules (identical strings to 2.3's) */
const BASE_SIGMAS = "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0";
const REFINE_SIGMAS = "0.85, 0.7250, 0.4219, 0.0";

export interface Ltx25GraphSpec {
  prompt: string;
  negative?: string;
  /** staged start frame; omitted = text-to-video (the 2.5 t2v template has no
   * image chain at all — unlike 2.3 there is no bypass switch to trip over) */
  imageName?: string;
  durationSec: number;
  width: number;
  height: number;
  seed: number;
  /** 24 is the template default; frames = duration*fps+1 stays on the 8n+1
   * grid for whole-second durations at 24 and 48 */
  fps?: number;
  /** draft: stop after the base pass — half-size picture, well under half
   * the time (same contract as 2.3's fast flag) */
  fast?: boolean;
  /** staged voice take; omitted = the model scores the shot itself. When set,
   * the take is encoded and locked (noise mask 0) so it drives the render —
   * LTX 2.5's ia2v arm, the 2.5 sibling of 2.3's audio-mask contract. */
  audioName?: string;
  /** staged image the take must land on (frame_idx -1 guide, flf2v-style) */
  endFrameName?: string;
  /** staged mid-shot anchors, imposed at their times (frame_idx snaps to 8) */
  guides?: Array<{ imageName: string; atSec: number; strength: number }>;
  /** adapter LoRAs chained after the transformer — verbatim combo values */
  loras?: Array<{ name: string; strength: number }>;
  models: Ltx25ModelNames;
  /** loader name of the Gemma 4 E2B encoder; null/undefined = feed the raw
   * prompt straight to conditioning (the enhancer is a separate download) */
  enhanceClipName?: string | null;
  /** the same model-chain tuning the 2.3 graphs take (chunked feed-forward,
   * SageAttention, NAG, sampler pairing) — 2.5 keeps the LTX2-family 22B
   * transformer, so the KJNodes patches attach the same way */
  tuning?: RenderTuning;
  filenamePrefix?: string;
  /** draft only: also write the base pass's AV latent halves to disk
   * (SaveLatent, two files), so a refine pass can later pick up exactly here
   * — see `refineFrom`. The files come back with the video in the run's
   * outputs. */
  keepLatents?: boolean;
  /** FINISH (refine): skip the base pass and read its latent halves from
   * these staged .latent inputs instead. Everything else in the spec must be
   * the draft's own request — the conditioning, guides and frame re-inject
   * are rebuilt from it and the refine pass runs over the loaded latent, so
   * the full render has the draft's exact blocking. `fast` is ignored. */
  refineFrom?: { videoLatentName: string; audioLatentName: string };
}

export function ltx25Graph(spec: Ltx25GraphSpec): ComfyGraph {
  const fps = spec.fps ?? 24;
  const frames = Math.round(spec.durationSec * fps) + 1;
  // a refine-from-draft run is by definition the full ladder's second half
  const fast = !!spec.fast && !spec.refineFrom;
  const graph: ComfyGraph = {};
  const add = (id: string, class_type: string, inputs: Record<string, unknown>) => {
    graph[id] = { class_type, inputs };
    return id;
  };

  /* ---------- loaders ---------- */
  add("unet", "UNETLoader", { unet_name: spec.models.transformer, weight_dtype: "default" });
  add("clip", "CLIPLoader", {
    clip_name: spec.models.textEncoder,
    type: "ltxv",
    device: "default",
  });
  add("vvae", "VAELoader", { vae_name: spec.models.videoVae });
  add("avae", "VAELoader", { vae_name: spec.models.audioVae });
  if (!fast) {
    add("upmodel", "LatentUpscaleModelLoader", { model_name: spec.models.upscaler });
  }

  /* ---------- adapter LoRAs ---------- */
  let model: [string, number] = ["unet", 0];
  (spec.loras ?? []).forEach((lora, i) => {
    add(`lora_${i}`, "LoraLoaderModelOnly", {
      lora_name: lora.name,
      strength_model: lora.strength,
      model,
    });
    model = [`lora_${i}`, 0];
  });

  /* ---------- start frame ---------- */
  const i2v = !!spec.imageName;
  if (i2v) {
    add("img", "LoadImage", { image: spec.imageName });
    // centre-crop to the render aspect; ImgToVideoInplace scales the rest,
    // which is how the one preprocessed image feeds both the half-res base
    // pass and the full-res refine
    add("imgfit", "ResizeImageMaskNode", {
      resize_type: "scale dimensions",
      "resize_type.width": spec.width,
      "resize_type.height": spec.height,
      "resize_type.crop": "center",
      scale_method: "lanczos",
      input: ["img", 0],
    });
    add("imgprep", "LTXVPreprocess", { img_compression: 18, image: ["imgfit", 0] });
  }

  /* ---------- conditioning ---------- */
  let promptSource: string | [string, number] = spec.prompt;
  if (spec.enhanceClipName) {
    add("eclip", "CLIPLoader", {
      clip_name: spec.enhanceClipName,
      type: "ltxv",
      device: "default",
    });
    const enhance: Record<string, unknown> = {
      prompt: spec.prompt,
      max_length: 600,
      sampling_mode: "on",
      "sampling_mode.temperature": 0.7,
      "sampling_mode.top_k": 64,
      "sampling_mode.top_p": 0.95,
      "sampling_mode.min_p": 0.05,
      "sampling_mode.repetition_penalty": 1.15,
      "sampling_mode.seed": 0,
      "sampling_mode.presence_penalty": 0,
      thinking: false,
      use_default_template: true,
      clip: ["eclip", 0],
    };
    // the 2.5 enhancer reads the start frame too, so the rewrite matches shot
    if (i2v) enhance.image = ["imgprep", 0];
    add("enhance", "TextGenerateLTX2Prompt", enhance);
    promptSource = ["enhance", 0];
  }
  add("pos", "CLIPTextEncode", { text: promptSource, clip: ["clip", 0] });
  add("neg", "CLIPTextEncode", {
    text: spec.negative ?? LTX25_DEFAULT_NEGATIVE,
    clip: ["clip", 0],
  });
  add("cond", "LTXVConditioning", {
    positive: ["pos", 0],
    negative: ["neg", 0],
    frame_rate: fps,
  });

  /* ---------- base-pass latents (half resolution, like the template) ---------- */
  add("vidlat", "EmptyLTXVLatentVideo", {
    width: Math.round(spec.width / 2),
    height: Math.round(spec.height / 2),
    length: frames,
    batch_size: 1,
  });
  let baseVideoLatent: [string, number] = ["vidlat", 0];
  if (i2v) {
    // template strengths: 0.7 on the base pass, 1.0 on the refine re-inject
    add("i2vbase", "LTXVImgToVideoInplace", {
      vae: ["vvae", 0],
      image: ["imgprep", 0],
      latent: ["vidlat", 0],
      strength: 0.7,
      bypass: false,
    });
    baseVideoLatent = ["i2vbase", 0];
  }

  /* ---------- guide frames (end frame + keyframes, flf2v-style) ---------- */
  const guides: Array<{ imageName: string; frameIdx: number; strength: number }> = (
    spec.guides ?? []
  ).map((g) => ({
    imageName: g.imageName,
    // LTXVAddGuide floors non-multiples of 8 silently; snap here (same rule
    // and comment as the 2.3 builder)
    frameIdx: Math.max(8, Math.round((g.atSec * fps) / 8) * 8),
    strength: g.strength,
  }));
  if (spec.endFrameName) {
    guides.push({ imageName: spec.endFrameName, frameIdx: -1, strength: 1 });
  }
  let cond: { pos: [string, number]; neg: [string, number] } = {
    pos: ["cond", 0],
    neg: ["cond", 1],
  };
  guides.forEach((g, i) => {
    add(`guide_img_${i}`, "LoadImage", { image: g.imageName });
    add(`guide_fit_${i}`, "ResizeImageMaskNode", {
      resize_type: "scale dimensions",
      "resize_type.width": spec.width,
      "resize_type.height": spec.height,
      "resize_type.crop": "center",
      scale_method: "lanczos",
      input: [`guide_img_${i}`, 0],
    });
    add(`guide_prep_${i}`, "LTXVPreprocess", {
      img_compression: 18,
      image: [`guide_fit_${i}`, 0],
    });
    add(`guide_${i}`, "LTXVAddGuide", {
      positive: cond.pos,
      negative: cond.neg,
      vae: ["vvae", 0],
      latent: baseVideoLatent,
      image: [`guide_prep_${i}`, 0],
      frame_idx: g.frameIdx,
      strength: g.strength,
    });
    cond = { pos: [`guide_${i}`, 0], neg: [`guide_${i}`, 1] };
    baseVideoLatent = [`guide_${i}`, 2];
  });

  /* ---------- base pass ---------- */
  /* Audio latent, two ways:
   *   no take  — LTXVEmptyLatentAudio, and the model scores the shot itself
   *   ia2v     — the staged take is encoded and its noise mask pinned to 0, so
   *              the audio is LOCKED and drives the render (phoneme lip-sync).
   *              Same contract as 2.3's audio-mask 0/1 (video-graphs.ts:165).
   * LTXVConcatAVLatent.fit_audio() trims/zero-pads the take to the shot length,
   * so no TrimAudioDuration node is needed here, and LTXVSeparateAVLatent copies
   * the mask through, so the lock survives base → refine on its own. */
  /* the base pass's two halves, whichever way they were made: sampled here,
   * or loaded off a draft's kept latents (refineFrom) */
  let baseVideo: [string, number];
  let baseAudio: [string, number];
  if (spec.refineFrom) {
    /* FINISH (refine): the draft already sampled the base pass; load its
     * halves and go straight to the upscale. The saved latent is the PRE-crop
     * one — the guide appendix is still on it — so the crop below runs on it
     * exactly as it would have on a fresh sample, against the same
     * conditioning the guide chain just rebuilt. SaveLatent keeps samples
     * only, so a voice take's lock (noise mask 0) is pinned back on here. */
    add("lat_v", "LoadLatent", { latent: spec.refineFrom.videoLatentName });
    add("lat_a", "LoadLatent", { latent: spec.refineFrom.audioLatentName });
    baseVideo = ["lat_v", 0];
    baseAudio = ["lat_a", 0];
    if (spec.audioName) {
      add("audmask", "SolidMask", { value: 0.0, width: 1, height: 1 });
      add("audlat", "SetLatentNoiseMask", { samples: ["lat_a", 0], mask: ["audmask", 0] });
      baseAudio = ["audlat", 0];
    }
  } else {
    if (spec.audioName) {
      add("aud", "LoadAudio", { audio: spec.audioName });
      add("audenc", "LTXVAudioVAEEncode", { audio: ["aud", 0], audio_vae: ["avae", 0] });
      // SetLatentNoiseMask reshapes whatever it is given, so a 1x1 solid is enough
      add("audmask", "SolidMask", { value: 0.0, width: 1, height: 1 });
      add("audlat", "SetLatentNoiseMask", { samples: ["audenc", 0], mask: ["audmask", 0] });
    } else {
      add("audlat", "LTXVEmptyLatentAudio", {
        frames_number: frames,
        frame_rate: fps,
        batch_size: 1,
        audio_vae: ["avae", 0],
      });
    }
    add("cat1", "LTXVConcatAVLatent", {
      video_latent: baseVideoLatent,
      audio_latent: ["audlat", 0],
    });
    add("noise1", "RandomNoise", { noise_seed: spec.seed });
    add("sampler", "KSamplerSelect", { sampler_name: "euler_ancestral" });
    add("sig1", "ManualSigmas", { sigmas: BASE_SIGMAS });
    add("guider1", "LTXVDualCFGGuider", {
      model,
      positive: cond.pos,
      negative: cond.neg,
      video_cfg: 1,
      audio_cfg: 1,
    });
    add("run1", "SamplerCustomAdvanced", {
      noise: ["noise1", 0],
      guider: ["guider1", 0],
      sampler: ["sampler", 0],
      sigmas: ["sig1", 0],
      latent_image: ["cat1", 0],
    });
    add("sep1", "LTXVSeparateAVLatent", { av_latent: ["run1", 0] });
    baseVideo = ["sep1", 0];
    baseAudio = ["sep1", 1];
    if (fast && spec.keepLatents) {
      // both halves, pre-crop, so a later refine pass can start from here.
      // SaveLatent is an output node: it runs whether or not anything reads
      // its passthrough, and its files ride back with the video's.
      const prefix = spec.filenamePrefix ?? "aurea/take";
      add("lat_v_save", "SaveLatent", {
        samples: ["sep1", 0],
        filename_prefix: `latents/${prefix}-video`,
      });
      add("lat_a_save", "SaveLatent", {
        samples: ["sep1", 1],
        filename_prefix: `latents/${prefix}-audio`,
      });
    }
  }

  // strip the guide appendix off the sampled latent before it is upscaled
  // (or decoded, in draft) — and off the conditioning the refine pass reads
  let videoLatent: [string, number] = baseVideo;
  if (guides.length) {
    add("crop", "LTXVCropGuides", {
      positive: cond.pos,
      negative: cond.neg,
      latent: baseVideo,
    });
    cond = { pos: ["crop", 0], neg: ["crop", 1] };
    videoLatent = ["crop", 2];
  }

  /* ---------- decode & save (draft: straight off the base pass) ---------- */
  const decode = (videoFrom: [string, number], audioFrom: [string, number]) => {
    // the official 2.5 template's tiling (node 374): temporal_size 4096 means
    // one temporal tile for any real shot length — the 64/16 this once used
    // cut a 121-frame decode into ~3 overlapping temporal tiles, slower and
    // with a seam risk the template never takes
    add("vdec", "VAEDecodeTiled", {
      tile_size: 768,
      overlap: 64,
      temporal_size: 4096,
      temporal_overlap: 32,
      samples: videoFrom,
      vae: ["vvae", 0],
    });
    add("adec", "LTXVAudioVAEDecode", { samples: audioFrom, audio_vae: ["avae", 0] });
    add("video", "CreateVideo", {
      fps,
      bit_depth: 8,
      images: ["vdec", 0],
      audio: ["adec", 0],
    });
    add("save", "SaveVideo", {
      filename_prefix: spec.filenamePrefix ?? "aurea/take",
      format: "auto",
      codec: "auto",
      video: ["video", 0],
    });
  };
  if (fast) {
    decode(videoLatent, baseAudio);
    finishTuning(graph, spec, model);
    return graph;
  }

  /* ---------- refine pass (×2 latent upscale, full resolution) ---------- */
  add("up", "LTXVLatentUpsampler", {
    samples: videoLatent,
    upscale_model: ["upmodel", 0],
    vae: ["vvae", 0],
  });
  let refineVideoLatent: [string, number] = ["up", 0];
  if (i2v) {
    add("i2vref", "LTXVImgToVideoInplace", {
      vae: ["vvae", 0],
      image: ["imgprep", 0],
      latent: ["up", 0],
      strength: 1,
      bypass: false,
    });
    refineVideoLatent = ["i2vref", 0];
  }
  add("cat2", "LTXVConcatAVLatent", {
    video_latent: refineVideoLatent,
    audio_latent: baseAudio,
  });
  add("noise2", "RandomNoise", { noise_seed: spec.seed });
  // the refine pass gets its own KSamplerSelect, like the official template's
  // two nodes (352/341) — same euler_ancestral by default, but separable so
  // sampler tuning can pair an ancestral base with a cfg++ refine
  add("sampler2", "KSamplerSelect", { sampler_name: "euler_ancestral" });
  add("sig2", "ManualSigmas", { sigmas: REFINE_SIGMAS });
  add("guider2", "LTXVDualCFGGuider", {
    model,
    positive: cond.pos,
    negative: cond.neg,
    video_cfg: 1,
    audio_cfg: 1,
  });
  add("run2", "SamplerCustomAdvanced", {
    noise: ["noise2", 0],
    guider: ["guider2", 0],
    sampler: ["sampler2", 0],
    sigmas: ["sig2", 0],
    latent_image: ["cat2", 0],
  });
  add("sep2", "LTXVSeparateAVLatent", { av_latent: ["run2", 0] });
  decode(["sep2", 0], ["sep2", 1]);
  finishTuning(graph, spec, model);
  return graph;
}

/** Splice the render tuning into the finished graph. Anchors mirror the 2.3
 * builder's: the model chain is patched after the adapter LoRAs, both guiders
 * re-read the patched end, the enhance branch keeps the plain model (it does
 * text generation, not diffusion). In draft graphs guider2/sampler2 don't
 * exist and applyTuning skips them. */
function finishTuning(graph: ComfyGraph, spec: Ltx25GraphSpec, model: [string, number]): void {
  applyTuning(graph, spec.tuning ?? NO_TUNING, {
    source: model,
    consumers: [
      ["guider1", "model"],
      ["guider2", "model"],
    ],
    negative: ["neg", 0],
    baseSampler: "sampler",
    refineSampler: "sampler2",
  });
}

/* ---------- FINISH (upscale): the Pixel Spatial Upscaler IC-LoRA -----------
 *
 * Lightricks' x2 generative upscaler, built the way their own
 * LTX-2.3_ICLoRA_Pixel_Spatial_Upscaler workflow builds it, on ComfyUI 0.32's
 * core nodes: the finished take is the in-context reference — LTXVAddGuide
 * with the IC-LoRA's own `reference_downscale_factor` (read off the LoRA's
 * safetensors metadata by GetICLoRAParameters) encodes the take at HALF the
 * output size and appends it to the sequence as sparse guide tokens; the
 * model then samples the full-size picture against it. The audio is the
 * take's own, encoded and locked (noise mask 0) the way an ia2v voice take
 * is, so the finish never re-scores the shot.
 *
 * The output canvas is the source x2 (the factor the LoRA was trained for);
 * the adapter snaps it. Sampling is the base ladder with plain euler — the
 * reference already fixes the blocking, ancestral noise would only fight it —
 * and `strength` < 1 drops the top sigmas so the pass starts from the
 * upscaled take instead of pure noise (the official note's "partial denoise
 * to stay faithful"). */

export interface Ltx25UpscaleSpec {
  /** the source take's own prompt (the finish re-reads the same scene) */
  prompt: string;
  negative?: string;
  /** staged source video — a LoadVideo input name */
  videoName: string;
  /** the IC-LoRA's exact combo name on this install (resolveUpscalerLora) */
  icLoraName: string;
  /** output canvas: source x2, multiples of 64 (the latent must halve evenly) */
  width: number;
  height: number;
  fps: number;
  /** frames in the source (8n+1) — sizes the empty audio latent when the
   * source has no soundtrack to carry */
  frames: number;
  /** the source has an audio stream: encode and lock it; false = the model
   * scores the finish itself (a mute source has nothing to keep) */
  hasAudio: boolean;
  /** 1 = the whole ladder from noise; lower = partial denoise, closer to the source */
  strength: number;
  seed: number;
  models: Ltx25ModelNames;
  tuning?: RenderTuning;
  filenamePrefix?: string;
}

/** The base ladder cut for a partial denoise: every sigma at or below
 * `strength`, with `strength` itself as the first step when it falls between
 * two of them. 1 (or more) is the untouched ladder. */
export function upscaleSigmas(strength: number): string {
  if (strength >= 1) return BASE_SIGMAS;
  const ladder = BASE_SIGMAS.split(",").map((s) => Number(s.trim()));
  const kept = ladder.filter((s) => s <= strength + 1e-9);
  if (!kept.length || kept[0] < strength - 1e-9) kept.unshift(strength);
  return kept.map((s) => String(s)).join(", ");
}

/** The most pixels a ×2 finish is allowed to produce on this card: a 1080p
 * class canvas. The IC reference doubles the token count of the pass, and
 * 1920×1088 with its reference is already the heaviest LTX sequence that
 * fits 24 GB with the int8 22B loaded. */
export const UPSCALE_MAX_PIXELS = 1920 * 1088;

/** Output canvas for a ×2 finish: each side doubled, then snapped to the
 * nearest multiple of 64 so the full-size latent (÷32) halves evenly for the
 * IC reference. A draft's 640×352 lands on 1280×704 exactly. A source whose
 * double would pass the pixel cap is fitted to it instead, aspect kept — the
 * guide node scales the reference to half the output on its own, so a
 * 1280×704 full take finishes at 1920×1088 (×1.5, still with the reinvented
 * detail) rather than being refused. */
export function upscaleCanvas(
  width: number,
  height: number,
  maxPixels = UPSCALE_MAX_PIXELS,
): { width: number; height: number } {
  let w = width * 2;
  let h = height * 2;
  if (w * h > maxPixels) {
    const scale = Math.sqrt(maxPixels / (w * h));
    w *= scale;
    h *= scale;
  }
  // snap DOWN to the grid so the fitted canvas never re-crosses the cap
  const snap = (n: number) => Math.max(64, Math.floor(n / 64) * 64);
  return { width: snap(w), height: snap(h) };
}

export function ltx25UpscaleGraph(spec: Ltx25UpscaleSpec): ComfyGraph {
  const graph: ComfyGraph = {};
  const add = (id: string, class_type: string, inputs: Record<string, unknown>) => {
    graph[id] = { class_type, inputs };
    return id;
  };

  /* ---------- loaders + the IC-LoRA ---------- */
  add("unet", "UNETLoader", { unet_name: spec.models.transformer, weight_dtype: "default" });
  add("clip", "CLIPLoader", { clip_name: spec.models.textEncoder, type: "ltxv", device: "default" });
  add("vvae", "VAELoader", { vae_name: spec.models.videoVae });
  add("avae", "VAELoader", { vae_name: spec.models.audioVae });
  // full strength is how it was trained (the card says so) — not a knob
  add("iclora", "LoraLoaderModelOnly", {
    lora_name: spec.icLoraName,
    strength_model: 1,
    model: ["unet", 0],
  });
  add("icparams", "GetICLoRAParameters", { iclora_model: ["iclora", 0] });
  const model: [string, number] = ["iclora", 0];

  /* ---------- the source take ---------- */
  add("src", "LoadVideo", { file: spec.videoName });
  add("srcparts", "GetVideoComponents", { video: ["src", 0] });
  // the starting latent. At strength 1 the pass starts from pure noise and
  // only the SHAPE matters, so an empty latent does; below 1 the partial
  // denoise starts from the take itself, lanczos-upscaled to the canvas and
  // encoded (tiled — a 1080p, 121-frame encode is a real allocation).
  if (spec.strength >= 1) {
    add("tgt", "EmptyLTXVLatentVideo", {
      width: spec.width,
      height: spec.height,
      length: spec.frames,
      batch_size: 1,
    });
  } else {
    add("srcfit", "ResizeImageMaskNode", {
      resize_type: "scale dimensions",
      "resize_type.width": spec.width,
      "resize_type.height": spec.height,
      "resize_type.crop": "center",
      scale_method: "lanczos",
      input: ["srcparts", 0],
    });
    add("tgt", "VAEEncodeTiled", {
      pixels: ["srcfit", 0],
      vae: ["vvae", 0],
      tile_size: 512,
      overlap: 64,
      temporal_size: 4096,
      temporal_overlap: 32,
    });
  }

  /* ---------- conditioning ---------- */
  add("pos", "CLIPTextEncode", { text: spec.prompt, clip: ["clip", 0] });
  add("neg", "CLIPTextEncode", {
    text: spec.negative ?? LTX25_DEFAULT_NEGATIVE,
    clip: ["clip", 0],
  });
  add("cond", "LTXVConditioning", {
    positive: ["pos", 0],
    negative: ["neg", 0],
    frame_rate: spec.fps,
  });
  // the reference: the ORIGINAL frames. The node scales its image to the
  // output size / the LoRA's factor — for an exact x2 that is the source's
  // own size, so the reference goes in untouched rather than up-and-down.
  add("guide", "LTXVAddGuide", {
    positive: ["cond", 0],
    negative: ["cond", 1],
    vae: ["vvae", 0],
    latent: ["tgt", 0],
    image: ["srcparts", 0],
    frame_idx: 0,
    strength: 1,
    iclora_parameters: ["icparams", 0],
  });

  /* ---------- audio: the take's own, locked ---------- */
  if (spec.hasAudio) {
    add("audenc", "LTXVAudioVAEEncode", { audio: ["srcparts", 1], audio_vae: ["avae", 0] });
    add("audmask", "SolidMask", { value: 0.0, width: 1, height: 1 });
    add("audlat", "SetLatentNoiseMask", { samples: ["audenc", 0], mask: ["audmask", 0] });
  } else {
    add("audlat", "LTXVEmptyLatentAudio", {
      frames_number: spec.frames,
      frame_rate: spec.fps,
      batch_size: 1,
      audio_vae: ["avae", 0],
    });
  }

  /* ---------- one pass ---------- */
  add("cat1", "LTXVConcatAVLatent", { video_latent: ["guide", 2], audio_latent: ["audlat", 0] });
  add("noise1", "RandomNoise", { noise_seed: spec.seed });
  add("sampler", "KSamplerSelect", { sampler_name: "euler" });
  add("sig1", "ManualSigmas", { sigmas: upscaleSigmas(spec.strength) });
  add("guider1", "LTXVDualCFGGuider", {
    model,
    positive: ["guide", 0],
    negative: ["guide", 1],
    video_cfg: 1,
    audio_cfg: 1,
  });
  add("run1", "SamplerCustomAdvanced", {
    noise: ["noise1", 0],
    guider: ["guider1", 0],
    sampler: ["sampler", 0],
    sigmas: ["sig1", 0],
    latent_image: ["cat1", 0],
  });
  add("sep1", "LTXVSeparateAVLatent", { av_latent: ["run1", 0] });
  // the reference tokens come off before decode, like any guide appendix
  add("crop", "LTXVCropGuides", {
    positive: ["guide", 0],
    negative: ["guide", 1],
    latent: ["sep1", 0],
  });

  /* ---------- decode & save ---------- */
  add("vdec", "VAEDecodeTiled", {
    tile_size: 768,
    overlap: 64,
    temporal_size: 4096,
    temporal_overlap: 32,
    samples: ["crop", 2],
    vae: ["vvae", 0],
  });
  add("adec", "LTXVAudioVAEDecode", { samples: ["sep1", 1], audio_vae: ["avae", 0] });
  add("video", "CreateVideo", {
    fps: spec.fps,
    bit_depth: 8,
    images: ["vdec", 0],
    audio: ["adec", 0],
  });
  add("save", "SaveVideo", {
    filename_prefix: spec.filenamePrefix ?? "aurea/finish",
    format: "auto",
    codec: "auto",
    video: ["video", 0],
  });

  // the same attention/feed-forward patches as a render. No sampler anchors
  // on purpose: the cfg++ pairing would put an ANCESTRAL sampler on this
  // pass, and a finish that must hold to its reference wants none of that.
  applyTuning(graph, spec.tuning ?? NO_TUNING, {
    source: model,
    consumers: [["guider1", "model"]],
    negative: ["neg", 0],
  });
  return graph;
}
