/* ProjectStore — real persisted projects (P0). Each project is a plain folder
 * under <dataRoot>/projects/<id>/ holding project.json plus an assets/ tree
 * with one subfolder per kind. The folder layout IS the database: the library
 * scanner and the media route read straight from disk, so anything the user
 * drops into a project folder by hand shows up in the app too.
 *
 * dataRoot comes from the settings store on every call — repointing storage
 * in Settings repoints the whole store, no restart needed. */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { assetMetaSchema, type AssetMeta, type Job, type LibraryKind, type Project } from "@aurea/shared";
import type { SettingsStore } from "./settings.js";

export const ASSET_KINDS = ["image", "video", "audio", "music", "model3d"] as const;

/** extension → library kind, shared by the scanner and the importer */
export const EXT_KIND: Record<string, LibraryKind> = {
  png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image",
  mp4: "video", webm: "video", mov: "video", mkv: "video",
  wav: "audio", mp3: "audio", flac: "audio", ogg: "audio", m4a: "audio",
  glb: "model3d", gltf: "model3d", obj: "model3d", fbx: "model3d",
};

/** what actually lives in project.json (meta is computed, never stored) */
const projectFileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string(),
});
type ProjectFile = z.infer<typeof projectFileSchema>;

const JOB_KIND_DIR: Record<Job["kind"], LibraryKind> = {
  video: "video",
  image: "image",
  tts: "audio",
  music: "music",
};

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "project";

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** provenance recorded next to an imported output — what the scanner can't
 * recover from the file alone (job history is capped, so it can't be asked) */
function assetMetaFor(job: Job): AssetMeta | null {
  const p = job.payload;
  if (!p) return null;
  switch (p.type) {
    case "imageUpscale":
      return { origin: p.type, source: p.source };
    case "music":
      return {
        origin: p.type,
        arrangement: p.arrangement,
        // words you wrote yourself are known without asking the engine; the
        // adapter fills these in when the model wrote them instead
        ...(p.arrangement === "vocals" && p.lyrics?.trim() ? { lyrics: p.lyrics.trim() } : {}),
        ...(p.bpm !== undefined ? { bpm: p.bpm } : {}),
        ...(p.keyscale ? { keyscale: p.keyscale } : {}),
      };
    case "voiceConvert":
      return { origin: p.type, source: p.source, ...(p.mode === "sing" ? { arrangement: "vocals" as const } : {}) };
    default:
      return null;
  }
}

/** files under dir, recursive, ignoring dotfiles; depth-capped for safety */
function countFiles(dir: string, depth = 5): number {
  if (depth < 0 || !fs.existsSync(dir)) return 0;
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) n += countFiles(path.join(dir, entry.name), depth - 1);
    else if (entry.isFile()) n += 1;
  }
  return n;
}

export class ProjectStore {
  constructor(private settings: SettingsStore) {}

  root(): string {
    return path.join(this.settings.get().storage.dataRoot, "projects");
  }

  dir(id: string): string {
    return path.join(this.root(), id);
  }

  list(): Project[] {
    const root = this.root();
    if (!fs.existsSync(root)) return [];
    const projects: Project[] = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = this.read(entry.name);
      if (!file) continue;
      const assets = countFiles(path.join(this.dir(file.id), "assets"));
      projects.push({
        ...file,
        meta:
          assets > 0
            ? `${assets} asset${assets === 1 ? "" : "s"} · ${fmtDay(file.createdAt)}`
            : `Empty · created ${fmtDay(file.createdAt)}`,
      });
    }
    return projects.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  create(name: string): Project {
    const base = slugify(name);
    let id = base;
    for (let n = 2; fs.existsSync(this.dir(id)); n++) id = `${base}-${n}`;
    for (const kind of ASSET_KINDS) {
      fs.mkdirSync(path.join(this.dir(id), "assets", kind), { recursive: true });
    }
    this.write({ id, name: name.trim(), createdAt: new Date().toISOString() });
    return this.list().find((p) => p.id === id)!;
  }

  rename(id: string, name: string): Project {
    const file = this.read(id);
    if (!file) throw new Error(`unknown project "${id}"`);
    this.write({ ...file, name: name.trim() });
    return this.list().find((p) => p.id === id)!;
  }

  /** first boot (or wiped dataRoot): make sure the switcher has something real */
  ensureDefault(): void {
    if (this.list().length === 0) this.create("Playground");
  }

  /** Copy a finished job's artifact into its project's assets tree. Adapters
   * may deliver a single file or a folder (videofast ships final.mp4 + cover
   * art + metadata); for a folder every top-level media file comes along and
   * the file matching the job's own kind is the primary output. Returns the
   * imported primary path, or undefined when the job isn't tied to a real
   * project (demo jobs carry display-only project strings). */
  importJobOutput(job: Job, meta?: AssetMeta): string | undefined {
    return this.importJobOutputDetailed(job, meta).primary;
  }

