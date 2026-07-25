/* Shot Director V6 — the ensemble: cast references through the Ingredients
 * IC-LoRA.
 *
 *   0. offline: refs → a reference sheet drawn by ffmpeg, a static-image segment
 *      on the IC-LoRA track, and the "### Reference Sheet Description" block
 *      whose cell names match the cells the compositor actually drew
 *   1. probe: what the running ComfyUI is missing, in the words the app uses
 *   2. live: two characters in one shot, NEITHER of them the start frame —
 *      the start frame is an empty set — measured against a control render with
 *      the sheet switched off, because "the cast is in the shot" is only a claim
 *      if something says the shot would otherwise be without them
 *
 * Needs the app running (reads ~/.aurea/studiod.json), an external ComfyUI with
 * WhatDreamsCost-ComfyUI v2.0.4+, the Ingredients IC-LoRA on its loras path
 * (gated: huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Ingredients), and ffmpeg.
 *
 *   npx tsx scripts/test-shot-refs.mts                     # everything
 *   npx tsx scripts/test-shot-refs.mts --offline           # no GPU
 *   npx tsx scripts/test-shot-refs.mts --control           # + the unguided run
 *   npx tsx scripts/test-shot-refs.mts --reuse=<mp4> --reuse-control=<mp4>
 *                                                          # re-measure takes already rendered
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { createStudiodApi } = await import("../packages/core/src/tools.js");
const { buildTimelineData } = await import("../packages/core/src/comfy/director-timeline.js");
const { directorGraph } = await import("../packages/core/src/comfy/director-graph.js");
const { composeRefSheet } = await import("../packages/core/src/adapters/ref-sheet.js");
const { hasRefTrack, resolveIngredientsLora } = await import(
  "../packages/core/src/comfy/capabilities.js"
);
const { ComfyClient } = await import("../packages/core/src/comfy/client.js");
const { composeSheetPrompt, sheetLayout } = await import("../packages/shared/src/refSheet.js");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? null;

/* ---- 0: offline — the contracts with the node ---- */
{
  const inputs = buildTimelineData({
    globalPrompt: "two animals in an office breakroom",
    fps: 24,
    durationFrames: 121,
    keyframes: [{ file: "aurea/set.png", atFrame: 0, strength: 1 }],
    refSheet: { file: "aurea/sheet.png", strength: 1 },
  });
  const data = JSON.parse(inputs.timeline_data) as {
    motionSegments: Array<Record<string, unknown>>;
  };
  check(
    "the sheet lands on the IC-LoRA track as a one-frame still at 0",
    JSON.stringify(data.motionSegments) ===
      JSON.stringify([
        {
          videoFile: "aurea/sheet.png",
          isStaticImage: true,
          start: 0,
          length: 1,
          trimStart: 0,
          videoDurationFrames: 1,
          videoStrength: 1,
          videoAttentionStrength: 0.65,
          resampleMode: "nearest",
        },
      ]),
    JSON.stringify(data.motionSegments),
  );

  const ingredients = "ltxv\\ltx2\\ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors";
  const graph = directorGraph({
    timeline: inputs,
    negativePrompt: "ugly",
    fps: 24,
    durationFrames: 121,
    width: 896,
    height: 704,
    seed: 1,
    hasCustomAudio: false,
    inpaintAudio: true,
    hasIcLoraTrack: true,
    icLora: ingredients,
    icLoraStrength: 1,
    models: null,
  });
  check(
    "the track is on and both passes load the Ingredients IC-LoRA",
    (graph.director.inputs as Record<string, unknown>).use_custom_motion === true &&
      (graph.guide_base.inputs as Record<string, unknown>).ic_lora_name === ingredients &&
      (graph.guide_refine.inputs as Record<string, unknown>).ic_lora_name === ingredients,
  );

  /* the prompt has to name the cells the compositor drew, or the model reads a
   * prop as a character — same layout function on both sides is the guarantee */
  const refs = [
    { image: "a.png", name: "Sterling", kind: "character" as const, description: "a lion in cream" },
    { image: "b.png", name: "Bruno", kind: "character" as const, description: "a gorilla in mint" },
    { image: "c.png", name: "Breakroom", kind: "setting" as const, description: "fluorescent" },
  ];
  const prompt = composeSheetPrompt(refs, "they argue over the coffee machine");
  const labels = sheetLayout(refs.length).cells.map((c) => c.label);
  check(
    "the description block names every cell, in order, then the shot",
    labels.every((l, i) => prompt.includes(`**${l} (`) ) &&
      prompt.indexOf("### Target Description") > prompt.lastIndexOf(`**${labels[2]} (`) &&
      prompt.endsWith("they argue over the coffee machine"),
    labels.join(" / "),
  );

  // and the sheet itself is drawn at the shot's aspect, cells in that order
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aurea-v6-"));
  const swatch = (colour: string, i: number) => {
    const file = path.join(tmp, `${i}.png`);
    execFile("ffmpeg", ["-y", "-f", "lavfi", "-i", `color=c=${colour}:s=512x512`, "-frames:v", "1", file]);
    return file;
  };
  const images = ["red", "lime", "blue"].map(swatch);
  await sleep(600); // the swatch writes are fire-and-forget
  const sheet = await composeRefSheet({
    images,
    out: path.join(tmp, "sheet.png"),
    aspect: 896 / 704,
  });
  check(
    "the sheet is a 2×2 grid at the shot's aspect",
    sheet.cols === 2 && sheet.rows === 2 && Math.abs(sheet.width / sheet.height - 896 / 704) < 0.01,
    `${sheet.width}×${sheet.height}`,
  );
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---- 1: probe — is this machine's ComfyUI able to do it at all? ---- */
{
  const client = new ComfyClient("http://127.0.0.1:8000");
  if (await client.health()) {
    const pack = await hasRefTrack(client);
    check("the Director pack takes stills on its IC-LoRA track (v2.0.4+)", pack);
    const lora = await resolveIngredientsLora(client);
    check(
      "the Ingredients IC-LoRA is on its loras path",
      !!lora,
      lora ??
        "missing — gated download from huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Ingredients",
    );
  } else {
    console.log("SKIP  capability probe — no ComfyUI on :8000");
  }
}

async function finish(): Promise<never> {
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  await sleep(150);
  process.exit(failures ? 1 : 0);
}

if (process.argv.includes("--offline")) await finish();

/* ---- live ---- */

const pf = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".aurea", "studiod.json"), "utf8"),
) as { port: number; token: string };
const api = createStudiodApi(pf.port, pf.token);
const dataRoot = path.join(os.homedir(), "Aurea");

