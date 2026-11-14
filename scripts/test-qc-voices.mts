/* qc.sceneVoices smoke — seeds a temporary playground shot whose lines point
 * at real wav assets, runs the check, and removes the shot again. Boots its
 * own studiod from source (no port file), like test-qc.mts.
 *
 *   npx tsx scripts/test-qc-voices.mts
 */

const { startStudiod } = await import("../packages/core/src/server.js");
const { createStudiodApi } = await import("../packages/core/src/tools.js");

const handle = await startStudiod({ port: 0, writePortFile: false });
const api = createStudiodApi(handle.port, handle.token);
const project = "playground";

try {
  const wavs = (await api.library.list.query()).assets.filter(
    (a) => a.kind === "audio" && a.relPath.endsWith(".wav"),
  );
  if (wavs.length < 2) throw new Error("need at least 2 wav assets somewhere to test with");
  console.log("takes:", wavs[0].relPath, "+", wavs[1].relPath);

  const prod = await api.studio.production.get.query({ project });
  const scene = prod.seasons[0]?.episodes[0]?.scenes[0];
  if (!scene) throw new Error("playground has no scene");

  const { shot } = await api.studio.production.addShot.mutate({
    project,
    sceneId: scene.id,
    title: "QC voices smoke",
    scriptLines: [
      { id: "l1", character: "sterling", text: "The fund is not missing. It is resting.", deliveryNotes: "" },
      { id: "l2", character: "sterling", text: "Short.", deliveryNotes: "" },
      { id: "l3", character: "milo", text: "This line has no take yet.", deliveryNotes: "" },
    ],
    characters: ["sterling", "milo"],
  });
  try {
    await api.studio.production.updateShot.mutate({
      project,
      shotId: shot.id,
      patch: {
        voTakes: [
          { id: "v1", asset: wavs[0].relPath, engine: "chatterbox", label: "", lineId: "l1" },
          { id: "v2", asset: wavs[1].relPath, engine: "chatterbox", label: "", lineId: "l2" },
        ],
      },
    });
    const r = await api.qc.sceneVoices.mutate({ project, sceneId: scene.id });
    console.log("verdict:", r.verdict);
    for (const l of r.lines) {
      console.log(
        `  ${l.character} "${l.text.slice(0, 40)}" — ${l.takeId ? `${l.durationSec}s f0=${l.f0Hz}Hz voiced=${l.voicedRatio} rms=${l.rmsDb}dB peak=${l.peakDb}dB` : "no take"}${l.flags.length ? `\n    FLAGS: ${l.flags.join(" | ")}` : ""}`,
      );
    }
    console.log("characters:", JSON.stringify(r.characters));
    console.log("retakeLineIds:", JSON.stringify(r.retakeLineIds));
    console.log("notes:", JSON.stringify(r.notes));
  } finally {
    await api.studio.production.removeShot.mutate({ project, id: shot.id });
    console.log("cleanup: shot removed");
  }
} finally {
  await handle.close();
}
