/* The image inbox (AUREA plan, Phase 2).
 *
 * Midjourney has no API, and GPT / Krea stills are made on their own sites,
 * so the way in is a folder: every project gets `<project>/inbox/`, and
 * anything image-shaped dropped there is imported into the project's library
 * (assets/image/imports, the same shelf Video lab's "import still" uses), so
 * it can be a start frame, an end frame, a keyframe or a reference at once.
 *
 * What makes it more than a copy is the provenance sidecar: which tool made
 * the picture (`importedFrom`) and, where the file still carries it, the
 * prompt. Midjourney embeds the prompt in the PNG's Description text chunk
 * and in its filename; ChatGPT downloads carry an OpenAI C2PA manifest but
 * no prompt; DALL·E-era names end in " - <prompt>". A prompt that came with
 * the picture is worth keeping — it is the obvious first draft of the motion
 * prompt that animates it.
 *
 * Polling, not fs.watch: Windows' watcher fires mid-write and twice per
 * save, and a browser download lands as a .crdownload that is renamed at the
 * end. A file is imported only once its size and mtime have held still
 * across two scans. Originals are moved to inbox/.done/ (a dot-folder, so
 * nothing else walks it); a file that cannot be read goes to inbox/.failed/
 * with a note beside it instead of being retried every five seconds. */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import type { AssetMeta } from "@aurea/shared";
import type { ProjectStore } from "./projects.js";

export type ImportedFrom = NonNullable<AssetMeta["importedFrom"]>;

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const SCAN_MS = 5_000;
/** a file younger than this is assumed to be still arriving */
const SETTLE_MS = 2_000;

/** Text chunks of a PNG (tEXt, zTXt, iTXt), keyed by keyword. Malformed
 * input yields what was readable before the damage — this is provenance, and
 * a picture with an odd chunk is still a picture. */
export function pngTextChunks(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return out;
  let at = 8;
  while (at + 12 <= buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString("latin1", at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (at + 12 + len > buf.length) break;
    try {
      if (type === "tEXt") {
        const nul = data.indexOf(0);
        if (nul > 0) out[data.toString("latin1", 0, nul)] = data.toString("latin1", nul + 1);
      } else if (type === "zTXt") {
        const nul = data.indexOf(0);
        if (nul > 0) out[data.toString("latin1", 0, nul)] = zlib.inflateSync(data.subarray(nul + 2)).toString("latin1");
      } else if (type === "iTXt") {
        // keyword \0 compressionFlag compressionMethod languageTag \0 translatedKeyword \0 text
        const k = data.indexOf(0);
        if (k > 0) {
          const compressed = data[k + 1] === 1;
          const lang = data.indexOf(0, k + 3);
          const trans = lang >= 0 ? data.indexOf(0, lang + 1) : -1;
          if (trans >= 0) {
            const body = data.subarray(trans + 1);
            out[data.toString("latin1", 0, k)] = (compressed ? zlib.inflateSync(body) : body).toString("utf8");
          }
        }
      } else if (type === "IEND") {
        break;
      }
    } catch {
      // one unreadable chunk does not void the rest
    }
    at += 12 + len;
  }
  return out;
}

const decodeXml = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");

/** dc:description out of an XMP packet anywhere in the file — the one place
 * a JPEG or WebP keeps a prompt, and Midjourney writes it there too */
export function xmpDescription(text: string): string | undefined {
  const li = /<dc:description>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/.exec(text);
  if (li?.[1]?.trim()) return decodeXml(li[1].trim());
  const attr = /\bdc:description="([^"]+)"/.exec(text);
  return attr?.[1]?.trim() ? decodeXml(attr[1].trim()) : undefined;
}

/** Midjourney appends its own bookkeeping to the description it embeds */
const cleanPrompt = (s: string) =>
  s
    .replace(/\s*Job ID:\s*[0-9a-f-]{36}\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

const UUID_TAIL = /_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_\d)?$/i;

/** Which tool made it, from the filename and whatever text the file carries.
 * Order matters: a Midjourney PNG re-saved through Photoshop still says
 * Midjourney in its metadata, so content beats a generic name. */
export function classifySource(fileName: string, metaText: string): ImportedFrom {
  const name = path.basename(fileName, path.extname(fileName));
  if (/midjourney/i.test(metaText) || UUID_TAIL.test(name)) return "midjourney";
  if (/openai|chatgpt|dall[·.\-\s]?e/i.test(metaText) || /^(chatgpt image|dall[·.\-\s]?e)/i.test(name)) return "gpt";
  if (/krea/i.test(metaText) || /krea/i.test(name)) return "krea";
  if (/comfyui|"class_type"/i.test(metaText) || /^(comfyui|aurea)[_-]/i.test(name)) return "local";
  return "other";
}

/** A prompt recovered from the filename, where the tool puts one there.
 * Midjourney: `<user>_<prompt words>_<uuid>[_<grid index>]`, cut at about
 * 60 characters. DALL·E: `DALL·E <timestamp> - <prompt>`. */
export function promptFromName(fileName: string, source: ImportedFrom): string | undefined {
  const name = path.basename(fileName, path.extname(fileName));
  if (source === "midjourney" && UUID_TAIL.test(name)) {
    const body = name.replace(UUID_TAIL, "");
    const words = body.split("_").slice(1).join(" ").trim();
    return words.length >= 3 ? words : undefined;
  }
  if (source === "gpt") {
    const m = /^dall[·.\-\s]?e.*? - (.+)$/i.exec(name);
    return m?.[1]?.trim() || undefined;
  }
  return undefined;
}

export interface InboxReading {
  importedFrom: ImportedFrom;
  prompt?: string;
  /** a readable title for lists — the slugged filename is not one */
  title: string;
}

