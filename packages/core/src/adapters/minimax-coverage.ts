/* Coverage pass adapter — one approved plate → eight on-model angles of the
 * same room and cast, in one H3 ref2va generation.
 *
 * Why this is its own adapter rather than a flag on the video one: the video
 * adapter's whole contract is "a take, with its soundtrack, attached to a
 * shot". A coverage pass delivers a folder of stills and a contact sheet, is
 * never a take, and every one of the video adapter's refusals (no keyframes,
 * no audio, no director timeline) is about a payload this one does not have.
 * Threading a second output shape through those 500 lines would make both
 * jobs harder to read than keeping the 120 lines that differ here.
 *
 * What it does NOT duplicate: the weight resolution, the graph, the distill
 * lookup and the VRAM discipline are all imported. Those are the parts that
 * were expensive to get right, and a second copy of them would drift. */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Job } from "@aurea/shared";
import {
  COVERAGE_ANGLES,
  COVERAGE_FRAMES,
  COVERAGE_SHEET_COLUMNS,
  coverageFileName,
} from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import type { ModelManager } from "../models/manager.js";
import { ComfyClient } from "../comfy/client.js";
import type { ComfyService } from "../comfy/service.js";
import {
  MINIMAX_TURBO,
  draftCanvas,
  estimateRenderMinutes,
  unetLoaderFor,
  type MinimaxTurbo,
  type MinimaxTurboSpec,
} from "../comfy/minimax-graphs.js";
import { minimaxCoverageGraph } from "../comfy/minimax-coverage-graph.js";
import {
  MINIMAX_MODEL_ID,
  MINIMAX_REF_MODEL_ID,
  MINIMAX_REF_W4A8_MODEL_ID,
  MINIMAX_TURBO_MODEL_ID,
  MINIMAX_W4A8_MODEL_ID,
  findLora,
  minimaxRefModelNames,
} from "./minimax-video.js";
import { jobRunDir } from "./proc.js";
import type { JobResources } from "../scheduler.js";
import { InfrastructureError } from "./types.js";
import type { AdapterProgress, AdapterRun, EngineAdapter } from "./types.js";

/** The same ceiling the video adapter enforces, for the same reason: past
 * roughly this the DiT is paging and the render is more likely to die than to
 * finish. A coverage pass is a fixed 124 frames, so in practice only the
 * canvas and the tier can push it over. */
const MAX_ESTIMATED_MINUTES = 40;

/** How wide each cell of the contact sheet is drawn. The sheet is for judging
 * identity and geometry across eight angles at a glance — full-resolution
 * cells would make a 5000px image nobody can see at once. */
const SHEET_CELL_WIDTH = 480;

export class MinimaxCoverageAdapter implements EngineAdapter {
  id = "minimax-coverage";

  constructor(
    private settings: SettingsStore,
    private models: ModelManager,
    private comfy: ComfyService,
  ) {}

  canRun(job: Job): boolean {
    return job.payload?.type === "coverage";
  }

