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
import type { DirectorSpec, Job } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import type { ComfyService } from "../comfy/service.js";
import type { ModelManager } from "../models/manager.js";
import { ComfyClient } from "../comfy/client.js";
import { LTX23_MANAGED, ltx23Graph, silentWav } from "../comfy/video-graphs.js";
import { directorGraph } from "../comfy/director-graph.js";
import {
  buildTimelineData,
  secToFrames,
  snapFrames,
  snapSize,
  type TimelineInput,
} from "../comfy/director-timeline.js";
import { DIRECTOR_NODES, resolveTuning } from "../comfy/capabilities.js";
import { probeMedia } from "./ffmpeg-export.js";
import { jobRunDir } from "./proc.js";
import type { JobResources } from "../scheduler.js";
import type { AdapterProgress, AdapterRun, EngineAdapter } from "./types.js";

const VIDEO_EXT = /\.(mp4|webm|mov)$/i;

/** the stock template's negative prompt — a Director shot with no explicit
 * one still wants LTX kept off game-render and caption territory */
const DEFAULT_NEGATIVE = "pc game, console game, video game, cartoon, childish, ugly";

/** the IC-LoRAs that carry motion onto a keyframe, by their conventional
 * filenames in an LTX install's loras/ltxv/ltx2 folder */
const IC_LORA: Record<"union" | "motionTrack", string> = {
  union: "ltxv/ltx2/ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors",
  motionTrack: "ltxv/ltx2/ltx-2.3-22b-ic-lora-motion-track-control-ref0.5.safetensors",
};

/** The render tuning knobs fail inside ComfyUI, far from the toggle that
 * turned them on — SageAttention in particular needs a pip package the node
 * pack does not install. Translate those into something the user can act on. */
