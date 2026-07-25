/* Shot Director V5 — motion transfer and retake, end to end.
 *
 *   0. offline: the specs a motion reference and a retake make become the
 *      timeline_data and node inputs the pack actually parses (the retake
 *      strings are the ones its own editor writes — python never reads
 *      retakePrompt itself, the editor turns it into the prompt relay)
 *   1. live motion: a reference clip's movement driven onto a cast keyframe
 *      through the IC-LoRA, measured against the reference's own motion curve
 *   2. live retake: a 2s window of a finished take re-rendered in place, and
 *      the frames OUTSIDE the window measured against the original — a retake
 *      that quietly re-renders the whole take is the failure this catches
 *
 * Needs the app running (reads ~/.aurea/studiod.json), an external ComfyUI with
 * the WhatDreamsCost pack, an LTX IC-LoRA on its loras path, and ffmpeg.
 *
 *   npx tsx scripts/test-shot-motion.mts                # everything
 *   npx tsx scripts/test-shot-motion.mts --offline      # no GPU
 *   npx tsx scripts/test-shot-motion.mts --only=retake  # one live case
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { createStudiodApi } = await import("../packages/core/src/tools.js");
const { buildTimelineData } = await import("../packages/core/src/comfy/director-timeline.js");
const { directorGraph } = await import("../packages/core/src/comfy/director-graph.js");
const { resolveIcLora } = await import("../packages/core/src/comfy/capabilities.js");
const { ComfyClient } = await import("../packages/core/src/comfy/client.js");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const wants = (which: string) => !only || only === which;
/** --reuse-retake=<mp4> / --reuse-motion=<mp4> analyse a take rendered earlier
 * instead of burning four minutes of GPU to re-render it. For working on the
 * measurements, not for claiming a pass. */
const reuse = (which: string) =>
  process.argv.find((a) => a.startsWith(`--reuse-${which}=`))?.split("=").slice(1).join("=") ?? null;

/* ---- 0: offline — the contracts with the node ---- */
{
  const motion = buildTimelineData({
    globalPrompt: "Barney on a bare stage",
    fps: 24,
    durationFrames: 121,
    keyframes: [{ file: "aurea/barney.png", atFrame: 0, strength: 1 }],
    motion: [
      { file: "aurea/ref.mp4", atFrame: 0, lengthFrames: 121, trimStartFrames: 12, strength: 0.9 },
    ],
  });
  const data = JSON.parse(motion.timeline_data) as {
    motionSegments: Array<Record<string, unknown>>;
  };
  check(
    "the motion reference lands as a motion segment the guide can read",
    JSON.stringify(data.motionSegments) ===
      JSON.stringify([
        { videoFile: "aurea/ref.mp4", start: 0, length: 121, trimStart: 12, videoStrength: 0.9 },
      ]),
    JSON.stringify(data.motionSegments),
  );

  const graph = directorGraph({
    timeline: motion,
    negativePrompt: "ugly",
    fps: 24,
    durationFrames: 121,
    width: 704,
    height: 896,
    seed: 1,
    hasCustomAudio: false,
    inpaintAudio: true,
    hasIcLoraTrack: true,
    icLora: "ltxv\\ltx2\\ic-lora-motion-track.safetensors",
    icLoraStrength: 1,
    overrideAudio: true,
    models: null,
  });
  const director = graph.director.inputs as Record<string, unknown>;
  check("the graph turns the motion track on", director.use_custom_motion === true);
  check("override_audio lifts the reference's own sound", director.override_audio === true);
  for (const id of ["guide_base", "guide_refine"]) {
    const guide = graph[id].inputs as Record<string, unknown>;
    check(
      `${id} carries the IC-LoRA verbatim`,
      guide.ic_lora_name === "ltxv\\ltx2\\ic-lora-motion-track.safetensors" &&
        guide.ic_lora_strength === 1,
      String(guide.ic_lora_name),
    );
  }

  /* retake: the window is described by the fix, the rest by the shot's own
   * anchor, and nothing else on the timeline survives */
  const retake = buildTimelineData({
    globalPrompt: "two animals in an office breakroom",
    fps: 24,
    durationFrames: 241,
    retake: {
      file: "aurea/take.mp4",
      atFrame: 72,
      lengthFrames: 48,
      prompt: "the gorilla raises his mug",
      sourceDurationFrames: 241,
      strength: 1,
    },
  });
  check(
    "the retake tiles [anchor | fix | anchor]",
    retake.local_prompts ===
      "two animals in an office breakroom|the gorilla raises his mug|two animals in an office breakroom" &&
      retake.segment_lengths === "72, 48, 121" &&
      retake.guide_strength === "0.00, 1.00, 0.00",
    `${retake.segment_lengths} / ${retake.guide_strength}`,
  );
  const rdata = JSON.parse(retake.timeline_data) as Record<string, unknown>;
  check(
    "the source take rides along with its own length",
    rdata.retakeMode === true &&
      rdata.retakeStart === 72 &&
      rdata.retakeLength === 48 &&
      JSON.stringify(rdata.retakeVideo) ===
        JSON.stringify({
          fileName: "take.mp4",
          imageFile: "aurea/take.mp4",
          videoDurationFrames: 241,
        }),
    JSON.stringify(rdata.retakeVideo),
  );
  const rgraph = directorGraph({
    timeline: retake,
    negativePrompt: "ugly",
    fps: 24,
    durationFrames: 241,
    width: 896,
    height: 704,
    seed: 1,
    hasCustomAudio: false,
    inpaintAudio: false,
    hasIcLoraTrack: false,
    isRetake: true,
    models: null,
  });
  check(
    "both passes are told it's a retake",
    (rgraph.guide_base.inputs as Record<string, unknown>).retake_mode === true &&
      (rgraph.guide_refine.inputs as Record<string, unknown>).retake_mode === true,
  );
  check(
    "keeping the original sound means no audio inpainting",
    (rgraph.director.inputs as Record<string, unknown>).inpaint_audio === false,
  );
}

