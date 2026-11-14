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

import type { MinimaxDistillId } from "@aurea/shared";
import type { ComfyGraph } from "./client.js";

export interface MinimaxModelNames {
  /** The unet. `.gguf` loads through ComfyUI-GGUF's UnetLoaderGGUF; anything
   * else (the w4a8 checkpoint) through core's own UNETLoader, which reads the
   * file's quant metadata and picks the layout. See unetLoaderFor. */
  unet: string;
  /** GGUF qwen3-vl text encoder, resolved through "clip_gguf" */
  textEncoder: string;
  videoVae: string;
  audioVae: string;
}

/** Which loader a unet name asks for. The two formats are not a setting: a
 * GGUF has to go through the GGUF pack (core's loader cannot read it) and a
 * quantized safetensors has to go through core's (the GGUF pack cannot read
 * comfy-kitchen's layouts). The extension is the whole signal. */
export function unetLoaderFor(name: string): "UnetLoaderGGUF" | "UNETLoader" {
  return /\.gguf$/i.test(name) ? "UnetLoaderGGUF" : "UNETLoader";
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

/* ---------- the w4a8 set (registry: minimax-h3-w4a8 / -ref-w4a8) ----------
 *
 * The same two heads in 4-bit weights with int8 activations, plus the int8
 * video VAE. Not a quality tier below the GGUF — a different bargain. GGUF
 * stores 3-bit blocks and dequantizes each one back to bf16 on every forward,
 * so the card does the same bf16 matmul it always did AND pays for the unpack;
 * w4a8 unpacks once at load and runs the matmul on the INT8 tensor cores
 * (comfy_kitchen's int8_linear → torch.int8_mm). It is also 3 GB smaller,
 * which on a 24 GB card is the difference between the DiT loading whole and
 * loading partially beside its own text encoder.
 *
 * Text encoder and audio VAE are unchanged and still come from the GGUF entry
 * — Kijai's repo doesn't republish them and there is nothing to gain. */
export const MINIMAX_H3_W4A8: Pick<MinimaxModelNames, "unet" | "videoVae"> = {
  unet: rel("minimax-h3-w4a8", "diffusion_models", "minimax_h3_fl2va_pruned_w4a8_mixed.safetensors"),
  videoVae: rel("minimax-h3-w4a8", "vae", "minimax_h3_video_vae_int8_convrot.safetensors"),
};
export const MINIMAX_H3_REF_W4A8 = rel(
  "minimax-h3-ref-w4a8",
  "diffusion_models",
  "minimax_h3_ref2va_pruned_w4a8_mixed.safetensors",
);

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

/** Seconds of wall clock per megapixel-frame-step, fitted to two measured
 * renders on a 24 GB 3090 Ti:
 *
 *   768x448,  107 frames, 25 steps -> 5.6 min  => 0.37 s/Mpx-frame-step
 *   1344x768, 107 frames,  8 steps -> 8.6 min  => 0.59 s/Mpx-frame-step
 *
 * The bigger canvas costs more per unit because attention is quadratic in
 * tokens and because a large latent leaves the DiT less room, so this is a
 * midpoint rather than a law. It is only ever used to warn, never to size a
 * tensor. */
const SECONDS_PER_MPX_FRAME_STEP = 0.5;
/** flat cost of reading ~24 GB of weights off disk before the first step */
const LOAD_OVERHEAD_SEC = 120;

/** Roughly how long a render will take, in minutes.
 *
 * H3's cost is not intuitive from the request: doubling the length and turning
 * Draft off is a 6x change, and the difference between "eight minutes" and
 * "an hour" is a resolution dropdown. Worse, past a certain latent size the
 * DiT stops fitting beside its own text encoder and pages to system RAM, at
 * which point the per-step cost jumps by an order of magnitude and the number
 * below is an optimistic floor. Callers use it to tell the user what they just
 * asked for. */
export function estimateRenderMinutes(
  width: number,
  height: number,
  frames: number,
  steps: number,
): number {
  const mpx = (width * height) / 1_000_000;
  return (LOAD_OVERHEAD_SEC + mpx * frames * steps * SECONDS_PER_MPX_FRAME_STEP) / 60;
}

/** H3's canvas: multiples of 32, short edge 768 by default. Sizes are snapped
 * DOWN so a request never grows past the VRAM the caller budgeted for. */
export function snapCanvas(width: number, height: number): [number, number] {
  const snap = (v: number) => Math.max(32, Math.floor(v / 32) * 32);
  return [snap(width), snap(height)];
}

/** The 4-step distills corrupt the audio and ghost the picture at ~1 MPx —
 * the publisher's own caveat on the fl2v v1.1 768p weight, and H3's default
 * 1344×768 canvas is 1.03 MPx, right on it. Above the safe line a Draft
 * render is scaled to ~0.72 MPx instead of refused: Draft is the speed tier,
 * a smaller canvas is faster still, and the artifact is a certainty where the
 * resolution is a preference. 1344×768 → 1120×640 (aspect intact, /32 grid). */
export const DRAFT_SAFE_MPX = 0.9;
const DRAFT_TARGET_MPX = 0.72;
export function draftCanvas(width: number, height: number): [number, number] {
  const mpx = (width * height) / 1_000_000;
  if (mpx <= DRAFT_SAFE_MPX) return snapCanvas(width, height);
  const scale = Math.sqrt(DRAFT_TARGET_MPX / mpx);
  return snapCanvas(width * scale, height * scale);
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
  /** Patch the unet with SageAttention (the KJ node on this install). INT8
   * attention kernels: ~2.9× on the attention op itself, which at H3's native
   * shape is 40 → 30 seconds a step (measured 3090 Ti, 2026-08-30). Needs
   * `sageattention` in that ComfyUI's python — the managed runtime installs
   * it; an external one may not have it. */
  sage?: boolean;
  /** The distilled tier, already resolved to this install's own combo name
   * (see MINIMAX_TURBO). Present = the LoRA rides the unet, the sigma shift
   * node patches the schedule it was trained on, and `steps` defaults to the
   * tier's own count rather than Final's 25. */
  turbo?: MinimaxTurbo;
  /** Jojocodex's camera-motion LoRA, resolved to this install's combo name.
   * H3 has no other camera control — before this the move was a sentence and
   * the model took it or left it. Rides the unet AFTER the distill: the
   * distill decides how the model samples, the camera LoRA what it draws. */
  cameraLora?: MinimaxCameraLora;
  /** free the text encoder between conditioning and sampling — ~9.6 GB back on
   * a card that would otherwise be 98.6% weights. Needs KJNodes. */
  evictEncoder?: boolean;
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
  turboLora: "18",
  /* 61, not 20: the ref2va graph's own loaders start at 20 (see
   * MINIMAX_REF_NODES) and a collision here would overwrite <Picture 1>. */
  /** the camera-motion LoRA, stacked after the distill — see cameraLora */
  cameraLora: "61",
  sigmaShift: "19",
  /** the encoder eviction between conditioning and sampling — see evictEncoder */
  evict: "60",
} as const;

/** Long-form config, resolved by the adapter. Absent = one plain chunk on
 * SamplerCustomAdvanced, which is every shot that fits. */
export interface MinimaxEndless {
  /** frames per chunk — see endlessChunkFrames */
  chunkFrames: number;
  /** frames of the finished tail handed to the next chunk */
  continuationFrames: number;
  /** the shot as written. The sampler hands this to Gemma, which re-writes it
   * per chunk; H3 never sees Gemma's planning, only the rewritten line. */
  prompt: string;
}

/** Final's step count — the model's own schedule, no LoRA, no shift patch. */
export const MINIMAX_FINAL_STEPS = 25;

/* ---------- long-form: HR Endless Sampler ----------
 *
 * H3's trained window is roughly 5–15 seconds, and on a 24 GB card the real
 * ceiling arrives sooner than that — attention is quadratic in tokens, so the
 * canvas and the length trade against each other inside one latent.
 *
 * The Endless Sampler is a drop-in replacement for SamplerCustomAdvanced that
 * samples ONE long latent as a chain of chunks, handing the finished tail of
 * each chunk to the next as H3's own synchronized <Video N>/<Audio N>
 * reference, and asking Gemma 4 between chunks to rewrite the prompt for what
 * comes next. Everything else in the graph is unchanged: same two decoders,
 * one file out.
 *
 * The conditioning node is NOT unchanged, though, and that is the one thing to
 * know before reading further: because the handover IS a reference, a chunked
 * shot only builds on MiniMaxH3ReferenceToVideo. On fl2va the sampler stops
 * with "Experimental video conditioning requires positive conditioning from
 * MiniMax H3 Reference to Video". So long-form lives in minimaxH3RefGraph. */

/** H3's own window: the longest shot the model was trained to hold in one
 * take, and therefore the line past which a shot is chunked. */
export const MINIMAX_TRAINED_MAX_SEC = 15;

/** How much latent one chunk may hold, as megapixel-frames — the card's
 * ceiling, not the model's, and it depends on which weights are loaded.
 *
 * Probed with scripts/h3-fit.mts at H3's native 1344×768 on a 24 GB 3090 Ti,
 * reading ComfyUI's own load line (1.03 Mpx per frame):
 *
 *   GGUF   4.0s (107 frames)  loaded completely, 15352 of 15403 MB usable
 *          4.5s (113 frames)  loaded partially,  1.2 GB offloaded
 *          8.0s (197 frames)  loaded partially,  5.8 GB offloaded — 330s
 *   w4a8   8.0s  (197 frames) fits — 140s, 0.73 s/frame
 *          12.0s (294 frames) fits — 200s, 0.68 s/frame
 *          15.0s (362 frames) fits — 261s, 0.72 s/frame, 19.8 GB free after
 *
 * The GGUF unet stages at 15352 MB and its fp16 VAE at 4965; w4a8 stages at
 * 11956 and 2677. Those 5.6 GB are the whole difference between a card that
 * gives out at four seconds and one that holds H3's entire trained window — on
 * w4a8 at the native canvas the cap below is the model, not the card, and the
 * per-frame cost is flat from 8s to 15s.
 *
 * Expressed as an area rather than a frame count because what runs out is
 * VRAM: a 2K chunk gets proportionally fewer frames, which is the point.
 *
 * Note what this is NOT: the point at which a shot starts being chunked. A
 * single pass that pages still finishes, and that is what it has always done —
 * chunking it instead would cost a Gemma pass per handover for roughly the same
 * wall clock, and would change the output, because the planner rewrites the
 * prompt. This only sizes the chunks of a shot ALREADY past H3's window, where
 * every chunk it buys should be one that loads whole. */
const ENDLESS_CHUNK_BUDGET_MPX_FRAMES = { gguf: 111, w4a8: 374 } as const;

/** Frames carried from the finished chunk into the next one. The pack's own
 * default, and its floor is 5; more is smoother and costs VRAM inside every
 * chunk, which is exactly the budget above. */
export const ENDLESS_CONTINUATION_FRAMES = 22;

/** The chunk size for this canvas: the VRAM budget above, snapped DOWN to the
 * 17k+5 grid (the node snaps too, but a caller that knows the real number can
 * report it), never below the node's own 22-frame floor, and never longer than
 * H3's window even on a canvas small enough to hold more. */
export function endlessChunkFrames(
  width: number,
  height: number,
  weights: "gguf" | "w4a8" = "gguf",
): number {
  const mpx = (width * height) / 1_000_000;
  const byVram = Math.floor(ENDLESS_CHUNK_BUDGET_MPX_FRAMES[weights] / Math.max(mpx, 0.01));
  const raw = Math.min(byVram, frameLength(MINIMAX_TRAINED_MAX_SEC));
  const onGrid = 5 + Math.floor((raw - 5) / BLOCK) * BLOCK;
  return Math.max(22, onGrid);
}

/** Does this shot have to be chunked?
 *
 * The line is H3's trained window, NOT the chunk size — see the budget above.
 * Everything the engine renders today keeps rendering the way it does today,
 * and long-form is a new capability rather than a new default. */
export function needsEndless(width: number, height: number, durationSec: number): boolean {
  void width;
  void height;
  return durationSec > MINIMAX_TRAINED_MAX_SEC;
}

/** One distilled tier: which LoRA, how hard, how many steps, and the sigma
 * schedule it was trained against. The shift is not a taste knob — the distill
 * learned a specific noise schedule, and rendering it against a different one
 * is how a 4-step take comes out muddy rather than fast. */
export interface MinimaxTurboSpec {
  /** the weight's file name, as the registry writes it. The adapter matches
   * this against the install's own lora walk rather than composing a path —
   * that walk arrives with backslashes on Windows. */
  file: string;
  steps: number;
  strength: number;
  shiftVideo: number;
  shiftAudio: number;
  /** the model id the weight ships under, when it is not the Turbo entry.
   * Absent = minimax-h3-turbo-lora, which is what every LightX2V weight is. */
  modelId?: string;
  /** which sampler the distill was trained against. Absent = res_multistep,
   * the schedule LightX2V distilled from and the one this graph has always
   * used. A distill trained under a different solver has to be sampled with
   * it or the step count means something else. */
  sampler?: string;
  /** an explicit sigma schedule, when the publisher ships one.
   *
   * Absent = BasicScheduler's own "simple" ramp at `steps`, which is right for
   * a distill that was trained on a uniform schedule. Present = the publisher
   * measured the schedule and says so — Tutu's 20→8 NFE weight is distilled
   * against nine sigmas lifted from specific boundaries of its 20-step
   * teacher, and its card is explicit that a uniform 8-step ramp is NOT a
   * substitute. Supplying it needs KJNodes' Custom Sigmas node; the adapter
   * checks for it and refuses rather than quietly sampling the wrong ladder.
   *
   * Length must be `steps + 1` — the schedule runs from 1.0 down to 0.
   *
   * These are the sigmas the SAMPLER sees, i.e. already video-shifted:
   * MiniMaxH3SigmaShift hands the sampler video-shifted sigmas and the DiT
   * inverts them to the shared base grid itself (comfy_extras/
   * nodes_minimax_h3.py). A publisher who ships the unshifted base grid has
   * to go through `shiftSigmas` first. */
  sigmas?: readonly number[];
  /** BasicScheduler's scheduler, when the distill was trained on something
   * other than the uniform ramp. Absent = "simple". Ignored when `sigmas` is
   * present — an explicit ladder has no scheduler. */
  scheduler?: string;
}

/** A flow-matching shift applied to an unshifted sigma grid — the same map
 * ComfyUI's ModelSamplingAV applies to its own schedule:
 * σ' = s·σ / (1 + (s − 1)·σ). Rounded to 10 places so the ladder that reaches
 * CustomSigmas is a stable string.
 *
 * Checked against two publishers who state both forms: LightX2V's spec note
 * (shift 12, q = 0.75 → 0.9730) and drbaph's HyperFlow card, whose ComfyUI
 * ladder is exactly this map of the grid stored in HyperFlow's own file header. */
export const shiftSigmas = (base: readonly number[], shift: number): number[] =>
  base.map((s) => Math.round(((shift * s) / (1 + (shift - 1) * s)) * 1e10) / 1e10);

/** The two distilled tiers, per head.
 *
 * LightX2V publish fl2v and ref2v distills separately, which settles a
 * question Aurea used to answer by guessing: the old single LoRA went on both
 * heads on the reasoning that the distill was trained on the shared
 * transformer. It is per-head.
 *
 * Numbers are the publisher's, via ComfyUI-wiki's write-ups of the v1.0/v1.1
 * releases: the 4-step 768p variant runs 4 steps at 6/3, the 8-step v1.0 runs
 * 8 steps at 12/3 (and "4 also works"). Strength: the v1.1 4-step wants 1.2
 * (publisher discussion #42 converges on 1.2–1.3; at 1.0 i2v prompt adherence
 * is reported weak). The other weights stay at 1.0 — the 0.75 in circulation
 * is guidance for the older v0.1 weight, and nobody has published a strength
 * recipe for the 8-step or the ref2v v0.1.
 *
 * ref2v has no 8-step weight, so Standard on the reference head is the 4-step
 * distill given twice the steps. That is the same trade the old build made on
 * both heads and it renders; it is not the publisher's recommendation. */
export const MINIMAX_TURBO: Record<
  "draft" | "standard",
  { fl2v: MinimaxTurboSpec; ref2v: MinimaxTurboSpec }
> = {
  draft: {
    fl2v: {
      file: "minimax_h3_fl2v_turbo_4step_v1.1_768p_comfyui_bf16.safetensors",
      steps: 4,
      strength: 1.2,
      shiftVideo: 6,
      shiftAudio: 3,
    },
    ref2v: {
      file: "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors",
      steps: 4,
      strength: 1,
      shiftVideo: 6,
      shiftAudio: 3,
    },
  },
  standard: {
    fl2v: {
      file: "minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors",
      steps: 8,
      strength: 1,
      shiftVideo: 12,
      shiftAudio: 3,
    },
    ref2v: {
      file: "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors",
      steps: 8,
      strength: 1,
      shiftVideo: 12,
      shiftAudio: 3,
    },
  },
};

/** Standard-tier distills that are NOT the shipped default — the candidates a
 * bake-off picks from. Selected by `payload.minimaxDistill`; absent means the
 * LightX2V weight in MINIMAX_TURBO, which stays the default until something
 * beats it on evidence.
 *
 * Tutu's is a 20→8 NFE distill of the fl2va head that claims to keep the
 * stereo audio and the lip-sync a generic few-step distill trades away — the
 * thing that matters most for an interview single. It comes with a published
 * sampling contract and the numbers below ARE that contract, not tuning:
 * euler rather than res_multistep, strength 0.8, shift 12/3, and nine sigmas
 * taken from its 20-step teacher's boundaries. */
/** Tutu's nine sigmas, lifted from boundaries [0,3,5,8,10,13,15,18,20] of its
 * 20-step teacher. Shared by all three checkpoints — the contract belongs to
 * the recipe, not to the checkpoint. */
const TUTU_SIGMAS = [
  1.0, 0.9855073094367981, 0.9729729890823364, 0.9473683834075928, 0.9230769276618958,
  0.8659793734550476, 0.800000011920929, 0.5714285969734192, 0.0,
] as const;

/** HyperFlow's trained grid, read from the `hyperflow_sigmas` key of
 * minimax_h3_hyperflow_8step_v1.0.safetensors' own header (VideoRebirthAI/
 * hyperflow), alongside `hyperflow_video_shift: 12` and `audio_shift: 3`. It
 * is the UNSHIFTED grid — drbaph's card quotes it in one place and its
 * shift-12 image (0.99391, 0.98429…) in another; the second is what the
 * sampler must see. */
const HYPERFLOW_BASE_SIGMAS = [
  1.0, 0.931506, 0.839236, 0.703462, 0.5, 0.296538, 0.160764, 0.068494, 0.0,
] as const;
export const HYPERFLOW_SIGMAS = shiftSigmas(HYPERFLOW_BASE_SIGMAS, 12);

/** One bake-off candidate: the tier it competes in, and a recipe per head it
 * fits. A head left out is a head the candidate has no weight for, and asking
 * for it there is refused rather than quietly rendered on the default. */
export interface MinimaxAltDistill {
  tier: "draft" | "standard";
  /** what the Video lab and the take's sidecar call it */
  label: string;
  fl2v?: MinimaxTurboSpec;
  ref2v?: MinimaxTurboSpec;
}

/* The author ships three checkpoints and says to start at step100 and compare
 * the other two, so all three are selectable rather than only the recommended
 * one — the comparison is the point.
 *
 * Keyed by MINIMAX_DISTILL_IDS in shared, so the schema and this table cannot
 * drift: a new id that has no recipe here is a compile error. */
export const MINIMAX_ALT_DISTILL: Record<MinimaxDistillId, MinimaxAltDistill> = {
  "tutu-8step": {
    tier: "standard",
    label: "Tutu 20→8 NFE step100",
    fl2v: {
      file: "tutu-t8-minimax-h3-av-20to8-nfe-lora-step000100-bf16-comfyui.safetensors",
      modelId: "minimax-h3-tutu-8step-lora",
      steps: 8,
      strength: 0.8,
      shiftVideo: 12,
      shiftAudio: 3,
      sampler: "euler",
      sigmas: TUTU_SIGMAS,
    },
  },
  "tutu-8step-200": {
    tier: "standard",
    label: "Tutu 20→8 NFE step200",
    fl2v: {
      file: "tutu-t8-minimax-h3-av-20to8-nfe-lora-step000200-bf16-comfyui.safetensors",
      modelId: "minimax-h3-tutu-8step-lora",
      steps: 8,
      strength: 0.8,
      shiftVideo: 12,
      shiftAudio: 3,
      sampler: "euler",
      sigmas: TUTU_SIGMAS,
    },
  },
  "tutu-8step-300": {
    tier: "standard",
    label: "Tutu 20→8 NFE step300",
    fl2v: {
      file: "tutu-t8-minimax-h3-av-20to8-nfe-lora-step000300-bf16-comfyui.safetensors",
      modelId: "minimax-h3-tutu-8step-lora",
      steps: 8,
      strength: 0.8,
      shiftVideo: 12,
      shiftAudio: 3,
      sampler: "euler",
      sigmas: TUTU_SIGMAS,
    },
  },

  /* The SHIPPED Standard weight under its publisher's own recipe. LightX2V's
   * spec table trains the 768p fl2v distills at video/audio shift 6/3 (the
   * 544p ones at 12/3), the 8-step v1.0 768p release post says 8 steps, shift
   * 6/3, Euler, Simple, and their hosted Studio runs it at 6/3. Aurea's
   * Standard tier has run it at 12/3 on res_multistep — the 544p recipe. This
   * candidate is the control for that mistake: same file, no new download,
   * and if it wins it becomes MINIMAX_TURBO.standard.fl2v. */
  "lightx2v-8step-v1.0-shift6": {
    tier: "standard",
    label: "LightX2V 8-step v1.0 · publisher recipe (shift 6, euler)",
    fl2v: {
      file: "minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors",
      modelId: "minimax-h3-turbo-lora",
      steps: 8,
      strength: 1,
      shiftVideo: 6,
      shiftAudio: 3,
      sampler: "euler",
    },
  },

  /* The 2026-10-20 LightX2V release (discussion #57): "video flow shift of 6"
   * for the new fl2v weights, explicitly not for ref2v. The reference head
   * gets the 8-step v1.0 ref2v rather than v1.1 — its release post gives the
   * recipe (8 steps, 12/3, Euler) and the #57 thread reports v1.1 regressing
   * against it. Either way it is the first TRUE 8-step ref2v: today's
   * Standard on the reference head is the 4-step weight run at 8. */
  "lightx2v-8step-v1.1": {
    tier: "standard",
    label: "LightX2V 8-step fl2v v1.1 + ref2v v1.0",
    fl2v: {
      file: "minimax_h3_fl2v_turbo_8step_v1.1_768p_comfyui_bf16.safetensors",
      modelId: "minimax-h3-turbo-lora-v2",
      steps: 8,
      strength: 1,
      shiftVideo: 6,
      shiftAudio: 3,
      sampler: "euler",
    },
    ref2v: {
      file: "minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors",
      modelId: "minimax-h3-turbo-lora-v2",
      steps: 8,
      strength: 1,
      shiftVideo: 12,
      shiftAudio: 3,
      sampler: "euler",
    },
  },

  /* Draft-tier candidate. v1.2 over v1.1 is LightX2V's "cleaner and more
   * stable audio" release (discussion #52: 4 steps, 6/3, Euler). v1.3 is
   * deliberately NOT here — #57 reports it degrading with sparse attention
   * and other LoRAs unless pushed to strength 2.0, and Aurea runs both. The
   * reference head gets the 768p ref2v 4-step v1.0, at the ref2v 12/3. */
  "lightx2v-4step-v1.2": {
    tier: "draft",
    label: "LightX2V 4-step fl2v v1.2 + ref2v v1.0",
    fl2v: {
      file: "minimax_h3_fl2v_turbo_4step_v1.2_768p_comfyui_bf16.safetensors",
      modelId: "minimax-h3-turbo-lora-v2",
      steps: 4,
      strength: 1,
      shiftVideo: 6,
      shiftAudio: 3,
      sampler: "euler",
    },
    ref2v: {
      file: "minimax_h3_ref2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors",
      modelId: "minimax-h3-turbo-lora-v2",
      steps: 4,
      strength: 1,
      shiftVideo: 12,
      shiftAudio: 3,
      sampler: "euler",
    },
  },

  /* Video Rebirth's HyperFlow, via drbaph's ComfyUI conversion. One weight
   * for both heads (its header lists transformer and transformer_ref). The
   * PRUNED rank-20 file, because Aurea's fast path is the pruned w4a8 base.
   * Caveat that belongs in any verdict: upstream HyperFlow conditions on two
   * times (t and the step's endpoint r) through an extra embedder, and the
   * ComfyUI conversion drops that embedder — so this is HyperFlow's LoRA on
   * HyperFlow's ladder, not the full method. */
  "hyperflow-8step": {
    tier: "standard",
    label: "HyperFlow 8-step (drbaph pruned r20)",
    fl2v: {
      file: "minimax_h3_hyperflow_8step_v1.0_comfyui_pruned_bf16_resized_avg_rank_20_bf16.safetensors",
      modelId: "minimax-h3-hyperflow-lora",
      steps: 8,
      strength: 1,
      shiftVideo: 12,
      shiftAudio: 3,
      sampler: "euler",
      sigmas: HYPERFLOW_SIGMAS,
    },
    ref2v: {
      file: "minimax_h3_hyperflow_8step_v1.0_comfyui_pruned_bf16_resized_avg_rank_20_bf16.safetensors",
      modelId: "minimax-h3-hyperflow-lora",
      steps: 8,
      strength: 1,
      shiftVideo: 12,
      shiftAudio: 3,
      sampler: "euler",
      sigmas: HYPERFLOW_SIGMAS,
    },
  },

  /* drbaph's recommended workflow weight: the v4 step-600 EMA turbo,
   * converted for pruned bases. Its card: 6–8 steps, Euler, BETA scheduler,
   * strength 1.0, video shift 12, audio shift 4–6 (5 here, the middle). Six
   * steps is what makes it interesting — a rung between Draft and Standard.
   * fl2va only; the card makes no claim for the reference head. */
  "drbaph-v4-6step": {
    tier: "standard",
    label: "drbaph v4 step-600 EMA · 6 steps",
    fl2v: {
      file: "minimax_h3_turbo_v4_step600_ema_pruned_comfyui.safetensors",
      modelId: "minimax-h3-turbo-v4-lora",
      steps: 6,
      strength: 1,
      shiftVideo: 12,
      shiftAudio: 5,
      sampler: "euler",
      scheduler: "beta",
    },
  },
};

/** The node KJNodes gives us for an explicit schedule. It splits its input on
 * ", " exactly and skips its own interpolation when the list is already
 * `interpolate_to_steps + 1` long — both of which the builder relies on. */
export const MINIMAX_CUSTOM_SIGMAS_NODE = "CustomSigmas";

/** The camera-motion LoRA, resolved. Strength is clamped by the adapter to
 * the range the author documents (0.8 gentle → 1.0 pronounced; past ~1.2 the
 * weight destabilises faces). */
export interface MinimaxCameraLora {
  lora: string;
  strength: number;
}

/** The trigger phrase the weight was trained on. It must OPEN the prompt —
 * the author is explicit about this, and a trigger buried mid-paragraph is
 * the usual way a LoRA looks like it did nothing. */
export const MINIMAX_CAMERA_TRIGGER = "camera motion";

/** What the adapter hands the graph: the tier's numbers, with `lora` resolved
 * to the combo name THIS install answers with. */
export interface MinimaxTurbo extends Omit<MinimaxTurboSpec, "file"> {
  lora: string;
}

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
  turbo?: MinimaxTurbo,
  endless?: MinimaxEndless,
  evictEncoder = false,
  cameraLora?: MinimaxCameraLora,
): ComfyGraph {
  const N = MINIMAX_NODES;
  /* The model chain, in the Turbo workflow's published order: unet → distill
   * LoRA → attention patch → sigma shift. Everything downstream (guider,
   * scheduler) reads the end of whatever chain this render built. The shift
   * node only exists on the turbo path — the 25-step Final tier renders on the
   * model's own schedule, exactly as it always has. */
  let model: [string, number] = [N.unet, 0];
  const patchNodes: ComfyGraph = {};
  if (turbo) {
    patchNodes[N.turboLora] = {
      class_type: "LoraLoaderModelOnly",
      inputs: { lora_name: turbo.lora, strength_model: turbo.strength, model },
    };
    model = [N.turboLora, 0];
  }
  if (cameraLora) {
    patchNodes[N.cameraLora] = {
      class_type: "LoraLoaderModelOnly",
      inputs: { lora_name: cameraLora.lora, strength_model: cameraLora.strength, model },
    };
    model = [N.cameraLora, 0];
  }
  if (sage) {
    patchNodes[N.sage] = {
      class_type: "PathchSageAttentionKJ",
      inputs: { sage_attention: "auto", allow_compile: false, model },
    };
    model = [N.sage, 0];
  }
  if (turbo) {
    patchNodes[N.sigmaShift] = {
      class_type: "MiniMaxH3SigmaShift",
      inputs: { shift_video: turbo.shiftVideo, shift_audio: turbo.shiftAudio, model },
    };
    model = [N.sigmaShift, 0];
  }
  /* Evict the Qwen3-VL text encoder before the DiT samples.
   *
   * H3 loads three things and ComfyUI 0.32 keeps all three resident: the 32B
   * encoder, the video VAE, and the unet. Measured on the render that took the
   * driver down on 2026-08-30 — 768x1344, 6s, Final, w4a8:
   *
   *   MiniMaxH3TEModel_   9578 MB   loaded completely
   *   MiniMaxH3VideoVAE   2677 MB   staged
   *   MiniMaxH3          11956 MB   staged
   *                     --------
   *                      24211 MB   of a 24564 MB card — 98.6%, weights alone
   *
   * The unet "fits" and the log says so, and then there is nothing left for
   * 158 frames of activations. It faulted at step 13 of 25 with nvlddmkm event
   * 153. On ComfyUI 0.30.2 this did not happen because the encoder WAS evicted
   * ("Unloaded partially: 7523 MB freed"); 0.32's dynamic-VRAM accounting keeps
   * it, which is the regression this undoes.
   *
   * KJ's VRAM_Debug is a pass-through with side effects: `any_input` takes the
   * conditioning, so the graph cannot run it until the prompt is encoded, and
   * `model_pass` carries the model on to the guider, so everything downstream
   * depends on it having happened. unload_all_models drops the unet too — it
   * reloads, from a card with 9.6 GB more room in it, which is the whole point.
   *
   * Dropped silently when the install has no KJNodes, exactly like sage: an
   * unavailable memory saving must not turn a working engine into a failing
   * one. */
  const loader = unetLoaderFor(unetName);
  const evictNodes: ComfyGraph = {};
  if (evictEncoder) {
    evictNodes[N.evict] = {
      class_type: "VRAM_Debug",
      inputs: {
        empty_cache: true,
        gc_collect: true,
        unload_all_models: true,
        model_pass: model,
        any_input: [N.conditioning, 0],
      },
    };
    // 2 = model_pass on VRAM_Debug's RETURN_NAMES
    model = [N.evict, 2];
  }
  return {
    ...evictNodes,
    ...patchNodes,
    [N.unet]: {
      class_type: loader,
      // core's loader takes a dtype it should not be given for a quantized
      // file: "default" is what makes it read the checkpoint's own quant
      // metadata instead of casting the weights to something else
      inputs:
        loader === "UnetLoaderGGUF"
          ? { unet_name: unetName }
          : { unet_name: unetName, weight_dtype: "default" },
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
      /* res_multistep unless the distill riding the unet was trained under a
       * different solver — see MinimaxTurboSpec.sampler. */
      inputs: { sampler_name: turbo?.sampler ?? "res_multistep" },
    },
    /* The ladder. A distill that publishes its own sigmas gets them verbatim
     * (see MinimaxTurboSpec.sigmas); everything else gets BasicScheduler's
     * uniform ramp, which is what it was distilled against. */
    [N.sigmas]: turbo?.sigmas
      ? {
          class_type: MINIMAX_CUSTOM_SIGMAS_NODE,
          inputs: {
            sigmas_string: turbo.sigmas.join(", "),
            interpolate_to_steps: turbo.sigmas.length - 1,
          },
        }
      : {
          class_type: "BasicScheduler",
          inputs: {
            model,
            scheduler: turbo?.scheduler ?? "simple",
            steps,
            denoise: 1,
          },
        },
    /* One node, two behaviours. HREndlessSampler subclasses
     * SamplerCustomAdvanced and takes the same four inputs in the same order,
     * plus what it needs to chunk: the text encoder and video VAE (to build
     * each chunk's continuation reference), the prompt (Gemma re-writes it per
     * chunk), and the frame rate the prompt's timecodes are written against.
     * Its output 0 is the same sampled latent, so nothing downstream moves. */
    [N.sample]: endless
      ? {
          class_type: "HREndlessSampler",
          inputs: {
            noise: [N.noise, 0],
            guider: [N.guider, 0],
            sampler: [N.sampler, 0],
            sigmas: [N.sigmas, 0],
            latent_image: [N.conditioning, 1],
            clip: [N.clip, 0],
            vae: [N.videoVae, 0],
            prompt: endless.prompt,
            fps: MINIMAX_FPS,
            chunk_frames: endless.chunkFrames,
            video_continuation: endless.continuationFrames,
            video_continuation_res: "full",
            // Gemma's static pre-production context, kept in system RAM (never
            // VRAM) so every later chunk skips re-reading the whole plan
            cache_gemma_preproduction: true,
            gemma4_mtp: true,
            /* The node's own defaults, spelled out because ComfyUI does NOT
             * fill a required input in an API graph — it rejects the prompt
             * with "Required input is missing" before anything loads. 0.85
             * leaves 15% of the card outside PyTorch's allocator so pressure
             * lands there rather than on a driver-level OOM; the two debug
             * chunk bounds mean "render all of them". */
            pytorch_memory_fraction: 0.85,
            debug: false,
            debug_stop_chunk: 0,
            debug_start_chunk: 0,
          },
        }
      : {
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
    spec.steps ?? spec.turbo?.steps ?? MINIMAX_FINAL_STEPS,
    spec.filenamePrefix ?? "aurea/h3",
    spec.sage,
    spec.turbo,
    undefined,
    spec.evictEncoder,
    spec.cameraLora,
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
  /** ImageBatch chain, one node per still after the first — the long-form
   * sampler wants every reference image as ONE batch (50..57) */
  batch: (i: number) => String(50 + i),
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
  /** camera-motion LoRA — see MinimaxGraphSpec.cameraLora */
  cameraLora?: MinimaxCameraLora;
  /** the distilled tier — see MinimaxGraphSpec.turbo */
  turbo?: MinimaxTurbo;
  /** long-form — see MinimaxGraphSpec.endless */
  endless?: MinimaxEndless;
  /** see MinimaxGraphSpec.evictEncoder */
  evictEncoder?: boolean;
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
    spec.steps ?? spec.turbo?.steps ?? MINIMAX_FINAL_STEPS,
    spec.filenamePrefix ?? "aurea/h3-ref",
    spec.sage,
    spec.turbo,
    spec.endless,
    spec.evictEncoder,
    spec.cameraLora,
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

  /* Long-form re-tokenizes the prompt for every chunk, and to do that it has to
   * rebuild the reference conditioning from scratch — which it does from the
   * images it is handed, matched one-for-one against the conditioning's own
   * reference list. Hand it the same stills, in the same order, as ONE batch.
   *
   * This is also why a chunked shot runs on THIS head and not fl2va: the
   * finished tail of each chunk is carried into the next as a <Video N>
   * reference, and only ref2va conditioning has that channel. Without it the
   * node stops with "Experimental video conditioning requires positive
   * conditioning from MiniMax H3 Reference to Video". */
  if (spec.endless && spec.refImageNames.length) {
    let images: [string, number] = [R.image(0), 0];
    for (let i = 1; i < spec.refImageNames.length; i++) {
      const id = R.batch(i - 1);
      graph[id] = {
        class_type: "ImageBatch",
        inputs: { image1: images, image2: [R.image(i), 0] },
      };
      images = [id, 0];
    }
    (graph[N.sample].inputs as Record<string, unknown>).images = images;
  }

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
