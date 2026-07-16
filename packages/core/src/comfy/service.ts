/* ComfyService — studiod's one door to a ComfyUI HTTP API.
 *
 * comfyMode "managed": spawns the EngineRuntime's headless ComfyUI (portable
 * venv python, free localhost port, extra_model_paths.yaml → dataRoot/models)
 * on first use, health-polls it up, and idle-unloads it after IDLE_MS unless
 * settings.advanced.keepModelsWarm. comfyMode "external": returns the user's
 * comfyUrl untouched (the escape hatch — ComfyUI Desktop, remote box, …).
 *
 * The GPU scheduler stays the JobEngine; this owns process lifecycle only. */

import net from "node:net";
import path from "node:path";
import type { SettingsStore } from "../settings.js";
import type { EngineRuntime } from "../runtime/runtime.js";
import { runProcess, type ProcHandle } from "../adapters/proc.js";
import { ComfyClient } from "./client.js";

/** managed instance shuts down after this long without a job */
const IDLE_MS = 10 * 60_000;
/** first boot imports torch + scans nodes — give it real time */
const BOOT_TIMEOUT_MS = 180_000;

export class ComfyService {
  private proc: ProcHandle | null = null;
  private baseUrl: string | null = null;
  private starting: Promise<string> | null = null;
  private idleTimer: NodeJS.Timeout | undefined;
  /** jobs currently inside run() — the idle clock only ticks at zero */
  private busy = 0;

  constructor(
    private settings: SettingsStore,
    private runtime: EngineRuntime,
  ) {}

  /** Run work against a live ComfyUI; the managed sidecar can't idle-unload
   * underneath it. This is the door adapters use. */
  async run<T>(fn: (url: string) => Promise<T>): Promise<T> {
    const url = await this.ensure();
    this.busy += 1;
    clearTimeout(this.idleTimer);
    try {
      return await fn(url);
    } finally {
      this.busy -= 1;
      if (this.busy === 0) this.touch();
    }
  }

  /** Base URL of a live ComfyUI, starting the managed sidecar if needed. */
  async ensure(): Promise<string> {
    const { engines } = this.settings.get();
    if (engines.comfyMode === "external") {
      const url = engines.comfyUrl.replace(/\/$/, "");
      if (!(await new ComfyClient(url).health())) {
        throw new Error(
          `ComfyUI is not reachable at ${url} — start it, or switch to the managed engine in Settings → Engines`,
        );
      }
      return url;
    }

    this.touch();
    if (this.baseUrl && this.proc) {
      if (await new ComfyClient(this.baseUrl).health()) return this.baseUrl;
      this.stop(); // process died underneath us — respawn
    }
    this.starting ??= this.spawn().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  /** shut the managed sidecar down (external instances are never touched) */
  stop(): void {
    clearTimeout(this.idleTimer);
    this.proc?.kill();
    this.proc = null;
    this.baseUrl = null;
  }

  close(): void {
    this.stop();
  }

  /* ---------- managed spawn ---------- */

  private async spawn(): Promise<string> {
    if (!this.runtime.componentReady("comfy")) {
      throw new Error(
        "The managed engine runtime is not installed — Settings → Engines → Install engine runtime",
      );
    }
    const dataRoot = this.settings.get().storage.dataRoot;
    const cache = (sub: string) => path.join(dataRoot, "cache", "comfy", sub);
    this.runtime.writeExtraModelPaths(); // regenerate: dataRoot may have moved
    const port = await freePort();

    const proc = runProcess({
      exe: this.runtime.venvPython(),
      args: [
        path.join(this.runtime.comfyDir(), "main.py"),
        "--listen", "127.0.0.1",
        "--port", String(port),
        "--extra-model-paths-config", this.runtime.extraModelPathsFile(),
        "--output-directory", cache("output"),
        "--temp-directory", cache("temp"),
        "--input-directory", cache("input"),
        "--disable-auto-launch",
      ],
      cwd: this.runtime.comfyDir(),
      logFile: path.join(this.runtime.root(), "comfy.log"),
    });
    this.proc = proc;

    const url = `http://127.0.0.1:${port}`;
    const client = new ComfyClient(url);
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    let exited = false;
    void proc.exited.then(() => {
      exited = true;
    });
    while (Date.now() < deadline) {
      if (exited) {
        this.proc = null;
        throw new Error(
          `managed ComfyUI exited during boot — see ${path.join(this.runtime.root(), "comfy.log")}`,
        );
      }
      if (await client.health(2_000)) {
        this.baseUrl = url;
        this.touch();
        return url;
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }
    this.stop();
    throw new Error("managed ComfyUI did not come up in time");
  }

  private touch(): void {
    clearTimeout(this.idleTimer);
    if (this.busy > 0 || this.settings.get().advanced.keepModelsWarm) return;
    this.idleTimer = setTimeout(() => {
      if (this.busy === 0) this.stop();
    }, IDLE_MS);
    this.idleTimer.unref();
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() =>
        addr && typeof addr === "object"
          ? resolve(addr.port)
          : reject(new Error("no free port")),
      );
    });
  });
}
