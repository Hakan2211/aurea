/* Voice-clone E2E — the dataRoot/voices seam, headless and REAL:
 *
 *   1. labs.voice.add freezes an uploaded wav as <dataRoot>/voices/<id>.wav
 *   2. the voice catalog lists it as cloned/studio (and music singVoices too)
 *   3. guards hold: duplicate name, non-wav bytes, deleting a videofast ref,
 *      traversal-shaped ids
 *   4. labs.voice.generate on the new voice runs managed Chatterbox against
 *      the studio ref clip → wav imported into project assets
 *   5. labs.voice.remove deletes the clip and the roster forgets it
 *
 * The upload payload is a real reference clip (videofast char_refs) so the
 * synthesis leg exercises actual cloning. Run: npx tsx scripts/test-voices.mts
 * [--no-tts to skip the GPU synthesis leg] */

import fs from "node:fs";
import path from "node:path";

const skipTts = process.argv.includes("--no-tts");

const { startStudiod } = await import("../packages/core/src/server.js");
const { createStudiodApi } = await import("../packages/core/src/tools.js");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rejects = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "";
  } catch (err) {
    return (err as Error).message || "rejected";
  }
};

const handle = await startStudiod({ writePortFile: false });
const api = createStudiodApi(handle.port, handle.token);

const NAME = "Clone Test";
const ID = "clone-test";

try {
  const settings = await api.settings.get.query();
  const voicesDir = path.join(settings.storage.dataRoot, "voices");
  const clipFile = path.join(voicesDir, `${ID}.wav`);
  if (fs.existsSync(clipFile)) fs.unlinkSync(clipFile); // stale prior run

  /* ---- source material: a real reference clip ---- */
  const vf = settings.paths.videofastDir;
  if (!vf) throw new Error("videofast dir not set — nothing to upload");
  const refWav = fs.readFileSync(path.join(vf, "assets", "vo", "char_refs", "sterling.wav"));

  /* ---- 1: add ---- */
  const added = await api.labs.voice.add.mutate({
    name: NAME,
    wavBase64: refWav.toString("base64"),
  });
  check("add returns the voice", added.id === ID && added.kind === "cloned", JSON.stringify(added));
  check("add tags source studio", added.source === "studio", added.source);
  check("clip frozen on disk", fs.existsSync(clipFile));
  check(
    "clip bytes intact",
    fs.existsSync(clipFile) && fs.readFileSync(clipFile).equals(refWav),
  );

  /* ---- 2: rosters ---- */
  const catalog = await api.labs.voice.catalog.query();
  const mine = catalog.voices.find((v) => v.id === ID);
  check("voice catalog lists it", !!mine, JSON.stringify(mine));
  check("catalog name prettified", mine?.name === "Clone Test", mine?.name);
  check("catalog source studio", mine?.source === "studio", mine?.source);
  const videofastVoice = catalog.voices.find((v) => v.source === "videofast");
  check("char_refs voices tagged videofast", !!videofastVoice, videofastVoice?.id);
  const music = await api.labs.music.catalog.query();
  check(
    "music singVoices includes it",
    music.singVoices.some((v) => v.id === ID),
  );

  /* ---- 3: guards ---- */
  check("duplicate name rejected", /already exists/.test(await rejects(
    api.labs.voice.add.mutate({ name: NAME, wavBase64: refWav.toString("base64") }),
  )));
  check("non-wav bytes rejected", /not a WAV/.test(await rejects(
    api.labs.voice.add.mutate({
      name: "Not Audio",
      wavBase64: Buffer.alloc(4096, 7).toString("base64"),
    }),
  )));
  check("symbol-only name rejected", /letter or digit/.test(await rejects(
    api.labs.voice.add.mutate({ name: "!!!", wavBase64: refWav.toString("base64") }),
  )));
  if (videofastVoice) {
    check("videofast ref not deletable", /not a studio voice/.test(await rejects(
      api.labs.voice.remove.mutate({ id: videofastVoice.id }),
    )));
  }
  check("traversal id rejected", (await rejects(
    api.labs.voice.remove.mutate({ id: "../models/manifest" }),
  )).length > 0);

  /* ---- 4: synthesize with the clone (managed chatterbox) ---- */
  if (!skipTts) {
    const projects = await api.projects.list.query();
    const job = await api.labs.voice.generate.mutate({
      project: projects[0].id,
      text: "A cloned voice, fresh from the studio's own vault.",
      voice: ID,
      engine: "chatterbox",
      emotion: 0.6,
      pace: 1,
    });
    console.log(`enqueued ${job.id} voice=${ID}`);
    let final = job;
    for (let i = 0; i < 600; i++) {
      await sleep(1000);
      const jobs = await api.jobs.list.query();
      final = jobs.find((j) => j.id === job.id) ?? final;
      if (final.status === "completed" || final.status === "failed") break;
    }
    check("clone TTS job completed", final.status === "completed", final.error ?? final.status);
    if (final.output) {
      const abs = path.isAbsolute(final.output)
        ? final.output
        : path.join(settings.storage.dataRoot, final.output);
      const size = fs.existsSync(abs) ? fs.statSync(abs).size : 0;
      check("clone take is a real wav", size > 100_000, `${abs} (${Math.round(size / 1024)} KB)`);
    } else {
      check("output recorded", false, "no output on job");
    }
  }

  /* ---- 5: remove ---- */
  await api.labs.voice.remove.mutate({ id: ID });
  check("clip deleted from disk", !fs.existsSync(clipFile));
  const after = await api.labs.voice.catalog.query();
  check("roster forgets it", !after.voices.some((v) => v.id === ID));
  check("second remove rejected", (await rejects(api.labs.voice.remove.mutate({ id: ID }))).length > 0);
} finally {
  await handle.close();
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
