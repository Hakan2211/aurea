/* Library scanner — turns the on-disk project asset trees into the flat,
 * typed list the Asset Library screen renders. Scan-on-query: libraries are
 * small at this stage and the folder layout is the source of truth, so there
 * is no index to keep consistent. Kind comes from the assets/<kind>/ subfolder
 * when the file lives in one, else from the extension. */

import fs from "node:fs";
import path from "node:path";
import type { LibraryAsset, LibraryKind, Project } from "@aurea/shared";
import { ASSET_KINDS, EXT_KIND, type ProjectStore } from "./projects.js";

const isKind = (dir: string): dir is LibraryKind =>
  (ASSET_KINDS as readonly string[]).includes(dir);

/** "/media/<relPath>" with each segment escaped — the HTTP route decodes it back */
const mediaUrl = (relPath: string) =>
  `/media/${relPath.split("/").map(encodeURIComponent).join("/")}`;

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
    });
  }
}
