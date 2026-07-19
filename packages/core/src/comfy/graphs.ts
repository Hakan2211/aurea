/* Image graph templates — TS builders mirroring the proven videofast
 * workflows (images/workflows/*.json), parameterized on model file names so
 * the same graph runs against both worlds:
 *
 *   managed  — weights installed by the ModelManager, referenced as
 *              "<model-id>/<category>/<file>" (extra_model_paths.yaml mounts
 *              <dataRoot>/models for every category)
 *   external — the user's own ComfyUI with its conventional flat names
 *
 * z-image uses core nodes only, so it's the managed default. krea2 needs the
 * GGUF loader custom node — the managed runtime installs it as the "gguf"
 * component (CUSTOM_NODES in runtime.ts). */

import path from "node:path";
import type { ComfyGraph } from "./client.js";

/** ComfyUI validates loader names against its recursive listing, which uses
 * the OS separator (backslashes on Windows) — join accordingly. */
const rel = (...parts: string[]) => parts.join(path.sep);

export interface ImageGraphSpec {
  prompt: string;
  width: number;
  height: number;
  seed: number;
}

interface ModelNames {
  unet: string;
  clip: string;
  vae: string;
}

/** registry-relative names (see models/registry.ts z-image-turbo) */
export const ZIMAGE_MANAGED: ModelNames = {
  unet: rel("z-image-turbo", "diffusion_models", "z_image_turbo_bf16.safetensors"),
  clip: rel("z-image-turbo", "text_encoders", "qwen_3_4b.safetensors"),
  vae: rel("z-image-turbo", "vae", "ae.safetensors"),
};

/** conventional names on a user-managed ComfyUI (videofast's install) */
export const ZIMAGE_EXTERNAL: ModelNames = {
  unet: "z_image_turbo_bf16.safetensors",
  clip: "qwen_3_4b.safetensors",
  vae: "ae.safetensors",
};

export const KREA2_EXTERNAL: ModelNames = {
  unet: "krea2_turbo-Q8_0.gguf",
  clip: "qwen3vl_4b_bf16.safetensors",
  vae: "qwen_image_vae.safetensors",
};

/** registry-relative names (see models/registry.ts krea2-turbo-gguf); the
 * GGUF loader lists "unet_gguf" from the diffusion_models search paths */
export const KREA2_MANAGED: ModelNames = {
  unet: rel("krea2-turbo-gguf", "diffusion_models", "krea2_turbo-Q8_0.gguf"),
  clip: rel("krea2-turbo-gguf", "text_encoders", "qwen3vl_4b_bf16.safetensors"),
  vae: rel("krea2-turbo-gguf", "vae", "qwen_image_vae.safetensors"),
};

/** conventional names on a user-managed ComfyUI (videofast's proven
 * qwen-edit-ref.json stack) */
export const QWENEDIT_EXTERNAL: ModelNames = {
  unet: "Qwen-Image-Edit-2509-Q5_K_M.gguf",
  clip: "qwen_2.5_vl_7b_fp8_scaled.safetensors",
  vae: "qwen_image_vae.safetensors",
};

/** registry-relative names (see models/registry.ts qwen-image-edit-2509-gguf) */
export const QWENEDIT_MANAGED: ModelNames = {
  unet: rel("qwen-image-edit-2509-gguf", "diffusion_models", "Qwen-Image-Edit-2509-Q5_K_M.gguf"),
  clip: rel("qwen-image-edit-2509-gguf", "text_encoders", "qwen_2.5_vl_7b_fp8_scaled.safetensors"),
  vae: rel("qwen-image-edit-2509-gguf", "vae", "qwen_image_vae.safetensors"),
};

/** mirrors videofast images/workflows/z-image-turbo.json (core nodes only) */
export function zImageGraph(spec: ImageGraphSpec, names: ModelNames): ComfyGraph {
  return {
    unet: { inputs: { unet_name: names.unet, weight_dtype: "default" }, class_type: "UNETLoader" },
    clip: {
      inputs: { clip_name: names.clip, type: "lumina2", device: "default" },
      class_type: "CLIPLoader",
    },
    vae: { inputs: { vae_name: names.vae }, class_type: "VAELoader" },
    shift: { inputs: { shift: 3.0, model: ["unet", 0] }, class_type: "ModelSamplingAuraFlow" },
    positive: { inputs: { text: spec.prompt, clip: ["clip", 0] }, class_type: "CLIPTextEncode" },
    negative: { inputs: { conditioning: ["positive", 0] }, class_type: "ConditioningZeroOut" },
    latent: {
      inputs: { width: spec.width, height: spec.height, batch_size: 1 },
      class_type: "EmptySD3LatentImage",
    },
    sampler: {
      inputs: {
        seed: spec.seed,
        steps: 8,
        cfg: 1.0,
        sampler_name: "res_multistep",
        scheduler: "simple",
        denoise: 1.0,
        model: ["shift", 0],
        positive: ["positive", 0],
        negative: ["negative", 0],
        latent_image: ["latent", 0],
      },
      class_type: "KSampler",
    },
    decode: { inputs: { samples: ["sampler", 0], vae: ["vae", 0] }, class_type: "VAEDecode" },
    save: {
      inputs: { filename_prefix: "aurea", images: ["decode", 0] },
      class_type: "SaveImage",
    },
  };
}

