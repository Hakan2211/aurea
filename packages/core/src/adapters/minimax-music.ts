/* MiniMax-Music3 adapter — description + lyrics → full song through the local
 * diffusers ModularPipeline. Unlike ACE-Step there is no managed venv build:
 * the 53 GB snapshot and the pinned-diffusers venv are operator-owned (the
 * torch stack would otherwise be duplicated under runtime/venvs), pointed at
 * by engines.music3Python / engines.music3ModelDir with a convention probe
 * as the fallback — the same escape-hatch shape as ACE-Step external mode.
 *
 * The work does not run in a per-job process: it goes to the warm worker
 * (minimax-music-worker.ts), which loads the 11B pipeline once and keeps it
 * in host RAM between songs. Cold start costs ~100s of the wall clock on this
 * card and warm start costs ~5s, which for a short song is most of the run.
 *
 * Music3 has no bpm/keyscale/steps parameters; tempo and key steer through
 * the prompt text ("BPM: 96. Key: C major.") per the model card, so the
 * payload's advanced fields fold into the prompt here rather than dropping. */

import fs from "node:fs";
import path from "node:path";
import type { Job } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import type { ComfyService } from "../comfy/service.js";
import { ComfyClient } from "../comfy/client.js";
import { jobRunDir } from "./proc.js";
import { type Music3Progress, type Music3Worker } from "./minimax-music-worker.js";
import type { JobResources } from "../scheduler.js";
import type { AdapterProgress, AdapterRun, EngineAdapter } from "./types.js";

/** What THIS card can actually finish, which is not the model card's number.
 *
 * The card advertises five minutes, and 300 was that number taken on trust.
 * It is not reachable on a 24 GB 3090 Ti: the pipeline holds ~17.6 GiB of
 * weights before a note is written (see resources() below), and the AR
 * stage's KV cache grows with the length of the song. It eats the remaining
 * ~6 GB at roughly 140 seconds of audio, and what happens there is not an
 * OOM — WDDM starts paging GPU memory to host RAM and the loop keeps going
 * at 1/173rd of the rate.
 *
 * Measured on job j-ca28c365 (a 3-minute request, 2026-08-30): frames 1-3482
 * at 0.07-0.14 s/frame, then a cliff at frame ~3500 to 3.1 and on to 12.2,
 * still decelerating at 53 minutes when it was killed. The first 139 seconds
 * of audio took 6 minutes; the next 20 took 47. Nothing fails, nothing logs,
 * and the progress bar keeps moving the whole time.
 *
 * 120 leaves ~20s of margin against that cliff for whatever else holds a
 * CUDA context (a warm ComfyUI is ~1 GB on its own). Music3 only — ACE-Step
 * is unaffected and keeps the shared 420s slider max; this constant is
 * applied in create.tsx only when Music3 is the selected engine. Raise it if
 * the weights ever move to a bigger card, not because the card says 5 min. */
export const MUSIC3_MAX_DURATION = 120;

/** flow-matching Euler steps per window; the checkpoint's documented default */
const MUSIC3_STEPS = 30;

/** scheduler id — the worker registers under the same name as a WarmEngine */
export const MUSIC3_ENGINE_ID = "music3";

/** effective engine paths: explicit settings first, machine convention second
 * (existing installs predate the settings fields, so their settings.json
 * parses to null — the probe keeps the engine discoverable without a
 * migration). Shared by the adapter and the lab catalog. */
export function music3Paths(settings: SettingsStore): {
  python: string | null;
  modelDir: string | null;
} {
  const { engines } = settings.get();
  return {
    python:
      engines.music3Python ??
      (fs.existsSync("D:/music3env/Scripts/python.exe")
        ? "D:/music3env/Scripts/python.exe"
        : null),
    modelDir:
      engines.music3ModelDir ??
      (fs.existsSync("D:/models/MiniMax-Music3/modular_model_index.json")
        ? "D:/models/MiniMax-Music3"
        : null),
  };
}

/** "3m 20s left" / "45s left" — an ETA the operator can act on */
function remaining(seconds: number): string {
  const total = Math.max(1, Math.round(seconds));
  if (total < 90) return `~${total}s left`;
  const minutes = Math.floor(total / 60);
  return `~${minutes}m ${String(total % 60).padStart(2, "0")}s left`;
}

/** The two stages read very differently to a listener waiting on a song:
 * the language model is writing the performance, the flow-matching pass is
 * turning it into audio. Name them that way rather than "step 41/90". */
function stageLabel(p: Music3Progress): string {
  // a render that is paging reads as "working, slowly" everywhere else; say so.
  // Don't say "close other GPU apps": past MUSIC3_MAX_DURATION the KV cache
  // alone overruns the card, and closing everything buys back ~1 GB — it
  // moves the cliff by a couple hundred frames rather than clearing it. The
  // honest advice depends on which side of the ceiling the request is on.
  const warning = p.degraded
    ? " · paging to host RAM — this song is too long for this GPU, try a shorter one"
    : "";
  if (p.stage === "denoise") {
    return `Rendering audio — step ${p.steps}/${p.stepsTotal} · ${remaining(p.eta)}${warning}`;
  }
  const seconds = p.framesTotal ? (p.frames / 25).toFixed(0) : "0";
  return `Composing — ${seconds}s of ${Math.round(p.framesTotal / 25)}s written · ${remaining(p.eta)}${warning}`;
}

