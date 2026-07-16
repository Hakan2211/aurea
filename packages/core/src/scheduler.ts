/* GpuScheduler — admission control for the JobEngine (PRD Part 2). The
 * scheduler, not the .gpu.lock file, is what serializes the GPU now: one
 * exclusive "gpu"-class job at a time, "cpu"-class jobs (API calls, ffmpeg,
 * Remotion renders) run concurrently beside it.
 *
 * Before an exclusive job starts, a VRAM preflight checks the adapter's
 * rough estimate against live nvidia-smi telemetry; if it doesn't fit, idle
 * warm engines (the managed ComfyUI sidecar) are evicted first, and the job
 * waits with a visible stage instead of OOMing. A job whose own engine is
 * already warm skips the preflight — the model being resident is exactly the
 * VRAM it needs.
 *
 * The legacy .gpu.lock survives only as migration interop with videofast's
 * CLI (gpulock.ts): a live foreign holder still parks the gpu lane, and the
 * lock is held as `aurea:<jobId>` while an exclusive job runs so a manually
 * launched run-batch.ts refuses cleanly. */

import type { Job } from "@aurea/shared";
import type { GpuLock } from "./gpulock.js";

export type ResourceClass = "gpu" | "cpu";

/** What a job occupies while it runs — declared by its adapter. */
export interface JobResources {
  /** "gpu" = exclusive lane (one at a time); "cpu" = concurrent lane */
  klass: ResourceClass;
  /** rough VRAM need in GB for preflight; omit to skip (external engines
   * manage their own memory) */
  vramGb?: number;
  /** warm engine that serves this job — skips preflight when resident,
   * never self-evicted */
  engineId?: string;
}

/** A resident engine process the scheduler may unload for VRAM headroom. */
export interface WarmEngine {
  id: string;
  /** currently resident (holding VRAM) */
  warm(): boolean;
  /** resident and safe to unload right now (not serving a job) */
  canEvict(): boolean;
  evict(): void;
}

export interface VramSource {
  /** free VRAM in GB, or null when telemetry isn't live */
  freeGb(): number | null;
}

export type Admission =
  | { ok: true }
  /** stage: user-facing reason shown on the blocked lane head; undefined =
   * ordinary queueing, nothing to explain */
  | { ok: false; stage?: string };

export interface GpuSchedulerOptions {
  /** legacy videofast CLI interop; omit when no videofast dir is configured */
  lock?: GpuLock;
  vram?: VramSource;
  engines?: WarmEngine[];
  /** concurrent cpu-lane slots (default 4) */
  cpuSlots?: number;
}

export class GpuScheduler {
  /** job id the .gpu.lock is currently held for */
  private holder: string | null = null;

  constructor(private opts: GpuSchedulerOptions = {}) {}

  /** May a queued job with these resources start, given what's running? */
  admit(res: JobResources, running: JobResources[]): Admission {
    if (res.klass === "cpu") {
      const slots = this.opts.cpuSlots ?? 4;
      return running.filter((r) => r.klass === "cpu").length < slots
        ? { ok: true }
        : { ok: false };
    }
    if (running.some((r) => r.klass === "gpu")) return { ok: false };
    const held = this.opts.lock?.heldByOther();
    if (held) {
      return {
        ok: false,
        stage: `Waiting for GPU — external batch ${held.batchId} (pid ${held.pid})`,
      };
    }
    return this.preflight(res);
  }

  /** Record an exclusive job actually starting: take the legacy lock so a
   * manual CLI batch refuses. Videofast jobs skip it — their spawned
   * run-batch.ts acquires the lock itself. */
  started(job: Job, res: JobResources): void {
    if (res.klass !== "gpu" || job.payload?.type === "videofast") return;
    this.opts.lock?.acquire(`aurea:${job.id}`);
    this.holder = job.id;
  }

  finished(job: Job): void {
    if (this.holder !== job.id) return;
    this.opts.lock?.release();
    this.holder = null;
  }

  close(): void {
    if (this.holder) {
      this.opts.lock?.release();
      this.holder = null;
    }
  }

  private preflight(res: JobResources): Admission {
    if (!res.vramGb) return { ok: true };
    const engines = this.opts.engines ?? [];
    // the job's own engine being resident IS the VRAM it needs
    if (res.engineId && engines.some((e) => e.id === res.engineId && e.warm())) {
      return { ok: true };
    }
    const free = this.opts.vram?.freeGb();
    if (free == null || free >= res.vramGb) return { ok: true };
    const evictable = engines.filter((e) => e.id !== res.engineId && e.canEvict());
    if (evictable.length > 0) {
      for (const e of evictable) e.evict();
      return {
        ok: false,
        stage: `Freeing VRAM — unloading idle ${evictable.map((e) => e.id).join(", ")}`,
      };
    }
    return {
      ok: false,
      stage: `Waiting for VRAM — needs ~${res.vramGb} GB, ${free.toFixed(1)} GB free (close other GPU apps)`,
    };
  }
}
