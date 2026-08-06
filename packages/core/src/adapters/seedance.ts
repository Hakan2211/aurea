/* Seedance adapter — the remote-API escape hatch for video (PRD P3): prompt
 * (and optionally a start frame) → video on ByteDance Seedance 2.0 through
 * fal.ai's queue API. Runs on the cpu lane (the render happens in fal's cloud,
 * not on this GPU); the start frame uploads inline as a data URI, the finished
 * mp4 downloads into the job's scratch dir like every local take.
 *
 * Paid per clip — the catalog and the job detail both carry the estimate, so
 * cost is on screen before anything is spent.
 *
 * --- why 2.0, and what it changed --------------------------------------------
 * v1 Pro took a prompt, a start frame, and a duration that had to be snapped to
 * 5s or 10s. 2.0 (fal, April 2026) takes any duration 4–15s exactly, adds 480p
 * and 4k tiers, an end frame, native audio, and a text-to-video endpoint — so
 * "no start frame" is a supported mode here rather than an error.
 *
 * It is also far more expensive: v1 was ~$0.05/s at 720p, 2.0 bills by pixel
 * volume and lands near $0.30/s at the same tier. That is a 6× jump, which is
 * exactly why the estimate below implements fal's real token formula per
 * resolution instead of carrying a flat per-second table that would understate
 * a 1080p or 4k clip by an order of magnitude. */

import fs from "node:fs";
import path from "node:path";
import type { Job } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import { jobRunDir } from "./proc.js";
import type { JobResources } from "../scheduler.js";
import type { AdapterProgress, AdapterRun, EngineAdapter } from "./types.js";

/** Seedance 2.0 on fal. The image endpoint also carries the end frame; the
 * text endpoint is what a shot with no start frame goes to. */
const MODEL_I2V = "bytedance/seedance-2.0/image-to-video";
const MODEL_T2V = "bytedance/seedance-2.0/text-to-video";
const POLL_MS = 3_000;

/** the pixel dimensions fal bills each tier at (its token formula is
 * height × width × duration × 24 / 1024) */
const TIER_PIXELS = {
  "480p": 854 * 480,
  "720p": 1280 * 720,
  "1080p": 1920 * 1080,
  "4k": 3840 * 2160,
} as const;
export type SeedanceTier = keyof typeof TIER_PIXELS;

/** fal's published token rates (USD per 1,000 tokens), 2026-08 */
const RATE_PER_KTOKEN: Record<SeedanceTier, number> = {
  "480p": 0.014,
  "720p": 0.014,
  "1080p": 0.014,
  "4k": 0.008,
};

/** which billing tier a lab resolution string falls in */
export function seedanceTier(resolution: string): SeedanceTier {
  if (/4k|2160|3840/i.test(resolution)) return "4k";
  if (resolution.includes("1080")) return "1080p";
  if (resolution.includes("480")) return "480p";
  return "720p";
}

export function seedanceCost(durationSec: number, resolution: string): number {
  const tier = seedanceTier(resolution);
  const tokens = (TIER_PIXELS[tier] * durationSec * 24) / 1024;
  return (tokens / 1000) * RATE_PER_KTOKEN[tier];
}

