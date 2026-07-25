/* Image adapter — prompt → PNG(s) straight through the ComfyService (managed
 * sidecar or the external escape hatch). No python shim: the graph is built
 * in TS, progress streams over the ComfyUI websocket, and the PNGs land in
 * the job's scratch dir for importOutput to pull into the project. */

import fs from "node:fs";
import path from "node:path";
import type { ImageAspect, Job, JobPayload } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import type { ComfyService } from "../comfy/service.js";
import type { EngineRuntime } from "../runtime/runtime.js";
import type { ModelManager } from "../models/manager.js";
import { ComfyClient } from "../comfy/client.js";
import {
  esrganUpscaleGraph,
  krea2Graph,
  qwenEditGraph,
  zImageGraph,
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
  UpscaleModelLoader: "Loading upscaler",
  ImageUpscaleWithModel: "Upscaling",
  LoraLoaderModelOnly: "Loading upscale LoRA",
};

/** deck folder/file naming — mirrors projects.ts slugify */
const deckSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "deck";

/** lab model id → the registry entry holding its weights */
const WEIGHTS: Record<string, { id: string; label: string; gguf: boolean }> = {
  "z-image": { id: "z-image-turbo", label: "Z-Image Turbo", gguf: false },
  krea2: { id: "krea2-turbo-gguf", label: "Krea 2 Turbo (GGUF)", gguf: true },
  "qwen-edit": {
    id: "qwen-image-edit-2509-gguf",
    label: "Qwen Image Edit 2509 (GGUF)",
    gguf: true,
  },
};
const ESRGAN = { id: "realesrgan-x4plus", label: "Real-ESRGAN x4+" };
const UPSCALE2K = { id: "qwen-edit-upscale2k-lora", label: "Qwen Image Edit — Upscale2K LoRA" };

/** what the refine path tells the model to do — the LoRA card's own prompt */
const UPSCALE_PROMPT = "Upscale this picture to 4K resolution.";

/** Read pixel dimensions from a PNG/JPEG/WebP header. Enough to size the
 * refine latent from the source; anything unreadable falls back to a square. */
