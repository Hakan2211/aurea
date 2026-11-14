/* LTX 2.5 video adapter — the 2.5 sibling of comfy-video.ts, deliberately
 * leaner: prompt (+ optional start frame, end frame, keyframes, voice take,
 * LoRAs) → mp4, through whichever ComfyUI videoMode points at. With no voice
 * take LTX 2.5 scores the shot itself; with one, the take is encoded and
 * noise-masked to 0 in the graph so it drives the render (ia2v lip-sync).
 *
 * Two FINISHING passes ride the same adapter (payload.finish):
 *   - refine   a draft kept its base-pass latents; run the ×2 latent upscale
 *              + refine pass over them — the draft's exact blocking at full
 *              size (measured identical to a fresh render at that seed; the
 *              base pass it skips is ~25s of a ~190s render, so no speed win)
 *   - upscale  the Pixel Spatial Upscaler IC-LoRA — a ×2 generative pass with
 *              the take as its in-context reference (ltx25UpscaleGraph)
 *
 * What it does NOT do yet, and says so instead of failing deep in the queue:
 *   - the Director timeline — LTXDirector is a 2.3 node pack
 *   - camera-control LoRAs — the Lightricks set is 2.3-trained
 *
 * Needs ComfyUI 0.32.0+ (LTXVDualCFGGuider is the discriminator we probe). */

import { resolveLoraByFile, videoPayloadSchema } from "@aurea/shared";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AssetMeta, Job, VideoPayload } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import type { ComfyService } from "../comfy/service.js";
import type { ModelManager } from "../models/manager.js";
import { ComfyClient } from "../comfy/client.js";
import { resolveTuning, resolveUpscalerLora } from "../comfy/capabilities.js";
import { explainTuningFailure } from "../comfy/tuning.js";
import {
  LTX25_EXTERNAL,
  LTX25_MANAGED,
  ltx25Graph,
  ltx25UpscaleGraph,
  upscaleCanvas,
} from "../comfy/ltx25-graph.js";
import { probeMedia } from "./ffmpeg-export.js";
import { jobRunDir } from "./proc.js";
import type { JobResources } from "../scheduler.js";
import type { AdapterProgress, AdapterRun, EngineAdapter } from "./types.js";

const VIDEO_EXT = /\.(mp4|webm|mov)$/i;
/** the two SaveLatent outputs of a draft, by the prefix the graph gives them */
const VIDEO_LATENT = /-video_\d+_\.latent$/i;
const AUDIO_LATENT = /-audio_\d+_\.latent$/i;

const LOADERS = new Set([
  "UNETLoader",
  "CLIPLoader",
  "VAELoader",
  "LatentUpscaleModelLoader",
  "LoraLoaderModelOnly",
]);

/** where an asset's provenance is read from — ProjectStore in the app, a
 * stub in tests */
export interface AssetMetaSource {
  assetMeta(relPath: string): AssetMeta | undefined;
}

/** Frames in the first video stream — exact, off the container's own count.
 * The finish passes need the real number: LTX wants 8n+1, and a source off
 * the grid (an H3 take is 107) is trimmed to it before staging. */
function countFrames(file: string): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=nb_frames", "-of", "csv=p=0", file],
      { windowsHide: true },
      (err, stdout) => {
        const n = Number(String(stdout).trim());
        resolve(!err && Number.isFinite(n) && n > 0 ? n : null);
      },
    );
  });
}

/** Re-encode the first `frames` frames of a take (audio copied and cut to
 * match) — the way a source lands on LTX's 8n+1 grid without touching the
 * library file. */
function trimToFrames(src: string, dest: string, frames: number, fps: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      [
        "-y", "-loglevel", "error", "-i", src,
        "-frames:v", String(frames), "-t", (frames / fps).toFixed(4),
        "-c:v", "libx264", "-crf", "10", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        dest,
      ],
      { windowsHide: true },
      (err) => (err ? reject(new Error(`ffmpeg could not trim the source take: ${err.message}`)) : resolve()),
    );
  });
}

