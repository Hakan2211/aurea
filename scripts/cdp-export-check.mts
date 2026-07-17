/* In-app CDP check for timeline export — drives the REAL app:
 *   the Export button renders (disabled on an empty cut), adding a shot from
 *   the rail arms it, clicking it flips to live "Exporting… N%" progress fed
 *   by the jobs stream, the button settles to "Export again", and the master
 *   mp4 lands in the playground's video assets.
 *
 * Run (app already launched with --remote-debugging-port=9223):
 *   npx tsx scripts/cdp-export-check.mts */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import WebSocket from "ws";

const CDP = "http://127.0.0.1:9223";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    /* booting */
  }
  if (!page) await sleep(1000);
}
if (!page) throw new Error("no app page on the CDP port");

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
    ws.send(
      JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }),
    );
  });
}

const exportBtn = `[...document.querySelectorAll("button")].find((b) => { const t = (b.title ?? "").toLowerCase(); return t.includes("render the cut") || t.includes("last export failed"); })`;
const videoDir = path.join(os.homedir(), "Aurea", "projects", "playground", "assets", "video");
const mastersBefore = fs.readdirSync(videoDir).filter((f) => f.startsWith("export-")).length;

try {
  await evaluate(`location.hash = "#/timeline"`);
  await sleep(2500);

  const disabledEmpty = await evaluate(`(() => { const b = ${exportBtn}; return b ? b.disabled : null; })()`);
  check("Export button renders, disabled on an empty cut", disabledEmpty === true, String(disabledEmpty));

  await evaluate(`(() => [...document.querySelectorAll('button[title^="Add "]')][0]?.click())()`);
  await sleep(2000); // probe + debounce save
  const armed = await evaluate(`(() => { const b = ${exportBtn}; return b ? !b.disabled : null; })()`);
  check("adding a shot arms the button", armed === true);

  await evaluate(`(() => { const b = ${exportBtn}; b?.click(); })()`);
  let sawProgress = "";
  let label = "";
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    label = String(await evaluate(`(${exportBtn})?.textContent ?? ""`)).toLowerCase();
    if (label.includes("exporting")) sawProgress = label;
    if (label.includes("export again")) break;
  }
  check("click flips to live Exporting progress", sawProgress.includes("exporting"), sawProgress || "(never seen)");
  check("button settles to Export again", label.includes("export again"), label);

  const mastersAfter = fs.readdirSync(videoDir).filter((f) => f.startsWith("export-")).length;
  check("master mp4 imported into playground video assets", mastersAfter === mastersBefore + 1,
    `${mastersBefore} → ${mastersAfter}`);

  // the job center lists the export
  await evaluate(`location.hash = "#/jobs"`);
  await sleep(1200);
  const jobsText = String(await evaluate(`document.body.innerText`)).toLowerCase();
  check("job center lists the export job", jobsText.includes("export — playground"), "");

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
} finally {
  ws.close();
}
process.exit(failures === 0 ? 0 : 1);
