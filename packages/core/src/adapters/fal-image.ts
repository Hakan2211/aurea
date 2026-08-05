/* fal.ai image adapter — the remote-API escape hatch for stills, and the only
 * path in Aurea that takes more than three reference images.
 *
 * Local qwen-edit tops out at 3 refs because ComfyUI's
 * TextEncodeQwenImageEditPlus only declares image1..image3. GPT Image 2 on
 * fal accepts 16, so a whole cast sheet plus a location plate plus style
 * frames can go into one edit instead of being triaged down to three.
 *
 * Runs on the cpu lane (the render happens in fal's cloud, not on this GPU).
 * References upload inline as data URIs and the finished PNGs land in the
 * job's scratch dir with the same names the local adapter uses, so
 * importOutput can't tell the difference.
 *
 * Paid per image — every code path that can spend money reports the estimate
 * first, same contract as the Seedance video adapter. */

import fs from "node:fs";
import path from "node:path";
import { falImageEstimate, falSizeError, type ImageAspect, type Job } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import { jobRunDir } from "./proc.js";
import type { JobResources } from "../scheduler.js";
import type { AdapterProgress, AdapterRun, EngineAdapter } from "./types.js";

const POLL_MS = 2_000;

/** fal's queue rejects anything past this; the catalog surfaces it as refsMax */
export const GPT_IMAGE_2_MAX_REFS = 16;

export interface FalImageModel {
  /** fal endpoint for a reference-driven edit — also the queue URL path */
  path: string;
  /** fal endpoint for plain text-to-image, when the run carries no
   * references. Same model, different route: the edit endpoint requires a
   * non-empty image_urls, so a prompt-only run has to go here. */
  generatePath?: string;
  label: string;
  /** hard ceiling on image_urls for this endpoint */
  refsMax: number;
  /** max num_images per request */
  countMax: number;
  /** does the endpoint accept a mask_url for inpainting? */
  mask: boolean;
}

export const FAL_IMAGE_MODELS: Record<string, FalImageModel> = {
  "gpt-image-2": {
    path: "openai/gpt-image-2/edit",
    generatePath: "openai/gpt-image-2",
    label: "GPT Image 2",
    refsMax: GPT_IMAGE_2_MAX_REFS,
    countMax: 4,
    mask: true,
  },
};


export const isFalImageModel = (model: string): boolean => model in FAL_IMAGE_MODELS;

/** aspect → the closest fal image_size preset. gpt-image-2 also takes an
 * explicit {width,height}, which is what the lab sends whenever the user has
 * set one; these presets only carry the plain aspect case. */
const ASPECT_PRESET: Record<ImageAspect, string> = {
  "1:1": "square_hd",
  "3:2": "landscape_4_3",
  "16:9": "landscape_16_9",
  "4:3": "landscape_4_3",
  "9:16": "portrait_16_9",
};

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const EXT: Record<string, string> = { png: ".png", jpeg: ".jpg", webp: ".webp" };

interface QueueSubmit {
  request_id: string;
  status_url?: string;
  response_url?: string;
  cancel_url?: string;
}

export class FalImageAdapter implements EngineAdapter {
  id = "fal-image";

  constructor(
    private settings: SettingsStore,
    /** override in tests to point at a mock queue */
    private baseUrl = "https://queue.fal.run",
  ) {}

  canRun(job: Job): boolean {
    return job.payload?.type === "image" && isFalImageModel(job.payload.model);
  }

  resources(job: Job): JobResources {
    void job;
    return { klass: "cpu" }; // remote render — no local GPU involved
  }

