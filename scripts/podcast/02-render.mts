/* Stage 2 of the multi-shot podcast pilot — one generation, several shots.
 *
 * The claim under test (docs/VIDEO-SPEED-RELIABILITY-2026-08-31.md §3.1): LTX
 * 2.5 will cut INSIDE one render when the prompt is a single chronological
 * prose paragraph that names its own transitions, re-establishes framing at
 * every cut, tags each character the same way every time, and says the audio
 * carries across. If that holds, one boarded keyframe + one prompt = real
 * coverage (wide → single → reaction) with held voices, which is the whole
 * podcast format.
 *
 * Why this drives the graph builder directly instead of labs.video.generate:
 * the shipping adapter switches the Gemma prompt enhancer on whenever those
 * weights are present (ltx25-video.ts:193), and the enhancer REWRITES the
 * prompt — which is the one thing this experiment must control. Same builder,
 * same ComfyService, same tuning as the product path; only enhanceClipName is
 * in my hands. `--enhance` puts it back to measure exactly that.
 *
 *   npx tsx scripts/podcast/02-render.mts [--full] [--enhance] [--single]
 *                                         [--seed N] [--dur N] [--shots 2|3]
 */

import fs from "node:fs";
import path from "node:path";

const { SettingsStore } = await import("../../packages/core/src/settings.js");
const { ModelManager } = await import("../../packages/core/src/models/manager.js");
const { EngineRuntime } = await import("../../packages/core/src/runtime/runtime.js");
const { ComfyService } = await import("../../packages/core/src/comfy/service.js");
const { ComfyClient } = await import("../../packages/core/src/comfy/client.js");
const { resolveTuning } = await import("../../packages/core/src/comfy/capabilities.js");
const { ltx25Graph, LTX25_MANAGED, LTX25_EXTERNAL, LTX25_DEFAULT_NEGATIVE } = await import(
  "../../packages/core/src/comfy/ltx25-graph.js"
);

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, d: number) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? Number(args[i + 1]) : d;
};

const FULL = flag("full");
const ENHANCE = flag("enhance");
const SINGLE = flag("single");
const SHOTS = opt("shots", 3);
const SEED = opt("seed", 7);
const DUR = opt("dur", 8);
const W = 1280;
const H = 704;
const FPS = 24;

const HERE = path.join(process.cwd(), "scripts", "podcast");
const OUT_DIR = path.join(HERE, "out");
const BOARDS = JSON.parse(fs.readFileSync(path.join(HERE, "boards.json"), "utf8"));

/* ---------------------------------------------------------------- prompts */

/* How each host is named at EVERY mention. The named-beat rule that makes 2.5
 * articulate a line at all (memory: ltx25-ia2v-and-the-beat-wording) is the
 * same rule multi-shot needs across a cut — a pronoun after a cut is a new
 * character as far as the model is concerned. */
const STERLING =
  "Sterling, the golden-maned lion in the royal-blue velvet blazer, cream waistcoat and " +
  "burgundy bow tie";
const MILO =
  "Milo, the small sandy meerkat in the mustard beanie and rust-and-cream striped sweater";

const SET =
  "Stylized 3D animation, Pixar feature quality, in a small warm-lit recording booth: dark " +
  "acoustic foam panels on the back wall, a heavy wooden table between two chairs, a large " +
  "studio microphone on a black boom arm in front of each host, soft practical lamps behind " +
  "going out of focus.";

/** the pilot prompt: one chronological paragraph, transitions named in prose,
 * framing re-established at each cut, audio continuity stated */
const MULTI_3 =
  `${SET} The shot opens on a wide two-shot from across the table at seated eye level: ` +
  `${STERLING} sits on the left with his paws folded, and ${MILO} sits on the right leaning ` +
  `forward on his elbows. ${STERLING} turns to his microphone and says warmly, "The point of a ` +
  `fund, Milo, is that it is there before anybody needs it." A hard cut transitions to a tight ` +
  `single of ${STERLING}, framed from the chest up from a low three-quarter angle with the ` +
  `microphone large in the foreground, the same warm lamplight across his mane; the conversation ` +
  `continues under the cut as ${STERLING} finishes the thought with a small satisfied nod. A ` +
  `second hard cut transitions to a matching tight single of ${MILO} from the opposite ` +
  `three-quarter angle, chest up, same booth and same warm lamplight, and ${MILO} blinks, ` +
  `glances across the table and answers quickly, "Right, right — and how much is in it exactly?" ` +
  `Handheld documentary camera with small settles, shallow depth of field, the two voices ` +
  `unchanged across both cuts.`;

/** the same scene as two shots, to see whether the cut count is steerable */
const MULTI_2 =
  `${SET} The shot opens on a wide two-shot from across the table at seated eye level: ` +
  `${STERLING} sits on the left with his paws folded, and ${MILO} sits on the right leaning ` +
  `forward on his elbows. ${STERLING} turns to his microphone and says warmly, "The point of a ` +
  `fund, Milo, is that it is there before anybody needs it." A hard cut transitions to a tight ` +
  `single of ${MILO} from a three-quarter angle, chest up, same booth and same warm lamplight, ` +
  `the microphone large in the foreground; the conversation continues under the cut as ${MILO} ` +
  `blinks, glances across the table and answers quickly, "Right, right — and how much is in it ` +
  `exactly?" Handheld documentary camera with small settles, shallow depth of field, both ` +
  `voices unchanged across the cut.`;

