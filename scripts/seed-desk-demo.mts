/* Seed (or clean) a playground shot the Desk drawer can be exercised on:
 * two video takes + a keyframe + a voiced line. Run:
 *   npx tsx scripts/seed-desk-demo.mts        → seeds, prints the shot id
 *   npx tsx scripts/seed-desk-demo.mts clean  → removes every smoke shot + its clips */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { createStudiodApi } = await import("../packages/core/src/tools.js");

const pf = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".aurea", "studiod.json"), "utf8"),
) as { port: number; token: string };
const api = createStudiodApi(pf.port, pf.token);
const project = "playground";
const TITLE = "Desk drawer demo";

const prod = await api.studio.production.get.query({ project });
const scene = prod.seasons[0]?.episodes[0]?.scenes[0];
if (!scene) throw new Error("playground has no scene");

if (process.argv[2] === "clean") {
  for (const s of scene.shots.filter((x) => x.title === TITLE)) {
    await api.studio.production.removeShot.mutate({ project, id: s.id });
    console.log("removed shot", s.id);
  }
  const tl = await api.timeline.get.query({ project });
  for (const t of tl.tracks)
    for (const c of t.clips.filter((c) => c.label === TITLE)) {
      await api.timeline.removeClip.mutate({ project, clip: c.id });
      console.log("removed clip", c.id);
    }
  process.exit(0);
}

const { assets } = await api.library.list.query();
const vids = assets.filter((a) => a.kind === "video" && a.project === project).slice(0, 2);
const img = assets.find((a) => a.kind === "image" && a.project === project);
const wav = assets.find((a) => a.kind === "audio" && a.project === project);
if (vids.length < 2 || !img) throw new Error("need 2 videos + 1 image in playground");

const { shot } = await api.studio.production.addShot.mutate({
  project,
  sceneId: scene.id,
  title: TITLE,
  characters: ["sterling"],
  scriptLines: [{ id: "dl1", character: "sterling", text: "This board runs itself now.", deliveryNotes: "" }],
});
await api.studio.production.updateShot.mutate({
  project,
  shotId: shot.id,
  patch: {
    keyframes: [{ id: "kf1", asset: img.relPath, approved: true }],
    selectedKeyframe: "kf1",
    videoTakes: [
      { id: "tk1", asset: vids[0].relPath, engine: "ltx2", label: "take one" },
      { id: "tk2", asset: vids[1].relPath, engine: "ltx2", label: "take two" },
    ],
    voTakes: wav
      ? [{ id: "vo1", asset: wav.relPath, engine: "chatterbox", label: "", lineId: "dl1" }]
      : [],
    selectedTake: "tk2",
    status: "generated",
  },
});
console.log("seeded shot", shot.id, "in scene", scene.id);
