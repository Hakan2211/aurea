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
import type { Job, MinimaxRefs, MinimaxRefVideo } from "@aurea/shared";
import { hasMinimaxRefs, minimaxRefLabels, unknownMinimaxRefTags } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import type { ModelManager } from "../models/manager.js";
import { ComfyClient } from "../comfy/client.js";
import type { ComfyService } from "../comfy/service.js";
import {
  MINIMAX_FPS,
  MINIMAX_H3_CONVENTIONAL,
  MINIMAX_H3_MANAGED,
  MINIMAX_H3_REF_CONVENTIONAL,
  MINIMAX_H3_REF_MANAGED,
  frameLength,
  minimaxH3Graph,
  minimaxH3RefGraph,
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

/** Only 0.30.0+ carries comfy/ldm/minimax. Below that the MiniMaxH3ImageToVideo
 * node simply isn't registered, and CLIPLoaderGGUF's "minimax" type falls back
 * to STABLE_DIFFUSION — which does not fail, it just encodes garbage. Checking
 * for the node is the honest gate. */
const MINIMAX_NODES_REQUIRED = ["MiniMaxH3ImageToVideo", "UnetLoaderGGUF", "CLIPLoaderGGUF"];

/** the reference path adds the ref2va node and the three loaders that feed it */
const MINIMAX_REF_NODES_REQUIRED = [
  "MiniMaxH3ReferenceToVideo",
  "LoadVideo",
  "GetVideoComponents",
  "LoadAudio",
  "UnetLoaderGGUF",
  "CLIPLoaderGGUF",
];

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
   * the weights keeps the conventional flat ones. */
  private modelNames() {
    return this.models.managedCopy(MINIMAX_MODEL_ID)
      ? MINIMAX_H3_MANAGED
      : MINIMAX_H3_CONVENTIONAL;
  }

  /** The reference head is its own registry entry, so it can be linked while
   * the base set is managed (or the other way round) — resolve each on its own
   * rather than assuming both came from the same place. */
  private refModelNames() {
    return {
      ...this.modelNames(),
      refUnet: this.models.managedCopy(MINIMAX_REF_MODEL_ID)
        ? MINIMAX_H3_REF_MANAGED
        : MINIMAX_H3_REF_CONVENTIONAL,
    };
  }

  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun {
    const ctrl = new AbortController();

    const done = (async () => {
      const payload = job.payload;
      if (payload?.type !== "video") throw new Error("not a video job");
      const { storage } = this.settings.get();

      // empty minimaxUrl = "same ComfyUI as LTX" (see ComfyService.minimaxUrl)
      const url = await this.comfy.minimaxUrlResolved();
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
      if (payload.loras.length || payload.cameraLora) {
        throw new Error(
          "LoRA adapters (including camera control) load on the LTX-2.3 pipeline — H3 has " +
            "no LoRA slot. Describe the camera move in the prompt's Camera: block instead.",
        );
      }
      if (payload.fps !== 24) {
        throw new Error(
          `MiniMax-H3 renders at 24 fps only — ${payload.fps} fps is an LTX-2.3 option.`,
        );
      }
      if (payload.fast) {
        throw new Error(
          "Draft mode skips LTX's refine pass — H3 has no equivalent stage. Lower the " +
            "duration or resolution to render faster here.",
        );
      }
      if (!this.models.ready(MINIMAX_MODEL_ID)) {
        throw new Error(
          "MiniMax-H3 weights are not installed — Settings → Models → MiniMax-H3 (GGUF), " +
            "or link a folder that already has them.",
        );
      }

      /* Reference mode is a different checkpoint on the same encoder and VAEs,
       * reached through a different node. Everything below decides which of
       * the two heads this job is for, and refuses the combinations that would
       * quietly render the wrong thing. */
      const refs = hasMinimaxRefs(payload.minimaxRefs) ? payload.minimaxRefs : null;
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
        const missing = unknownMinimaxRefTags(payload.prompt, refs);
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
      if (!(await client.hasNodes(refs ? MINIMAX_REF_NODES_REQUIRED : MINIMAX_NODES_REQUIRED))) {
        throw new Error(
          `The ComfyUI at ${url} doesn't have the MiniMax-H3 nodes${
            refs ? " for reference mode (MiniMaxH3ReferenceToVideo)" : ""
          }. They ship with ComfyUI 0.30.0+ and the GGUF loaders come from the ComfyUI-GGUF ` +
            "pack — check both, restart it, and try again.",
        );
      }

      const seed = payload.seed ?? Math.floor(Math.random() * 1_000_000_000);
      const size = payload.resolution.match(/(\d+)\s*[×x]\s*(\d+)/);
      const [width, height] = size ? [Number(size[1]), Number(size[2])] : [1344, 768];

      /* SageAttention — settings say "wanted", the install says "possible".
       * When the KJ node is missing on THIS ComfyUI the toggle is dropped
       * silently like chunkFeedForward is on the LTX side: an unavailable
       * speed-up must not turn a working engine into a failing one. */
      const sage =
        this.settings.get().engines.minimaxTuning.sageAttention &&
        (await client.hasNode("PathchSageAttentionKJ"));

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
          prompt: payload.prompt,
          refImageNames,
          refVideos,
          refAudioNames,
          refImageSize: refs.imageSize,
          durationSec: payload.durationSec,
          width,
          height,
          seed,
          sage,
          models: this.refModelNames(),
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
          prompt: payload.prompt,
          firstFrameName,
          lastFrameName,
          durationSec: payload.durationSec,
          width,
          height,
          seed,
          sage,
          models: this.modelNames(),
          filenamePrefix: "aurea/h3",
        });
      }

      /* Measured 2026-08-05: a reference render OOMs at 24 GB when the previous
       * job's weights are still warm — encoding a 3s clip's frames through the
       * video VAE asked for 2.9 GB ON TOP of the 19.7 GB an external ComfyUI
       * was already holding. The same shot with reference STILLS rendered fine
       * on the same warm card, so this is the heavy tail rather than the whole
       * reference path: clear the board for clips and for 2048px stills, and
       * let everything else keep the warm weights it can use. */
      if (refs && (refs.videos.length > 0 || refs.imageSize === "max")) {
        report({ progress: 3.5, stage: "Clearing VRAM for the references" });
        await client.freeMemory();
      }

      const frames = frameLength(payload.durationSec);
      report({
        progress: 4,
        stage: "Queuing on ComfyUI",
        detail: `${frames} frames @ ${MINIMAX_FPS}fps${refs ? ` · ${describeRefs(refs)}` : ""}`,
      });

      const files = await client.run(graph, {
        signal: ctrl.signal,
        // an order of magnitude slower than LTX at the same length, and the
        // first run also pays for reading 24 GB of weights off disk
        timeoutMs: 120 * 60_000,
        onNode: (classType) => {
          if (classType === "UnetLoaderGGUF") report({ stage: "Loading MiniMax-H3" });
          else if (classType === "CLIPLoaderGGUF") report({ stage: "Loading the text encoder" });
          else if (classType === "MiniMaxH3ImageToVideo") report({ stage: "Encoding the prompt" });
          else if (classType === "GetVideoComponents") report({ stage: "Reading the reference clips" });
          else if (classType === "MiniMaxH3ReferenceToVideo") {
            // the whole reference set is VAE-encoded here, which on "max"
            // stills is minutes rather than seconds
            report({ stage: "Encoding the prompt and references" });
          } else if (classType === "SamplerCustomAdvanced") report({ stage: "Rendering" });
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