const caps = await api.labs.video.capabilities.query();
check("this ComfyUI can run the Director", caps.director, caps.note ?? "");
if (!caps.multiRef) {
  console.log(
    `\nSKIP  the live ensemble — ${caps.note ?? "cast references are not available here"}\n` +
      "      Install the two pieces above and re-run; everything else already passed.",
  );
  await finish();
}

const assets = (await api.library.list.query()).assets;
const find = (name: string) => {
  const a = assets.find((x) => x.name === name || x.relPath.endsWith(name));
  if (!a) throw new Error(`missing library asset: ${name}`);
  return a.relPath;
};
const project = (await api.projects.list.query())[0].id;

/* What CAN and CANNOT be measured here, learned the hard way on 2026-07-25.
 *
 * The obvious check — "is each character's palette in the take?" — is worthless,
 * and the control render is what proves it. The shot prompt already says "a
 * regal lion in a blue velvet blazer and a burly gorilla in a mint hoodie", so
 * the UNGUIDED take has a blue blazer and a mint hoodie in it too. It just hangs
 * them on two humans. Colour cannot tell a lion from a man in a lion-coloured
 * jacket, and a histogram against the reference stills mostly measures their
 * studio-grey backdrop (it scored the control HIGHER: 0.40 vs 0.33).
 *
 * So this measures the one thing that is machine-checkable — the sheet changed
 * the render, materially and everywhere — and writes a frame strip from each so
 * the species question is answered by an eye, which is the only organ that can.
 */

/** 64×64 grayscale frames — enough to compare two takes without decoding
 * pixels the comparison doesn't use */
