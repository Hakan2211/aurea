/* EngineRuntime — the managed engine substrate under <dataRoot>/runtime/:
 *
 *   runtime/python/       portable CPython (python-build-standalone, pinned)
 *   runtime/comfy/        headless ComfyUI source at a pinned release tag
 *   runtime/comfy-venv/   ComfyUI's own venv (CUDA torch + requirements.txt)
 *   runtime/downloads/    archives (resumable, shared .part protocol)
 *   runtime/pip-cache/    pip wheel cache, kept inside dataRoot
 *   runtime/extra_model_paths.yaml   points ComfyUI at <dataRoot>/models
 *   runtime/runtime.json  installed versions (a pin change = reinstall)
 *
 * This is what makes the P1 exit criterion possible: a clean Windows machine
 * gets Python and ComfyUI from the wizard, no terminal, no system installs.
 * Everything is user-writable and lives under the one storage root. */

import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { RuntimeComponent, RuntimeComponentId, RuntimeStatus } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import { runProcess } from "../adapters/proc.js";
import { downloadFile } from "./download.js";

/** pinned upstream builds — bump deliberately, never silently */
export const PYTHON_PIN = {
  version: "3.12.13",
  /** python-build-standalone release tag */
  tag: "20260623",
  url: "https://github.com/astral-sh/python-build-standalone/releases/download/20260623/cpython-3.12.13%2B20260623-x86_64-pc-windows-msvc-install_only.tar.gz",
  sizeBytes: 46013305,
  sha256: "c6af85bb83d5158c9ff71f50dfad467853d1cd236f932b144e87e26e2ea2a83e",
};

export const COMFY_PIN = {
  tag: "v0.28.0",
  /** GitHub tag archive (no published sha — verified structurally instead) */
  url: "https://github.com/Comfy-Org/ComfyUI/archive/refs/tags/v0.28.0.zip",
};

const TORCH_INDEX = "https://download.pytorch.org/whl/cu128";
/** rough site-packages + wheel cache footprint of the torch + requirements
 * installs, for progress estimation only */
const PIP_EXPECTED_BYTES = 9 * 1024 ** 3;

/** ComfyUI model categories that resolve inside <dataRoot>/models. Weights
 * are referenced by registry-relative paths ("<model-id>/vae/ae.safetensors"),
 * so every category can point at the same root without name collisions. */
const COMFY_CATEGORIES = [
  "checkpoints",
  "diffusion_models",
  "text_encoders",
  "clip",
  "vae",
  "loras",
  "upscale_models",
  "clip_vision",
  "controlnet",
];

interface RuntimeRecord {
  python?: string;
  comfy?: string;
  installedAt?: string;
}

interface LiveComponent {
  state: "installing" | "error";
  progress: number;
  stage: string | null;
  detail: string | null;
  error: string | null;
}

const PUBLISH_MS = 400;

export class EngineRuntime extends EventEmitter {
  /** live install state per component while install() runs (or after failure) */
  private live = new Map<RuntimeComponentId, LiveComponent>();
  private ctrl: AbortController | null = null;
  private killLive: (() => void) | null = null;
  private lastPublish = 0;
  private publishTimer: NodeJS.Timeout | undefined;

  constructor(private settings: SettingsStore) {
    super();
  }

  /* ---------- paths (all derived from the settings storage root) ---------- */

  root(): string {
    return path.join(this.settings.get().storage.dataRoot, "runtime");
  }

  pythonExe(): string {
    return path.join(this.root(), "python", "python.exe");
  }

  comfyDir(): string {
    return path.join(this.root(), "comfy");
  }

  venvPython(): string {
    return path.join(this.root(), "comfy-venv", "Scripts", "python.exe");
  }

  extraModelPathsFile(): string {
    return path.join(this.root(), "extra_model_paths.yaml");
  }

  /* ---------- status ---------- */

