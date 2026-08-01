/* studiod boot: one Node process owning the GPU queue, serving tRPC over
 * localhost HTTP (queries/mutations) + WS (subscriptions). Auth is a per-boot
 * bearer token — localhost ports are reachable by any local process, so the
 * token is the boundary. Clients get it from the Electron bridge or the
 * port file (~/.aurea/studiod.json). */

import fs from "node:fs";
import http from "node:http";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { WebSocketServer } from "ws";
import { JobEngine } from "./jobs.js";
import { GpuLock } from "./gpulock.js";
import { GpuScheduler } from "./scheduler.js";
import { SystemMonitor } from "./system.js";
import { SettingsStore } from "./settings.js";
import { ProjectStore } from "./projects.js";
import { Labs } from "./labs.js";
import { DirectorService } from "./director.js";
import { TimelineStore } from "./timeline.js";
import { StudioStore } from "./studio.js";
import { ModelManager } from "./models/manager.js";
import { EngineRuntime } from "./runtime/runtime.js";
import { ComfyService } from "./comfy/service.js";
import { VideofastAdapter } from "./adapters/videofast.js";
import { ComfyImageAdapter } from "./adapters/comfy-image.js";
import { TtsAdapter } from "./adapters/tts.js";
import { DramaboxAdapter } from "./adapters/dramabox.js";
import { MusicAdapter } from "./adapters/music.js";
import { SeedVcAdapter } from "./adapters/seedvc.js";
import { ReplicateRvcAdapter, rvcModelPath } from "./adapters/replicate-rvc.js";
import { labEnqueue } from "./labs.js";
import { ComfyVideoAdapter } from "./adapters/comfy-video.js";
import { SeedanceAdapter } from "./adapters/seedance.js";
import { FfmpegExportAdapter } from "./adapters/ffmpeg-export.js";
import { serveFile, serveMedia } from "./media.js";
import { appRouter } from "./router.js";
import type { Context } from "./trpc.js";
import { clearPortFile, writePortFile } from "./portfile.js";

export interface StudiodOptions {
  /** 0 (default) lets the OS assign a free port */
  port?: number;
  /** per-boot random token unless pinned (headless dev) */
  token?: string;
  /** record port+token+pid in ~/.aurea/studiod.json for discovery */
  writePortFile?: boolean;
}

export interface StudiodHandle {
  port: number;
  token: string;
  close: () => Promise<void>;
}

const bearer = (header: string | undefined) =>
  header?.startsWith("Bearer ") ? header.slice(7) : undefined;

