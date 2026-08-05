/* GPT Image 2 adapter E2E against a mock fal.ai queue — proves the whole loop
 * without spending money: submit (auth header, N data-URI references, quality,
 * image_size auto vs explicit, num_images, output_format, mask_url), queue
 * polling, multi-image download into the job scratch dir with the same file
 * names the local Comfy adapter uses, the no-key error, the per-model
 * reference cap, cancel propagation, and the cost estimates.
 *
 * The point of the ref-count assertions is the whole reason this adapter
 * exists: local qwen-edit stops at 3 references, this path takes 16.
 *
 * Run: npx tsx scripts/test-fal-image.mts */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const { SettingsStore } = await import("../packages/core/src/settings.js");
const { FalImageAdapter, FAL_IMAGE_MODELS, GPT_IMAGE_2_MAX_REFS } = await import(
  "../packages/core/src/adapters/fal-image.js"
);
const { labEnqueue } = await import("../packages/core/src/labs.js");
const { falImageEstimate, falSizeError } = await import("../packages/shared/src/falImage.js");

const MODEL_PATH = FAL_IMAGE_MODELS["gpt-image-2"].path;
const GENERATE_PATH = FAL_IMAGE_MODELS["gpt-image-2"].generatePath!;

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

/* ---- cost estimates ---- */
check("estimate: 1 high image", falImageEstimate("high", 1) === "≈ $0.22", falImageEstimate("high", 1));
check("estimate: 4 low images", falImageEstimate("low", 4) === "≈ $0.06", falImageEstimate("low", 4));
check(
  "estimate: sub-cent totals don't render as free",
  falImageEstimate("low", 1) === "≈ $0.015",
  falImageEstimate("low", 1),
);
check(
  "estimate: a bigger canvas costs more",
  falImageEstimate("high", 1, 2048, 2048) === "≈ $0.88",
  falImageEstimate("high", 1, 2048, 2048),
);
check(
  "catalog says 16 references",
  GPT_IMAGE_2_MAX_REFS === 16 && FAL_IMAGE_MODELS["gpt-image-2"].refsMax === 16,
);

const enq = labEnqueue(
  {
    type: "image",
    prompt: "the whole cast in the breakroom",
    model: "gpt-image-2",
    aspect: "16:9",
    count: 2,
    quality: "medium",
    refs: ["a.png", "b.png", "c.png", "d.png"],
  } as never,
  "playground",
);
check(
  "job detail carries refs + quality + cost before spend",
  enq.engine === "GPT Image 2 · fal.ai" &&
    enq.detail.includes("4 refs") &&
    enq.detail.includes("medium") &&
    enq.detail.includes("≈ $0.12"),
  enq.detail,
);

