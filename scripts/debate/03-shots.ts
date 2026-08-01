/* Stage 3 — render the shots with the Aurea Shot Director.
 *
 * Per shot: the boarded start frame at t=0, one prompt zone per line (the beat
 * names who is speaking and tells everyone else MOUTH CLOSED — that is what
 * localises the lipsync in a crowded frame), the measured voice takes on the
 * audio lane, and the whole cast as reference-sheet cells so nobody drifts
 * off-model.
 *
 *   npx tsx scripts/debate/03-shots.ts                 # every shot not yet rendered
 *   npx tsx scripts/debate/03-shots.ts coffee-fund-a   # just this one
 */

import fs from "node:fs";
import path from "node:path";
import { castRef } from "@aurea/shared";
import { createStudiodApi } from "../../packages/core/src/tools.js";
import { readPortFile } from "../../packages/core/src/portfile.js";
import {
  ALL_SHOTS,
  GAP,
  LEAD_IN,
  PROJECT,
  RESOLUTION,
  TAIL,
  lineId,
  negativePrompt,
  type Shot,
} from "./lines.js";

const HERE = path.join(process.cwd(), "scripts", "debate");
const BOARDS = path.join(HERE, "boards.json");
const TAKES = path.join(HERE, "takes.json");
const RENDERS = path.join(HERE, "renders.json");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Beat {
  zone: { prompt: string; lengthSec: number };
  audio: { take: string; atSec: number };
  label: string;
}

/** Lay the lines end to end and cut the beat boundaries halfway through each
 * gap, so a mouth has started moving slightly before its words land rather
 * than after. Gaps stay short by construction (lines.ts): LTX fills long
 * silence with invented speech. */
function layout(shot: Shot, takes: Record<string, { rel: string; sec: number }>) {
  const beats: Beat[] = [];
  let cursor = LEAD_IN;
  const placed: Array<{ start: number; end: number; rel: string; label: string }> = [];

  shot.lines.forEach((line, i) => {
    const key = lineId(shot, i);
    const take = takes[key];
    if (!take) throw new Error(`no voice take for ${key} — run 02-vo.ts first`);
    placed.push({ start: cursor, end: cursor + take.sec, rel: take.rel, label: `${line.who} "${line.text.slice(0, 34)}…"` });
    cursor = cursor + take.sec + GAP;
  });

  const total = Number((placed[placed.length - 1].end + TAIL).toFixed(2));

  let prev = 0;
  placed.forEach((p, i) => {
    const boundary = i === placed.length - 1 ? total : Number((p.end + GAP / 2).toFixed(2));
    beats.push({
      zone: { prompt: shot.lines[i].action, lengthSec: Number((boundary - prev).toFixed(2)) },
      audio: { take: p.rel, atSec: Number(p.start.toFixed(2)) },
      label: `${p.label} @${p.start.toFixed(2)}s`,
    });
    prev = boundary;
  });

  return { beats, total };
}

/* How hard the cast sheet holds the shot.
 *
 * 1.0 is "as trained" — and as trained means labelled contact sheets, so at
 * full weight the IC-LoRA paints a caption into the frame: two takes of
 * coffee-fund-a came back with invented on-screen text in the top-left corner
 * ("GATS PRRMEX", then "STEREIOR SHILEN"). Negative prompting didn't touch it,
 * because it isn't the prompt asking for text — it's the guide. Backing the
 * weight off keeps the identities and drops the label habit. */
