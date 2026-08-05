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

import fs from "node:fs";
import path from "node:path";
import type { Job } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import type { ModelManager } from "../models/manager.js";
import { ComfyClient } from "../comfy/client.js";
import {
  MINIMAX_FPS,
  MINIMAX_H3_CONVENTIONAL,
  MINIMAX_H3_MANAGED,
  frameLength,
  minimaxH3Graph,
} from "../comfy/minimax-graphs.js";
import { jobRunDir } from "./proc.js";
import type { JobResources } from "../scheduler.js";
import type { AdapterProgress, AdapterRun, EngineAdapter } from "./types.js";

const VIDEO_EXT = /\.(mp4|webm|mov)$/i;

/** the model id in models/registry.ts */
export const MINIMAX_MODEL_ID = "minimax-h3-gguf";

/** Only 0.30.0+ carries comfy/ldm/minimax. Below that the MiniMaxH3ImageToVideo
 * node simply isn't registered, and CLIPLoaderGGUF's "minimax" type falls back
 * to STABLE_DIFFUSION — which does not fail, it just encodes garbage. Checking
 * for the node is the honest gate. */
const MINIMAX_NODES_REQUIRED = ["MiniMaxH3ImageToVideo", "UnetLoaderGGUF", "CLIPLoaderGGUF"];

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

  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun {
    const ctrl = new AbortController();

    const done = (async () => {
      const payload = job.payload;
      if (payload?.type !== "video") throw new Error("not a video job");
      const { storage, engines } = this.settings.get();

      const url = engines.minimaxUrl.trim().replace(/\/$/, "");
      if (!url) {
        throw new Error(
          "MiniMax-H3 has no ComfyUI to run on. It needs ComfyUI 0.30.0 or newer — a " +
            "separate install from the one LTX-2.3 uses — and its address in " +
            "Settings → Engines → MiniMax-H3 ComfyUI URL.",
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
      if (!this.models.ready(MINIMAX_MODEL_ID)) {
        throw new Error(
          "MiniMax-H3 weights are not installed — Settings → Models → MiniMax-H3 (GGUF), " +
            "or link a folder that already has them.",
        );
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
      if (!(await client.hasNodes(MINIMAX_NODES_REQUIRED))) {
        throw new Error(
          `The ComfyUI at ${url} doesn't have the MiniMax-H3 nodes. They ship with ComfyUI ` +
            "0.30.0+ (MiniMaxH3ImageToVideo) and the GGUF loaders come from the ComfyUI-GGUF " +
            "pack — check both, restart it, and try again.",
        );
      }

      const seed = payload.seed ?? Math.floor(Math.random() * 1_000_000_000);
      const size = payload.resolution.match(/(\d+)\s*[×x]\s*(\d+)/);
      const [width, height] = size ? [Number(size[1]), Number(size[2])] : [1344, 768];

      report({ progress: 2, stage: "Staging inputs" });
      /* Both frames are optional and independent: none = text-to-video, first
       * only = animate forward, both = fl2va, the take has to land on the last
       * one. */
      const stage = async (rel: string, tag: string, what: string) => {
        const image = path.join(storage.dataRoot, rel);
        if (!fs.existsSync(image)) throw new Error(`${what} not found: ${rel}`);
        return client.uploadInput(
          `${job.id}-${tag}${path.extname(image)}`,
          fs.readFileSync(image),
        );
      };
      const firstFrameName = payload.startFrame
        ? await stage(payload.startFrame, "first", "start frame")
        : undefined;
      const lastFrameName = payload.endFrame
        ? await stage(payload.endFrame, "last", "end frame")
        : undefined;

      const graph = minimaxH3Graph({
        prompt: payload.prompt,
        firstFrameName,
        lastFrameName,
        durationSec: payload.durationSec,
        width,
        height,
        seed,
        models: this.modelNames(),
        filenamePrefix: "aurea/h3",
      });

      const frames = frameLength(payload.durationSec);
      report({
        progress: 4,
        stage: "Queuing on ComfyUI",
        detail: `${frames} frames @ ${MINIMAX_FPS}fps`,
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
          else if (classType === "SamplerCustomAdvanced") report({ stage: "Rendering" });
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
      return { output: out, meta: { engine: "minimax-h3", nativeAudio: true } };
    })();

    return {
      done,
      cancel: () => ctrl.abort(),
    };
  }
}