/* ---- mock fal queue ---- */
let statusCalls = 0;
let holdStatus = false;
let sawAuth = "";
let sawPath = "";
let sawBody: Record<string, unknown> = {};
let cancelCalled = false;
let imagesToReturn = 1;
const server = http.createServer((req, res) => {
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const url = req.url ?? "";
    if (req.method === "POST" && (url === `/${MODEL_PATH}` || url === `/${GENERATE_PATH}`)) {
      sawAuth = String(req.headers.authorization ?? "");
      sawBody = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      sawPath = url.slice(1);
      send(200, { request_id: "r-img-1" });
    } else if (url.endsWith("/requests/r-img-1/status")) {
      statusCalls += 1;
      const status = holdStatus
        ? "IN_PROGRESS"
        : statusCalls === 1
          ? "IN_QUEUE"
          : statusCalls === 2
            ? "IN_PROGRESS"
            : "COMPLETED";
      send(200, { status });
    } else if (url.endsWith("/requests/r-img-1/cancel")) {
      cancelCalled = true;
      send(200, { ok: true });
    } else if (url.endsWith("/requests/r-img-1")) {
      send(200, {
        images: Array.from({ length: imagesToReturn }, (_, i) => ({
          url: `http://127.0.0.1:${port}/out-${i}.png`,
        })),
      });
    } else if (url.startsWith("/out-")) {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(Buffer.from("fake-png-bytes-".repeat(64)));
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

/** real image assets to reference — the adapter reads and base64s them */
const pool = (() => {
  const dir = path.join(dataRoot, "projects", "playground", "assets", "image");
  const found = fs
    .readdirSync(dir)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .map((f) => `projects/playground/assets/image/${f}`);
  if (found.length === 0) throw new Error("no image assets to use as references");
  return found;
})();
/** cycle the pool up to 16 — the point is the count, not 16 distinct pictures */
const refsOf = (n: number) => Array.from({ length: n }, (_, i) => pool[i % pool.length]);

const progress: string[] = [];
const report = (p: { progress?: number; stage?: string; detail?: string }) => {
  if (p.stage && !progress.includes(p.stage)) progress.push(p.stage);
};
const fakeJob = (id: string, payload: Record<string, unknown>) =>
  ({
    id,
    payload: {
      type: "image",
      prompt: "the whole cast around one table",
      model: "gpt-image-2",
      aspect: "16:9",
      count: 1,
      refs: refsOf(1),
      ...payload,
    },
  }) as never;

try {
  /* no key → clean failure */
  settings.update({ providers: { falApiKey: "" } });
  const noKey = new FalImageAdapter(settings, `http://127.0.0.1:${port}`);
  const failed = await noKey
    .start(fakeJob("j-fal-nokey", {}), report)
    .done.then(() => null)
    .catch((e: Error) => e.message);
  check(
    "no key fails with a pointer to Settings",
    !!failed && failed.includes("fal.ai API key"),
    failed ?? "",
  );

  settings.update({ providers: { falApiKey: "test-key-id:test-secret" } });
  const adapter = new FalImageAdapter(settings, `http://127.0.0.1:${port}`);

  /* zero refs → the plain text-to-image endpoint, no image_urls on the wire */
  imagesToReturn = 1;
  const t2i = await adapter.start(
    fakeJob("j-fal-t2i", { refs: [], sizeMode: "auto", quality: "low" }),
    report,
  ).done;
  check(
    "a prompt-only run routes to the text-to-image endpoint",
    sawPath === GENERATE_PATH,
    sawPath,
  );
  check(
    "the t2i body carries no image_urls or mask_url",
    !("image_urls" in sawBody) && !("mask_url" in sawBody) && sawBody.quality === "low",
    Object.keys(sawBody).join(","),
  );
  check(
    "the t2i still lands in the job scratch dir",
    fs.existsSync(t2i.output) && path.basename(t2i.output) === "image.png",
    t2i.output,
  );

  /* a mask with nothing to edit is a contradiction, not a silent no-op */
  const maskNoRefs = await adapter
    .start(fakeJob("j-fal-masknorefs", { refs: [], mask: pool[0] }), report)
    .done.then(() => null)
    .catch((e: Error) => e.message);
  check(
    "a mask without a reference is refused",
    !!maskNoRefs && maskNoRefs.includes("needs a reference image"),
    maskNoRefs ?? "",
  );

  /* fal's size rules, enforced before anything is uploaded */
  check("size rule: 512×512 is too small", !!falSizeError(512, 512));
  check("size rule: 1024×640 is exactly the floor", falSizeError(1024, 640) === null);
  check("size rule: 4096 edge is refused", !!falSizeError(4096, 1024));
  check("size rule: 1000×640 is not a multiple of 16", !!falSizeError(1000, 640));
  check("size rule: 3840×640 breaks the 3:1 aspect", !!falSizeError(3840, 640));
  const badSize = await adapter
    .start(
      fakeJob("j-fal-badsize", { refs: refsOf(1), width: 512, height: 512, sizeMode: "aspect" }),
      report,
    )
    .done.then(() => null)
    .catch((e: Error) => e.message);
  check(
    "a too-small explicit size fails locally, before the upload",
    !!badSize && badSize.includes("too small"),
    badSize ?? "",
  );

  /* past the model's ceiling → clean failure, not a fal 4xx */
  const tooMany = await adapter
    .start(fakeJob("j-fal-toomany", { refs: refsOf(17) }), report)
    .done.then(() => null)
    .catch((e: Error) => e.message);
  check(
    "17 references is refused locally with the real limit",
    !!tooMany && tooMany.includes("at most 16"),
    tooMany ?? "",
  );

  /* the headline: 16 references in one edit */
  statusCalls = 0;
  imagesToReturn = 1;
  const run = adapter.start(
    fakeJob("j-fal-16refs", {
      refs: refsOf(16),
      quality: "medium",
      outputFormat: "webp",
      sizeMode: "auto",
      mask: pool[0],
    }),
    report,
  );
  const result = await run.done;
  check("auth header carries the fal key", sawAuth === "Key test-key-id:test-secret", sawAuth);
  check("a referenced run routes to the edit endpoint", sawPath === MODEL_PATH, sawPath);
  check(
    "submit body sends all 16 references as data URIs",
    Array.isArray(sawBody.image_urls) &&
      (sawBody.image_urls as string[]).length === 16 &&
      (sawBody.image_urls as string[]).every((u) => u.startsWith("data:image/")),
    `${(sawBody.image_urls as string[])?.length} urls`,
  );
  check(
    "submit body carries quality / format / auto size / mask",
    sawBody.quality === "medium" &&
      sawBody.output_format === "webp" &&
      sawBody.image_size === "auto" &&
      String(sawBody.mask_url).startsWith("data:image/"),
    `quality=${sawBody.quality} format=${sawBody.output_format} size=${JSON.stringify(sawBody.image_size)}`,
  );
  check("polls through the queue states", statusCalls >= 3, `${statusCalls} status calls`);
  check(
    "the image lands in the job scratch dir with the local adapter's name",
    fs.existsSync(result.output) &&
      path.basename(result.output) === "image.webp" &&
      fs.statSync(result.output).size > 500,
    result.output,
  );
  check(
    "stages narrate the remote render",
    progress.some((s) => s.includes("fal.ai")) && progress.some((s) => s.includes("cloud")),
    progress.join(" | "),
  );

  /* explicit size + a batch → folder output, numbered like the local adapter */
  statusCalls = 0;
  imagesToReturn = 3;
  const batch = await adapter.start(
    fakeJob("j-fal-batch", {
      refs: refsOf(2),
      count: 3,
      width: 1536,
      height: 1024,
      sizeMode: "aspect",
      quality: "high",
    }),
    report,
  ).done;
  check(
    "explicit width/height beat the aspect preset",
    JSON.stringify(sawBody.image_size) === JSON.stringify({ width: 1536, height: 1024 }) &&
      sawBody.num_images === 3,
    `${JSON.stringify(sawBody.image_size)} num_images=${sawBody.num_images}`,
  );
  check(
    "a batch lands as a folder of numbered stills",
    fs.statSync(batch.output).isDirectory() &&
      ["image-1.png", "image-2.png", "image-3.png"].every((f) =>
        fs.existsSync(path.join(batch.output, f)),
      ),
    batch.output,
  );

  /* aspect with no explicit size → the fal preset */
  statusCalls = 0;
  imagesToReturn = 1;
  await adapter.start(
    fakeJob("j-fal-aspect", { refs: refsOf(1), aspect: "9:16", sizeMode: "aspect" }),
    report,
  ).done;
  check(
    "a bare aspect maps to fal's size preset",
    sawBody.image_size === "portrait_16_9",
    String(sawBody.image_size),
  );

  /* cancel propagates */
  holdStatus = true; // keep status IN_PROGRESS forever
  const run2 = adapter.start(fakeJob("j-fal-cancel", { refs: refsOf(2) }), report);
  setTimeout(() => run2.cancel(), 400);
  const msg = await run2.done.then(() => null).catch((e: Error) => e.message);
  check(
    "cancel aborts the wait and hits the cancel URL",
    msg === "Canceled by user" && cancelCalled,
    msg ?? "",
  );
} finally {
  settings.update({ providers: { falApiKey: originalKey } });
  server.close();
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
