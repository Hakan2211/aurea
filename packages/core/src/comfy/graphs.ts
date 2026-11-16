/* Image graph templates — TS builders mirroring the proven videofast
 * workflows (images/workflows/*.json), parameterized on the loader names the
 * caller resolved.
 *
 * Graphs deliberately know nothing about where a weight came from. Resolving
 * "<model-id>/<category>/<file>" (a copy the model manager downloaded) versus
 * a bare conventional filename (a linked root, or an external ComfyUI) is
 * ModelManager.comfyNames()'s job — it is a property of the file, not of the
 * engine mode, ever since linked roots let a managed engine read a
 * conventionally named file.
 *
 * z-image uses core nodes only, so it's the managed default. krea2 and
 * qwen-edit need the GGUF loader custom node — the managed runtime installs it
 * as the "gguf" component (CUSTOM_NODES in runtime.ts). */

import type { ComfyGraph } from "./client.js";

export interface ImageGraphSpec {
  prompt: string;
  width: number;
  height: number;
  seed: number;
  /** sampler overrides; absent → the per-model proven defaults below */
  steps?: number;
  cfg?: number;
}

/** The three loader slots every image graph fills. Resolved per model by
 * ModelManager.comfyNames() — a managed copy addresses itself as
 * "<model-id>/<category>/<file>", a linked or external one by bare filename. */
export interface ModelNames {
  unet: string;
  clip: string;
  vae: string;
}

/** Non-diffusion 4× enlargement: load the ESRGAN weights, run the staged
 * input through them, save. Core nodes only, so it works on any ComfyUI. */
export function esrganUpscaleGraph(sourceName: string, modelName: string): ComfyGraph {
  return {
    source: { inputs: { image: sourceName }, class_type: "LoadImage" },
    upscaler: { inputs: { model_name: modelName }, class_type: "UpscaleModelLoader" },
    upscale: {
      inputs: { upscale_model: ["upscaler", 0], image: ["source", 0] },
      class_type: "ImageUpscaleWithModel",
    },
    save: {
      inputs: { filename_prefix: "aurea", images: ["upscale", 0] },
      class_type: "SaveImage",
    },
  };
}

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
        steps: spec.steps ?? 8,
        cfg: spec.cfg ?? 1.0,
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
        steps: spec.steps ?? 8,
        cfg: spec.cfg ?? 1.0,
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
export function qwenEditGraph(
  spec: ImageGraphSpec,
  names: ModelNames,
  refs: string[],
  /** optional adapter stacked on the DiT (the Upscale2K refine path) */
  lora?: { name: string; strength?: number },
): ComfyGraph {
  if (refs.length < 1 || refs.length > 3) {
    throw new Error(`qwen-edit needs 1-3 reference images, got ${refs.length}`);
  }
  const model: [string, number] = lora ? ["lora", 0] : ["unet", 0];
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
        steps: spec.steps ?? 20,
        cfg: spec.cfg ?? 4.0,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1.0,
        model,
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
  if (lora) {
    graph.lora = {
      inputs: {
        lora_name: lora.name,
        strength_model: lora.strength ?? 1.0,
        model: ["unet", 0],
      },
      class_type: "LoraLoaderModelOnly",
    };
  }
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

/** MiniMax-H3-Image loader names. The text encoder belongs to a different
 * registry model (minimax-h3-gguf), so this has its own shape rather than
 * ModelNames. */
export interface H3ImageNames {
  unet: string;
  /** GGUF qwen3-vl encoder, loaded through CLIPLoaderGGUF type "minimax" */
  textEncoder: string;
  vae: string;
}

/** The H3-Image canvas grid: MiniMaxH3ImageConditioning steps width/height
 * by 32 (CANVAS_MULTIPLE in comfy_extras/nodes_minimax_h3.py). */
export const H3_IMAGE_GRID = 32;

/** Mirrors ComfyUI's official image_minimax_h3_image_t2i / _edit templates
 * (comfyui-workflow-templates, ComfyUI 0.45): one conditioning node takes the
 * prompt, the canvas and the reference pictures and hands back both the
 * positive conditioning and the empty latent. PDD-distilled: euler / simple,
 * 6 steps, cfg 1, with a zeroed negative.
 *
 * `refs` are ComfyUI input names (ComfyClient.uploadInput); refs[0] is the
 * picture being edited and the prompt calls them <Picture 1>, <Picture 2>...
 * Width/height of 0 lets the node size the canvas from the first reference
 * (or 2048x2048 without one). */
export function h3ImageGraph(
  spec: ImageGraphSpec,
  names: H3ImageNames,
  refs: string[] = [],
): ComfyGraph {
  const snap = (v: number) => (v ? Math.max(H3_IMAGE_GRID, Math.round(v / H3_IMAGE_GRID) * H3_IMAGE_GRID) : 0);
  const graph: ComfyGraph = {
    unet: { inputs: { unet_name: names.unet, weight_dtype: "default" }, class_type: "UNETLoader" },
    clip: {
      inputs: { clip_name: names.textEncoder, type: "minimax" },
      class_type: "CLIPLoaderGGUF",
    },
    vae: { inputs: { vae_name: names.vae }, class_type: "VAELoader" },
    negative: { inputs: { conditioning: ["positive", 0] }, class_type: "ConditioningZeroOut" },
    sampler: {
      inputs: {
        seed: spec.seed,
        steps: spec.steps ?? 6,
        cfg: spec.cfg ?? 1.0,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1.0,
        model: ["unet", 0],
        positive: ["positive", 0],
        negative: ["negative", 0],
        latent_image: ["positive", 1],
      },
      class_type: "KSampler",
    },
    decode: { inputs: { samples: ["sampler", 0], vae: ["vae", 0] }, class_type: "VAEDecode" },
    save: {
      inputs: { filename_prefix: "aurea", images: ["decode", 0] },
      class_type: "SaveImage",
    },
  };
  // the node's images input is an Autogrow group: image_1..image_N, sent as
  // flat "images.image_N" keys in the API format
  const imageInputs: Record<string, [string, number]> = {};
  refs.forEach((name, i) => {
    graph[`ref${i + 1}`] = { inputs: { image: name }, class_type: "LoadImage" };
    imageInputs[`images.image_${i + 1}`] = [`ref${i + 1}`, 0];
  });
  graph.positive = {
    inputs: {
      clip: ["clip", 0],
      vae: ["vae", 0],
      prompt: spec.prompt,
      width: snap(spec.width),
      height: snap(spec.height),
      ...imageInputs,
    },
    class_type: "MiniMaxH3ImageConditioning",
  };
  return graph;
}
