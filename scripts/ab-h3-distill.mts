/* V4.2 experiment #2 — Standard tier on H3's fl2va head: Tutu's 20→8 NFE
 * distill against the shipped LightX2V 8-step v1.0, at one seed.
 *
 * The claim under test is not speed. Both weights run 8 steps; Tutu's card
 * claims it KEEPS the stereo audio and the lip-sync that a generic few-step
 * distill trades away, which for a Zoo Logic interview single is the whole
 * question. So the score below is audio-first.
 *
 * Why the articulation measure is built here rather than read off qc.shot:
 * qc's articulation check reads the shot's PLACED voice takes to know when
 * someone is speaking, and an H3 take has none — it generates its dialogue in
 * the same pass. So the speech windows are recovered from the take's own
 * audio (measureVoice's voiced frames) and fed to the same shipped
 * assessArticulation. If this proves out it belongs in qc.shot.
 *
 * KNOWN LIMIT OF THE NUMBER, learnt the hard way on this experiment's first
 * run: scene-change energy cannot tell a moving MOUTH from a moving CAMERA.
 * A take that pushes in harder scores higher on "articulation" while its lips
 * barely part, and the ratio is against the clip's own median, so a stiller
 * take inflates it twice over. The number is a screen, not a verdict — read
 * the frame strip this script writes before believing it.
 *
 *   npx tsx scripts/ab-h3-distill.mts [--round=…]  # queue, watch, score
 *   npx tsx scripts/ab-h3-distill.mts <runId>      # re-score an existing run
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assessArticulation,
  measureVoice,
  parseSceneScores,
  parseVolume,
  type SpeechWindow,
} from "../packages/core/src/qc.js";

const { createStudiodApi } = await import("../packages/core/src/tools.js");

const pf = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".aurea", "studiod.json"), "utf8"),
) as { port: number; token: string };
const api = createStudiodApi(pf.port, pf.token);

const PROMPT =
  "Stylized 3D animation, Pixar feature quality, documentary interview: Milo, the small sandy " +
  "meerkat in the mustard beanie and rust-and-cream striped sweater, sits alone at the " +
  "recording booth table, leans into the microphone and says clearly, \"We put the money in " +
  "the jar every week, and every week the jar is lighter.\" He holds still afterwards and " +
  "looks off camera. Warm lamplight, shallow depth of field, quiet room tone under his voice.";

const ff = (args: string[]) =>
  new Promise<string>((resolve) => {
    execFile("ffmpeg", args, { maxBuffer: 64 * 1024 * 1024 }, (_e, stdout, stderr) =>
      resolve(`${stdout}\n${stderr}`),
    );
  });

/** The take's own speech, recovered from its audio: 40 ms frames, voiced by
 * measureVoice's own rule, merged into windows and anything under a fifth of
 * a second dropped as a click rather than a word. */
async function speechWindows(file: string): Promise<{ windows: SpeechWindow[]; voiced: number }> {
  const raw = path.join(os.tmpdir(), `ab-voice-${path.basename(file)}.pcm`);
  await ff(["-y", "-i", file, "-ac", "1", "-ar", "16000", "-f", "f32le", raw]);
  const buf = fs.readFileSync(raw);
  fs.rmSync(raw, { force: true });
  const x = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
  const rate = 16000;
  const win = Math.round(0.04 * rate);
  const hop = Math.round(0.02 * rate);
  const windows: SpeechWindow[] = [];
  let voicedFrames = 0;
  let frames = 0;
  let open: number | null = null;
  for (let start = 0; start + win <= x.length; start += hop) {
    frames++;
    const frame = x.subarray(start, start + win);
    const m = measureVoice(frame, rate);
    const on = m.voicedRatio > 0;
    if (on) voicedFrames++;
    const t = start / rate;
    if (on && open === null) open = t;
    if (!on && open !== null) {
      if (t - open >= 0.2) windows.push({ atSec: open, endSec: t, label: `speech ${open.toFixed(1)}s` });
      open = null;
    }
  }
  if (open !== null) {
    const end = x.length / rate;
    if (end - open >= 0.2) windows.push({ atSec: open, endSec: end, label: `speech ${open.toFixed(1)}s` });
  }
  return { windows, voiced: frames ? voicedFrames / frames : 0 };
}