/** control: the SAME scene, same lines, written the way we write shots today —
 * one continuous take, no transition language. If this one also cuts, the
 * prose structure isn't what produced the cuts. */
const SINGLE_TAKE =
  `${SET} A wide two-shot from across the table at seated eye level, held as one continuous ` +
  `take: ${STERLING} sits on the left with his paws folded and ${MILO} sits on the right ` +
  `leaning forward on his elbows. ${STERLING} turns to his microphone and says warmly, "The ` +
  `point of a fund, Milo, is that it is there before anybody needs it," and ${MILO} blinks, ` +
  `glances across the table and answers quickly, "Right, right — and how much is in it ` +
  `exactly?" Handheld documentary camera with small settles, shallow depth of field.`;

const prompt = SINGLE ? SINGLE_TAKE : SHOTS === 2 ? MULTI_2 : MULTI_3;
const arm = `${SINGLE ? "single" : `multi${SHOTS}`}${ENHANCE ? "-enh" : ""}${FULL ? "-full" : "-draft"}`;

/* the show's own negative plus the template's — text suppression matters here
 * because a booth full of hardware is exactly where a station bug shows up */
const NEGATIVE = `${LTX25_DEFAULT_NEGATIVE}, text, lettering, caption, subtitle, logo, watermark, on-screen graphics, split screen, deformed, off-model, different character`;

/* ----------------------------------------------------------------- render */

const settings = new SettingsStore();
const models = new ModelManager(settings);
const runtime = new EngineRuntime(settings);
const comfy = new ComfyService(settings, runtime);

const board = path.join(settings.get().storage.dataRoot, BOARDS["booth-two-shot"]);
if (!fs.existsSync(board)) throw new Error(`board missing: ${board}`);
fs.mkdirSync(OUT_DIR, { recursive: true });

console.log(`arm      ${arm}`);
console.log(`board    ${BOARDS["booth-two-shot"]}`);
console.log(`shape    ${W}×${H} · ${DUR}s @ ${FPS}fps · seed ${SEED} · ${FULL ? "full" : "draft"}`);
console.log(`enhancer ${ENHANCE ? "ON (Gemma rewrites the prompt)" : "off (raw prose)"}`);
console.log(`prompt   ${prompt.length} chars, ~${prompt.split(/\s+/).length} words\n`);

const t0 = Date.now();
const out = await comfy.run(async (url) => {
  const client = new ComfyClient(url);
  if (!(await client.hasNodes(["LTXVDualCFGGuider"]))) {
    throw new Error("this ComfyUI is not 0.32+ (no LTXVDualCFGGuider)");
  }
  console.log(`comfy    ${url}`);

  const imageName = await client.uploadInput(`podcast-board.png`, fs.readFileSync(board));
  const tuning = await resolveTuning(client, settings.get().engines.videoTuning);
  console.log(`tuning   ${JSON.stringify(tuning)}`);

  const graph = ltx25Graph({
    prompt,
    negative: NEGATIVE,
    imageName,
    durationSec: DUR,
    width: W,
    height: H,
    seed: SEED,
    fps: FPS,
    fast: !FULL,
    models: models.managedCopy("ltx-25-22b-int8") ? LTX25_MANAGED : LTX25_EXTERNAL,
    enhanceClipName: ENHANCE ? models.comfyFileName("ltx-25-prompt-enhancer") : null,
    tuning,
    filenamePrefix: `podcast/${arm}-s${SEED}`,
  });

  await client.freeMemory();
  let pass = 0;
  let lastPct = -10;
  const files = await client.run(graph, {
    timeoutMs: 60 * 60_000,
    onNode: (classType) => {
      if (classType === "SamplerCustomAdvanced") {
        pass += 1;
        console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] sampling pass ${pass}`);
      } else if (classType === "TextGenerateLTX2Prompt") console.log("  enhancing prompt…");
      else if (classType === "LTXVLatentUpsampler") console.log("  upscaling latents…");
      else if (classType === "VAEDecodeTiled") console.log("  decoding…");
    },
    onProgress: (value, max) => {
      if (max <= 0) return;
      const pct = Math.round((value / max) * 100);
      if (pct >= lastPct + 20) {
        lastPct = pct;
        console.log(`    ${pct}% of pass ${pass} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      }
    },
  });
  const video = files.find((f) => /\.(mp4|webm|mov)$/i.test(f.filename));
  if (!video) throw new Error("run finished without a video");
  const dest = path.join(OUT_DIR, `${arm}-s${SEED}-${DUR}s${path.extname(video.filename)}`);
  fs.writeFileSync(dest, video.data);
  return dest;
}, settings.get().engines.videoMode === "managed" ? "managed" : "external");

console.log(`\nOK  ${out}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

/* the prompt actually sent, kept beside the take — an arm is only comparable
 * to another arm if the exact wording is recoverable */
fs.writeFileSync(out.replace(/\.\w+$/, ".prompt.txt"), `${arm}\nseed ${SEED} · ${DUR}s · ${W}×${H}\n\n${prompt}\n`);
process.exit(0);
