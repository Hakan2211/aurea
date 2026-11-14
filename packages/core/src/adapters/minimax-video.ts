/* MiniMax-H3 video adapter — prompt (+ optional first/last frame) → an mp4 that
 * already has its soundtrack.
 *
 * This is deliberately NOT a branch of the LTX adapter. Two facts make H3 a
 * different job kind rather than another engine id behind the same pipeline:
 *
 *   1. It emits muxed A/V. Aurea's model everywhere else is "the engine renders
 *      picture, audio is layered after" — voice takes from Chatterbox/DramaBox,
 *      score from ACE-Step, placed on a timeline. H3 sings, speaks and scores in
 *      the same forward pass, so a take handed to it would be ignored. The
 *      adapter says that out loud instead of silently dropping it.
 *   2. It needs ComfyUI 0.30.0+, which the LTX-2.3 install is not. So it queues
 *      on its own instance (settings.engines.minimaxUrl), not comfyUrl.
 *
 * Cost of that power, measured on this machine's class of card: H3 is roughly
 * an order of magnitude slower than LTX-2.3 per second of output. It is the
 * hero-shot engine, not the default one. */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Job, JobPayload, MinimaxRefs, MinimaxRefVideo } from "@aurea/shared";
import { hasMinimaxRefs, minimaxRefLabels, unknownMinimaxRefTags, withStyleRefs } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import type { ModelManager } from "../models/manager.js";
import { ComfyClient } from "../comfy/client.js";
import type { ComfyService } from "../comfy/service.js";
import {
  MINIMAX_FINAL_STEPS,
  MINIMAX_FPS,
  MINIMAX_H3_CONVENTIONAL,
  MINIMAX_H3_MANAGED,
  MINIMAX_H3_REF_CONVENTIONAL,
  MINIMAX_H3_REF_MANAGED,
  MINIMAX_H3_REF_W4A8,
  MINIMAX_H3_W4A8,
  MINIMAX_TRAINED_MAX_SEC,
  MINIMAX_TURBO,
  MINIMAX_ALT_DISTILL,
  MINIMAX_CAMERA_TRIGGER,
  MINIMAX_CUSTOM_SIGMAS_NODE,
  ENDLESS_CONTINUATION_FRAMES,
  draftCanvas,
  endlessChunkFrames,
  estimateRenderMinutes,
  frameLength,
  needsEndless,
  minimaxH3Graph,
  minimaxH3RefGraph,
  unetLoaderFor,
  type MinimaxCameraLora,
  type MinimaxEndless,
  type MinimaxTurbo,
  type MinimaxTurboSpec,
} from "../comfy/minimax-graphs.js";
import { probeMedia, type MediaProbe } from "./ffmpeg-export.js";
import { jobRunDir } from "./proc.js";
import type { JobResources } from "../scheduler.js";
import type { AdapterProgress, AdapterRun, EngineAdapter } from "./types.js";

const VIDEO_EXT = /\.(mp4|webm|mov)$/i;

/** the model id in models/registry.ts */
export const MINIMAX_MODEL_ID = "minimax-h3-gguf";
/** the ref2va head — a second 15.6 GB checkpoint, downloaded separately */
export const MINIMAX_REF_MODEL_ID = "minimax-h3-ref-gguf";
/** the Turbo distill LoRAs behind Draft and Standard */
export const MINIMAX_TURBO_MODEL_ID = "minimax-h3-turbo-lora";
/** Jojocodex's camera-motion LoRA — H3's only camera control */
export const MINIMAX_CAMERA_MODEL_ID = "minimax-h3-camera-lora";
/** the weight the adapter loads; the 1000-step file ships beside it for A/B */
const MINIMAX_CAMERA_FILE = "camera_motion_h3_lora_v1_3000_pruned.safetensors";
/** the author's stable range: 0.8 gentle, 1.0 pronounced, past ~1.2 unstable */
const MINIMAX_CAMERA_STRENGTH = { min: 0.6, max: 1.1 };

/* The payload's camera moves are LTX's vocabulary (the Lightricks LoRA set);
 * the H3 weight was trained on its own words. Translating rather than passing
 * the id through is the difference between a steered move and a phrase the
 * model has never seen. "pan" is deliberately absent: the enum has no pan, and
 * the author rates it the weakest move anyway. */
const MINIMAX_CAMERA_PHRASE: Record<string, string> = {
  "dolly-in": "push-in",
  "dolly-out": "pull-back",
  "dolly-left": "handheld tracking to the left",
  "dolly-right": "handheld tracking to the right",
  "jib-up": "crane up",
  "jib-down": "crane down",
  static: "locked-off camera, no movement",
};
/** the same two heads in 4-bit/int8. Preferred over the GGUF when present —
 * see modelNames(); the GGUF entry stays the one that carries the text encoder
 * and the audio VAE either way. */
export const MINIMAX_W4A8_MODEL_ID = "minimax-h3-w4a8";
export const MINIMAX_REF_W4A8_MODEL_ID = "minimax-h3-ref-w4a8";

/** Where "a long render" becomes "a render that will not survive". Not a model
 * limit — a 24 GB card's limit, and the point past which the estimate itself
 * stops being trustworthy because the DiT is paging (see estimateRenderMinutes).
 *
 * Drawn at 40 rather than a rounder 60 because 60 does not catch the shot that
 * actually died: 1024x1024 x 192 frames x 25 steps estimates at 44 minutes and
 * took the driver down after 54. Checked against what this line lets through,
 * which is the real test of it — a 4s Final take on the native 1344x768 canvas
 * (~25 min) and a full 15s Draft (~27 min) are both allowed. H3 is the
 * hero-shot engine and slow is allowed; this is only where slow turns into
 * lost.
 *
 * Note what it does NOT catch, because the estimate is a wall-clock model and
 * this is a memory problem: at the native canvas the GGUF unet already offloads
 * 1.2 GB at 4.5s and 5.8 GB at 8s (scripts/h3-fit.mts, 2026-08-30). Those
 * renders finish — slowly — and are meant to. The w4a8 set is what actually
 * moves that line; this one only stops the render that would not come back. */