const REF_STRENGTH = Number(process.env.REF_STRENGTH ?? 0.7);

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const pf = await readPortFile();
  if (!pf) throw new Error("no studiod port file");
  const api = createStudiodApi(pf.port, pf.token);

  const boards: Record<string, string> = JSON.parse(fs.readFileSync(BOARDS, "utf8"));
  const takes: Record<string, { rel: string; sec: number }> = JSON.parse(fs.readFileSync(TAKES, "utf8"));
  const renders: Record<string, string> = fs.existsSync(RENDERS)
    ? JSON.parse(fs.readFileSync(RENDERS, "utf8"))
    : {};

  const bible: any = await api.studio.bible.get.query({ project: PROJECT });
  const byId = (id: string) => {
    const c = bible.characters.find((x: any) => x.id === id);
    if (!c?.refs?.keyframeRef) throw new Error(`"${id}" has no keyframeRef`);
    return c;
  };
  /* NEG_MODE=bare drops the broadcast-overlay vocabulary and keeps only the
   * bible's own negative. The reason to try it: the artifacts got MORE
   * broadcast-specific after those words went in — a plain corner bug first,
   * then a title card, then a blue lower-third banner. At cfg 1 the Director
   * runs negatives through NAG, and a named thing can be summoned as easily as
   * suppressed, so naming "chyron" may be what produced one. */
  const NEG =
    process.env.NEG_MODE === "bare"
      ? (bible.style?.negativePrompt ?? "")
      : negativePrompt(bible.style?.negativePrompt ?? "");

  const queue = ALL_SHOTS.filter((s) => (only.length ? only.includes(s.slug) : !renders[s.slug]));
  if (queue.length === 0) {
    console.log("nothing to render");
    process.exit(0);
  }

  const jobIds: Record<string, string> = {};
  for (const shot of queue) {
    const startFrame = boards[shot.board];
    if (!startFrame) throw new Error(`no board "${shot.board}" — run 01-boards.ts first`);
    const { beats, total } = layout(shot, takes);
    /* Cast reference sheets are OFF, and that is the whole reason these videos
     * have no text in them.
     *
     * Five takes of coffee-fund-a came back with a broadcast graphic burned
     * over the opening seconds — a corner bug, then a title card, then a blue
     * lower-third banner — always starting right after the locked first frame
     * and burning off by t≈4-8s. Prompt wording, broadcast words in the
     * negative, removing them again, refStrength 0.7, audio inpainting off:
     * none of it moved the artifact. Dropping the sheet killed it outright, on
     * the first try, and the take rendered 25% faster besides.
     *
     * It makes sense: the Ingredients IC-LoRA is trained on LABELLED contact
     * sheets, and the sheet also prepends a "### Reference Sheet Description"
     * block of bolded cell headings to the global prompt. Both halves of that
     * teach the model that this shot is a thing with captions on it.
     *
     * The cost is that identity now rests entirely on the boarded start frame
     * — which is fine here, because every shot is boarded with its whole cast
     * already staged and on-model (01-boards.ts), and these are static
     * conversation shots where nobody leaves frame. Set REFS=on to put the
     * sheet back for a shot that needs a character the board can't carry. */
    const refs =
      process.env.REFS === "on"
        ? shot.cast.map((id) => {
            const c = byId(id);
            return castRef(c, c.refs.keyframeRef);
          })
        : [];

    const spec = {
      globalPrompt: shot.scene,
      negativePrompt: NEG,
      fps: 24,
      keyframes: [{ image: startFrame, atSec: 0, strength: 1 }],
      promptZones: beats.map((b) => b.zone),
      audio: beats.map((b) => b.audio),
      refs,
      refStrength: REF_STRENGTH,
      /* Off, deliberately. LTX 2.3 is an AV model: asked to fill silence it
       * invents speech (measured here before), and along with invented speech
       * it invents the programme that speech belongs to — every take rendered
       * with inpainting on came back with a broadcast graphic burned over the
       * first 4-8 seconds. The takes carry their own dialogue; the gaps between
       * lines are short by construction, so there is nothing worth inpainting. */
      inpaintAudio: process.env.INPAINT_AUDIO === "1",
    };

    console.log(`\n=== ${shot.slug} — ${shot.cast.length} on set, ${shot.lines.length} lines, ${total}s ===`);
    console.log(`  board  ${startFrame}`);
    console.log(`  refs   ${refs.map((r) => r.name).join(" | ")}`);
    for (const b of beats) console.log(`  beat   ${b.label} (zone ${b.zone.lengthSec}s)`);

    const job: any = await api.labs.video.generate.mutate({
      project: PROJECT,
      prompt: shot.scene,
      engine: "ltx2",
      startFrame,
      durationSec: total,
      resolution: RESOLUTION,
      director: spec,
    });
    jobIds[shot.slug] = job.id;
    console.log(`  queued job=${job.id}`);
  }

  console.log("\nrendering…");
  const done: Record<string, any> = {};
  const deadline = Date.now() + 6 * 60 * 60_000;
  let lastLog = 0;
  while (Object.keys(done).length < queue.length && Date.now() < deadline) {
    const jobs: any[] = await api.jobs.list.query();
    for (const shot of queue) {
      if (done[shot.slug]) continue;
      const j = jobs.find((x) => x.id === jobIds[shot.slug]);
      if (j && (j.status === "completed" || j.status === "failed")) {
        done[shot.slug] = j;
        console.log(`${j.status === "completed" ? "OK  " : "FAIL"} ${shot.slug}: ${j.output ?? j.error ?? ""}`);
        if (j.status === "completed" && j.output) {
          renders[shot.slug] = path
            .relative(path.join(process.env.USERPROFILE!, "Aurea"), j.output as string)
            .split(path.sep)
            .join("/");
          fs.writeFileSync(RENDERS, JSON.stringify(renders, null, 2));
        }
      }
    }
    if (Date.now() - lastLog > 60_000) {
      lastLog = Date.now();
      const live = jobs.filter((j) => Object.values(jobIds).includes(j.id) && j.status !== "completed" && j.status !== "failed");
      if (live.length) {
        console.log(`  … ${live.map((j) => `${j.id}:${j.status}${j.stage ? "/" + j.stage : ""} ${j.progress}%`).join("  ")}`);
      }
    }
    if (Object.keys(done).length < queue.length) await sleep(10_000);
  }

  console.log("\n=== renders ===");
  for (const [k, v] of Object.entries(renders)) console.log(`${k.padEnd(16)} ${v}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e?.message ?? e, e?.stack);
  process.exit(1);
});
