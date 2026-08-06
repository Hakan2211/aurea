/* MiniMax-H3 video graphs — both of the model's heads.
 *
 *   fl2va   first/last frame → video + audio   (minimaxH3Graph)
 *   ref2va  references       → video + audio   (minimaxH3RefGraph)
 *
 * They are separately trained checkpoints sharing one text encoder and both
 * VAEs, reached through different nodes, so they are two builders around one
 * scaffold rather than a flag.
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

/** The reference head is a SECOND unet, not a mode of the first one: ref2va and
 * fl2va are separately trained checkpoints that share the encoder and both
 * VAEs. Which is why a reference shot is gated on its own download. */
export interface MinimaxRefModelNames extends MinimaxModelNames {
  refUnet: string;
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

/** the ref2va unet, under its own model id (see models/registry.ts) */
export const MINIMAX_H3_REF_MANAGED = rel(
  "minimax-h3-ref-gguf",
  "diffusion_models",
  "MiniMax-H3-REF2VA-Q3_K_M.gguf",
);
export const MINIMAX_H3_REF_CONVENTIONAL = "MiniMax-H3-REF2VA-Q3_K_M.gguf";

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
  /** patch the unet with SageAttention (KJ node on the H3 install) — roughly
   * doubles render speed; needs `sageattention` in that ComfyUI's python */
  sage?: boolean;
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
  sage: "17",
} as const;

/** Everything either graph needs around its conditioning node: the four
 * loaders, the sampler chain, and the two decoders that turn ONE sampled
 * latent into picture and sound. `unetName` is the only thing that differs
 * between the fl2va and ref2va heads. */
function minimaxScaffold(
  models: MinimaxModelNames,
  unetName: string,
  seed: number,
  steps: number,
  filenamePrefix: string,
  sage = false,
): ComfyGraph {
  const N = MINIMAX_NODES;
  /* with Sage on, everything that consumes the unet reads the patched model */
  const model: [string, number] = sage ? [N.sage, 0] : [N.unet, 0];
  const sageNode: ComfyGraph = sage
    ? {
        [N.sage]: {
          class_type: "PathchSageAttentionKJ",
          inputs: { sage_attention: "auto", allow_compile: false, model: [N.unet, 0] },
        },
      }
    : {};
  return {
    ...sageNode,
    [N.unet]: {
      class_type: "UnetLoaderGGUF",
      inputs: { unet_name: unetName },
    },
    [N.clip]: {
      class_type: "CLIPLoaderGGUF",
      // "minimax" only exists on core 0.30.0+; CLIPLoaderGGUF inherits the
      // list from core's CLIPLoader, so an older install silently falls back
      // to STABLE_DIFFUSION and the encode produces nonsense rather than an
      // error — the adapter version-gates before we ever get here.
      inputs: { clip_name: models.textEncoder, type: "minimax" },
    },
    [N.videoVae]: {
      class_type: "VAELoader",
      inputs: { vae_name: models.videoVae },
    },
    [N.audioVae]: {
      class_type: "VAELoader",
      inputs: { vae_name: models.audioVae },
    },
    [N.noise]: {
      class_type: "RandomNoise",
      inputs: { noise_seed: seed },
    },
    [N.guider]: {
      class_type: "BasicGuider",
      inputs: { model, conditioning: [N.conditioning, 0] },
    },
    [N.sampler]: {
      class_type: "KSamplerSelect",
      inputs: { sampler_name: "res_multistep" },
    },
    [N.sigmas]: {
      class_type: "BasicScheduler",
      inputs: {
        model,
        scheduler: "simple",
        steps,
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
        filename_prefix: filenamePrefix,
        format: "auto",
        codec: "auto",
      },
    },
  };
}

