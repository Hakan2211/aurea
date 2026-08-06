/* End-to-end check of MiniMax-H3's REFERENCE head (ref2va) against a live
 * ComfyUI 0.30.x, through Aurea's own graph builder and client.
 *
 *   npx tsx scripts/test-minimax-h3-ref.mts
 *
 * With no inputs it runs preflight only (nodes, weights, clip type) and stops
 * before spending a render — which is the point: the ref2va unet is a second
 * 15.6 GB file, and finding out it isn't visible AFTER 20 minutes of sampling
 * is the failure this script exists to prevent.
 *
 * Env:
 *   H3_URL      default http://127.0.0.1:8189
 *   H3_IMAGES   comma-separated image paths      → <Picture 1>, <Picture 2>, …
 *   H3_VIDEO    one video path                   → <Video 1>
 *   H3_VIDEO_AUDIO  "1" to reference its sound   → <Audio 1>, BEFORE <Video 1>
 *   H3_AUDIO    one audio path                   → the next <Audio n>
 *   H3_PROMPT   the shot; must name its tags
 *   H3_SEC / H3_W / H3_H / H3_STEPS / H3_OUT
 *
 * Start the engine first:
 *   D:\Comfy-Desktop\ComfyUI-Installs\ComfyUI-MiniMax\start-minimax.ps1
 */
import fs from "node:fs";
import path from "node:path";
import { minimaxRefLabels, minimaxRefsSchema, unknownMinimaxRefTags } from "../packages/shared/src/index.js";
import { ComfyClient } from "../packages/core/src/comfy/client.js";
import {
  MINIMAX_H3_MANAGED,
  MINIMAX_H3_REF_MANAGED,
  frameLength,
  minimaxH3RefGraph,
} from "../packages/core/src/comfy/minimax-graphs.js";

const URL = process.env.H3_URL ?? "http://127.0.0.1:8189";
const OUT = process.env.H3_OUT ?? "h3-ref-smoke";
const DURATION = Number(process.env.H3_SEC ?? 5);
const WIDTH = Number(process.env.H3_W ?? 768);
const HEIGHT = Number(process.env.H3_H ?? 448);
const STEPS = Number(process.env.H3_STEPS ?? 25);

