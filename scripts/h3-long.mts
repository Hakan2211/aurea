/* Render one shot past MiniMax-H3's own window, through the chunked sampler.
 *
 * The point is the handover, not the wall clock: does HREndlessSampler split
 * the latent, does Gemma plan between chunks, and does what comes out still
 * decode as one muxed A/V file. Gemma (~8 GB) downloads itself on first use.
 *
 * A chunked shot runs on the REFERENCE head and needs at least one still —
 * the continuation rides H3's reference channel, and the sampler rebuilds the
 * reference conditioning from the images it is handed for every chunk.
 *
 *   REF=<file already in ComfyUI's input dir> npx tsx scripts/h3-long.mts 20
 */
import { ComfyClient } from "../packages/core/src/comfy/client.js";
import {
  ENDLESS_CONTINUATION_FRAMES,
  MINIMAX_H3_MANAGED,
  MINIMAX_H3_REF_W4A8,
  MINIMAX_H3_W4A8,
  MINIMAX_TURBO,
  endlessChunkFrames,
  frameLength,
  minimaxH3RefGraph,
  needsEndless,
} from "../packages/core/src/comfy/minimax-graphs.js";

const URL = process.env.COMFY_URL ?? "http://127.0.0.1:8199";
const [W, H] = [Number(process.env.W ?? 1344), Number(process.env.H ?? 768)];
const sec = Number(process.argv[2] ?? 20);
const spec = MINIMAX_TURBO.draft.ref2v;
/** a chunked shot runs on the reference head and needs at least one still */
const REF_IMAGE = process.env.REF ?? "";

/* Written the way the panel now asks for: shots and cut markers, so the
 * planner has something to plan against rather than one long sentence. */
const PROMPT = [
  // [Shot 1] opens at frame 0 and must carry NO timestamp; every later shot
  // must carry one, strictly increasing. The node validates both.
  "[Shot 1] A lone hiker crests a windswept ridge at golden hour and stops,",
  "looking out over a valley filled with low cloud. Handheld, slow push in.",
  "[Shot 2] At 00:10.000, the hiker sits down on a flat rock, takes off a glove,",
  "and watches the cloud move. Wider, locked off.",
  "Audio: wind across the ridge, boots on loose stone, distant birdsong. No dialogue.",
].join("\n");

async function main() {
  const chunkFrames = endlessChunkFrames(W, H, "w4a8");
  const frames = frameLength(sec);
  console.log(
    `${W}x${H} · ${sec}s = ${frames} frames · chunk ${chunkFrames} · ` +
      `${Math.ceil(frames / chunkFrames)} chunks · endless=${needsEndless(W, H, sec)}`,
  );

  const client = new ComfyClient(URL);
  await client.freeMemory();
  if (!REF_IMAGE) throw new Error("set REF=<name staged in ComfyUI input> — see the header");
  const graph = minimaxH3RefGraph({
    prompt: PROMPT,
    refImageNames: [REF_IMAGE],
    refVideos: [],
    refAudioNames: [],
    durationSec: sec,
    width: W,
    height: H,
    seed: 424242,
    sage: true,
    turbo: { ...spec, lora: `minimax-h3-turbo-lora\\loras\\${spec.file}` },
    endless: {
      chunkFrames,
      continuationFrames: ENDLESS_CONTINUATION_FRAMES,
      prompt: PROMPT,
    },
    models: { ...MINIMAX_H3_MANAGED, ...MINIMAX_H3_W4A8, refUnet: MINIMAX_H3_REF_W4A8 },
    filenamePrefix: `bench/h3-long-${sec}s`,
  });

  const t0 = Date.now();
  const files = await client.run(graph, {
    timeoutMs: 6 * 60 * 60_000,
    onNode: (c) => console.log(`  node: ${c}`),
    onProgress: (v, m) => {
      if (m > 0 && v === m) console.log(`  step ${v}/${m}`);
    },
  });
  console.log(
    `\n${((Date.now() - t0) / 60_000).toFixed(1)} min -> ${files.map((f) => f.filename).join(", ")}`,
  );
}
void main();
