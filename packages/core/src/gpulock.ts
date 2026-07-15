/* Interop with videofast's <videofastDir>/batches/.gpu.lock — the legacy
 * CLI's one-batch-at-a-time guard (webapp/scripts/batch/run-batch.ts). Both
 * sides speak the same file: run-batch.ts refuses to start while the lock
 * names a live pid, and studiod's JobEngine holds back its queue for the same
 * reason. While studiod runs a lab job it takes the lock under its own pid so
 * a manually launched CLI batch refuses cleanly instead of colliding on the
 * GPU. Videofast-format jobs are the exception: the spawned run-batch.ts
 * acquires the lock itself, so studiod must not pre-hold it.
 *
 * Staleness matches the CLI exactly: pid liveness (signal-0 probe), no TTL.
 * The lock is advisory — if the file can't be written the queue keeps going. */

import fs from "node:fs";
import path from "node:path";

export interface GpuLockHolder {
  pid: number;
  batchId: string;
  startedAt: string;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class GpuLock {
  /** lock file path, resolved per call (null = no videofast dir configured) */
  constructor(private file: () => string | null) {}

  /** live holder that isn't this process — the only reason to hold the queue */
  heldByOther(): GpuLockHolder | null {
    const file = this.file();
    if (!file) return null;
    try {
      const held = JSON.parse(fs.readFileSync(file, "utf8")) as GpuLockHolder;
      if (typeof held?.pid !== "number" || held.pid === process.pid) return null;
      return pidAlive(held.pid) ? held : null;
    } catch {
      // missing or corrupt file — same takeover semantics as run-batch.ts
      return null;
    }
  }

  /** take the lock for a studiod-run job (overwrites stale/corrupt files) */
  acquire(batchId: string): void {
    const file = this.file();
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({ pid: process.pid, batchId, startedAt: new Date().toISOString() }, null, 2),
      );
    } catch {
      // advisory only
    }
  }

  /** remove the lock only if this process holds it */
  release(): void {
    const file = this.file();
    if (!file) return;
    try {
      const held = JSON.parse(fs.readFileSync(file, "utf8")) as GpuLockHolder;
      if (held?.pid === process.pid) fs.unlinkSync(file);
    } catch {
      // nothing to release
    }
  }
}
