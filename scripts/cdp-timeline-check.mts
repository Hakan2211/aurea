/* In-app CDP check for the P3 renderer surfaces — drives the REAL app:
 *   Timeline: shot rail renders the library, clicking a shot adds a clip,
 *     the edit persists to the project's timeline.json, ruler click seeks
 *   Video Lab: Seedance engine card + cost note render from the catalog
 *   Settings: Video engine toggle + fal.ai key field exist
 *
 * Run (app already launched with --remote-debugging-port=9223):
 *   npx tsx scripts/cdp-timeline-check.mts */

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
const uiText = async () => ((await evaluate("document.body.innerText")) as string).toLowerCase();

const timelineFile = path.join(os.homedir(), "Aurea", "projects", "playground", "timeline.json");
const clipsBefore = (() => {
  try {
    const tl = JSON.parse(fs.readFileSync(timelineFile, "utf8"));
    return tl.tracks.reduce((n: number, t: { clips: unknown[] }) => n + t.clips.length, 0);
  } catch {
    return 0;
  }
})();

try {
  /* ---- timeline ---- */
  await evaluate(`location.hash = "#/timeline"`);
  await sleep(2500);
  let text = await uiText();
  check("timeline screen renders tracks", text.includes("video") && text.includes("voice") && text.includes("music"));
  check("shot rail lists library takes", text.includes("shots & takes"));

  const added = await evaluate(`(() => {
    const shot = [...document.querySelectorAll('button[title^="Add "]')][0];
    if (!shot) return null;
    const name = shot.title;
    shot.click();
    return name;
  })()`);
  check("clicking a shot adds it", typeof added === "string", String(added));
  await sleep(1800); // probe metadata + debounce save

  const countClips = () => {
    try {
      const tl = JSON.parse(fs.readFileSync(timelineFile, "utf8"));
      return tl.tracks.reduce((n: number, t: { clips: unknown[] }) => n + t.clips.length, 0);
    } catch {
      return 0;
    }
  };
  const clipsAfter = countClips();
  check(
    "clip persisted to the project timeline.json",
    clipsAfter === clipsBefore + 1,
    `${clipsBefore} → ${clipsAfter}`,
  );

  // remount regression: leave, come back, add again — the second edit must
  // stack on the saved cut, not overwrite it from a stale cache
  await evaluate(`location.hash = "#/settings"`);
  await sleep(800);
  await evaluate(`location.hash = "#/timeline"`);
  await sleep(1500);
  await evaluate(`(() => [...document.querySelectorAll('button[title^="Add "]')][0]?.click())()`);
  await sleep(1800);
  check("edits after a remount stack, not overwrite", countClips() === clipsAfter + 1, `${clipsAfter} → ${countClips()}`);

  const seeked = await evaluate(`(() => {
    const ruler = document.querySelector('div[class*="cursor-pointer"][class*="border-b"]');
    if (!ruler) return false;
    const r = ruler.getBoundingClientRect();
    ruler.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: r.left + 96, clientY: r.top + 8 }));
    return true;
  })()`);
  await sleep(300);
  text = await uiText();
  check("ruler click seeks the playhead", seeked === true && /0:0[12]\./.test(text), text.match(/\d:\d\d\.\d \/ \d:\d\d\.\d/)?.[0] ?? "");

  /* ---- video lab: seedance card ---- */
  await evaluate(`location.hash = "#/video"`);
  await sleep(1500);
  text = await uiText();
  check("video lab lists the Seedance engine", text.includes("seedance"));
  await evaluate(`(() => {
    const card = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Seedance"));
    card?.click();
  })()`);
  await sleep(400);
  text = await uiText();
  check("selecting Seedance shows the cost note (or key pointer)", text.includes("fal.ai"));

  /* ---- settings: video engine toggle + fal key ---- */
  await evaluate(`location.hash = "#/settings"`);
  await sleep(1200);
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Engines");
    btn?.click();
  })()`);
  await sleep(600);
  text = await uiText();
  check("settings shows the Video engine toggle", text.includes("video engine"));
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("AI Providers"));
    btn?.click();
  })()`);
  await sleep(600);
  text = await uiText();
  check("settings shows the fal.ai key field", text.includes("fal.ai api key"));

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
} finally {
  ws.close();
}
process.exit(failures === 0 ? 0 : 1);