export function imageSize(file: string): { width: number; height: number } | null {
  const buf = Buffer.alloc(64 * 1024);
  const fd = fs.openSync(file, "r");
  let read: number;
  try {
    read = fs.readSync(fd, buf, 0, buf.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  const head = buf.subarray(0, read);
  // PNG: IHDR is always the first chunk, width/height at 16..24
  if (read > 24 && head.readUInt32BE(0) === 0x89504e47) {
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
  }
  // WebP (VP8X only carries canvas size directly; VP8/VP8L need their own parse)
  if (read > 30 && head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP") {
    if (head.toString("ascii", 12, 16) === "VP8X") {
      return {
        width: 1 + head.readUIntLE(24, 3),
        height: 1 + head.readUIntLE(27, 3),
      };
    }
  }
  // JPEG: walk the marker chain to the first SOFn frame header
  if (read > 4 && head[0] === 0xff && head[1] === 0xd8) {
    let i = 2;
    while (i + 9 < read) {
      if (head[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = head[i + 1];
      // SOF0..SOF15, skipping the non-frame markers in that range
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        // SOF payload is [precision, height, width] — height comes first
        return { width: head.readUInt16BE(i + 7), height: head.readUInt16BE(i + 5) };
      }
      i += 2 + head.readUInt16BE(i + 2);
    }
  }
  return null;
}

export class ComfyImageAdapter implements EngineAdapter {
  id = "comfy-image";

  constructor(
    private settings: SettingsStore,
    private comfy: ComfyService,
    private runtime: EngineRuntime,
    private models: ModelManager,
  ) {}

  canRun(job: Job): boolean {
    if (job.payload?.type === "image") {
      return (
        job.payload.model === "z-image" ||
        job.payload.model === "krea2" ||
        job.payload.model === "qwen-edit"
      );
    }
    // decks are t2i-only (ref decks are a later rung)
    if (job.payload?.type === "imageDeck") {
      return job.payload.model === "z-image" || job.payload.model === "krea2";
    }
    return job.payload?.type === "imageUpscale";
  }

  resources(job: Job): JobResources {
    // managed sidecar: ~14 GB with z-image loaded, ~18 GB for krea2's Q8 GGUF,
    // ~20 GB for qwen-edit's Q5 (text encoder offloads after conditioning);
    // when it's already warm the engineId lets the scheduler skip preflight.
    // External ComfyUI owns its own memory — no estimate.
    const managed = this.settings.get().engines.comfyMode === "managed";
    if (job.payload?.type === "imageUpscale") {
      // ESRGAN is a small conv net; refine loads the whole qwen-edit stack
      const vram = job.payload.mode === "refine" ? 20 : 3;
      return { klass: "gpu", engineId: "comfy", vramGb: managed ? vram : undefined };
    }
    const model =
      job.payload?.type === "image" || job.payload?.type === "imageDeck"
        ? job.payload.model
        : "z-image";
    const vram = model === "qwen-edit" ? 20 : model === "krea2" ? 18 : 14;
    return { klass: "gpu", engineId: "comfy", vramGb: managed ? vram : undefined };
  }

  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun {
    const ctrl = new AbortController();
    const managed = this.settings.get().engines.comfyMode === "managed";

    const done = (async () => {
      const payload = job.payload;
      if (payload?.type === "imageUpscale") {
        return this.upscale(job, payload, report, ctrl.signal, managed);
      }
      if (payload?.type !== "image" && payload?.type !== "imageDeck") {
        throw new Error("not an image job");
      }
      const weights = WEIGHTS[payload.model];
      if (weights && managed) this.requireWeights(weights);
      report({ progress: 1, stage: managed ? "Starting engine" : "Queuing on ComfyUI" });
      return this.comfy.run(async (url) => {
        const outDir = path.join(jobRunDir(job.id), "out");
        fs.mkdirSync(outDir, { recursive: true });
        const [width, height] =
          payload.width && payload.height
            ? [payload.width, payload.height]
            : ASPECT_SIZE[payload.aspect];
        const fold = (p: string) =>
          payload.preset ? `${p}, ${payload.preset.toLowerCase()} style` : p;
        const baseSeed = payload.seed ?? Math.floor(Math.random() * 1_000_000_000);
        const client = new ComfyClient(url);

        // qwen-edit: stage the reference images once, reused across the batch
        const refNames: string[] = [];
        if (payload.type === "image" && payload.model === "qwen-edit") {
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

        // unified render plan — lab batches repeat one prompt, decks fan out many;
        // zero-padding keeps deck files in render order on disk
        const plan =
          payload.type === "imageDeck"
            ? payload.prompts.map((p, i) => ({
                prompt: fold(p),
                file: `${deckSlug(payload.deckName)}-${String(i + 1).padStart(3, "0")}.png`,
              }))
            : Array.from({ length: payload.count }, (_, i) => ({
                prompt: fold(payload.prompt),
                file: payload.count === 1 ? "image.png" : `image-${i + 1}.png`,
              }));

        report({ progress: 3, stage: "Queuing on ComfyUI" });
        for (const [i, item] of plan.entries()) {
          if (ctrl.signal.aborted) throw new Error("Canceled by user");
          const spec: ImageGraphSpec = {
            prompt: item.prompt,
            width,
            height,
            seed: baseSeed + i,
            steps: payload.steps,
            cfg: payload.cfg,
          };
          const names = this.models.comfyNames(WEIGHTS[payload.model].id);
          const graph =
            payload.type === "image" && payload.model === "qwen-edit"
              ? qwenEditGraph(spec, names, refNames)
              : payload.model === "krea2"
                ? krea2Graph(spec, names)
                : zImageGraph(spec, names);

          // each image owns an equal slice of 5..95
          const lo = 5 + (i / plan.length) * 90;
          const hi = 5 + ((i + 1) / plan.length) * 90;
          const label = plan.length > 1 ? ` ${i + 1} of ${plan.length}` : "";
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

          fs.writeFileSync(path.join(outDir, item.file), images[0].data);
          report({ progress: hi });
        }

        // single image → file; batch/deck → folder (importOutput handles both)
        return {
          output: plan.length === 1 && plan[0].file === "image.png"
            ? path.join(outDir, "image.png")
            : outDir,
        };
      });
    })();

    return {
      done,
      cancel: () => ctrl.abort(),
    };
  }

  /** Managed-mode preflight for one registry model. "Ready" spans both a
   * copy we downloaded and one linked from the user's own library — the
   * distinction matters to the model manager, never to a graph. */
  private requireWeights(w: { id: string; label: string; gguf?: boolean }): void {
    if (w.gguf && !this.runtime.componentReady("gguf")) {
      throw new Error(
        `${w.label} needs the GGUF loader nodes — Settings → Engines → Install engine runtime`,
      );
    }
    if (!this.models.ready(w.id)) {
      throw new Error(
        `${w.label} is not installed — download it under Settings → Models, ` +
          "or point Aurea at a folder that already has it (Settings → Models → Linked folders)",
      );
    }
  }

  /** Enlarge one existing still. `fast` is a straight ESRGAN pass; `refine`
   * re-renders it through qwen-edit with the Upscale2K LoRA, which invents
   * detail rather than interpolating it. */
  private async upscale(
    job: Job,
    payload: Extract<JobPayload, { type: "imageUpscale" }>,
    report: (p: AdapterProgress) => void,
    signal: AbortSignal,
    managed: boolean,
  ): Promise<{ output: string }> {
    const { storage } = this.settings.get();
    const src = path.join(storage.dataRoot, payload.source);
    if (!fs.existsSync(src)) throw new Error(`image not found: ${payload.source}`);

    if (managed) {
      if (payload.mode === "fast") {
        this.requireWeights(ESRGAN);
      } else {
        this.requireWeights({ ...WEIGHTS["qwen-edit"] });
        this.requireWeights(UPSCALE2K);
      }
    }

    report({ progress: 1, stage: managed ? "Starting engine" : "Queuing on ComfyUI" });
    return this.comfy.run(async (url) => {
      const outDir = path.join(jobRunDir(job.id), "out");
      fs.mkdirSync(outDir, { recursive: true });
      const client = new ComfyClient(url);

      report({ progress: 4, stage: "Uploading source" });
      const staged = await client.uploadInput(
        `aurea-upscale-${path.basename(src)}`,
        fs.readFileSync(src),
      );

      let graph;
      if (payload.mode === "fast") {
        graph = esrganUpscaleGraph(staged, this.models.comfyFileName(ESRGAN.id));
      } else {
        // size the render from the source so the aspect survives the round trip
        const size = imageSize(src) ?? { width: 1024, height: 1024 };
        const scale = payload.targetLongEdge / Math.max(size.width, size.height);
        const snap = (v: number) => Math.min(4096, Math.max(512, Math.round((v * scale) / 16) * 16));
        const spec: ImageGraphSpec = {
          prompt: UPSCALE_PROMPT,
          width: snap(size.width),
          height: snap(size.height),
          seed: payload.seed ?? Math.floor(Math.random() * 1_000_000_000),
          // the LoRA card calls for 50 steps at cfg 4.0
          steps: payload.steps ?? 50,
          cfg: payload.cfg ?? 4.0,
        };
        graph = qwenEditGraph(spec, this.models.comfyNames(WEIGHTS["qwen-edit"].id), [staged], {
          name: this.models.comfyFileName(UPSCALE2K.id),
        });
      }

      report({ progress: 6, stage: "Queuing on ComfyUI" });
      const images = await client.run(graph, {
        signal,
        // refine is a full 50-step qwen-edit render at ~2K — it needs well past
        // the default 10-minute ceiling on a single consumer GPU
        timeoutMs: payload.mode === "refine" ? 40 * 60_000 : undefined,
        onNode: (classType) => {
          const stage = NODE_STAGE[classType];
          if (stage) report({ stage });
        },
        onProgress: (value, max) =>
          report({ progress: 6 + 88 * (max > 0 ? value / max : 0), stage: "Upscaling" }),
      });

      // "<name>-2x.png" — importJobOutput slugifies the job title onto it
      const out = path.join(outDir, "image.png");
      fs.writeFileSync(out, images[0].data);
      report({ progress: 96 });
      return { output: out };
    });
  }
}
