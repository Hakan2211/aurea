/* F3 — style LoRAs measured against prose alone (VIDEO-LAB-FREEFORM-PLAN.md
 * §2.4). One A/B run per LoRA-backed look: the SAME freeform prompt (the
 * look's own prose, composed the way the panel composes it, text-to-video so
 * the adapter has the whole picture to style), ONE seed, two arms — prose
 * only, and prose + the LoRA at the author's strength. A LoRA that does not
 * visibly move the picture over what the prose already buys is dropped from
 * its look; the camera LoRA taught us prose carries most of it (x1.30 of
 * x1.40, upgrade plan §4.1).
 *
 * Run (against a studiod on the dev port):
 *   npx tsx scripts/ab-style-loras.mts [lookId…]      default: every LoRA look
 * Env: STUDIOD_PORT / STUDIOD_TOKEN (default 4199 / uiverify), AB_PROJECT.
 * Writes a summary to scripts/out/ab-style-loras.json when every run settles. */
import fs from "node:fs";
import path from "node:path";

const { createStudiodApi } = await import("../packages/core/src/tools.js");
const { SHIPPED_LOOKS } = await import("../packages/core/src/promptlib.js");
const { composeFreeform } = await import("../packages/shared/src/freeform.js");

const port = Number(process.env.STUDIOD_PORT ?? 4199);
const token = process.env.STUDIOD_TOKEN ?? "uiverify";
const project = process.env.AB_PROJECT ?? "playground";
const api = createStudiodApi(port, token);

/** one subject for every look, so the sheet reads across: a creature, a set,
 * a small action, no text anywhere */
const SUBJECT =
  "a red fox trots across a cobbled market square at dusk, stops at a fruit stall and looks up at the lanterns";

const wanted = process.argv.slice(2);
/** `lookId=File.safetensors` measures a LoRA on a look that does not (yet)
 * carry it — how the claymation LoRA was tried against the H3 look's prose */
const extras = wanted.filter((w) => w.includes("=")).map((w) => w.split("=") as [string, string]);
const looks = SHIPPED_LOOKS.filter(
  (l) => l.payload.loras?.length && (!wanted.length || wanted.includes(l.id)),
).concat(
  extras.map(([id, file]) => {
    const base = SHIPPED_LOOKS.find((l) => l.id === id);
    if (!base) throw new Error(`unknown look ${id}`);
    return { ...base, payload: { ...base.payload, loras: [{ name: file, strength: 1 }] } };
  }),
);
if (!looks.length) throw new Error("no LoRA-backed looks matched");

// claymation ships on H3 (no LoRA arm) — its LoRA is measured on LTX 2.5
// with the same prose, so the base is the LTX look shape, not the look's own
/* The enhancer is OFF for the measurement, and that is not a preference: 2.5
 * re-runs Gemma per render, so with it on the two arms see DIFFERENT prompts
 * and the comparison measures the enhancer, not the LoRA. (Measured the hard
 * way on 2026-09-02: an enhanced oil-paint pair rendered two unrelated human
 * faces from a prompt about a fox.) */
const LTX = { engine: "ltx25", resolution: "1280 × 704 (16:9)", durationSec: 4, fps: 24 as const, fast: true, enhance: false };

type Ab = Parameters<typeof api.labs.video.ab.mutate>[0];
const runs: { look: string; id: string }[] = [];
for (const look of looks) {
  const engine = "ltx25";
  const composed = composeFreeform({ subject: SUBJECT, mode: "t2v", look, engine, durationSec: LTX.durationSec });
  const lora = look.payload.loras![0];
  const input: Ab = {
    project,
    title: `F3 style · ${look.label} — prose vs +LoRA`,
    notes: `${lora.name} @ ${lora.strength}; same seed; t2v 4s draft on ltx25`,
    base: {
      prompt: composed.prompt,
      negativePrompt: composed.negative,
      ...LTX,
      loras: [],
    },
    variants: [
      { label: "prose only", overrides: { loras: [] } },
      { label: `+ ${lora.name} @ ${lora.strength}`, overrides: { loras: [lora] } },
    ],
  };
  const run = await api.labs.video.ab.mutate(input);
  console.log(`${look.id}: run ${run.id} seed ${run.seed}`);
  console.log(`  prompt: ${composed.prompt.slice(0, 160)}…`);
  runs.push({ look: look.id, id: run.id });
}

// wait for every run to settle, printing progress
const settled = new Map<string, Awaited<ReturnType<typeof api.labs.video.abGet.query>>>();
while (settled.size < runs.length) {
  await new Promise((r) => setTimeout(r, 15_000));
  for (const r of runs) {
    if (settled.has(r.id)) continue;
    const run = await api.labs.video.abGet.query({ id: r.id });
    if (!run) continue;
    const done = run.variants.every((v) => v.status === "completed" || v.status === "failed");
    const state = run.variants.map((v) => `${v.label.split(" ")[0]}:${v.status}`).join(" ");
    console.log(`${new Date().toISOString().slice(11, 19)} ${r.look} ${state}`);
    if (done) settled.set(r.id, run);
  }
}

const out = runs.map((r) => {
  const run = settled.get(r.id)!;
  return {
    look: r.look,
    run: r.id,
    seed: run.seed,
    variants: run.variants.map((v) => ({
      label: v.label,
      status: v.status,
      renderMs: v.renderMs,
      output: v.output,
      error: v.error,
    })),
  };
});
fs.mkdirSync(path.join("scripts", "out"), { recursive: true });
fs.writeFileSync(path.join("scripts", "out", "ab-style-loras.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(0);
