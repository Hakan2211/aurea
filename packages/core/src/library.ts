/* Library scanner — turns the on-disk project asset trees into the flat,
 * typed list the Asset Library screen renders. Scan-on-query: libraries are
 * small at this stage and the folder layout is the source of truth, so there
 * is no index to keep consistent. Kind comes from the assets/<kind>/ subfolder
 * when the file lives in one, else from the extension. */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { assetMetaSchema, type AssetMeta, type LibraryAsset, type LibraryKind, type Project } from "@aurea/shared";
import { ASSET_KINDS, EXT_KIND, type ProjectStore } from "./projects.js";

const isKind = (dir: string): dir is LibraryKind =>
  (ASSET_KINDS as readonly string[]).includes(dir);

/** "/media/<relPath>" with each segment escaped — the HTTP route decodes it back */
const mediaUrl = (relPath: string) =>
  `/media/${relPath.split("/").map(encodeURIComponent).join("/")}`;

/** Resolve a dataRoot-relative path to a real file that is safe to delete —
 * i.e. one that actually lives under <dataRoot>/projects/. Returns null for
 * anything outside that subtree (settings, models, voices, symlink escapes)
 * or already gone. Symlinks are resolved before the containment check, so a
 * link planted inside a project can't reach out of it. */
function resolveDeletable(dataRoot: string, relPath: string): string | null {
  const projectsRoot = path.resolve(dataRoot, "projects");
  let file: string;
  try {
    file = fs.realpathSync(path.resolve(dataRoot, relPath));
  } catch {
    return null;
  }
  if (!file.startsWith(projectsRoot + path.sep)) return null;
  return fs.statSync(file).isFile() ? file : null;
}

/** Delete assets (and staged refs) from disk for good. Returns the paths that
 * actually went away — callers refetch the library rather than trusting a
 * count, so a path that was already gone is a no-op, not an error. Empty
 * folders left behind (a deck whose last image was deleted) are pruned up to,
 * but never including, the assets/<kind>/ shelf itself. */
export function removeAssets(dataRoot: string, relPaths: string[]): string[] {
  const removed: string[] = [];
  const dirs = new Set<string>();
  for (const rel of relPaths) {
    const file = resolveDeletable(dataRoot, rel);
    if (!file) continue;
    fs.unlinkSync(file);
    try {
      fs.unlinkSync(path.join(path.dirname(file), `.${path.basename(file)}.meta.json`));
    } catch {
      // no sidecar — most assets don't have one
    }
    removed.push(rel);
    dirs.add(path.dirname(file));
  }
  for (const dir of dirs) pruneEmpty(dataRoot, dir);
  return removed;
}

/** walk empty parents upward, stopping at assets/<kind>/ (or refs/) */
function pruneEmpty(dataRoot: string, dir: string): void {
  const projectsRoot = path.resolve(dataRoot, "projects");
  let cur = dir;
  for (let depth = 0; depth < 5; depth++) {
    const rel = path.relative(projectsRoot, cur).split(path.sep);
    // projects/<id>/assets/<kind> is rel.length 3 — never prune the shelf itself
    if (rel.length <= 3 || rel[0] === "..") return;
    if (fs.readdirSync(cur).length > 0) return;
    fs.rmdirSync(cur);
    cur = path.dirname(cur);
  }
}

export function scanLibrary(dataRoot: string, projects: ProjectStore): LibraryAsset[] {
  const assets: LibraryAsset[] = [];
  for (const project of projects.list()) {
    walk(path.join(projects.dir(project.id), "assets"), project, assets, dataRoot, 5);
  }
  return assets.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function walk(
  dir: string,
  project: Project,
  out: LibraryAsset[],
  dataRoot: string,
  depth: number,
): void {
  if (depth < 0 || !fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, project, out, dataRoot, depth - 1);
      continue;
    }
    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).slice(1).toLowerCase();
    const relPath = path.relative(dataRoot, full).split(path.sep).join("/");
    // assets/<kind>/… wins (lets music vs voice disambiguate); extension is the fallback
    const kindDir = relPath.split("/")[3];
    const kind = (kindDir && isKind(kindDir) ? kindDir : undefined) ?? EXT_KIND[ext];
    if (!kind) continue;

    const stat = fs.statSync(full);
    let meta: AssetMeta | undefined;
    try {
      meta = assetMetaSchema.parse(
        JSON.parse(fs.readFileSync(path.join(dir, `.${entry.name}.meta.json`), "utf8")),
      );
    } catch {
      // no or malformed sidecar — the asset stands on its own
    }
    out.push({
      id: relPath,
      kind,
      name: entry.name,
      project: project.id,
      projectName: project.name,
      relPath,
      url: mediaUrl(relPath),
      sizeBytes: stat.size,
      createdAt: (stat.birthtime.getTime() > 0 ? stat.birthtime : stat.mtime).toISOString(),
      ext,
      ...(meta ? { meta } : {}),
    });
  }
}

/* ---------- transcode ---------- */

/** what a `.wav` can be handed to you as, beyond itself */
const TRANSCODE: Record<string, { ext: string; args: string[] }> = {
  // -q:a 2 is LAME's VBR ~190kbps: transparent for a music bounce, and a
  // third the size of the wav, which is the reason to want an mp3 at all
  mp3: { ext: "mp3", args: ["-codec:a", "libmp3lame", "-q:a", "2"] },
};

/** Convert a library file into another format and return the dataRoot-relative
 * path of the result.
 *
 * The output lands in `<dataRoot>/exports/`, deliberately outside the
 * `projects/*\/assets` tree the scanner walks: an mp3 of a track you already
 * have is a copy for sending someone, not a second take, and filing it as an
 * asset would put a duplicate row in the Music lab under a track's own name.
 * It's a cache — a second request for the same file reuses it. */
export function transcodeAsset(
  dataRoot: string,
  relPath: string,
  format: string,
): Promise<string> {
  const spec = TRANSCODE[format];
  if (!spec) throw new Error(`unsupported format "${format}"`);
  const source = resolveDeletable(dataRoot, relPath);
  if (!source) throw new Error("file not found");

  const outDir = path.join(dataRoot, "exports");
  fs.mkdirSync(outDir, { recursive: true });
  const dest = path.join(outDir, `${path.basename(source, path.extname(source))}.${spec.ext}`);
  const rel = path.relative(dataRoot, dest).split(path.sep).join("/");

  // reuse unless the source has moved on since (a re-render under the same name)
  try {
    if (fs.statSync(dest).mtimeMs >= fs.statSync(source).mtimeMs) return Promise.resolve(rel);
  } catch {
    // not converted yet
  }

  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-y", "-i", source, ...spec.args, dest],
      (err, _out, stderr) => {
        if (err) {
          // the one failure worth naming: ffmpeg has to be on PATH, and on a
          // fresh machine it isn't — the message otherwise reads as ENOENT
          reject(
            new Error(
              (err as NodeJS.ErrnoException).code === "ENOENT"
                ? "ffmpeg not found on PATH — install it to export other formats"
                : stderr.trim() || err.message,
            ),
          );
          return;
        }
        resolve(rel);
      },
    );
  });
}
