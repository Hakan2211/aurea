/* Resumable file download — the transfer core shared by the ModelManager
 * (weights) and the EngineRuntime (python/ComfyUI archives).
 *
 * Streams to <target>.part with an incremental sha256; a cancel or crash
 * keeps the .part and the next call resumes it with an HTTP Range request
 * after re-hashing the bytes already on disk. The digest is compared against
 * the expected sha256 (when known) before the .part is renamed into place.
 * A stall watchdog aborts transfers that deliver no bytes for STALL_MS. */

import { createHash, type Hash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/** abort a transfer that delivers no bytes for this long (first byte included) */
export const STALL_MS = Number(process.env.AUREA_MODEL_STALL_MS ?? 45_000);

export interface DownloadSpec {
  url: string;
  /** shown in error messages */
  label: string;
  /** expected byte count; null = unknown (no resume, no size check) */
  sizeBytes: number | null;
  /** hex sha256 of the complete file; null = install unverified */
  sha256: string | null;
}

export interface DownloadHooks {
  /** total bytes of this file present so far (resumed + wire) */
  onBytes?: (bytes: number) => void;
  /** a partial is being re-hashed before the transfer resumes */
  onVerifying?: () => void;
}

export async function downloadFile(
  spec: DownloadSpec,
  target: string,
  signal: AbortSignal,
  hooks: DownloadHooks = {},
): Promise<void> {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const part = `${target}.part`;
  let hash = createHash("sha256");
  let start = 0;

  // resume: bytes already on disk enter the digest before the wire bytes.
  // With an unknown size we can't trust a partial (the source may not honor
  // ranges byte-identically across builds) — start over instead.
  try {
    start = fs.statSync(part).size;
  } catch {
    /* fresh download */
  }
  if (spec.sizeBytes === null || start > spec.sizeBytes) {
    fs.rmSync(part, { force: true });
    start = 0;
  }
  if (start > 0) {
    hooks.onVerifying?.();
    await pipeline(fs.createReadStream(part), hashSink(hash), { signal });
  }

  if (spec.sizeBytes === null || start < spec.sizeBytes) {
    // stall watchdog: dead connections abort instead of hanging at 0 B/s
    const stall = new AbortController();
    const wire = AbortSignal.any([signal, stall.signal]);
    let watchdog = setTimeout(() => stall.abort(), STALL_MS);
    watchdog.unref();
    const alive = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => stall.abort(), STALL_MS);
      watchdog.unref();
    };
    try {
      const res = await fetch(spec.url, {
        signal: wire,
        headers: start > 0 ? { range: `bytes=${start}-` } : {},
        redirect: "follow",
      });
      if (start > 0 && res.status === 200) {
        // server ignored the range — restart from zero
        start = 0;
        hash = createHash("sha256");
        fs.rmSync(part, { force: true });
      }
      if (!res.ok || !res.body) {
        throw new Error(`${spec.label}: HTTP ${res.status}`);
      }
      let received = 0;
      const h = hash;
      const tap = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          alive();
          h.update(chunk);
          received += chunk.length;
          hooks.onBytes?.(start + received);
          cb(null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
        tap,
        fs.createWriteStream(part, { flags: start > 0 ? "a" : "w" }),
        { signal: wire },
      );
    } catch (err) {
      if (stall.signal.aborted && !signal.aborted) {
        throw new Error(
          `${spec.label}: no data for ${Math.round(STALL_MS / 1000)}s — check your connection and resume`,
        );
      }
      throw err;
    } finally {
      clearTimeout(watchdog);
    }
  }

  const size = fs.statSync(part).size;
  if (spec.sizeBytes !== null && size !== spec.sizeBytes) {
    throw new Error(`${spec.label}: expected ${spec.sizeBytes} bytes, got ${size}`);
  }
  const digest = hash.digest("hex");
  if (spec.sha256 && digest !== spec.sha256) {
    fs.rmSync(part, { force: true });
    throw new Error(`${spec.label}: sha256 mismatch — download corrupted, removed`);
  }
  fs.renameSync(part, target);
}

/** a Writable that only feeds the hash (resume pre-pass) */
function hashSink(hash: Hash): Transform {
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      cb();
    },
  });
}