/* the IC-LoRA name has to be the server's own spelling — on Windows the combo
 * list arrives with backslashes and ComfyUI validates against it verbatim */
{
  const client = new ComfyClient("http://127.0.0.1:8000");
  if (await client.health()) {
    const name = await resolveIcLora(client, "motionTrack");
    check(
      "the running ComfyUI names its motion-track IC-LoRA",
      !!name && /ic-lora/i.test(name) && /motion-track/i.test(name),
      name ?? "not found",
    );
    const options = await client.comboOptions("LTXDirectorGuide", "ic_lora_name");
    check(
      "and that name is one it offers",
      !!name && options.includes(name),
      `${options.length} loras on its path`,
    );
  } else {
    console.log("SKIP  IC-LoRA name probe — no ComfyUI on :8000");
  }
}

/** node 25 asserts inside libuv if a process.exit() lands while a keep-alive
 * socket from the probes above is still closing — let it settle first, so the
 * exit code a caller reads is ours and not 127 */
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
check("and has the motion IC-LoRAs", caps.icLora, caps.note ?? "");
if (!caps.director) process.exit(1);

const assets = (await api.library.list.query()).assets;
const find = (name: string) => {
  const a = assets.find((x) => x.name === name || x.relPath.endsWith(name));
  if (!a) throw new Error(`missing library asset: ${name}`);
  return a.relPath;
};
const project = (await api.projects.list.query())[0].id;

/** 64×64 grayscale frames, so motion can be measured without decoding pixels
 * we don't need. Returns one Uint8Array per frame. */
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

/** 0.1s RMS windows of the soundtrack, in dB — enough to see where the lines
 * are without comparing samples a VAE round trip will never reproduce */
function audioEnvelope(file: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
      { maxBuffer: 1 << 28, encoding: "buffer", windowsHide: true },
      (err, stdout) => {
        if (err) return reject(err);
        const pcm = new Float32Array(
          stdout.buffer,
          stdout.byteOffset,
          Math.floor(stdout.length / 4),
        );
        const win = 1600;
        const out: number[] = [];
        for (let i = 0; i + win <= pcm.length; i += win) {
          let sum = 0;
          for (let j = 0; j < win; j += 1) sum += pcm[i + j] ** 2;
          out.push(Math.sqrt(sum / win));
        }
        resolve(out);
      },
    );
  });
}