function explainTuningFailure(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (/sageattention/i.test(message)) {
    return new Error(
      "SageAttention is on (Settings → Engines → Render tuning) but the `sageattention` " +
        "package is not installed in the python that runs your ComfyUI. Install it there, " +
        "or turn the toggle off.",
    );
  }
  return err instanceof Error ? err : new Error(message);
}

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

  /** Which loader names a graph should carry. The model manager's store nests
   * weights under the model id, and only the managed sidecar has that folder
   * on its search path — the user's own ComfyUI knows the conventional flat
   * names, so having downloaded a managed copy must not change what we send
   * it. (A managed run against a LINKED root is also conventional: nothing was
   * copied into our store, so managedCopy is false.) */
  private ltxModelNames(managed: boolean) {
    return managed && this.models.managedCopy("ltx-23-22b-fp8") ? LTX23_MANAGED : null;
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
      if (payload.director) return this.renderShot(job, payload.director, report, ctrl, managed);
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
          models: this.ltxModelNames(managed),
          tuning: await resolveTuning(client, this.settings.get().engines.videoTuning),
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
        }).catch((err: unknown) => {
          throw explainTuningFailure(err);
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

  /* ---------- Shot Director ----------
   * A timeline render: keyframes at times, prompt beats, voice takes locked
   * to timecodes. Same LTX weights and sigma schedule as above — the whole
   * difference is that the conditioning comes from an LTXDirector node. */
  private async renderShot(
    job: Job,
    spec: DirectorSpec,
    report: (p: AdapterProgress) => void,
    ctrl: AbortController,
    managed: boolean,
  ): Promise<{ output: string }> {
    const payload = job.payload;
    if (payload?.type !== "video") throw new Error("not a video job");
    const { storage, engines } = this.settings.get();
    const dataRoot = storage.dataRoot;

    /** resolve a library relPath, failing with the path the user recognises */
    const resolve = (rel: string, what: string): string => {
      const file = path.join(dataRoot, rel);
      if (!fs.existsSync(file)) throw new Error(`${what} not found: ${rel}`);
      return file;
    };

    if (spec.keyframes.length === 0 && !spec.retake) {
      throw new Error("A Director shot needs at least one keyframe (or a retake to fix)");
    }

    /* The lab's single dialogue field predates the audio lane, and MCP callers
     * still reach for it — it's the one-segment case of the lane, so honour it
     * as a take at 0s rather than silently rendering the shot mute. An explicit
     * lane wins: a caller who placed takes has already said where they go. */
    const takes =
      spec.audio.length > 0
        ? spec.audio
        : payload.audio
          ? [{ take: payload.audio, atSec: 0, trimStartSec: 0 }]
          : [];
    if (managed && !this.models.ready("ltx-23-22b-fp8")) {
      throw new Error(
        "LTX 2.3 weights are not installed — Settings → Models → LTX 2.3 22B (fp8), " +
          "link a folder that already has them, or switch the video engine to external",
      );
    }

    const fps = spec.fps;
    const durationFrames = snapFrames(secToFrames(payload.durationSec, fps) + 1);
    const size = payload.resolution.match(/(\d+)\s*[×x]\s*(\d+)/);
    const width = snapSize(size ? Number(size[1]) : 704);
    const height = snapSize(size ? Number(size[2]) : 896);
    const seed = payload.seed ?? Math.floor(Math.random() * 1_000_000_000);

    // probe every take up front: the timeline needs real lengths in frames,
    // and a missing ffmpeg should fail here rather than mid-render
    const takeSeconds = await Promise.all(
      takes.map((a) => probeMedia(resolve(a.take, "voice take")).then((p) => p.duration ?? 0)),
    );

    report({ progress: 1, stage: managed ? "Starting engine" : "Queuing on ComfyUI" });
    return this.comfy.run(async (url) => {
      const client = new ComfyClient(url);
      if (!(await client.hasNodes(DIRECTOR_NODES))) {
        throw new Error(
          "Director mode needs the WhatDreamsCost-ComfyUI node pack, which this ComfyUI " +
            "doesn't have. Install it there and restart ComfyUI, or turn Director off to " +
            "render this shot the classic way.",
        );
      }

      report({ progress: 2, stage: "Staging shot" });
      const stage = async (rel: string, tag: string, what: string) => {
        const file = resolve(rel, what);
        return client.uploadInput(`${job.id}-${tag}${path.extname(file)}`, fs.readFileSync(file));
      };

      const timeline: TimelineInput = {
        globalPrompt: spec.globalPrompt.trim() || payload.prompt,
        fps,
        durationFrames,
        keyframes: await Promise.all(
          spec.keyframes.map(async (k, i) => ({
            file: await stage(k.image, `kf${i}`, "keyframe"),
            atFrame: secToFrames(k.atSec, fps),
            strength: k.strength,
          })),
        ),
        promptZones: spec.promptZones.map((z) => ({
          prompt: z.prompt,
          lengthFrames: secToFrames(z.lengthSec, fps),
        })),
        audio: await Promise.all(
          takes.map(async (a, i) => ({
            file: await stage(a.take, `take${i}`, "voice take"),
            atFrame: secToFrames(a.atSec, fps),
            // the take runs from its trim point to its end, clipped to the shot
            lengthFrames: Math.max(
              1,
              secToFrames(Math.max(0, takeSeconds[i] - a.trimStartSec), fps),
            ),
            trimStartFrames: secToFrames(a.trimStartSec, fps),
          })),
        ),
        motion: spec.motion
          ? [
              {
                file: await stage(spec.motion.video, "motion", "motion reference"),
                atFrame: secToFrames(spec.motion.atSec, fps),
                lengthFrames: spec.motion.lengthSec
                  ? secToFrames(spec.motion.lengthSec, fps)
                  : durationFrames,
              },
            ]
          : undefined,
        retake: spec.retake
          ? {
              file: await stage(spec.retake.source, "retake", "take to fix"),
              atFrame: secToFrames(spec.retake.atSec, fps),
              lengthFrames: secToFrames(spec.retake.lengthSec, fps),
              prompt: spec.retake.prompt,
              strength: spec.retake.strength,
              sourceDurationFrames: snapFrames(
                secToFrames(
                  (await probeMedia(resolve(spec.retake.source, "take to fix"))).duration ??
                    payload.durationSec,
                  fps,
                ),
              ),
            }
          : undefined,
      };

      const graph = directorGraph({
        timeline: buildTimelineData(timeline),
        negativePrompt: spec.negativePrompt ?? DEFAULT_NEGATIVE,
        fps,
        durationFrames,
        width,
        height,
        seed,
        epsilon: spec.epsilon,
        hasCustomAudio: takes.length > 0,
        inpaintAudio: spec.inpaintAudio,
        hasMotion: !!spec.motion,
        icLora: spec.motion ? IC_LORA[spec.motion.icLora] : undefined,
        icLoraStrength: spec.motion?.strength,
        models: this.ltxModelNames(managed),
        tuning: await resolveTuning(client, engines.videoTuning),
        filenamePrefix: "aurea/shot",
      });

      report({ progress: 4, stage: "Queuing on ComfyUI" });
      let pass = 0;
      const files = await client
        .run(graph, {
          signal: ctrl.signal,
          timeoutMs: 45 * 60_000,
          onNode: (classType) => {
            if (LOADERS.has(classType)) report({ stage: "Loading LTX 2.3" });
            else if (classType === "LTXDirector") report({ stage: "Building the timeline" });
            else if (classType === "LTXDirectorGuide") report({ stage: "Encoding keyframes" });
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
        })
        .catch((err: unknown) => {
          throw explainTuningFailure(err);
        });

      const video = files.find((f) => VIDEO_EXT.test(f.filename));
      if (!video) throw new Error("The Director run finished without a video output");
      report({ progress: 97, stage: "Saving take" });
      const out = path.join(jobRunDir(job.id), "out", `take${path.extname(video.filename)}`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, video.data);
      return { output: out };
    }, managed ? "managed" : "external");
  }
}
