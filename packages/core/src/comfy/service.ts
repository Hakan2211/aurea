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

/* --- external-mode port discovery -------------------------------------------
 * ComfyUI Desktop does not keep a stable port: launched from its icon it binds
 * 8188, while a CLI/managed-style launch lands wherever it was told. A user who
 * configured 8000 once then opens the app from the desktop icon the next
 * morning gets a lab where the Director toggle is greyed out and the end-frame
 * section has vanished — every capability is probe-gated, so a single wrong
 * port reads as "half the engine is missing" rather than "nothing answered".
 * That failure recurred often enough to be worth designing away.
 *
 * So external mode treats comfyUrl as a *preference*, not an address: try it
 * first, and if nothing answers, look at the handful of ports a ComfyUI
 * realistically binds on this machine.
 *
 * A candidate must prove it is the LTX install before being adopted. MiniMax-H3
 * may run its own separate ComfyUI (engines.minimaxUrl) which would
 * otherwise pass a bare health check and then fail every LTX render deep inside
 * a queued graph. Probing for a core LTX node is what tells the two apart. */
const DISCOVERY_PORTS = [8188, 8000, 8189, 8288, 7860];
/** re-discovery is cheap but not free; a hit is trusted this long */
const DISCOVERY_TTL_MS = 30_000;

/* Which ComfyUI is which, by node signature. Ports can't answer this — the H3
 * instance was observed on 8188 (its configured port is 8189), and a core
 * LTX node is NOT a distinguishing marker: as of ComfyUI 0.30 the whole base
 * LTX template except the Director pack ships in core, so the H3 install
 * answers to LTXVAddGuide too. Measured 2026-08-06 on the 0.30.2 instance:
 * 825 classes, every base-template node present, LTXDirector absent. */
/** the WhatDreamsCost pack — only the LTX install Aurea drives has it, and it
 * is what Director mode, cast references and retakes are built from */
const FULL_SURFACE_NODE = "LTXDirector";
/** enough to run the plain i2v template (core-only install) */
const BASE_LTX_NODE = "LTXVImgToVideoInplace";
/** the MiniMax-H3 sidecar's own node pack — never adopt this as the LTX engine */
const MINIMAX_NODE = "MiniMaxH3ImageToVideo";

export class ComfyService {
  private proc: ProcHandle | null = null;
  private baseUrl: string | null = null;
  private starting: Promise<string> | null = null;
  private idleTimer: NodeJS.Timeout | undefined;
  /** external mode: a ComfyUI found on a port other than the configured one */
  private discovered: string | null = null;
  private discoveredAt = 0;
  /** what discovery saw but would not adopt — the difference between "nothing
   * is running" and "the wrong ComfyUI is running", which is the single most
   * common way this lab looks broken */
  private discoveryNote: string | null = null;

  /** one line explaining the last failed external lookup, if it can say more
   * than "nothing answered" */
  lastDiscoveryNote(): string | null {
    return this.discoveryNote;
  }

  /* --- where MiniMax-H3 runs -------------------------------------------------
   * H3 needed its own address because it requires ComfyUI 0.30+, which the LTX
   * install predated — two cores, two servers, two ports. That is no longer
   * structural: as of 0.30 the MiniMaxH3* nodes ship in CORE, so a single
   * ComfyUI on 0.30+ with the Director pack loaded answers for both engines.
   * Verified 2026-08-06 on one instance: 1795 classes carrying LTXDirector,
   * LoadVideoUI.filename, MiniMaxH3ImageToVideo and UnetLoaderGGUF together.
   *
   * So minimaxUrl now means "H3 lives somewhere else"; leave it empty and H3
   * runs wherever LTX does, including a discovered port. Two adapters on one
   * server is safe — both report {klass:"gpu", engineId:"comfy"}, so the
   * scheduler already serialises them on the same GPU lane. */
  minimaxUrl(): string {
    const { engines } = this.settings.get();
    const explicit = engines.minimaxUrl.trim().replace(/\/$/, "");
    if (explicit) return explicit;
    return this.idleUrl(engines.videoMode) ?? "";
  }

  /** minimaxUrl(), allowed to run discovery when H3 shares the LTX server */
  async minimaxUrlResolved(): Promise<string> {
    const { engines } = this.settings.get();
    const explicit = engines.minimaxUrl.trim().replace(/\/$/, "");
    if (explicit) return explicit;
    return (await this.idleUrlResolved(engines.videoMode)) ?? "";
  }
  /** jobs currently inside run() — the idle clock only ticks at zero */
  private busy = 0;

