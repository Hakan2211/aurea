/* Continuation of an in-flight golden-path pilot: the generation turn already
 * ran (frames done, LTX takes rendering, narration retried on qwen). Wait for
 * the queue to drain for real, then send the assembly turn and verify the
 * exported master.
 *
 * Run: npx tsx scripts/golden-path-continue.mts <project-id> */

import { execFileSync } from "node:child_process";
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
if (!project) throw new Error("usage: golden-path-continue.mts <project-id>");

const portFile = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".aurea", "studiod.json"), "utf8"),
) as { port: number; token: string };
const api = createStudiodApi(portFile.port, portFile.token);
const dataRoot = (await api.settings.get.query()).storage.dataRoot;

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

/* ---- wait out the generation queue ---- */
await drainProjectJobs(40);
const assets = (await api.library.list.query()).assets.filter((a) => a.project === project);
const takes = assets.filter((a) => a.kind === "video").length;
const lines = assets.filter((a) => a.kind === "audio").length;
check("at least 2 video takes in the project", takes >= 2, `${takes} takes`);
check("narration line recorded", lines >= 1, `${lines} audio`);

/* ---- assembly turn ---- */
await directorTurn(
  "Both takes and the narration are on disk now — check list_assets to confirm. Assemble the cut: " +
    "shot 1 (porthole drift) then shot 2 (visor close-up) on the timeline with a 0.4s crossfade " +
    "into shot 2, narration on the voice track starting at 1s, then export the timeline. You may " +
    "wait for the export job — it's quick.",
  10,
);
await drainProjectJobs(10);

/* ---- verify ---- */
const tl = await api.timeline.get.query({ project });
const clipCount = tl.tracks.reduce((n2, t) => n2 + t.clips.length, 0);
const videoClips = tl.tracks.find((t) => t.kind === "video")?.clips ?? [];
check("timeline holds the cut (>= 2 video clips + narration)", clipCount >= 3, `${clipCount} clips`);
check("a crossfade was set", videoClips.some((c) => c.transitionSec > 0),
  videoClips.map((c) => `${c.start}+${c.duration}${c.transitionSec ? `~${c.transitionSec}` : ""}`).join(" | "));

const videoDir = path.join(dataRoot, "projects", project, "assets", "video");
const master = fs.readdirSync(videoDir).find((f) => f.startsWith("export-"));
check("exported master in the project's video assets", !!master, master ?? "none");

if (master) {
  const end = tl.tracks.reduce(
    (m, t) => t.clips.reduce((mm, c) => Math.max(mm, c.start + c.duration), m), 0);
  const dur = Number(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
      path.join(videoDir, master)], { windowsHide: true }).toString().trim(),
  );
  check("master duration matches the sequence", Math.abs(dur - end) < 0.5, `${dur}s vs ${end}s cut`);
}

console.log(failures === 0 ? "\nGOLDEN PATH (continued): ALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
