/* MiniMax-H3 video graph — the fl2va (first/last frame → video + audio) path.
 *
 * H3 is not an LTX variant with a different checkpoint: it emits ONE muxed A/V
 * file. Voice, sound effects and music come out of the same forward pass as the
 * picture, so there is no audio lane to place takes on and no ia2v/i2v split —
 * the prompt carries the dialogue, and the sampler decides how it sounds. That
 * is why this is its own graph and its own adapter rather than a branch of
 * ltx23Graph.
 *
 * The graph is hand-built in API form from Comfy-Org's published fl2va GGUF
 * workflow, minus its two convenience dependencies: ComfyMath (the frame-count
 * expression, computed here in `frameLength`) and KJNodes (the pre-resize,
 * which MiniMaxH3ImageToVideo already does internally — stretch for the first
 * frame, cover-crop for the last). What's left needs core 0.30.0+ and
 * ComfyUI-GGUF, nothing else. */

import type { ComfyGraph } from "./client.js";

export interface MinimaxModelNames {
  /** GGUF unet, resolved through ComfyUI-GGUF's "unet_gguf" folder */
  unet: string;
  /** GGUF qwen3-vl text encoder, resolved through "clip_gguf" */
  textEncoder: string;
  videoVae: string;
  audioVae: string;
}

const rel = (...parts: string[]) => parts.join(process.platform === "win32" ? "\\" : "/");

/** registry-relative names (see models/registry.ts minimax-h3-gguf) — the
 * Ampere-safe set: Q3_K_M unet, Q2_K text encoder. */
export const MINIMAX_H3_MANAGED: MinimaxModelNames = {
  unet: rel("minimax-h3-gguf", "diffusion_models", "MiniMax-H3-FL2VA-Q3_K_M.gguf"),
  textEncoder: rel("minimax-h3-gguf", "text_encoders", "qwen3vl-32B-MiniMax-H3-Q2_K.gguf"),
  videoVae: rel("minimax-h3-gguf", "vae", "minimax_h3_video_vae_fp16.safetensors"),
  audioVae: rel("minimax-h3-gguf", "vae", "minimax_h3_audio_vae_fp32.safetensors"),
};

/** the flat names a hand-managed ComfyUI would use */
export const MINIMAX_H3_CONVENTIONAL: MinimaxModelNames = {
  unet: "MiniMax-H3-FL2VA-Q3_K_M.gguf",
  textEncoder: "qwen3vl-32B-MiniMax-H3-Q2_K.gguf",
  videoVae: "minimax_h3_video_vae_fp16.safetensors",
  audioVae: "minimax_h3_audio_vae_fp32.safetensors",
};

/** H3 renders at 24 fps — every duration in this module is that rate */
export const MINIMAX_FPS = 24;

/** Frames per block. The sampler only accepts lengths on the 17k+5 grid, and
 * ComfyUI does NOT snap for you — an off-grid length fails inside the node. */
const BLOCK = 17;
const OFFSET = 5;

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** seconds → a legal `length`, snapped UP so the take is never short.
 * 5s → 124, the length H3 was trained around; the trained range is ~124-362
 * (≈5-15s) and the node's own ceiling is 3600. */
export function frameLength(durationSec: number): number {
  const raw = Math.max(OFFSET, Math.round(durationSec * MINIMAX_FPS));
  return raw + mod(OFFSET - mod(raw, BLOCK), BLOCK);
}

/** H3's canvas: multiples of 32, short edge 768 by default. Sizes are snapped
 * DOWN so a request never grows past the VRAM the caller budgeted for. */
export function snapCanvas(width: number, height: number): [number, number] {
  const snap = (v: number) => Math.max(32, Math.floor(v / 32) * 32);
  return [snap(width), snap(height)];
}

export interface MinimaxGraphSpec {
  /** the whole shot in one block: picture, timeline, camera AND audio. H3
   * scores what the prompt describes — an "Audio:" paragraph is how you get
   * dialogue, SFX and music. */
  prompt: string;
  /** staged ComfyUI input name of the first frame; omitted = text-to-video */
  firstFrameName?: string;
  /** staged last frame — the shot lands on it (fl2va) */
  lastFrameName?: string;
  durationSec: number;
  width: number;
  height: number;
  seed: number;
  /** 25 is the published default; fewer trades detail for wall-clock */
  steps?: number;
  models: MinimaxModelNames;
  filenamePrefix?: string;
}

