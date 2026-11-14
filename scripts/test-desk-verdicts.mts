/* Desk P1 verdict smoke test against the live studiod, in the playground
 * sandbox: seed a shot with a real video asset as its take, approve it (clip
 * must land on the sequence), retake-with-note (note must persist and ride the
 * spec), then clean everything up. Run: npx tsx scripts/test-desk-verdicts.mts */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { createStudiodApi } = await import("../packages/core/src/tools.js");

const pf = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".aurea", "studiod.json"), "utf8"),
) as { port: number; token: string };
const api = createStudiodApi(pf.port, pf.token);
const project = "playground";

// a real video asset to stand in as the rendered take
const assets = (await api.library.list.query()).assets.filter(
  (a) => a.kind === "video" && a.project === project,
);
if (!assets.length) throw new Error("no playground video assets to test with");
const asset = assets[0].relPath;
console.log("take asset:", asset);

// the playground production's first scene
const prod = await api.studio.production.get.query({ project });
const scene = prod.seasons[0]?.episodes[0]?.scenes[0];
if (!scene) throw new Error("playground has no scene");

const { shot } = await api.studio.production.addShot.mutate({
  project,
  sceneId: scene.id,
  title: "Desk verdict smoke",
});
console.log("shot:", shot.id);

try {
  // attach a fake rendered take (what attachTake would have done)
  await api.studio.production.updateShot.mutate({
    project,
    shotId: shot.id,
    patch: {
      videoTakes: [{ id: "tk1", asset, engine: "ltx2", label: "smoke" }],
      status: "generated",
    },
  });

  // 1. approve → status approved, selectedTake locked, clip on the sequence
  const approved = await api.studio.production.approveShot.mutate({
    project,
    shotId: shot.id,
    takeId: "tk1",
  });
  console.log(
    "approve:",
    approved.shot.status,
    approved.shot.selectedTake,
    "clip",
    approved.clip.id,
    "on timeline:",
    approved.timeline.tracks.some((t) => t.clips.some((c) => c.id === approved.clip.id)),
  );

  // 2. retake with note → note persists; no keyframe, so no job, note survives
  const retaken = await api.studio.production.retakeShot.mutate({
    project,
    shotId: shot.id,
    note: "tighter framing",
  });
  console.log("retake: job =", retaken.job === null ? "null (no keyframe)" : retaken.job.id);
  console.log("retake notes:", JSON.stringify(retaken.shot.takeNotes));
  console.log("last compose note:", retaken.notes[retaken.notes.length - 1]);

  // clean up the timeline clip
  await api.timeline.removeClip.mutate({ project, clip: approved.clip.id });
  console.log("cleanup: clip removed");
} finally {
  await api.studio.production.removeShot.mutate({ project, id: shot.id });
  console.log("cleanup: shot removed");
}