/** Everything the sidecar should say about one dropped file. Pure, so the
 * classification is testable without a folder or ffmpeg. */
export function readInboxFile(fileName: string, bytes: Buffer): InboxReading {
  const chunks = pngTextChunks(bytes);
  // the whole file as latin1 catches XMP and C2PA labels in any container
  const raw = bytes.toString("latin1");
  const metaText = [...Object.entries(chunks).map(([k, v]) => `${k}: ${v}`), raw.slice(0, 400_000)].join("\n");
  const importedFrom = classifySource(fileName, metaText);
  const embedded =
    chunks.Description ??
    chunks.description ??
    (chunks.parameters && !chunks.parameters.startsWith("{") ? chunks.parameters.split("\nNegative prompt:")[0] : undefined) ??
    (chunks["XML:com.adobe.xmp"] ? xmpDescription(chunks["XML:com.adobe.xmp"]) : undefined) ??
    xmpDescription(raw);
  const prompt = (embedded && cleanPrompt(embedded)) || promptFromName(fileName, importedFrom);
  const base = path.basename(fileName, path.extname(fileName)).replace(UUID_TAIL, "");
  const title = (prompt ?? base.replace(/[_]+/g, " ")).slice(0, 80).trim() || "imported still";
  return { importedFrom, ...(prompt ? { prompt } : {}), title };
}

const toPng = (src: string, dest: string) =>
  new Promise<void>((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-y", "-loglevel", "error", "-i", src, "-frames:v", "1", dest],
      { windowsHide: true, maxBuffer: 8 << 20 },
      (err, _stdout, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve()),
    );
  });

/** move without clobbering: name, name-2, name-3… */
function moveAside(file: string, dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(file);
  const stem = path.basename(file, ext);
  let dest = path.join(dir, `${stem}${ext}`);
  for (let n = 2; fs.existsSync(dest); n++) dest = path.join(dir, `${stem}-${n}${ext}`);
  fs.renameSync(file, dest);
  return dest;
}

export interface InboxImport {
  project: string;
  relPath: string;
  importedFrom: ImportedFrom;
  prompt?: string;
}

export class InboxWatcher {
  private timer: NodeJS.Timeout | null = null;
  /** path → "size:mtime" seen on the previous scan */
  private seen = new Map<string, string>();
  private busy = false;
  /** the last few imports, newest first, for anyone who asks */
  readonly recent: InboxImport[] = [];

  constructor(private projects: ProjectStore) {}

  static dirFor(projects: ProjectStore, projectId: string): string {
    return path.join(projects.dir(projectId), "inbox");
  }

  start(): void {
    if (this.timer) return;
    // every project shows its inbox from the start, so there is a folder to drop into
    for (const p of this.projects.list()) {
      try {
        fs.mkdirSync(InboxWatcher.dirFor(this.projects, p.id), { recursive: true });
      } catch {
        // a read-only project is simply one without an inbox
      }
    }
    this.timer = setInterval(() => void this.scan(), SCAN_MS);
    this.timer.unref?.();
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** one pass over every project's inbox; exported for tests and for a
   * "check now" button */
  async scan(now = Date.now()): Promise<InboxImport[]> {
    if (this.busy) return [];
    this.busy = true;
    const done: InboxImport[] = [];
    try {
      for (const p of this.projects.list()) {
        const dir = InboxWatcher.dirFor(this.projects, p.id);
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isFile() || entry.name.startsWith(".")) continue;
          if (!IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) continue;
          const file = path.join(dir, entry.name);
          let st: fs.Stats;
          try {
            st = fs.statSync(file);
          } catch {
            continue;
          }
          const sig = `${st.size}:${st.mtimeMs}`;
          const settled = this.seen.get(file) === sig && now - st.mtimeMs >= SETTLE_MS && st.size > 0;
          this.seen.set(file, sig);
          if (!settled) continue;
          this.seen.delete(file);
          const result = await this.importOne(p.id, file);
          if (result) done.push(result);
        }
      }
    } finally {
      this.busy = false;
    }
    return done;
  }

  private async importOne(projectId: string, file: string): Promise<InboxImport | null> {
    const dir = path.dirname(file);
    try {
      const original = fs.readFileSync(file);
      const reading = readInboxFile(path.basename(file), original);
      let png = original;
      if (path.extname(file).toLowerCase() !== ".png") {
        const tmp = path.join(os.tmpdir(), `aurea-inbox-${process.pid}-${Date.now()}.png`);
        try {
          await toPng(file, tmp);
          png = fs.readFileSync(tmp);
        } finally {
          fs.rmSync(tmp, { force: true });
        }
      }
      const relPath = this.projects.importAsset(
        projectId,
        "image",
        path.basename(file, path.extname(file)).replace(UUID_TAIL, "").slice(0, 60) || "inbox-still",
        "png",
        png,
      );
      this.projects.patchMeta(relPath, {
        origin: "inbox",
        importedFrom: reading.importedFrom,
        title: reading.title,
        ...(reading.prompt ? { prompt: reading.prompt } : {}),
      });
      moveAside(file, path.join(dir, ".done"));
      const result: InboxImport = {
        project: projectId,
        relPath,
        importedFrom: reading.importedFrom,
        ...(reading.prompt ? { prompt: reading.prompt } : {}),
      };
      this.recent.unshift(result);
      this.recent.length = Math.min(this.recent.length, 50);
      return result;
    } catch (err) {
      try {
        const moved = moveAside(file, path.join(dir, ".failed"));
        fs.writeFileSync(`${moved}.txt`, `Aurea could not import this file:\n${String((err as Error).message)}\n`);
      } catch {
        // leave it where it is; the next scan will try again
      }
      return null;
    }
  }
}
