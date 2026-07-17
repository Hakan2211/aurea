/* In-app CDP check for Director attach-asset — drives the REAL renderer:
 * clicks the planted red test frame in the Director's asset rail, watches the
 * pending chip appear in the composer, sends a message, and confirms (a) the
 * attachment chip renders on the sent user message, (b) the pending chip
 * clears, and (c) the Director's reply proves it saw the image.
 *
 * Run (app already launched with --remote-debugging-port=9223):
 *   npx tsx scripts/cdp-attach-check.mts */

import WebSocket from "ws";

const CDP = "http://127.0.0.1:9223";
const ASSET = "attach-test-red.png";

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
    /* app still booting */
  }
  if (!page) await sleep(1000);
}
if (!page) throw new Error("no app page on the CDP port — launch with --remote-debugging-port=9223");

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
const uiText = async () => ((await evaluate("document.body.innerText")) as string).toLowerCase();

try {
  await evaluate(`location.hash = "#/"`);
  await sleep(2500);

  /* ---- attach by clicking the rail thumbnail ---- */
  const clicked = await evaluate(`(() => {
    const thumb = [...document.querySelectorAll('button[title^="Attach "]')]
      .find((b) => b.title.includes(${JSON.stringify(ASSET)}));
    if (!thumb) return false;
    thumb.click();
    return true;
  })()`);
  check("rail thumbnail for the test frame is clickable", clicked === true);
  await sleep(500);

  let text = await uiText();
  check("pending attachment chip renders in the composer", text.includes(ASSET));
  check(
    "composer placeholder switches to attach mode",
    text.includes("what should the director do with these?") ||
      ((await evaluate(`document.querySelector("textarea")?.placeholder ?? ""`)) as string)
        .toLowerCase()
        .includes("what should the director do"),
  );

  /* ---- type + send through the real composer ---- */
  await evaluate(`(() => {
    const ta = document.querySelector("textarea");
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    set.call(ta, "Without using any tools: in one short sentence, what single color fills the attached frame?");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  })()`);
  await sleep(1500);

  text = await uiText();
  check("attachment chip renders on the sent user message", text.includes(ASSET));
  check(
    "pending chips cleared after send",
    !((await evaluate(`document.querySelector("textarea")?.placeholder ?? ""`)) as string)
      .toLowerCase()
      .includes("what should the director do"),
  );

  /* ---- the reply proves the Director saw the image ---- */
  let sawRed = false;
  for (let i = 0; i < 120 && !sawRed; i++) {
    const t = await uiText();
    sawRed = /red|crimson|scarlet/.test(t.split(ASSET).pop() ?? "");
    if (!sawRed) await sleep(1500);
  }
  check("Director reply names the color in-app", sawRed);

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
} finally {
  ws.close();
}
process.exit(failures === 0 ? 0 : 1);
