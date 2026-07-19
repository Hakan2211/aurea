/* Image adapter — prompt → PNG(s) straight through the ComfyService (managed
 * sidecar or the external escape hatch). No python shim: the graph is built
 * in TS, progress streams over the ComfyUI websocket, and the PNGs land in
 * the job's scratch dir for importOutput to pull into the project. */

import fs from "node:fs";
import path from "node:path";
import type { ImageAspect, Job } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import type { ComfyService } from "../comfy/service.js";
import type { EngineRuntime } from "../runtime/runtime.js";
import type { ModelManager } from "../models/manager.js";
import { ComfyClient } from "../comfy/client.js";
import {
  krea2Graph,
  KREA2_EXTERNAL,
  KREA2_MANAGED,
  qwenEditGraph,
  QWENEDIT_EXTERNAL,
  QWENEDIT_MANAGED,
  zImageGraph,
  ZIMAGE_EXTERNAL,
  ZIMAGE_MANAGED,
  type ImageGraphSpec,
} from "../comfy/graphs.js";
import { jobRunDir } from "./proc.js";
import type { JobResources } from "../scheduler.js";
import type { AdapterProgress, AdapterRun, EngineAdapter } from "./types.js";

/** aspect → generation size (SDXL-class buckets both engines handle well) */
const ASPECT_SIZE: Record<ImageAspect, [number, number]> = {
  "1:1": [1024, 1024],
  "3:2": [1216, 832],
  "16:9": [1344, 768],
  "4:3": [1152, 896],
  "9:16": [768, 1344],
};

const NODE_STAGE: Record<string, string> = {
  UNETLoader: "Loading models",
  UnetLoaderGGUF: "Loading models",
  CLIPLoader: "Loading models",
  VAELoader: "Loading models",
  TextEncodeQwenImageEditPlus: "Encoding references",
  KSampler: "Sampling",
  VAEDecode: "Decoding",
};

/** managed-mode weight sets that ride on the GGUF loader custom node */
const GGUF_WEIGHTS: Record<string, { id: string; label: string }> = {
  krea2: { id: "krea2-turbo-gguf", label: "Krea 2 Turbo (GGUF)" },
  "qwen-edit": { id: "qwen-image-edit-2509-gguf", label: "Qwen Image Edit 2509 (GGUF)" },
};

export class ComfyImageAdapter implements EngineAdapter {
  id = "comfy-image";

  constructor(
    private settings: SettingsStore,
    private comfy: ComfyService,
    private runtime: EngineRuntime,
    private models: ModelManager,
  ) {}

  canRun(job: Job): boolean {
    return (
      job.payload?.type === "image" &&
      (job.payload.model === "z-image" ||
        job.payload.model === "krea2" ||
        job.payload.model === "qwen-edit")
    );
  }

  resources(job: Job): JobResources {
    // managed sidecar: ~14 GB with z-image loaded, ~18 GB for krea2's Q8 GGUF,
    // ~20 GB for qwen-edit's Q5 (text encoder offloads after conditioning);
    // when it's already warm the engineId lets the scheduler skip preflight.
    // External ComfyUI owns its own memory — no estimate.
    const managed = this.settings.get().engines.comfyMode === "managed";
    const model = job.payload?.type === "image" ? job.payload.model : "z-image";
    const vram = model === "qwen-edit" ? 20 : model === "krea2" ? 18 : 14;
    return { klass: "gpu", engineId: "comfy", vramGb: managed ? vram : undefined };
  }

  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun {
    const ctrl = new AbortController();
    const managed = this.settings.get().engines.comfyMode === "managed";

    const done = (async () => {
      const payload = job.payload;
      if (payload?.type !== "image") throw new Error("not an image job");
      const gguf = GGUF_WEIGHTS[payload.model];
      if (gguf && managed) {
        if (!this.runtime.componentReady("gguf")) {
          throw new Error(
            `${gguf.label} needs the GGUF loader nodes — Settings → Engines → Install engine runtime`,
          );
        }
        const weights = this.models.list().find((m) => m.id === gguf.id);
        if (weights?.status.state !== "installed") {
          throw new Error(
            `${gguf.label} weights are not installed — Settings → Models → ${gguf.label}`,
          );
        }
      }
      report({ progress: 1, stage: managed ? "Starting engine" : "Queuing on ComfyUI" });
      return this.comfy.run(async (url) => {
        const outDir = path.join(jobRunDir(job.id), "out");
        fs.mkdirSync(outDir, { recursive: true });
        const [width, height] = ASPECT_SIZE[payload.aspect];
        const prompt = payload.preset
          ? `${payload.prompt}, ${payload.preset.toLowerCase()} style`
          : payload.prompt;
        const baseSeed = payload.seed ?? Math.floor(Math.random() * 1_000_000_000);
        const client = new ComfyClient(url);

        // qwen-edit: stage the reference images once, reused across the batch
        const refNames: string[] = [];
        if (payload.model === "qwen-edit") {
          if (payload.refs.length === 0) {
            throw new Error("qwen-edit needs at least one reference image (character bible refs)");
          }
          report({ progress: 2, stage: "Uploading references" });
          const dataRoot = this.settings.get().storage.dataRoot;
          for (const [i, ref] of payload.refs.entries()) {
            const abs = path.join(dataRoot, ref);
            if (!fs.existsSync(abs)) throw new Error(`reference image not found: ${ref}`);
            refNames.push(
              await client.uploadInput(`aurea-ref${i + 1}-${path.basename(abs)}`, fs.readFileSync(abs)),
            );
          }
        }

        report({ progress: 3, stage: "Queuing on ComfyUI" });
        for (let i = 0; i < payload.count; i++) {
          if (ctrl.signal.aborted) throw new Error("Canceled by user");
          const spec: ImageGraphSpec = { prompt, width, height, seed: baseSeed + i };
          const graph =
            payload.model === "qwen-edit"
              ? qwenEditGraph(spec, managed ? QWENEDIT_MANAGED : QWENEDIT_EXTERNAL, refNames)
              : payload.model === "krea2"
                ? krea2Graph(spec, managed ? KREA2_MANAGED : KREA2_EXTERNAL)
                : zImageGraph(spec, managed ? ZIMAGE_MANAGED : ZIMAGE_EXTERNAL);

          // each image owns an equal slice of 5..95
          const lo = 5 + (i / payload.count) * 90;
          const hi = 5 + ((i + 1) / payload.count) * 90;
          const label = payload.count > 1 ? ` ${i + 1} of ${payload.count}` : "";
          const images = await client.run(graph, {
            signal: ctrl.signal,
            onNode: (classType) => {
              const stage = NODE_STAGE[classType];
              if (stage) report({ stage: `${stage}${label}` });
            },
            onProgress: (value, max) => {
              report({
                progress: lo + (hi - lo) * (max > 0 ? value / max : 0),
                stage: `Sampling${label}`,
              });
            },
          });

          const suffix = payload.count > 1 ? `-${i + 1}` : "";
          fs.writeFileSync(path.join(outDir, `image${suffix}.png`), images[0].data);
          report({ progress: hi });
        }

        // single image → file; batch → folder (importOutput handles both)
        return {
          output: payload.count === 1 ? path.join(outDir, "image.png") : outDir,
        };
      });
    })();

    return {
      done,
      cancel: () => ctrl.abort(),
    };
  }
}
