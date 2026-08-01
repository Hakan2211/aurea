/* Music adapter — description → wav through ACE-Step 1.5. Style chips fold
 * into the caption; "vocals" uses ACE-Step's native singing (the cloned-voice
 * conversion pass is a later rung). Model init dominates wall-clock.
 *
 * Default is the MANAGED engine: the runtime's pinned source checkout + its
 * own venv + model-manager checkpoints, driven by an embedded entry script.
 * Setting engines.musicMode = "external" is the escape hatch back to the
 * operator's own ACE-Step checkout running videofast's gen_music_cli.py. */

import fs from "node:fs";
import path from "node:path";
import type { Job } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import type { ModelManager } from "../models/manager.js";
import type { EngineRuntime } from "../runtime/runtime.js";
import { jobRunDir, LastError, runProcess } from "./proc.js";
import { ACESTEP_SCRIPT } from "./music-script.js";
import type { JobResources } from "../scheduler.js";
import type { AdapterProgress, AdapterRun, EngineAdapter } from "./types.js";

export class MusicAdapter implements EngineAdapter {
  id = "acestep";

  constructor(
    private settings: SettingsStore,
    private runtime: EngineRuntime,
    private models: ModelManager,
  ) {}

  canRun(job: Job): boolean {
    return job.payload?.type === "music";
  }

  resources(): JobResources {
    // managed ACE-Step loads DiT + the 1.7B LM fresh each job (~10 GB);
    // the external checkout owns its own memory — no estimate
    const managed = this.settings.get().engines.musicMode === "managed";
    return { klass: "gpu", vramGb: managed ? 10 : undefined };
  }

  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun {
    let proc: ReturnType<typeof runProcess> | undefined;
    let canceled = false;

    const done = (async () => {
      const payload = job.payload;
      if (payload?.type !== "music") throw new Error("not a music job");
      const { storage, paths, engines } = this.settings.get();

      const runDir = jobRunDir(job.id);
      const out = path.join(runDir, "out", "track.wav");
      const caption = [
        payload.description,
        ...payload.styles.map((s) => s.toLowerCase()),
        // no engine duet param — steer via the caption (best-effort)
        ...(payload.duet && payload.arrangement === "vocals"
          ? ["duet, male and female vocals, two singers trading lines"]
          : []),
      ]
        .filter(Boolean)
        .join(", ");

      let exe: string;
      let args: string[];
      let cwd: string;
      const env: Record<string, string> = {};

      if (engines.musicMode === "managed") {
        if (!this.runtime.componentReady("acestep")) {
          throw new Error("ACE-Step engine not installed — Settings → Engines → Install");
        }
        if (!this.models.ready("acestep-v15")) {
          throw new Error("ACE-Step checkpoints not installed — Settings → Models");
        }
        const script = path.join(runDir, "music_acestep.py");
        fs.writeFileSync(script, ACESTEP_SCRIPT);
        exe = this.runtime.venvEnginePython("acestep");
        args = [script];
        cwd = runDir;
        env.AUREA_ACESTEP_ROOT = this.runtime.engineRepoDir("acestep");
        env.AUREA_CHECKPOINT_ROOT = path.join(storage.dataRoot, "models", "acestep-v15");
        env.AUREA_CAPTION = caption;
        env.AUREA_DURATION = String(payload.durationSec);
        env.AUREA_VOCALS = payload.arrangement === "vocals" ? "1" : "0";
        env.AUREA_OUT_WAV = out;
        if (payload.lyrics && payload.arrangement === "vocals") env.AUREA_LYRICS = payload.lyrics;
        if (payload.seed !== undefined) env.AUREA_SEED = String(payload.seed);
        if (payload.bpm !== undefined) env.AUREA_BPM = String(payload.bpm);
        if (payload.language && payload.language !== "unknown") {
          env.AUREA_LANGUAGE = payload.language;
        }
        if (payload.keyscale) env.AUREA_KEYSCALE = payload.keyscale;
        if (payload.timesignature) env.AUREA_TIMESIG = payload.timesignature;
        if (payload.steps !== undefined) env.AUREA_STEPS = String(payload.steps);
        if (payload.shift !== undefined) env.AUREA_SHIFT = String(payload.shift);
      } else {
        // external: the operator's own checkout runs videofast's CLI
        if (!paths.videofastDir) throw new Error("videofast path not set — Settings → Storage");
        if (!engines.acestepDir) {
          throw new Error("ACE-Step not found — set its checkout in Settings → Engines");
        }
        exe = path.join(engines.acestepDir, ".venv", "Scripts", "python.exe");
        args = [
          path.join(paths.videofastDir, "audio", "gen_music_cli.py"),
          "--caption", caption,
          "--duration", String(payload.durationSec),
          "--out", out,
          "--acestep-root", engines.acestepDir,
        ];
        if (payload.arrangement === "vocals") args.push("--vocals");
        // language/keyscale/timesignature are managed-only — the CLI has no flags for them
        if (payload.lyrics && payload.arrangement === "vocals") {
          args.push("--lyrics", payload.lyrics);
        }
        if (payload.seed !== undefined) args.push("--seed", String(payload.seed));
        if (payload.bpm !== undefined) args.push("--bpm", String(payload.bpm));
        if (payload.steps !== undefined) args.push("--steps", String(payload.steps));
        if (payload.shift !== undefined) args.push("--shift", String(payload.shift));
        cwd = engines.acestepDir;
      }

      const err = new LastError();
      report({ progress: 2, stage: "Starting ACE-Step" });

      // what the engine actually sang — only present when the run left lyrics,
      // tempo or key to the model (managed mode; the external CLI is silent)
      let take: { lyrics?: string; bpm?: string; keyscale?: string } | undefined;

      proc = runProcess({
        exe,
        args,
        cwd,
        env,
        logFile: path.join(runDir, "run.log"),
        onLine: (line) => {
          err.note(line);
          if (line.includes("initializing DiT")) report({ progress: 8, stage: "Loading DiT" });
          if (line.includes("initializing 5Hz LM")) report({ progress: 30, stage: "Loading language model" });
          if (line.includes("generating...")) report({ progress: 55, stage: "Composing arrangement and mixing" });
          const marker = line.indexOf("[aurea-music] TAKE ");
          if (marker !== -1) {
            try {
              take = JSON.parse(line.slice(marker + "[aurea-music] TAKE ".length));
            } catch {
              // provenance is best-effort — the wav is the deliverable
            }
          }
          if (line.includes("OK ->")) report({ progress: 98 });
        },
      });

      const code = await proc.exited;
      if (canceled) throw new Error("Canceled by user");
      if (code !== 0 || !fs.existsSync(out)) {
        throw new Error(err.message(`music generation exited with code ${code}`));
      }
      // the sidecar keeps the words with the file; the request that carried
      // them ages out of the capped job history long before the track does
      const lyrics = payload.lyrics?.trim() || take?.lyrics?.trim();
      const sung = Number(take?.bpm);
      const bpm = payload.bpm ?? (Number.isFinite(sung) && sung > 0 ? sung : undefined);
      const keyscale = payload.keyscale || take?.keyscale || undefined;
      return {
        output: out,
        meta: {
          ...(payload.arrangement === "vocals" && lyrics ? { lyrics } : {}),
          ...(bpm !== undefined ? { bpm } : {}),
          ...(keyscale ? { keyscale } : {}),
          prompt: caption,
        },
      };
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