export class MinimaxMusicAdapter implements EngineAdapter {
  id = "minimax-music3";

  constructor(
    private worker: Music3Worker,
    private comfy: ComfyService,
  ) {}

  canRun(job: Job): boolean {
    return job.payload?.type === "music" && job.payload.engine === "minimax-music3";
  }

  resources(): JobResources {
    // measured 17.6 GiB peak allocated (~19.9 GB resident) for a 30s song on
    // the 3090 Ti; claiming 20 makes the scheduler evict a warm ComfyUI
    // before the pipeline loads. engineId lets an already-warm worker skip
    // the preflight — its weights being resident IS the VRAM it needs.
    return { klass: "gpu", vramGb: 20, engineId: MUSIC3_ENGINE_ID };
  }

  /** Best effort, and never blocking: ask whichever ComfyUI is reachable to
   * unload. `idleUrlResolved` is passive — it finds a running server but
   * never boots one, which is what we want when the goal is an empty card. */
  private async freeComfyVram(): Promise<void> {
    try {
      const url = await this.comfy.idleUrlResolved();
      if (url) await new ComfyClient(url).freeMemory();
    } catch {
      // no ComfyUI to talk to is the best possible outcome here
    }
  }

  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun {
    let canceled = false;

    const done = (async () => {
      const payload = job.payload;
      if (payload?.type !== "music") throw new Error("not a music job");

      const runDir = jobRunDir(job.id);
      const out = path.join(runDir, "out", "track.wav");
      const vocals = payload.arrangement === "vocals";
      // the model card's prompt idiom: prose description with "BPM:"/"Key:"
      // fields — fold the structured knobs in rather than dropping them
      const prompt = [
        payload.description,
        ...payload.styles.map((s) => s.toLowerCase()),
        payload.bpm !== undefined ? `BPM: ${payload.bpm}.` : "",
        payload.keyscale ? `Key: ${payload.keyscale}.` : "",
        vocals
          ? payload.duet
            ? "Vocals: duet, male and female singers trading lines."
            : ""
          : "Instrumental, no vocals.",
      ]
        .filter(Boolean)
        .join(", ");

      // Music3's text encoder rejects an empty lyric block outright
      // (`lyrics must be a non-empty string`), so unlike ACE-Step there is no
      // "just leave it out" path. Structure tags on their own lines are legal
      // and are what the model card documents, so steer with tags when there
      // are no words: [instrumental] for an instrumental, a bare verse/chorus
      // skeleton for wordless singing.
      const lyrics = vocals
        ? payload.lyrics?.trim() || "[verse]\n[chorus]"
        : "[intro]\n[instrumental]\n[outro]";

      /* Start from an empty card, the same rule the H3 adapter follows and for
       * the same measured reason. A 30s song peaks at 17.6 GiB of 24; anything
       * a ComfyUI left warm pushes the pipeline over, and Windows answers by
       * paging GPU memory to host RAM rather than by failing. That is silent:
       * the render still completes, at roughly a tenth of the speed. Measured
       * here — the autoregressive stage fell from ~14 frames/s to ~1.4 with
       * ComfyUI resident, turning a three-minute song into most of an hour.
       *
       * The scheduler already evicts Aurea's OWN managed sidecar in preflight,
       * but a ComfyUI the operator launched themselves is not Aurea's to stop —
       * asking it to drop its models is all we can do, and it is enough. */
      report({ progress: 3, stage: "Clearing VRAM" });
      await this.freeComfyVram();

      report({
        progress: 4,
        stage: this.worker.warm()
          ? "Starting MiniMax-Music3"
          : "Loading MiniMax-Music3 (11B — first song of the session)",
      });

      const result = await this.worker.run(
        {
          id: job.id,
          prompt,
          lyrics,
          duration: Math.min(payload.durationSec, MUSIC3_MAX_DURATION),
          steps: MUSIC3_STEPS,
          ...(payload.seed !== undefined ? { seed: payload.seed } : {}),
          out,
        },
        (p) => {
          // 5–97 leaves room for the load ahead of it and the import behind
          report({ progress: 5 + p.fraction * 92, stage: stageLabel(p) });
        },
      );

      if (canceled) throw new Error("Canceled by user");
      if (!fs.existsSync(out)) throw new Error("MiniMax-Music3 produced no audio file");
      report({ progress: 98, stage: `Rendered ${result.audioSeconds}s in ${result.seconds}s` });

      return {
        output: out,
        meta: {
          ...(vocals && payload.lyrics?.trim() ? { lyrics: payload.lyrics.trim() } : {}),
          ...(payload.bpm !== undefined ? { bpm: payload.bpm } : {}),
          ...(payload.keyscale ? { keyscale: payload.keyscale } : {}),
          prompt,
        },
      };
    })();

    return {
      done,
      cancel: () => {
        canceled = true;
        // cooperative: the worker unwinds its stage loop and stays warm, so
        // the next song still starts in seconds
        this.worker.cancel(job.id);
      },
    };
  }
}
