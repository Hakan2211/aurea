/* Seed-VC adapter — re-voice existing audio into a cloned voice (zero-shot
 * voice conversion; "sing" mode adds F0 conditioning for singing voice
 * conversion). Managed-only: the runtime's pinned checkout runs its own
 * inference.py CLI in the seedvc venv — no embedded script needed. Model
 * weights auto-download from Hugging Face on the first conversion (the
 * script pins HF_HUB_CACHE to <repo>/checkpoints/hf_cache itself), so the
 * first run needs network and takes noticeably longer. */

import fs from "node:fs";
import path from "node:path";
import type { Job } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import type { EngineRuntime } from "../runtime/runtime.js";
import { jobRunDir, LastError, runProcess } from "./proc.js";
import { voiceRefCandidates } from "./tts.js";
import type { JobResources } from "../scheduler.js";
import type { AdapterProgress, AdapterRun, EngineAdapter } from "./types.js";

export class SeedVcAdapter implements EngineAdapter {
  id = "seedvc";

  constructor(
    private settings: SettingsStore,
    private runtime: EngineRuntime,
  ) {}

  canRun(job: Job): boolean {
    // engine "rvc" belongs to the Replicate adapter
    return job.payload?.type === "voiceConvert" && job.payload.engine !== "rvc";
  }

  resources(): JobResources {
    // whisper-based content encoder + DiT + vocoder — comfortably under 8 GB
    return { klass: "gpu", engineId: "seedvc", vramGb: 8 };
  }

  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun {
    let proc: ReturnType<typeof runProcess> | undefined;
    let canceled = false;

    const done = (async () => {
      const payload = job.payload;
      if (payload?.type !== "voiceConvert") throw new Error("not a voice-convert job");
      const { storage, paths } = this.settings.get();

      if (!this.runtime.componentReady("seedvc")) {
        throw new Error("Seed-VC engine not installed — Settings → Engines → Install");
      }

      const source = path.join(storage.dataRoot, payload.source);
      if (!fs.existsSync(source)) {
        throw new Error(`source audio not found: ${payload.source}`);
      }
      const ref = voiceRefCandidates(payload.voice, storage.dataRoot, paths.videofastDir).find(
        (c) => fs.existsSync(c),
      );
      if (!ref) throw new Error(`no reference clip for voice "${payload.voice}"`);

      const runDir = jobRunDir(job.id);
      const outDir = path.join(runDir, "out");
      fs.mkdirSync(outDir, { recursive: true });

      const sing = payload.mode === "sing";
      // singing needs the F0-conditioned model and more diffusion steps
      const steps = sing ? Math.max(30, payload.diffusionSteps) : payload.diffusionSteps;
      const repo = this.runtime.engineRepoDir("seedvc");
      const args = [
        path.join(repo, "inference.py"),
        "--source", source,
        "--target", ref,
        "--output", outDir,
        "--diffusion-steps", String(steps),
        "--length-adjust", String(payload.lengthAdjust),
        "--inference-cfg-rate", String(payload.cfgRate),
        "--fp16", "True",
      ];
      if (sing) {
        args.push("--f0-condition", "True", "--semi-tone-shift", String(payload.semitoneShift));
      }

      const err = new LastError();
      report({ progress: 2, stage: "Loading Seed-VC models" });

      proc = runProcess({
        exe: this.runtime.venvEnginePython("seedvc"),
        args,
        // relative HF cache + campplus/config lookups resolve against the repo
        cwd: repo,
        env: {},
        logFile: path.join(runDir, "run.log"),
        onLine: (line) => {
          err.note(line);
          if (/Downloading|Fetching/.test(line)) {
            report({ progress: 6, stage: "Downloading models (first run)" });
          }
          if (/Loaded|checkpoint/i.test(line)) report({ progress: 30, stage: "Converting voice" });
        },
      });

      const code = await proc.exited;
      if (canceled) throw new Error("Canceled by user");
      const produced = fs.existsSync(outDir)
        ? fs.readdirSync(outDir).find((f) => f.startsWith("vc_") && f.endsWith(".wav"))
        : undefined;
      if (code !== 0 || !produced) {
        throw new Error(err.message(`voice conversion exited with code ${code}`));
      }
      // stable name — importOutput slugs the job title over it anyway
      const wav = path.join(outDir, "converted.wav");
      fs.renameSync(path.join(outDir, produced), wav);
      report({ progress: 96 });
      return { output: wav };
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
