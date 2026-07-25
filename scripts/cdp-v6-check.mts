/* In-app CDP check for the Director's V6 surface — the cast lane.
 *
 * Everything here is reachable with the Ingredients IC-LoRA still missing,
 * which is the point: the section has to explain itself rather than fail at
 * render time. Four things:
 *   1. the lane appears with the Director and says what's missing (or, once the
 *      weight is installed, opens its picker)
 *   2. a ref can be added, described, and shows the sheet cell it lands in
 *   3. the cast lane and the motion lane close each other — one IC-LoRA slot
 *   4. the sheet layout readout tracks the number of refs
 *
 * Run (app launched with --remote-debugging-port=9223):
 *   npx tsx scripts/cdp-v6-check.mts */

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

// panel state persists across a run, so start from a reload (v5 check precedent)
await evaluate(`location.reload(); true`).catch(() => {});
await sleep(4000);
await evaluate(`location.hash = "#/video"; true`);
await sleep(1500);
check("the Video lab is up", await evaluate<boolean>(`document.body.textContent.includes("Shot Director")`));

check("Director toggled on", await evaluate<boolean>(clickJs("button", "Off")));
await sleep(600);
check(
  "the cast lane appears with the Director",
  await evaluate<boolean>(`document.body.textContent.includes("Cast references")`),
);

/** the section is either gated (no weight / old pack) or open for business */
const gated = await evaluate<boolean>(
  `document.body.textContent.includes("Ingredients") &&
   !document.body.textContent.includes("Cast references") === false &&
   ![...document.querySelectorAll("button")].some(b => b.textContent.trim() === "Add")`,
);
if (gated) {
  check(
    "with the weight missing it says exactly what to install",
    await evaluate<boolean>(
      `document.body.textContent.includes("Ingredients") &&
       (document.body.textContent.includes("v2.0.4") || document.body.textContent.includes("Not installed"))`,
    ),
  );
  await evaluate<boolean>(`(() => {
    const h = [...document.querySelectorAll("h4")].find(e => e.textContent.trim() === "Cast references");
    if (h) h.scrollIntoView({ block: "center" });
    return !!h;
  })()`);
  await sleep(300);
  await shoot("v6-cast-lane-gated.png");
  console.log(
    "\nNOTE  the cast lane is gated on this machine — install the Ingredients IC-LoRA to " +
      "check the ref rows themselves.",
  );
  ws.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

/* ---- the lane is live: add a ref and read its cell ---- */
check("the ref picker opens", await evaluate<boolean>(clickJs("button", "Add")));
await sleep(400);
const first = await evaluate<string | null>(`(() => {
  const menu = [...document.querySelectorAll("div")].find(d =>
    d.className.includes("bg-raised") && d.className.includes("top-7") && d.querySelector("button"));
  const b = menu && [...menu.querySelectorAll("button")][0];
  if (!b) return null;
  const name = b.textContent.trim();
  b.click();
  return name;
})()`);
check("a reference attaches", !!first, first ?? "no picker rows");
await sleep(600);

check(
  "a single ref fills the sheet, so it has no position",
  await evaluate<boolean>(`document.body.textContent.includes("Reference")`),
);

// a second ref turns it into a grid, and the cells get named
await evaluate<boolean>(clickJs("button", "Add"));
await sleep(400);
await evaluate<boolean>(`(() => {
  const menu = [...document.querySelectorAll("div")].find(d =>
    d.className.includes("bg-raised") && d.className.includes("top-7") && d.querySelector("button"));
  const bs = menu ? [...menu.querySelectorAll("button")] : [];
  const b = bs[1] ?? bs[0];
  if (!b) return false;
  b.click();
  return true;
})()`);
await sleep(600);
check(
  "two refs read as a 2×1 sheet with named cells",
  await evaluate<boolean>(
    `document.body.textContent.includes("Top Row Left") &&
     document.body.textContent.includes("Top Row Right")`,
  ),
);

// describing a ref is what the model actually reads
await evaluate<boolean>(`(() => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  const ta = [...document.querySelectorAll("textarea")].find(t =>
    (t.placeholder || "").includes("must stay true"));
  if (!ta) return false;
  setter.call(ta, "a lion in a blue velvet blazer, amber eyes");
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`);
await sleep(400);

check(
  "the cast sheet closes the motion lane",
  await evaluate<boolean>(
    `document.body.textContent.includes("holds the IC-LoRA slot") &&
     ![...document.querySelectorAll("button")].some(b => b.textContent.includes("Add reference"))`,
  ),
);

await evaluate<boolean>(`(() => {
  const h = [...document.querySelectorAll("h4")].find(e => e.textContent.trim() === "Cast references");
  if (h) h.scrollIntoView({ block: "center" });
  return !!h;
})()`);
await sleep(400);
await shoot("v6-cast-lane.png");

ws.close();
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
