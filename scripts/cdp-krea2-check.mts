/* In-app CDP check for managed krea2 — drives the REAL renderer:
 * confirms Settings shows the "GGUF loader nodes" runtime component ready,
 * the Image Lab offers Krea 2 as available on the managed engine, then
 * enqueues a krea2 generation and watches it complete on screen.
 *
 * Run (app already launched with --remote-debugging-port=9223):
 *   npx tsx scripts/cdp-krea2-check.mts */

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
// Chrome innerText applies CSS text-transform — always compare lowercase
const uiText = async () => ((await evaluate("document.body.innerText")) as string).toLowerCase();

/* ---------- studiod coords from the app's port file ---------- */

let coords: { port: number; token: string } | null = null;
for (let i = 0; i < 60 && !coords; i++) {
  const pf = await readPortFile();
  if (pf && (await probeStudiod(pf))) coords = pf;
  else await sleep(1000);
}
if (!coords) throw new Error("no live studiod behind the port file");
const api = createStudiodApi(coords.port, coords.token);

try {
  /* 1. runtime status over tRPC: the gguf component is ready */
  const runtime = await api.runtime.status.query();
  const gguf = runtime.components.find((c: { id: string }) => c.id === "gguf");
  check("studiod reports gguf component ready", gguf?.state === "ready", JSON.stringify(gguf));

  /* 2. Settings → Engines renders the component (sections render one at a time) */
  await evaluate(`location.hash = "#/settings"`);
  await sleep(1500);
  await evaluate(
    `[...document.querySelectorAll("button, a")].find((el) => el.textContent.trim() === "Engines")?.click()`,
  );
  await sleep(1000);
  const settingsText = await uiText();
  check("Settings → Engines shows GGUF loader nodes", settingsText.includes("gguf loader nodes"));

  /* 3. Image Lab offers Krea 2 as available (managed) */
  const catalog = await api.labs.image.catalog.query();
  const krea2 = catalog.models.find((m: { id: string }) => m.id === "krea2");
  check("catalog: krea2 available on managed engine", !!krea2?.available, JSON.stringify(krea2));
  await evaluate(`location.hash = "#/images"`);
  let labShowsKrea2 = false;
  for (let i = 0; i < 20 && !labShowsKrea2; i++) {
    labShowsKrea2 = (await uiText()).includes("krea 2");
    if (!labShowsKrea2) await sleep(500);
  }
  check("Image Lab renders Krea 2 model", labShowsKrea2);

  /* 4. generate through the real pipeline and watch it complete in-app */
  const projects = await api.projects.list.query();
  const job = await api.labs.image.generate.mutate({
    project: projects[0].id,
    model: "krea2",
    prompt: "a lynx conductor leading a tiny woodland orchestra, golden hour, shallow depth of field",
    aspect: "3:2",
    count: 1,
    seed: 7,
  });
  console.log(`enqueued ${job.id}`);
  await evaluate(`location.hash = "#/jobs"`);

  let done = false;
  let sawRunning = false;
  for (let i = 0; i < 600 && !done; i++) {
    const j = (await api.jobs.list.query()).find((x: { id: string }) => x.id === job.id)!;
    if (j.status === "running") sawRunning = true;
    done = j.status === "completed" || j.status === "failed";
    if (!done) await sleep(500);
  }
  const finalJob = (await api.jobs.list.query()).find((x: { id: string }) => x.id === job.id)!;
  check(
    "krea2 job completed via managed engine",
    sawRunning && finalJob.status === "completed",
    finalJob.error ?? finalJob.output ?? "",
  );
  await sleep(1500);
  check("completion visible in Job Center", (await uiText()).includes("completed"));

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
} finally {
  ws.close();
}
process.exit(failures === 0 ? 0 : 1);
