/* Seedance remote adapter E2E against a mock fal.ai queue — proves the whole
 * loop without spending money: submit (auth header + data-URI frame + snapped
 * duration/resolution), IN_QUEUE → IN_PROGRESS → COMPLETED polling, video
 * download into the job scratch dir, the no-key error, cancel propagation,
 * and the catalog/job-detail cost estimates.
 *
 * Run: npx tsx scripts/test-seedance.mts */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const { SettingsStore } = await import("../packages/core/src/settings.js");
const { SeedanceAdapter, seedanceEstimate } = await import(
  "../packages/core/src/adapters/seedance.js"
);
const { labEnqueue } = await import("../packages/core/src/labs.js");
const { MODEL_PATH_TEST } = { MODEL_PATH_TEST: "fal-ai/bytedance/seedance/v1/pro/image-to-video" };

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

/* ---- cost estimates ---- */
check("estimate 720p 5s", seedanceEstimate(5, "1280 × 720 (16:9)") === "≈ $0.25");
check("estimate 1080p 10s", seedanceEstimate(10, "1920 × 1080") === "≈ $1.50");
const enq = labEnqueue(
  {
    type: "video",
    prompt: "test",
    engine: "seedance",
    startFrame: "x.png",
    durationSec: 5,
    resolution: "1280 × 720 (16:9)",
  },
  "playground",
);
check(
  "job detail carries the cost before spend",
  enq.engine === "Seedance" && enq.detail.includes("≈ $0.25"),
  enq.detail,
);

/* ---- mock fal queue ---- */
let statusCalls = 0;
let holdStatus = false;
let sawAuth = "";
let sawBody: Record<string, unknown> = {};
let cancelCalled = false;
const server = http.createServer((req, res) => {
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const url = req.url ?? "";
    if (req.method === "POST" && url === `/${MODEL_PATH_TEST}`) {
      sawAuth = String(req.headers.authorization ?? "");
      sawBody = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      send(200, { request_id: "r-test-1" });
    } else if (url.endsWith("/requests/r-test-1/status")) {
      statusCalls += 1;
      const status = holdStatus
        ? "IN_PROGRESS"
        : statusCalls === 1
          ? "IN_QUEUE"
          : statusCalls === 2
            ? "IN_PROGRESS"
            : "COMPLETED";
      send(200, { status });
    } else if (url.endsWith("/requests/r-test-1/cancel")) {
      cancelCalled = true;
      send(200, { ok: true });
    } else if (url.endsWith("/requests/r-test-1")) {
      send(200, { video: { url: `http://127.0.0.1:${port}/video.mp4` } });
    } else if (url === "/video.mp4") {
      res.writeHead(200, { "content-type": "video/mp4" });
      res.end(Buffer.from("fake-mp4-bytes-".repeat(64)));
    } else {
      send(404, { error: "not found" });
    }
  });
});
const port = await new Promise<number>((resolve) => {
  server.listen(0, "127.0.0.1", () => {
    resolve((server.address() as { port: number }).port);
  });
});

const settings = new SettingsStore();
const originalKey = settings.get().providers.falApiKey;
const dataRoot = settings.get().storage.dataRoot;
const frameRel = (() => {
  // any small png in the playground assets tree
  const dir = path.join(dataRoot, "projects", "playground", "assets", "image");
  const png = fs.readdirSync(dir).find((f) => /\.(png|jpe?g|webp)$/i.test(f));
  if (!png) throw new Error("no image asset to use as a start frame");
  return `projects/playground/assets/image/${png}`;
})();

const progress: string[] = [];
const report = (p: { progress?: number; stage?: string; detail?: string }) => {
  if (p.stage && !progress.includes(p.stage)) progress.push(p.stage);
};
const fakeJob = (id: string) =>
  ({
    id,
    payload: {
      type: "video",
      prompt: "a calm establishing shot",
      engine: "seedance",
      startFrame: frameRel,
      durationSec: 8,
      resolution: "1280 × 720 (16:9)",
    },
  }) as never;

try {
  /* no key → clean failure */
  settings.update({ providers: { falApiKey: "" } });
  const noKey = new SeedanceAdapter(settings, `http://127.0.0.1:${port}`);
  const failed = await noKey
    .start(fakeJob("j-seedance-nokey"), report)
    .done.then(() => null)
    .catch((e: Error) => e.message);
  check("no key fails with a pointer to Settings", !!failed && failed.includes("fal.ai API key"), failed ?? "");

  /* full happy path */
  settings.update({ providers: { falApiKey: "test-key-id:test-secret" } });
  const adapter = new SeedanceAdapter(settings, `http://127.0.0.1:${port}`);
  const run = adapter.start(fakeJob("j-seedance-ok"), report);
  const result = await run.done;
  check("auth header carries the fal key", sawAuth === "Key test-key-id:test-secret", sawAuth);
  check(
    "submit body: data-URI frame + snapped duration + resolution",
    String(sawBody.image_url).startsWith("data:image/") &&
      sawBody.duration === "10" &&
      sawBody.resolution === "720p",
    `duration=${sawBody.duration} resolution=${sawBody.resolution}`,
  );
  check("polls through the queue states", statusCalls >= 3, `${statusCalls} status calls`);
  check(
    "mp4 lands in the job scratch dir",
    fs.existsSync(result.output) && fs.statSync(result.output).size > 500,
    result.output,
  );
  check(
    "stages narrate the remote render",
    progress.some((s) => s.includes("fal.ai")) && progress.some((s) => s.includes("cloud")),
    progress.join(" | "),
  );

  /* cancel propagates */
  holdStatus = true; // keep status IN_PROGRESS forever
  const run2 = adapter.start(fakeJob("j-seedance-cancel"), report);
  setTimeout(() => run2.cancel(), 500);
  const msg = await run2.done.then(() => null).catch((e: Error) => e.message);
  check("cancel aborts the wait and hits the cancel URL", msg === "Canceled by user" && cancelCalled, msg ?? "");
} finally {
  settings.update({ providers: { falApiKey: originalKey } });
  server.close();
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
