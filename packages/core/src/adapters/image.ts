/* Image adapter — prompt → PNG(s) through the local ComfyUI API, via
 * videofast's images/gen_image.py (blocking: it polls ComfyUI and writes the
 * files itself). Outputs land in the job's scratch dir; the engine's
 * importOutput pulls them into the project's assets/image/ tree. */

import path from "node:path";
import type { ImageAspect, Job } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import { jobRunDir, LastError, runProcess } from "./proc.js";
import type { AdapterProgress, AdapterRun, EngineAdapter } from "./types.js";

/** aspect → generation size (SDXL-class buckets both engines handle well) */
const ASPECT_SIZE: Record<ImageAspect, [number, number]> = {
  "1:1": [1024, 1024],
  "3:2": [1216, 832],
  "16:9": [1344, 768],
  "4:3": [1152, 896],
  "9:16": [768, 1344],
};

/** lab model id → images/workflows/<name>.json template */
const MODEL_WORKFLOW: Record<string, string> = {
  krea2: "krea2",
  "z-image": "z-image-turbo",
};

export class ImageAdapter implements EngineAdapter {
  id = "comfy-image";

  constructor(private settings: SettingsStore) {}

  canRun(job: Job): boolean {
    return job.payload?.type === "image" && job.payload.model in MODEL_WORKFLOW;
  }

  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun {
    let proc: ReturnType<typeof runProcess> | undefined;
    let canceled = false;

    const done = (async () => {
      const payload = job.payload;
      if (payload?.type !== "image") throw new Error("not an image job");
      const vf = this.settings.get().paths.videofastDir;
      if (!vf) throw new Error("videofast path not set — Settings → Storage");

      const runDir = jobRunDir(job.id);
      const outDir = path.join(runDir, "out");
      const [width, height] = ASPECT_SIZE[payload.aspect];
      const prompt = payload.preset
        ? `${payload.prompt}, ${payload.preset.toLowerCase()} style`
        : payload.prompt;

      const err = new LastError();
      let rendered = 0;
      report({ progress: 2, stage: "Queuing on ComfyUI" });

      proc = runProcess({
        exe: "python",
        args: [
          path.join(vf, "images", "gen_image.py"),
          "--prompt", prompt,
          "--outdir", outDir,
          "--name", "image",
          "--workflow", MODEL_WORKFLOW[payload.model],
          "--width", String(width),
          "--height", String(height),
          "--seed", String(payload.seed ?? Math.floor(Math.random() * 1_000_000_000)),
          "--count", String(payload.count),
        ],
        cwd: vf,
        logFile: path.join(runDir, "run.log"),
        onLine: (line) => {
          err.note(line);
          const start = line.match(/^\[gen_image\] (\d+)\/(\d+) seed/);
          if (start) {
            report({
              progress: 5 + (rendered / payload.count) * 90,
              stage: payload.count > 1 ? `Sampling ${start[1]} of ${start[2]}` : "Sampling",
            });
          }
          if (/^ {2}-> .+\.png/.test(line)) {
            rendered += 1;
            report({ progress: 5 + (rendered / payload.count) * 90 });
          }
        },
      });

      const code = await proc.exited;
      if (canceled) throw new Error("Canceled by user");
      if (code !== 0 || rendered === 0) {
        throw new Error(err.message(`image generation exited with code ${code}`));
      }
      // single image → file; batch → folder (importOutput handles both)
      return { output: payload.count === 1 ? path.join(outDir, "image.png") : outDir };
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
