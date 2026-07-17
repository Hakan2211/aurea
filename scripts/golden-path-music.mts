/* Golden path, music-bed extension: one Director turn on the finished pilot —
 * generate an ACE-Step bed, lay it under the cut on the music track trimmed to
 * the sequence, re-export — then verify the timeline, the imported bed, and
 * that the new master's mix actually got louder than the music-less one.
 *
 * Run (against the RUNNING app's studiod): npx tsx scripts/golden-path-music.mts <project-id> */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { createStudiodApi } = await import("../packages/core/src/tools.js");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const project = process.argv[2];
if (!project) throw new Error("usage: golden-path-music.mts <project-id>");

const portFile = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".aurea", "studiod.json"), "utf8"),
) as { port: number; token: string };
const api = createStudiodApi(portFile.port, portFile.token);
const dataRoot = (await api.settings.get.query()).storage.dataRoot;
const videoDir = path.join(dataRoot, "projects", project, "assets", "video");
const musicDir = path.join(dataRoot, "projects", project, "assets", "music");

const meanVolume = (file: string): number => {
  // volumedetect reports on stderr
  const out = spawnSync("ffmpeg", ["-i", file, "-af", "volumedetect", "-f", "null", "-"], {
    windowsHide: true,
    encoding: "utf8",
  }).stderr;
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(out);
  if (!m) throw new Error(`no volumedetect output for ${file}`);
  return Number(m[1]);
};

async function drainProjectJobs(timeoutMin: number): Promise<void> {
  const deadline = Date.now() + timeoutMin * 60_000;
  const reported = new Set<string>();
  for (;;) {
    const jobs = (await api.jobs.list.query()).filter((j) => j.project === `/${project}`);
    for (const j of jobs.filter((x) => x.status === "failed" && !reported.has(x.id))) {
      reported.add(j.id);
      console.log(`   job failed (Director may retry): ${j.title.slice(0, 40)} — ${j.error}`);
    }
    const open = jobs.filter((j) => j.status === "running" || j.status === "queued");
    if (open.length === 0) return;
    const head = open[0];
    console.log(
      `   ${open.length} open — ${head.title.slice(0, 40)}: ${head.stage ?? head.status} ${Math.round(head.progress)}%`,
    );
    if (Date.now() > deadline) throw new Error("queue never drained");
    await sleep(15000);
  }
}

const lastReply = async () => {
  const state = await api.director.get.query({ project });
  return [...state.messages].reverse().find((m) => m.role !== "user" && m.text)?.text ?? "";
};

async function directorTurn(text: string, timeoutMin: number): Promise<void> {
  console.log(`\n>> ${text.slice(0, 110)}…`);
  await api.director.send.mutate({ project, text, attachments: [] });
  const deadline = Date.now() + timeoutMin * 60_000;
  for (;;) {
    await sleep(3000);
    const state = await api.director.get.query({ project });
    if (state.status === "idle") break;
    if (Date.now() > deadline) throw new Error("Director turn timed out");
  }
  console.log(`<< ${(await lastReply()).slice(0, 500)}`);
}

/* ---- baseline: the music-less master and current sequence ---- */
const tlBefore = await api.timeline.get.query({ project });
const seqEnd = tlBefore.tracks.reduce(
  (m, t) => t.clips.reduce((mm, c) => Math.max(mm, c.start + c.duration), m), 0);
check("pilot timeline holds a cut to score", seqEnd > 5, `${seqEnd.toFixed(2)}s sequence`);
check("no music clip yet", !tlBefore.tracks.some((t) => t.kind === "music" && t.clips.length > 0));

const mastersBefore = fs.existsSync(videoDir)
  ? fs.readdirSync(videoDir).filter((f) => f.startsWith("export-"))
  : [];
check("a music-less master exists as baseline", mastersBefore.length > 0, mastersBefore.join(", "));
const baselineDb = meanVolume(path.join(videoDir, mastersBefore[mastersBefore.length - 1]));
console.log(`   baseline master mean_volume ${baselineDb} dB`);
const musicBefore = new Set(fs.existsSync(musicDir) ? fs.readdirSync(musicDir) : []);
const turnStart = Date.now();

/* ---- the music-bed turn ---- */
await directorTurn(
  "The pilot cut is locked. Give it a music bed: generate a ~12s instrumental score bed with " +
    "generate_music — warm retro-funk sitcom score, laid-back, brass stabs, live drums — wait for " +
    "the job, then place it on the music track starting at 0 and trim the clip to end exactly with " +
    "the video (check timeline_get for the sequence length). Then export the timeline and wait for " +
    "the export job.",
  20,
);
await drainProjectJobs(10);

/* ---- verify ---- */
const tl = await api.timeline.get.query({ project });
const musicClips = tl.tracks.filter((t) => t.kind === "music").flatMap((t) => t.clips);
check("music track holds exactly one bed clip", musicClips.length === 1,
  musicClips.map((c) => `${c.label} ${c.start}+${c.duration}`).join(" | "));
const bed = musicClips[0];
if (bed) {
  check("bed starts at 0", bed.start === 0, `start ${bed.start}`);
  check("bed trimmed to the sequence", Math.abs(bed.start + bed.duration - seqEnd) < 0.5,
    `bed ends ${(bed.start + bed.duration).toFixed(2)}s vs cut ${seqEnd.toFixed(2)}s`);
}

const newBeds = (fs.existsSync(musicDir) ? fs.readdirSync(musicDir) : []).filter(
  (f) => !musicBefore.has(f));
check("ACE-Step bed imported into assets/music", newBeds.length >= 1, newBeds.join(", "));

const newMasters = fs.readdirSync(videoDir).filter(
  (f) => f.startsWith("export-") && fs.statSync(path.join(videoDir, f)).mtimeMs > turnStart);
check("a fresh master was exported", newMasters.length >= 1, newMasters.join(", "));

if (newMasters.length > 0) {
  const master = path.join(videoDir, newMasters[newMasters.length - 1]);
  const dur = Number(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", master],
      { windowsHide: true }).toString().trim());
  check("new master still matches the sequence", Math.abs(dur - seqEnd) < 0.5, `${dur}s`);
  const mixedDb = meanVolume(master);
  check("the mix is audibly fuller than the music-less master", mixedDb > baselineDb + 0.5,
    `${baselineDb} dB → ${mixedDb} dB`);
}

console.log(failures === 0 ? "\nMUSIC BED GOLDEN PATH: ALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