export function minimaxH3Graph(spec: MinimaxGraphSpec): ComfyGraph {
  const N = MINIMAX_NODES;
  const [width, height] = snapCanvas(spec.width, spec.height);

  const graph = minimaxScaffold(
    spec.models,
    spec.models.unet,
    spec.seed,
    spec.steps ?? 25,
    spec.filenamePrefix ?? "aurea/h3",
    spec.sage,
  );
  graph[N.conditioning] = {
    class_type: "MiniMaxH3ImageToVideo",
    inputs: {
      clip: [N.clip, 0],
      vae: [N.videoVae, 0],
      prompt: spec.prompt,
      width,
      height,
      length: frameLength(spec.durationSec),
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

/* ---------- ref2va: references in, a new take out ---------- */

/** Node ids for the reference loaders. They start at 20 so the scaffold's
 * 1-16 stay exactly where the fl2va graph puts them — the adapter reports
 * progress against class names, but a stable map is worth keeping anyway. */
export const MINIMAX_REF_NODES = {
  image: (i: number) => String(20 + i), // 20..28  — up to 9 stills
  video: (i: number) => String(30 + i), // 30..32  — up to 3 clips
  videoParts: (i: number) => String(35 + i), // 35..37 — their frames + sound
  audio: (i: number) => String(40 + i), // 40..42  — up to 3 sound clips
} as const;

export interface MinimaxRefGraphSpec {
  /** the shot, written against the reference TAGS — "<Picture 1> walks into
   * the room lit like <Picture 2>". Untagged references still condition the
   * take, but nothing tells the model what role they play. */
  prompt: string;
  /** staged ComfyUI input names, in the order they become <Picture 1..9> */
  refImageNames: string[];
  /** staged clips, in the order they become <Video 1..3>. `withAudio` wires
   * the clip's own soundtrack in as its <Audio j> — only set it when the file
   * really has an audio stream. */
  refVideos: { file: string; withAudio: boolean }[];
  /** staged standalone sound, numbered AFTER every soundtrack above */
  refAudioNames: string[];
  /** "match" scales stills to the render's pixel area; "max" gives them a
   * 2048px short edge — stronger identity, several times slower */
  refImageSize?: "match" | "max";
  durationSec: number;
  width: number;
  height: number;
  seed: number;
  steps?: number;
  /** SageAttention on the H3 install — see MinimaxGraphSpec.sage */
  sage?: boolean;
  models: MinimaxRefModelNames;
  filenamePrefix?: string;
}

/** prompt + references → video with its own soundtrack, on the ref2va head.
 *
 * The one non-obvious thing here is the input NAMES. MiniMaxH3ReferenceToVideo
 * declares its reference slots as ComfyUI "autogrow" groups, which in an API
 * graph are addressed by their dotted path — `ref_images.ref_image_0`, not
 * `ref_image_0` and not a list. The indices are 0-based and the tags the model
 * sees are 1-based, and gaps are not allowed: only the slots present in the
 * request get numbered, so a hole would silently shift every tag after it. */
export function minimaxH3RefGraph(spec: MinimaxRefGraphSpec): ComfyGraph {
  const N = MINIMAX_NODES;
  const R = MINIMAX_REF_NODES;
  const [width, height] = snapCanvas(spec.width, spec.height);

  const graph = minimaxScaffold(
    spec.models,
    spec.models.refUnet,
    spec.seed,
    spec.steps ?? 25,
    spec.filenamePrefix ?? "aurea/h3-ref",
    spec.sage,
  );

  const refInputs: Record<string, unknown> = {};

  spec.refImageNames.forEach((name, i) => {
    graph[R.image(i)] = { class_type: "LoadImage", inputs: { image: name } };
    refInputs[`ref_images.ref_image_${i}`] = [R.image(i), 0];
  });

  spec.refVideos.forEach((v, i) => {
    graph[R.video(i)] = { class_type: "LoadVideo", inputs: { file: v.file } };
    // one decode, two outputs: frames on 0, the soundtrack on 1
    graph[R.videoParts(i)] = {
      class_type: "GetVideoComponents",
      inputs: { video: [R.video(i), 0] },
    };
    refInputs[`ref_videos.ref_video_${i}`] = [R.videoParts(i), 0];
    if (v.withAudio) {
      refInputs[`ref_video_audios.ref_video_audio_${i}`] = [R.videoParts(i), 1];
    }
  });

  spec.refAudioNames.forEach((name, i) => {
    graph[R.audio(i)] = { class_type: "LoadAudio", inputs: { audio: name } };
    refInputs[`ref_audios.ref_audio_${i}`] = [R.audio(i), 0];
  });

  graph[N.conditioning] = {
    class_type: "MiniMaxH3ReferenceToVideo",
    inputs: {
      clip: [N.clip, 0],
      vae: [N.videoVae, 0],
      // ref2va reads sound as well as pictures, so unlike fl2va the audio VAE
      // is wired into the CONDITIONING too, not just the decode
      audio_vae: [N.audioVae, 0],
      prompt: spec.prompt,
      width,
      height,
      length: frameLength(spec.durationSec),
      ref_image_size: spec.refImageSize ?? "match",
      ...refInputs,
    },
  };

  return graph;
}
