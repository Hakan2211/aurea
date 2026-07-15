/* /media/<relPath> — streams library files to the renderer for thumbnails and
 * playback. <img>/<video> tags can't set headers, so the boot token rides in
 * the query string instead of the Authorization header; same trust boundary,
 * different carrier. Serving is strictly confined to files under dataRoot —
 * the resolved path must stay inside it, symlinks included. Range requests
 * are honoured so <video> can scrub. */

import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska",
  wav: "audio/wav", mp3: "audio/mpeg", flac: "audio/flac", ogg: "audio/ogg", m4a: "audio/mp4",
  glb: "model/gltf-binary", gltf: "model/gltf+json",
};

export function serveMedia(
  req: IncomingMessage,
  res: ServerResponse,
  dataRoot: string,
  token: string,
): void {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.searchParams.get("token") !== token) {
    res.writeHead(401).end();
    return;
  }

  const rel = decodeURIComponent(url.pathname.slice("/media/".length));
  const root = path.resolve(dataRoot);
  let file: string;
  try {
    file = fs.realpathSync(path.resolve(root, rel));
  } catch {
    res.writeHead(404).end();
    return;
  }
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }

  const stat = fs.statSync(file);
  if (!stat.isFile()) {
    res.writeHead(404).end();
    return;
  }

  const headers: Record<string, string | number> = {
    "content-type": MIME[path.extname(file).slice(1).toLowerCase()] ?? "application/octet-stream",
    "accept-ranges": "bytes",
    // imported assets never change in place (collision-suffixed names), so cache freely
    "cache-control": "private, max-age=3600",
  };

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  let start = 0;
  let end = stat.size - 1;
  if (range && (range[1] || range[2])) {
    start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
    end = range[1] && range[2] ? Math.min(Number(range[2]), end) : end;
    if (start > end || start >= stat.size) {
      res.writeHead(416, { "content-range": `bytes */${stat.size}` }).end();
      return;
    }
    headers["content-range"] = `bytes ${start}-${end}/${stat.size}`;
  }
  headers["content-length"] = end - start + 1;

  res.writeHead(range && (range[1] || range[2]) ? 206 : 200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(file, { start, end })
    .on("error", () => res.destroy())
    .pipe(res);
}
