/* Library scanner — turns the on-disk project asset trees into the flat,
 * typed list the Asset Library screen renders. Scan-on-query: libraries are
 * small at this stage and the folder layout is the source of truth, so there
 * is no index to keep consistent. Kind comes from the assets/<kind>/ subfolder
 * when the file lives in one, else from the extension. */

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