  constructor(
    private settings: SettingsStore,
    private runtime: EngineRuntime,
  ) {}

  /** Run work against a live ComfyUI; the managed sidecar can't idle-unload
   * underneath it. This is the door adapters use. mode defaults to the image
   * pipeline's comfyMode; the video adapter passes its own videoMode. */
  async run<T>(fn: (url: string) => Promise<T>, mode?: "managed" | "external"): Promise<T> {
    const url = await this.ensure(mode);
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
  async ensure(mode?: "managed" | "external"): Promise<string> {
    const { engines } = this.settings.get();
    if ((mode ?? engines.comfyMode) === "external") {
      const url = await this.resolveExternal();
      if (!url) {
        const configured = engines.comfyUrl.replace(/\/$/, "");
        throw new Error(
          `ComfyUI is not reachable at ${configured}, and no ComfyUI answered on ` +
            `${DISCOVERY_PORTS.join(", ")} either — start it, or switch to the managed ` +
            "engine in Settings → Engines",
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

  /** managed sidecar is resident (holding VRAM) — external is never "warm" */
  warm(): boolean {
    return this.proc !== null;
  }

  /** URL of a ComfyUI we could talk to *right now*, without starting anything:
   * the configured one in external mode, the managed sidecar only while it is
   * already resident. Capability probes use this — booting a sidecar to answer
   * "which nodes do you have?" would cost 3 minutes and a GPU. */
  idleUrl(mode?: "managed" | "external"): string | null {
    const { engines } = this.settings.get();
    if ((mode ?? engines.comfyMode) === "external") {
      return this.discovered ?? engines.comfyUrl.replace(/\/$/, "");
    }
    return this.baseUrl;
  }

  /** Same question as idleUrl, but allowed to go looking. Capability probes use
   * this so a ComfyUI on an unexpected port is found instead of reported as a
   * pile of missing features. Still passive: it never boots anything. */
  async idleUrlResolved(mode?: "managed" | "external"): Promise<string | null> {
    const { engines } = this.settings.get();
    if ((mode ?? engines.comfyMode) === "external") return this.resolveExternal();
    return this.baseUrl;
  }

  /** The live external ComfyUI: the configured URL when it answers, otherwise
   * the first discovered port carrying the LTX pipeline. Null if none does. */
  private async resolveExternal(): Promise<string | null> {
    const configured = this.settings.get().engines.comfyUrl.replace(/\/$/, "");
    if (await new ComfyClient(configured).health()) {
      this.discovered = null; // the user's own setting works — nothing to override
      return configured;
    }

    if (this.discovered && Date.now() < this.discoveredAt + DISCOVERY_TTL_MS) {
      return this.discovered;
    }

    const configuredPort = Number(new URL(configured).port) || 80;
    // rank rather than take the first responder: a core-only ComfyUI can run
    // the plain template but greys out half the lab, so a full-surface install
    // on a later port must still win
    let fallback: string | null = null;
    const rejected: string[] = [];
    for (const port of DISCOVERY_PORTS) {
      if (port === configuredPort) continue; // just failed its health check
      const url = `http://127.0.0.1:${port}`;
      const client = new ComfyClient(url);
      if (!(await client.health(1_500))) continue;
      if (await client.hasNode(FULL_SURFACE_NODE)) {
        this.discovered = url;
        this.discoveredAt = Date.now();
        this.discoveryNote = null;
        return url;
      }
      // no Director pack: usable for plain renders, but only if this isn't the
      // H3 sidecar wearing a ComfyUI's clothes
      if (await client.hasNode(MINIMAX_NODE)) {
        rejected.push(`${url} is the MiniMax-H3 ComfyUI, not the LTX one`);
      } else if (await client.hasNode(BASE_LTX_NODE)) {
        fallback ??= url;
      } else {
        rejected.push(`${url} is a ComfyUI without the LTX pipeline`);
      }
    }
    this.discovered = fallback;
    this.discoveredAt = Date.now();
    this.discoveryNote =
      !fallback && rejected.length
        ? `A ComfyUI is running, but not the one Aurea's video engine needs: ${rejected.join("; ")}. ` +
          "Launch the LTX install (the one whose custom_nodes has WhatDreamsCost-ComfyUI) " +
          "and it will be picked up automatically."
        : null;
    return fallback;
  }

  /** resident, idle, and not mid-boot — safe for the scheduler to evict */
  canEvict(): boolean {
    return this.proc !== null && this.busy === 0 && !this.starting;
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
