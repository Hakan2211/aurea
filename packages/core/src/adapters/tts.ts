/* TTS adapter — one line of dialogue → wav. Two engines behind one payload:
 *   chatterbox — cloned character voices (videofast/audio/gen_char_vo.py)
 *   qwen       — narrator voices (videofast/audio/gen_vo_qwen.py)
 * Both scripts are env-driven and read a VideoConfig; the adapter synthesizes
 * a one-scene config in the job's scratch dir. The emotion slider maps onto
 * Chatterbox's exaggeration knob; pace has no engine knob yet and is ignored. */

import fs from "node:fs";
import path from "node:path";
import type { Job } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import { jobRunDir, LastError, runProcess } from "./proc.js";
import type { AdapterProgress, AdapterRun, EngineAdapter } from "./types.js";

const CHATTERBOX_CHARS = ["sterling", "grant", "milo", "bruno", "jax", "barney"];
const QWEN_VOICES = ["gravel", "aiden"];

export class TtsAdapter implements EngineAdapter {
  id = "tts";

  constructor(private settings: SettingsStore) {}

  canRun(job: Job): boolean {
    return job.payload?.type === "tts" && ["chatterbox", "qwen"].includes(job.payload.engine);
  }

  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun {
    let proc: ReturnType<typeof runProcess> | undefined;
    let canceled = false;

    const done = (async () => {
      const payload = job.payload;
      if (payload?.type !== "tts") throw new Error("not a tts job");
      const { paths, engines } = this.settings.get();
      if (!paths.videofastDir) throw new Error("videofast path not set — Settings → Storage");

      const runDir = jobRunDir(job.id);
      const outDir = path.join(runDir, "out");
      const configFile = path.join(runDir, "config.json");
      fs.writeFileSync(configFile, JSON.stringify({ scenes: [{ id: "take", text: payload.text }] }));

      let exe: string;
      let script: string;
      const env: Record<string, string> = { VF_CONFIG: configFile, VF_OUT_DIR: outDir };

      if (payload.engine === "chatterbox") {
        if (!engines.chatterboxPython) {
          throw new Error("Chatterbox venv not found — set it in Settings → Engines");
        }
        if (!CHATTERBOX_CHARS.includes(payload.voice)) {
          throw new Error(`"${payload.voice}" is not a cloned character voice`);
        }
        exe = engines.chatterboxPython;
        script = path.join(paths.videofastDir, "audio", "gen_char_vo.py");
        env.CHAR = payload.voice;
        // emotion 0..1 → Chatterbox exaggeration (0.25 flat … 1.0 theatrical)
        env.EXAG = (0.25 + payload.emotion * 0.75).toFixed(2);
      } else {
        if (!engines.qwenTtsPython) {
          throw new Error("Qwen3-TTS venv not found — set it in Settings → Engines");
        }
        if (!QWEN_VOICES.includes(payload.voice)) {
          throw new Error(`"${payload.voice}" is not a narrator voice`);
        }
        exe = engines.qwenTtsPython;
        script = path.join(paths.videofastDir, "audio", "gen_vo_qwen.py");
        env.VOICE = payload.voice;
        env.LANG_TTS = "english";
      }

      const err = new LastError();
      report({ progress: 3, stage: "Loading voice model" });

      proc = runProcess({
        exe,
        args: [script],
        cwd: paths.videofastDir,
        env,
        logFile: path.join(runDir, "run.log"),
        onLine: (line) => {
          err.note(line);
          if (/loaded in [\d.]+s/.test(line)) report({ progress: 45, stage: "Synthesizing" });
          if (/-> [\d.]+s$/.test(line.trim())) report({ progress: 90 });
        },
      });

      const code = await proc.exited;
      if (canceled) throw new Error("Canceled by user");
      const wav = path.join(outDir, "take.wav");
      if (code !== 0 || !fs.existsSync(wav)) {
        throw new Error(err.message(`voice synthesis exited with code ${code}`));
      }
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