/** mirrors videofast images/workflows/krea2.json (needs ComfyUI-GGUF node) */
export function krea2Graph(spec: ImageGraphSpec, names: ModelNames): ComfyGraph {
  return {
    unet: { inputs: { unet_name: names.unet }, class_type: "UnetLoaderGGUF" },
    clip: {
      inputs: { clip_name: names.clip, type: "krea2", device: "default" },
      class_type: "CLIPLoader",
    },
    vae: { inputs: { vae_name: names.vae }, class_type: "VAELoader" },
    positive: { inputs: { text: spec.prompt, clip: ["clip", 0] }, class_type: "CLIPTextEncode" },
    negative: { inputs: { conditioning: ["positive", 0] }, class_type: "ConditioningZeroOut" },
    latent: {
      inputs: { width: spec.width, height: spec.height, batch_size: 1 },
      class_type: "EmptyLatentImage",
    },
    sampler: {
      inputs: {
        seed: spec.seed,
        steps: 8,
        cfg: 1.0,
        sampler_name: "er_sde",
        scheduler: "simple",
        denoise: 1.0,
        model: ["unet", 0],
        positive: ["positive", 0],
        negative: ["negative", 0],
        latent_image: ["latent", 0],
      },
      class_type: "KSampler",
    },
    decode: { inputs: { samples: ["sampler", 0], vae: ["vae", 0] }, class_type: "VAEDecode" },
    save: {
      inputs: { filename_prefix: "aurea", images: ["decode", 0] },
      class_type: "SaveImage",
    },
  };
}

/** Mirrors videofast images/workflows/qwen-edit-ref.json — reference-driven
 * generation via Qwen-Image-Edit-2509 (GGUF loader node): 1–3 uploaded
 * reference images keep the subject on-model in a brand-new scene. `refs` are
 * ComfyUI input names as returned by ComfyClient.uploadInput. */
export function qwenEditGraph(spec: ImageGraphSpec, names: ModelNames, refs: string[]): ComfyGraph {
  if (refs.length < 1 || refs.length > 3) {
    throw new Error(`qwen-edit needs 1-3 reference images, got ${refs.length}`);
  }
  const graph: ComfyGraph = {
    unet: { inputs: { unet_name: names.unet }, class_type: "UnetLoaderGGUF" },
    clip: {
      inputs: { clip_name: names.clip, type: "qwen_image", device: "default" },
      class_type: "CLIPLoader",
    },
    vae: { inputs: { vae_name: names.vae }, class_type: "VAELoader" },
    latent: {
      inputs: { width: spec.width, height: spec.height, batch_size: 1 },
      class_type: "EmptySD3LatentImage",
    },
    sampler: {
      inputs: {
        seed: spec.seed,
        steps: 20,
        cfg: 4.0,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1.0,
        model: ["unet", 0],
        positive: ["positive", 0],
        negative: ["negative", 0],
        latent_image: ["latent", 0],
      },
      class_type: "KSampler",
    },
    decode: { inputs: { samples: ["sampler", 0], vae: ["vae", 0] }, class_type: "VAEDecode" },
    save: {
      inputs: { filename_prefix: "aurea", images: ["decode", 0] },
      class_type: "SaveImage",
    },
  };
  const imageInputs: Record<string, [string, number]> = {};
  refs.forEach((name, i) => {
    graph[`ref${i + 1}`] = { inputs: { image: name }, class_type: "LoadImage" };
    imageInputs[`image${i + 1}`] = [`ref${i + 1}`, 0];
  });
  graph.positive = {
    inputs: { prompt: spec.prompt, clip: ["clip", 0], vae: ["vae", 0], ...imageInputs },
    class_type: "TextEncodeQwenImageEditPlus",
  };
  graph.negative = {
    inputs: { prompt: "", clip: ["clip", 0], vae: ["vae", 0], ...imageInputs },
    class_type: "TextEncodeQwenImageEditPlus",
  };
  return graph;
}
