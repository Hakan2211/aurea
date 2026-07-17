/* Seedance adapter — the remote-API escape hatch for video (PRD P3): image →
 * video on ByteDance Seedance 1.0 Pro through fal.ai's queue API. Runs on the
 * cpu lane (the render happens in fal's cloud, not on this GPU); the start
 * frame uploads inline as a data URI, the finished mp4 downloads into the
 * job's scratch dir like every local take.
 *
 * Paid per clip — the catalog and the job detail both carry the estimate, so
 * cost is on screen before anything is spent. */

import fs from "node:fs";
import path from "node:path";
import type { Job } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import { jobRunDir } from "./proc.js";
import type { JobResources } from "../scheduler.js";
import type { AdapterProgress, AdapterRun, EngineAdapter } from "./types.js";

const MODEL_PATH = "fal-ai/bytedance/seedance/v1/pro/image-to-video";
const POLL_MS = 3_000;

/** indicative fal.ai pricing (USD/second of output) — shown as "≈" everywhere */
export const SEEDANCE_RATE = { "720p": 0.05, "1080p": 0.15 } as const;

export function seedanceEstimate(durationSec: number, resolution: string): string {
  const tier = resolution.includes("1080") ? "1080p" : "720p";
  return `≈ $${(SEEDANCE_RATE[tier] * durationSec).toFixed(2)}`;
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
      if (!payload.startFrame) {
        throw new Error("Seedance needs a start frame — generate or pick an image first");
      }
      const image = path.join(this.settings.get().storage.dataRoot, payload.startFrame);
      if (!fs.existsSync(image)) throw new Error(`start frame not found: ${payload.startFrame}`);
      const mime = MIME[path.extname(image).toLowerCase()];
      if (!mime) throw new Error("Seedance start frame must be png/jpg/webp");

      const resolution = payload.resolution.includes("1080") ? "1080p" : "720p";
      // Seedance renders 5s or 10s clips — snap to the nearest tier
      const duration = payload.durationSec > 7 ? "10" : "5";

      report({ progress: 3, stage: "Submitting to fal.ai" });
      const submit = await fetch(`${this.baseUrl}/${MODEL_PATH}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          prompt: payload.prompt,
          image_url: `data:${mime};base64,${fs.readFileSync(image).toString("base64")}`,
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
        queued.status_url ?? `${this.baseUrl}/${MODEL_PATH}/requests/${queued.request_id}/status`;
      const responseUrl =
        queued.response_url ?? `${this.baseUrl}/${MODEL_PATH}/requests/${queued.request_id}`;
      cancelUrl =
        queued.cancel_url ?? `${this.baseUrl}/${MODEL_PATH}/requests/${queued.request_id}/cancel`;
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
