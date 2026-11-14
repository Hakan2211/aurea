import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import type { AssetMeta } from "@aurea/shared";
import { classifySource, InboxWatcher, pngTextChunks, promptFromName, readInboxFile, xmpDescription } from "./inbox.js";
import { ProjectStore } from "./projects.js";

/* ---- a real, minimal PNG with whatever text chunks a test wants ---- */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(text: Buffer[] = []): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const idat = zlib.deflateSync(Buffer.from([0, 200, 120, 40]));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...text,
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const tEXt = (k: string, v: string) => chunk("tEXt", Buffer.from(`${k}\0${v}`, "latin1"));
const iTXt = (k: string, v: string) =>
  chunk("iTXt", Buffer.concat([Buffer.from(`${k}\0\0\0\0\0`, "latin1"), Buffer.from(v, "utf8")]));

test("text chunks: tEXt, iTXt (utf-8) and zTXt all read back", () => {
  const z = chunk("zTXt", Buffer.concat([Buffer.from("Comment\0\0", "latin1"), zlib.deflateSync(Buffer.from("zipped"))]));
  const t = pngTextChunks(png([tEXt("Software", "x"), iTXt("Description", "café fox"), z]));
  assert.deepEqual(t, { Software: "x", Description: "café fox", Comment: "zipped" });
  assert.deepEqual(pngTextChunks(Buffer.from("not a png")), {});
});

test("a Midjourney download: source and prompt, with its Job ID trimmed", () => {
  const file = png([iTXt("Description", "a surreal pink flamingo in a library --ar 16:9 Job ID: 2b1f7a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b")]);
  const r = readInboxFile("hakan_a_surreal_pink_flamingo_2b1f7a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b.png", file);
  assert.equal(r.importedFrom, "midjourney");
  assert.equal(r.prompt, "a surreal pink flamingo in a library --ar 16:9");
});

test("Midjourney with no metadata still yields the filename's prompt words", () => {
  const name = "hakan_meerkat_reading_the_news_8f3e2c1a-0b1c-4d2e-9f3a-1b2c3d4e5f60_2.png";
  assert.equal(classifySource(name, ""), "midjourney");
  assert.equal(promptFromName(name, "midjourney"), "meerkat reading the news");
  assert.equal(readInboxFile(name, png()).prompt, "meerkat reading the news");
});

test("GPT, Krea, ComfyUI and an unknown file are told apart", () => {
  assert.equal(classifySource("ChatGPT Image Nov 10, 2026, 10_15_33 AM.png", ""), "gpt");
  assert.equal(classifySource("image.png", "c2pa ... OpenAI ... GPT-4o"), "gpt");
  assert.equal(promptFromName("DALL·E 2026-01-02 10.00.00 - a cat in a hat.webp", "gpt"), "a cat in a hat");
  assert.equal(classifySource("krea-2026-11-10.png", ""), "krea");
  assert.equal(classifySource("x.png", 'prompt: {"3":{"class_type":"KSampler"}}'), "local");
  assert.equal(classifySource("holiday.jpg", ""), "other");
});

test("ComfyUI's JSON prompt is not mistaken for a prose prompt", () => {
  const r = readInboxFile("ComfyUI_00012_.png", png([tEXt("prompt", '{"3":{"class_type":"KSampler"}}')]));
  assert.equal(r.importedFrom, "local");
  assert.equal(r.prompt, undefined);
});

test("XMP dc:description, both element and attribute forms", () => {
  assert.equal(
    xmpDescription('<dc:description><rdf:Alt><rdf:li xml:lang="x-default">a fox &amp; a hound</rdf:li></rdf:Alt></dc:description>'),
    "a fox & a hound",
  );
  assert.equal(xmpDescription('<rdf:Description dc:description="moon jelly"/>'), "moon jelly");
  assert.equal(xmpDescription("nothing here"), undefined);
});

test("the watcher imports a settled file once, writes provenance, and moves the original aside", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aurea-inbox-"));
  const projects = new ProjectStore({ get: () => ({ storage: { dataRoot } }) } as never);
  projects.create("Show");
  const inbox = new InboxWatcher(projects);
  const dir = InboxWatcher.dirFor(projects, "show");
  fs.mkdirSync(dir, { recursive: true });
  const name = "hakan_neon_owl_8f3e2c1a-0b1c-4d2e-9f3a-1b2c3d4e5f60.png";
  fs.writeFileSync(path.join(dir, name), png([iTXt("Description", "neon owl on a wire")]));
  const later = Date.now() + 10_000;

  // first sight only records the file — it might still be arriving
  assert.deepEqual(await inbox.scan(later), []);
  const [got] = await inbox.scan(later);
  assert.ok(got, "settled file was not imported");
  assert.equal(got.importedFrom, "midjourney");
  assert.match(got.relPath, /^projects\/show\/assets\/image\/imports\/.+\.png$/);

  const abs = path.join(dataRoot, got.relPath);
  const meta = JSON.parse(
    fs.readFileSync(path.join(path.dirname(abs), `.${path.basename(abs)}.meta.json`), "utf8"),
  ) as AssetMeta;
  assert.deepEqual(
    { origin: meta.origin, importedFrom: meta.importedFrom, prompt: meta.prompt },
    { origin: "inbox", importedFrom: "midjourney", prompt: "neon owl on a wire" },
  );
  assert.ok(!fs.existsSync(path.join(dir, name)), "original left in the inbox");
  assert.ok(fs.existsSync(path.join(dir, ".done", name)), "original not kept in .done");
  // nothing left to do on the next pass
  assert.deepEqual(await inbox.scan(later), []);
});

test("a file still being written is not imported", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aurea-inbox-"));
  const projects = new ProjectStore({ get: () => ({ storage: { dataRoot } }) } as never);
  projects.create("Show");
  const inbox = new InboxWatcher(projects);
  const dir = InboxWatcher.dirFor(projects, "show");
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, "a.png");
  fs.writeFileSync(f, png());
  const later = Date.now() + 10_000;
  await inbox.scan(later);
  fs.appendFileSync(f, Buffer.from("more bytes")); // size changed between scans
  assert.deepEqual(await inbox.scan(later), []);
});
