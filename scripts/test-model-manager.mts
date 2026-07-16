/* ModelManager E2E against a local throttled HTTP server — deterministic
 * proof of the P1 download contract without depending on Hugging Face uptime:
 *   1. license gate refuses until accepted, acceptance persists
 *   2. cancel keeps the .part; the next download resumes with a Range request
 *   3. the digest covers resumed bytes and the install verifies sha256
 *   4. a wrong registry sha256 fails the install and deletes the file
 *   5. a dead connection aborts via the stall watchdog instead of hanging
 *
 * Run: npx tsx scripts/test-model-manager.ts */

process.env.AUREA_MODEL_STALL_MS = "1500";

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const { ModelManager } = await import("../packages/core/src/models/manager.js");
type Manager = InstanceType<typeof ModelManager>;

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aurea-models-"));
const settings = { get: () => ({ storage: { dataRoot } }) } as never;

/* ---------- throttled file server with Range support ---------- */

const PAYLOAD = randomBytes(4 * 1024 * 1024); // 4 MB
const PAYLOAD_SHA = createHash("sha256").update(PAYLOAD).digest("hex");
const CHUNK = 128 * 1024;
const CHUNK_MS = 25; // ~5 MB/s → ~800ms full transfer

const rangesSeen: string[] = [];

const server = http.createServer((req, res) => {
  if (req.url === "/stall") {
    return; // accept and never answer — watchdog territory
  }
  const range = req.headers.range;
  if (range) rangesSeen.push(range);
  const start = range ? Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0) : 0;
  res.writeHead(range ? 206 : 200, {
    "content-length": PAYLOAD.length - start,
    ...(range ? { "content-range": `bytes ${start}-${PAYLOAD.length - 1}/${PAYLOAD.length}` } : {}),
  });
  let at = start;
  const timer = setInterval(() => {
    if (at >= PAYLOAD.length) {
      clearInterval(timer);
      res.end();
      return;
    }
    res.write(PAYLOAD.subarray(at, Math.min(at + CHUNK, PAYLOAD.length)));
    at += CHUNK;
  }, CHUNK_MS);
  res.on("close", () => clearInterval(timer));
});

const port = await new Promise<number>((resolve) => {
  server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
});
const base = `http://127.0.0.1:${port}`;

/* ---------- registry fixtures ---------- */

const LICENSE_OK = { name: "Test License", url: `${base}/license`, gated: false };
const entry = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: id,
  use: "utility" as const,
  engine: "test",
  description: "fixture",
  sizeBytes: PAYLOAD.length,
  files: [{ name: "weights.bin", url: `${base}/file`, sizeBytes: PAYLOAD.length, sha256: PAYLOAD_SHA }],
  license: LICENSE_OK,
  essential: false,
  ...over,
});

const registry = [
  entry("gated-model", { license: { name: "Gated License", url: `${base}/license`, gated: true } }),
  entry("resumable-model"),
  entry("corrupt-model", {
    files: [{ name: "weights.bin", url: `${base}/file`, sizeBytes: PAYLOAD.length, sha256: "0".repeat(64) }],
  }),
  entry("stalling-model", {
    files: [{ name: "weights.bin", url: `${base}/stall`, sizeBytes: PAYLOAD.length, sha256: PAYLOAD_SHA }],
  }),
];

/* ---------- helpers ---------- */

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const status = (m: Manager, id: string) => m.list().find((e) => e.id === id)!.status;

const until = async (pred: () => boolean, ms: number, label: string) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
};

/* ---------- scenarios ---------- */

const mgr = new ModelManager(settings, registry as never);

// 1. license gate
let gateError = "";
try {
  mgr.download("gated-model");
} catch (err) {
  gateError = (err as Error).message;
}
check("license gate refuses without acceptance", gateError.includes("Gated License"), gateError);
mgr.download("gated-model", true);
await until(() => status(mgr, "gated-model").state === "installed", 10_000, "gated install");
check("gated model installs after acceptance", true);
const manifest = JSON.parse(fs.readFileSync(path.join(dataRoot, "models", "manifest.json"), "utf8"));
check("acceptance persisted to manifest", manifest.accepted.includes("gated-model"));

// 2 + 3. cancel → partial kept → resume via Range → sha verified end-to-end
mgr.download("resumable-model");
await until(() => status(mgr, "resumable-model").bytes > PAYLOAD.length / 4, 10_000, "midway");
mgr.cancel("resumable-model");
await until(() => status(mgr, "resumable-model").state === "absent", 5_000, "cancel settles");
const part = path.join(dataRoot, "models", "resumable-model", "weights.bin.part");
const partial = fs.existsSync(part) ? fs.statSync(part).size : 0;
check("cancel keeps the .part", partial > 0 && partial < PAYLOAD.length, `${partial} bytes on disk`);
check("status reports partial bytes", status(mgr, "resumable-model").bytes === partial);

rangesSeen.length = 0;
mgr.download("resumable-model");
await until(() => status(mgr, "resumable-model").state === "installed", 15_000, "resume install");
check(
  "resume used an HTTP Range request",
  rangesSeen.some((r) => r === `bytes=${partial}-`),
  rangesSeen.join(", ") || "no range seen",
);
const final = path.join(dataRoot, "models", "resumable-model", "weights.bin");
const gotSha = createHash("sha256").update(fs.readFileSync(final)).digest("hex");
check("resumed file matches source sha256", gotSha === PAYLOAD_SHA);
check("no .part left behind", !fs.existsSync(part));

// 4. corrupt registry sha → error + file removed
mgr.download("corrupt-model");
await until(() => status(mgr, "corrupt-model").state === "error", 15_000, "corrupt error");
const corrupt = status(mgr, "corrupt-model");
check("sha mismatch fails the install", (corrupt.error ?? "").includes("sha256 mismatch"), corrupt.error ?? "");
check(
  "corrupted download removed from disk",
  !fs.existsSync(path.join(dataRoot, "models", "corrupt-model", "weights.bin.part")) &&
    !fs.existsSync(path.join(dataRoot, "models", "corrupt-model", "weights.bin")),
);

// 5. stall watchdog
mgr.download("stalling-model");
await until(() => status(mgr, "stalling-model").state === "error", 10_000, "stall error");
check(
  "stalled connection aborts with a clear error",
  (status(mgr, "stalling-model").error ?? "").includes("no data"),
  status(mgr, "stalling-model").error ?? "",
);

// 6. remove
mgr.remove("resumable-model");
check("remove deletes the model dir", !fs.existsSync(path.join(dataRoot, "models", "resumable-model")));
check("removed model reports absent", status(mgr, "resumable-model").state === "absent");

mgr.close();
server.close();
fs.rmSync(dataRoot, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
