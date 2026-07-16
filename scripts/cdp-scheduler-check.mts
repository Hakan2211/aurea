/* In-app CDP check for the GPU scheduler — drives the REAL packaged renderer:
 * navigates the running Electron app (launched with --remote-debugging-port)
 * to the Job Center, parks a TTS job behind a fake live foreign .gpu.lock,
 * and confirms the "Waiting for GPU — external batch …" stage renders in the
 * UI; then kills the holder and watches the job run to completion on screen.
 *
 * Run (app already launched with --remote-debugging-port=9223):
 *   npx tsx scripts/cdp-scheduler-check.mts */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";

const { readPortFile, probeStudiod } = await import("../packages/core/src/portfile.js");
const { createStudiodApi } = await import("../packages/core/src/tools.js");

const CDP = "http://127.0.0.1:9223";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------- CDP: attach to the app page ---------- */

interface Target {
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

let page: Target | undefined;
for (let i = 0; i < 60 && !page; i++) {
  try {
    const targets = (await (await fetch(`${CDP}/json`)).json()) as Target[];
    page = targets.find((t) => t.type === "page" && t.url.includes("index.html"));
  } catch {
    /* app still booting */
  }
  if (!page) await sleep(1000);
}
if (!page) throw new Error("no app page on the CDP port — is the app running with --remote-debugging-port=9223?");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.once("open", resolve);
  ws.once("error", reject);
});
let msgId = 0;
function evaluate(expression: string): Promise<unknown> {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    const onMessage = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(String(raw));
      if (msg.id !== id) return;
      ws.off("message", onMessage);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result?.result?.value);
    };
    ws.on("message", onMessage);
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
  });
}
const uiText = () => evaluate("document.body.innerText") as Promise<string>;

/* ---------- studiod coords from the app's port file ---------- */

let coords: { port: number; token: string } | null = null;
for (let i = 0; i < 60 && !coords; i++) {
  const pf = await readPortFile();
  if (pf && (await probeStudiod(pf))) coords = pf;
  else await sleep(1000);
}
if (!coords) throw new Error("no live studiod behind the port file");
const api = createStudiodApi(coords.port, coords.token);

const settings = await api.settings.get.query();
const lockFile = path.join(settings.paths.videofastDir!, "batches", ".gpu.lock");
const projects = await api.projects.list.query();

try {
  await evaluate(`location.hash = "#/jobs"`);
  await sleep(1500);
  check("Job Center reachable in-app", (await uiText()).length > 0);

  /* park a job behind a fake live foreign batch */
  const foreign = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 120000)"], { stdio: "ignore" });
  fs.writeFileSync(
    lockFile,
    JSON.stringify({ pid: foreign.pid, batchId: "cdp-test", startedAt: new Date().toISOString() }, null, 2),
  );
  const job = await api.labs.voice.generate.mutate({
    project: projects[0].id,
    text: "The job center shows me waiting for the legacy batch.",
    voice: "sterling",
  });
  console.log(`enqueued ${job.id} behind foreign lock (pid ${foreign.pid})`);

  let parked = false;
  for (let i = 0; i < 40 && !parked; i++) {
    parked = (await uiText()).toLowerCase().includes("external batch cdp-test");
    if (!parked) await sleep(500);
  }
  check("waiting stage renders in the Job Center", parked);

  foreign.kill();
  let done = false;
  let sawRunning = false;
  for (let i = 0; i < 600 && !done; i++) {
    const j = (await api.jobs.list.query()).find((x) => x.id === job.id)!;
    if (j.status === "running") sawRunning = true;
    done = j.status === "completed" || j.status === "failed";
    if (!done) await sleep(500);
  }
  const finalJob = (await api.jobs.list.query()).find((x) => x.id === job.id)!;
  check("job ran once the holder died", sawRunning && finalJob.status === "completed", finalJob.error ?? "");
  await sleep(1500);
  const text = await uiText();
  check("completion visible in-app", text.includes("Completed") || text.includes("completed"));

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
} finally {
  ws.close();
}
process.exit(failures === 0 ? 0 : 1);
