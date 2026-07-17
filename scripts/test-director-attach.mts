/* Director attach-asset E2E — real studiod + a real Claude run:
 *
 *   1. a synthetic solid-red PNG dropped into the playground assets tree
 *      shows up in the library scan
 *   2. director.send carries the attachment; it persists on the user message
 *      (state + director.json on disk)
 *   3. the Director actually SEES the image — the reply names the color —
 *      and can echo the relPath from the [Attached assets] block
 *   4. a plain no-attachment send still works (the string-prompt path)
 *
 * Run: npx tsx scripts/test-director-attach.mts */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const { startStudiod } = await import("../packages/core/src/server.js");
const { createStudiodApi } = await import("../packages/core/src/tools.js");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---- minimal PNG writer: one solid rgb square ---- */
function solidPng(size: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3)]);
  for (let x = 0; x < size; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const handle = await startStudiod({ writePortFile: false });
const api = createStudiodApi(handle.port, handle.token);

const settings = await api.settings.get.query();
const dataRoot = settings.storage.dataRoot;
const project = (await api.projects.list.query())[0].id;
console.log(`project: ${project}, model: ${settings.providers.claudeModel}`);

/* the Director run finishes when status flips back to idle */
async function awaitIdle(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await api.director.get.query({ project });
    if (state.status === "idle") return state;
    if (Date.now() > deadline) throw new Error("Director run did not finish in time");
    await sleep(1500);
  }
}
const lastReply = (state: { messages: { role: string; text?: string; tool?: unknown }[] }) =>
  [...state.messages].reverse().find((m) => m.role === "director" && m.text)?.text ?? "";

try {
  /* ---- 1: plant the red frame, let the library scan find it ---- */
  const name = "attach-test-red.png";
  const absDir = path.join(dataRoot, "projects", project, "assets", "image");
  fs.mkdirSync(absDir, { recursive: true });
  fs.writeFileSync(path.join(absDir, name), solidPng(64, [220, 30, 30]));
  const asset = (await api.library.list.query()).assets.find((a) => a.name === name);
  check("library scan picks up the planted PNG", !!asset, asset?.relPath);
  if (!asset) throw new Error("no asset — cannot continue");

  /* ---- 2+3: send with the attachment ---- */
  await api.director.send.mutate({
    project,
    text:
      "I attached a small test frame. Without using any tools: in one short sentence, what single " +
      "color fills the attached image? Then on a second line repeat its relPath exactly as given.",
    attachments: [{ kind: asset.kind, name: asset.name, relPath: asset.relPath }],
  });
  let state = await awaitIdle(4 * 60_000);

  const userMsg = [...state.messages].reverse().find((m) => m.role === "user");
  check(
    "attachment persists on the user message",
    userMsg?.attachments?.length === 1 && userMsg.attachments[0].relPath === asset.relPath,
  );
  const onDisk = JSON.parse(
    fs.readFileSync(path.join(dataRoot, "projects", project, "director.json"), "utf8"),
  );
  const diskUser = [...onDisk.messages].reverse().find((m: { role: string }) => m.role === "user");
  check("attachment persists in director.json", diskUser?.attachments?.[0]?.relPath === asset.relPath);

  const reply = lastReply(state);
  console.log(`reply:\n${reply}\n`);
  check("the Director saw the image (names red)", /red|crimson|scarlet/i.test(reply));
  check("the Director can echo the relPath", reply.includes(asset.relPath));

  /* ---- 4: plain send (no attachments) still runs the string-prompt path ---- */
  await api.director.send.mutate({
    project,
    text: "Without using any tools, reply with exactly: ok",
  });
  state = await awaitIdle(3 * 60_000);
  check("plain no-attachment send still works", /\bok\b/i.test(lastReply(state)));
} finally {
  await handle.close();
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
