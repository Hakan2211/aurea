/* In-app CDP check for the Director's V5 surface — drives the REAL renderer.
 *
 * Two flows, both in the Video lab:
 *   1. motion lane — turn the Director on, attach a reference clip, confirm the
 *      IC-LoRA choice, timings and strength are all reachable
 *   2. retake — "Fix this bit" on the previewed take, mark in/out from the
 *      playhead, describe the fix, and confirm the panel takes the shot over:
 *      the keyframe strip gives way to the retake card, the length/size
 *      controls say they don't apply, and Generate becomes "Re-render 2.0s"
 *
 * Nothing is queued — the check stops at the button. Screenshots both panels.
 *
 * Run (app launched with --remote-debugging-port=9223):
 *   npx tsx scripts/cdp-v5-check.mts */

import fs from "node:fs";
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
    /* still booting */
  }
  if (!page) await sleep(1000);
}
if (!page) throw new Error("no app page on the CDP port — launch with --remote-debugging-port=9223");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.once("open", r));
let id = 0;
const pending = new Map<number, (v: any) => void>();
ws.on("message", (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)!(msg);
});
const send = (method: string, params: unknown = {}) =>
  new Promise<any>((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

async function evaluate<T>(expression: string): Promise<T> {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (res.result?.exceptionDetails) {
    throw new Error(res.result.exceptionDetails.exception?.description ?? "page threw");
  }
  return res.result?.result?.value as T;
}

const clickJs = (selector: string, text: string) => `(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
    .find(e => (e.textContent || "").trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));
  if (!el) return false;
  el.click();
  return true;
})()`;

const shoot = async (file: string) => {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(file, Buffer.from(shot.result.data, "base64"));
  console.log(`screenshot ${file}`);
};

await send("Runtime.enable");
await send("Page.enable");

/* Reload first. Every control here is panel state — a Director left on, a
 * retake left marked — so a second run against the same window would read the
 * first run's leftovers as failures ("toggle the Director on" finds no "Off"
 * button). Reloading makes the check say the same thing every time. */
await evaluate(`location.reload(); true`).catch(() => {});
await sleep(4000);
await evaluate(`location.hash = "#/video"; true`);
await sleep(1500);
check("the Video lab is up", await evaluate<boolean>(`document.body.textContent.includes("Shot Director")`));

/* ---- 1: the motion lane ---- */
check("Director toggled on", await evaluate<boolean>(clickJs("button", "Off")));
await sleep(600);
check(
  "the motion lane appears with the Director",
  await evaluate<boolean>(`document.body.textContent.includes("Motion reference")`),
);

check("reference picker opens", await evaluate<boolean>(clickJs("button", "Add reference")));
await sleep(400);
const reference = await evaluate<string | null>(`(() => {
  const menu = [...document.querySelectorAll("div")].find(d =>
    d.className.includes("bg-raised") && d.className.includes("top-7") && d.querySelector("button"));
  const b = menu && menu.querySelector("button");
  if (!b) return null;
  const name = b.textContent.trim();
  b.click();
  return name;
})()`);
check("a reference clip attaches", !!reference, reference ?? "no picker rows");
await sleep(600);

const knobs = await evaluate<{ lora: boolean; at: boolean; strength: boolean; audio: boolean }>(`(() => {
  const text = document.body.textContent;
  const selects = [...document.querySelectorAll("select")].map(s => s.value);
  return {
    lora: selects.includes("motionTrack"),
    at: [...document.querySelectorAll("span")].some(s => s.textContent.trim() === "skip"),
    strength: text.includes("Strength"),
    audio: text.includes("Take its audio too"),
  };
})()`);
check("the IC-LoRA choice is on the lane", knobs.lora);
check("its timings are editable", knobs.at);
check("strength and audio-lift are there", knobs.strength && knobs.audio);
await evaluate<boolean>(`(() => {
  const h = [...document.querySelectorAll("h4")].find(e => e.textContent.trim() === "Motion reference");
  if (h) h.scrollIntoView({ block: "center" });
  return !!h;
})()`);
await sleep(400);
await shoot("v5-motion-lane.png");

/* ---- 2: retake ---- */
// clear the reference so the retake card is what the panel shows
await evaluate<boolean>(clickJs("button", "Remove"));
await sleep(300);

check("take actions open", await evaluate<boolean>(`(() => {
  const b = [...document.querySelectorAll('button[title="Take actions"]')][0];
  if (!b) return false;
  b.click();
  return true;
})()`));
await sleep(400);
check("Fix this bit is offered", await evaluate<boolean>(clickJs("button", "Fix this bit")));
await sleep(800);

check(
  "the marked range appears under the player",
  await evaluate<boolean>(`!!document.querySelector('button[title="Start the window at the playhead"]')`),
);
check(
  "the panel hands the shot to the retake",
  await evaluate<boolean>(
    `document.body.textContent.includes("re-rendered") &&
     !document.body.textContent.includes("+ End frame")`,
  ),
);
check(
  "and says the length/size controls don't apply",
  await evaluate<boolean>(`document.body.textContent.includes("A retake follows the take it fixes")`),
);

/* Mark 1s → 4s off the playhead. The preview autoplays, so "Fix this bit"
 * starts the window wherever playback had got to — setting both edges is what
 * a user does next, and it's the only way this assertion knows the numbers. */
const markAt = async (sec: number, title: string) => {
  const seeked = await evaluate<boolean>(`(() => {
    const v = document.querySelector("video");
    if (!v || !isFinite(v.duration) || v.duration <= 0) return false;
    v.pause();
    v.currentTime = Math.min(${sec}, v.duration - 0.1);
    return true;
  })()`);
  if (!seeked) return false;
  await sleep(500);
  return evaluate<boolean>(`(() => {
    const b = document.querySelector('button[title=${JSON.stringify(title)}]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
};
check("Set in re-marks the window from the playhead", await markAt(1, "Start the window at the playhead"));
check("Set out re-marks the window from the playhead", await markAt(4, "End the window at the playhead"));
await sleep(500);
const window_ = await evaluate<string | null>(
  `(() => { const m = document.body.textContent.match(/(\\d+\\.\\d)s re-rendered/); return m ? m[1] : null; })()`,
);
check(
  "the window is the 1s→4s the playhead marked",
  !!window_ && Math.abs(Number(window_) - 3) < 0.2,
  window_ ? `${window_}s` : "no readout",
);

// describe the fix — the button only arms once there's something to render
await evaluate<boolean>(`(() => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  const ta = [...document.querySelectorAll("textarea")].find(t =>
    (t.placeholder || "").includes("that window"));
  if (!ta) return false;
  setter.call(ta, "his hand stops warping");
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`);
await sleep(500);
const button = await evaluate<string>(`(() => {
  const b = [...document.querySelectorAll("button")].find(e => /Re-render|Describe the fix/.test(e.textContent));
  return b ? b.textContent.trim() : "";
})()`);
check("Generate becomes the re-render", /^Re-render/.test(button), button);

await evaluate(`window.scrollTo(0, 0); true`);
await sleep(300);
await shoot("v5-retake.png");

ws.close();
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
