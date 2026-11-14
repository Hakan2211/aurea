/* Measure MiniMax-H3's render cost, one variable at a time.
 *
 * Every arm renders the same shape and seed — 1344x768, 4s (107 frames) — so
 * the numbers are comparable to each other and to the log. Arms are named on
 * the command line; SAGE=0 turns SageAttention off for all of them.
 *
 *   npx tsx scripts/h3-tiers.mts draft standard
 *   SAGE=0 npx tsx scripts/h3-tiers.mts old8
 *
 * Measured 2026-08-30 on a 3090 Ti, GGUF weights:
 *
 *   old8   no sage  454s   old8   sage  383s
 *   standard  sage  388s   draft  sage  270s
 *
 * Arms: old8 | draft | standard | final | draft-w4a8 | standard-w4a8.
 *
 * `old8` is the historical baseline and needs drbaph's ckpt850 LoRA, which the
 * registry no longer carries — it is kept here so the number above can be
 * reproduced, not because anything still renders on it. */
import { ComfyClient } from "../packages/core/src/comfy/client.js";
import {
  MINIMAX_H3_MANAGED,
  MINIMAX_H3_W4A8,
  MINIMAX_TURBO,
  frameLength,
  minimaxH3Graph,
  type MinimaxTurbo,
} from "../packages/core/src/comfy/minimax-graphs.js";

const URL = process.env.COMFY_URL ?? "http://127.0.0.1:8199";
const L = (f: string) => `minimax-h3-turbo-lora\\loras\\${f}`;

const PROMPT = [
  "A lone hiker stands on a windswept ridge at golden hour, looking out over a valley of low cloud.",
  "Camera: slow push in, handheld.",
  "Audio: wind across the ridge, distant birdsong.",
].join("\n");

const ARMS: Record<string, { turbo?: MinimaxTurbo; w4a8?: boolean }> = {
  /** the exact shape that took the driver down on 2026-08-30 */
  "crash-repro": { w4a8: true },
  old8: {
    turbo: {
      lora: L("minimax_h3_turbo_4step_ema_ckpt850_pruned_comfyui.safetensors"),
      steps: 8,
      strength: 1,
      shiftVideo: 12,
      shiftAudio: 6,
    },
  },
  draft: {
    turbo: { ...MINIMAX_TURBO.draft.fl2v, lora: L(MINIMAX_TURBO.draft.fl2v.file) },
  },
  standard: {
    turbo: { ...MINIMAX_TURBO.standard.fl2v, lora: L(MINIMAX_TURBO.standard.fl2v.file) },
  },
  final: {},
  "draft-w4a8": {
    turbo: { ...MINIMAX_TURBO.draft.fl2v, lora: L(MINIMAX_TURBO.draft.fl2v.file) },
    w4a8: true,
  },
  "standard-w4a8": {
    turbo: { ...MINIMAX_TURBO.standard.fl2v, lora: L(MINIMAX_TURBO.standard.fl2v.file) },
    w4a8: true,
  },
};

async function run(name: string) {
  const arm = ARMS[name];
  if (!arm) throw new Error(`unknown arm ${name} — have ${Object.keys(ARMS).join(", ")}`);
  const client = new ComfyClient(URL);
  await client.freeMemory();
  const graph = minimaxH3Graph({
    prompt: PROMPT,
    durationSec: Number(process.env.SEC ?? 4),
    width: Number(process.env.W ?? 1344),
    height: Number(process.env.H ?? 768),
    seed: 424242,
    sage: process.env.SAGE !== "0",
    evictEncoder: process.env.EVICT !== "0",
    turbo: arm.turbo,
    models: arm.w4a8 ? { ...MINIMAX_H3_MANAGED, ...MINIMAX_H3_W4A8 } : MINIMAX_H3_MANAGED,
    filenamePrefix: `bench/h3-${name}`,
  });
  const t0 = Date.now();
  const files = await client.run(graph, { timeoutMs: 90 * 60_000 });
  const total = (Date.now() - t0) / 1000;
  console.log(
    `${name.padEnd(14)} ${String(arm.turbo?.steps ?? 25).padStart(2)} steps  ` +
      `${total.toFixed(0)}s  ->  ${files.map((f) => f.filename).join(",")}`,
  );
}

async function main() {
  console.log(
    `1344x768 x ${frameLength(4)} frames, sage ${process.env.SAGE === "0" ? "off" : "on"}`,
  );
  for (const name of process.argv.slice(2)) await run(name);
}
void main();
