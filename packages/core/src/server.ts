/* studiod boot: one Node process owning the GPU queue, serving tRPC over
 * localhost HTTP (queries/mutations) + WS (subscriptions). Auth is a per-boot
 * bearer token — localhost ports are reachable by any local process, so the
 * token is the boundary. Clients get it from the Electron bridge or the
 * port file (~/.aurea/studiod.json). */

import http from "node:http";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { WebSocketServer } from "ws";
import { JobEngine } from "./jobs.js";
import { GpuLock } from "./gpulock.js";
import { SystemMonitor } from "./system.js";
import { SettingsStore } from "./settings.js";
import { ProjectStore } from "./projects.js";
import { Labs } from "./labs.js";
import { DirectorService } from "./director.js";
import { ModelManager } from "./models/manager.js";
import { EngineRuntime } from "./runtime/runtime.js";
import { ComfyService } from "./comfy/service.js";
import { VideofastAdapter } from "./adapters/videofast.js";
import { ComfyImageAdapter } from "./adapters/comfy-image.js";
import { TtsAdapter } from "./adapters/tts.js";
import { MusicAdapter } from "./adapters/music.js";
import { LtxVideoAdapter } from "./adapters/ltx.js";
import { serveMedia } from "./media.js";
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
  const engine = new JobEngine({
    adapters: [
      new VideofastAdapter(settings),
      new ComfyImageAdapter(settings, comfy),
      new TtsAdapter(settings, runtime, models),
      new MusicAdapter(settings, runtime, models),
      new LtxVideoAdapter(settings),
    ],
    storeFile: () => path.join(settings.get().storage.dataRoot, "jobs.json"),
    importOutput: (job) => projects.importJobOutput(job),
    gpuLock: new GpuLock(() => {
      const vf = settings.get().paths.videofastDir;
      return vf ? path.join(vf, "batches", ".gpu.lock") : null;
    }),
  });
  const monitor = new SystemMonitor(settings);
  const labs = new Labs(settings, models, runtime);
  // the Director's tools call back into this very server; coords resolve after listen
  let selfCoords: { port: number; token: string } | null = null;
  const director = new DirectorService(settings, () => {
    if (!selfCoords) throw new Error("studiod is not listening yet");
    return selfCoords;
  });
  const base: Omit<Context, "authed"> = { engine, monitor, settings, projects, labs, director, models, runtime };

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