export function seedanceEstimate(durationSec: number, resolution: string): string {
  return `≈ $${seedanceCost(durationSec, resolution).toFixed(2)}`;
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

interface QueueSubmit {
  request_id: string;
  status_url?: string;
  response_url?: string;
  cancel_url?: string;
}

export class SeedanceAdapter implements EngineAdapter {
  id = "seedance";

  constructor(
    private settings: SettingsStore,
    /** override in tests to point at a mock queue */
    private baseUrl = "https://queue.fal.run",
  ) {}

  canRun(job: Job): boolean {
    return job.payload?.type === "video" && job.payload.engine === "seedance";
  }

  resources(job: Job): JobResources {
    void job;
    return { klass: "cpu" }; // remote render — no local GPU involved
  }

  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun {
    let canceled = false;
    let cancelUrl: string | null = null;
    const key = this.settings.get().providers.falApiKey;
    const headers = { authorization: `Key ${key}`, "content-type": "application/json" };

    const done = (async () => {
      const payload = job.payload;
      if (payload?.type !== "video") throw new Error("not a video job");
      if (!key) {
        throw new Error("Seedance needs a fal.ai API key — Settings → AI Providers");
      }
      if (payload.keyframes.length || payload.loras.length || payload.cameraLora) {
        throw new Error(
          "Keyframes and LoRA adapters are LTX-2.3 features — Seedance's API takes a " +
            "prompt, optional start/end frames, a duration and a resolution, nothing else.",
        );
      }
      if (payload.fps !== 24 || payload.fast) {
        throw new Error("48 fps and draft mode are LTX-2.3 options — Seedance renders 24 fps, full quality only.");
      }

      const dataRoot = this.settings.get().storage.dataRoot;
      /** read a frame as the data URI fal wants, or fail with which one broke */
      const asDataUri = (rel: string, which: string) => {
        const file = path.join(dataRoot, rel);
        if (!fs.existsSync(file)) throw new Error(`${which} not found: ${rel}`);
        const mime = MIME[path.extname(file).toLowerCase()];
        if (!mime) throw new Error(`Seedance ${which} must be png/jpg/webp`);
        return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
      };

      const imageUrl = payload.startFrame ? asDataUri(payload.startFrame, "start frame") : undefined;
      if (!imageUrl && payload.endFrame) {
        // the text endpoint has no end_image_url — an end frame without a start
        // one would be silently dropped, which is worse than refusing
        throw new Error(
          "An end frame needs a start frame on Seedance — add a start frame, or clear the end frame " +
            "to render from the prompt alone.",
        );
      }
      const endUrl = payload.endFrame ? asDataUri(payload.endFrame, "end frame") : undefined;

      const resolution = seedanceTier(payload.resolution);
      // 2.0 takes any whole second from 4 to 15 — clamp rather than snap, so the
      // duration the user picked is the duration they are billed for
      const duration = String(Math.min(15, Math.max(4, Math.round(payload.durationSec))));
      const modelPath = imageUrl ? MODEL_I2V : MODEL_T2V;

      report({ progress: 3, stage: "Submitting to fal.ai" });
      const submit = await fetch(`${this.baseUrl}/${modelPath}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          prompt: payload.prompt,
          ...(imageUrl ? { image_url: imageUrl } : {}),
          ...(endUrl ? { end_image_url: endUrl } : {}),
          resolution,
          duration,
        }),
      });
      if (!submit.ok) {
        const detail = await submit.text().catch(() => "");
        throw new Error(`fal.ai rejected the job (HTTP ${submit.status}) ${detail.slice(0, 200)}`);
      }
      const queued = (await submit.json()) as QueueSubmit;
      const statusUrl =
        queued.status_url ?? `${this.baseUrl}/${modelPath}/requests/${queued.request_id}/status`;
      const responseUrl =
        queued.response_url ?? `${this.baseUrl}/${modelPath}/requests/${queued.request_id}`;
      cancelUrl =
        queued.cancel_url ?? `${this.baseUrl}/${modelPath}/requests/${queued.request_id}/cancel`;
      report({
        progress: 8,
        stage: "Rendering in the cloud",
        detail: `${resolution} · ${duration}s · ${seedanceEstimate(Number(duration), resolution)}`,
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
        // remote queue gives no step progress — creep on the expected wall clock
        const pct = 8 + Math.min(84, ((Date.now() - started) / (150_000 * (Number(duration) / 5))) * 84);
        report({ progress: pct, stage: status.status === "IN_QUEUE" ? "Queued at fal.ai" : "Rendering in the cloud" });
      }

      report({ progress: 94, stage: "Fetching video" });
      const result = (await (await fetch(responseUrl, { headers })).json()) as {
        video?: { url?: string };
      };
      if (!result.video?.url) throw new Error("fal.ai finished without a video URL");
      const bytes = await fetch(result.video.url).then((r) => {
        if (!r.ok) throw new Error(`video download failed (HTTP ${r.status})`);
        return r.arrayBuffer();
      });
      const out = path.join(jobRunDir(job.id), "out", "take.mp4");
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, Buffer.from(bytes));
      return { output: out };
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
