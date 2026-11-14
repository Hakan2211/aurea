/* LTX 2.5 pipeline E2E — a real managed render through labs.video.generate
 * on engine "ltx25" (the graph unit checks live in ltx25-graph.test.ts).
 *
 * Needs: the LTX 2.5 weights present (downloaded into a linked root like
 * D:\models, or installed via the model manager) and the managed runtime on
 * ComfyUI v0.32.0+.
 *
 * Flags: --t2v renders from the prompt alone instead of a start frame,
 *        --draft stops after the base pass (fast smoke test).
 * Run: npx tsx scripts/test-ltx25-video.mts [--t2v] [--draft] */

import fs from "node:fs";

const { startStudiod } = await import("../packages/core/src/server.js");
const { createStudiodApi } = await import("../packages/core/src/tools.js");

const args = process.argv.slice(2);
const t2v = args.includes("--t2v");
const draft = args.includes("--draft");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const handle = await startStudiod({ writePortFile: false });
const api = createStudiodApi(handle.port, handle.token);
const settings = await api.settings.get.query();
const project = (await api.projects.list.query())[0].id;
const originalMode = settings.engines.videoMode;

try {
  const ltx25 = (await api.models.list.query()).find((m) => m.id === "ltx-25-22b-int8");
  const state = ltx25?.status.state;
  if (state !== "installed" && state !== "linked") {
    check("ltx-25 weights present (installed or linked)", false, state ?? "not in registry");
  } else {
    check("ltx-25 weights present (installed or linked)", true, state);
    await api.settings.update.mutate({ engines: { videoMode: "managed" } });

    const catalog = await api.labs.video.catalog.query();
    const engine = catalog.engines.find((e: { id: string }) => e.id === "ltx25");
    check("ltx25 engine in the catalog and available", !!engine?.available, engine?.note);

    const frame = t2v
      ? undefined
      : (await api.library.list.query()).assets.find((a) => a.kind === "image");
    if (!t2v && !frame) throw new Error("no image in the library to use as a start frame");

    const startedAt = new Date().toISOString();
    const job = await api.labs.video.generate.mutate({
      project,
      engine: "ltx25",
      prompt: t2v
        ? "A tabby cat stretches on a sunlit windowsill, dust motes drifting, soft morning light, static camera."
        : "The character breathes gently and glances to the side, soft cinematic lighting, static camera.",
      startFrame: frame?.relPath,
      durationSec: 3,
      resolution: "704 × 896 (portrait)",
      seed: 42,
      fast: draft || undefined,
    });
    console.log(`enqueued ${job.id}${frame ? ` (start frame: ${frame.name})` : " (t2v)"}`);

    const stages = new Set<string>();
    const started = Date.now();
    let final: { status: string; error?: string | null; output?: string | null } | undefined;
    for (;;) {
      const j = (await api.jobs.list.query()).find((x) => x.id === job.id)!;
      if (j.stage) stages.add(j.stage);
      if (j.status === "completed" || j.status === "failed") {
        final = j;
        break;
      }
      if (Date.now() - started > 40 * 60_000) {
        await api.jobs.cancel.mutate({ id: job.id }).catch(() => {});
        throw new Error(`timed out after 40 min (stages: ${[...stages].join(" | ")})`);
      }
      await sleep(2000);
    }
    const tookSec = Math.round((Date.now() - started) / 1000);

    check("job completed", final!.status === "completed", final!.error ?? `${tookSec}s`);
    check(
      "websocket stages seen",
      [...stages].some((s) => s.startsWith("Rendering")),
      [...stages].join(" | "),
    );
    const out = final!.output;
    check("mp4 on disk", !!out && fs.existsSync(out) && fs.statSync(out).size > 100_000, out ?? "");
    const asset = (await api.library.list.query()).assets.find(
      (a) => a.kind === "video" && a.createdAt >= startedAt,
    );
    check("take imported into the library", !!asset, asset?.relPath);
  }
} finally {
  await api.settings.update.mutate({ engines: { videoMode: originalMode } }).catch(() => {});
  await handle.close();
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
