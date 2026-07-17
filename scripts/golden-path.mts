/* P3 acceptance — the golden path, driven the way a user drives it:
 * chat → multi-shot generation → timeline assembly → export, all through the
 * Director against the RUNNING studiod (the app shows every step live).
 *
 *   turn 1: brief the Director — it generates start frames, animates each
 *           into an LTX take, and records a narration line (long jobs are
 *           enqueued, not blocked on — per its ground rules)
 *   (we wait for the queue to drain)
 *   turn 2: ask for the assembly — it places the takes + narration on the
 *           timeline with crossfades via timeline_* tools and exports
 *   verify: timeline.json holds the cut, the master mp4 is in the project's
 *           video assets, probed duration matches the sequence
 *
 * Run (app running): npx tsx scripts/golden-path.mts */

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

/* ---- attach to the live studiod ---- */
const portFile = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".aurea", "studiod.json"), "utf8"),
) as { port: number; token: string };
const api = createStudiodApi(portFile.port, portFile.token);
await api.system.overview.query(); // throws if the core is gone

const project = (await api.projects.create.mutate({ name: `Pilot ${Date.now() % 100000}` })).id;
console.log(`project: ${project}`);
const dataRoot = (await api.settings.get.query()).storage.dataRoot;

/* video on the managed engine for this run — one Comfy sidecar owns the GPU
 * (managed image + external video would be two processes fighting over VRAM) */
const prevVideoMode = (await api.settings.get.query()).engines.videoMode;
await api.settings.update.mutate({ engines: { videoMode: "managed" } });

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
  console.log(`<< ${(await lastReply()).slice(0, 400)}`);
}

/** Wait until the project has no queued/running jobs. Failed jobs are
 * reported but don't abort the wait — the Director retries failures itself
 * (e.g. re-issuing a speech job on the other engine); what matters is the
 * material on disk, which the caller checks afterwards. */
async function drainProjectJobs(timeoutMin: number): Promise<void> {
  const deadline = Date.now() + timeoutMin * 60_000;
  const reported = new Set<string>();
  for (;;) {
    await sleep(5000);
    const jobs = (await api.jobs.list.query()).filter((j) => j.project === `/${project}`);
    for (const j of jobs.filter((x) => x.status === "failed" && !reported.has(x.id))) {
      reported.add(j.id);
      console.log(`   job failed (Director may retry): ${j.title.slice(0, 40)} — ${j.error}`);
    }
    const open = jobs.filter((j) => j.status === "running" || j.status === "queued");
    if (open.length === 0) return;
    const head = open[0];
    process.stdout.write(
      `   ${open.length} job(s) open — ${head.title.slice(0, 40)}: ${head.stage ?? head.status} ${Math.round(head.progress)}%   \r`,
    );
    if (Date.now() > deadline) throw new Error("queue never drained");
  }
}

try {
  /* ---- turn 1: generate the material ---- */
  await directorTurn(
    "Let's make a short two-shot pilot scene: a golden retriever astronaut drifting inside a " +
      "space station. Shot 1: he floats past a porthole, Earth glowing behind him. Shot 2: close on " +
      "his helmet visor as he presses a paw to the glass. Generate a start frame for each shot " +
      "(cinematic, warm rim light), animate both into 5s video takes, and record one narration " +
      "line — something quiet and wondrous, e.g. \"Six months up here, and the view still stops " +
      "my heart.\" Don't wait for the long jobs — just get everything queued.",
    12,
  );
  await drainProjectJobs(30);

  const assets = (await api.library.list.query()).assets.filter((a) => a.project === project);
  const takes = assets.filter((a) => a.kind === "video").length;
  const lines = assets.filter((a) => a.kind === "audio").length;
  check("at least 2 video takes in the project", takes >= 2, `${takes} takes`);
  check("narration line recorded", lines >= 1, `${lines} audio`);

  /* ---- turn 2: assemble + export ---- */
  await directorTurn(
    "The takes are done. Assemble the cut: shot 1 then shot 2 on the timeline with a 0.4s " +
      "crossfade into shot 2, narration on the voice track starting at 1s, then export the " +
      "timeline. You may wait for the export job — it's quick.",
    10,
  );
  await drainProjectJobs(10);

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
} finally {
  await api.settings.update.mutate({ engines: { videoMode: prevVideoMode } });
  console.log(`\n(videoMode restored to "${prevVideoMode}")`);
}

console.log(failures === 0 ? "\nGOLDEN PATH: ALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