async function score(file: string) {
  const vol = parseVolume(await ff(["-i", file, "-af", "volumedetect", "-f", "null", "-"]));
  const series = parseSceneScores(
    await ff([
      "-i", file,
      "-filter_complex", "select='gte(scene,0)',metadata=print:file=-",
      "-an", "-f", "null", "-",
    ]),
  );
  const { windows, voiced } = await speechWindows(file);
  const art = assessArticulation(series, windows);
  const rel = art.map((a) => a.vsClipMedian).filter((n): n is number => n !== null);
  return {
    meanDb: vol.meanDb,
    peakDb: vol.peakDb,
    voiced,
    windows: windows.length,
    speechSec: windows.reduce((s, w) => s + (w.endSec - w.atSec), 0),
    articulation: rel.length ? rel.reduce((s, n) => s + n, 0) / rel.length : null,
    suspect: art.filter((a) => a.suspect).length,
  };
}

/* Rounds. `tutu` is the original V4.2 experiment #2 and stays the default so
 * a bare re-run means what it always meant. The 2026-11-10 rounds pit the
 * shipped tier against the autumn candidates (MINIMAX_ALT_DISTILL); each one
 * stays inside one tier and one head, because a candidate refuses anywhere
 * else.
 *
 *   npx tsx scripts/ab-h3-distill.mts --round=standard   # fl2va, 8-ish steps
 *   npx tsx scripts/ab-h3-distill.mts --round=draft      # fl2va, 4 steps
 *   npx tsx scripts/ab-h3-distill.mts --round=ref        # ref2va, Standard
 */
const STILL = "projects/zoo-logic/assets/image/put-both-characters-into-the-recording-boot.png";
type Round = {
  title: string;
  notes: string;
  base: Record<string, unknown>;
  variants: { label: string; overrides: Record<string, unknown> }[];
};
const ROUNDS: Record<string, Round> = {
  tutu: {
    title: "H3 Standard distill — Tutu 20→8 NFE (3 checkpoints) vs LightX2V 8-step",
    notes:
      "Same interview single, one seed, Standard tier on the fl2va head. The control is the " +
      "shipped LightX2V 8-step v1.0 on res_multistep; the candidate is Tutu's 20→8 NFE " +
      "weight under its published contract (euler, strength 0.8, shift 12/3, nine fixed " +
      "sigmas). Scored on audio level, voiced share and motion inside the take's own speech.",
    base: { startFrame: STILL, minimaxTier: "standard" },
    variants: [
      { label: "LightX2V 8-step (shipped)", overrides: {} },
      { label: "Tutu step100", overrides: { minimaxDistill: "tutu-8step" } },
      { label: "Tutu step200", overrides: { minimaxDistill: "tutu-8step-200" } },
      { label: "Tutu step300", overrides: { minimaxDistill: "tutu-8step-300" } },
    ],
  },
  standard: {
    title: "H3 Standard — shipped 12/3 vs publisher 6/3, LightX2V v1.1, HyperFlow, v4 6-step",
    notes:
      "fl2va head, one seed. The first variant is the control; the second is the SAME weight " +
      "under LightX2V's own published recipe (shift 6/3, euler) — if it wins, the shipped " +
      "Standard tier has been on the wrong shift. Then the Oct v1.1 8-step, HyperFlow on its " +
      "own ladder, and drbaph's v4 at 6 steps (watch its wall clock).",
    base: { startFrame: STILL, minimaxTier: "standard" },
    variants: [
      { label: "LightX2V 8-step v1.0 @12/3 (shipped)", overrides: {} },
      { label: "LightX2V 8-step v1.0 @6/3 (publisher)", overrides: { minimaxDistill: "lightx2v-8step-v1.0-shift6" } },
      { label: "LightX2V 8-step v1.1", overrides: { minimaxDistill: "lightx2v-8step-v1.1" } },
      { label: "HyperFlow 8-step", overrides: { minimaxDistill: "hyperflow-8step" } },
      { label: "drbaph v4 · 6-step", overrides: { minimaxDistill: "drbaph-v4-6step" } },
    ],
  },
  draft: {
    title: "H3 Draft — LightX2V 4-step v1.1 (shipped) vs v1.2",
    notes: "fl2va head, one seed. v1.2's release claims cleaner, more stable audio at the same 4 steps.",
    base: { startFrame: STILL, minimaxTier: "draft" },
    variants: [
      { label: "LightX2V 4-step v1.1 (shipped)", overrides: {} },
      { label: "LightX2V 4-step v1.2", overrides: { minimaxDistill: "lightx2v-4step-v1.2" } },
    ],
  },
  ref: {
    title: "H3 Standard on the reference head — 4-step ref2v run at 8 vs true 8-step ref2v vs HyperFlow",
    notes:
      "ref2va head, the Zoo Logic booth still as <Picture 1>, one seed. The shipped Standard " +
      "reference render is a 4-step distill given 8 steps; LightX2V's ref2v 8-step v1.0 is the " +
      "first weight actually distilled for it.",
    base: { minimaxRefs: { images: [STILL] }, minimaxTier: "standard" },
    variants: [
      { label: "ref2v 4-step v0.1 @8 (shipped)", overrides: {} },
      { label: "ref2v 8-step v1.0", overrides: { minimaxDistill: "lightx2v-8step-v1.1" } },
      { label: "HyperFlow 8-step", overrides: { minimaxDistill: "hyperflow-8step" } },
    ],
  },
};
const roundArg = process.argv.find((a) => a.startsWith("--round="))?.slice("--round=".length) ?? "tutu";
const round = ROUNDS[roundArg];
if (!round) {
  console.error(`unknown round "${roundArg}" — one of ${Object.keys(ROUNDS).join(", ")}`);
  process.exit(1);
}
const existing = process.argv.slice(2).find((a) => !a.startsWith("--"));
const run = existing
  ? (await api.labs.video.abGet.query({ id: existing }))!
  : await api.labs.video.ab.mutate({
      project: "zoo-logic",
      title: round.title,
      notes: round.notes,
      base: {
        // the reference round names the still as <Picture 1>; the others start on it
        prompt: round.base.minimaxRefs ? `Use <Picture 1> as the scene and its characters. ${PROMPT}` : PROMPT,
        engine: "minimax-h3",
        durationSec: 5,
        resolution: "1344 × 768",
        ...round.base,
      } as never,
      variants: round.variants as never,
    });