  /** dataRoot-relative path → data URI, the form fal accepts inline */
  private dataUri(rel: string, what: string): string {
    const abs = path.join(this.settings.get().storage.dataRoot, rel);
    if (!fs.existsSync(abs)) throw new Error(`${what} not found: ${rel}`);
    const mime = MIME[path.extname(abs).toLowerCase()];
    if (!mime) throw new Error(`${what} must be png/jpg/webp: ${rel}`);
    return `data:${mime};base64,${fs.readFileSync(abs).toString("base64")}`;
  }

  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun {
    let canceled = false;
    let cancelUrl: string | null = null;
    const key = this.settings.get().providers.falApiKey;
    const headers = { authorization: `Key ${key}`, "content-type": "application/json" };

    const done = (async () => {
      const payload = job.payload;
      if (payload?.type !== "image") throw new Error("not an image job");
      const model = FAL_IMAGE_MODELS[payload.model];
      if (!model) throw new Error(`unknown fal image model: ${payload.model}`);
      if (!key) {
        throw new Error(`${model.label} needs a fal.ai API key — Settings → AI Providers`);
      }
      // no references → the plain text-to-image route (the edit endpoint
      // requires a non-empty image_urls and would 422 on a prompt-only run)
      const t2i = payload.refs.length === 0;
      if (t2i && !model.generatePath) {
        throw new Error(`${model.label} is an edit model — add at least one reference image`);
      }
      const endpoint = t2i ? model.generatePath! : model.path;
      if (payload.refs.length > model.refsMax) {
        throw new Error(
          `${model.label} takes at most ${model.refsMax} reference images, got ${payload.refs.length}`,
        );
      }
      if (payload.mask && !model.mask) {
        throw new Error(`${model.label} does not support an inpainting mask`);
      }
      if (payload.mask && t2i) {
        // a mask marks a region of an existing picture — with nothing to edit
        // it would be silently dropped, so say so instead
        throw new Error("A mask needs a reference image to edit — add one, or clear the mask");
      }

      if (!t2i) report({ progress: 2, stage: "Encoding references" });
      const imageUrls = payload.refs.map((r) => this.dataUri(r, "reference image"));
      const maskUrl = payload.mask ? this.dataUri(payload.mask, "mask image") : undefined;

      const fold = (p: string) =>
        payload.preset ? `${p}, ${payload.preset.toLowerCase()} style` : p;
      const count = Math.min(payload.count, model.countMax);
      const quality = payload.quality ?? "high";
      const format = payload.outputFormat ?? "png";
      // "auto" tells the model to match the references, which is the right
      // default for an edit; otherwise an explicit size wins over the aspect
      const explicit = payload.width && payload.height;
      if (explicit) {
        // fail here rather than after uploading every reference, and say which
        // rule was broken — fal's own answer is a bare 422
        const bad = falSizeError(payload.width!, payload.height!);
        if (bad) throw new Error(`${model.label}: ${bad}`);
      }
      const imageSize =
        payload.sizeMode === "auto"
          ? "auto"
          : explicit
            ? { width: payload.width, height: payload.height }
            : ASPECT_PRESET[payload.aspect];
      const estimate = falImageEstimate(
        quality,
        count,
        explicit ? payload.width : undefined,
        explicit ? payload.height : undefined,
      );

      report({ progress: 5, stage: "Submitting to fal.ai", detail: `${quality} · ${estimate}` });
      const submit = await fetch(`${this.baseUrl}/${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          prompt: fold(payload.prompt),
          // the t2i endpoint has no image_urls/mask_url at all
          ...(t2i ? {} : { image_urls: imageUrls, ...(maskUrl ? { mask_url: maskUrl } : {}) }),
          quality,
          image_size: imageSize,
          num_images: count,
          output_format: format,
          ...(payload.seed !== undefined ? { seed: payload.seed } : {}),
        }),
      });
      if (!submit.ok) {
        const detail = await submit.text().catch(() => "");
        throw new Error(`fal.ai rejected the job (HTTP ${submit.status}) ${detail.slice(0, 200)}`);
      }
      const queued = (await submit.json()) as QueueSubmit;
      const base = `${this.baseUrl}/${endpoint}/requests/${queued.request_id}`;
      const statusUrl = queued.status_url ?? `${base}/status`;
      const responseUrl = queued.response_url ?? base;
      cancelUrl = queued.cancel_url ?? `${base}/cancel`;

      report({
        progress: 8,
        stage: "Rendering in the cloud",
        detail: [
          t2i ? "text to image" : `${payload.refs.length} ref${payload.refs.length === 1 ? "" : "s"}`,
          quality,
          estimate,
        ].join(" · "),
      });

      const started = Date.now();
      for (;;) {
        if (canceled) throw new Error("Canceled by user");
        await new Promise((r) => setTimeout(r, POLL_MS));
        const res = await fetch(statusUrl, { headers }).catch(() => null);
        if (!res) continue; // transient network blip — keep polling
        if (!res.ok) throw new Error(`fal.ai status check failed (HTTP ${res.status})`);
        const status = (await res.json()) as { status?: string };
        if (status.status === "COMPLETED") break;
        if (status.status === "FAILED" || status.status === "CANCELLED") {
          throw new Error(`fal.ai reports the render ${status.status?.toLowerCase()}`);
        }
        // the remote queue gives no step progress — creep on the expected wall
        // clock (~40s per high-quality image, less for the cheaper tiers)
        const expected = 40_000 * count * (quality === "low" ? 0.5 : 1);
        const pct = 8 + Math.min(84, ((Date.now() - started) / expected) * 84);
        report({
          progress: pct,
          stage: status.status === "IN_QUEUE" ? "Queued at fal.ai" : "Rendering in the cloud",
        });
      }

      report({ progress: 94, stage: "Fetching images" });
      const result = (await (await fetch(responseUrl, { headers })).json()) as {
        images?: { url?: string }[];
      };
      const images = (result.images ?? []).filter((i) => i.url);
      if (images.length === 0) throw new Error("fal.ai finished without any images");

      const outDir = path.join(jobRunDir(job.id), "out");
      fs.mkdirSync(outDir, { recursive: true });
      const ext = EXT[format] ?? ".png";
      const names: string[] = [];
      for (const [i, image] of images.entries()) {
        const bytes = await fetch(image.url!).then((r) => {
          if (!r.ok) throw new Error(`image download failed (HTTP ${r.status})`);
          return r.arrayBuffer();
        });
        // mirrors comfy-image.ts so importOutput treats both engines alike
        const file = images.length === 1 ? `image${ext}` : `image-${i + 1}${ext}`;
        fs.writeFileSync(path.join(outDir, file), Buffer.from(bytes));
        names.push(file);
      }

      // single image → file; batch → folder (importOutput handles both)
      return { output: names.length === 1 ? path.join(outDir, names[0]) : outDir };
    })();

    return {
      done,
      cancel: () => {
        canceled = true;
        if (cancelUrl) {
          void fetch(cancelUrl, { method: "PUT", headers }).catch(() => {});
        }
      },
    };
  }
}
