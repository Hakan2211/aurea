/* Sound FX lab — text → one-shot sound effects and ambience beds.
 *
 * Two engines, the same split as everywhere else in Aurea: a paid cloud model
 * that is quick and very good at clean, literal one-shots, and a free local
 * one that runs on the GPU.
 *
 *   elevenlabs — ElevenLabs Sound Effects v3 on fal.ai. $0.002 per generated
 *                second, billed by fal; the estimate is reported before the
 *                request goes out, same contract as Seedance and GPT Image 2.
 *                Asked for raw 48 kHz PCM and wrapped as WAV here, so a take is
 *                lossless and drops straight onto the timeline's SFX lane.
 *   moss       — MOSS-SoundEffect v2.0 (OpenMOSS, Apache-2.0): a 1.3B flow-
 *                matching DiT + Qwen3 text encoder + 48 kHz DAC VAE, run from
 *                its own venv (operator-owned, like Music3 and Hunyuan3D).
 *                Measured on the 3090 Ti: ~47 s to load, ~22 s per clip at
 *                100 steps. Strong on heavy, low material (footfalls, impacts,
 *                braams); ElevenLabs is better at bright detail and animals.
 *
 * Both write `out/sfx.wav` in the job's run dir; importOutput files it on the
 * project's `assets/sfx/` shelf. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ELEVENLABS_SFX_ENDPOINT,
  falSfxEstimate,
  SFX_DURATION_MAX,
  type Job,
} from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import type { ComfyService } from "../comfy/service.js";
import { ComfyClient } from "../comfy/client.js";
import { jobRunDir, LastError, runProcess } from "./proc.js";
import type { JobResources } from "../scheduler.js";
import type { AdapterProgress, AdapterRun, EngineAdapter } from "./types.js";

const POLL_MS = 1_500;
/** MOSS has no "natural length" mode — a missing duration renders this long */
export const MOSS_DEFAULT_SECONDS = 5;
export const MOSS_DEFAULTS = { steps: 100, cfg: 4 } as const;
export const MOSS_SFX_ENGINE_ID = "moss-sfx";

interface QueueSubmit {
  request_id: string;
  status_url?: string;
  response_url?: string;
  cancel_url?: string;
}

/** 16-bit PCM → a minimal RIFF/WAVE file */
export function pcmToWav(pcm: Buffer, sampleRate = 48_000, channels = 1): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * channels * 2, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/* ------------------------------ ElevenLabs ------------------------------ */

export class FalSfxAdapter implements EngineAdapter {
  id = "fal-elevenlabs-sfx";

  constructor(
    private settings: SettingsStore,
    /** override in tests to point at a mock queue */
    private baseUrl = "https://queue.fal.run",
  ) {}

  canRun(job: Job): boolean {
    return job.payload?.type === "sfx" && job.payload.engine === "elevenlabs";
  }

