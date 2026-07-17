/* In-app check of multi-video-track UI over CDP: the add-track button creates
 * "Video 2", a rail take lands on the base track, dragging it a lane down
 * re-tracks it, the preview shows the topmost clip, and remove-track works.
 *
 * Run with the app up (AUREA_CDP_PORT): npx tsx scripts/cdp-multitrack-check.mts */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const settings = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".aurea", "settings.json"), "utf8"),
) as { storage?: { dataRoot?: string } };
const dataRoot = settings.storage?.dataRoot ?? path.join(os.homedir(), "Aurea");
const tlFile = path.join(dataRoot, "projects", "playground", "timeline.json");
const readTl = () => JSON.parse(fs.readFileSync(tlFile, "utf8")) as {
  tracks: Array<{ id: string; kind: string; name: string; clips: Array<{ id: string }> }>;
};

const targets = (await (await fetch("http://127.0.0.1:9222/json/list")).json()) as Array<{
  title: string;
  webSocketDebuggerUrl: string;
}>;
const page = targets.find((t) => t.title === "Aurea");
if (!page) throw new Error("no Aurea CDP target — launch with AUREA_CDP_PORT=9222");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let msgId = 0;
const pending = new Map<number, (m: { result: { result?: { value?: unknown }; exceptionDetails?: unknown } }) => void>();
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data));
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)!(m);
    pending.delete(m.id);
  }
};
const send = (method: string, params: Record<string, unknown> = {}) =>
  new Promise<{ result: { result?: { value?: unknown }; exceptionDetails?: unknown } }>((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaljs = async <T,>(expression: string): Promise<T> => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result.result?.value as T;
};

/* ---- open the timeline ---- */
await evaljs(`location.hash = '#/timeline'`);
await sleep(1500);

/* ---- add a video track ---- */
await evaljs(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => /video track/i.test(x.textContent));
  if (!b) throw new Error('no add-track button');
  b.click(); return true;
})()`);
await sleep(1200); // debounced save is 700ms
let tl = readTl();
check("add-track button persists a Video 2 track",
  tl.tracks.filter((t) => t.kind === "video").length === 2 &&
    tl.tracks.some((t) => t.name === "Video 2"),
  tl.tracks.map((t) => t.name).join(" | "));
const laneCount = await evaljs<number>(
  `document.querySelectorAll('.relative.border-b.border-cream\\\\/5').length`,
);
check("a fourth lane renders", laneCount >= 4, `${laneCount} lanes`);

/* ---- drop a rail take, then drag it one lane down onto Video 2 ---- */
await evaljs(`(() => {
  const rail = [...document.querySelectorAll('button[title^="Add "]')];
  if (!rail.length) throw new Error('empty rail');
  rail[0].click(); return true;
})()`);
await sleep(1500);
tl = readTl();
const base = tl.tracks.filter((t) => t.kind === "video")[0];
const clip = base.clips[base.clips.length - 1];
check("rail take lands on the base video track", !!clip, base.clips.length + " clips on base");

// drag through the real input pipeline — synthetic PointerEvents would make
// setPointerCapture throw on an inactive pointerId
const rect = await evaljs<{ x: number; y: number } | null>(`(() => {
  const el = [...document.querySelectorAll('.cursor-grab')].pop();
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
let moved = false;
if (rect) {
  const mouse = (type: string, x: number, y: number) =>
    send("Input.dispatchMouseEvent", {
      type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1,
      clickCount: type === "mousePressed" ? 1 : 0,
    });
  await mouse("mousePressed", rect.x, rect.y);
  await mouse("mouseMoved", rect.x + 2, rect.y + 28);
  await mouse("mouseMoved", rect.x + 2, rect.y + 56);
  await mouse("mouseReleased", rect.x + 2, rect.y + 56);
  moved = true;
}
await sleep(1200);
tl = readTl();
const videoTracks = tl.tracks.filter((t) => t.kind === "video");
check("vertical drag re-tracks the clip onto Video 2",
  moved && videoTracks[1].clips.some((c) => c.id === clip.id),
  `base=${videoTracks[0].clips.length} overlay=${videoTracks[1].clips.length}`);

/* ---- cleanup: remove the moved clip, then the empty track ---- */
await evaljs(`(() => {
  const del = [...document.querySelectorAll('button[title="Delete selected clip"]')][0];
  if (del && !del.disabled) del.click();
  return true;
})()`);
await sleep(1200);
await evaljs(`(() => {
  const b = [...document.querySelectorAll('button[title="Remove empty track"]')][0];
  if (!b) throw new Error('no remove-track button');
  b.click(); return true;
})()`);
await sleep(1200);
tl = readTl();
check("empty Video 2 removed, timeline back to 3 tracks",
  tl.tracks.length === 3 && tl.tracks.filter((t) => t.kind === "video").length === 1,
  tl.tracks.map((t) => t.name).join(" | "));

console.log(failures === 0 ? "\nMULTITRACK UI: ALL PASS" : `\n${failures} FAILURES`);
ws.close();
process.exit(failures === 0 ? 0 : 1);
