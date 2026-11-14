/* Studiod's half of the MiniMax-Music3 warm worker: owns the long-lived
 * python process, speaks the one-JSON-object-per-line protocol from
 * minimax-music-worker-script.ts, and presents itself to the GpuScheduler as
 * a WarmEngine so an idle worker gets unloaded when something else wants the
 * card.
 *
 * Why a resident process at all: measured on the 3090 Ti a cold run pays 40s
 * to load the components and a further 59.5s for the first CPU→GPU placement
 * (the safetensors are mmap'd, so that first `.to("cuda")` is really a disk
 * read — raw H2D on this box is 5.4 GB/s, which would be ~3s). A warm process
 * pays 4.9s instead, taking a 15s song from 108s to 46s. Every song after the
 * first in a session is roughly twice as fast.
 *
 * The worker pushes all components back to CPU after each song, so an idle
 * one holds about a gigabyte of VRAM (the CUDA context) rather than the 17.6
 * GiB a render peaks at. What it does keep is ~22 GB of host RAM of warm
 * weights — that is the whole point, and the idle timeout is what eventually
 * gives it back on a 32 GB box. */

import fs from "node:fs";
import path from "node:path";
import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { AUREA_DIR } from "../portfile.js";
import { MINIMAX_MUSIC3_WORKER_SCRIPT } from "./minimax-music-worker-script.js";

/** how long a worker may sit warm with nothing to do before it gives its
 * ~22 GB of host RAM back; a session of iterating on one song stays well
 * inside it, an afternoon of doing something else does not */
export const WORKER_IDLE_MS = 10 * 60 * 1000;

export interface Music3Request {
  id: string;
  prompt: string;
  lyrics: string;
  duration: number;
  steps: number;
  seed?: number;
  out: string;
}

export interface Music3Progress {
  stage: "ar" | "denoise";
  /** 0–1 across both stages, weighted by measured seconds per unit */
  fraction: number;
  frames: number;
  framesTotal: number;
  steps: number;
  stepsTotal: number;
  elapsed: number;
  /** seconds remaining, drift-corrected against the elapsed time so far */
  eta: number;
  /** running far below this card's known rate — almost always because the
   * pipeline did not fit and the driver is paging GPU memory to host RAM */
  degraded: boolean;
}

interface WorkerEvent {
  ev: "loading" | "ready" | "progress" | "done" | "error" | "idle" | "fatal" | "vram";
  id?: string;
  message?: string;
  canceled?: boolean;
  seconds?: number;
  audio_seconds?: number;
  stage?: "ar" | "denoise";
  fraction?: number;
  frames?: number;
  frames_total?: number;
  steps?: number;
  steps_total?: number;
  elapsed?: number;
  eta?: number;
  degraded?: boolean;
  free_gib?: number;
  total_gib?: number;
}

type Pending = {
  id: string;
  onProgress: (p: Music3Progress) => void;
  resolve: (r: { seconds: number; audioSeconds: number }) => void;
  reject: (e: Error) => void;
};

/* `D:\music3env\Scripts\python.exe` is a redirector stub, not a real
 * interpreter: it spawns the base `Python312\python.exe` and that child is
 * what loads the 11B pipeline and holds the VRAM. Killing the stub alone
 * therefore ORPHANS a process sitting on ~17 GB of the card, and the next
 * render then pages to host memory and crawls. `taskkill /T` handles the
 * live case; this sweep handles the one no parent survives — studiod
 * crashed, or the machine was left with a stray worker from a previous run.
 * Matched on the generated script's name, so it can only ever hit ours — and
 * it runs only on the path that is about to spawn, so a live worker of this
 * studiod's own is never in scope. A second studiod's worker IS, which is the
 * intent: two of these on one box is 44 GB of host RAM and neither can fit. */
function killStaleWorkers(): void {
  if (process.platform !== "win32") return;
  try {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Get-CimInstance Win32_Process -Filter "Name='python.exe'" | ` +
          `Where-Object { $_.CommandLine -like '*music3_worker.py*' } | ` +
          `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
      ],
      { windowsHide: true, timeout: 15_000, stdio: "ignore" },
    );
  } catch {
    // best effort — a sweep that fails is not a reason to refuse the render
  }
}

