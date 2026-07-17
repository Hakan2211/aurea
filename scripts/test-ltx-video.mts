/* LTX 2.3 video pipeline E2E — template patcher, then real renders:
 *
 *   0. graph unit checks (offline): managed strips the Gemma enhance branch
 *      and re-points every loader; external keeps the proven template; i2v
 *      frees the audio mask, ia2v locks it
 *   1. external live (needs ComfyUI at engines.comfyUrl): i2v job through
 *      labs.video.generate — staged inputs, WS progress stages, mp4 delivered
 *      and imported into the project
 *   2. managed live (needs seed-ltx-weights.mts first): same i2v on the
 *      runtime's headless ComfyUI
 *
 * Flags: --external-only / --managed-only skip the other live phase.
 * Run: npx tsx scripts/test-ltx-video.mts [--external-only|--managed-only] */

import fs from "node:fs";
import path from "node:path";

const { startStudiod } = await import("../packages/core/src/server.js");
const { createStudiodApi } = await import("../packages/core/src/tools.js");
const { ltx23Graph, LTX23_MANAGED } = await import("../packages/core/src/comfy/video-graphs.js");
const { LTX23_AV_TEMPLATE } = await import("../packages/core/src/comfy/ltx23-template.js");

const args = process.argv.slice(2);
const runExternal = !args.includes("--managed-only");
const runManaged = !args.includes("--external-only");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---- 0: offline graph checks ---- */
{
  const base = {
    prompt: "test motion",
    imageName: "aurea/frame.png",
    durationSec: 4,
    width: 704,
    height: 896,
    seed: 7,
  };
  const external = ltx23Graph({ ...base, audioName: "aurea/take.wav", models: null });
  const managed = ltx23Graph({ ...base, models: LTX23_MANAGED });

  check(
    "external keeps the proven template shape",
    Object.keys(external).length === Object.keys(LTX23_AV_TEMPLATE).length &&
      !!external["340:345"] &&
      external["340:317"].inputs.ckpt_name === "ltx-2.3-22b-dev-fp8.safetensors",
  );
  check(
    "ia2v locks the audio mask and stages the take",
    external["340:333"].inputs.value === 0 && external["276"].inputs.audio === "aurea/take.wav",
  );
  check(
    "managed strips the Gemma enhance branch",
    !managed["340:345"] &&
      !managed["340:346"] &&
      !managed["340:348"] &&
      JSON.stringify(managed["340:306"].inputs.text) === JSON.stringify(["340:319", 0]),
  );
  check(
    "managed re-points every loader at registry weights",
    managed["340:317"].inputs.ckpt_name === LTX23_MANAGED.checkpoint &&
      managed["340:335"].inputs.ckpt_name === LTX23_MANAGED.checkpoint &&
      managed["340:318"].inputs.text_encoder === LTX23_MANAGED.textEncoder &&
      managed["340:313"].inputs.model_name === LTX23_MANAGED.upscaler &&
      managed["340:293"].inputs.lora_name === LTX23_MANAGED.distillLora,
  );
  check(
    "i2v frees the audio mask",
    managed["340:333"].inputs.value === 1 &&
      external["340:330"].inputs.value === 704 &&
      external["340:331"].inputs.value === 4,
  );
}

/* ---- live phases ---- */
const handle = await startStudiod({ writePortFile: false });
const api = createStudiodApi(handle.port, handle.token);
const settings = await api.settings.get.query();
const project = (await api.projects.list.query())[0].id;
const originalMode = settings.engines.videoMode;

async function runVideoJob(label: string, prompt: string) {
  const frame = (await api.library.list.query()).assets.find((a) => a.kind === "image");
  if (!frame) throw new Error("no image in the library to use as a start frame");
  const job = await api.labs.video.generate.mutate({
    project,
    prompt,
    startFrame: frame.relPath,
    durationSec: 3,
    resolution: "704 × 896 (portrait)",
    seed: 42,
  });
  console.log(`[${label}] enqueued ${job.id} (start frame: ${frame.name})`);
  const stages = new Set<string>();
  const started = Date.now();
  for (;;) {
    const j = (await api.jobs.list.query()).find((x) => x.id === job.id)!;
    if (j.stage) stages.add(j.stage);
    if (j.status === "completed" || j.status === "failed") {
      return { job: j, stages, tookSec: Math.round((Date.now() - started) / 1000) };
    }
    if (Date.now() - started > 40 * 60_000) {
      await api.jobs.cancel.mutate({ id: job.id }).catch(() => {});
      throw new Error(`[${label}] timed out after 40 min (stages: ${[...stages].join(" | ")})`);
    }
    await sleep(2000);
  }
}

async function assertDelivered(
  label: string,
  startedAt: string,
  r: Awaited<ReturnType<typeof runVideoJob>>,
) {
  check(`${label}: job completed`, r.job.status === "completed", r.job.error ?? `${r.tookSec}s`);
  check(
    `${label}: websocket stages seen`,
    [...r.stages].some((s) => s.startsWith("Rendering")),
    [...r.stages].join(" | "),
  );
  const out = r.job.output;
  check(`${label}: mp4 on disk`, !!out && fs.existsSync(out) && fs.statSync(out).size > 100_000, out);
  const asset = (await api.library.list.query()).assets.find(
    (a) => a.kind === "video" && a.createdAt >= startedAt,
  );
  check(`${label}: take imported into the library`, !!asset, asset?.relPath);
}

try {
  if (runExternal) {
    await api.settings.update.mutate({ engines: { videoMode: "external" } });
    const startedAt = new Date().toISOString();
    const r = await runVideoJob(
      "external",
      "The character breathes gently and turns their head with a subtle warm smile, soft cinematic lighting, slow gentle camera push-in.",
    );
    await assertDelivered("external i2v", startedAt, r);
  }

  if (runManaged) {
    const ltx = (await api.models.list.query()).find((m) => m.id === "ltx-23-22b-fp8");
    if (ltx?.status.state !== "installed") {
      check("managed: weights installed (run seed-ltx-weights.mts first)", false, ltx?.status.state);
    } else {
      await api.settings.update.mutate({ engines: { videoMode: "managed" } });
      const startedAt = new Date().toISOString();
      const r = await runVideoJob(
        "managed",
        "The character breathes gently and glances to the side, soft cinematic lighting, static camera.",
      );
      await assertDelivered("managed i2v", startedAt, r);
    }
  }
} finally {
  await api.settings.update.mutate({ engines: { videoMode: originalMode } }).catch(() => {});
  await handle.close();
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
