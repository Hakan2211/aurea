/* Shot Director V4 — the audio lane, end to end.
 *
 *   0. offline: the spec two voice takes make becomes the audioSegments the
 *      LTXDirector node parses, with the mask flags the gaps depend on
 *   1. live: a 10s two-character breakroom take with both cloned-voice lines
 *      locked to their timecodes, rendered in ONE pass through the running
 *      app's studiod (so the bundle is what gets tested, not src)
 *
 * Needs the app running (reads ~/.aurea/studiod.json) and an external ComfyUI
 * with the WhatDreamsCost pack. Run: npx tsx scripts/test-shot-audio.mts
 *
 * --ambient names a sound in the prompt (the coffee machine) without changing
 * anything else. LTX has to invent whatever fills the gaps between the locked
 * takes, and it invents what the prompt describes — the A/B is what tells the
 * difference between "the room tone plumbing is broken" and "nobody asked the
 * room to make a sound". */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { createStudiodApi } = await import("../packages/core/src/tools.js");
const { buildTimelineData } = await import("../packages/core/src/comfy/director-timeline.js");
const { directorGraph } = await import("../packages/core/src/comfy/director-graph.js");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---- 0: offline — the lane's contract with the node ---- */
{
  // 10s at 24fps, snapped: 241 frames. Sterling's line runs 5.32s from 1s,
  // Bruno's 2.32s from 7s — the same numbers the live run below uses.
  const out = buildTimelineData({
    globalPrompt: "breakroom two-shot",
    fps: 24,
    durationFrames: 241,
    keyframes: [{ file: "aurea/two-shot.png", atFrame: 0, strength: 1 }],
    audio: [
      { file: "aurea/sterling.wav", atFrame: 24, lengthFrames: 128 },
      { file: "aurea/bruno.wav", atFrame: 168, lengthFrames: 56 },
    ],
  });
  const data = JSON.parse(out.timeline_data) as {
    audioSegments: Array<{ audioFile: string; start: number; length: number; trimStart: number }>;
  };
  check(
    "both takes land at their timecodes",
    JSON.stringify(data.audioSegments) ===
      JSON.stringify([
        { audioFile: "aurea/sterling.wav", start: 24, length: 128, trimStart: 0 },
        { audioFile: "aurea/bruno.wav", start: 168, length: 56, trimStart: 0 },
      ]),
    JSON.stringify(data.audioSegments),
  );

  const graph = directorGraph({
    timeline: out,
    negativePrompt: "ugly",
    fps: 24,
    durationFrames: 241,
    width: 896,
    height: 704,
    seed: 1,
    hasCustomAudio: true,
    inpaintAudio: true,
    hasMotion: false,
    models: null,
  });
  const director = graph.director.inputs as Record<string, unknown>;
  check(
    "the graph asks for custom audio with the gaps scored",
    director.use_custom_audio === true && director.inpaint_audio === true,
  );
  check(
    "the audio latent reaches the base sampler",
    JSON.stringify((graph.concat_base.inputs as Record<string, unknown>).audio_latent) ===
      JSON.stringify(["director", 3]),
  );
}

/* ---- 1: live — the acceptance shot ---- */
const pf = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".aurea", "studiod.json"), "utf8"),
) as { port: number; token: string };
const api = createStudiodApi(pf.port, pf.token);

const caps = await api.labs.video.capabilities.query();
check("this ComfyUI can run the Director", caps.director, caps.note ?? "");
if (!caps.director) process.exit(1);

const assets = (await api.library.list.query()).assets;
const find = (name: string) => {
  const a = assets.find((x) => x.name === name || x.relPath.endsWith(name));
  if (!a) throw new Error(`missing library asset: ${name}`);
  return a.relPath;
};
const frame = find("breakroom-two-shot.png");
const sterling = find("sterling-decaf-line.wav");
const bruno = find("bruno-heart-line.wav");

const project = (await api.projects.list.query())[0].id;
const startedAt = new Date().toISOString();
const ambient = process.argv.includes("--ambient");
/* --biggap moves the second line late in a 12s take, so the gap between the
 * two is 2.7s instead of 0.7s. The 07-25 runs came back silent between the
 * lines whatever the prompt said; this asks whether the gap was simply too
 * short for the model to put anything in. */
const bigGap = process.argv.includes("--biggap");
const shotSec = bigGap ? 12 : 10;
const brunoAt = bigGap ? 9 : 7;
const room = ambient
  ? " The coffee machine hisses and gurgles steadily in the background, quiet office room tone throughout."
  : "";
const job = await api.labs.video.generate.mutate({
  project,
  prompt:
    "A regal lion in a blue velvet blazer and a burly gorilla in a mint hoodie stand in an office " +
    "breakroom beside the coffee machine, warm sitcom lighting, static camera.",
  startFrame: frame,
  durationSec: shotSec,
  resolution: "896 × 704 (landscape)",
  seed: 4242,
  director: {
    globalPrompt:
      "A regal lion in a blue velvet blazer and a burly gorilla in a mint hoodie in an office " +
      "breakroom, warm sitcom lighting, static two-shot, both characters in frame throughout." +
      room,
    fps: 24,
    keyframes: [{ image: frame, atSec: 0, strength: 1 }],
    // the beats name the speaker, which is what localises lip-sync to one
    // character in a shared frame (proven on the 07-19 breakroom scene)
    promptZones: [
      {
        prompt: "The lion and the gorilla stand facing each other, waiting." + room,
        lengthSec: 1,
      },
      {
        prompt:
          "The lion in the blue blazer talks, mouth moving as he speaks, indignant; the gorilla " +
          "listens in silence, mouth closed.",
        lengthSec: 5.4,
      },
      {
        prompt:
          "The gorilla in the mint hoodie talks, mouth moving as he answers, sheepish; the lion " +
          "listens in silence, mouth closed.",
        lengthSec: shotSec - 6.4,
      },
    ],
    audio: [
      { take: sterling, atSec: 1, trimStartSec: 0 },
      { take: bruno, atSec: brunoAt, trimStartSec: 0 },
    ],
    inpaintAudio: true,
    epsilon: 0.001,
  },
});
console.log(`enqueued ${job.id} — ${shotSec}s, 2 voice takes at 1.0s and ${brunoAt.toFixed(1)}s`);

const stages = new Set<string>();
const began = Date.now();
for (;;) {
  const j = (await api.jobs.list.query()).find((x) => x.id === job.id)!;
  if (j.stage) stages.add(j.stage);
  if (j.status === "completed" || j.status === "failed") {
    const tookSec = Math.round((Date.now() - began) / 1000);
    check("the shot rendered", j.status === "completed", j.error ?? `${tookSec}s`);
    check("timeline stages seen", stages.has("Building the timeline"), [...stages].join(" | "));
    check(
      "mp4 on disk",
      !!j.output && fs.existsSync(j.output) && fs.statSync(j.output).size > 100_000,
      j.output ?? "",
    );
    const asset = (await api.library.list.query()).assets.find(
      (a) => a.kind === "video" && a.createdAt >= startedAt,
    );
    check("take imported into the library", !!asset, asset?.relPath);
    if (asset) console.log(`\nOUTPUT ${path.join(os.homedir(), "Aurea", asset.relPath)}`);
    break;
  }
  if (Date.now() - began > 45 * 60_000) {
    await api.jobs.cancel.mutate({ id: job.id }).catch(() => {});
    check("the shot rendered", false, "timed out after 45 min");
    break;
  }
  await sleep(3000);
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