  /** Same lane and engine id as every other H3 render — see the long note in
   * MinimaxVideoAdapter.resources for why no vramGb is declared. */
  resources(job: Job): JobResources {
    void job;
    return { klass: "gpu", engineId: "comfy" };
  }

  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun {
    const ctrl = new AbortController();

    const done = (async () => {
      const payload = job.payload;
      if (payload?.type !== "coverage") throw new Error("not a coverage job");
      const { storage } = this.settings.get();

      const url = await this.comfy.minimaxUrlEnsured();
      if (!url) {
        throw new Error(
          "A coverage pass runs on MiniMax-H3's reference head, so it needs the same ComfyUI " +
            "H3 renders on. Start it, or give H3 an address in Settings → Engines.",
        );
      }
      const client = new ComfyClient(url);

      /* The ref head is the whole technique here, not an option — say so
       * plainly rather than letting the graph fail inside a loader. */
      if (!this.models.ready(MINIMAX_MODEL_ID) && !this.models.ready(MINIMAX_W4A8_MODEL_ID)) {
        throw new Error(
          "MiniMax-H3 weights are not installed — Settings → Models → MiniMax-H3 (GGUF).",
        );
      }
      if (
        !this.models.ready(MINIMAX_REF_MODEL_ID) &&
        !this.models.ready(MINIMAX_REF_W4A8_MODEL_ID)
      ) {
        throw new Error(
          "A coverage pass is a reference render — it needs H3's ref2va head, a second " +
            "checkpoint alongside the base weights. Settings → Models → MiniMax-H3 (ref2va).",
        );
      }
      if (!this.models.ready(MINIMAX_TURBO_MODEL_ID)) {
        throw new Error(
          "A coverage pass renders on a distilled tier (4 or 8 steps instead of 25) — " +
            "Settings → Models → MiniMax-H3 Turbo LoRAs.",
        );
      }

      const models = minimaxRefModelNames(this.models);
      const required = [
        "MiniMaxH3ReferenceToVideo",
        "CLIPLoaderGGUF",
        "ImageFromBatch",
        unetLoaderFor(models.refUnet),
      ];
      if (!(await client.hasNodes(required))) {
        throw new InfrastructureError(
          `The ComfyUI at ${url} doesn't have the nodes a coverage pass needs ` +
            `(${required.join(", ")}). They ship with ComfyUI 0.30.0+ and the GGUF loaders ` +
            "come from the ComfyUI-GGUF pack — check both and restart it.",
        );
      }

      const seed = payload.seed ?? Math.floor(Math.random() * 1_000_000_000);
      const size = payload.resolution.match(/(\d+)\s*[×x]\s*(\d+)/);
      const requested: [number, number] = size ? [Number(size[1]), Number(size[2])] : [1344, 768];
      const [width, height] =
        payload.tier === "draft" ? draftCanvas(...requested) : requested;

      /* Which distill: the ref2v file, always — this render is on the
       * reference head, and LightX2V train the two heads' distills
       * separately. */
      const spec: MinimaxTurboSpec = MINIMAX_TURBO[payload.tier].ref2v;
      const options = await client.comboOptions("LoraLoaderModelOnly", "lora_name");
      const lora = findLora(options, spec.file);
      if (!lora) {
        throw new Error(
          `${spec.file} is downloaded but the ComfyUI at ${url} doesn't list it in its lora ` +
            "folder — it scans folders at startup, so restart it and try again.",
        );
      }
      const { file: _file, ...rest } = spec;
      const turbo: MinimaxTurbo = { ...rest, lora };

      const sage =
        this.settings.get().engines.minimaxTuning.sageAttention &&
        (await client.hasNode("PathchSageAttentionKJ"));
      const evictEncoder = await client.hasNode("VRAM_Debug");

      const estMinutes = estimateRenderMinutes(width, height, COVERAGE_FRAMES, turbo.steps);
      if (estMinutes > MAX_ESTIMATED_MINUTES) {
        throw new Error(
          `That coverage pass is about ${Math.round(estMinutes)} minutes — ` +
            `${width}x${height} x ${COVERAGE_FRAMES} frames x ${turbo.steps} steps. Drop to ` +
            "H3's native 1344x768, or run it at Draft.",
        );
      }

      report({ progress: 2, stage: "Staging the plate" });
      const plate = path.join(storage.dataRoot, payload.source);
      if (!fs.existsSync(plate)) throw new Error(`plate not found: ${payload.source}`);
      const plateInputName = await client.uploadInput(
        `${job.id}-plate${path.extname(plate)}`,
        fs.readFileSync(plate),
      );

      const graph = minimaxCoverageGraph({
        subject: payload.subject,
        plateInputName,
        width,
        height,
        seed,
        models,
        turbo,
        sage,
        evictEncoder,
      });

      report({ progress: 3.5, stage: "Clearing VRAM" });
      await client.freeMemory();

      report({
        progress: 4,
        stage: "Queuing on ComfyUI",
        detail:
          `${COVERAGE_ANGLES.length} angles · ${COVERAGE_FRAMES} frames · ${turbo.steps} steps · ` +
          `${width}x${height} · ~${Math.round(estMinutes)} min`,
      });

      const files = await client.run(graph, {
        signal: ctrl.signal,
        timeoutMs: Math.max(30, Math.ceil(estMinutes * 2)) * 60_000,
        onNode: (classType) => {
          if (classType === "UnetLoaderGGUF" || classType === "UNETLoader") {
            report({ stage: "Loading MiniMax-H3" });
          } else if (classType === "CLIPLoaderGGUF") report({ stage: "Loading the text encoder" });
          else if (classType === "MiniMaxH3ReferenceToVideo") {
            report({ stage: "Encoding the plate" });
          } else if (classType === "SamplerCustomAdvanced") report({ stage: "Orbiting" });
          else if (classType === "VAEDecode") report({ progress: 90, stage: "Decoding angles" });
        },
        onProgress: (value, max) => {
          if (max <= 0) return;
          report({ progress: 6 + (value / max) * 82 });
        },
      });

      /* Match returned files to angles by the prefix each SaveImage was given,
       * rather than by the order they arrive in: ComfyUI reports outputs
       * grouped by node and there is no promise about node order. A missing
       * angle is a real failure — a sheet with a hole in it is worse than no
       * sheet, because the hole is easy to miss. */
      report({ progress: 92, stage: "Saving angles" });
      const outDir = path.join(jobRunDir(job.id), "out");
      fs.mkdirSync(outDir, { recursive: true });
      const sheetDir = path.join(jobRunDir(job.id), "sheet");
      fs.mkdirSync(sheetDir, { recursive: true });

      const saved: string[] = [];
      COVERAGE_ANGLES.forEach((angle, i) => {
        const stem = coverageFileName(angle, i);
        const hit = files.find((f) => path.basename(f.filename).startsWith(stem));
        if (!hit) {
          throw new Error(
            `The coverage render came back without the ${angle.deg}° angle (${angle.id}). ` +
              "Nothing usable was produced — re-run it.",
          );
        }
        const dest = path.join(outDir, `${stem}.png`);
        fs.writeFileSync(dest, hit.data);
        // the sheet is built from a plain numbered sequence, which is the only
        // input shape ffmpeg's image2 demuxer will read in a guaranteed order
        fs.writeFileSync(path.join(sheetDir, `${String(i + 1).padStart(2, "0")}.png`), hit.data);
        saved.push(dest);
      });

      report({ progress: 96, stage: "Building the contact sheet" });
      const sheet = path.join(outDir, "sheet.png");
      await tileSheet(sheetDir, sheet);

      return {
        output: outDir,
        meta: {
          engine: "minimax-h3",
          mode: "coverage",
          tier: payload.tier,
          seed,
          angles: COVERAGE_ANGLES.length,
          source: payload.source,
          ...(payload.location ? { location: payload.location } : {}),
        },
      };
    })();

    return { done, cancel: () => ctrl.abort() };
  }
}

/** The 4×2 contact sheet.
 *
 * No labels burned into it: the cells are in orbit order, the files carry
 * their angle in the name, and the Angles tab draws the label under each one.
 * Text here would need a font path that is a per-machine question. */
function tileSheet(dir: string, out: string): Promise<void> {
  const rows = Math.ceil(COVERAGE_ANGLES.length / COVERAGE_SHEET_COLUMNS);
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      [
        "-y",
        "-framerate", "1",
        "-i", path.join(dir, "%02d.png"),
        "-vf", `scale=${SHEET_CELL_WIDTH}:-2,tile=${COVERAGE_SHEET_COLUMNS}x${rows}`,
        "-frames:v", "1",
        out,
      ],
      (err) => {
        // the angles themselves are already on disk and are the deliverable —
        // a missing sheet must not fail the pass
        if (err && !fs.existsSync(out)) {
          reject(new Error(`contact sheet failed — is ffmpeg on PATH? (${err.message})`));
          return;
        }
        resolve();
      },
    );
  });
}