  status(): RuntimeStatus {
    const record = this.record();
    const component = (
      id: RuntimeComponentId,
      name: string,
      pinned: string,
      ready: boolean,
      version: string | null,
    ): RuntimeComponent => {
      const live = this.live.get(id);
      if (live) return { id, name, pinned, version, ...live };
      return {
        id,
        name,
        pinned,
        state: ready ? "ready" : "absent",
        version: ready ? version : null,
        progress: ready ? 100 : 0,
        stage: null,
        detail: null,
        error: null,
      };
    };
    const components = [
      component(
        "python",
        "Python runtime",
        PYTHON_PIN.version,
        this.pythonReady(record),
        record.python ?? null,
      ),
      component(
        "comfy",
        "ComfyUI engine",
        COMFY_PIN.tag,
        this.comfyReady(record),
        record.comfy ?? null,
      ),
    ];
    return {
      ready: components.every((c) => c.state === "ready"),
      installing: this.ctrl !== null,
      components,
    };
  }

  private pythonReady(record: RuntimeRecord): boolean {
    return record.python === PYTHON_PIN.version && fs.existsSync(this.pythonExe());
  }

  private comfyReady(record: RuntimeRecord): boolean {
    return (
      record.comfy === COMFY_PIN.tag &&
      fs.existsSync(path.join(this.comfyDir(), "main.py")) &&
      fs.existsSync(this.venvPython())
    );
  }

  /* ---------- install ---------- */

  /** Install (or finish installing) everything that isn't ready. Resolves
   * when the runtime is ready; rejects on failure or cancel. */
  install(): RuntimeStatus {
    if (this.ctrl) return this.status();
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    void (async () => {
      const record = this.record();
      if (!this.pythonReady(record)) await this.installPython(ctrl.signal);
      if (!this.comfyReady(this.record())) await this.installComfy(ctrl.signal);
    })()
      .then(() => this.live.clear())
      .catch((err: unknown) => {
        for (const [id, live] of this.live) {
          if (live.state !== "installing") continue;
          if (ctrl.signal.aborted) {
            // cancel keeps partials silently; next install resumes
            this.live.delete(id);
          } else {
            live.state = "error";
            live.error = err instanceof Error ? err.message : String(err);
            live.stage = null;
            live.detail = null;
          }
        }
      })
      .finally(() => {
        this.ctrl = null;
        this.killLive = null;
        this.publish();
      });
    return this.status();
  }

  cancel(): RuntimeStatus {
    this.ctrl?.abort();
    this.killLive?.();
    return this.status();
  }

  close(): void {
    this.ctrl?.abort();
    this.killLive?.();
    clearTimeout(this.publishTimer);
    this.removeAllListeners();
  }

  /* ---------- python ---------- */

