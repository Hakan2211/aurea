/* ModelManager — installs the curated registry into <dataRoot>/models/<id>/.
 *
 * Downloads stream straight to <file>.part with an incremental sha256; a
 * cancel (or crash) keeps the .part, and the next download() resumes it with
 * an HTTP Range request after re-hashing the bytes already on disk. The
 * digest is compared against the publisher's sha256 before the .part is
 * renamed into place — a mismatch deletes the file and fails the install.
 *
 * License gates: models whose license is gated refuse to download until the
 * user accepts once; acceptances and completed installs are recorded in
 * <dataRoot>/models/manifest.json. */

import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { ModelEntry, ModelFile, ModelInfo, ModelStatus } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import { downloadFile } from "../runtime/download.js";
import { MODEL_REGISTRY } from "./registry.js";

interface Manifest {
  /** model ids whose gated license the user accepted */
  accepted: string[];
  /** model id -> ISO install time */
  installed: Record<string, string>;
}

interface ActiveDownload {
  ctrl: AbortController;
  status: ModelStatus;
}

const PUBLISH_MS = 400;
/** transfer-rate window */
const RATE_WINDOW_MS = 5_000;

export class ModelManager extends EventEmitter {
  private active = new Map<string, ActiveDownload>();
  /** sticky failure reasons until the next download attempt */
  private errors = new Map<string, string>();
  private manifest: Manifest;
  private lastPublish = 0;
  private publishTimer: NodeJS.Timeout | undefined;

  constructor(
    private settings: SettingsStore,
    private registry: ModelInfo[] = MODEL_REGISTRY,
  ) {
    super();
    this.manifest = this.loadManifest();
  }

  private dir(): string {
    return path.join(this.settings.get().storage.dataRoot, "models");
  }

  private manifestFile(): string {
    return path.join(this.dir(), "manifest.json");
  }

  list(): ModelEntry[] {
    return this.registry.map((info) => ({ ...info, status: this.status(info) }));
  }

  /** Start (or resume) installing a model. Returns the live entry. */
  download(id: string, acceptLicense = false): ModelEntry {
    const info = this.require(id);
    if (!this.active.has(id)) {
      if (info.license.gated && !this.manifest.accepted.includes(id)) {
        if (!acceptLicense) {
          throw new Error(`"${info.name}" requires accepting the ${info.license.name} first`);
        }
        this.manifest.accepted.push(id);
        this.saveManifest();
      }
      this.errors.delete(id);
      this.begin(info);
    }
    return { ...info, status: this.status(info) };
  }

  /** Stop an in-flight download. Partial files stay for a later resume. */
  cancel(id: string): ModelEntry {
    const info = this.require(id);
    this.active.get(id)?.ctrl.abort();
    return { ...info, status: this.status(info) };
  }

  /** Delete a model's files (and any partials); the license acceptance stays. */
  remove(id: string): ModelEntry {
    const info = this.require(id);
    this.active.get(id)?.ctrl.abort();
    fs.rmSync(path.join(this.dir(), id), { recursive: true, force: true });
    this.errors.delete(id);
    if (this.manifest.installed[id]) {
      delete this.manifest.installed[id];
      this.saveManifest();
    }
    this.publish(true);
    return { ...info, status: this.status(info) };
  }

  close(): void {
    for (const a of this.active.values()) a.ctrl.abort();
    clearTimeout(this.publishTimer);
    this.removeAllListeners();
  }

  /* ---------- status ---------- */

  private require(id: string): ModelInfo {
    const info = this.registry.find((m) => m.id === id);
    if (!info) throw new Error(`unknown model "${id}"`);
    return info;
  }

  private status(info: ModelInfo): ModelStatus {
    const live = this.active.get(info.id);
    if (live) return { ...live.status };
    const licenseAccepted = !info.license.gated || this.manifest.accepted.includes(info.id);
    const base = { bytesPerSec: null, file: null, error: null, licenseAccepted };
    if (this.manifest.installed[info.id] && this.filesPresent(info)) {
      return { state: "installed", bytes: info.sizeBytes, progress: 100, ...base };
    }
    const bytes = this.bytesOnDisk(info);
    const progress = info.sizeBytes ? Math.min(99, (bytes / info.sizeBytes) * 100) : 0;
    const error = this.errors.get(info.id) ?? null;
    return {
      state: error ? "error" : "absent",
      bytes,
      progress: Math.round(progress * 10) / 10,
      ...base,
      error,
    };
  }

  private filesPresent(info: ModelInfo): boolean {
    return info.files.every((f) => {
      try {
        const size = fs.statSync(path.join(this.dir(), info.id, f.name)).size;
        return f.mutable ? size > 0 : size === f.sizeBytes;
      } catch {
        return false;
      }
    });
  }

