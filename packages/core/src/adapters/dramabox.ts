/* DramaBox adapter — expressive acted dialogue (Resemble AI's TTS on the
 * LTX-2.3 audio model). External-only: runs the operator's own checkout
 * (engines.dramaboxRepo) in its venv (engines.dramaboxPython) via an embedded
 * entry script; a managed VenvEngineSpec install is a future rung. Stage-
 * direction tags in the text ([laughs], (nervously), *sighs*) are performed,
 * not spoken. pace/emotion have no engine knobs and are ignored — delivery is
 * driven by the prompt tags, the speaker design and the DramaBox-only payload
 * fields (seed/cfgScale/stgScale/durationMultiplier/…). */

import fs from "node:fs";
import path from "node:path";
import type { Job } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import { jobRunDir, LastError, runProcess } from "./proc.js";
import {
  DRAMABOX_DESIGN_FALLBACK,
  DRAMABOX_DESIGNS,
  DRAMABOX_SCRIPT,
} from "./dramabox-script.js";
import type { JobResources } from "../scheduler.js";
import type { AdapterProgress, AdapterRun, EngineAdapter } from "./types.js";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Where a voice's clone-source clip may live, in precedence order: the
 * studio's own voices folder, then videofast's hand-picked custom_voices mp3s
 * (PyAV decodes mp3 directly; barney's clip was historically named "Ed"),
 * then the chatterbox char_ref wavs as a last resort. */
export function dramaboxRefCandidates(
  voice: string,
  dataRoot: string,
  videofastDir: string | null,
): string[] {
  const candidates = [path.join(dataRoot, "voices", `${voice}.wav`)];
  if (videofastDir) {
    const customVoices = path.join(videofastDir, "audio", "bakeoff", "out", "custom_voices");
    candidates.push(path.join(customVoices, `${cap(voice)}_voice.mp3`));
    if (voice === "barney") candidates.push(path.join(customVoices, "Ed_voice.mp3"));
    candidates.push(path.join(videofastDir, "assets", "vo", "char_refs", `${voice}.wav`));
  }
  return candidates;
}

export class DramaboxAdapter implements EngineAdapter {
  id = "dramabox";

  constructor(private settings: SettingsStore) {}

  canRun(job: Job): boolean {
    return job.payload?.type === "tts" && job.payload.engine === "dramabox";
  }

  resources(): JobResources {
    // ~24 GB peak on a 3090 Ti — declare high so preflight evicts the warm
    // ComfyUI sidecar first, but not the full 24: the desktop's 1–2 GB
    // baseline would then never let the job through. engineId future-proofs
    // warm-engine reuse (none registered yet — the model loads per job).
    return { klass: "gpu", engineId: "dramabox", vramGb: 20 };
  }

  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun {
    let proc: ReturnType<typeof runProcess> | undefined;
    let canceled = false;

    const done = (async () => {
      const payload = job.payload;
      if (payload?.type !== "tts") throw new Error("not a tts job");
      const { storage, paths, engines } = this.settings.get();

      if (!engines.dramaboxPython || !engines.dramaboxRepo) {
        throw new Error("DramaBox not found — set its venv and repo in Settings → Engines");
      }
      const ref = dramaboxRefCandidates(payload.voice, storage.dataRoot, paths.videofastDir).find(
        (c) => fs.existsSync(c),
      );
      if (!ref) throw new Error(`no reference clip for voice "${payload.voice}"`);

      const runDir = jobRunDir(job.id);
      const wav = path.join(runDir, "out", "take.wav");
      const script = path.join(runDir, "tts_dramabox.py");
      fs.writeFileSync(script, DRAMABOX_SCRIPT);

      const env: Record<string, string> = {
        AUREA_DBX_REPO: engines.dramaboxRepo,
        AUREA_TEXT: payload.text,
        // roster ids may carry a "-custom" suffix (seeded voices) — the
        // character design still applies
        AUREA_DESIGN:
          payload.design ??
          DRAMABOX_DESIGNS[payload.voice] ??
          DRAMABOX_DESIGNS[payload.voice.replace(/-custom$/, "")] ??
          DRAMABOX_DESIGN_FALLBACK,
        AUREA_REF_AUDIO: ref,
        AUREA_OUT_WAV: wav,
      };
      if (payload.seed !== undefined) env.AUREA_SEED = String(payload.seed);
      if (payload.cfgScale !== undefined) env.AUREA_CFG = String(payload.cfgScale);
      if (payload.stgScale !== undefined) env.AUREA_STG = String(payload.stgScale);
      if (payload.durationMultiplier !== undefined) {
        env.AUREA_DUR_MULT = String(payload.durationMultiplier);
      }
      if (payload.genDuration) env.AUREA_GEN_DUR = String(payload.genDuration);
      if (payload.refDuration !== undefined) env.AUREA_REF_SECONDS = String(payload.refDuration);
      if (payload.watermark) env.AUREA_WATERMARK = "1";

      const err = new LastError();
      report({ progress: 2, stage: "Loading DramaBox (~16 GB — cold start takes minutes)" });

      proc = runProcess({
        exe: engines.dramaboxPython,
        args: [script],
        cwd: runDir,
        env,
        logFile: path.join(runDir, "run.log"),
        onLine: (line) => {
          err.note(line);
          if (/model loaded in [\d.]+s/.test(line)) {
            report({ progress: 40, stage: "Synthesizing" });
          }
          const chunk = /chunk (\d+)\/(\d+)/.exec(line);
          if (chunk) {
            const [, i, n] = chunk;
            report({ progress: 40 + Math.round((50 * (Number(i) - 1)) / Number(n)) });
          }
          if (/-> [\d.]+s$/.test(line.trim())) report({ progress: 95, stage: "Finishing" });
        },
      });

      const code = await proc.exited;
      if (canceled) throw new Error("Canceled by user");
      if (code !== 0 || !fs.existsSync(wav)) {
        throw new Error(err.message(`DramaBox exited with code ${code}`));
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