export async function startStudiod(opts: StudiodOptions = {}): Promise<StudiodHandle> {
  const token = opts.token ?? randomBytes(24).toString("base64url");

  const settings = new SettingsStore();
  const projects = new ProjectStore(settings);
  projects.ensureDefault();
  const models = new ModelManager(settings);
  const runtime = new EngineRuntime(settings);
  const comfy = new ComfyService(settings, runtime);
  const monitor = new SystemMonitor(settings);
  const scheduler = new GpuScheduler({
    lock: new GpuLock(() => {
      const vf = settings.get().paths.videofastDir;
      return vf ? path.join(vf, "batches", ".gpu.lock") : null;
    }),
    vram: { freeGb: () => monitor.freeGb() },
    engines: [
      { id: "comfy", warm: () => comfy.warm(), canEvict: () => comfy.canEvict(), evict: () => comfy.stop() },
    ],
  });
  const studio = new StudioStore(settings, projects);
  const engine = new JobEngine({
    adapters: [
      new VideofastAdapter(settings),
      new ComfyImageAdapter(settings, comfy, runtime, models),
      new TtsAdapter(settings, runtime, models),
      new DramaboxAdapter(settings),
      new MusicAdapter(settings, runtime, models),
      new ReplicateRvcAdapter(settings),
      new SeedVcAdapter(settings, runtime),
      new ComfyVideoAdapter(settings, comfy, models),
      new SeedanceAdapter(settings),
      new FfmpegExportAdapter(settings),
    ],
    storeFile: () => path.join(settings.get().storage.dataRoot, "jobs.json"),
    importOutput: (job, meta) => {
      const imported = projects.importJobOutputDetailed(job, meta);
      // storyboard delivery: finished stills become keyframes on their shot
      const board =
        job.payload?.type === "image" || job.payload?.type === "video"
          ? job.payload.board
          : undefined;
      if (board && job.project && imported.files.length) {
        const projectId = job.project.replace(/^\//, "").split("/")[0];
        const dataRoot = settings.get().storage.dataRoot;
        const rels = imported.files.map((f) => path.relative(dataRoot, f).split(path.sep).join("/"));
        try {
          // stills become the shot's keyframes; a Director take becomes one of
          // its video takes (same delivery, opposite ends of the pipeline)
          if (job.payload?.type === "video") {
            studio.attachTake(projectId, board.shotId, rels, job.payload.engine);
          } else {
            studio.attachKeyframes(projectId, board.shotId, rels);
          }
        } catch {
          // the shot was deleted while the render ran — the files stay in the library
        }
      }
      // sung vocals in a cloned voice: chain a singing-conversion job on the
      // freshly imported track (the "convert after render" pass). A trained
      // RVC model + Replicate token wins over local Seed-VC — that per-voice
      // trained path is audibly better.
      if (
        job.payload?.type === "music" &&
        job.payload.arrangement === "vocals" &&
        job.payload.singVoice &&
        job.project &&
        imported.primary
      ) {
        const projectId = job.project.replace(/^\//, "").split("/")[0];
        const dataRoot = settings.get().storage.dataRoot;
        const rvc =
          !!settings.get().providers.replicateApiToken &&
          fs.existsSync(rvcModelPath(dataRoot, job.payload.singVoice));
        if (rvc || runtime.componentReady("seedvc")) {
          const source = path.relative(dataRoot, imported.primary).split(path.sep).join("/");
          engine.enqueue(
            labEnqueue(
              {
                type: "voiceConvert",
                context: "music",
                engine: rvc ? "rvc" : undefined,
                source,
                voice: job.payload.singVoice,
                mode: "sing",
                diffusionSteps: 30,
                semitoneShift: 0,
                // measure the song vs the chosen voice and octave-correct the
                // vocals into its register — works for any voice, either direction
                pitchMode: "auto",
                lengthAdjust: 1,
                cfgRate: 0.7,
              },
              projectId,
            ),
          );
        }
      }
      return imported.primary;
    },
    scheduler,
  });
  const labs = new Labs(settings, models, runtime, comfy);
  // the Director's tools call back into this very server; coords resolve after listen
  let selfCoords: { port: number; token: string } | null = null;
  const director = new DirectorService(settings, () => {
    if (!selfCoords) throw new Error("studiod is not listening yet");
    return selfCoords;
  });
  const timelines = new TimelineStore(settings);
  const base: Omit<Context, "authed"> = { engine, monitor, settings, projects, labs, director, models, runtime, timelines, studio };

  const trpcHandler = createHTTPHandler({
    router: appRouter,
    createContext: ({ req }): Context => ({
      ...base,
      authed: bearer(req.headers.authorization) === token,
    }),
  });

  const server = http.createServer((req, res) => {
    // the renderer calls from an http://localhost:5173 or file:// origin
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "authorization, content-type, trpc-accept, x-trpc-source");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    // unauthenticated liveness probe for port-file reuse detection
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "studiod", pid: process.pid }));
      return;
    }
    // library file streaming for <img>/<video> (token in query string)
    if (req.url?.startsWith("/media/")) {
      serveMedia(req, res, settings.get().storage.dataRoot, token);
      return;
    }
    // voice-roster reference clips (may live outside dataRoot — videofast refs)
    if (req.url?.startsWith("/voiceref/")) {
      const id = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname.slice("/voiceref/".length),
      );
      const file = /^[a-z0-9][a-z0-9-]*$/.test(id) ? labs.voiceRefPath(id) : null;
      if (!file) {
        res.writeHead(404).end();
        return;
      }
      serveFile(req, res, file, token);
      return;
    }
    trpcHandler(req, res);
  });

  const wss = new WebSocketServer({ server });
  const wsHandler = applyWSSHandler({
    wss,
    router: appRouter,
    // browsers can't set WS headers; the token rides in connectionParams
    createContext: ({ info }): Context => ({
      ...base,
      authed: info.connectionParams?.token === token,
    }),
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else reject(new Error("studiod: could not determine bound port"));
    });
  });

  selfCoords = { port, token };

  if (opts.writePortFile) {
    await writePortFile({ port, token, pid: process.pid });
  }

  return {
    port,
    token,
    close: async () => {
      wsHandler.broadcastReconnectNotification();
      engine.close();
      comfy.close();
      models.close();
      runtime.close();
      monitor.close();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (opts.writePortFile) await clearPortFile(process.pid);
    },
  };
}
