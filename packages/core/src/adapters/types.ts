/* Engine adapter contract — how the JobEngine hands a job to something that
 * actually computes (videofast batch pipeline, ComfyUI sidecar, TTS venvs…).
 * The engine stays the single scheduler; adapters only execute the one job
 * they were started with and report progress back. */

import type { Job } from "@aurea/shared";

export interface AdapterProgress {
  /** 0–100; omit to keep the current value */
  progress?: number;
  stage?: string;
  detail?: string;
}

export interface AdapterRun {
  /** resolves when the job finished (output = delivered artifact path);
   * rejects with the failure reason */
  done: Promise<{ output?: string }>;
  /** best-effort: kill the underlying work (process tree, request, …) */
  cancel: () => void;
}

export interface EngineAdapter {
  id: string;
  canRun(job: Job): boolean;
  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun;
}
