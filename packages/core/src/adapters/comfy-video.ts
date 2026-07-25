/* Video adapter — start frame (+ optional voice take) → mp4 through the
 * ComfyService, replacing the python queue-scripts + history polling of the
 * old ltx.ts. The native LTX 2.3 AV template ships inside the package
 * (comfy/ltx23-template.ts), inputs are staged over /upload/image, and
 * progress streams over the ComfyUI websocket:
 *
 *   videoMode "external" — the user's ComfyUI with its conventional model
 *                          names and the proven Gemma prompt-enhance branch
 *   videoMode "managed"  — studiod's headless ComfyUI with the model-manager
 *                          "ltx-23-22b-fp8" weight set (enhance stripped)
 *
 * audio present → ia2v (the take drives phoneme lip-sync); image only → i2v
 * with a silent placeholder and a freed audio latent, so LTX scores the shot
 * itself. */

import fs from "node:fs";
import path from "node:path";
import type { Job } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import type { ComfyService } from "../comfy/service.js";
import type { ModelManager } from "../models/manager.js";
import { ComfyClient } from "../comfy/client.js";
import { LTX23_MANAGED, ltx23Graph, silentWav } from "../comfy/video-graphs.js";
import { jobRunDir } from "./proc.js";
import type { JobResources } from "../scheduler.js";
import type { AdapterProgress, AdapterRun, EngineAdapter } from "./types.js";

const VIDEO_EXT = /\.(mp4|webm|mov)$/i;

const LOADERS = new Set([
  "CheckpointLoaderSimple",
  "LTXAVTextEncoderLoader",
  "LTXVAudioVAELoader",
  "LatentUpscaleModelLoader",
  "LoraLoaderModelOnly",
]);

export class ComfyVideoAdapter implements EngineAdapter {
  id = "comfy-video";

  constructor(
    private settings: SettingsStore,
    private comfy: ComfyService,
    private models: ModelManager,
  ) {}

  canRun(job: Job): boolean {
    return job.payload?.type === "video" && job.payload.engine === "ltx2";
  }

  resources(job: Job): JobResources {
    // the 22B fp8 checkpoint plus offload headroom on the managed sidecar;
    // external ComfyUI owns its own memory — no estimate
    void job;
    const managed = this.settings.get().engines.videoMode === "managed";
    return { klass: "gpu", engineId: "comfy", vramGb: managed ? 21 : undefined };
  }

  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun {
    const ctrl = new AbortController();
    const managed = this.settings.get().engines.videoMode === "managed";

    const done = (async () => {
      const payload = job.payload;
      if (payload?.type !== "video") throw new Error("not a video job");
      const { storage } = this.settings.get();
      if (!payload.startFrame) {
        throw new Error("LTX needs a start frame — generate or pick an image first");
      }
      const image = path.join(storage.dataRoot, payload.startFrame);
      if (!fs.existsSync(image)) throw new Error(`start frame not found: ${payload.startFrame}`);
      const audio = payload.audio ? path.join(storage.dataRoot, payload.audio) : undefined;
      if (audio && !fs.existsSync(audio)) throw new Error(`audio not found: ${payload.audio}`);
      if (managed && !this.models.ready("ltx-23-22b-fp8")) {
        throw new Error(
          "LTX 2.3 weights are not installed — Settings → Models → LTX 2.3 22B (fp8), " +
            "link a folder that already has them, or switch the video engine to external",
        );
      }

      report({ progress: 1, stage: managed ? "Starting engine" : "Queuing on ComfyUI" });
      return this.comfy.run(async (url) => {
        const client = new ComfyClient(url);
        const seed = payload.seed ?? Math.floor(Math.random() * 1_000_000_000);
        const size = payload.resolution.match(/(\d+)\s*[×x]\s*(\d+)/);
        const [width, height] = size ? [Number(size[1]), Number(size[2])] : [704, 896];

        report({ progress: 2, stage: "Staging inputs" });
        const imageName = await client.uploadInput(`${job.id}-frame${path.extname(image)}`, fs.readFileSync(image));
        const audioName = audio
          ? await client.uploadInput(`${job.id}-take${path.extname(audio)}`, fs.readFileSync(audio))
          : undefined;
        if (!audio) {
          // i2v still feeds LoadAudio something real; the freed mask ignores it
          await client.uploadInput(`${job.id}-silence.wav`, silentWav(payload.durationSec));
        }

        const graph = ltx23Graph({
          prompt: payload.prompt,
          imageName,
          audioName: audioName ?? undefined,
          durationSec: payload.durationSec,
          width,
          height,
          seed,
          // our flat store only when the copy is ours; a linked root (or an
          // external ComfyUI) carries the template's conventional names
          models: this.models.managedCopy("ltx-23-22b-fp8") ? LTX23_MANAGED : null,
        });
        if (!audio) {
          // repatch the placeholder LoadAudio to the staged silence
          (graph["276"].inputs as Record<string, unknown>).audio = `aurea/${job.id}-silence.wav`;
        }

        report({ progress: 4, stage: "Queuing on ComfyUI" });
        // progress: base sampler pass 6→55, refine 55→85, decode 85→94
        let pass = 0;
        const files = await client.run(graph, {
          signal: ctrl.signal,
          timeoutMs: 45 * 60_000,
          onNode: (classType) => {
            if (LOADERS.has(classType)) report({ stage: "Loading LTX 2.3" });
            else if (classType === "TextGenerateLTX2Prompt") report({ stage: "Enhancing prompt" });
            else if (classType === "LTXVAudioVAEEncode") report({ stage: "Encoding audio" });
            else if (classType === "SamplerCustomAdvanced") {
              pass += 1;
              report({ stage: pass > 1 ? "Rendering — refine pass" : "Rendering — base pass" });
            } else if (classType === "LTXVLatentUpsampler") report({ stage: "Upscaling latents" });
            else if (classType === "VAEDecodeTiled") report({ progress: 85, stage: "Decoding frames" });
            else if (classType === "CreateVideo" || classType === "SaveVideo") {
              report({ progress: 94, stage: "Encoding video" });
            }
          },
          onProgress: (value, max) => {
            if (max <= 0) return;
            const frac = value / max;
            if (pass <= 1) report({ progress: 6 + frac * 49 });
            else report({ progress: 55 + frac * 30 });
          },
        });

        const video = files.find((f) => VIDEO_EXT.test(f.filename));
        if (!video) throw new Error("LTX run finished without a video output");
        report({ progress: 97, stage: "Saving take" });
        const out = path.join(jobRunDir(job.id), "out", `take${path.extname(video.filename)}`);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, video.data);
        return { output: out };
      }, managed ? "managed" : "external");
    })();

    return {
      done,
      cancel: () => ctrl.abort(),
    };
  }
}
