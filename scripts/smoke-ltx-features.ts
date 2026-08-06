/* Smoke matrix for the 2026-08 LTX feature work (end-frame guides, draft
 * mode, 48fps, the LoRA chain slot) against a LIVE external ComfyUI at :8000.
 * Run: npx tsx scripts/smoke-ltx-features.ts [case…]  (default: draft-end fps48)
 * Each case queues a short real render and reports the output's probed
 * fps/size so the 8n+1 and 64-grid math is verified on hardware, not in
 * unit tests alone. */

import fs from "node:fs";
import path from "node:path";
import { ComfyClient } from "../packages/core/src/comfy/client.js";
import { ltx23Graph, silentWav } from "../packages/core/src/comfy/video-graphs.js";

const URL = process.env.COMFY_URL ?? "http://127.0.0.1:8000";
const START = "C:/Users/User/Aurea/projects/playground/assets/image/a-golden-retriever-in-a-tiny-recording-stud.png";
const END = "C:/Users/User/Aurea/projects/playground/assets/image/a-golden-retriever-detective-in-a-film-noir.png";
const OUT_DIR = path.join(process.env.TEMP ?? ".", "aurea-smoke");

interface Case {
  name: string;
  fast: boolean;
  fps: number;
  durationSec: number;
  endFrame: boolean;
  width: number;
  height: number;
}

const CASES: Record<string, Case> = {
  // draft + end frame in one render: exercises the guide chain AND the
  // refine-stage deletion (draft decodes the CROPPED base latent)
  "draft-end": { name: "draft-end", fast: true, fps: 24, durationSec: 3, endFrame: true, width: 576, height: 1024 },
  // full two-stage with an end frame — the upsampler must read the crop
  "full-end": { name: "full-end", fast: false, fps: 24, durationSec: 4, endFrame: true, width: 576, height: 1024 },
  // 48fps draft — the frame-rate primitive must reach length AND mux fps
  fps48: { name: "fps48", fast: true, fps: 48, durationSec: 2, endFrame: false, width: 576, height: 1024 },
};

async function run(c: Case): Promise<void> {
  const client = new ComfyClient(URL);
  const tag = `smoke-${c.name}-${Date.now()}`;
  const imageName = await client.uploadInput(`${tag}-start.png`, fs.readFileSync(START));
  const silence = await client.uploadInput(`${tag}-silence.wav`, silentWav(c.durationSec));
  const endFrameName = c.endFrame
    ? await client.uploadInput(`${tag}-end.png`, fs.readFileSync(END))
    : undefined;

  const graph = ltx23Graph({
    prompt:
      "The golden retriever in the recording studio looks up from the microphone and smiles, " +
      "soft studio light, gentle handheld camera",
    imageName,
    durationSec: c.durationSec,
    width: c.width,
    height: c.height,
    seed: 424242,
    fps: c.fps,
    fast: c.fast,
    endFrameName,
    models: null, // external install: conventional names + enhance branch
  });
  (graph["276"].inputs as Record<string, unknown>).audio = silence;

  console.log(`\n=== ${c.name}: ${c.durationSec}s @${c.fps}fps ${c.width}x${c.height} fast=${c.fast} end=${c.endFrame}`);
  const t0 = Date.now();
  const files = await client.run(graph, {
    timeoutMs: 30 * 60_000,
    onNode: (ct) => process.stdout.write(`\r  node: ${ct.padEnd(40)}`),
    onProgress: (v, m) => process.stdout.write(`\r  progress: ${v}/${m}          `),
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const video = files.find((f) => /\.(mp4|webm|mov)$/i.test(f.filename));
  if (!video) throw new Error(`${c.name}: no video output`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `${c.name}${path.extname(video.filename)}`);
  fs.writeFileSync(out, video.data);
  console.log(`\n  DONE in ${secs}s → ${out} (${(video.data.length / 1e6).toFixed(1)} MB)`);
}

async function main(): Promise<void> {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : ["draft-end", "fps48"];
  for (const n of names) {
    const c = CASES[n];
    if (!c) throw new Error(`unknown case ${n} (have: ${Object.keys(CASES).join(", ")})`);
    await run(c);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
