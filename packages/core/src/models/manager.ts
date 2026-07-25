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
import type { ModelNames } from "../comfy/graphs.js";
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

  /* ---------- linked roots ----------
   *
   * A user who already runs ComfyUI owns most of these weights: the same
   * public files, from the same repos, often tens of gigabytes of them. Rather
   * than make them download a second copy, storage.modelRoots names folders in
   * conventional ComfyUI layout that we mount read-only (see
   * EngineRuntime.writeExtraModelPaths) and read as already-installed.
   *
   * The rules that keep this honest live in one place, here:
   *   - never checksum a linked file (it is not ours; a different but valid
   *     quantisation is the user's business, not an integrity failure)
   *   - never delete one (remove() refuses)
   *   - a managed copy always wins, so an explicit download stays authoritative
   */

  /** ComfyUI resolves these pairs to the same search path, and real installs
   * use them interchangeably — D:\models keeps GGUF diffusion weights under
   * unet/ while our registry names them diffusion_models/. */
  private static readonly CATEGORY_ALIASES: Record<string, string[]> = {
    diffusion_models: ["diffusion_models", "unet"],
    unet: ["unet", "diffusion_models"],
    text_encoders: ["text_encoders", "clip"],
    clip: ["clip", "text_encoders"],
  };

  /** Absolute path of a registry file inside a linked root, or null. Matching
   * is exact-by-filename: close-but-different quantisations are a deliberate
   * miss, because silently running weights the caller did not ask for is
   * worse than saying "not installed". */
  private linkedPath(file: ModelFile, roots: string[]): { root: string; file: string } | null {
    const [category, ...rest] = file.name.split("/");
    const base = rest.join("/") || category;
    const categories = ModelManager.CATEGORY_ALIASES[category] ?? [category];
    for (const root of roots) {
      for (const c of categories) {
        const candidate = path.join(root, c, base);
        try {
          if (fs.statSync(candidate).size > 0) return { root, file: candidate };
        } catch {
          /* not here */
        }
      }
    }
    return null;
  }

  /** The root satisfying every file of a model, or null if any file is
   * missing. Files may come from different roots; we report the first. */
  private linkedRoot(info: ModelInfo, roots = this.settings.get().storage.modelRoots): string | null {
    if (roots.length === 0) return null;
    let first: string | null = null;
    for (const file of info.files) {
      const found = this.linkedPath(file, roots);
      if (!found) return null;
      first ??= found.root;
    }
    return first;
  }

  /** Every registry model a given folder would satisfy — what the settings
   * screen and the first-run wizard show before the user commits to a root,
   * so "we found 6 models, 23 GB you don't need to download" is answerable
   * before anything is saved. */
  previewRoot(root: string): Array<{ id: string; name: string; sizeBytes: number }> {
    return this.registry
      .filter((info) => this.linkedRoot(info, [root]) !== null)
      .map((info) => ({ id: info.id, name: info.name, sizeBytes: info.sizeBytes }));
  }

  /** ComfyUI loader names for a model's files, keyed by graph slot.
   *
   * This replaces the old `managed ? X_MANAGED : X_EXTERNAL` binary, which
   * stopped describing reality the moment a managed engine could read a
   * conventionally-named linked file. The rule is about the *file*, not the
   * mode: a managed copy is addressed "<id>/<category>/<file>" (collision-proof
   * inside our own flat mount), anything else by its bare conventional name. */
  comfyNames(id: string): ModelNames {
    const info = this.require(id);
    // external ComfyUI has no managed store at all; linked roots mount under
    // their conventional names — both want the bare filename
    const bare = this.settings.get().engines.comfyMode === "external" || !this.managedPresent(info);
    const pick = (...categories: string[]): string => {
      const file = info.files.find((f) => categories.includes(f.name.split("/")[0]));
      if (!file) throw new Error(`${info.name} has no ${categories[0]} file in the registry`);
      const parts = file.name.split("/");
      return bare ? parts[parts.length - 1] : [id, ...parts].join(path.sep);
    };
    return {
      unet: pick("diffusion_models", "unet"),
      clip: pick("text_encoders", "clip"),
      vae: pick("vae"),
    };
  }

  /** Loader name for a single-file model (a LoRA, an upscaler). */
  comfyFileName(id: string): string {
    const info = this.require(id);
    const file = info.files[0];
    if (!file) throw new Error(`${info.name} has no files`);
    const parts = file.name.split("/");
    const bare =
      this.settings.get().engines.comfyMode === "external" || !this.managedPresent(info);
    return bare ? parts[parts.length - 1] : [id, ...parts].join(path.sep);
  }

  /** Is this model runnable at all — downloaded by us, or linked from a root
   * the user already owns? Adapters preflight on this, not on "installed". */
  ready(id: string): boolean {
    const info = this.registry.find((m) => m.id === id);
    if (!info) return false;
    const state = this.status(info).state;
    return state === "installed" || state === "linked";
  }

  /** Do WE have this model, as opposed to reading the user's copy? Callers
   * that build loader names need this: our own store is flat and addressed
   * "<id>/<category>/<file>", every other source keeps conventional names. */
  managedCopy(id: string): boolean {
    const info = this.registry.find((m) => m.id === id);
    return !!info && this.managedPresent(info);
  }

  private managedPresent(info: ModelInfo): boolean {
    return !!this.manifest.installed[info.id] && this.filesPresent(info);
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

  /** Delete a model's files (and any partials); the license acceptance stays.
   * Only ever touches OUR copy under <dataRoot>/models/<id>/ — a model
   * satisfied by a linked root has no files of ours to delete, and deleting
   * the user's own library is not something this app gets to do. */
  remove(id: string): ModelEntry {
    const info = this.require(id);
    if (!this.managedPresent(info) && this.linkedRoot(info)) {
      throw new Error(
        `"${info.name}" is linked from ${this.linkedRoot(info)} — it belongs to you, not to Aurea. ` +
          "Remove the folder under Settings → Models → Linked folders instead.",
      );
    }
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

  /** Re-evaluate every entry and push a snapshot — linking a root can flip
   * several models to "linked" at once, with nothing downloading to trigger
   * the usual publish. */
  refresh(): void {
    this.publish(true);
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
    const base = { bytesPerSec: null, file: null, error: null, licenseAccepted, linkedRoot: null };
    if (this.managedPresent(info)) {
      return { state: "installed", bytes: info.sizeBytes, progress: 100, ...base };
    }
    // a managed copy always wins; only look outward when we don't have one
    const linked = this.linkedRoot(info);
    if (linked) {
      return { state: "linked", bytes: info.sizeBytes, progress: 100, ...base, linkedRoot: linked };
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
      linkedRoot: null,
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
