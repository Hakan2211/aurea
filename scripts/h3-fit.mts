/* Where does ONE pass stop fitting on this card?
 *
 * The chunk budget in minimax-graphs.ts is the number this answers. A 1-step
 * render still allocates the whole latent and the whole attention working set,
 * so it costs a minute rather than ten and still says whether the shape fits:
 * a length that fits scales its step time with frames, a length that doesn't
 * pages to system RAM and the step time jumps by an order of magnitude.
 *
 * Reports seconds-per-step per length, plus free VRAM before and after. */
import { ComfyClient } from "../packages/core/src/comfy/client.js";
import {
  MINIMAX_H3_MANAGED,
  MINIMAX_H3_W4A8,
  MINIMAX_TURBO,
  frameLength,
  minimaxH3Graph,
} from "../packages/core/src/comfy/minimax-graphs.js";

const URL = process.env.COMFY_URL ?? "http://127.0.0.1:8199";
const [W, H] = [Number(process.env.W ?? 1344), Number(process.env.H ?? 768)];
/** W4A8=1 probes the 4-bit weight set instead of the GGUF one */
const W4A8 = process.env.W4A8 === "1";
const spec = MINIMAX_TURBO.draft.fl2v;

async function freeVram(): Promise<number> {
  const r = await fetch(`${URL}/system_stats`);
  const j = (await r.json()) as { devices: { vram_free: number }[] };
  return j.devices[0].vram_free / 1024 ** 3;
}

async function probe(sec: number) {
  const client = new ComfyClient(URL);
  await client.freeMemory();
  const frames = frameLength(sec);
  const graph = minimaxH3Graph({
    prompt: "A lone hiker on a windswept ridge at golden hour.\nAudio: wind.",
    durationSec: sec,
    width: W,
    height: H,
    seed: 1,
    sage: true,
    // one step: the allocation is the same, the wait is not
    steps: 1,
    turbo: { ...spec, lora: `minimax-h3-turbo-lora\\loras\\${spec.file}` },
    models: W4A8 ? { ...MINIMAX_H3_MANAGED, ...MINIMAX_H3_W4A8 } : MINIMAX_H3_MANAGED,
    filenamePrefix: `bench/fit-${sec}s`,
  });
  const t0 = Date.now();
  try {
    await client.run(graph, { timeoutMs: 45 * 60_000 });
    const total = (Date.now() - t0) / 1000;
    console.log(
      `${String(sec).padStart(4)}s  ${String(frames).padStart(4)} frames  ` +
        `${total.toFixed(0)}s total  ${(total / frames).toFixed(2)} s/frame  ` +
        `free after ${(await freeVram()).toFixed(1)} GB`,
    );
  } catch (err) {
    console.log(
      `${String(sec).padStart(4)}s  ${String(frames).padStart(4)} frames  FAILED after ` +
        `${((Date.now() - t0) / 1000).toFixed(0)}s — ${(err as Error).message.slice(0, 200)}`,
    );
  }
}

async function main() {
  console.log(
    `${W}x${H}, 1 step, sage on, ${W4A8 ? "w4a8" : "GGUF"} — ` +
      `free VRAM ${(await freeVram()).toFixed(1)} GB`,
  );
  for (const sec of process.argv.slice(2).map(Number)) await probe(sec);
}
void main();