const MAX_ESTIMATED_MINUTES = 40;

/** The same line for a chunked render, which is allowed to be long because
 * being long is the whole feature — this only catches a mistyped length before
 * it eats a night. */
const MAX_LONG_FORM_MINUTES = 6 * 60;

/** Gemma's re-planning pass between chunks: a 12B model in its own process,
 * asked for one rewrite, unloaded again before H3 comes back.
 *
 * Measured on this box, 2026-08-30, with llama.cpp on the CPU (see
 * LLAMA_CPP_INDEX for why it is not on the GPU): the pre-production plan took
 * 6m19s and a per-chunk rewrite 5–25 minutes at ~5 tokens/s. On a 20-second
 * two-chunk shot that is MORE wall clock than the sampling. So this number is
 * the planner's, not a rounding allowance — and if long-form is going to be
 * used in anger, a llama.cpp build this CPU can run on the GPU is the thing to
 * fix first. */
const GEMMA_PER_CHUNK_SEC = 15 * 60;

/** Find a LoRA in the install's own combo list by file name.
 *
 * Resolved from the combo rather than composed: ComfyUI validates lora_name
 * against a directory walk that arrives with backslash separators on Windows,
 * so a composed forward-slash path is rejected before the render starts. The
 * match is on the base name because the same file can sit at the root of a
 * hand-managed loras folder or under "<model-id>/loras/" in ours.
 *
 * It used to be one loose /minimax.h3.turbo/ regex, which was fine while there
 * was exactly one turbo weight; the registry now carries a 4-step, an 8-step,
 * a ref2v and an SLA variant, and "the first one that matches" would silently
 * render the 8-step distill at 4 steps. */
export const findLora = (options: string[], file: string): string | undefined =>
  options.find((o) => o.split(/[\\/]/).pop()?.toLowerCase() === file.toLowerCase());

/** Which distill this render is on.
 *
 * The default is the shipped LightX2V weight for the tier and head. A payload
 * may name a candidate instead — that is the A/B queue's knob — but only where
 * that candidate has a recipe: each one declares its tier and the heads it
 * has a weight for. Asking for it anywhere else is a request nobody can
 * honour. Refusing is the point; falling back would report a comparison
 * between the default and itself. */
export function resolveDistill(
  payload: Pick<Extract<JobPayload, { type: "video" }>, "minimaxDistill">,
  tier: "draft" | "standard",
  refs: boolean,
): MinimaxTurboSpec {
  const head = refs ? "ref2v" : "fl2v";
  const wanted = payload.minimaxDistill;
  if (!wanted) return MINIMAX_TURBO[tier][head];
  const cand = MINIMAX_ALT_DISTILL[wanted];
  const tierName = (t: string) => t[0]!.toUpperCase() + t.slice(1);
  if (cand.tier !== tier) {
    throw new Error(
      `The "${wanted}" distill (${cand.label}) is a ${tierName(cand.tier)}-tier candidate and ` +
        `this render is ${tierName(tier)} — set Quality to ${tierName(cand.tier)}.`,
    );
  }
  const spec = cand[head];
  if (!spec) {
    throw new Error(
      `The "${wanted}" distill (${cand.label}) has no weight for H3's ` +
        `${refs ? "reference (ref2va)" : "first/last-frame (fl2va)"} head — ` +
        (refs ? "drop the references" : "attach references") +
        ", or clear the distill.",
    );
  }
  return spec;
}

/** Only 0.30.0+ carries comfy/ldm/minimax. Below that the MiniMaxH3ImageToVideo
 * node simply isn't registered, and CLIPLoaderGGUF's "minimax" type falls back
 * to STABLE_DIFFUSION — which does not fail, it just encodes garbage. Checking
 * for the node is the honest gate. */
const MINIMAX_NODES_REQUIRED = ["MiniMaxH3ImageToVideo", "CLIPLoaderGGUF"];

/** the reference path adds the ref2va node and the three loaders that feed it */
const MINIMAX_REF_NODES_REQUIRED = [
  "MiniMaxH3ReferenceToVideo",
  "LoadVideo",
  "GetVideoComponents",
  "LoadAudio",
  "CLIPLoaderGGUF",
];

/* CLIPLoaderGGUF is on both lists because the text encoder is GGUF whatever
 * the unet is — the 32B Qwen3-VL only ships quantized. The UNET loader is NOT,
 * because which one this render needs depends on the weights it resolved:
 * UnetLoaderGGUF for the GGUF checkpoints, core's own UNETLoader for w4a8. The
 * adapter appends whichever it is (see unetLoaderFor). */

/** Reference clips are re-encoded before they are uploaded, for three reasons
 * that all bite quietly rather than loudly:
 *
 *  - H3 reads a reference at 24 fps. Hand it 30 fps footage and every motion it
 *    copies runs 25% slow; nothing errors.
 *  - Every reference frame is VAE-encoded and rides through EVERY sampling
 *    step. An untrimmed clip is not a pointer, it is a second render's worth of
 *    tokens on a card that already holds 24 GB of weights.
 *  - The node crops a reference to the take's own frame count anyway, so
 *    anything past that was decoded for nothing. */
const REF_SHORT_EDGE = 768;

