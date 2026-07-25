/* In-app CDP check for the Director's audio lane — drives the REAL renderer.
 *
 * Navigates to the Video lab, turns the Director on, adds two voice takes to
 * the lane, moves the second one out to 6s, and confirms the lane draws what
 * the render path will actually do: blocks on the ruler, a scored-gap figure,
 * and the improvisation warning once the hole gets long. Screenshots the panel
 * so the layout can be eyeballed.
 *
 * Run (app launched with --remote-debugging-port=9223):
 *   npx tsx scripts/cdp-audiolane-check.mts */

import fs from "node:fs";
import WebSocket from "ws";

const CDP = "http://127.0.0.1:9223";
const SHOT = process.argv[2] ?? "audiolane.png";

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

/** run an expression in the page and hand back the JSON it produced */
async function evaluate<T>(expression: string): Promise<T> {
  const res = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.result?.exceptionDetails) {
    throw new Error(res.result.exceptionDetails.exception?.description ?? "page threw");
  }
  return res.result?.result?.value as T;
}

/* Clicking is done from inside the page: find a control by its text, fire a
 * real click, let React settle. Returns false when nothing matched, so a
 * missing control fails the check instead of silently passing. */
const clickJs = (selector: string, text: string) => `(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
    .find(e => (e.textContent || "").trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));
  if (!el) return false;
  el.click();
  return true;
})()`;

await send("Runtime.enable");
await send("Page.enable");

await evaluate(`location.hash = "#/video"; true`);
await sleep(1500);

check("the Video lab is up", await evaluate<boolean>(`!!document.body.textContent.includes("Shot Director")`));

/* The lab opens on a 5s clip, which two takes fill end to end — no gap to
 * reason about. Take it out to 12s first, through the same dropdown a user
 * would use. */
await evaluate<boolean>(clickJs("button", "5 seconds"));
await sleep(400);
check("duration set to 12s", await evaluate<boolean>(clickJs("button", "12 seconds")));
await sleep(400);

// Director on — the lane only exists inside it
check("Director toggled on", await evaluate<boolean>(clickJs("button", "Off")));
await sleep(600);
check(
  "the audio lane appears with the Director",
  await evaluate<boolean>(`document.body.textContent.includes("Audio lane")`),
);

// add two takes off the picker
check("take picker opens", await evaluate<boolean>(clickJs("button", "Add take")));
await sleep(400);
const firstTake = await evaluate<string | null>(`(() => {
  const menu = [...document.querySelectorAll("div")].find(d =>
    d.className.includes("bg-raised") && d.querySelector("button"));
  const b = menu && menu.querySelector("button");
  if (!b) return null;
  const name = b.textContent.trim();
  b.click();
  return name;
})()`);
check("a take lands on the lane", !!firstTake, firstTake ?? "no picker rows");
await sleep(500);

await evaluate<boolean>(clickJs("button", "Add take"));
await sleep(400);
const secondTake = await evaluate<string | null>(`(() => {
  const menu = [...document.querySelectorAll("div")].find(d =>
    d.className.includes("bg-raised") && d.querySelectorAll("button").length > 1);
  const b = menu && menu.querySelectorAll("button")[1];
  if (!b) return null;
  const name = b.textContent.trim();
  b.click();
  return name;
})()`);
check("a second take lands on the lane", !!secondTake, secondTake ?? "only one take available");
await sleep(600);

// the ruler must draw a block per take
const bars = await evaluate<number>(`(() => {
  const ruler = [...document.querySelectorAll("div")].find(d =>
    d.className.includes("rounded-full") && d.className.includes("bg-cream/8") &&
    d.className.includes("h-2"));
  return ruler ? ruler.children.length : -1;
})()`);
check("the ruler draws a block per take", bars >= 2, `${bars} blocks`);

const scored = await evaluate<string | null>(
  `(() => { const m = document.body.textContent.match(/Score the gaps \\(([^)]+)\\)/); return m ? m[1] : null; })()`,
);
check("the lane reports what LTX is left to score", !!scored, scored ?? "no figure");

// push the second take late so the hole gets long enough to warn about
await evaluate<boolean>(`(() => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  const nums = [...document.querySelectorAll('input[type=number][title="When this line starts"]')];
  const last = nums[nums.length - 1];
  if (!last) return false;
  setter.call(last, "6");
  last.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`);
await sleep(700);
check(
  "a long hole warns that LTX will improvise into it",
  await evaluate<boolean>(`document.body.textContent.includes("improvise dialogue")`),
);

// bring the lane into view so the screenshot shows what was just driven
await evaluate<boolean>(`(() => {
  const h = [...document.querySelectorAll("h4")].find(e => e.textContent.trim() === "Audio lane");
  if (h) h.scrollIntoView({ block: "center" });
  return !!h;
})()`);
await sleep(500);
const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(SHOT, Buffer.from(shot.result.data, "base64"));
console.log(`\nscreenshot ${SHOT}`);

ws.close();
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
