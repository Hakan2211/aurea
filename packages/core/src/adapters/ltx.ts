/* LTX video adapter — start frame (+ optional dialogue audio) → mp4 on the
 * local ComfyUI. The videofast runners are fire-and-forget: they stage inputs,
 * patch the LTX template, queue it, print the prompt_id and exit. This adapter
 * spawns the right runner, then owns the wait: polls /history/<prompt_id>,
 * downloads the finished video via /view into the job's scratch dir.
 *
 *   audio present → run_ltx_ia2v.py (native LTX 2.3 lip-sync, audio drives)
 *   image only    → run_ltx_i2v.py  (LTX Director motion; its template owns
 *                    duration/resolution, so those knobs apply to ia2v only) */

import fs from "node:fs";
import path from "node:path";
import type { Job } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import { jobRunDir, LastError, runProcess } from "./proc.js";
import type { AdapterProgress, AdapterRun, EngineAdapter } from "./types.js";

const POLL_MS = 2_000;
const VIDEO_EXT = /\.(mp4|webm|mov)$/i;

interface ComfyFile {
  filename: string;
  subfolder?: string;
  type?: string;
}

/** every {filename,...} entry across all output nodes, whatever key ComfyUI used */
function outputFiles(entry: unknown): ComfyFile[] {
  const files: ComfyFile[] = [];
  const outputs = (entry as { outputs?: Record<string, Record<string, unknown>> }).outputs ?? {};
  for (const node of Object.values(outputs)) {
    for (const value of Object.values(node)) {
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        if (item && typeof item === "object" && "filename" in item) files.push(item as ComfyFile);
      }
    }
  }
  return files;
}

export class LtxVideoAdapter implements EngineAdapter {
  id = "ltx";

  constructor(private settings: SettingsStore) {}

  canRun(job: Job): boolean {
    return job.payload?.type === "video" && job.payload.engine === "ltx2";
  }

  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun {
    let proc: ReturnType<typeof runProcess> | undefined;
    let canceled = false;
    let promptId: string | undefined;
    const comfy = this.settings.get().engines.comfyUrl.replace(/\/$/, "");

    const done = (async () => {
      const payload = job.payload;
      if (payload?.type !== "video") throw new Error("not a video job");
      const { paths, storage } = this.settings.get();
      if (!paths.videofastDir) throw new Error("videofast path not set — Settings → Storage");
      if (!payload.startFrame) {
        throw new Error("LTX needs a start frame — generate or pick an image first");
      }
      const image = path.join(storage.dataRoot, payload.startFrame);
      if (!fs.existsSync(image)) throw new Error(`start frame not found: ${payload.startFrame}`);
      const audio = payload.audio ? path.join(storage.dataRoot, payload.audio) : undefined;
      if (payload.audio && !fs.existsSync(audio!)) {
        throw new Error(`audio not found: ${payload.audio}`);
      }

      const runDir = jobRunDir(job.id);
      const seed = payload.seed ?? Math.floor(Math.random() * 1_000_000_000);
      const size = payload.resolution.match(/(\d+)\s*[×x]\s*(\d+)/);
      const [w, h] = size ? [size[1], size[2]] : ["704", "896"];

      const wf = path.join(paths.videofastDir, "workflows");
      const err = new LastError();
      report({ progress: 2, stage: "Staging inputs" });

      proc = runProcess({
        exe: "python",
        args: audio
          ? [path.join(wf, "run_ltx_ia2v.py"), image, audio, String(payload.durationSec), w, h, String(seed)]
          : [path.join(wf, "run_ltx_i2v.py"), image, payload.prompt, String(seed)],
        cwd: wf,
        env: audio ? { IA2V_PROMPT: payload.prompt } : {},
        logFile: path.join(runDir, "run.log"),
        onLine: (line) => {
          err.note(line);
          const queued = line.match(/QUEUED prompt_id: (\S+)/);
          if (queued && queued[1] !== "None") promptId = queued[1];
          if (line.includes("NODE ERRORS")) err.note(line);
        },
      });

      const code = await proc.exited;
      if (canceled) throw new Error("Canceled by user");
      if (code !== 0 || !promptId) {
        throw new Error(err.message(`LTX queue script exited with code ${code}`));
      }

      // the runner is done; the render happens inside ComfyUI now
      const started = Date.now();
      // rough wall-clock guess for the progress creep (render dominates)
      const expectedMs = (60 + payload.durationSec * 45) * 1_000;
      report({ progress: 8, stage: "Rendering on ComfyUI", detail: `prompt ${promptId.slice(0, 8)}` });

      for (;;) {
        if (canceled) throw new Error("Canceled by user");
        await new Promise((r) => setTimeout(r, POLL_MS));
        const hist = (await fetch(`${comfy}/history/${promptId}`).then(
          (r) => r.json() as Promise<Record<string, unknown>>,
        ).catch(() => ({}))) as Record<string, unknown>;
        const entry = hist[promptId];
        if (!entry) {
          const pct = 8 + Math.min(87, ((Date.now() - started) / expectedMs) * 87);
          report({ progress: pct });
          continue;
        }
        const status = (entry as { status?: { status_str?: string; completed?: boolean } }).status;
        if (status?.status_str === "error") {
          throw new Error("ComfyUI execution error — see the ComfyUI console");
        }
        const video = outputFiles(entry).find((f) => VIDEO_EXT.test(f.filename));
        if (!video) {
          if (status?.completed) throw new Error("LTX run finished without a video output");
          continue;
        }
        report({ progress: 96, stage: "Fetching video" });
        const q = new URLSearchParams({
          filename: video.filename,
          subfolder: video.subfolder ?? "",
          type: video.type ?? "output",
        });
        const bytes = await fetch(`${comfy}/view?${q}`).then((r) => {
          if (!r.ok) throw new Error(`ComfyUI /view ${r.status}`);
          return r.arrayBuffer();
        });
        const out = path.join(runDir, "out", `take${path.extname(video.filename)}`);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, Buffer.from(bytes));
        return { output: out };
      }
    })();

    return {
      done,
      cancel: () => {
        canceled = true;
        proc?.kill();
        // best-effort: drop it from ComfyUI's queue / interrupt a running render
        if (promptId) {
          void fetch(`${comfy}/queue`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ delete: [promptId] }),
          }).catch(() => {});
          void fetch(`${comfy}/interrupt`, { method: "POST" }).catch(() => {});
        }
      },
    };
  }
}
