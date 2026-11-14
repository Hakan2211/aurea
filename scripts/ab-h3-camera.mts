/* First real experiment on the A/B queue: does the MiniMax-H3 camera-motion
 * LoRA actually steer a move that the prompt alone only asks for?
 *
 * One plate (the recording-booth two-shot), one seed, three variants:
 *   control  — prose asks for the push-in, no weight loaded
 *   0.8      — the author's "gentle"
 *   1.0      — the author's "pronounced"
 *
 * Run: npx tsx scripts/ab-h3-camera.mts        (queue + watch to settled)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { createStudiodApi } = await import("../packages/core/src/tools.js");

const pf = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".aurea", "studiod.json"), "utf8"),
) as { port: number; token: string };
const api = createStudiodApi(pf.port, pf.token);

const PROMPT =
  "Stylized 3D animation, Pixar feature quality, documentary two-shot: Sterling, the golden " +
  "lion in the blue blazer and burgundy bow tie, sits across the recording booth table from " +
  "Milo, the small sandy meerkat in the mustard beanie and striped sweater. The camera pushes " +
  "slowly in toward the table between them as they hold a look at each other. Neither speaks. " +
  "Warm lamplight, acoustic panels behind them, shallow depth of field, quiet room tone.";

const run = await api.labs.video.ab.mutate({
  project: "zoo-logic",
  title: "H3 camera LoRA — push-in vs prompt alone",
  notes:
    "Jojocodex camera_motion_h3_lora_v1_3000. Control steers the push-in in prose only; the " +
    "two LoRA variants add the trigger phrase and the weight at the author's gentle and " +
    "pronounced strengths. Same plate, same seed, draft tier, H3 native canvas.",
  base: {
    prompt: PROMPT,
    engine: "minimax-h3",
    startFrame: "projects/zoo-logic/assets/image/put-both-characters-into-the-recording-boot.png",
    durationSec: 4,
    resolution: "1344 × 768",
    fast: true,
    minimaxTier: "draft",
  },
  variants: [
    { label: "prompt only (control)", overrides: {} },
    { label: "LoRA 0.8 (gentle)", overrides: { cameraLora: { move: "dolly-in", strength: 0.8 } } },
    { label: "LoRA 1.0 (pronounced)", overrides: { cameraLora: { move: "dolly-in", strength: 1 } } },
  ],
});

console.log(`run ${run.id}  seed ${run.seed}`);
for (const v of run.variants) console.log(`  ${v.jobId}  ${v.label}`);

const settled = (s: string) => s === "completed" || s === "failed";
let last = "";
for (;;) {
  await new Promise((r) => setTimeout(r, 10_000));
  const now = await api.labs.video.abGet.query({ id: run.id });
  if (!now) throw new Error("run vanished");
  const line = now.variants
    .map((v) => `${v.label}=${v.status}${v.renderMs ? ` ${(v.renderMs / 1000).toFixed(0)}s` : ""}`)
    .join("  |  ");
  if (line !== last) {
    last = line;
    console.log(`[${new Date().toLocaleTimeString()}] ${line}`);
  }
  if (now.variants.every((v) => settled(v.status))) {
    console.log("\n--- settled ---");
    for (const v of now.variants) {
      console.log(
        `${v.status.toUpperCase().padEnd(9)} ${v.label.padEnd(22)} ` +
          `${v.renderMs ? `${(v.renderMs / 1000).toFixed(0)}s` : "—"}  ${v.output ?? v.error ?? ""}`,
      );
    }
    break;
  }
}
process.exit(0);
