/* QC P2 smoke test — exercises the real ffmpeg paths against real takes.
 *
 * The running app's studiod is a stale bundle whenever this is fresh code, so
 * this boots its OWN studiod in-process from source (port 0, NO port file — the
 * app's discovery is untouched) and calls qc.shot / qc.sceneVoices through the
 * same tRPC surface the tools use. qc.* only ever writes under <dataRoot>/qc/,
 * so running beside the live app is safe.
 *
 *   npx tsx scripts/test-qc.mts [projectId]
 */

const { startStudiod } = await import("../packages/core/src/server.js");
const { createStudiodApi } = await import("../packages/core/src/tools.js");

const handle = await startStudiod({ port: 0, writePortFile: false });
const api = createStudiodApi(handle.port, handle.token);

try {
  const wanted = process.argv[2];
  const projects = (await api.projects.list.query()).map((p) => p.id);
  const candidates = wanted ? [wanted] : projects;

  // find a shot with a rendered take, and a scene with voiced lines
  let shotTarget: { project: string; shotId: string } | null = null;
  let voiceTarget: { project: string; sceneId: string } | null = null;
  for (const project of candidates) {
    const prod = await api.studio.production.get.query({ project });
    for (const season of prod.seasons) {
      for (const episode of season.episodes) {
        for (const scene of episode.scenes) {
          if (!voiceTarget && scene.shots.some((s) => s.voTakes.length)) {
            voiceTarget = { project, sceneId: scene.id };
          }
          const shot = scene.shots.find((s) => s.videoTakes.length);
          if (!shotTarget && shot) shotTarget = { project, shotId: shot.id };
        }
      }
    }
  }

  if (shotTarget) {
    console.log(`\n=== qc.shot — ${shotTarget.project}/${shotTarget.shotId} ===`);
    const r = await api.qc.shot.mutate(shotTarget);
    console.log("verdict:", r.verdict);
    for (const c of r.checks) console.log(`  [${c.status}] ${c.id}: ${c.detail}`);
    console.log("cuts:", r.cuts.map((c) => `${c.t.toFixed(2)}s(${c.score.toFixed(2)})`).join(", ") || "none");
    for (const a of r.articulation) {
      console.log(`  articulation ${a.label}: ${a.vsClipMedian}× clip median${a.suspect ? "  ← SUSPECT" : ""}`);
    }
    console.log("sheet:", r.artifacts.contactSheet);
    console.log("cut frames:", r.artifacts.cutFrames.length, "· cast refs:", r.artifacts.castRefs.length);
  } else {
    console.log("no shot with a rendered take found — qc.shot not exercised");
  }

  if (voiceTarget) {
    console.log(`\n=== qc.sceneVoices — ${voiceTarget.project}/${voiceTarget.sceneId} ===`);
    const r = await api.qc.sceneVoices.mutate(voiceTarget);
    console.log("verdict:", r.verdict);
    for (const l of r.lines) {
      console.log(
        `  ${l.character} "${l.text.slice(0, 36)}" — ${l.takeId ? `${l.durationSec}s f0=${l.f0Hz}Hz voiced=${l.voicedRatio} rms=${l.rmsDb}dB` : "no take"}${l.flags.length ? ` FLAGS: ${l.flags.join(" | ")}` : ""}`,
      );
    }
    console.log("characters:", JSON.stringify(r.characters));
    console.log("retakeLineIds:", JSON.stringify(r.retakeLineIds));
  } else {
    console.log("no scene with voice takes found — qc.sceneVoices not exercised");
  }
} finally {
  await handle.close();
}