export class Ltx25VideoAdapter implements EngineAdapter {
  id = "ltx25-video";

  constructor(
    private settings: SettingsStore,
    private comfy: ComfyService,
    private models: ModelManager,
    private assets?: AssetMetaSource,
  ) {}

  canRun(job: Job): boolean {
    return job.payload?.type === "video" && job.payload.engine === "ltx25";
  }

  resources(job: Job): JobResources {
    void job;
    const managed = this.settings.get().engines.videoMode === "managed";
    // int8 transformer + int8 encoder loaded in sequence with offloading —
    // same headroom class as the 2.3 fp8 checkpoint
    return { klass: "gpu", engineId: "comfy", vramGb: managed ? 21 : undefined };
  }

  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun {
    const ctrl = new AbortController();
    const managed = this.settings.get().engines.videoMode === "managed";

    const done = (async () => {
      const payload = job.payload;
      if (payload?.type !== "video") throw new Error("not a video job");
      if (managed && !this.models.ready("ltx-25-22b-int8")) {
        throw new Error(
          "LTX 2.5 weights are not installed — Settings → Models → LTX 2.5 22B (int8), " +
            "link a folder that already has them, or switch the video engine to external",
        );
      }
      if (payload.finish?.mode === "upscale") return this.upscale(job, payload, report, ctrl);
      if (payload.finish?.mode === "refine") {
        /* the draft's own request is what the refine pass conditions on —
         * everything about this job's payload except `finish` is a copy the
         * router made for the job card */
        const { request, latents } = this.draftOf(payload.finish.source);
        return this.render(job, request, report, ctrl, { latents, source: payload.finish.source });
      }
      return this.render(job, payload, report, ctrl);
    })();

    return {
      done,
      cancel: () => ctrl.abort(),
    };
  }

  /** The kept latents behind a draft take, and the request that made it. */
  private draftOf(source: string): {
    request: VideoPayload;
    latents: { video: string; audio: string; width: number; height: number; frames: number; fps: number };
  } {
    const { storage } = this.settings.get();
    const meta = this.assets?.assetMeta(source);
    if (!meta?.draftLatents) {
      throw new Error(
        `"${path.basename(source)}" kept no draft latents — only LTX 2.5 drafts rendered since ` +
          "the finish pass existed keep them. Render a draft of the shot, then finish that.",
      );
    }
    const request = videoPayloadSchema.safeParse({ type: "video", ...meta.draftLatents.request });
    if (!request.success || request.data.engine !== "ltx25") {
      throw new Error(`the draft's request behind "${path.basename(source)}" is not a readable LTX 2.5 render`);
    }
    const video = path.join(storage.dataRoot, meta.draftLatents.video);
    const audio = path.join(storage.dataRoot, meta.draftLatents.audio);
    for (const f of [video, audio]) {
      if (!fs.existsSync(f)) throw new Error(`draft latent missing: ${path.relative(storage.dataRoot, f)}`);
    }
    return {
      request: request.data,
      latents: {
        video,
        audio,
        width: meta.draftLatents.width,
        height: meta.draftLatents.height,
        frames: meta.draftLatents.frames,
        fps: meta.draftLatents.fps,
      },
    };
  }

  /* ---------- a render, or a refine over a draft's latents ---------- */