/** node ids, stable so the adapter can report progress against them */
export const MINIMAX_NODES = {
  unet: "1",
  clip: "2",
  videoVae: "3",
  audioVae: "4",
  conditioning: "5",
  noise: "6",
  guider: "7",
  sampler: "8",
  sigmas: "9",
  sample: "10",
  decodeVideo: "11",
  decodeAudio: "12",
  createVideo: "13",
  save: "14",
  firstFrame: "15",
  lastFrame: "16",
} as const;

export function minimaxH3Graph(spec: MinimaxGraphSpec): ComfyGraph {
  const N = MINIMAX_NODES;
  const [width, height] = snapCanvas(spec.width, spec.height);

  const graph: ComfyGraph = {
    [N.unet]: {
      class_type: "UnetLoaderGGUF",
      inputs: { unet_name: spec.models.unet },
    },
    [N.clip]: {
      class_type: "CLIPLoaderGGUF",
      // "minimax" only exists on core 0.30.0+; CLIPLoaderGGUF inherits the
      // list from core's CLIPLoader, so an older install silently falls back
      // to STABLE_DIFFUSION and the encode produces nonsense rather than an
      // error — the adapter version-gates before we ever get here.
      inputs: { clip_name: spec.models.textEncoder, type: "minimax" },
    },
    [N.videoVae]: {
      class_type: "VAELoader",
      inputs: { vae_name: spec.models.videoVae },
    },
    [N.audioVae]: {
      class_type: "VAELoader",
      inputs: { vae_name: spec.models.audioVae },
    },
    [N.conditioning]: {
      class_type: "MiniMaxH3ImageToVideo",
      inputs: {
        clip: [N.clip, 0],
        vae: [N.videoVae, 0],
        prompt: spec.prompt,
        width,
        height,
        length: frameLength(spec.durationSec),
      },
    },
    [N.noise]: {
      class_type: "RandomNoise",
      inputs: { noise_seed: spec.seed },
    },
    [N.guider]: {
      class_type: "BasicGuider",
      inputs: { model: [N.unet, 0], conditioning: [N.conditioning, 0] },
    },
    [N.sampler]: {
      class_type: "KSamplerSelect",
      inputs: { sampler_name: "res_multistep" },
    },
    [N.sigmas]: {
      class_type: "BasicScheduler",
      inputs: {
        model: [N.unet, 0],
        scheduler: "simple",
        steps: spec.steps ?? 25,
        denoise: 1,
      },
    },
    [N.sample]: {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: [N.noise, 0],
        guider: [N.guider, 0],
        sampler: [N.sampler, 0],
        sigmas: [N.sigmas, 0],
        latent_image: [N.conditioning, 1],
      },
    },
    // one sampled latent, two decoders: H3 carries picture and sound in the
    // same tensor, which is the whole point of the model
    [N.decodeVideo]: {
      class_type: "VAEDecode",
      inputs: { samples: [N.sample, 0], vae: [N.videoVae, 0] },
    },
    [N.decodeAudio]: {
      class_type: "VAEDecodeAudio",
      inputs: { samples: [N.sample, 0], vae: [N.audioVae, 0] },
    },
    [N.createVideo]: {
      class_type: "CreateVideo",
      inputs: {
        images: [N.decodeVideo, 0],
        audio: [N.decodeAudio, 0],
        fps: MINIMAX_FPS,
        bit_depth: 8,
      },
    },
    [N.save]: {
      class_type: "SaveVideo",
      inputs: {
        video: [N.createVideo, 0],
        filename_prefix: spec.filenamePrefix ?? "aurea/h3",
        format: "auto",
        codec: "auto",
      },
    },
  };

  /* Keyframes are optional and asymmetric: with neither, H3 is text-to-video;
   * with only a first frame it animates forward; with both it has to land on
   * the last one. Only add the LoadImage nodes we actually wire up — a dangling
   * loader would still be executed. */
  if (spec.firstFrameName) {
    graph[N.firstFrame] = {
      class_type: "LoadImage",
      inputs: { image: spec.firstFrameName },
    };
    (graph[N.conditioning].inputs as Record<string, unknown>).first_frame = [N.firstFrame, 0];
  }
  if (spec.lastFrameName) {
    graph[N.lastFrame] = {
      class_type: "LoadImage",
      inputs: { image: spec.lastFrameName },
    };
    (graph[N.conditioning].inputs as Record<string, unknown>).last_frame = [N.lastFrame, 0];
  }

  return graph;
}
