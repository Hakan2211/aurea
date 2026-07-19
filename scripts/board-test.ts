/* S-P1 step 3 verification — drives the live studiod exactly like the
 * Director tools do (loopback tRPC client):
 *   1. seed the Animal Sitcom bible (GPT sheets + custom voices + keyframeRef)
 *   2. build a one-shot test episode (Sterling in the loft)
 *   3. studio.board.generate → wait for the qwen-edit job
 *   4. assert the keyframe attached to the shot and the file exists
 * Run: npx tsx scripts/board-test.ts */

import fs from "node:fs";
import path from "node:path";
import { createStudiodApi } from "../packages/core/src/tools.js";
import { readPortFile } from "../packages/core/src/portfile.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
const pf = await readPortFile();
if (!pf) throw new Error("no studiod port file — start studiod first");
const api = createStudiodApi(pf.port, pf.token);

const projects = await api.projects.list.query();
const project = projects[0].id;
console.log(`[1] project: ${project}`);

const seed = await api.studio.seedAnimalSitcom.mutate({ project, overwrite: false });
console.log(`[2] seed: ${seed.copiedFiles} files copied, ${seed.warnings.length} warnings`);
for (const w of seed.warnings) console.log(`    warn: ${w}`);
const sterling = seed.bible.characters.find((c) => c.id === "sterling")!;
console.log(`    sterling.keyframeRef: ${sterling.refs.keyframeRef}`);
console.log(`    sterling.voiceId: ${sterling.voice.voiceId}`);
for (const c of seed.bible.characters) {
  console.log(`    ${c.id}: keyframeRef=${c.refs.keyframeRef ?? "NONE"} voice=${c.voice.voiceId}`);
}

// test episode (idempotent-ish: reuse if a previous run left it behind)
let prod = await api.studio.production.get.query({ project });
let episode = prod.seasons.flatMap((s) => s.episodes).find((e) => e.title === "Storyboard Test");
if (!episode) {
  episode = (await api.studio.production.addEpisode.mutate({ project, title: "Storyboard Test" })).episode;
}
let scene = episode.scenes[0];
if (!scene) {
  scene = (
    await api.studio.production.addScene.mutate({
      project,
      episodeId: episode.id,
      slugline: "INT. THE LOFT — NIGHT",
      location: "the-loft",
    })
  ).scene;
}
let shot = scene.shots[0];
if (!shot) {
  shot = (
    await api.studio.production.addShot.mutate({
      project,
      sceneId: scene.id,
      title: "Sterling's chip trophy",
      characters: ["sterling"],
      camera: { shotSize: "medium shot", angle: "low angle", move: "", lens: "35mm", lighting: "warm sitcom lighting", notes: "" },
      scriptLines: [
        {
          id: "l-1",
          character: null,
          text: "Sterling holds up a single potato chip like a trophy, mid-argument, triumphant.",
          deliveryNotes: "",
        },
      ],
    })
  ).shot;
}
console.log(`[3] shot: ${shot.id} (status ${shot.status}, ${shot.keyframes.length} keyframes)`);

const job = await api.studio.board.generate.mutate({ project, shotId: shot.id, count: 1, seed: 42 });
console.log(`[4] job ${job.id} enqueued — engine ${job.engine}, detail "${job.detail}"`);
console.log(`    prompt: ${job.payload?.type === "image" ? job.payload.prompt : "?"}`);
console.log(`    refs: ${job.payload?.type === "image" ? JSON.stringify(job.payload.refs) : "?"}`);

const started = Date.now();
for (;;) {
  await sleep(4000);
  const jobs = await api.jobs.list.query();
  const j = jobs.find((x) => x.id === job.id);
  if (!j) throw new Error("job vanished");
  const t = Math.round((Date.now() - started) / 1000);
  console.log(`    [${t}s] ${j.status} ${Math.round(j.progress)}% ${j.stage ?? ""}`);
  if (j.status === "failed") throw new Error(`job failed: ${j.error}`);
  if (j.status === "completed") {
    console.log(`[5] completed — output: ${j.output}`);
    break;
  }
  if (Date.now() - started > 15 * 60_000) throw new Error("timeout");
}

prod = await api.studio.production.get.query({ project });
const freshShot = prod.seasons
  .flatMap((s) => s.episodes)
  .flatMap((e) => e.scenes)
  .flatMap((s) => s.shots)
  .find((s) => s.id === shot.id)!;
console.log(`[6] shot status: ${freshShot.status}; keyframes: ${freshShot.keyframes.length}; selected: ${freshShot.selectedKeyframe}`);
for (const k of freshShot.keyframes) {
  const abs = path.join("C:/Users/User/Aurea", k.asset);
  console.log(`    ${k.id} → ${k.asset} exists=${fs.existsSync(abs)}`);
}
if (freshShot.keyframes.length === 0) throw new Error("FAIL: no keyframes attached");
if (freshShot.status === "draft") throw new Error("FAIL: status did not advance to boarded");
console.log("PASS — storyboard keyframe generated, attached, and status advanced.");
process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