  private bytesOnDisk(info: ModelInfo): number {
    let total = 0;
    for (const f of info.files) {
      const target = path.join(this.dir(), info.id, f.name);
      try {
        total += fs.statSync(target).size;
        continue;
      } catch {
        /* no finished file — count the partial */
      }
      try {
        total += fs.statSync(`${target}.part`).size;
      } catch {
        /* nothing yet */
      }
    }
    return total;
  }

  /* ---------- download ---------- */

  private begin(info: ModelInfo): void {
    const ctrl = new AbortController();
    const resumed = this.bytesOnDisk(info);
    const status: ModelStatus = {
      state: "downloading",
      bytes: resumed,
      progress: info.sizeBytes ? Math.min(99, (resumed / info.sizeBytes) * 100) : 0,
      bytesPerSec: null,
      file: null,
      error: null,
      licenseAccepted: true,
    };
    this.active.set(info.id, { ctrl, status });
    void this.run(info, ctrl.signal, status)
      .then(() => {
        this.manifest.installed[info.id] = new Date().toISOString();
        this.saveManifest();
      })
      .catch((err: unknown) => {
        // cancel keeps partials silently; real failures stick until retried
        if (!ctrl.signal.aborted) {
          this.errors.set(info.id, err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        this.active.delete(info.id);
        this.publish(true);
      });
  }

  private async run(info: ModelInfo, signal: AbortSignal, status: ModelStatus): Promise<void> {
    let doneBytes = 0;
    const samples: Array<{ at: number; bytes: number }> = [];
    for (const file of info.files) {
      const target = path.join(this.dir(), info.id, file.name);
      try {
        const size = fs.statSync(target).size;
        // a mutable file the engine already rewrote must not be clobbered
        if (file.mutable ? size > 0 : size === file.sizeBytes) {
          doneBytes += file.sizeBytes;
          continue;
        }
      } catch {
        /* not downloaded yet */
      }
      status.file = file.name;
      const tick = (fileBytes: number) => {
        status.bytes = doneBytes + fileBytes;
        status.progress =
          Math.round(Math.min(99.9, (status.bytes / info.sizeBytes) * 100) * 10) / 10;
        const now = Date.now();
        samples.push({ at: now, bytes: status.bytes });
        while (samples.length > 2 && samples[0].at < now - RATE_WINDOW_MS) samples.shift();
        const span = samples[samples.length - 1].at - samples[0].at;
        if (span > 500) {
          status.bytesPerSec = Math.round(
            ((samples[samples.length - 1].bytes - samples[0].bytes) / span) * 1000,
          );
        }
        this.publish();
      };
      await this.fetchFile(file, target, signal, status, tick);
      doneBytes += file.sizeBytes;
    }
    status.state = "installed";
    status.progress = 100;
    status.bytes = info.sizeBytes;
    status.file = null;
    status.bytesPerSec = null;
  }

  private async fetchFile(
    file: ModelFile,
    target: string,
    signal: AbortSignal,
    status: ModelStatus,
    tick: (fileBytes: number) => void,
  ): Promise<void> {
    await downloadFile(
      { url: file.url, label: file.name, sizeBytes: file.sizeBytes, sha256: file.sha256 },
      target,
      signal,
      {
        onBytes: (n) => {
          status.state = "downloading";
          tick(n);
        },
        onVerifying: () => {
          status.state = "verifying";
          this.publish(true);
        },
      },
    );
    status.state = "downloading";
  }

  /* ---------- publish / manifest ---------- */

  /** stream a snapshot to subscribers, throttled during transfers */
  private publish(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastPublish < PUBLISH_MS) {
      // trailing edge so the last progress of a burst always lands
      this.publishTimer ??= setTimeout(() => {
        this.publishTimer = undefined;
        this.publish(true);
      }, PUBLISH_MS);
      this.publishTimer.unref();
      return;
    }
    this.lastPublish = now;
    this.emit("update", this.list());
  }

  private loadManifest(): Manifest {
    try {
      const raw = JSON.parse(fs.readFileSync(this.manifestFile(), "utf8")) as Manifest;
      return { accepted: raw.accepted ?? [], installed: raw.installed ?? {} };
    } catch {
      return { accepted: [], installed: {} };
    }
  }

  private saveManifest(): void {
    fs.mkdirSync(this.dir(), { recursive: true });
    const tmp = `${this.manifestFile()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.manifest, null, 2));
    fs.renameSync(tmp, this.manifestFile());
  }
}