/** Trim, retime and downscale one reference clip. Returns the prepared file. */
async function prepareRefVideo(
  src: string,
  out: string,
  ref: MinimaxRefVideo,
  probe: MediaProbe,
  maxLengthSec: number,
  keepAudio: boolean,
): Promise<void> {
  const lengthSec = Math.min(ref.lengthSec, maxLengthSec);
  const scale =
    probe.width && probe.height
      ? Math.min(1, REF_SHORT_EDGE / Math.min(probe.width, probe.height))
      : 1;
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);

  const args = [
    "-y",
    "-v",
    "error",
    // seek before -i so a 40-second take doesn't get decoded to reach 30s in
    "-ss",
    ref.startSec.toFixed(3),
    "-i",
    src,
    "-t",
    lengthSec.toFixed(3),
    "-vf",
    `fps=${MINIMAX_FPS}${
      scale < 1 && probe.width && probe.height
        ? `,scale=${even(probe.width * scale)}:${even(probe.height * scale)}`
        : ""
    }`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "veryfast",
  ];
  if (keepAudio) args.push("-c:a", "aac", "-ac", "2");
  else args.push("-an");
  args.push(out);

  fs.mkdirSync(path.dirname(out), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    execFile("ffmpeg", args, { windowsHide: true, maxBuffer: 8 << 20 }, (err, _stdout, stderr) => {
      if (err) {
        const tail = String(stderr).trim().split(/\r?\n/).slice(-3).join(" ");
        reject(
          new Error(
            `Could not prepare the reference clip ${path.basename(src)} with ffmpeg — ` +
              `is ffmpeg installed and on PATH? ${tail}`,
          ),
        );
        return;
      }
      resolve();
    });
  });
  if (!fs.existsSync(out)) throw new Error("ffmpeg reported success but wrote no reference clip");
}

/** What the reference set asks for, stated in one line for the job card and
 * the render log. */
function describeRefs(refs: MinimaxRefs): string {
  return (
    [
      refs.images.length ? `${refs.images.length} still${refs.images.length === 1 ? "" : "s"}` : "",
      refs.videos.length ? `${refs.videos.length} clip${refs.videos.length === 1 ? "" : "s"}` : "",
      refs.audios.length ? `${refs.audios.length} sound` : "",
    ]
      .filter(Boolean)
      .join(" + ") || "no references"
  );
}

/* On memory: the Q3_K_M unet is 15.6 GB and the Q2_K text encoder 8.5 GB, but
 * ComfyUI loads and frees them in SEQUENCE — measured 2026-08-05, the encoder
 * took 8.3 GB, then "Unloaded partially: 7523 MB freed" before the unet came
 * in — so peak is the larger one plus headroom, not the sum. That is what
 * makes 24 GB enough. It is deliberately NOT declared to the scheduler; see
 * resources(). */

/** Which loader names to send. A run against our own model store uses the
 * nested "<model-id>/<category>/<file>" names; a linked root that already had
 * the weights keeps the conventional flat ones.
 *
 * The w4a8 set, when it is installed, replaces two of the four names — the
 * unet and the video VAE — and leaves the text encoder and audio VAE on the
 * GGUF entry, which is the only place they ship. It wins automatically rather
 * than through a setting: it is the same model, smaller and faster, and a knob
 * for "use the slow copy of the weights you also downloaded" would be a knob
 * nobody should ever touch. Deleting the entry in Settings → Models is how you
 * go back.
 *
 * Free functions rather than adapter methods because the coverage pass runs
 * the same weights through a different graph, and two copies of this
 * resolution is exactly the kind of thing that drifts. */
export function minimaxModelNames(models: ModelManager) {
  const base = models.managedCopy(MINIMAX_MODEL_ID)
    ? MINIMAX_H3_MANAGED
    : MINIMAX_H3_CONVENTIONAL;
  return models.ready(MINIMAX_W4A8_MODEL_ID) ? { ...base, ...MINIMAX_H3_W4A8 } : base;
}

/** The reference head is its own registry entry, so it can be linked while the
 * base set is managed (or the other way round) — resolve each on its own
 * rather than assuming both came from the same place.
 *
 * The two heads can also be in different FORMATS: the w4a8 fl2va can be
 * installed while ref2va is still GGUF. Mixing is fine — they are never loaded
 * together — so each head takes the best copy it has. */
export function minimaxRefModelNames(models: ModelManager) {
  const base = minimaxModelNames(models);
  if (models.ready(MINIMAX_REF_W4A8_MODEL_ID)) {
    return { ...base, refUnet: MINIMAX_H3_REF_W4A8 };
  }
  return {
    ...base,
    refUnet: models.managedCopy(MINIMAX_REF_MODEL_ID)
      ? MINIMAX_H3_REF_MANAGED
      : MINIMAX_H3_REF_CONVENTIONAL,
  };
}

export class MinimaxVideoAdapter implements EngineAdapter {
  id = "minimax-video";

  constructor(
    private settings: SettingsStore,
    private models: ModelManager,
    /** only for resolving WHERE H3 runs — H3 never uses the managed sidecar,
     * so this never boots anything (see ComfyService.minimaxUrl) */
    private comfy: ComfyService,
  ) {}

  canRun(job: Job): boolean {
    return job.payload?.type === "video" && job.payload.engine === "minimax-h3";
  }

  resources(job: Job): JobResources {
    void job;
    /* Shares the "comfy" engine id with LTX on purpose: both want the whole
     * GPU, and two 20 GB models racing for 24 GB is how you OOM a queue.
     *
     * No vramGb, though. H3 only ever runs on an EXTERNAL ComfyUI — that is
     * the whole reason it has its own URL — and an external instance owns its
     * memory: it holds the last model resident and frees it when the next one
     * needs room. Declaring 21 GB here makes the scheduler preflight against
     * free VRAM it does not control, so the second H3 job of a session sits in
     * "Waiting for VRAM" forever behind the weights the FIRST one left warm.
     * (Found exactly that way, 2026-08-05.) Same reasoning the LTX adapter
     * uses for its own external mode. */
    return { klass: "gpu", engineId: "comfy" };
  }

