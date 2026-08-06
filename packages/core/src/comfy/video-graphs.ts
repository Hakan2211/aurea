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
  fps: "340:323",
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
  t2vSwitch: "340:305",
  /* conditioning + latent seams the guide chain splices into */
  conditioning: "340:307",
  baseVideoLatent: "340:325",
  baseConcat: "340:326",
  baseGuider: "340:315",
  baseSeparate: "340:309",
  cropGuides: "340:292",
  /* the refine stage — everything draft mode deletes */
  refine: ["340:295", "340:296", "340:287", "340:310", "340:311", "340:290", "340:288", "340:289"],
  refineUpsampler: "340:295",
  refineSeparate: "340:311",
  refineGuider: "340:290",
  videoDecode: "340:316",
  audioDecode: "340:303",
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
  /** Staged ComfyUI input name of the start frame — ALWAYS a real staged file
   * (`uploadInput`'s return value, which carries its subfolder). For a
   * text-to-video render this is the placeholder; see textToVideo. */
  imageName: string;
  /** Render from the prompt alone.
   *
   * The template could always do this — node 340:305 is a PrimitiveBoolean
   * titled "Switch to Text to Video?" wired to the `bypass` input of both
   * LTXVImgToVideoInplace nodes. Nothing ever set it, so every render took the
   * i2v path. The LoadImage node still executes when it is on (bypass makes
   * ImgToVideoInplace ignore the image, it does not prune the loader), which is
   * why imageName stays required — a name that isn't really staged makes
   * ComfyUI drop the whole branch and report success with no video. */
  textToVideo?: boolean;
  /** staged voice take; undefined = the model generates the audio itself */
  audioName?: string;
  /** Staged silent wav, used whenever there is no voice take. LoadAudio feeds
   * TrimAudioDuration → the audio VAE, so it runs on every render and needs a
   * real decodable audio file: pointing it at the start-frame PNG (what this
   * did before) fails the render with "No audio stream found in the file". */
  silenceName: string;
  durationSec: number;
  width: number;
  height: number;
  seed: number;
  /** frames per second — 24 is the trained default, 48 doubles the frame
   * count for the same seconds (frames = duration*fps+1 stays on the 8n+1
   * grid for whole-second durations at both rates) */
  fps?: number;
  /** draft: stop after the base pass — the take comes back at HALF the
   * requested size (the base pass runs at width/2 × height/2 and the deleted
   * refine stage is what upscaled it) in well under half the time */
  fast?: boolean;
  /** staged image the take must land on (frame_idx -1 guide) */
  endFrameName?: string;
  /** staged mid-shot anchors, imposed at their times (frame_idx snaps to 8) */
  guides?: Array<{ imageName: string; atSec: number; strength: number }>;
  /** adapter LoRAs chained after the distilled LoRA, in order — names must be
   * verbatim combo values from THIS install (camera-control resolves to one
   * of these upstream in the adapter) */
  loras?: Array<{ name: string; strength: number }>;
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

  if (spec.textToVideo) input(N.t2vSwitch).value = true;
  input(N.image).image = spec.imageName;
  input(N.audio).audio = spec.audioName ?? spec.silenceName;
  input(N.duration).value = spec.durationSec;
  input(N.width).value = spec.width;
  input(N.height).value = spec.height;
  input(N.seed1).noise_seed = spec.seed;
  input(N.seed2).noise_seed = spec.seed;
  input(N.prompt).value = spec.prompt;
  input(N.save).filename_prefix = "aurea/take";

  // mask 0 = the staged take is fixed and drives the lips; mask 1 frees the
  // audio latent so LTX invents the sound over the staged silence
  input(N.audioMask).value = spec.audioName ? 0 : 1;
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

  const fps = spec.fps ?? 24;
  input(N.fps).value = fps;

  /* adapter LoRAs — chained after the distilled LoRA, before any tuning
   * patches. The enhance branch keeps reading the bare distilled model on
   * purpose: it does text generation, and a video style adapter has no
   * business there. */
  let model: [string, number] = [N.distillLora, 0];
  (spec.loras ?? []).forEach((lora, i) => {
    const id = `aurea:lora_${i}`;
    graph[id] = {
      class_type: "LoraLoaderModelOnly",
      inputs: { lora_name: lora.name, strength_model: lora.strength, model },
    };
    model = [id, 0];
  });
  if (model[0] !== N.distillLora) {
    input(N.baseGuider).model = model;
    if (graph[N.refineGuider]) input(N.refineGuider).model = model;
  }

  /* guide frames — mid-shot anchors and/or the frame the take must land on.
   * Each LTXVAddGuide APPENDS its encoded frame to the video latent and marks
   * it in the conditioning; LTXVCropGuides removes the appendix after
   * sampling. The template already crops between the passes (340:292) — with
   * guides in play its latent OUTPUT becomes the one the upsampler must read,
   * where the guideless template reads the uncropped latent (identical then). */
  const guides: Array<{ imageName: string; frameIdx: number; strength: number }> = (
    spec.guides ?? []
  ).map((g) => ({
    imageName: g.imageName,
    // the node floors non-multiples of 8 silently; snap here so the anchor
    // lands where the caller asked, not up to 7 frames early
    frameIdx: Math.max(8, Math.round((g.atSec * fps) / 8) * 8),
    strength: g.strength,
  }));
  if (spec.endFrameName) {
    guides.push({ imageName: spec.endFrameName, frameIdx: -1, strength: 1 });
  }

  let cond: { pos: [string, number]; neg: [string, number] } = {
    pos: [N.conditioning, 0],
    neg: [N.conditioning, 1],
  };
  let latent: [string, number] = [N.baseVideoLatent, 0];
  guides.forEach((g, i) => {
    const load = `aurea:guide_img_${i}`;
    const resize = `aurea:guide_fit_${i}`;
    const prep = `aurea:guide_prep_${i}`;
    const guide = `aurea:guide_${i}`;
    graph[load] = { class_type: "LoadImage", inputs: { image: g.imageName } };
    // centre-crop to the render aspect, exactly like the start frame's chain
    graph[resize] = {
      class_type: "ResizeImageMaskNode",
      inputs: {
        resize_type: "scale dimensions",
        "resize_type.width": [N.width, 0],
        "resize_type.height": [N.height, 0],
        "resize_type.crop": "center",
        scale_method: "lanczos",
        input: [load, 0],
      },
    };
    graph[prep] = {
      class_type: "LTXVPreprocess",
      inputs: { img_compression: 18, image: [resize, 0] },
    };
    graph[guide] = {
      class_type: "LTXVAddGuide",
      inputs: {
        positive: cond.pos,
        negative: cond.neg,
        vae: [N.ckpt, 2],
        latent,
        image: [prep, 0],
        frame_idx: g.frameIdx,
        strength: g.strength,
      },
    };
    cond = { pos: [guide, 0], neg: [guide, 1] };
    latent = [guide, 2];
  });
  if (guides.length) {
    input(N.baseConcat).video_latent = latent;
    input(N.baseGuider).positive = cond.pos;
    input(N.baseGuider).negative = cond.neg;
    input(N.cropGuides).positive = cond.pos;
    input(N.cropGuides).negative = cond.neg;
    if (graph[N.refineUpsampler]) input(N.refineUpsampler).samples = [N.cropGuides, 2];
  }

  /* draft mode — delete the ×2 upscale + refine stage and decode the base
   * pass directly. Audio always comes off the base pass here; picture comes
   * off the guide crop when guides were appended. */
  if (spec.fast) {
    for (const id of N.refine) delete graph[id];
    input(N.videoDecode).samples = guides.length ? [N.cropGuides, 2] : [N.baseSeparate, 0];
    input(N.audioDecode).samples = [N.baseSeparate, 1];
  }

  applyTuning(graph, spec.tuning ?? NO_TUNING, { ...TUNING_ANCHORS, source: model });
  return graph;
}

/** Staged input name for the frame a text-to-video render never looks at. The
 * adapter uploads solidPng() under this name whenever it renders without a
 * start frame; the graph's LoadImage still executes, the bypassed
 * ImgToVideoInplace throws the pixels away. */
export const PLACEHOLDER_FRAME = "aurea-t2v-placeholder.png";

/** A 1×1 black PNG, hand-assembled so no encoder is needed. Same role as
 * silentWav: something valid to hand a node whose output is discarded. */
export function solidPng(): Buffer {
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const byte of buf) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (~c) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width
  ihdr.writeUInt32BE(1, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  // one zlib block holding a single filter byte + one black RGB pixel
  const raw = Buffer.from([0x00, 0x00, 0x00, 0x00]);
  let a = 1;
  let b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const zlib = Buffer.concat([
    Buffer.from([0x78, 0x01, 0x01, raw.length, 0x00, ~raw.length & 0xff, 0xff]),
    raw,
    Buffer.from([(b >> 8) & 0xff, b & 0xff, (a >> 8) & 0xff, a & 0xff]),
  ]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib),
    chunk("IEND", Buffer.alloc(0)),
  ]);
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
