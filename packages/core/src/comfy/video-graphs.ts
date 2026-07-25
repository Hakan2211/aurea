/* LTX 2.3 video graph — one template, both modes and both jobs:
 *
 *   i2v  (no audio take)  — a staged silent wav + audio-mask 1 lets the model
 *                           GENERATE the soundtrack while animating the frame
 *   ia2v (audio attached) — the staged take is encoded and mask 0 locks it,
 *                           so the audio DRIVES the render (phoneme lip-sync)
 *
 * The template ships verbatim in ltx23-template.ts; this module only patches
 * node inputs. Managed mode re-points every loader at model-manager weights
 * and strips the Gemma prompt-enhance branch (its LoRA has no public source —
 * external installs keep the proven enhance-on default). */

import type { ComfyGraph } from "./client.js";
import { LTX23_AV_TEMPLATE } from "./ltx23-template.js";
import { NO_TUNING, applyTuning, type RenderTuning, type TuningAnchors } from "./tuning.js";

/* node ids in the exported template */
const N = {
  image: "269",
  audio: "276",
  save: "341",
  duration: "340:331",
  width: "340:330",
  height: "340:324",
  seed1: "340:285",
  seed2: "340:286",
  prompt: "340:319",
  audioMask: "340:333",
  positive: "340:306",
  ckpt: "340:317",
  audioVae: "340:335",
  textEncoder: "340:318",
  upscaler: "340:313",
  distillLora: "340:293",
  /* the Gemma prompt-enhance branch (managed strips it) */
  enhance: ["340:345", "340:346", "340:347", "340:348", "340:349"],
} as const;

/** Where render tuning splices into this template: after the distilled LoRA,
 * feeding both CFGGuiders. The enhance branch's LoraLoader (340:345) keeps the
 * untuned model on purpose — it runs Gemma text generation, not diffusion.
 * Base pass = 8-step sigmas (340:308) → sampler 340:298; refine = 340:288. */
const TUNING_ANCHORS: TuningAnchors = {
  source: [N.distillLora, 0],
  consumers: [
    ["340:290", "model"],
    ["340:315", "model"],
  ],
  negative: ["340:314", 0],
  baseSampler: "340:298",
  refineSampler: "340:288",
};

export interface LtxModelNames {
  checkpoint: string;
  distillLora: string;
  textEncoder: string;
  upscaler: string;
}

const rel = (...parts: string[]) => parts.join(process.platform === "win32" ? "\\" : "/");

/** registry-relative names (see models/registry.ts ltx-23-22b-fp8) */
export const LTX23_MANAGED: LtxModelNames = {
  checkpoint: rel("ltx-23-22b-fp8", "checkpoints", "ltx-2.3-22b-dev-fp8.safetensors"),
  distillLora: rel(
    "ltx-23-22b-fp8",
    "loras",
    "ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors",
  ),
  textEncoder: rel("ltx-23-22b-fp8", "text_encoders", "gemma_3_12B_it_fp4_mixed.safetensors"),
  upscaler: rel(
    "ltx-23-22b-fp8",
    "latent_upscale_models",
    "ltx-2.3-spatial-upscaler-x2-1.1.safetensors",
  ),
};

export interface VideoGraphSpec {
  prompt: string;
  /** staged ComfyUI input name of the start frame (subfolder/file) */
  imageName: string;
  /** staged voice take; undefined = i2v, the model generates the audio */
  audioName?: string;
  durationSec: number;
  width: number;
  height: number;
  seed: number;
  /** managed loader names; null = external install's conventional names */
  models: LtxModelNames | null;
  /** optional attention/sampler tuning; omitted = the verified default render */
  tuning?: RenderTuning;
}

export function ltx23Graph(spec: VideoGraphSpec): ComfyGraph {
  const graph = structuredClone(LTX23_AV_TEMPLATE) as ComfyGraph;
  const input = (id: string) => {
    const node = graph[id];
    if (!node) throw new Error(`LTX template is missing node ${id}`);
    return node.inputs;
  };

  input(N.image).image = spec.imageName;
  input(N.audio).audio = spec.audioName ?? spec.imageName; // placeholder — repatched below
  input(N.duration).value = spec.durationSec;
  input(N.width).value = spec.width;
  input(N.height).value = spec.height;
  input(N.seed1).noise_seed = spec.seed;
  input(N.seed2).noise_seed = spec.seed;
  input(N.prompt).value = spec.prompt;
  input(N.save).filename_prefix = "aurea/take";

  if (spec.audioName) {
    input(N.audio).audio = spec.audioName;
    input(N.audioMask).value = 0; // staged audio is fixed — it drives the lips
  } else {
    // i2v: the LoadAudio node still needs a real file — the adapter stages a
    // silent wav — but mask 1 frees the audio latent, so LTX invents the sound
    input(N.audioMask).value = 1;
  }
  if ("audioUI" in input(N.audio)) {
    input(N.audio).audioUI =
      `/api/view?filename=${encodeURIComponent(String(input(N.audio).audio))}&type=input&subfolder=&rand=0.5`;
  }

  if (spec.models) {
    input(N.ckpt).ckpt_name = spec.models.checkpoint;
    input(N.audioVae).ckpt_name = spec.models.checkpoint;
    input(N.textEncoder).ckpt_name = spec.models.checkpoint;
    input(N.textEncoder).text_encoder = spec.models.textEncoder;
    input(N.upscaler).model_name = spec.models.upscaler;
    input(N.distillLora).lora_name = spec.models.distillLora;
    // strip the enhance branch and feed the raw prompt straight to conditioning
    for (const id of N.enhance) delete graph[id];
    input(N.positive).text = [N.prompt, 0];
  }

  applyTuning(graph, spec.tuning ?? NO_TUNING, TUNING_ANCHORS);
  return graph;
}

/** a minimal silent PCM16 mono wav of the given length — the i2v placeholder */
export function silentWav(durationSec: number, sampleRate = 16_000): Buffer {
  const samples = Math.max(1, Math.round(durationSec * sampleRate));
  const dataLen = samples * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataLen, 40);
  return buf;
}
