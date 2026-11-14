/* LTX 2.5 vs LTX 2.3 — does 2.5 do everything 2.3 does, and does it do it
 * better? Eight A/B runs on the queue, one per 2.3 workflow, each rendering
 * the SAME shot on both engines from ONE seed. The two things 2.5 refuses
 * by design (Director timeline, camera LoRA) are covered by case H, where
 * the 2.3 arm gets the weight and the 2.5 arm gets the move in prose.
 *
 * Run: npx tsx scripts/ab-ltx-versions.mts [caseLetters]   e.g. "ABC"
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { createStudiodApi } = await import("../packages/core/src/tools.js");
const pf = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".aurea", "studiod.json"), "utf8"),
) as { port: number; token: string };
const api = createStudiodApi(pf.port, pf.token);

const PLATE = "projects/zoo-logic/assets/image/put-both-characters-into-the-recording-boot.png";
const ANGLE45 =
  "projects/zoo-logic/assets/image/coverage/coverage-put-both-characters-into-the-recording-/02-front-right.png";
const LINE = "projects/playground/assets/audio/one-does-not-simply-eat-a-chocolate-one-r-2.wav"; // 7.05s, Sterling

const LOOK =
  "Stylized 3D animation, Pixar feature quality, warm lamplight, acoustic panels, shallow depth of field.";
const TWO_SHOT =
  "Documentary two-shot in a small recording booth: Sterling, the golden lion in the blue blazer " +
  "and burgundy bow tie, sits across the table from Milo, the small sandy meerkat in the mustard " +
  "beanie and striped sweater, a microphone in front of each.";
const MOTION_ONLY =
  "Sterling nods slowly and leans a little toward his microphone; Milo listens, blinks, and " +
  "shifts in his chair. Nobody speaks. The camera holds nearly still with a gentle handheld drift.";
const IA2V =
  "Sterling talks, mouth moving while speaking, proudly, a small smile at the end; Milo listens in " +
  "silence, mouth closed. The camera holds still.";
const PUSH_IN =
  "The camera pushes slowly in toward the table between them as they hold a look at each other. " +
  "Neither speaks.";
const TO_ANGLE =
  "The camera moves smoothly to the right around the table, ending on a three-quarter view of " +
  "the two of them. Neither speaks.";

const RES = "1280 × 704 (16:9)";
type Base = Parameters<typeof api.labs.video.ab.mutate>[0]["base"];
type Variant = Parameters<typeof api.labs.video.ab.mutate>[0]["variants"][number];
const both = (extra25: Record<string, unknown> = {}): Variant[] => [
  { label: "LTX 2.3", overrides: { engine: "ltx2" } },
  { label: "LTX 2.5", overrides: { engine: "ltx25", enhance: false, ...extra25 } },
];

const CASES: Record<string, { title: string; base: Base; variants: Variant[] }> = {
  A: {
    title: "A · i2v draft 4s",
    base: { prompt: `${TWO_SHOT} ${MOTION_ONLY} ${LOOK}`, engine: "ltx2", startFrame: PLATE, durationSec: 4, resolution: RES, fast: true },
    variants: [...both(), { label: "LTX 2.5 + enhancer", overrides: { engine: "ltx25", enhance: true } }],
  },
  B: {
    title: "B · ia2v lip-sync 7s (Sterling's chocolate line)",
    base: { prompt: `${TWO_SHOT} ${IA2V} ${LOOK}`, engine: "ltx2", startFrame: PLATE, audio: LINE, durationSec: 7, resolution: RES, fast: true },
    variants: both(),
  },
  C: {
    title: "C · t2v draft 4s (no start frame)",
    base: { prompt: `${TWO_SHOT} ${MOTION_ONLY} ${LOOK}`, engine: "ltx2", durationSec: 4, resolution: RES, fast: true },
    variants: both(),
  },
  D: {
    title: "D · end frame draft 4s (plate → 45° angle)",
    base: { prompt: `${TWO_SHOT} ${TO_ANGLE} ${LOOK}`, engine: "ltx2", startFrame: PLATE, endFrame: ANGLE45, durationSec: 4, resolution: RES, fast: true },
    variants: both(),
  },
  E: {
    title: "E · mid keyframe draft 4s (45° angle at 2s)",
    base: { prompt: `${TWO_SHOT} ${TO_ANGLE} ${LOOK}`, engine: "ltx2", startFrame: PLATE, keyframes: [{ image: ANGLE45, atSec: 2, strength: 1 }], durationSec: 4, resolution: RES, fast: true },
    variants: both(),
  },
  F: {
    title: "F · FULL quality i2v 4s (two-stage upscale)",
    base: { prompt: `${TWO_SHOT} ${MOTION_ONLY} ${LOOK}`, engine: "ltx2", startFrame: PLATE, durationSec: 4, resolution: RES, fast: false },
    variants: both(),
  },
  G: {
    title: "G · 48fps draft 2s",
    base: { prompt: `${TWO_SHOT} ${MOTION_ONLY} ${LOOK}`, engine: "ltx2", startFrame: PLATE, durationSec: 2, resolution: RES, fps: 48, fast: true },
    variants: both(),
  },
  H: {
    title: "H · push-in: 2.3 camera LoRA vs 2.3 prose vs 2.5 prose",
    base: { prompt: `${TWO_SHOT} ${PUSH_IN} ${LOOK}`, engine: "ltx2", startFrame: PLATE, durationSec: 4, resolution: RES, fast: true },
    variants: [
      { label: "LTX 2.3 prose", overrides: { engine: "ltx2" } },
      { label: "LTX 2.3 LoRA 1.0", overrides: { engine: "ltx2", cameraLora: { move: "dolly-in", strength: 1 } } },
      { label: "LTX 2.5 prose", overrides: { engine: "ltx25", enhance: false } },
    ],
  },
};

const want = (process.argv[2] ?? Object.keys(CASES).join("")).toUpperCase().split("");
const OUT = path.join(process.env.SCRATCH ?? os.tmpdir(), "ab-ltx-versions.json");
const runs: Array<{ key: string; id: string; seed: number }> = [];
for (const key of want) {
  const c = CASES[key];
  if (!c) throw new Error(`no case ${key}`);
  const run = await api.labs.video.ab.mutate({
    project: "zoo-logic",
    title: `LTX 2.5 vs 2.3 — ${c.title}`,
    notes: "Same shot, one seed, both engines. 2.5 runs with the Gemma enhancer OFF unless the label says otherwise.",
    base: c.base,
    variants: c.variants,
  });
  runs.push({ key, id: run.id, seed: run.seed });
  console.log(`${key}  run ${run.id}  seed ${run.seed}  ${run.variants.map((v) => v.jobId).join(" ")}`);
}
fs.writeFileSync(OUT, JSON.stringify(runs, null, 2));

const settled = (s: string) => s === "completed" || s === "failed";
const lastLine = new Map<string, string>();
for (;;) {
  await new Promise((r) => setTimeout(r, 15_000));
  let allDone = true;
  for (const r of runs) {
    const now = await api.labs.video.abGet.query({ id: r.id });
    if (!now) throw new Error(`run ${r.id} vanished`);
    const line = now.variants
      .map((v) => `${v.label}=${v.status}${v.renderMs ? ` ${(v.renderMs / 1000).toFixed(0)}s` : ""}`)
      .join(" | ");
    if (lastLine.get(r.id) !== line) {
      lastLine.set(r.id, line);
      console.log(`[${new Date().toLocaleTimeString()}] ${r.key}: ${line}`);
    }
    if (!now.variants.every((v) => settled(v.status))) allDone = false;
  }
  if (allDone) break;
}
console.log("\n=== SETTLED ===");
const report: unknown[] = [];
for (const r of runs) {
  const now = await api.labs.video.abGet.query({ id: r.id });
  console.log(`\n${CASES[r.key].title}   (run ${r.id}, seed ${r.seed})`);
  for (const v of now!.variants) {
    console.log(
      `  ${v.status.toUpperCase().padEnd(9)} ${v.label.padEnd(20)} ${v.renderMs ? `${(v.renderMs / 1000).toFixed(0)}s`.padStart(6) : "     —"}  ${v.output ?? v.error ?? ""}`,
    );
  }
  report.push({ key: r.key, title: CASES[r.key].title, id: r.id, seed: r.seed, variants: now!.variants });
}
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`\nwrote ${OUT}`);
process.exit(0);