function frames(file: string): Promise<Uint8Array[]> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-v", "error", "-i", file, "-vf", "scale=64:64,format=gray", "-f", "rawvideo", "-"],
      { maxBuffer: 1 << 28, encoding: "buffer", windowsHide: true },
      (err, stdout) => {
        if (err) return reject(err);
        const size = 64 * 64;
        const out: Uint8Array[] = [];
        for (let i = 0; i + size <= stdout.length; i += size) {
          out.push(new Uint8Array(stdout.subarray(i, i + size)));
        }
        resolve(out);
      },
    );
  });
}

const meanAbs = (a: Uint8Array, b: Uint8Array) => {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
};

/** 64-bin RGB histogram, normalised. Informational only — see above. */
function histogram(file: string): Promise<Float64Array> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-v", "error", "-i", file, "-vf", "scale=64:64", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
      { maxBuffer: 1 << 28, encoding: "buffer", windowsHide: true },
      (err, stdout) => {
        if (err) return reject(err);
        const bins = new Float64Array(64);
        for (let i = 0; i + 2 < stdout.length; i += 3) {
          const r = stdout[i] >> 6;
          const g = stdout[i + 1] >> 6;
          const b = stdout[i + 2] >> 6;
          bins[r * 16 + g * 4 + b] += 1;
        }
        const total = bins.reduce((s, v) => s + v, 0) || 1;
        for (let i = 0; i < bins.length; i += 1) bins[i] /= total;
        resolve(bins);
      },
    );
  });
}

/** histogram intersection: 1 = the same palette, 0 = nothing in common */
const overlap = (a: Float64Array, b: Float64Array) =>
  a.reduce((s, v, i) => s + Math.min(v, b[i]), 0);

/** enqueue, wait, return the imported take's absolute path */
async function render(
  label: string,
  input: Parameters<typeof api.labs.video.generate.mutate>[0],
): Promise<string | null> {
  const startedAt = new Date().toISOString();
  const job = await api.labs.video.generate.mutate(input);
  console.log(`\n${label}: job ${job.id}`);
  const began = Date.now();
  const stages = new Set<string>();
  for (;;) {
    const j = (await api.jobs.list.query()).find((x) => x.id === job.id)!;
    if (j.stage) stages.add(j.stage);
    if (j.status === "completed" || j.status === "failed") {
      const tookSec = Math.round((Date.now() - began) / 1000);
      check(`${label} rendered`, j.status === "completed", j.error ?? `${tookSec}s`);
      if (j.status !== "completed") return null;
      console.log(`  stages: ${[...stages].join(" | ")}`);
      const asset = (await api.library.list.query()).assets.find(
        (a) => a.kind === "video" && a.createdAt >= startedAt,
      );
      if (!asset) {
        check(`${label} imported into the library`, false);
        return null;
      }
      return path.join(dataRoot, asset.relPath);
    }
    if (Date.now() - began > 45 * 60_000) {
      await api.jobs.cancel.mutate({ id: job.id }).catch(() => {});
      check(`${label} rendered`, false, "timed out after 45 min");
      return null;
    }
    await sleep(3000);
  }
}

/* The ensemble. The start frame is the SET — an empty breakroom — so neither
 * character is in the picture LTX starts from: if they turn up on-model, the
 * sheet is what put them there. */
const bible = await api.studio.bible.get.query({ project });
const named = (needle: string) =>
  bible.characters.find((c) => c.name.toLowerCase().includes(needle));
const sterling = named("sterling");
const bruno = named("bruno") ?? named("grant");
if (!sterling || !bruno) throw new Error("this project's bible needs two named characters");
const refImage = (c: { refs: { keyframeRef?: string | null; hero?: string | null } }) =>
  c.refs.keyframeRef ?? c.refs.hero ?? null;
const sterlingRef = refImage(sterling);
const brunoRef = refImage(bruno);
if (!sterlingRef || !brunoRef) throw new Error("both characters need a locked reference still");

/* The start frame has to be a STILL of the set, not one of the characters —
 * that's what makes this a reference test rather than an i2v test. Named with
 * --start=<name> when the project has a proper empty-set plate; otherwise the
 * newest still that reads like a set, and the run says which it used so nobody
 * reads a lucky i2v as a pass. */