  /** Like importJobOutput, but also reports every file that landed matching
   * the job's own kind — the storyboard hook attaches all of a batch's
   * stills, not just the primary. */
  importJobOutputDetailed(job: Job, adapterMeta?: AssetMeta): { primary?: string; files: string[] } {
    if (!job.project || !job.output) return { files: [] };
    const id = job.project.replace(/^\//, "").split("/")[0];
    if (!this.read(id) || !fs.existsSync(job.output)) return { files: [] };

    const base = slugify(job.title || path.basename(job.output, path.extname(job.output)));
    if (fs.statSync(job.output).isFile()) {
      // the job kind decides the shelf (a music wav is music, not voice);
      // the extension only speaks for files the kind can't explain
      const dest = this.importFile(id, JOB_KIND_DIR[job.kind], job.output, base);
      this.writeMeta(dest, job, adapterMeta);
      return { primary: dest, files: [dest] };
    }

    // decks keep their render-order filenames together under assets/image/decks/<slug>/
    if (job.payload?.type === "imageDeck") {
      const sub = `decks/${slugify(job.payload.deckName)}`;
      const files: string[] = [];
      for (const entry of fs.readdirSync(job.output, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (!entry.isFile() || !entry.name.endsWith(".png")) continue;
        files.push(
          this.importFile(id, "image", path.join(job.output, entry.name), path.basename(entry.name, ".png"), sub),
        );
      }
      return { primary: files[0], files };
    }

    let primary: string | undefined;
    const files: string[] = [];
    for (const entry of fs.readdirSync(job.output, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).slice(1).toLowerCase();
      const kind = EXT_KIND[ext];
      if (!kind) continue;
      // "final.mp4" takes the job's name outright; side artifacts keep theirs as a suffix
      const name = entry.name.startsWith("final.")
        ? base
        : `${base}-${slugify(path.basename(entry.name, path.extname(entry.name)))}`;
      const dest = this.importFile(id, kind, path.join(job.output, entry.name), name);
      if (kind === JOB_KIND_DIR[job.kind]) {
        this.writeMeta(dest, job, adapterMeta);
        files.push(dest);
        if (!primary) primary = dest;
      }
    }
    return { primary, files };
  }

  /** Write in-memory bytes (renderer uploads: image refs, convert sources)
   * into the project's assets tree with the usual collision-numbering.
   * Returns the dataRoot-relative path — the shape job payload refs expect. */
  importBuffer(projectId: string, kind: LibraryKind, name: string, ext: string, data: Buffer): string {
    return this.writeInto(path.join(this.dir(projectId), "assets", kind), projectId, name, ext, data);
  }

  /** Stage a renderer upload that is an *input*, not a take — an Image-lab
   * reference, a voice-conversion source. These land in <project>/refs/, which
   * the library scanner deliberately does not walk: an uploaded reference is
   * not something the studio generated, and showing it in the asset roll made
   * "edit with refs" look like it instantly handed the picture back. */
  importRef(projectId: string, name: string, ext: string, data: Buffer): string {
    return this.writeInto(path.join(this.dir(projectId), "refs"), projectId, name, ext, data);
  }

  private writeInto(
    destDir: string,
    projectId: string,
    name: string,
    ext: string,
    data: Buffer,
  ): string {
    if (!this.read(projectId)) throw new Error(`unknown project "${projectId}"`);
    fs.mkdirSync(destDir, { recursive: true });
    const base = slugify(name);
    let dest = path.join(destDir, `${base}.${ext}`);
    for (let n = 2; fs.existsSync(dest); n++) dest = path.join(destDir, `${base}-${n}.${ext}`);
    fs.writeFileSync(dest, data);
    // forward slashes — matches the library scanner's rel-path convention
    return path.relative(this.settings.get().storage.dataRoot, dest).split(path.sep).join("/");
  }

  /** dotfile sidecar next to the imported output; the scanner reads it back
   * into LibraryAsset.meta and skips it as an asset (dotfiles are ignored) */
  private writeMeta(dest: string, job: Job, adapterMeta?: AssetMeta): void {
    const fromJob = assetMetaFor(job);
    // the adapter speaks last: it knows what the engine chose where the
    // request left a field open (the lyrics ACE-Step wrote for you)
    const meta = fromJob || adapterMeta ? { ...fromJob, ...adapterMeta } : null;
    if (!meta) return;
    // a re-voiced song is the same song — carry the words (and tempo, and key)
    // across the conversion rather than handing back a track with no lyrics
    if (meta.source) {
      const inherited = this.readMeta(meta.source);
      if (inherited) {
        meta.lyrics ??= inherited.lyrics;
        meta.prompt ??= inherited.prompt;
        meta.bpm ??= inherited.bpm;
        meta.keyscale ??= inherited.keyscale;
      }
    }
    try {
      fs.writeFileSync(
        path.join(path.dirname(dest), `.${path.basename(dest)}.meta.json`),
        JSON.stringify(meta),
      );
    } catch {
      // provenance is best-effort — the asset itself already landed
    }
  }

  /** read back a sidecar by dataRoot-relative path (the shape meta.source uses) */
  private readMeta(relPath: string): AssetMeta | undefined {
    try {
      const file = path.join(this.settings.get().storage.dataRoot, relPath);
      return assetMetaSchema.parse(
        JSON.parse(
          fs.readFileSync(
            path.join(path.dirname(file), `.${path.basename(file)}.meta.json`),
            "utf8",
          ),
        ),
      );
    } catch {
      return undefined;
    }
  }

  private importFile(
    projectId: string,
    kind: LibraryKind,
    source: string,
    base: string,
    subdir?: string,
  ): string {
    const destDir = path.join(this.dir(projectId), "assets", kind, ...(subdir ? [subdir] : []));
    fs.mkdirSync(destDir, { recursive: true });
    const ext = path.extname(source);
    let dest = path.join(destDir, `${base}${ext}`);
    for (let n = 2; fs.existsSync(dest); n++) dest = path.join(destDir, `${base}-${n}${ext}`);
    fs.copyFileSync(source, dest);
    return dest;
  }

  private read(id: string): ProjectFile | null {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(this.dir(id), "project.json"), "utf8"));
      return projectFileSchema.parse(raw);
    } catch {
      return null;
    }
  }

  private write(file: ProjectFile): void {
    const target = path.join(this.dir(file.id), "project.json");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(file, null, 2));
    fs.renameSync(tmp, target);
  }
}