export class Music3Worker {
  private child: ChildProcess | undefined;
  /** resolves when the pipeline has loaded; rejects if the process can't start */
  private ready: Promise<void> | undefined;
  private pending: Pending | undefined;
  private idleTimer: NodeJS.Timeout | undefined;
  private buffer = "";
  private lastStderr = "";
  private exitReason: string | undefined;

  constructor(
    private paths: () => { python: string | null; modelDir: string | null },
    private idleMs: number = WORKER_IDLE_MS,
  ) {}

  // ---------------------------------------------------------- WarmEngine

  /** Holding VRAM right now — which for this engine means "mid-song", because
   * the worker pushes every component back to CPU as soon as one finishes.
   *
   * This is deliberately NOT "the process is alive". GpuScheduler.preflight
   * skips the VRAM check when a job's own engine is warm, on the reasoning
   * that resident weights ARE the memory the job needs. That holds for the
   * ComfyUI sidecar and is false here: a warm worker holds ~0 VRAM and still
   * needs its 20 GB. Reporting `true` let a second song start against a card
   * another engine had already filled, and the render silently paged to host
   * memory and ran ~10x slower — the same failure the H3 adapter documents.
   * Since the gpu lane is exclusive, this reads false at every admission,
   * which is exactly the intent: music3 always gets a real preflight. */
  warm(): boolean {
    return this.pending !== undefined;
  }

  /** safe to unload: alive and not in the middle of a song. Worth evicting
   * even though an idle worker holds little VRAM — it is sitting on ~22 GB of
   * host RAM, and the CUDA context it keeps is the last gigabyte a big
   * ComfyUI graph needs. */
  canEvict(): boolean {
    return this.child !== undefined && this.pending === undefined;
  }

  evict(): void {
    this.stop("evicted for VRAM");
  }

  // ---------------------------------------------------------------- run

  async run(
    req: Music3Request,
    onProgress: (p: Music3Progress) => void,
  ): Promise<{ seconds: number; audioSeconds: number }> {
    if (this.pending) throw new Error("MiniMax-Music3 worker is already rendering");
    this.clearIdle();
    await this.ensure();
    const child = this.child;
    if (!child) throw new Error(this.exitReason ?? "MiniMax-Music3 worker is not running");

    return await new Promise<{ seconds: number; audioSeconds: number }>((resolve, reject) => {
      this.pending = { id: req.id, onProgress, resolve, reject };
      try {
        child.stdin?.write(
          JSON.stringify({
            cmd: "gen",
            id: req.id,
            prompt: req.prompt,
            lyrics: req.lyrics,
            duration: req.duration,
            steps: req.steps,
            ...(req.seed !== undefined ? { seed: req.seed } : {}),
            out: req.out,
          }) + "\n",
        );
      } catch (err) {
        // a broken pipe here would otherwise leave the job pending forever —
        // nothing is ever coming back to settle it
        this.pending = undefined;
        reject(new Error(`MiniMax-Music3 worker is not accepting work: ${String(err)}`));
      }
    });
  }

  /** cooperative cancel: the flag is read from inside both stage loops, so
   * the worker unwinds and stays alive for the next song */
  cancel(id: string): void {
    if (this.pending?.id !== id) return;
    this.child?.stdin?.write(JSON.stringify({ cmd: "cancel", id }) + "\n");
  }

  stop(reason = "stopped"): void {
    this.clearIdle();
    const child = this.child;
    this.child = undefined;
    this.ready = undefined;
    this.exitReason = reason;
    if (!child?.pid) return;
    try {
      child.stdin?.write(JSON.stringify({ cmd: "shutdown" }) + "\n");
      child.stdin?.end();
    } catch {
      // the pipe is already gone — the kill below is what matters
    }
    // a python process that is mid-CUDA-call ignores a polite shutdown, and
    // on Windows it does not die with its parent either
    const pid = child.pid;
    setTimeout(() => {
      try {
        if (process.platform === "win32") {
          execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
        } else {
          child.kill("SIGKILL");
        }
      } catch {
        // already exited
      }
    }, 1500).unref?.();
  }

  // ------------------------------------------------------------ internals

