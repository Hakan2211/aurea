/* TTS adapter — one line of dialogue → wav. Character voices (chatterbox)
 * default to the MANAGED engine: the runtime's own venv + model-manager
 * weights + an embedded entry script, with reference clips resolved from
 * <dataRoot>/voices/ first and videofast's char_refs as fallback. Setting
 * engines.ttsMode = "external" is the escape hatch back to the operator's
 * own venv running the videofast scripts. Narrator voices (qwen) are always
 * external — no managed build yet. The emotion slider maps onto Chatterbox's
 * exaggeration knob; pace has no engine knob yet and is ignored. */

import fs from "node:fs";
import path from "node:path";
import type { Job } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import type { ModelManager } from "../models/manager.js";
import type { EngineRuntime } from "../runtime/runtime.js";
import { jobRunDir, LastError, runProcess } from "./proc.js";
import { CHATTERBOX_SCRIPT } from "./tts-script.js";
import type { JobResources } from "../scheduler.js";
import type { AdapterProgress, AdapterRun, EngineAdapter } from "./types.js";

const CHATTERBOX_CHARS = ["sterling", "grant", "milo", "bruno", "jax", "barney"];
const QWEN_VOICES = ["gravel", "aiden"];

/** Where a cloned voice's frozen reference clip may live, in precedence
 * order: the studio's own voices folder, then videofast's character refs. */
export function voiceRefCandidates(
  voice: string,
  dataRoot: string,
  videofastDir: string | null,
): string[] {
  const candidates = [path.join(dataRoot, "voices", `${voice}.wav`)];
  if (videofastDir) {
    candidates.push(path.join(videofastDir, "assets", "vo", "char_refs", `${voice}.wav`));
  }
  return candidates;
}

export class TtsAdapter implements EngineAdapter {
  id = "tts";

  constructor(
    private settings: SettingsStore,
    private runtime: EngineRuntime,
    private models: ModelManager,
  ) {}

  canRun(job: Job): boolean {
    return job.payload?.type === "tts" && ["chatterbox", "qwen"].includes(job.payload.engine);
  }

  resources(job: Job): JobResources {
    // managed chatterbox loads its model fresh each job (~4 GB); external
    // venvs own their own memory — no estimate
    const managed =
      job.payload?.type === "tts" &&
      job.payload.engine === "chatterbox" &&
      this.settings.get().engines.ttsMode === "managed";
    return { klass: "gpu", vramGb: managed ? 4 : undefined };
  }

  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun {
    let proc: ReturnType<typeof runProcess> | undefined;
    let canceled = false;

    const done = (async () => {
      const payload = job.payload;
      if (payload?.type !== "tts") throw new Error("not a tts job");
      const { storage, paths, engines } = this.settings.get();

      const runDir = jobRunDir(job.id);
      const outDir = path.join(runDir, "out");
      const wav = path.join(outDir, "take.wav");
      // emotion 0..1 → Chatterbox exaggeration (0.25 flat … 1.0 theatrical)
      const exag = (0.25 + payload.emotion * 0.75).toFixed(2);

      let exe: string;
      let args: string[];
      let cwd: string;
      const env: Record<string, string> = {};

      if (payload.engine === "chatterbox" && engines.ttsMode === "managed") {
        if (!this.runtime.componentReady("chatterbox")) {
          throw new Error("Chatterbox engine not installed — Settings → Engines → Install");
        }
        const weights = this.models.list().find((m) => m.id === "chatterbox-tts");
        if (weights?.status.state !== "installed") {
          throw new Error("Chatterbox voice weights not installed — Settings → Models");
        }
        const ref = voiceRefCandidates(payload.voice, storage.dataRoot, paths.videofastDir).find(
          (c) => fs.existsSync(c),
        );
        if (!ref) {
          throw new Error(`no reference clip for voice "${payload.voice}"`);
        }
        const script = path.join(runDir, "tts_chatterbox.py");
        fs.writeFileSync(script, CHATTERBOX_SCRIPT);
        exe = this.runtime.venvEnginePython("chatterbox");
        args = [script];
        cwd = runDir;
        env.AUREA_MODEL_DIR = path.join(storage.dataRoot, "models", "chatterbox-tts");
        env.AUREA_TEXT = payload.text;
        env.AUREA_REF_WAV = ref;
        env.AUREA_EXAG = exag;
        env.AUREA_OUT_WAV = wav;
      } else {
        // external engines run videofast's env-driven scripts on a synthesized
        // one-scene VideoConfig
        if (!paths.videofastDir) throw new Error("videofast path not set — Settings → Storage");
        const configFile = path.join(runDir, "config.json");
        fs.writeFileSync(
          configFile,
          JSON.stringify({ scenes: [{ id: "take", text: payload.text }] }),
        );
        env.VF_CONFIG = configFile;
        env.VF_OUT_DIR = outDir;
        cwd = paths.videofastDir;

        if (payload.engine === "chatterbox") {
          if (!engines.chatterboxPython) {
            throw new Error("Chatterbox venv not found — set it in Settings → Engines");
          }
          if (!CHATTERBOX_CHARS.includes(payload.voice)) {
            throw new Error(`"${payload.voice}" is not a cloned character voice`);
          }
          exe = engines.chatterboxPython;
          args = [path.join(paths.videofastDir, "audio", "gen_char_vo.py")];
          env.CHAR = payload.voice;
          env.EXAG = exag;
        } else {
          if (!engines.qwenTtsPython) {
            throw new Error("Qwen3-TTS venv not found — set it in Settings → Engines");
          }
          if (!QWEN_VOICES.includes(payload.voice)) {
            throw new Error(`"${payload.voice}" is not a narrator voice`);
          }
          exe = engines.qwenTtsPython;
          args = [path.join(paths.videofastDir, "audio", "gen_vo_qwen.py")];
          env.VOICE = payload.voice;
          env.LANG_TTS = "english";
        }
      }

      const err = new LastError();
      report({ progress: 3, stage: "Loading voice model" });

      proc = runProcess({
        exe,
        args,
        cwd,
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
