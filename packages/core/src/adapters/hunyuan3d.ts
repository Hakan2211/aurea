/* Hunyuan3D-2.1 adapter — a concept still becomes a textured GLB.
 *
 * Like MiniMax-Music3 this is an operator-owned engine rather than a managed
 * one: the runner (`generate.py`), its venv and its ~30 GB of caches already
 * live at D:\hunyuan3d, driven today by videofast's models3d/gen_scene_models.py.
 * Aurea points at the same install rather than building a second copy, via
 * engines.hunyuan3dDir / hunyuan3dPython with a convention probe as fallback —
 * the same escape-hatch shape as ACE-Step and Music3.
 *
 * Two stages in one process, and they behave very differently:
 *   shape — a flow-matching DiT samples an occupancy field, marching cubes
 *           turns it into a mesh, then floaters/degenerates are removed and
 *           the mesh is decimated. Roughly a third of the time.
 *   paint — multiview diffusion renders six views, they are baked onto a UV
 *           atlas and the seams inpainted. The other two thirds, and skipped
 *           entirely when `textured` is false.
 * The runner caches the shape to `<out>.shape.ply`, so a paint-stage failure
 * costs the paint pass only on retry — worth preserving, so the job's scratch
 * dir is where the output is built.
 *
 * Measured on the 3090 Ti: 189s for octree 384, 60k faces, 1024px textures.
 *
 * Licence: outputs carry the Tencent Hunyuan 3D 2.1 Community License —
 * attribution required, not licensed in the EU/UK/South Korea. The runner
 * writes both strings into `<out>.stats.json` and they are copied into the
 * asset's sidecar, because an obligation that lives in a doc travels with
 * nothing. */

import fs from "node:fs";
import path from "node:path";
import type { Job } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import type { ComfyService } from "../comfy/service.js";
import { ComfyClient } from "../comfy/client.js";
import { jobRunDir, LastError, runProcess } from "./proc.js";
import type { JobResources } from "../scheduler.js";
import type { AdapterProgress, AdapterRun, EngineAdapter } from "./types.js";

/** runner defaults, mirrored here so the lab can show them as placeholders */
export const HUNYUAN3D_DEFAULTS = {
  shapeSteps: 50,
  octree: 384,
  maxFaces: 60000,
  textureSize: 1024,
} as const;

/** scheduler id — also the WarmEngine name, though this engine never stays warm */
export const HUNYUAN3D_ENGINE_ID = "hunyuan3d";

export function hunyuan3dPaths(settings: SettingsStore): {
  python: string | null;
  dir: string | null;
} {
  const { engines } = settings.get();
  const dir =
    engines.hunyuan3dDir ??
    (fs.existsSync("D:/hunyuan3d/generate.py") ? "D:/hunyuan3d" : null);
  const python =
    engines.hunyuan3dPython ??
    (dir && fs.existsSync(path.join(dir, ".venv/Scripts/python.exe"))
      ? path.join(dir, ".venv/Scripts/python.exe")
      : null);
  return { python, dir };
}

/** the runner's `<out>.stats.json` — provenance the sidecar has to carry */
interface RunnerStats {
  faces?: number;
  textured?: boolean;
  seed?: number;
  license?: string;
  attribution?: string;
  seconds?: number;
}

/* The runner narrates itself with `[hy3d] …` lines. Each one opens a span of
 * the bar, weighted by what that step actually costs — the shape sample and
 * the multiview paint dominate, so a linear reading of the step list would
 * sit at 50% for two minutes.
 *
 * The two long stages report through tqdm rather than log lines, so each
 * nominates WHICH bar carries its work. That is not fussiness: the paint
 * stage emits three tqdm bars in a row — two `Loading weights` passes and
 * then the anonymous ten-step diffusion bar that is the actual two minutes.
 * Interpolating whichever bar spoke last races the progress to the end of the
 * span in a second and then jumps it backwards twice. */
interface Stage {
  /** the `[hy3d]` line that opens this stage */
  log: RegExp;
  /** where the bar sits when the stage begins */
  at: number;
  label: string;
  /** the tqdm bar whose percentage maps across this stage's span; other bars
   * inside the stage are ignored. The paint stage's bar is anonymous, hence
   * the leading-percentage shape. */
  bar?: RegExp;
}

const STAGES: Stage[] = [
  { log: /removing background/, at: 6, label: "Removing the background" },
  { log: /loading shape pipeline/, at: 10, label: "Loading the shape model" },
  { log: /shape sampling/, at: 16, label: "Sampling the shape", bar: /^Diffusion Sampling/ },
  { log: /raw mesh:/, at: 34, label: "Marching cubes" },
  { log: /clean mesh:/, at: 38, label: "Cleaning the mesh" },
  { log: /reusing cached shape/, at: 38, label: "Reusing the cached shape" },
  { log: /loading paint pipeline/, at: 42, label: "Loading the texture model" },
  { log: /multiview PBR/, at: 48, label: "Painting six views", bar: /^\s*\d{1,3}%\|/ },
  { log: /baking views/, at: 78, label: "Baking onto the UV atlas" },
  { log: /inpainting seams/, at: 86, label: "Inpainting seams" },
  { log: /exporting GLB/, at: 92, label: "Exporting the GLB" },
];

/** where the next stage begins — the ceiling this one interpolates toward */
const STAGE_END = STAGES.map((_, i) => STAGES[i + 1]?.at ?? 96);

