/* Managed image generation E2E — the whole P1 path, headless:
 *
 *   tRPC labs.image.generate (z-image) → JobEngine → ComfyImageAdapter →
 *   ComfyService spawns the managed headless ComfyUI from <dataRoot>/runtime
 *   → TS ComfyClient streams WS progress → PNG imported into project assets.
 *
 * Pass --external to prove the escape hatch instead (comfyMode external must
 * be set and a ComfyUI must run at engines.comfyUrl; model krea2).
 *
 * Run: npx tsx scripts/test-comfy-image.mts [--external] */

import fs from "node:fs";
import path from "node:path";

const external = process.argv.includes("--external");

const { startStudiod } = await import("../packages/core/src/server.js");
const { createStudiodApi } = await import("../packages/core/src/tools.js");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const handle = await startStudiod({ writePortFile: false });
const api = createStudiodApi(handle.port, handle.token);

try {
  const settings = await api.settings.get.query();
  check(
    `comfyMode is ${external ? "external" : "managed"}`,
    settings.engines.comfyMode === (external ? "external" : "managed"),
    settings.engines.comfyMode,
  );

  const catalog = await api.labs.image.catalog.query();
  const modelId = external ? "krea2" : "z-image";
  const model = catalog.models.find((m) => m.id === modelId);
  check(`${modelId} available in catalog`, !!model?.available, JSON.stringify(model));

  const projects = await api.projects.list.query();
  const project = projects[0].id;

  const t0 = Date.now();
  const job = await api.labs.image.generate.mutate({
    project,
    model: modelId,
    prompt:
      "a golden retriever in a tiny recording studio wearing headphones, warm rim light",
    aspect: "3:2",
    preset: "Cinematic",
    count: 1,
    seed: 42,
  });
  console.log(`enqueued ${job.id} (${job.title})`);

  // poll to completion (managed first boot loads torch — allow 5 min)
  let final = job;
  const stages: string[] = [];
  for (let i = 0; i < 300; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const jobs = await api.jobs.list.query();
    final = jobs.find((j) => j.id === job.id) ?? final;
    if (final.stage && stages[stages.length - 1] !== final.stage) {
      stages.push(final.stage);
      console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${final.progress}% ${final.stage}`);
    }
    if (final.status === "completed" || final.status === "failed") break;
  }

  check("job completed", final.status === "completed", final.error ?? final.status);
  check("saw a sampling stage", stages.some((s) => s.startsWith("Sampling")), stages.join(" | "));
  check("output recorded", !!final.output, final.output);

  if (final.output) {
    const abs = path.isAbsolute(final.output)
      ? final.output
      : path.join(settings.storage.dataRoot, final.output);
    const size = fs.existsSync(abs) ? fs.statSync(abs).size : 0;
    check("PNG exists and is real", size > 50_000, `${abs} (${Math.round(size / 1024)} KB)`);
    check(
      "imported into project assets",
      final.output.includes("assets"),
      final.output,
    );
  }

  const library = await api.library.list.query();
  check(
    "library sees the new image",
    library.assets.some((a) => a.kind === "image" && final.output?.endsWith(a.name)),
  );
} finally {
  await handle.close();
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
