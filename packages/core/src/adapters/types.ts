/* Engine adapter contract — how the JobEngine hands a job to something that
 * actually computes (videofast batch pipeline, ComfyUI sidecar, TTS venvs…).
 * The engine stays the single scheduler; adapters only execute the one job
 * they were started with and report progress back. */

import type { AssetMeta, Job } from "@aurea/shared";
import type { JobResources } from "../scheduler.js";

/** A failure of the machinery around a render — the engine process died
 * mid-run, or nothing answered when the graph was queued — rather than of the
 * render itself. The JobEngine requeues a job ONCE on these: the graph was
 * fine, the engine wasn't, and in managed mode the next run respawns a dead
 * sidecar on its own (ComfyService.ensure health-checks before reuse). A
 * validation or execution error stays terminal — retrying those repeats the
 * failure at full render cost. */
export class InfrastructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InfrastructureError";
  }
}

export interface AdapterProgress {
  /** 0–100; omit to keep the current value */
  progress?: number;
  stage?: string;
  detail?: string;
}

export interface AdapterRun {
  /** resolves when the job finished (output = delivered artifact path);
   * rejects with the failure reason. `meta` is provenance only the engine
   * knows — what the model chose when the request left a field open (the
   * lyrics ACE-Step wrote for you) — and is merged into the asset's sidecar. */
  done: Promise<{ output?: string; meta?: AssetMeta }>;
  /** best-effort: kill the underlying work (process tree, request, …) */
  cancel: () => void;
}

export interface EngineAdapter {
  id: string;
  canRun(job: Job): boolean;
  /** what the job occupies while running (lane + VRAM estimate for the
   * scheduler's preflight); omitted = exclusive GPU, no preflight */
  resources?(job: Job): JobResources;
  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun;
}