  private async render(
    job: Job,
    payload: VideoPayload,
    report: (p: AdapterProgress) => void,
    ctrl: AbortController,
    refine?: {
      latents: { video: string; audio: string; width: number; height: number; frames: number; fps: number };
      source: string;
    },
  ): Promise<{ output?: string; meta?: AssetMeta }> {
    const managed = this.settings.get().engines.videoMode === "managed";
    const { storage } = this.settings.get();

    if (payload.director) {
      throw new Error(
        "The Director timeline runs on LTX 2.3 (its node pack is 2.3-only for now) — " +
          "switch the engine to LTX-2.3 for this shot.",
      );
    }
    if (payload.cameraLora) {
      throw new Error(
        "Camera-control LoRAs are trained on LTX 2.3 and don't load on 2.5 — describe " +
          "the move in the prompt instead, or switch to the LTX-2.3 engine.",
      );
    }

    const image = payload.startFrame
      ? path.join(storage.dataRoot, payload.startFrame)
      : undefined;
    if (image && !fs.existsSync(image)) {
      throw new Error(`start frame not found: ${payload.startFrame}`);
    }
    if (!image && payload.endFrame) {
      throw new Error(
        "An end frame needs a start frame — add one, or clear the end frame to render " +
          "from the prompt alone.",
      );
    }
    const endFrame = payload.endFrame ? path.join(storage.dataRoot, payload.endFrame) : undefined;
    if (endFrame && !fs.existsSync(endFrame)) {
      throw new Error(`end frame not found: ${payload.endFrame}`);
    }
    // ia2v: the take is encoded and locked in the graph, so it drives the
    // render. LoadAudio needs a real decodable audio file — the 2.3 arm was
    // once pointed at a PNG and died deep in the queue with "No audio stream
    // found in the file"; fail here instead.
    const audio = payload.audio ? path.join(storage.dataRoot, payload.audio) : undefined;
    if (audio && !fs.existsSync(audio)) {
      throw new Error(`voice take not found: ${payload.audio}`);
    }
    for (const kf of payload.keyframes) {
      if (!fs.existsSync(path.join(storage.dataRoot, kf.image))) {
        throw new Error(`keyframe not found: ${kf.image}`);
      }
      if (kf.atSec >= payload.durationSec) {
        throw new Error(
          `keyframe at ${kf.atSec}s is outside the ${payload.durationSec}s take — ` +
            "move it earlier or use it as the end frame",
        );
      }
    }

    const seed = payload.seed ?? Math.floor(Math.random() * 1_000_000_000);
    const size = payload.resolution.match(/(\d+)\s*[×x]\s*(\d+)/);
    const [width, height] = size ? [Number(size[1]), Number(size[2])] : [1280, 704];
    const fps = payload.fps;
    const frames = Math.round(payload.durationSec * fps) + 1;
    if (refine) {
      // the loaded latent has a shape; the graph rebuilt around it must agree
      const l = refine.latents;
      const baseW = Math.round(width / 2);
      const baseH = Math.round(height / 2);
      if (l.width !== baseW || l.height !== baseH || l.frames !== frames || l.fps !== fps) {
        throw new Error(
          `the draft's latents are ${l.width}×${l.height} · ${l.frames} frames @ ${l.fps}, this ` +
            `request is ${baseW}×${baseH} · ${frames} @ ${fps} — the draft cannot be refined into it`,
        );
      }
    }
    // a draft keeps its base-pass latents so it can be finished later; a
    // preview (P5) is a 2s blocking check nobody finishes
    const keepLatents = !!payload.fast && !payload.board?.preview && !refine;

    report({ progress: 1, stage: managed ? "Starting engine" : "Queuing on ComfyUI" });
    return this.comfy.run(async (url) => {
      const client = new ComfyClient(url);
      if (!(await client.hasNodes(["LTXVDualCFGGuider"]))) {
        throw new Error(
          "LTX 2.5 needs ComfyUI 0.32.0 or newer (this one is missing LTXVDualCFGGuider). " +
            "Update the ComfyUI that videoMode points at, or switch to the LTX-2.3 engine.",
        );
      }

      // payload LoRAs → verbatim combo names this install accepts (same
      // fail-early contract as the 2.3 adapter)
      const loras: Array<{ name: string; strength: number }> = [];
      if (payload.loras.length) {
        const options = await client.comboOptions("LoraLoaderModelOnly", "lora_name");
        for (const lora of payload.loras) {
          // a look names its style LoRA by FILE (resolveLoraByFile)
          const name = resolveLoraByFile(options, lora.name);
          if (!name) {
            throw new Error(
              `LoRA "${lora.name}" is not in this ComfyUI's lora folder — ` +
                "pick from the list the lab offers (it is read live from the install)",
            );
          }
          loras.push({ ...lora, name });
        }
      }

      report({ progress: 2, stage: "Staging inputs" });
      const imageName = image
        ? await client.uploadInput(`${job.id}-frame${path.extname(image)}`, fs.readFileSync(image))
        : undefined;
      const endFrameName = endFrame
        ? await client.uploadInput(`${job.id}-end${path.extname(endFrame)}`, fs.readFileSync(endFrame))
        : undefined;
      const audioName = audio
        ? await client.uploadInput(`${job.id}-vo${path.extname(audio)}`, fs.readFileSync(audio))
        : undefined;
      const guides = await Promise.all(
        payload.keyframes.map(async (kf, i) => ({
          imageName: await client.uploadInput(
            `${job.id}-kf${i}${path.extname(kf.image)}`,
            fs.readFileSync(path.join(storage.dataRoot, kf.image)),
          ),
          atSec: kf.atSec,
          strength: kf.strength,
        })),
      );
      // the draft's latents go in as inputs like any staged file; LoadLatent
      // validates the path itself, so a subfolder name is accepted
      const refineFrom = refine
        ? {
            videoLatentName: await client.uploadInput(`${job.id}-video.latent`, fs.readFileSync(refine.latents.video)),
            audioLatentName: await client.uploadInput(`${job.id}-audio.latent`, fs.readFileSync(refine.latents.audio)),
          }
        : undefined;

      const graph = ltx25Graph({
        prompt: payload.prompt,
        negative: payload.negativePrompt,
        imageName,
        durationSec: payload.durationSec,
        width,
        height,
        seed,
        fps,
        fast: payload.fast,
        audioName,
        endFrameName,
        guides,
        loras,
        models: this.models.managedCopy("ltx-25-22b-int8") ? LTX25_MANAGED : LTX25_EXTERNAL,
        // the enhancer is its own optional download; without it the raw
        // prompt goes straight to the encoder. payload.enhance === false
        // turns it off even when installed — a multi-shot prose prompt is
        // authored to a structure the Gemma rewrite destroys (measured
        // 2026-08-31, MULTI-SHOT-PODCAST-PILOT.md)
        enhanceClipName:
          payload.enhance !== false && this.models.ready("ltx-25-prompt-enhancer")
            ? this.models.comfyFileName("ltx-25-prompt-enhancer")
            : null,
        // same knobs as 2.3 (Settings → Engines → Render tuning) — 2.5 kept
        // the LTX2-family transformer, so the KJNodes patches attach the
        // same way; resolveTuning drops what this install can't execute
        tuning: await resolveTuning(client, this.settings.get().engines.videoTuning),
        filenamePrefix: `aurea/${job.id}`,
        keepLatents,
        refineFrom,
      });

      // videoMode "managed" means LTX and H3 share one ComfyUI, so the warm
      // weights this render arrives to are usually another engine's — same
      // reasoning (and measured failure) as the H3 adapter's unconditional
      // clear, just in the other direction.
      // …unless the last render on this server was 2.5 itself and nothing
      // has cleared it since: then the weights are the right ones and the
      // clear would only buy a ~100s re-stage (measured 2026-09-02 — 4s of
      // sampling inside a 113s preview prompt). A model that fails to fit
      // still gets ComfyUI's own OOM handling, which unloads and retries.
      if (client.isWarm("ltx25")) {
        report({ progress: 3.5, stage: "LTX 2.5 still warm" });
      } else {
        report({ progress: 3.5, stage: "Clearing VRAM" });
        await client.freeMemory();
      }

      report({ progress: 4, stage: "Queuing on ComfyUI" });
      // progress: base pass 6→55, refine 55→85, decode 85→94; a draft or a
      // refine-from-draft is one pass, 6→85
      const onePass = !!payload.fast || !!refine;
      let pass = 0;
      const files = await client.run(graph, {
        signal: ctrl.signal,
        timeoutMs: 45 * 60_000,
        onNode: (classType) => {
          if (LOADERS.has(classType)) report({ stage: "Loading LTX 2.5" });
          else if (classType === "TextGenerateLTX2Prompt") report({ stage: "Enhancing prompt" });
          else if (classType === "SamplerCustomAdvanced") {
            pass += 1;
            report({
              stage: refine
                ? "Rendering — refine pass over the draft"
                : payload.fast
                  ? "Rendering — draft pass"
                  : pass > 1
                    ? "Rendering — refine pass"
                    : "Rendering — base pass",
            });
          } else if (classType === "LTXVLatentUpsampler") report({ stage: "Upscaling latents" });
          else if (classType === "SaveLatent") report({ stage: "Keeping the draft's latents" });
          else if (classType === "VAEDecodeTiled") report({ progress: 85, stage: "Decoding frames" });
          else if (classType === "CreateVideo" || classType === "SaveVideo") {
            report({ progress: 94, stage: "Encoding video" });
          }
        },
        onProgress: (value, max) => {
          if (max <= 0) return;
          const frac = value / max;
          if (onePass) report({ progress: 6 + frac * 79 });
          else if (pass <= 1) report({ progress: 6 + frac * 49 });
          else report({ progress: 55 + frac * 30 });
        },
      }).catch((err: unknown) => {
        throw explainTuningFailure(err);
      });

      const video = files.find((f) => VIDEO_EXT.test(f.filename));
      if (!video) throw new Error("LTX 2.5 run finished without a video output");
      client.markWarm("ltx25");
      report({ progress: 97, stage: "Saving take" });
      const outDir = path.join(jobRunDir(job.id), "out");
      fs.mkdirSync(outDir, { recursive: true });
      const out = path.join(outDir, `take${path.extname(video.filename)}`);
      fs.writeFileSync(out, video.data);

      const meta: AssetMeta = {};
      if (refine) {
        meta.finish = "refine";
        meta.source = refine.source;
      }
      if (keepLatents) {
        const vLat = files.find((f) => VIDEO_LATENT.test(f.filename));
        const aLat = files.find((f) => AUDIO_LATENT.test(f.filename));
        if (vLat && aLat) {
          /* absolute paths in the run dir for now; the project import moves
           * them beside the take and rewrites these to dataRoot-relative
           * (ProjectStore.importJobOutputDetailed) */
          const videoLat = path.join(outDir, "base-video.latent");
          const audioLat = path.join(outDir, "base-audio.latent");
          fs.writeFileSync(videoLat, vLat.data);
          fs.writeFileSync(audioLat, aLat.data);
          const { type: _type, board: _board, finish: _finish, ...request } = payload;
          void _type;
          void _board;
          void _finish;
          meta.draftLatents = {
            video: videoLat,
            audio: audioLat,
            width: Math.round(width / 2),
            height: Math.round(height / 2),
            frames,
            fps,
            request: { ...request, seed },
          };
        }
      }
      return { output: out, meta: Object.keys(meta).length ? meta : undefined };
    }, managed ? "managed" : "external");
  }