  /** Which loader names to send. A run against our own model store uses the
   * nested "<model-id>/<category>/<file>" names; a linked root that already had
   * the weights keeps the conventional flat ones.
   *
   * The w4a8 set, when it is installed, replaces two of the four names — the
   * unet and the video VAE — and leaves the text encoder and audio VAE on the
   * GGUF entry, which is the only place they ship. It wins automatically
   * rather than through a setting: it is the same model, smaller and faster,
   * and a knob for "use the slow copy of the weights you also downloaded"
   * would be a knob nobody should ever touch. Deleting the entry in Settings →
   * Models is how you go back. */
  private modelNames() {
    return minimaxModelNames(this.models);
  }

  /** The reference head is its own registry entry, so it can be linked while
   * the base set is managed (or the other way round) — see
   * minimaxRefModelNames. */
  private refModelNames() {
    return minimaxRefModelNames(this.models);
  }

  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun {
    const ctrl = new AbortController();

    const done = (async () => {
      const payload = job.payload;
      if (payload?.type !== "video") throw new Error("not a video job");
      const { storage } = this.settings.get();

      // empty minimaxUrl = "same ComfyUI as LTX" (see ComfyService.minimaxUrl),
      // and on a managed engine that server is ours to start
      const url = await this.comfy.minimaxUrlEnsured();
      if (!url) {
        throw new Error(
          "MiniMax-H3 has no ComfyUI to run on. It needs ComfyUI 0.30.0 or newer — the same " +
            "install LTX-2.3 uses will do, since the MiniMaxH3 nodes ship in that core. Start " +
            "it, or give H3 its own address in Settings → Engines → MiniMax-H3 ComfyUI URL.",
        );
      }

      if (payload.director) {
        throw new Error(
          "The Shot Director timeline is an LTX-2.3 feature — it places voice takes and " +
            "keyframes on a track H3 doesn't have. Render this shot on LTX-2.3, or describe " +
            "the beats and the dialogue inside the H3 prompt instead.",
        );
      }
      if (payload.audio) {
        throw new Error(
          "MiniMax-H3 generates its own dialogue, sound effects and music in the same pass " +
            "as the picture — it can't be driven by a voice take the way LTX's ia2v can. " +
            "Put the line in the prompt under an \"Audio:\" heading, or switch to LTX-2.3.",
        );
      }
      /* LTX-only knobs — refuse rather than quietly render something else
       * than what was asked for */
      if (payload.keyframes.length) {
        throw new Error(
          "Mid-shot keyframes are an LTX-2.3 feature. H3 takes a first and/or last frame " +
            "(fl2va) or references (ref2va) — describe the mid-shot beats in the prompt's " +
            "Timeline: block instead.",
        );
      }
      if (payload.loras.length) {
        throw new Error(
          "Style/subject LoRA adapters load on the LTX pipeline — H3's only adapter is the " +
            "camera-motion LoRA, which rides `cameraLora`. Describe anything else in the prompt.",
        );
      }
      if (payload.fps !== 24) {
        throw new Error(
          `MiniMax-H3 renders at 24 fps only — ${payload.fps} fps is an LTX-2.3 option.`,
        );
      }
      /* Three rungs, not two: 4-step Draft, 8-step Standard, 25-step Final.
       * `fast` is what the older payloads carry and what LTX still speaks, so
       * it is the fallback rather than a second source of truth. */
      const tier: "draft" | "standard" | "final" =
        payload.minimaxTier ?? (payload.fast ? "draft" : "final");
      if (tier !== "final" && !this.models.ready(MINIMAX_TURBO_MODEL_ID)) {
        throw new Error(
          `${tier === "draft" ? "Draft" : "Standard"} on H3 renders with a distilled LoRA ` +
            `(${MINIMAX_TURBO[tier].fl2v.steps} steps instead of ${MINIMAX_FINAL_STEPS}) — ` +
            "Settings → Models → MiniMax-H3 Turbo LoRAs, or switch Quality back to Final.",
        );
      }
      if (!this.models.ready(MINIMAX_MODEL_ID) && !this.models.ready(MINIMAX_W4A8_MODEL_ID)) {
        throw new Error(
          "MiniMax-H3 weights are not installed — Settings → Models → MiniMax-H3 (GGUF), " +
            "or link a folder that already has them.",
        );
      }
      /* The w4a8 entry ships a unet and a video VAE, nothing else: the text
       * encoder and the audio VAE only exist in the GGUF entry, and a graph
       * that names a file no install has fails inside the loader. */
      if (this.models.ready(MINIMAX_W4A8_MODEL_ID) && !this.models.ready(MINIMAX_MODEL_ID)) {
        throw new Error(
          "MiniMax-H3 (w4a8) is only the unet and the video VAE — the Qwen3-VL text encoder " +
            "and the audio VAE come from the MiniMax-H3 (GGUF) entry. Install that one too.",
        );
      }

      /* Reference mode is a different checkpoint on the same encoder and VAEs,
       * reached through a different node. Everything below decides which of
       * the two heads this job is for, and refuses the combinations that would
       * quietly render the wrong thing. */
      const refs = hasMinimaxRefs(payload.minimaxRefs) ? payload.minimaxRefs : null;
      /* a still with the `style` role is reference footage, never a character:
       * its clause goes on HERE, before the tag check, so a prompt that only
       * names the subject still tells the model what the picture is FOR
       * (freeform plan §2.4) and the style tag counts as named */
      const styledPrompt = withStyleRefs(payload.prompt, refs);
      if (refs) {
        if (!this.models.ready(MINIMAX_REF_MODEL_ID)) {
          throw new Error(
            "References need H3's ref2va head — a second 15.6 GB checkpoint alongside the base " +
              "weights. Settings → Models → MiniMax-H3 Reference (GGUF), or render this shot " +
              "without references.",
          );
        }
        if (payload.startFrame || payload.endFrame) {
          throw new Error(
            "H3's reference mode has no keyframe track — ref2va conditions on references, not on " +
              "a first/last frame. Add that still as a reference image instead (it becomes " +
              "<Picture 1>) and name it in the prompt, or clear the references to render fl2va.",
          );
        }
        const missing = unknownMinimaxRefTags(styledPrompt, refs);
        if (missing.length) {
          const labels = minimaxRefLabels(refs);
          throw new Error(
            `The prompt refers to ${missing.join(", ")}, which this shot doesn't have. ` +
              `Its references are ${labels.all.join(", ") || "none"} — note that a clip's own ` +
              "soundtrack takes an <Audio> number of its own, before any standalone sound.",
          );
        }
      }

      /* H3's own floor is 4s and its trained ceiling ~15s; the shorter side is
       * 768 by design. A 2s request would snap up to 5 frames of nothing, so
       * say so rather than render a fifth of a second. */
      if (payload.durationSec < 4) {
        throw new Error(
          `MiniMax-H3 renders 4–15 second shots — ${payload.durationSec}s is below the model's ` +
            "floor. Ask for 4s or more, or render the beat on LTX-2.3.",
        );
      }

      const client = new ComfyClient(url);
      if (!(await client.health())) {
        throw new Error(
          `MiniMax-H3's ComfyUI is not reachable at ${url} — start it and try again.`,
        );
      }
      /* Which weights this render resolved to, and therefore which loader
       * node it needs on the far end. The two heads are separate entries and
       * can be in separate formats, so the head decides. */
      const refModels = this.refModelNames();
      const models = this.modelNames();
      const unetLoader = unetLoaderFor(refs ? refModels.refUnet : models.unet);
      /* "this render is on the 4-bit weights" — reported on the take. Read off
       * the resolved unet rather than off the model manager, because the two
       * heads can be in different formats and only one of them is loading. */
      const w4a8 = unetLoader === "UNETLoader";
      const required = [
        ...(refs ? MINIMAX_REF_NODES_REQUIRED : MINIMAX_NODES_REQUIRED),
        unetLoader,
      ];
      if (!(await client.hasNodes(required))) {
        throw new Error(
          `The ComfyUI at ${url} doesn't have the MiniMax-H3 nodes${
            refs ? " for reference mode (MiniMaxH3ReferenceToVideo)" : ""
          }. They ship with ComfyUI 0.30.0+ and the GGUF loaders come from the ComfyUI-GGUF ` +
            "pack — check both, restart it, and try again.",
        );
      }

      const seed = payload.seed ?? Math.floor(Math.random() * 1_000_000_000);
      const size = payload.resolution.match(/(\d+)\s*[×x]\s*(\d+)/);
      const requested: [number, number] = size
        ? [Number(size[1]), Number(size[2])]
        : [1344, 768];
      /* Draft's 4-step distill has a published failure above ~1 MPx (corrupted
       * audio + ghosting), and the default canvas sits at 1.03 — scale a hot
       * Draft down to the distill's safe area rather than render the artifact.
       * See draftCanvas; the queue detail says when this happened. */
      const [width, height] =
        tier === "draft" ? draftCanvas(...requested) : requested;
      const draftScaled = width !== requested[0] || height !== requested[1];

      /* Long-form. Past one chunk's worth of latent the plain sampler simply
       * cannot hold the shot, so it is chunked — which is a different node,
       * a Gemma pass between every chunk, and a wall clock measured in the
       * number of chunks rather than in seconds of output. Decided from the
       * arithmetic rather than from a switch: a shot that fits must never pay
       * for any of it. */
      const chunkFrames = endlessChunkFrames(width, height, w4a8 ? "w4a8" : "gguf");
      const long = needsEndless(width, height, payload.durationSec);
      if (long && !(await client.hasNode("HREndlessSampler"))) {
        throw new Error(
          `A ${payload.durationSec}s shot is past MiniMax-H3's own ${MINIMAX_TRAINED_MAX_SEC}s ` +
            "window, so it has to be sampled in chunks. Install the long-form sampler " +
            "(Settings → Engines → Engine runtime), or shorten the shot.",
        );
      }
      /* A chunked shot runs on the REFERENCE head, always.
       *
       * Not a policy — the mechanism. Each finished chunk is carried into the
       * next as H3's own <Video N> reference, and only ref2va conditioning has
       * that channel; on fl2va the sampler stops with "Experimental video
       * conditioning requires positive conditioning from MiniMax H3 Reference
       * to Video". It also re-tokenizes the prompt for every chunk, rebuilding
       * the reference conditioning from the images it is handed — so there has
       * to be at least one still, and it cannot rebuild a clip or a standalone
       * sound at all. */
      if (long) {
        if (!refs || !refs.images.length) {
          throw new Error(
            `Past ${MINIMAX_TRAINED_MAX_SEC}s a shot is sampled in chunks, and the chunk sampler ` +
              "hands each finished chunk to the next through H3's reference channel — which " +
              "means it renders on the reference head and needs at least one reference image to " +
              "anchor on. Add the opening still as a reference (it becomes <Picture 1>), or " +
              `shorten the shot to ${MINIMAX_TRAINED_MAX_SEC}s.`,
          );
        }
        if (refs.videos.length || refs.audios.length) {
          throw new Error(
            "A chunked shot can only carry reference STILLS — the sampler rebuilds the " +
              "reference conditioning for every chunk from the images it is given, and it " +
              "cannot rebuild a clip or a standalone sound. Drop those, or render this one at " +
              `${MINIMAX_TRAINED_MAX_SEC}s or under.`,
          );
        }
      }

      /* SageAttention — settings say "wanted", the install says "possible".
       * When the KJ node is missing on THIS ComfyUI the toggle is dropped
       * silently like chunkFeedForward is on the LTX side: an unavailable
       * speed-up must not turn a working engine into a failing one. */
      const sage =
        this.settings.get().engines.minimaxTuning.sageAttention &&
        (await client.hasNode("PathchSageAttentionKJ"));

      /* Free the 9.6 GB text encoder before the DiT samples. Not a toggle:
       * H3's three models come to 24.2 GB of a 24.5 GB card on this box, the
       * encoder has no job left once the prompt is encoded, and keeping it is
       * what took the driver down on 2026-08-30 (see the comment in
       * minimaxScaffold). Dropped silently when KJNodes isn't there. */
      const evictEncoder = await client.hasNode("VRAM_Debug");

      /* Draft and Standard = a distill riding the unet. Unlike sage this
       * REFUSES when the install can't do it: a silently-dropped speed toggle
       * would deliver a 25-step render the user budgeted 4 steps of waiting
       * for. The name comes from the install's own walk (see findLora); the
       * ready() preflight above already vouched the weight was downloaded, so
       * a miss here means this ComfyUI can't see our store — say which.
       *
       * Which weight depends on the HEAD as well as the tier: LightX2V train
       * fl2v and ref2v distills separately, and the wrong one on a head is a
       * LoRA whose keys mostly don't land. */
      let turbo: MinimaxTurbo | undefined;
      if (tier !== "final") {
        const spec: MinimaxTurboSpec = resolveDistill(payload, tier, !!refs);
        if (spec.modelId && !this.models.ready(spec.modelId)) {
          throw new Error(
            `That render asks for the "${payload.minimaxDistill}" distill, whose weights are ` +
              `not installed — Settings → Models → ${spec.modelId}. Clear the distill to ` +
              "render on the shipped LightX2V weight instead.",
          );
        }
        /* A published sigma ladder is not optional decoration: the weight was
         * distilled against it and its card says a uniform ramp is not a
         * substitute. If this install cannot supply one, refuse — rendering
         * on the wrong ladder and calling it that distill is how a bake-off
         * produces a confident wrong answer. */
        if (spec.sigmas && !(await client.hasNode(MINIMAX_CUSTOM_SIGMAS_NODE))) {
          throw new Error(
            `The "${payload.minimaxDistill}" distill ships a fixed ${spec.sigmas.length}-sigma schedule, and ` +
              `supplying it needs KJNodes' ${MINIMAX_CUSTOM_SIGMAS_NODE} node, which the ` +
              `ComfyUI at ${url} doesn't have. Install ComfyUI-KJNodes, or clear the distill.`,
          );
        }
        const options = await client.comboOptions("LoraLoaderModelOnly", "lora_name");
        const lora = findLora(options, spec.file);
        if (!lora) {
          throw new Error(
            `${spec.file} is downloaded but the ComfyUI at ${url} doesn't list it in its ` +
              "lora folder — it scans folders at startup, so restart it (or check that this " +
              "install mounts Aurea's model store) and try again.",
          );
        }
        if (!(await client.hasNode("MiniMaxH3SigmaShift"))) {
          throw new Error(
            `The ComfyUI at ${url} has no MiniMaxH3SigmaShift node — the distilled tiers need ` +
              "the sigma shift they were trained around. The node ships with ComfyUI 0.30.2+; " +
              "update that install, or switch Quality back to Final.",
          );
        }
        const { file: _file, ...rest } = spec;
        turbo = { ...rest, lora };
      }

      /* H3's camera control. Two things have to be true at once for it to do
       * anything: the weight rides the unet, AND the trigger phrase opens the
       * prompt — the author is explicit that `camera motion` must come first,
       * and a trigger buried mid-paragraph is the usual reason a LoRA looks
       * like it loaded and did nothing. So the prompt is rewritten here rather
       * than trusted to whoever wrote it. */
      let cameraLora: MinimaxCameraLora | undefined;
      let prompt = styledPrompt;
      if (payload.cameraLora) {
        if (!this.models.ready(MINIMAX_CAMERA_MODEL_ID)) {
          throw new Error(
            "Camera control on H3 needs the MiniMax-H3 Camera Motion LoRA — Settings → Models, " +
              "or clear the camera move and describe it in the prompt instead.",
          );
        }
        const options = await client.comboOptions("LoraLoaderModelOnly", "lora_name");
        const found = findLora(options, MINIMAX_CAMERA_FILE);
        if (!found) {
          throw new Error(
            `${MINIMAX_CAMERA_FILE} is downloaded but the ComfyUI at ${url} doesn't list it in ` +
              "its lora folder — restart that install (it scans folders at startup) and try again.",
          );
        }
        cameraLora = {
          lora: found,
          strength: Math.min(
            MINIMAX_CAMERA_STRENGTH.max,
            Math.max(MINIMAX_CAMERA_STRENGTH.min, payload.cameraLora.strength),
          ),
        };
        const phrase = MINIMAX_CAMERA_PHRASE[payload.cameraLora.move];
        const opener = [MINIMAX_CAMERA_TRIGGER, phrase].filter(Boolean).join(", ");
        prompt = prompt.toLowerCase().startsWith(MINIMAX_CAMERA_TRIGGER)
          ? prompt
          : `${opener}. ${prompt}`;
      }

      /* The one request shape that reliably breaks H3 is a big canvas at full
       * length and full steps, and nothing about the Video lab makes that
       * look expensive — resolution, length and Quality are three unrelated
       * controls, and their product is what the card has to survive. A
       * 1024x1024 8s Final take is 192 frames x 25 steps: on this class of
       * card the DiT no longer fits beside its own text encoder, pages to
       * system RAM, and spends the better part of an hour there. (2026-08-23:
       * that exact request took the GPU driver down at step 3 of 25, and
       * because a dead ComfyUI answers nothing rather than answering an error,
       * the job sat on "Rendering" until it was cancelled by hand.)
       *
       * So refuse it before the upload, and refuse it with the arithmetic —
       * the levers are obvious once the three numbers are on the same line. */
      const frames = frameLength(payload.durationSec);
      const steps = turbo?.steps ?? MINIMAX_FINAL_STEPS;
      const endless: MinimaxEndless | undefined = long
        ? {
            chunkFrames,
            continuationFrames: ENDLESS_CONTINUATION_FRAMES,
            // the chunked sampler re-reads the prompt per chunk — it has to be
            // the rewritten one, or the trigger only opens the first chunk
            prompt,
          }
        : undefined;
      const chunks = long ? Math.ceil(frames / chunkFrames) : 1;

      /* What the ceiling below is actually protecting against is ONE pass that
       * doesn't fit — the DiT paging to system RAM and taking the driver with
       * it. Chunking is the fix for exactly that, so on a long shot the unit
       * that has to survive is a chunk, not the whole render, and the total is
       * allowed to be long because being long is the point. It still gets a
       * ceiling of its own, several hours out, so a mistyped length is caught
       * before it eats a night. */
      const chunkMinutes = estimateRenderMinutes(
        width,
        height,
        Math.min(frames, chunkFrames),
        steps,
      );
      const estMinutes = chunkMinutes * chunks + (long ? (chunks * GEMMA_PER_CHUNK_SEC) / 60 : 0);
      if (long && estMinutes > MAX_LONG_FORM_MINUTES) {
        throw new Error(
          `That shot is about ${Math.round(estMinutes / 60)} hours of rendering — ` +
            `${chunks} chunks of ${chunkFrames} frames at ${width}x${height} x ${steps} steps. ` +
            "Shorten it, drop to H3's native 1344x768, or turn Quality down.",
        );
      }
      if (!long && chunkMinutes > MAX_ESTIMATED_MINUTES) {
        const draftSteps = MINIMAX_TURBO.draft[refs ? "ref2v" : "fl2v"].steps;
        const draftMinutes = estimateRenderMinutes(width, height, frames, draftSteps);
        throw new Error(
          `That shot is about ${Math.round(chunkMinutes)} minutes of rendering — ` +
            `${width}x${height} x ${frames} frames x ${steps} steps. Past roughly ` +
            `${MAX_ESTIMATED_MINUTES} minutes H3 stops fitting on a 24 GB card and ` +
            "starts paging to system RAM, which is slower again and is where renders " +
            "die rather than finish. " +
            (tier === "draft"
              ? "Shorten the shot or drop to H3's native 1344x768."
              : `Turn Quality down to Draft (~${Math.round(draftMinutes)} min), ` +
                "shorten the shot, or drop to H3's native 1344x768."),
        );
      }

      report({ progress: 2, stage: "Staging inputs" });
      const stage = async (rel: string, tag: string, what: string) => {
        const file = path.join(storage.dataRoot, rel);
        if (!fs.existsSync(file)) throw new Error(`${what} not found: ${rel}`);
        return client.uploadInput(`${job.id}-${tag}${path.extname(file)}`, fs.readFileSync(file));
      };

      let graph;
      if (refs) {
        report({ progress: 3, stage: "Staging references", detail: describeRefs(refs) });

        const refImageNames: string[] = [];
        for (const [i, rel] of refs.images.entries()) {
          refImageNames.push(await stage(rel, `ref-image-${i}`, `reference image ${i + 1}`));
        }

        /* A clip is trimmed and retimed HERE rather than by the graph: the
         * node takes raw frames, and everything it would do with a 40-second
         * 30 fps take is decode it and throw most of it away. */
        const refVideos: { file: string; withAudio: boolean }[] = [];
        for (const [i, ref] of refs.videos.entries()) {
          const src = path.join(storage.dataRoot, ref.video);
          if (!fs.existsSync(src)) throw new Error(`reference clip ${i + 1} not found: ${ref.video}`);
          const probe = await probeMedia(src);
          if (ref.useItsAudio && !probe.hasAudio) {
            throw new Error(
              `Reference clip ${i + 1} (${path.basename(ref.video)}) has no audio track, but the ` +
                "shot asks to reference its sound. Turn that off, or pick a clip that has some.",
            );
          }
          /* What will actually reach the node: the window asked for, capped by
           * the take's own length (the node crops to it) AND by what is left
           * of the clip past startSec — a window that runs off the end yields
           * fewer frames, and under 5 the node raises from inside the render. */
          const left = probe.duration === null ? ref.lengthSec : probe.duration - ref.startSec;
          const usable = Math.min(ref.lengthSec, payload.durationSec, Math.max(0, left));
          if (usable * MINIMAX_FPS < 5) {
            throw new Error(
              `Reference clip ${i + 1} gives ${usable.toFixed(1)}s from ${ref.startSec.toFixed(1)}s` +
                ` — H3 needs at least 5 frames (~0.2s at ${MINIMAX_FPS}fps) of a reference clip.` +
                (left < ref.lengthSec ? " The window runs past the end of the clip." : ""),
            );
          }
          const prepared = path.join(jobRunDir(job.id), "refs", `clip${i}.mp4`);
          await prepareRefVideo(src, prepared, ref, probe, payload.durationSec, ref.useItsAudio);
          refVideos.push({
            file: await client.uploadInput(
              `${job.id}-ref-clip-${i}.mp4`,
              fs.readFileSync(prepared),
            ),
            withAudio: ref.useItsAudio,
          });
        }

        const refAudioNames: string[] = [];
        for (const [i, rel] of refs.audios.entries()) {
          refAudioNames.push(await stage(rel, `ref-audio-${i}`, `reference audio ${i + 1}`));
        }

        graph = minimaxH3RefGraph({
          prompt,
          refImageNames,
          refVideos,
          refAudioNames,
          refImageSize: refs.imageSize,
          durationSec: payload.durationSec,
          width,
          height,
          seed,
          sage,
          turbo,
          cameraLora,
          endless,
          evictEncoder,
          models: refModels,
          filenamePrefix: "aurea/h3-ref",
        });
      } else {
        /* Both frames are optional and independent: none = text-to-video, first
         * only = animate forward, both = fl2va, the take has to land on the last
         * one. */
        const firstFrameName = payload.startFrame
          ? await stage(payload.startFrame, "first", "start frame")
          : undefined;
        const lastFrameName = payload.endFrame
          ? await stage(payload.endFrame, "last", "end frame")
          : undefined;

        graph = minimaxH3Graph({
          prompt,
          firstFrameName,
          lastFrameName,
          durationSec: payload.durationSec,
          width,
          height,
          seed,
          sage,
          turbo,
          cameraLora,
          evictEncoder,
          models,
          filenamePrefix: "aurea/h3",
        });
      }

      /* Every H3 render starts from an empty card, unconditionally.
       *
       * This used to fire only for reference clips and 2048px stills, on the
       * reasoning that H3 owned its ComfyUI outright: the warm weights it found
       * were its OWN from the last take, and evicting them bought a 24 GB
       * reload for nothing. That stopped being true when engines.videoMode
       * became "managed" — LTX and H3 now share one instance, so the weights
       * H3 arrives to are usually another engine's and are pure loss.
       *
       * What that costs when it goes wrong, measured 2026-08-23: the DiT was
       * offered 9.6 GB of 24 because an LTX-2.5 take had left ~2.9 GB behind
       * and H3's own encoder and video VAE then took the rest. It loaded
       * partially, paged 5.9 GB to system RAM, and ran at 130 s/step instead of
       * ~13 — an eight-minute shot turned into a fifty-minute one, and the
       * driver faulted before it finished. Two gigabytes of headroom is worth
       * more than a warm cache here. */
      report({ progress: 3.5, stage: "Clearing VRAM" });
      await client.freeMemory();

      report({
        progress: 4,
        stage: "Queuing on ComfyUI",
        detail:
          `${frames} frames @ ${MINIMAX_FPS}fps · ${steps} steps` +
          (turbo
            ? ` · ${tier === "draft" ? "Draft" : "Standard"} distill` +
              (payload.minimaxDistill ? ` (${payload.minimaxDistill})` : "")
            : "") +
          (draftScaled
            ? ` · ${width}x${height} (scaled from ${requested[0]}x${requested[1]} — the 4-step distill corrupts audio above ~1MPx)`
            : "") +
          (w4a8 ? " · w4a8" : "") +
          (sage ? " · sage" : "") +
          (evictEncoder ? "" : " · encoder stays resident") +
          (chunks > 1 ? ` · ${chunks} chunks of ${chunkFrames}` : "") +
          ` · ~${Math.round(estMinutes)} min` +
          (refs ? ` · ${describeRefs(refs)}` : ""),
      });

      const files = await client.run(graph, {
        signal: ctrl.signal,
        /* An order of magnitude slower than LTX at the same length, and the
         * first run also pays for reading 24 GB of weights off disk. A chunked
         * render is that per chunk, so the wait it is allowed is the ceiling
         * the estimate was checked against — a fixed two hours would abandon a
         * long shot that was going to finish. A normal render is bounded by
         * its own estimate instead: at double the predicted time it is not
         * slow, it is paging or wedged, and the old flat 120 min sat 3× above
         * the 40-min admissibility ceiling that had just been enforced. */
        timeoutMs: (long ? MAX_LONG_FORM_MINUTES : Math.max(30, Math.ceil(estMinutes * 2))) * 60_000,
        onNode: (classType) => {
          if (classType === "UnetLoaderGGUF" || classType === "UNETLoader") {
            report({ stage: "Loading MiniMax-H3" });
          } else if (classType === "LoraLoaderModelOnly") {
            report({ stage: "Loading the distill" });
          }
          else if (classType === "CLIPLoaderGGUF") report({ stage: "Loading the text encoder" });
          else if (classType === "MiniMaxH3ImageToVideo") report({ stage: "Encoding the prompt" });
          else if (classType === "GetVideoComponents") report({ stage: "Reading the reference clips" });
          else if (classType === "MiniMaxH3ReferenceToVideo") {
            // the whole reference set is VAE-encoded here, which on "max"
            // stills is minutes rather than seconds
            report({ stage: "Encoding the prompt and references" });
          } else if (classType === "SamplerCustomAdvanced") report({ stage: "Rendering" });
          else if (classType === "HREndlessSampler") {
            report({ stage: `Rendering ${chunks} chunks` });
          }
          else if (classType === "VAEDecode") report({ progress: 88, stage: "Decoding frames" });
          else if (classType === "VAEDecodeAudio") report({ progress: 92, stage: "Decoding audio" });
          else if (classType === "CreateVideo" || classType === "SaveVideo") {
            report({ progress: 95, stage: "Encoding video" });
          }
        },
        onProgress: (value, max) => {
          if (max <= 0) return;
          report({ progress: 6 + (value / max) * 80 });
        },
      });

      const video = files.find((f) => VIDEO_EXT.test(f.filename));
      if (!video) throw new Error("The MiniMax-H3 run finished without a video output");
      report({ progress: 97, stage: "Saving take" });
      const out = path.join(jobRunDir(job.id), "out", `take${path.extname(video.filename)}`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, video.data);
      // the take carries its own audio — say so, so the timeline doesn't treat
      // it as a mute clip waiting for a voice track
      return {
        output: out,
        meta: {
          engine: "minimax-h3",
          nativeAudio: true,
          tier,
          // kept for anything that still reads the old boolean
          ...(tier === "draft" ? { draft: true } : {}),
          ...(w4a8 ? { weights: "w4a8" } : {}),
          ...(chunks > 1 ? { chunks } : {}),
          ...(sage ? { sage: true } : {}),
          // which distill, when it wasn't the shipped one — a take from a
          // bake-off has to say which candidate made it
          ...(payload.minimaxDistill ? { distill: payload.minimaxDistill } : {}),
          // what steered the move, at what strength. The whole point of the
          // camera weight is that its effect is a judgement call on the
          // finished take, so the take has to say whether it was loaded.
          ...(cameraLora
            ? { camera: { move: payload.cameraLora!.move, strength: cameraLora.strength } }
            : {}),
          ...(refs ? { mode: "ref2va", refs: describeRefs(refs) } : {}),
        },
      };
    })();

    return {
      done,
      cancel: () => ctrl.abort(),
    };
  }
}