/** frame-to-frame change through a clip — its own motion, in pixels */
const steps = (fs_: Uint8Array[]) => fs_.slice(1).map((f, i) => meanAbs(f, fs_[i]));

/** how much each frame moves against the one before it — a shot's motion over
 * time, normalised so two clips of different brightness compare */
function motionCurve(fs_: Uint8Array[]): number[] {
  const curve: number[] = [];
  for (let i = 1; i < fs_.length; i += 1) curve.push(meanAbs(fs_[i], fs_[i - 1]));
  const peak = Math.max(...curve, 1e-6);
  return curve.map((v) => v / peak);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** Pearson r between two curves, resampled onto the shorter one */
function correlate(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 4) return 0;
  const at = Array.from({ length: n }, (_, i) => a[Math.round((i * (a.length - 1)) / (n - 1))]);
  const bt = Array.from({ length: n }, (_, i) => b[Math.round((i * (b.length - 1)) / (n - 1))]);
  const ma = mean(at);
  const mb = mean(bt);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    num += (at[i] - ma) * (bt[i] - mb);
    da += (at[i] - ma) ** 2;
    db += (bt[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

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

/* ---- 1: motion transfer ---- */
if (wants("motion")) {
  const hero = find("barney-gpt-S1.png");
  const reference = find("ther-pinguin-say-it-loud-and-then-gives-a-k.mp4");
  const refFrames = await frames(path.join(dataRoot, reference));
  console.log(`motion reference: ${reference} (${refFrames.length} frames)`);

  const prompt =
    "Barney, an anthropomorphic green snake in a black leather jacket with sunglasses pushed " +
    "up on his head, coiled upright on a bare studio stage, plain seamless backdrop, soft key " +
    "light, gesturing with both arms.";
  const shot = {
    project,
    prompt,
    startFrame: hero,
    durationSec: 5,
    resolution: "704 × 896 (portrait)",
    seed: 7171,
  };
  const out = reuse("motion") ?? await render("motion", {
    ...shot,
    director: {
      globalPrompt: prompt,
      fps: 24,
      keyframes: [{ image: hero, atSec: 0, strength: 1 }],
      motion: {
        video: reference,
        atSec: 0,
        lengthSec: 5,
        trimStartSec: 0,
        icLora: "motionTrack",
        strength: 1,
        useItsAudio: false,
      },
      inpaintAudio: true,
    },
  });

  /* A correlation on its own proves nothing — two clips that both start still
   * and end busy will agree by accident. --control renders the SAME seed,
   * keyframe and prompt with the motion track off, so the number that matters
   * is the gap between guided and unguided. */
  const control = process.argv.includes("--control")
    ? await render("motion control (no reference)", {
        ...shot,
        director: {
          globalPrompt: prompt,
          fps: 24,
          keyframes: [{ image: hero, atSec: 0, strength: 1 }],
          inpaintAudio: true,
        },
      })
    : null;

  if (out) {
    const refCurve = motionCurve(refFrames);
    const r = correlate(refCurve, motionCurve(await frames(out)));
    if (control) {
      const rControl = correlate(refCurve, motionCurve(await frames(control)));
      check(
        "the reference — not chance — is what the render is following",
        r > rControl + 0.15,
        `guided r = ${r.toFixed(3)} vs unguided r = ${rControl.toFixed(3)}`,
      );
      console.log(`CONTROL ${control}`);
    } else {
      console.log(`  motion-curve r = ${r.toFixed(3)} (run --control to make this mean something)`);
    }
    check("the motion shot rendered a take", true, out);
    console.log(`OUTPUT ${out}`);
  }
}

/* ---- 2: retake ---- */
if (wants("retake")) {
  const source = find("a-regal-lion-in-a-blue-velvet-blazer-and-a.mp4");
  const sourcePath = path.join(dataRoot, source);
  const srcFrames = await frames(sourcePath);
  const FPS = 24;
  const FROM = 3;
  const LENGTH = 2;
  console.log(`retake source: ${source} (${srcFrames.length} frames)`);

  const prompt =
    "A regal lion in a blue velvet blazer and a burly gorilla in a mint hoodie stand in an " +
    "office breakroom beside the coffee machine, warm sitcom lighting, static two-shot.";
  const out = reuse("retake") ?? await render("retake", {
    project,
    prompt,
    // deliberately wrong: a retake takes its length and size off the source
    durationSec: 5,
    resolution: "1280 × 720 (landscape)",
    seed: 909,
    director: {
      globalPrompt: prompt,
      fps: FPS,
      keyframes: [],
      promptZones: [],
      audio: [],
      retake: {
        source,
        atSec: FROM,
        lengthSec: LENGTH,
        prompt:
          "The gorilla in the mint hoodie lifts his mug and takes a long sip; the lion watches him.",
        strength: 1,
        regenerateAudio: false,
      },
      inpaintAudio: false,
    },
  });

  if (out) {
    const outFrames = await frames(out);
    check(
      "the retake is the same length as the take it fixes",
      Math.abs(outFrames.length - srcFrames.length) <= 8,
      `${outFrames.length} frames vs ${srcFrames.length}`,
    );

    /* the point of a retake: only the marked window changes. Measured against
     * the original frame by frame, so a full re-roll dressed up as a retake
     * fails here rather than looking fine in a thumbnail. */
    const n = Math.min(outFrames.length, srcFrames.length);
    const diff = Array.from({ length: n }, (_, i) => meanAbs(outFrames[i], srcFrames[i]));
    /* The window bleeds up to 8 pixel frames EARLIER than marked: the latent
     * covering the in-point starts a stride before it, and freeing that latent
     * frees all 8 of its pixels. So "outside" is measured a stride clear of
     * both edges — inside that margin, change is expected, not a fault. */
    const STRIDE = 8;
    const from = FROM * FPS;
    const to = (FROM + LENGTH) * FPS;
    const inWindow = (i: number) => i >= from && i < to;
    const inside = mean(diff.filter((_, i) => inWindow(i)));
    const outside = mean(
      diff.filter(
        (_, i) => !inWindow(i) && Math.abs(i - from) > STRIDE && Math.abs(i - to) > STRIDE,
      ),
    );
    check("the window changed", inside > 2, `mean pixel change inside = ${inside.toFixed(2)} / 255`);
    check(
      "everything outside the window is the original take",
      outside < 6 && inside > outside * 1.8,
      `outside = ${outside.toFixed(2)}, inside = ${inside.toFixed(2)}`,
    );

    /* Seamlessness, the criterion that decides whether a retake is usable: the
     * join must not read as a cut. Compared against the take's OWN biggest
     * frame-to-frame jump — if the seam moves less than the shot already moves
     * somewhere else, there's nothing for the eye to catch. */
    const outStep = steps(outFrames);
    const srcStep = steps(srcFrames);
    const near = (edge: number) => Math.max(...outStep.slice(edge - STRIDE, edge + STRIDE));
    const busiest = Math.max(...srcStep);
    const seam = Math.max(near(from), near(to));
    check(
      "the join doesn't read as a cut",
      seam < busiest,
      `seam step ${seam.toFixed(2)} vs the take's own busiest frame ${busiest.toFixed(2)}`,
    );

    /* audio was left alone (regenerateAudio: false), so both lines must still
     * be there and still where they were. It does make one VAE round trip,
     * which is why this is an envelope correlation and not a sample compare —
     * and why stacking retakes on one take will slowly dull its sound. */
    const envelopeR = correlate(
      await audioEnvelope(sourcePath),
      await audioEnvelope(out),
    );
    check(
      "the original dialogue survived untouched",
      envelopeR > 0.85,
      `loudness-envelope r = ${envelopeR.toFixed(3)}`,
    );

    const worst = diff.reduce((m, d, i) => (!inWindow(i) && d > m.d ? { d, i } : m), { d: 0, i: -1 });
    console.log(
      `  per-frame change: outside ${outside.toFixed(2)}, inside ${inside.toFixed(2)}, ` +
        `worst preserved frame ${worst.i} at ${worst.d.toFixed(2)}`,
    );
    console.log(`OUTPUT ${out}`);
  }
}

await finish();