const stills = assets.filter((a) => a.kind === "image");
const startFrame =
  (arg("start") ? find(arg("start")!) : null) ??
  stills.find((a) => /breakroom|empty|set|plate|background|room/i.test(a.name))?.relPath ??
  stills[0]?.relPath;
if (!startFrame) throw new Error("no still in the library to use as the set");
const prompt =
  "An office breakroom in warm sitcom light. A regal lion in a blue velvet blazer and a burly " +
  "gorilla in a mint hoodie stand either side of the coffee machine, talking. Static two-shot.";

const refs = [
  {
    image: sterlingRef,
    name: sterling.name,
    kind: "character" as const,
    description: [sterling.species && `a ${sterling.species}`, sterling.wardrobe, sterling.signatureFeature]
      .filter(Boolean)
      .join(", "),
  },
  {
    image: brunoRef,
    name: bruno.name,
    kind: "character" as const,
    description: [bruno.species && `a ${bruno.species}`, bruno.wardrobe, bruno.signatureFeature]
      .filter(Boolean)
      .join(", "),
  },
];
console.log(`\ncast: ${refs.map((r) => `${r.name} (${r.image})`).join(", ")}`);
console.log(`start frame: ${startFrame}`);

const shot = {
  project,
  prompt,
  startFrame,
  durationSec: 5,
  resolution: "896 × 704 (landscape)",
  seed: 6161,
};

const out =
  arg("reuse") ??
  (await render("ensemble", {
    ...shot,
    director: {
      globalPrompt: prompt,
      fps: 24,
      keyframes: [{ image: startFrame, atSec: 0, strength: 1 }],
      refs,
      refStrength: 1,
      inpaintAudio: true,
    },
  }));

const control = arg("reuse-control")
  ? arg("reuse-control")
  : process.argv.includes("--control")
  ? await render("control (no cast sheet)", {
      ...shot,
      director: {
        globalPrompt: prompt,
        fps: 24,
        keyframes: [{ image: startFrame, atSec: 0, strength: 1 }],
        inpaintAudio: true,
      },
    })
  : null;

/** three frames of a take, side by side, for the eyeball verdict */
function strip(file: string, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      [
        "-v", "error", "-y", "-i", file,
        "-vf", "select='eq(n\\,0)+eq(n\\,60)+eq(n\\,120)',tile=3x1,scale=1200:-1",
        "-frames:v", "1", out,
      ],
      { windowsHide: true },
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

if (out) {
  const strips = path.join(os.tmpdir(), "aurea-v6");
  fs.mkdirSync(strips, { recursive: true });
  await strip(out, path.join(strips, "guided.png"));

  if (control) {
    /* The sheet has to CHANGE the render, not decorate it. Same seed, same
     * keyframe, same prompt: anything under a few units of mean pixel
     * difference would mean the IC-LoRA never bit. */
    const [a, b] = await Promise.all([frames(out), frames(control)]);
    const n = Math.min(a.length, b.length);
    let diff = 0;
    for (let i = 0; i < n; i += 1) diff += meanAbs(a[i], b[i]);
    diff /= Math.max(1, n);
    check(
      "the cast sheet changed the shot",
      diff > 8,
      `mean pixel difference vs the unguided control = ${diff.toFixed(2)} / 255`,
    );
    await strip(control, path.join(strips, "control.png"));

    for (const ref of refs) {
      const refHist = await histogram(path.join(dataRoot, ref.image));
      console.log(
        `  ${ref.name}: palette overlap guided ${overlap(refHist, await histogram(out)).toFixed(3)} / ` +
          `control ${overlap(refHist, await histogram(control)).toFixed(3)} (informational — see the note above)`,
      );
    }
  }

  console.log(`\nOUTPUT ${out}`);
  if (control) console.log(`CONTROL ${control}`);
  console.log(`FRAME STRIPS ${strips}`);
  console.log(
    "Now look at them. The pass is: both characters present and on-model, neither of them in\n" +
      "the start frame. The control should show the same wardrobe on the WRONG creatures.",
  );
}

await finish();
