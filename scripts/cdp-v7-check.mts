/* In-app CDP check for V7's UI half — "Send to Director".
 *
 * The tools are covered by test-shot-tools.mts. What only the app can answer is
 * whether a boarded shot actually ARRIVES in the Video lab: the core composes
 * the spec, the button navigates, and every control seeds from it. So this
 * walks the same path a user does — Storyboard → pick the shot → Send to
 * Director — and reads the panel back.
 *
 * Run (app launched with AUREA_CDP_PORT=9223):
 *   npx tsx scripts/cdp-v7-check.mts */

import fs from "node:fs";
import WebSocket from "ws";

const CDP = `http://127.0.0.1:${process.env.AUREA_CDP_PORT ?? 9223}`;
/** the shot test-shot-tools.mts creates in the playground production */
const SHOT_TITLE = "V7 — the decaf confession";

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
if (!page) throw new Error("no app page on the CDP port — launch with AUREA_CDP_PORT=9223");

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

const clickText = (selector: string, text: string) => `(() => {
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

await evaluate(`location.reload(); true`).catch(() => {});
await sleep(4500);
await evaluate(`location.hash = "#/storyboard"; true`);
await sleep(2000);

/* the acceptance shot lives in an episode of its own; pick it from whichever
 * episode the board opened on */
const foundEpisode = await evaluate<boolean>(`(() => {
  const h1 = document.querySelector("h1");
  if (h1 && h1.textContent.includes("V7 acceptance")) return true;
  const opener = h1 && h1.closest("button");
  if (opener) opener.click();
  return false;
})()`);
if (!foundEpisode) {
  await sleep(400);
  await evaluate<boolean>(clickText("button", "V7 acceptance"));
  await sleep(1200);
}
check(
  "the V7 acceptance episode is on the board",
  await evaluate<boolean>(`(document.querySelector("h1")?.textContent ?? "").includes("V7 acceptance")`),
  await evaluate<string>(`document.querySelector("h1")?.textContent ?? "—"`),
);

check("the boarded shot card opens", await evaluate<boolean>(clickText("button", "decaf confession")));
await sleep(900);
check(
  "the inspector offers Send to Director",
  await evaluate<boolean>(`document.body.textContent.includes("Send to Director")`),
);

check("…and it fires", await evaluate<boolean>(clickText("button", "Send to Director")));
// the core measures the takes and probes the engine before it answers
await sleep(3500);

check(
  "the Video lab opened",
  await evaluate<boolean>(`location.hash === "#/video"`),
  await evaluate<string>(`location.hash`),
);
check(
  "…saying where the shot came from",
  await evaluate<boolean>(
    `document.body.textContent.includes("From the storyboard") &&
     document.body.textContent.includes(${JSON.stringify(SHOT_TITLE)})`,
  ),
);
check(
  "the Director is already on",
  await evaluate<boolean>(
    `[...document.querySelectorAll("button")].some(b => b.textContent.trim() === "On")`,
  ),
);

const panel = await evaluate<{
  beats: number;
  takes: number;
  refs: number;
  duration: string;
  frame: string;
  score: boolean;
}>(`(() => {
  const text = document.body.textContent;
  const count = (re) => (text.match(re) || []).length;
  const scoreBox = [...document.querySelectorAll("label")]
    .find(l => l.textContent.includes("Score the gaps"))?.querySelector("input");
  return {
    // one text input per beat, one "when does this line start" input per take
    beats: document.querySelectorAll('input[placeholder^="Beat "]').length,
    takes: document.querySelectorAll('input[title="When this line starts"]').length,
    refs: count(/Top Row (Left|Right)/g),
    // the length picker is a custom dropdown, so read what it displays
    duration: (text.match(/\\d+ seconds/) || [""])[0],
    frame: (text.match(/breakroom-two-shot\\.png/) || [""])[0],
    // scoring is off when the composer placed the takes itself
    score: !!scoreBox && scoreBox.checked,
  };
})()`);
console.log("panel:", JSON.stringify(panel));

check("a beat per script line, plus the room", panel.beats === 3, String(panel.beats));
/* The button composes from the shot alone, and this shot's lines have no voice
 * takes recorded against them yet — so the lane is empty ON PURPOSE and the
 * panel says the beats are timed from the word count. Placing takes is the
 * agent's job (shot_from_storyboard takes[]) or the user's, right here. */
check("the audio lane is empty until there are takes to place", panel.takes === 0, String(panel.takes));
check(
  "…and the panel says the timing is an estimate",
  await evaluate<boolean>(`document.body.textContent.includes("timed from the word count")`),
);
check("the cast sheet has two cells", panel.refs === 2, String(panel.refs));
check("the composed length came over", /^\d+ seconds$/.test(panel.duration), panel.duration);
check("the board's keyframe is the start frame", panel.frame === "breakroom-two-shot.png", panel.frame);
/* No takes on the lane means no gaps to argue about, so the scoring toggle
 * isn't offered at all — assert that pair rather than reading a control that
 * isn't on screen (a check that can only pass proves nothing). Scoring being
 * turned OFF once takes ARE placed is pinned in shot-spec.test.ts. */
check(
  "with an empty lane there is nothing to score",
  panel.score === false &&
    !(await evaluate<boolean>(`document.body.textContent.includes("Score the gaps")`)),
);

await evaluate(`window.scrollTo(0, 0); true`);
await sleep(400);
await shoot("v7-send-to-director.png");

ws.close();
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