  private async ensure(): Promise<void> {
    if (this.ready) return await this.ready;
    const { python, modelDir } = this.paths();
    if (!python) {
      throw new Error("MiniMax-Music3 venv not found — set engines.music3Python in Settings");
    }
    if (!modelDir) {
      throw new Error("MiniMax-Music3 weights not found — set engines.music3ModelDir in Settings");
    }

    const dir = path.join(AUREA_DIR, "engines", "music3");
    fs.mkdirSync(dir, { recursive: true });
    const script = path.join(dir, "music3_worker.py");
    fs.writeFileSync(script, MINIMAX_MUSIC3_WORKER_SCRIPT);
    killStaleWorkers();
    const log = fs.createWriteStream(path.join(dir, "worker.log"), { flags: "a" });

    this.ready = new Promise<void>((resolve, reject) => {
      const child = spawn(python, ["-u", script], {
        cwd: dir,
        env: { ...process.env, PYTHONIOENCODING: "utf-8", AUREA_MUSIC3_MODEL: modelDir },
        shell: false,
        windowsHide: true,
      });
      this.child = child;
      this.exitReason = undefined;
      // stream state belongs to THIS process: a half-line left by a worker
      // that died mid-write would otherwise corrupt the new one's first
      // event, and a stale crash tail would be blamed on the wrong run
      this.buffer = "";
      this.lastStderr = "";

      child.on("error", (err) => {
        this.child = undefined;
        this.ready = undefined;
        reject(new Error(`MiniMax-Music3 worker failed to start: ${err.message}`));
      });
      child.stdout?.on("data", (chunk: Buffer) => {
        log.write(chunk);
        this.onStdout(chunk.toString(), resolve, reject);
      });
      // stderr carries tqdm bars and HF warnings; keep only the tail so a
      // crash still has something to say
      child.stderr?.on("data", (chunk: Buffer) => {
        log.write(chunk);
        this.lastStderr = (this.lastStderr + chunk.toString()).slice(-4000);
      });
      child.on("close", (code) => {
        log.end();
        this.child = undefined;
        this.ready = undefined;
        this.clearIdle();
        const detail = this.lastStderr.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" | ");
        const message =
          this.exitReason ?? `MiniMax-Music3 worker exited (code ${code})${detail ? `: ${detail}` : ""}`;
        this.failPending(message);
        // a no-op once the pipeline has loaded and this promise resolved; the
        // case it covers is a worker that dies during the load itself
        reject(new Error(message));
      });
    });

    try {
      return await this.ready;
    } catch (err) {
      this.ready = undefined;
      throw err;
    }
  }

  private onStdout(text: string, resolve: () => void, reject: (e: Error) => void): void {
    this.buffer += text;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("@@AUREA ")) continue;
      let event: WorkerEvent;
      try {
        event = JSON.parse(line.slice(8)) as WorkerEvent;
      } catch {
        continue;
      }
      this.handle(event, resolve, reject);
    }
  }

  private handle(event: WorkerEvent, resolve: () => void, reject: (e: Error) => void): void {
    switch (event.ev) {
      case "ready":
        resolve();
        return;
      case "fatal":
        this.exitReason = event.message ?? "MiniMax-Music3 worker failed";
        reject(new Error(this.exitReason));
        return;
      case "progress": {
        const pending = this.pending;
        if (!pending || pending.id !== event.id) return;
        pending.onProgress({
          stage: event.stage ?? "ar",
          fraction: event.fraction ?? 0,
          frames: event.frames ?? 0,
          framesTotal: event.frames_total ?? 0,
          steps: event.steps ?? 0,
          stepsTotal: event.steps_total ?? 0,
          elapsed: event.elapsed ?? 0,
          eta: event.eta ?? 0,
          degraded: event.degraded ?? false,
        });
        return;
      }
      case "done": {
        const pending = this.pending;
        if (!pending || pending.id !== event.id) return;
        this.pending = undefined;
        pending.resolve({ seconds: event.seconds ?? 0, audioSeconds: event.audio_seconds ?? 0 });
        return;
      }
      case "error": {
        const pending = this.pending;
        if (!pending || pending.id !== event.id) return;
        this.pending = undefined;
        pending.reject(new Error(event.message ?? "MiniMax-Music3 generation failed"));
        return;
      }
      case "idle":
        this.armIdle();
        return;
      default:
        return;
    }
  }

  private failPending(message: string): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    pending.reject(new Error(message));
  }

  private armIdle(): void {
    this.clearIdle();
    if (this.idleMs <= 0) return;
    this.idleTimer = setTimeout(() => this.stop("idle timeout"), this.idleMs);
    this.idleTimer.unref?.();
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }
}
