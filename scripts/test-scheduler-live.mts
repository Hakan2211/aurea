/* GpuScheduler live E2E — real studiod, real adapters, real GPU:
 *
 *   1. two TTS jobs enqueued together serialize on the gpu lane (never two
 *      running at once) and both deliver wavs into the project
 *   2. while a job runs, the legacy .gpu.lock names it as aurea:<jobId>
 *      under this pid, and it's gone once the lane drains
 *   3. a live foreign .gpu.lock parks a queued job with the visible
 *      "Waiting for GPU — external batch …" stage; killing the holder lets
 *      the job proceed (stale takeover)
 *
 * Run: npx tsx scripts/test-scheduler-live.mts */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const { startStudiod } = await import("../packages/core/src/server.js");
const { createStudiodApi } = await import("../packages/core/src/tools.js");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const handle = await startStudiod({ writePortFile: false });
const api = createStudiodApi(handle.port, handle.token);

const settings = await api.settings.get.query();
const vf = settings.paths.videofastDir;
if (!vf) throw new Error("videofastDir not configured — lock interop can't be tested");
const lockFile = path.join(vf, "batches", ".gpu.lock");
const readLock = () => {
  try {
    return JSON.parse(fs.readFileSync(lockFile, "utf8")) as { pid: number; batchId: string };
  } catch {
    return null;
  }
};

const projects = await api.projects.list.query();
const project = projects[0].id;
console.log(`project: ${project}, ttsMode: ${settings.engines.ttsMode}, lock: ${lockFile}`);

const jobById = async (id: string) => (await api.jobs.list.query()).find((j) => j.id === id)!;

try {
  /* ---- 1+2: two TTS jobs serialize; lock names the running one ---- */
  const a = await api.labs.voice.generate.mutate({
    project,
    text: "The scheduler owns the queue now.",
    voice: "sterling",
  });
  const b = await api.labs.voice.generate.mutate({
    project,
    text: "And the lock file is just for the old CLI.",
    voice: "sterling",
  });
  console.log(`enqueued ${a.id} + ${b.id}`);

  let maxRunning = 0;
  let lockSeenForRunner = false;
  let lockPidOk = true;
  for (let i = 0; i < 1200; i++) {
    const jobs = await api.jobs.list.query();
    const mine = jobs.filter((j) => j.id === a.id || j.id === b.id);
    const running = mine.filter((j) => j.status === "running");
    maxRunning = Math.max(maxRunning, running.length);
    if (running.length === 1) {
      const lock = readLock();
      if (lock?.batchId === `aurea:${running[0].id}`) {
        lockSeenForRunner = true;
        if (lock.pid !== process.pid) lockPidOk = false;
      }
    }
    if (mine.every((j) => j.status === "completed" || j.status === "failed")) break;
    await sleep(250);
  }
  const ja = await jobById(a.id);
  const jb = await jobById(b.id);
  check("both TTS jobs completed", ja.status === "completed" && jb.status === "completed", `${ja.status}/${jb.status} ${ja.error ?? ""}${jb.error ?? ""}`);
  check("gpu lane exclusive — never two running", maxRunning === 1, `max ${maxRunning}`);
  check("lock named the running job as aurea:<id>", lockSeenForRunner);
  check("lock pid was studiod's", lockPidOk);
  check("both delivered wavs", !!ja.output && !!jb.output, `${ja.output} | ${jb.output}`);
  check("lock released after the lane drained", readLock() === null);

  /* ---- 3: live foreign lock parks the lane with a visible stage ---- */
  const foreign = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 60000)"], { stdio: "ignore" });
  fs.writeFileSync(lockFile, JSON.stringify({ pid: foreign.pid, batchId: "vf-live-test", startedAt: new Date().toISOString() }, null, 2));
  const c = await api.labs.voice.generate.mutate({
    project,
    text: "Waiting my turn behind the legacy batch.",
    voice: "sterling",
  });
  let parkedStage = "";
  for (let i = 0; i < 60; i++) {
    const jc = await jobById(c.id);
    if (jc.status === "queued" && jc.stage?.includes("external batch vf-live-test")) {
      parkedStage = jc.stage;
      break;
    }
    await sleep(250);
  }
  check("foreign live lock parks the job with a stage", parkedStage !== "", parkedStage);
  foreign.kill();
  for (let i = 0; i < 1200; i++) {
    const jc = await jobById(c.id);
    if (jc.status === "completed" || jc.status === "failed") break;
    await sleep(250);
  }
  const jc = await jobById(c.id);
  check("job proceeds once the holder dies", jc.status === "completed", `${jc.status} ${jc.error ?? ""}`);

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
} finally {
  await handle.close();
}
process.exit(failures === 0 ? 0 : 1);