const images = (process.env.H3_IMAGES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const video = process.env.H3_VIDEO?.trim();
const videoAudio = process.env.H3_VIDEO_AUDIO === "1";
const audio = process.env.H3_AUDIO?.trim();

const client = new ComfyClient(URL);

console.log(`[1] health @ ${URL}`);
if (!(await client.health(10_000))) throw new Error("ComfyUI not reachable");
console.log("    ok");

console.log("[2] required nodes");
for (const n of [
  "MiniMaxH3ReferenceToVideo",
  "LoadVideo",
  "GetVideoComponents",
  "LoadAudio",
  "UnetLoaderGGUF",
  "CLIPLoaderGGUF",
  "VAEDecodeAudio",
]) {
  const has = await client.hasNodes([n]);
  console.log(`    ${has ? "ok  " : "MISS"} ${n}`);
  if (!has) throw new Error(`missing node ${n}`);
}

console.log("[3] weights visible to this ComfyUI");
const unets = await client.comboOptions("UnetLoaderGGUF", "unet_name");
const clips = await client.comboOptions("CLIPLoaderGGUF", "clip_name");
const vaes = await client.comboOptions("VAELoader", "vae_name");
const want: [string, string[]][] = [
  // the ref2va head is the whole point — check it FIRST and by name
  [MINIMAX_H3_REF_MANAGED, unets],
  [MINIMAX_H3_MANAGED.textEncoder, clips],
  [MINIMAX_H3_MANAGED.videoVae, vaes],
  [MINIMAX_H3_MANAGED.audioVae, vaes],
];
for (const [name, list] of want) {
  const hit = list.includes(name);
  console.log(`    ${hit ? "ok  " : "MISS"} ${name}`);
  if (!hit) {
    const near = list.filter((o) => /minimax|ref2va|qwen3vl-32/i.test(o));
    console.log(`         candidates: ${near.join(", ") || "(none)"}`);
    throw new Error(`ComfyUI cannot see ${name}`);
  }
}

console.log("[4] clip types include 'minimax'");
const types = await client.comboOptions("CLIPLoaderGGUF", "type");
if (!types.includes("minimax")) throw new Error(`no minimax clip type; got ${types.join(",")}`);
console.log("    ok");

const refs = minimaxRefsSchema.parse({
  images: images.map((_, i) => `image-${i}`),
  videos: video ? [{ video, startSec: 0, lengthSec: 3, useItsAudio: videoAudio }] : [],
  audios: audio ? [audio] : [],
});
const labels = minimaxRefLabels(refs);
console.log(`[5] references: ${labels.all.join(" ") || "(none)"}`);
if (labels.all.length === 0) {
  console.log("    preflight only — set H3_IMAGES / H3_VIDEO / H3_AUDIO to render.");
  process.exit(0);
}

const prompt =
  process.env.H3_PROMPT ??
  `Cinematic medium shot. Keep ${labels.images[0] ?? labels.videos[0]?.video} exactly as it is.\n\n` +
    "Camera: slow push-in.\n\n" +
    "Audio: room tone and one line of dialogue in a warm, tired voice.";
const missing = unknownMinimaxRefTags(prompt, refs);
if (missing.length) throw new Error(`prompt names ${missing.join(", ")} — have ${labels.all.join(" ")}`);

console.log("[6] staging inputs");
const stage = async (file: string, tag: string) => {
  if (!fs.existsSync(file)) throw new Error(`not found: ${file}`);
  const name = await client.uploadInput(`h3ref-${tag}${path.extname(file)}`, fs.readFileSync(file));
  console.log(`    ${name}`);
  return name;
};
const refImageNames: string[] = [];
for (const [i, f] of images.entries()) refImageNames.push(await stage(f, `img${i}`));
const refVideos = video
  ? [{ file: await stage(video, "clip0"), withAudio: videoAudio }]
  : [];
const refAudioNames = audio ? [await stage(audio, "aud0")] : [];

const graph = minimaxH3RefGraph({
  prompt,
  refImageNames,
  refVideos,
  refAudioNames,
  refImageSize: "match",
  durationSec: DURATION,
  width: WIDTH,
  height: HEIGHT,
  seed: 424242,
  steps: STEPS,
  models: { ...MINIMAX_H3_MANAGED, refUnet: MINIMAX_H3_REF_MANAGED },
  filenamePrefix: "aurea/h3-ref-smoke",
});

console.log(
  `[7] queueing — ${frameLength(DURATION)} frames @24fps, ${WIDTH}x${HEIGHT}, ${STEPS} steps`,
);
const t0 = Date.now();
const mins = () => ((Date.now() - t0) / 60_000).toFixed(1);
let lastNode = "";
const files = await client.run(graph, {
  timeoutMs: 180 * 60_000,
  onNode: (c) => {
    if (c !== lastNode) {
      lastNode = c;
      console.log(`\n    [${mins()}m] ${c}`);
    }
  },
  onProgress: (v, m) => {
    if (m > 0) process.stdout.write(`\r    sampling ${v}/${m} (${mins()}m)   `);
  },
});
console.log(`\n[8] done in ${mins()} min`);

const out = files.find((f) => /\.(mp4|webm|mov)$/i.test(f.filename));
if (!out) throw new Error(`no video in outputs: ${files.map((f) => f.filename).join(", ")}`);
const dest = path.resolve(`${OUT}${path.extname(out.filename)}`);
fs.writeFileSync(dest, out.data);
console.log(`[9] wrote ${dest} (${(out.data.length / 1e6).toFixed(2)} MB)`);
console.log("    check it BOTH ways: does it hold the references, and does it have audio?");