/** the percentage off a tqdm bar, e.g. "Diffusion Sampling::  32%|███…" */
const TQDM = /(\d{1,3})%\|/;

export class Hunyuan3dAdapter implements EngineAdapter {
  id = "hunyuan3d-2.1";

  constructor(
    private settings: SettingsStore,
    private comfy: ComfyService,
  ) {}

  canRun(job: Job): boolean {
    return job.payload?.type === "model3d";
  }

  resources(): JobResources {
    // both stages load and free their own models inside one process; the
    // paint stage is the peak. Claiming 16 makes the scheduler clear a warm
    // ComfyUI first rather than let the shape DiT start against a full card.
    return { klass: "gpu", vramGb: 16, engineId: HUNYUAN3D_ENGINE_ID };
  }

  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun {
    let proc: ReturnType<typeof runProcess> | undefined;
    let canceled = false;

    const done = (async () => {
      const payload = job.payload;
      if (payload?.type !== "model3d") throw new Error("not a model3d job");
      const { python, dir } = hunyuan3dPaths(this.settings);
      if (!python || !dir) {
        throw new Error(
          "Hunyuan3D-2.1 not found — set engines.hunyuan3dDir in Settings (the checkout with generate.py)",
        );
      }

      const dataRoot = this.settings.get().storage.dataRoot;
      const image = path.resolve(dataRoot, payload.source);
      if (!fs.existsSync(image)) throw new Error(`concept image not found: ${payload.source}`);

      const runDir = jobRunDir(job.id);
      const out = path.join(runDir, "out", "model.glb");
      fs.mkdirSync(path.dirname(out), { recursive: true });

      /* Same rule as MiniMax-H3 and Music3: start from an empty card. The
       * shape DiT and the paint pipeline each want most of the 24 GB, and a
       * ComfyUI holding its last model is the difference between 3 minutes
       * and a driver fault. */
      report({ progress: 2, stage: "Clearing VRAM" });
      try {
        const url = await this.comfy.idleUrlResolved();
        if (url) await new ComfyClient(url).freeMemory();
      } catch {
        // nothing listening is the best possible answer here
      }

      const args = [
        path.join(dir, "generate.py"),
        "--image", image,
        "--out", out,
        "--seed", String(payload.seed ?? 1234),
        "--shape-steps", String(payload.shapeSteps ?? HUNYUAN3D_DEFAULTS.shapeSteps),
        "--octree", String(payload.octree ?? HUNYUAN3D_DEFAULTS.octree),
        "--max-faces", String(payload.maxFaces ?? HUNYUAN3D_DEFAULTS.maxFaces),
        "--texture-size", String(payload.textureSize ?? HUNYUAN3D_DEFAULTS.textureSize),
      ];
      if (!payload.textured) args.push("--no-texture");

      const err = new LastError();
      // Both long stages narrate themselves with tqdm rather than log lines,
      // so without this the bar would stand still for the 30s shape sample
      // and again for the two-minute paint — the same "is it stuck?" the
      // Music3 engine had. Interpolate the sub-bar into the current span.
      let stage: Stage | undefined;
      let end = 0;
      report({
        progress: 4,
        stage: "Starting Hunyuan3D-2.1",
        detail: `${payload.textured ? "shape + PBR texture" : "shape only"} · octree ${payload.octree ?? HUNYUAN3D_DEFAULTS.octree}`,
      });

      proc = runProcess({
        exe: python,
        args,
        cwd: dir,
        logFile: path.join(runDir, "run.log"),
        // the shape sampler and the paint pass report through tqdm, which
        // redraws with a bare carriage return and no newline - without this
        // their percentages never reach onLine and the bar sits still
        // through both of the long stages
        splitCarriageReturns: true,
        onLine: (line) => {
          err.note(line);
          const entered = STAGES.findIndex((s) => s.log.test(line));
          if (entered >= 0) {
            stage = STAGES[entered];
            end = STAGE_END[entered];
            report({ progress: stage.at, stage: stage.label });
            return;
          }
          if (!stage?.bar?.test(line)) return;
          const bar = TQDM.exec(line);
          if (!bar) return;
          const pct = Math.min(Number(bar[1]), 100) / 100;
          report({ progress: stage.at + (end - stage.at) * pct });
        },
      });

      const code = await proc.exited;
      if (canceled) throw new Error("Canceled by user");
      if (code !== 0 || !fs.existsSync(out)) {
        throw new Error(err.message(`Hunyuan3D exited with code ${code}`));
      }

      let stats: RunnerStats = {};
      try {
        stats = JSON.parse(fs.readFileSync(`${out}.stats.json`, "utf8")) as RunnerStats;
      } catch {
        // the GLB is what matters; provenance is best effort
      }
      report({ progress: 98, stage: `Done — ${stats.faces ?? "?"} faces in ${stats.seconds ?? "?"}s` });

      return {
        output: out,
        meta: {
          engine: "hunyuan3d-2.1",
          source: payload.source,
          ...(payload.name ? { title: payload.name } : {}),
          ...(stats.faces !== undefined ? { faces: stats.faces } : {}),
          textured: stats.textured ?? payload.textured,
          ...(stats.license ? { license: stats.license } : {}),
          ...(stats.attribution ? { attribution: stats.attribution } : {}),
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
