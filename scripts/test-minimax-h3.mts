/* End-to-end check of the MiniMax-H3 path against a live ComfyUI 0.30.x,
 * using Aurea's OWN graph builder and client so what's under test is the
 * shipped code rather than a hand copy of it.
 *
 *   npx tsx scripts/test-minimax-h3.mts
 *
 * Env: H3_URL (default http://127.0.0.1:8189), H3_SEC, H3_W, H3_H, H3_STEPS,
 * H3_OUT. Start the engine first:
 *   D:\Comfy-Desktop\ComfyUI-Installs\ComfyUI-MiniMax\start-minimax.ps1
 */
import fs from "node:fs";
import path from "node:path";
import { ComfyClient } from "../packages/core/src/comfy/client.js";
import {
  MINIMAX_H3_MANAGED,
  frameLength,
  minimaxH3Graph,
} from "../packages/core/src/comfy/minimax-graphs.js";

const URL = process.env.H3_URL ?? "http://127.0.0.1:8189";
const OUT = process.env.H3_OUT ?? "h3-smoke";
const DURATION = Number(process.env.H3_SEC ?? 4);
const WIDTH = Number(process.env.H3_W ?? 768);
const HEIGHT = Number(process.env.H3_H ?? 448);
const STEPS = Number(process.env.H3_STEPS ?? 25);

const client = new ComfyClient(URL);

console.log(`[1] health @ ${URL}`);
if (!(await client.health(10_000))) throw new Error("ComfyUI not reachable");
console.log("    ok");

console.log("[2] required nodes");
for (const n of ["MiniMaxH3ImageToVideo", "UnetLoaderGGUF", "CLIPLoaderGGUF", "VAEDecodeAudio"]) {
  const has = await client.hasNodes([n]);
  console.log(`    ${has ? "ok  " : "MISS"} ${n}`);
  if (!has) throw new Error(`missing node ${n}`);
}

console.log("[3] weights visible to this ComfyUI");
const unets = await client.comboOptions("UnetLoaderGGUF", "unet_name");
const clips = await client.comboOptions("CLIPLoaderGGUF", "clip_name");
const vaes = await client.comboOptions("VAELoader", "vae_name");
const want: [string, string[]][] = [
  [MINIMAX_H3_MANAGED.unet, unets],
  [MINIMAX_H3_MANAGED.textEncoder, clips],
  [MINIMAX_H3_MANAGED.videoVae, vaes],
  [MINIMAX_H3_MANAGED.audioVae, vaes],
];
for (const [name, list] of want) {
  const hit = list.includes(name);
  console.log(`    ${hit ? "ok  " : "MISS"} ${name}`);
  if (!hit) {
    const near = list.filter((o) => /minimax|qwen3vl-32/i.test(o));
    console.log(`         candidates: ${near.join(", ") || "(none)"}`);
    throw new Error(`ComfyUI cannot see ${name}`);
  }
}

console.log("[4] clip types include 'minimax'");
const types = await client.comboOptions("CLIPLoaderGGUF", "type");
if (!types.includes("minimax")) throw new Error(`no minimax clip type; got ${types.join(",")}`);
console.log("    ok");

const graph = minimaxH3Graph({
  prompt:
    "A ginger cat sits on a windowsill in warm afternoon light, tail flicking once.\n\n" +
    "Camera: static medium shot, no movement.\n\n" +
    "Audio: a single soft meow at 2s, quiet room tone, distant birdsong. No music.",
  durationSec: DURATION,
  width: WIDTH,
  height: HEIGHT,
  seed: 424242,
  steps: STEPS,
  models: MINIMAX_H3_MANAGED,
  filenamePrefix: "aurea/h3-smoke",
});

console.log(
  `[5] queueing — ${frameLength(DURATION)} frames @24fps, ${WIDTH}x${HEIGHT}, ${STEPS} steps`,
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
console.log(`\n[6] done in ${mins()} min`);

const video = files.find((f) => /\.(mp4|webm|mov)$/i.test(f.filename));
if (!video) throw new Error(`no video in outputs: ${files.map((f) => f.filename).join(", ")}`);
const out = path.resolve(`${OUT}${path.extname(video.filename)}`);
fs.writeFileSync(out, video.data);
console.log(`[7] wrote ${out} (${(video.data.length / 1e6).toFixed(2)} MB)`);
console.log("    ffprobe it — the point of H3 is that this file has an AUDIO stream.");