if (!existing) {
  console.log(`run ${run.id}  seed ${run.seed}`);
  let last = "";
  for (;;) {
    await new Promise((r) => setTimeout(r, 10_000));
    const now = (await api.labs.video.abGet.query({ id: run.id }))!;
    const line = now.variants.map((v) => `${v.label}=${v.status}`).join("  |  ");
    if (line !== last) {
      last = line;
      console.log(`[${new Date().toLocaleTimeString()}] ${line}`);
    }
    if (now.variants.every((v) => v.status === "completed" || v.status === "failed")) break;
  }
}

const settled = (await api.labs.video.abGet.query({ id: run.id }))!;
console.log("\n--- scored ---");
for (const v of settled.variants) {
  if (v.status !== "completed" || !v.output) {
    console.log(`${v.label}: ${v.status} — ${v.error ?? "no output"}`);
    continue;
  }
  const s = await score(v.output);
  // the frame strip is the primary evidence — see the note in the header
  const strip = path.join(os.tmpdir(), `ab-strip-${path.basename(v.output, ".mp4")}.png`);
  await ff([
    "-y", "-ss", "0.8", "-t", "1.6", "-i", v.output,
    "-vf", "fps=6,crop=iw/2:ih/1.4:iw/4:0,scale=380:-2,tile=5x2",
    "-frames:v", "1", strip,
  ]);
  console.log(
    `${v.label}\n` +
      `  time        ${v.renderMs ? (v.renderMs / 1000).toFixed(0) + "s" : "—"}\n` +
      `  audio       mean ${s.meanDb?.toFixed(1)} dB · peak ${s.peakDb?.toFixed(1)} dB\n` +
      `  voiced      ${(s.voiced * 100).toFixed(0)}% of frames · ${s.windows} window(s) · ` +
      `${s.speechSec.toFixed(1)}s of speech\n` +
      `  articulation ${s.articulation === null ? "—" : `${s.articulation.toFixed(2)}× clip median`}` +
      `${s.suspect ? `  (${s.suspect} closed-mouth suspect)` : ""}\n` +
      `  file        ${v.output}
` +
      `  strip       ${strip}`,
  );
}
process.exit(0);