  private async installPython(signal: AbortSignal): Promise<void> {
    const live = this.begin("python");
    const archive = path.join(this.root(), "downloads", `cpython-${PYTHON_PIN.version}.tar.gz`);

    live.stage = "Downloading Python";
    this.publish();
    await downloadFile(
      {
        url: PYTHON_PIN.url,
        label: "Python runtime",
        sizeBytes: PYTHON_PIN.sizeBytes,
        sha256: PYTHON_PIN.sha256,
      },
      archive,
      signal,
      {
        onBytes: (n) => {
          live.progress = (n / PYTHON_PIN.sizeBytes) * 70;
          live.detail = fmtBytes(n);
          this.publish();
        },
        onVerifying: () => {
          live.detail = "verifying partial download";
          this.publish();
        },
      },
    );

    live.stage = "Unpacking";
    live.progress = 70;
    live.detail = null;
    this.publish();
    // the archive's top-level "python/" dir becomes runtime/python
    const staging = path.join(this.root(), ".staging-python");
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(path.join(this.root(), "python"), { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    await this.extract(archive, staging, signal);
    fs.renameSync(path.join(staging, "python"), path.join(this.root(), "python"));
    fs.rmSync(staging, { recursive: true, force: true });

    live.stage = "Checking";
    live.progress = 90;
    this.publish();
    const version = await this.capture(this.pythonExe(), ["--version"], signal);
    if (!version.includes(PYTHON_PIN.version)) {
      throw new Error(`Python runtime check failed: got "${version}"`);
    }
    fs.rmSync(archive, { force: true });
    this.saveRecord({ python: PYTHON_PIN.version });
    this.live.delete("python");
    this.publish();
  }

  /* ---------- comfy ---------- */

  private async installComfy(signal: AbortSignal): Promise<void> {
    const live = this.begin("comfy");
    const root = this.root();
    const venvDir = path.join(root, "comfy-venv");
    const cacheDir = path.join(root, "pip-cache");
    const pip = (args: string[]) => [
      "-m", "pip", "install", "--disable-pip-version-check", "--no-input",
      "--cache-dir", cacheDir, ...args,
    ];

    if (!fs.existsSync(path.join(this.comfyDir(), "main.py"))) {
      live.stage = `Downloading ComfyUI ${COMFY_PIN.tag}`;
      this.publish();
      const archive = path.join(root, "downloads", `ComfyUI-${COMFY_PIN.tag}.zip`);
      // GitHub generates tag archives on the fly — size unknown, no resume
      await downloadFile(
        { url: COMFY_PIN.url, label: "ComfyUI source", sizeBytes: null, sha256: null },
        archive,
        signal,
        {
          onBytes: (n) => {
            live.progress = Math.min(8, n / (3 * 1024 ** 2));
            live.detail = fmtBytes(n);
            this.publish();
          },
        },
      );

      live.stage = "Unpacking";
      live.progress = 8;
      live.detail = null;
      this.publish();
      const staging = path.join(root, ".staging-comfy");
      fs.rmSync(staging, { recursive: true, force: true });
      fs.rmSync(this.comfyDir(), { recursive: true, force: true });
      fs.mkdirSync(staging, { recursive: true });
      await this.extract(archive, staging, signal);
      // archive root is ComfyUI-<tag without v>; take the single entry
      const entries = fs.readdirSync(staging);
      if (entries.length !== 1 || !fs.existsSync(path.join(staging, entries[0], "main.py"))) {
        throw new Error(`unexpected ComfyUI archive layout: ${entries.join(", ")}`);
      }
      fs.renameSync(path.join(staging, entries[0]), this.comfyDir());
      fs.rmSync(staging, { recursive: true, force: true });
      fs.rmSync(archive, { force: true });
    }

    if (!fs.existsSync(this.venvPython())) {
      live.stage = "Creating environment";
      live.progress = 12;
      live.detail = null;
      this.publish();
      await this.run(this.pythonExe(), ["-m", "venv", venvDir], signal, live);
    }

    // pip runs are resumable as a whole: already-satisfied packages are no-ops
    const poller = this.startSizePoller([venvDir, cacheDir], live, 15, 70);
    try {
      live.stage = "Installing PyTorch (CUDA 12.8) — several GB, takes a while";
      live.progress = 15;
      this.publish();
      // --index-url (not extra): PyPI must not win with a newer CPU-only build
      await this.run(
        this.venvPython(),
        pip(["torch", "torchvision", "torchaudio", "--index-url", TORCH_INDEX]),
        signal,
        live,
      );

      poller.band(70, 95);
      live.stage = "Installing ComfyUI requirements";
      live.progress = 70;
      this.publish();
      await this.run(
        this.venvPython(),
        pip(["-r", path.join(this.comfyDir(), "requirements.txt")]),
        signal,
        live,
      );
    } finally {
      poller.stop();
    }

    live.stage = "Checking";
    live.progress = 95;
    live.detail = null;
    this.publish();
    const torch = await this.capture(
      this.venvPython(),
      ["-c", "import torch;print(torch.__version__+' cuda='+str(torch.cuda.is_available()))"],
      signal,
    );
    if (!/cuda=/.test(torch)) throw new Error(`torch import failed: ${torch || "(no output)"}`);
    live.detail = `torch ${torch}`;

    this.writeExtraModelPaths();
    this.saveRecord({ comfy: COMFY_PIN.tag });
    this.live.delete("comfy");
    this.publish();
  }

  /** Regenerated on every write so a moved dataRoot stays correct. */
  writeExtraModelPaths(): void {
    const models = path.join(this.settings.get().storage.dataRoot, "models").replaceAll("\\", "/");
    const lines = [
      "# generated by Aurea — every category resolves inside the model manager's root;",
      "# graphs reference weights as <model-id>/<category>/<file>, so no collisions.",
      "aurea:",
      `  base_path: ${models}`,
      ...COMFY_CATEGORIES.map((c) => `  ${c}: "."`),
      "",
    ];
    fs.mkdirSync(this.root(), { recursive: true });
    fs.writeFileSync(this.extraModelPathsFile(), lines.join("\n"));
  }

  /* ---------- helpers ---------- */

  private begin(id: RuntimeComponentId): LiveComponent {
    const live: LiveComponent = {
      state: "installing",
      progress: 0,
      stage: null,
      detail: null,
      error: null,
    };
    this.live.set(id, live);
    this.publish();
    return live;
  }

  private async extract(archive: string, dest: string, signal: AbortSignal): Promise<void> {
    // Windows ships bsdtar (System32) which reads both .tar.gz and .zip
    const tar =
      process.platform === "win32"
        ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
        : "tar";
    await this.run(tar, ["-xf", archive, "-C", dest], signal, null);
  }

  /** run a child to completion; non-zero exit throws with the last error line */
  private async run(
    exe: string,
    args: string[],
    signal: AbortSignal,
    live: LiveComponent | null,
  ): Promise<void> {
    let lastLine = "";
    const proc = runProcess({
      exe,
      args,
      logFile: path.join(this.rootEnsured(), "install.log"),
      onLine: (line) => {
        const t = line.trim();
        if (!t) return;
        lastLine = t;
        if (live) {
          live.detail = t.length > 140 ? `${t.slice(0, 140)}…` : t;
          this.publish();
        }
      },
    });
    this.killLive = proc.kill;
    const onAbort = () => proc.kill();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const code = await proc.exited;
      if (signal.aborted) throw new Error("Canceled");
      if (code !== 0) {
        throw new Error(lastLine || `${path.basename(exe)} exited with code ${code}`);
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      this.killLive = null;
    }
  }

  private async capture(exe: string, args: string[], signal: AbortSignal): Promise<string> {
    let out = "";
    const proc = runProcess({ exe, args, onLine: (l) => (out += (out ? " " : "") + l.trim()) });
    const onAbort = () => proc.kill();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      await proc.exited;
      return out;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  /** pip prints nothing during large wheel downloads — estimate progress from
   * how much landed in the venv + wheel cache instead. */
  private startSizePoller(
    dirs: string[],
    live: LiveComponent,
    from: number,
    to: number,
  ): { band: (from: number, to: number) => void; stop: () => void } {
    let lo = from;
    let hi = to;
    const base = dirs.map((d) => dirSize(d));
    const timer = setInterval(() => {
      const grown = dirs.reduce((sum, d, i) => sum + Math.max(0, dirSize(d) - base[i]), 0);
      const frac = Math.min(0.98, grown / PIP_EXPECTED_BYTES);
      live.progress = Math.max(live.progress, lo + (hi - lo) * frac);
      this.publish();
    }, 4000);
    timer.unref();
    return {
      band: (f, t) => {
        lo = f;
        hi = t;
      },
      stop: () => clearInterval(timer),
    };
  }

  /** stream a snapshot to subscribers, throttled with a trailing edge so the
   * last progress of a burst always lands */
  private publish(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastPublish < PUBLISH_MS) {
      this.publishTimer ??= setTimeout(() => {
        this.publishTimer = undefined;
        this.publish(true);
      }, PUBLISH_MS);
      this.publishTimer.unref();
      return;
    }
    this.lastPublish = now;
    this.emit("update", this.status());
  }

  private rootEnsured(): string {
    const r = this.root();
    fs.mkdirSync(r, { recursive: true });
    return r;
  }

  private recordFile(): string {
    return path.join(this.root(), "runtime.json");
  }

  private record(): RuntimeRecord {
    try {
      return JSON.parse(fs.readFileSync(this.recordFile(), "utf8")) as RuntimeRecord;
    } catch {
      return {};
    }
  }

  private saveRecord(patch: Partial<RuntimeRecord>): void {
    const next = { ...this.record(), ...patch, installedAt: new Date().toISOString() };
    fs.mkdirSync(this.root(), { recursive: true });
    const tmp = `${this.recordFile()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, this.recordFile());
  }
}

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) total += dirSize(p);
      else if (e.isFile()) {
        try {
          total += fs.statSync(p).size;
        } catch {
          /* mid-write */
        }
      }
    }
  } catch {
    /* not created yet */
  }
  return total;
}
