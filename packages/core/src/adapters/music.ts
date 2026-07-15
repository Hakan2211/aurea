/* Music adapter — description → wav through ACE-Step 1.5, via videofast's
 * audio/gen_music_cli.py run inside ACE-Step's own venv. Style chips fold
 * into the caption; "vocals" uses ACE-Step's native singing (the cloned-voice
 * conversion pass is a later rung). Model init dominates wall-clock. */

import fs from "node:fs";
import path from "node:path";
import type { Job } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import { jobRunDir, LastError, runProcess } from "./proc.js";
import type { AdapterProgress, AdapterRun, EngineAdapter } from "./types.js";

export class MusicAdapter implements EngineAdapter {
  id = "acestep";

  constructor(private settings: SettingsStore) {}

  canRun(job: Job): boolean {
    return job.payload?.type === "music";
  }

  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun {
    let proc: ReturnType<typeof runProcess> | undefined;
    let canceled = false;

    const done = (async () => {
      const payload = job.payload;
      if (payload?.type !== "music") throw new Error("not a music job");
      const { paths, engines } = this.settings.get();
      if (!paths.videofastDir) throw new Error("videofast path not set — Settings → Storage");
      if (!engines.acestepDir) {
        throw new Error("ACE-Step not found — set its checkout in Settings → Engines");
      }

      const runDir = jobRunDir(job.id);
      const out = path.join(runDir, "out", "track.wav");
      const caption = [payload.description, ...payload.styles.map((s) => s.toLowerCase())]
        .filter(Boolean)
        .join(", ");

      const err = new LastError();
      report({ progress: 2, stage: "Starting ACE-Step" });

      const args = [
        path.join(paths.videofastDir, "audio", "gen_music_cli.py"),
        "--caption", caption,
        "--duration", String(payload.durationSec),
        "--out", out,
        "--acestep-root", engines.acestepDir,
      ];
      if (payload.arrangement === "vocals") args.push("--vocals");

      proc = runProcess({
        exe: path.join(engines.acestepDir, ".venv", "Scripts", "python.exe"),
        args,
        cwd: engines.acestepDir,
        logFile: path.join(runDir, "run.log"),
        onLine: (line) => {
          err.note(line);
          if (line.includes("initializing DiT")) report({ progress: 8, stage: "Loading DiT" });
          if (line.includes("initializing 5Hz LM")) report({ progress: 30, stage: "Loading language model" });
          if (line.includes("generating...")) report({ progress: 55, stage: "Composing arrangement and mixing" });
          if (line.includes("OK ->")) report({ progress: 98 });
        },
      });

      const code = await proc.exited;
      if (canceled) throw new Error("Canceled by user");
      if (code !== 0 || !fs.existsSync(out)) {
        throw new Error(err.message(`music generation exited with code ${code}`));
      }
      return { output: out };
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