  resources(): JobResources {
    return { klass: "cpu" }; // remote render — no local GPU involved
  }

  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun {
    let canceled = false;
    let cancelUrl: string | null = null;
    const key = this.settings.get().providers.falApiKey;
    const headers = { authorization: `Key ${key}`, "content-type": "application/json" };

    const done = (async () => {
      const p = job.payload;
      if (p?.type !== "sfx") throw new Error("not a sound-effect job");
      if (!key) throw new Error("ElevenLabs sound effects need a fal.ai API key — Settings → AI Providers");
      const estimate = falSfxEstimate(p.durationSec);

      report({ progress: 5, stage: "Submitting to fal.ai", detail: `ElevenLabs · ${estimate}` });
      const submit = await fetch(`${this.baseUrl}/${ELEVENLABS_SFX_ENDPOINT}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          text: p.prompt,
          ...(p.durationSec !== undefined ? { duration_seconds: p.durationSec } : {}),
          prompt_influence: p.promptInfluence,
          loop: p.loop,
          output_format: "pcm_48000",
        }),
      });
      if (!submit.ok) {
        const detail = await submit.text().catch(() => "");
        throw new Error(`fal.ai rejected the job (HTTP ${submit.status}) ${detail.slice(0, 200)}`);
      }
      const queued = (await submit.json()) as QueueSubmit;
      const base = `${this.baseUrl}/${ELEVENLABS_SFX_ENDPOINT}/requests/${queued.request_id}`;
      const statusUrl = queued.status_url ?? `${base}/status`;
      const responseUrl = queued.response_url ?? base;
      cancelUrl = queued.cancel_url ?? `${base}/cancel`;

      const started = Date.now();
      for (;;) {
        if (canceled) throw new Error("Canceled by user");
        await new Promise((r) => setTimeout(r, POLL_MS));
        const res = await fetch(statusUrl, { headers }).catch(() => null);
        if (!res) continue; // transient network blip — keep polling
        if (!res.ok) throw new Error(`fal.ai status check failed (HTTP ${res.status})`);
        const status = (await res.json()) as { status?: string };
        if (status.status === "COMPLETED") break;
        if (status.status === "FAILED" || status.status === "CANCELLED") {
          throw new Error(`fal.ai reports the sound ${status.status?.toLowerCase()}`);
        }
        // no step progress from the queue — a sound effect takes ~5 s
        const pct = 10 + Math.min(80, ((Date.now() - started) / 6_000) * 80);
        report({ progress: pct, stage: status.status === "IN_QUEUE" ? "Queued at fal.ai" : "Generating in the cloud" });
      }

      report({ progress: 92, stage: "Fetching audio" });
      const result = (await (await fetch(responseUrl, { headers })).json()) as { audio?: { url?: string } };
      const url = result.audio?.url;
      if (!url) throw new Error("fal.ai finished without any audio");
      const dl = await fetch(url);
      if (!dl.ok) throw new Error(`audio download failed (HTTP ${dl.status})`);
      const raw = Buffer.from(new Uint8Array(await dl.arrayBuffer()));
      const outDir = path.join(jobRunDir(job.id), "out");
      fs.mkdirSync(outDir, { recursive: true });
      const out = path.join(outDir, "sfx.wav");
      // pcm_* comes back headerless; anything already RIFF is kept as is
      fs.writeFileSync(out, raw.subarray(0, 4).toString("latin1") === "RIFF" ? raw : pcmToWav(raw));
      return { output: out, meta: { engine: "elevenlabs-sfx-v3" } };
    })();

    return {
      done,
      cancel: () => {
        canceled = true;
        if (cancelUrl) void fetch(cancelUrl, { method: "PUT", headers }).catch(() => {});
      },
    };
  }
}

/* --------------------------------- MOSS --------------------------------- */

/** settings first, then the conventions this machine was set up with */
export function mossSfxPaths(settings: SettingsStore): { python: string | null; modelDir: string | null } {
  const { engines } = settings.get();
  const firstExisting = (cands: string[]) => cands.find((c) => fs.existsSync(c)) ?? null;
  const python =
    engines.mossSfxPython ??
    firstExisting([
      path.join(os.homedir(), "videoproduction", "moss-sfx", ".venv", "Scripts", "python.exe"),
      "D:/moss-sfx/.venv/Scripts/python.exe",
    ]);
  const modelDir =
    engines.mossSfxModelDir ??
    firstExisting(
      ["D:/AIModels/Aurea-models/moss-soundeffect-v2", "D:/models/MOSS-SoundEffect-v2.0"].filter((d) =>
        fs.existsSync(path.join(d, "model_index.json")),
      ),
    );
  return { python, modelDir };
}

/* The runner. MOSS's own infer script saves through torchaudio, which on
 * Windows needs a shared FFmpeg build that torchcodec can load — absent in a
 * plain venv, so the render succeeded and the save threw. soundfile has no
 * such dependency. Params arrive as env vars (no quoting games with prompts). */
export const MOSS_SFX_SCRIPT = String.raw`
import os, sys, time
os.environ.setdefault("TORCHDYNAMO_DISABLE", "1")
import torch
import soundfile as sf
from moss_soundeffect_v2 import MossSoundEffectPipeline

e = os.environ
t0 = time.time()
print("[aurea-sfx] loading", flush=True)
pipe = MossSoundEffectPipeline.from_pretrained(e["AUREA_MODEL_DIR"], torch_dtype=torch.bfloat16, device="cuda")
print(f"[aurea-sfx] loaded {time.time() - t0:.0f}s", flush=True)
seed = int(e["AUREA_SEED"]) if e.get("AUREA_SEED") else int(time.time()) % 2**31
audio = pipe(prompt=e["AUREA_PROMPT"], seconds=float(e["AUREA_SECONDS"]),
             num_inference_steps=int(e["AUREA_STEPS"]), cfg_scale=float(e["AUREA_CFG"]),
             sigma_shift=5.0, seed=seed)
sf.write(e["AUREA_OUT"], audio[0].detach().float().cpu().numpy().T, pipe.sample_rate, subtype="PCM_24")
print(f"[aurea-sfx] saved seed={seed}", flush=True)
`;

/** the pipeline's step bar, e.g. " 42%|████▏     | 42/100" */
const TQDM = /(\d{1,3})%\|/;

export class MossSfxAdapter implements EngineAdapter {
  id = "moss-sfx-v2";

  constructor(
    private settings: SettingsStore,
    private comfy: ComfyService,
  ) {}

  canRun(job: Job): boolean {
    return job.payload?.type === "sfx" && job.payload.engine === "moss";
  }

  resources(): JobResources {
    // DiT + Qwen3-1.7B encoder + VAE in bf16; ~9 GB at peak
    return { klass: "gpu", vramGb: 10, engineId: MOSS_SFX_ENGINE_ID };
  }

  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun {
    let proc: ReturnType<typeof runProcess> | undefined;
    let canceled = false;

    const done = (async () => {
      const p = job.payload;
      if (p?.type !== "sfx") throw new Error("not a sound-effect job");
      const { python, modelDir } = mossSfxPaths(this.settings);
      if (!python) throw new Error("MOSS-SoundEffect venv not found — set engines.mossSfxPython in Settings");
      if (!modelDir) throw new Error("MOSS-SoundEffect weights not found — set engines.mossSfxModelDir in Settings");

      const runDir = jobRunDir(job.id);
      const out = path.join(runDir, "out", "sfx.wav");
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const script = path.join(runDir, "moss_sfx.py");
      fs.writeFileSync(script, MOSS_SFX_SCRIPT);

      report({ progress: 2, stage: "Clearing VRAM" });
      try {
        const url = await this.comfy.idleUrlResolved();
        if (url) await new ComfyClient(url).freeMemory();
      } catch {
        // nothing listening is fine
      }

      const seconds = Math.min(SFX_DURATION_MAX, Math.max(1, p.durationSec ?? MOSS_DEFAULT_SECONDS));
      const steps = p.steps ?? MOSS_DEFAULTS.steps;
      const err = new LastError();
      report({ progress: 5, stage: "Loading MOSS-SoundEffect", detail: `${seconds}s · ${steps} steps · local` });
      let loaded = false;
      proc = runProcess({
        exe: python,
        args: [script],
        cwd: runDir,
        logFile: path.join(runDir, "run.log"),
        splitCarriageReturns: true,
        env: {
          TORCHDYNAMO_DISABLE: "1",
          AUREA_MODEL_DIR: modelDir,
          AUREA_PROMPT: p.prompt,
          AUREA_SECONDS: String(seconds),
          AUREA_STEPS: String(steps),
          AUREA_CFG: String(p.cfg ?? MOSS_DEFAULTS.cfg),
          AUREA_SEED: p.seed !== undefined ? String(p.seed) : "",
          AUREA_OUT: out,
        },
        onLine: (line) => {
          err.note(line);
          if (line.includes("[aurea-sfx] loaded")) {
            loaded = true;
            report({ progress: 40, stage: "Generating" });
            return;
          }
          if (line.includes("[aurea-sfx] saved")) {
            report({ progress: 97, stage: "Saved" });
            return;
          }
          const bar = loaded ? TQDM.exec(line) : null;
          if (bar) report({ progress: 40 + 55 * (Math.min(Number(bar[1]), 100) / 100) });
        },
      });

      const code = await proc.exited;
      if (canceled) throw new Error("Canceled by user");
      if (code !== 0 || !fs.existsSync(out)) throw new Error(err.message(`MOSS-SoundEffect exited with code ${code}`));
      return { output: out, meta: { engine: "moss-soundeffect-v2" } };
    })();

    return {
      done,
      cancel: () => {
        canceled = true;
        proc?.kill();
      },
    };
  }
}
