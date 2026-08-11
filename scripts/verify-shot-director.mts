/* Does the Shot Director actually render, on whatever engine videoMode points
 * at right now? One short timeline shot (a start keyframe + two prompt zones)
 * through the running app's studiod — so what gets tested is the bundle the
 * app runs, the engine it resolves, and the LTXDirector graph, not src.
 *
 * Written for the managed engine: the first render boots the sidecar, so the
 * first stage can sit at "starting the engine" for a minute before anything
 * moves. Run: npx tsx scripts/verify-shot-director.mts
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { createStudiodApi } = await import("../packages/core/src/tools.js");

const pf = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".aurea", "studiod.json"), "utf8"),
) as { port: number; token: string };
const api = createStudiodApi(pf.port, pf.token);
const dataRoot = path.join(os.homedir(), "Aurea");

const caps = await api.labs.video.capabilities.query();
console.log(`engine: ${caps.mode}, director=${caps.director}, note=${caps.note ?? "-"}`);
if (!caps.director) {
  console.error("the engine has no Director pack — nothing to verify");
  process.exit(1);
}

const project = (await api.projects.list.query())[0].id;
const assets = (await api.library.list.query()).assets;
const still = assets.find((a) => a.kind === "image");
if (!still) {
  console.error("no image in the library to use as a start frame");
  process.exit(1);
}
console.log(`project: ${project}\nstart frame: ${still.relPath}`);

const prompt =
  "A single character seated at a desk in a warmly lit room, talking to camera, " +
  "gentle handheld camera.";

const startedAt = new Date().toISOString();
const job = await api.labs.video.generate.mutate({
  project,
  prompt,
  startFrame: still.relPath,
  durationSec: 4,
  resolution: "704 × 896 (portrait)",
  seed: 4242,
  director: {
    globalPrompt: prompt,
    fps: 24,
    keyframes: [{ image: still.relPath, atSec: 0, strength: 1 }],
    promptZones: [
      { atSec: 0, lengthSec: 2, prompt: "the character leans back, listening" },
      { atSec: 2, lengthSec: 2, prompt: "the character leans in and speaks" },
    ],
    inpaintAudio: true,
  },
});
console.log(`job ${job.id} queued`);

const began = Date.now();
const stages = new Set<string>();
for (;;) {
  const j = (await api.jobs.list.query()).find((x) => x.id === job.id);
  if (!j) throw new Error("job vanished from the queue");
  if (j.stage) {
    if (!stages.has(j.stage)) console.log(`  [${Math.round((Date.now() - began) / 1000)}s] ${j.stage}`);
    stages.add(j.stage);
  }
  if (j.status === "completed" || j.status === "failed") {
    const took = Math.round((Date.now() - began) / 1000);
    if (j.status !== "completed") {
      console.error(`\nFAILED after ${took}s: ${j.error ?? "(no error given)"}`);
      process.exit(1);
    }
    const asset = (await api.library.list.query()).assets.find(
      (a) => a.kind === "video" && a.createdAt >= startedAt,
    );
    if (!asset) {
      console.error("\nrendered but nothing landed in the library");
      process.exit(1);
    }
    const abs = path.join(dataRoot, asset.relPath);
    const bytes = fs.statSync(abs).size;
    console.log(`\nOK — rendered in ${took}s`);
    console.log(`  ${abs} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
    // a "success" that wrote nothing is the ComfyUI failure mode that looks
    // like a pass — see the text-to-video notes
    process.exit(bytes > 100_000 ? 0 : 1);
  }
  if (Date.now() - began > 40 * 60_000) {
    await api.jobs.cancel.mutate({ id: job.id }).catch(() => {});
    console.error("timed out after 40 min");
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 4000));
}
