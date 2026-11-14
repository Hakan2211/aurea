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
import { PromptLibrary } from "./promptlib.js";
import { AbStore } from "./ab.js";
import { CoverageStore } from "./coverage.js";
import { StudioStore } from "./studio.js";
import { expectationOf, verifyDeliveredTake } from "./take-delivery.js";
import { ModelManager } from "./models/manager.js";
import { EngineRuntime } from "./runtime/runtime.js";
import { ComfyService } from "./comfy/service.js";
import { VideofastAdapter } from "./adapters/videofast.js";
import { ComfyImageAdapter } from "./adapters/comfy-image.js";
import { FalImageAdapter } from "./adapters/fal-image.js";
import { TtsAdapter } from "./adapters/tts.js";
import { DramaboxAdapter } from "./adapters/dramabox.js";
import { MusicAdapter } from "./adapters/music.js";
import { MinimaxMusicAdapter, MUSIC3_ENGINE_ID, music3Paths } from "./adapters/minimax-music.js";
import { Hunyuan3dAdapter } from "./adapters/hunyuan3d.js";
import { Music3Worker } from "./adapters/minimax-music-worker.js";
import { SeedVcAdapter } from "./adapters/seedvc.js";
import { ReplicateRvcAdapter, rvcModelPath } from "./adapters/replicate-rvc.js";
import { labEnqueue } from "./labs.js";
import { ComfyVideoAdapter } from "./adapters/comfy-video.js";
import { Ltx25VideoAdapter } from "./adapters/ltx25-video.js";
import { MinimaxVideoAdapter } from "./adapters/minimax-video.js";
import { MinimaxCoverageAdapter } from "./adapters/minimax-coverage.js";
import { SeedanceAdapter } from "./adapters/seedance.js";
import { FfmpegExportAdapter } from "./adapters/ffmpeg-export.js";
import { serveFile, serveMedia } from "./media.js";
import { appRouter, createCaller } from "./router.js";
import { InboxWatcher } from "./inbox.js";
import { AssemblyRunner } from "./assembly.js";
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
  // the MiniMax-Music3 pipeline stays loaded between songs; see
  // minimax-music-worker.ts for why (a cold start costs ~100s on this card)
  const music3 = new Music3Worker(() => music3Paths(settings));
  const scheduler = new GpuScheduler({
    lock: new GpuLock(() => {
      const vf = settings.get().paths.videofastDir;
      return vf ? path.join(vf, "batches", ".gpu.lock") : null;
    }),
    vram: { freeGb: () => monitor.freeGb() },
    engines: [
      { id: "comfy", warm: () => comfy.warm(), canEvict: () => comfy.canEvict(), evict: () => comfy.stop() },
      {
        id: MUSIC3_ENGINE_ID,
        warm: () => music3.warm(),
        canEvict: () => music3.canEvict(),
        evict: () => music3.evict(),
      },
    ],
  });
  const studio = new StudioStore(settings, projects);
  const engine = new JobEngine({
    adapters: [
      new VideofastAdapter(settings),
      new ComfyImageAdapter(settings, comfy, runtime, models),
      new FalImageAdapter(settings),
      new TtsAdapter(settings, runtime, models),
      new DramaboxAdapter(settings),
      new MusicAdapter(settings, runtime, models),
      new MinimaxMusicAdapter(music3, comfy),
      new Hunyuan3dAdapter(settings, comfy),
      new ReplicateRvcAdapter(settings),
      new SeedVcAdapter(settings, runtime),
      new ComfyVideoAdapter(settings, comfy, models),
      // the finish passes read a take's sidecar (its kept latents, its prompt)
      new Ltx25VideoAdapter(settings, comfy, models, projects),
      new MinimaxVideoAdapter(settings, models, comfy),
      new MinimaxCoverageAdapter(settings, models, comfy),
      new SeedanceAdapter(settings),
      new FfmpegExportAdapter(settings),
    ],
    storeFile: () => path.join(settings.get().storage.dataRoot, "jobs.json"),
    importOutput: (job, meta) => {
      const imported = projects.importJobOutputDetailed(job, meta);
      // storyboard delivery: finished stills become keyframes on their shot
      const board =
        job.payload?.type === "image" ||
        job.payload?.type === "video" ||
        job.payload?.type === "tts"
          ? job.payload.board
          : undefined;
      if (board && job.project && imported.files.length) {
        const projectId = job.project.replace(/^\//, "").split("/")[0];
        const dataRoot = settings.get().storage.dataRoot;
        const rels = imported.files.map((f) => path.relative(dataRoot, f).split(path.sep).join("/"));
        try {
          // stills become the shot's keyframes; a Director take becomes one of
          // its video takes; a table-read wav becomes a voice take tagged with
          // its script line (same delivery, three ends of the pipeline)
          if (job.payload?.type === "video") {
            const { shot } = studio.attachTake(projectId, board.shotId, rels, job.payload.engine, {
              durationSec: job.payload.durationSec,
              verify: true,
              // a preview (P5) is flagged on the take and carries its seed —
              // approving it hands that seed to the full render
              preview: !!job.payload.board?.preview,
              seed: job.payload.seed,
            });
            /* hard verification (P3.1) + room-tone fallback (P3.2), async —
             * the take is pending until it lands, broken shows red, and a
             * broken take never stays the one under review */
            const expect = expectationOf(job.payload);
            for (const take of shot.videoTakes.slice(-rels.length)) {
              verifyDeliveredTake({ studio, settings }, projectId, board.shotId, take.id, expect).catch(() => {
                // the take stays "pending" — verifyTake re-runs it on demand
              });
            }
          } else if (job.payload?.type === "tts") {
            studio.attachVoTake(
              projectId,
              board.shotId,
              rels,
              job.payload.engine,
              job.payload.board?.lineId,
            );
          } else {
            studio.attachKeyframes(projectId, board.shotId, rels);
          }
        } catch {
          // the shot was deleted while the render ran — the files stay in the library
        }
      }
      // 3D from a prompt: the still that just landed was drawn as scaffolding
      // for a mesh, so lift it now. Same chaining shape as cover art below —
      // the second job needs a file the first one had to produce first.
      if (
        job.payload?.type === "image" &&
        job.payload.model3d &&
        job.project &&
        imported.primary
      ) {
        const projectId = job.project.replace(/^\//, "").split("/")[0];
        const dataRoot = settings.get().storage.dataRoot;
        const source = path.relative(dataRoot, imported.primary).split(path.sep).join("/");
        engine.enqueue(
          labEnqueue(
            { type: "model3d", engine: "hunyuan3d-2.1", source, ...job.payload.model3d },
            projectId,
          ),
        );
      }

      // sung vocals in a cloned voice: chain a singing-conversion job on the
      // freshly imported track (the "convert after render" pass). A trained
      // RVC model + Replicate token wins over local Seed-VC — that per-voice
      // trained path is audibly better.
      let revoicing = false;
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
          revoicing = true;
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

      // room tone (P3.2): a seeded bed lands on its bible location
      const roomToneFor = job.payload?.type === "music" ? job.payload.roomTone : undefined;
      if (roomToneFor && job.project && imported.primary) {
        const projectId = job.project.replace(/^\//, "").split("/")[0];
        const dataRoot = settings.get().storage.dataRoot;
        const rel = path.relative(dataRoot, imported.primary).split(path.sep).join("/");
        try {
          studio.setLocationRoomTone(projectId, roomToneFor.location, rel);
        } catch {
          // the location was deleted while the bed rendered — the file stays in the library
        }
      }

      // cover art: a finished song gets a picture drawn for it, at batch
      // priority so it queues behind anything you actually asked for. Fired
      // for whichever file is the *finished* song — when a re-voice pass is
      // chained above, that pass's own import is the one that lands here, and
      // the sidecar it inherits already carries the brief to draw from.
      const finishedSong =
        job.payload?.type === "music" ||
        (job.payload?.type === "voiceConvert" && job.payload.context === "music");
      if (finishedSong && !revoicing && !roomToneFor && job.project && imported.primary) {
        const projectId = job.project.replace(/^\//, "").split("/")[0];
        const dataRoot = settings.get().storage.dataRoot;
        const rel = path.relative(dataRoot, imported.primary).split(path.sep).join("/");
        const sidecar = projects.assetMeta(rel);
        const cover = labs.coverArtJob(rel, projectId, {
          title: sidecar?.title ?? job.title,
          prompt: sidecar?.prompt,
          styles: sidecar?.styles,
        });
        if (cover) engine.enqueue(cover);
      }

      // …and the picture, when it lands, attaches itself to that song
      if (job.payload?.type === "image" && job.payload.cover && imported.primary) {
        const dataRoot = settings.get().storage.dataRoot;
        projects.patchMeta(job.payload.cover, {
          cover: path.relative(dataRoot, imported.primary).split(path.sep).join("/"),
        });
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
  const prompts = new PromptLibrary(settings);
  const ab = new AbStore(settings, engine);
  const coverage = new CoverageStore(settings, engine);
  // drop-folder import for stills made elsewhere (Midjourney has no API)
  const inbox = new InboxWatcher(projects);
  inbox.start();
  // scene assembly (N1.1): plan → execute over the same procedures the Desk calls
  const assembly = new AssemblyRunner({
    engine,
    studio,
    timelines,
    presets: (project) => prompts.videoPresets(project),
    // bound lazily: `base` (which holds this runner) exists by the first start
    verbs: () => {
      const caller = createCaller({ ...base, authed: true });
      return {
        tableRead: (i) => caller.studio.voice.tableRead(i),
        board: (i) => caller.studio.board.generate({ ...i, count: 1 }),
        render: (i) => caller.studio.board.renderShot(i),
      };
    },
  });
  const base: Omit<Context, "authed"> = { engine, monitor, settings, projects, labs, director, models, runtime, timelines, studio, prompts, ab, coverage, inbox, assembly };

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
      inbox.close();
      comfy.close();
      music3.stop("studiod closing");
      models.close();
      runtime.close();
      monitor.close();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (opts.writePortFile) await clearPortFile(process.pid);
    },
  };
}