  /* ---------- FINISH (upscale): the Pixel Spatial Upscaler IC-LoRA ---------- */

  private async upscale(
    job: Job,
    payload: VideoPayload,
    report: (p: AdapterProgress) => void,
    ctrl: AbortController,
  ): Promise<{ output?: string; meta?: AssetMeta }> {
    const managed = this.settings.get().engines.videoMode === "managed";
    const { storage } = this.settings.get();
    const finish = payload.finish!;
    const source = path.join(storage.dataRoot, finish.source);
    if (!fs.existsSync(source)) throw new Error(`source take not found: ${finish.source}`);

    report({ progress: 1, stage: "Reading the source take" });
    const probe = await probeMedia(source);
    if (!probe.hasVideo || !probe.width || !probe.height || !probe.fps) {
      throw new Error(`"${path.basename(finish.source)}" has no readable video stream`);
    }
    const srcFps = probe.fps;
    const srcFrames = (await countFrames(source)) ?? Math.round((probe.duration ?? 0) * probe.fps);
    if (srcFrames < 9) throw new Error(`"${path.basename(finish.source)}" is too short to finish (${srcFrames} frames)`);
    // LTX's temporal grid: 8n+1 frames. A take off it (H3's 107) is trimmed
    // down to the grid — never padded, a held frame would be a visible stall
    const frames = Math.floor((srcFrames - 1) / 8) * 8 + 1;
    const fps = Math.round(probe.fps);
    const { width, height } = upscaleCanvas(probe.width, probe.height);

    report({ progress: 2, stage: managed ? "Starting engine" : "Queuing on ComfyUI" });
    return this.comfy.run(async (url) => {
      const client = new ComfyClient(url);
      if (!(await client.hasNodes(["LTXVDualCFGGuider", "GetICLoRAParameters"]))) {
        throw new Error(
          "The ×2 finish needs ComfyUI 0.32.0 or newer (GetICLoRAParameters / LTXVDualCFGGuider) — " +
            "update the ComfyUI that videoMode points at.",
        );
      }
      const icLoraName = resolveUpscalerLora(await client.comboOptions("LoraLoaderModelOnly", "lora_name"));
      if (!icLoraName) {
        throw new Error(
          "The Pixel Spatial Upscaler IC-LoRA is not in this ComfyUI's lora folder — " +
            "Settings → Models → LTX 2.5 Pixel Spatial Upscaler (IC-LoRA ×2), or drop " +
            "ltx-2.5-22b-ic-lora-pixel-spatial-upscaler-x2-1.0.safetensors into loras/.",
        );
      }

      report({ progress: 3, stage: "Staging the source take" });
      let staged = source;
      if (frames !== srcFrames) {
        staged = path.join(jobRunDir(job.id), `source-${frames}f.mp4`);
        await trimToFrames(source, staged, frames, srcFps);
      }
      const videoName = await client.uploadInput(`${job.id}-source.mp4`, fs.readFileSync(staged));

      const seed = payload.seed ?? Math.floor(Math.random() * 1_000_000_000);
      const graph = ltx25UpscaleGraph({
        prompt: payload.prompt,
        negative: payload.negativePrompt,
        videoName,
        icLoraName,
        width,
        height,
        fps,
        frames,
        hasAudio: probe.hasAudio,
        strength: finish.strength,
        seed,
        models: this.models.managedCopy("ltx-25-22b-int8") ? LTX25_MANAGED : LTX25_EXTERNAL,
        tuning: await resolveTuning(client, this.settings.get().engines.videoTuning),
        filenamePrefix: `aurea/${job.id}-finish`,
      });

      if (client.isWarm("ltx25")) {
        report({ progress: 3.5, stage: "LTX 2.5 still warm" });
      } else {
        report({ progress: 3.5, stage: "Clearing VRAM" });
        await client.freeMemory();
      }

      report({ progress: 4, stage: "Queuing on ComfyUI", detail: `${probe.width}×${probe.height} → ${width}×${height}` });
      const files = await client.run(graph, {
        signal: ctrl.signal,
        timeoutMs: 45 * 60_000,
        onNode: (classType) => {
          if (LOADERS.has(classType)) report({ stage: "Loading LTX 2.5 + the upscaler" });
          else if (classType === "LTXVAddGuide") report({ stage: "Encoding the reference" });
          else if (classType === "SamplerCustomAdvanced") report({ stage: "Rendering — ×2 finish" });
          else if (classType === "VAEDecodeTiled") report({ progress: 85, stage: "Decoding frames" });
          else if (classType === "CreateVideo" || classType === "SaveVideo") {
            report({ progress: 94, stage: "Encoding video" });
          }
        },
        onProgress: (value, max) => {
          if (max > 0) report({ progress: 6 + (value / max) * 79 });
        },
      }).catch((err: unknown) => {
        throw explainTuningFailure(err);
      });

      const video = files.find((f) => VIDEO_EXT.test(f.filename));
      if (!video) throw new Error("the ×2 finish finished without a video output");
      client.markWarm("ltx25");
      report({ progress: 97, stage: "Saving take" });
      const out = path.join(jobRunDir(job.id), "out", `take${path.extname(video.filename)}`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, video.data);
      return { output: out, meta: { finish: "upscale", source: finish.source } };
    }, managed ? "managed" : "external");
  }
}
