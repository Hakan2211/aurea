/* Managed TTS E2E — the P2 venv-engine protocol, headless and REAL (installs
 * into the machine's actual dataRoot):
 *
 *   1. runtime.status lists the chatterbox venv component with its pin
 *   2. runtime.install brings it to ready (portable python → venv → CUDA
 *      torch 2.6.0 cu124 → chatterbox-tts, with live progress)
 *   3. models.download installs the chatterbox-tts weights (HF, sha-verified)
 *   4. labs.voice.catalog reports Chatterbox available on the managed engine
 *   5. labs.voice.generate → JobEngine → TtsAdapter spawns the venv against
 *      the embedded script → wav imported into project assets
 *
 * Pass --external to regression-test the escape hatch instead: ttsMode is
 * flipped to external for the run (and restored), so the job must go through
 * engines.chatterboxPython + videofast's gen_char_vo.py.
 *
 * Run: npx tsx scripts/test-managed-tts.mts [--external]
 * (first managed run downloads several GB) */

import fs from "node:fs";
import path from "node:path";

const external = process.argv.includes("--external");

const { startStudiod } = await import("../packages/core/src/server.js");
const { createStudiodApi } = await import("../packages/core/src/tools.js");
const { CHATTERBOX_PIN } = await import("../packages/core/src/runtime/runtime.js");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const handle = await startStudiod({ writePortFile: false });
const api = createStudiodApi(handle.port, handle.token);

try {
  let settings = await api.settings.get.query();
  if (external) {
    settings = await api.settings.update.mutate({ engines: { ttsMode: "external" } });
  }
  const wantMode = external ? "external" : "managed";
  check(`ttsMode is ${wantMode}`, settings.engines.ttsMode === wantMode, settings.engines.ttsMode);

  /* ---- 1+2: the chatterbox venv component ---- */
  let runtime = await api.runtime.status.query();
  const componentOf = (s: typeof runtime) => s.components.find((c) => c.id === "chatterbox");
  const pin = componentOf(runtime);
  check("chatterbox component listed", !!pin, JSON.stringify(pin));
  check("chatterbox pin", pin?.pinned === CHATTERBOX_PIN.version, pin?.pinned);

  if (pin?.state !== "ready") {
    console.log("installing the runtime (chatterbox venv)…");
    await api.runtime.install.mutate();
    let lastLine = "";
    for (let i = 0; i < 2400; i++) {
      await sleep(2000);
      runtime = await api.runtime.status.query();
      const c = componentOf(runtime);
      if (c?.state === "installing") {
        const line = `  [chatterbox] ${Math.round(c.progress)}% ${c.stage ?? ""} ${c.detail ?? ""}`;
        if (line !== lastLine) {
          lastLine = line;
          console.log(line);
        }
      }
      if (c?.state === "ready") break;
      if (c?.state === "error" && !runtime.installing) {
        throw new Error(`chatterbox install failed: ${c.error}`);
      }
    }
  }
  check("chatterbox venv ready", componentOf(runtime)?.state === "ready");

  /* ---- 3: the weights ---- */
  let models = await api.models.list.query();
  const weightsOf = (l: typeof models) => l.find((m) => m.id === "chatterbox-tts");
  if (weightsOf(models)?.status.state !== "installed") {
    console.log("downloading chatterbox-tts weights…");
    await api.models.download.mutate({ id: "chatterbox-tts" });
    let lastPct = -1;
    for (let i = 0; i < 2400; i++) {
      await sleep(2000);
      models = await api.models.list.query();
      const w = weightsOf(models);
      const pct = Math.round(w?.status.progress ?? 0);
      if (pct !== lastPct && w?.status.state === "downloading") {
        lastPct = pct;
        console.log(`  [weights] ${pct}% ${w?.status.file ?? ""}`);
      }
      if (w?.status.state === "installed") break;
      if (w?.status.state === "error") throw new Error(`weights failed: ${w.status.error}`);
    }
  }
  check("chatterbox-tts weights installed", weightsOf(models)?.status.state === "installed");

  /* ---- 4: catalog ---- */
  const catalog = await api.labs.voice.catalog.query();
  const engine = catalog.engines.find((e) => e.id === "chatterbox");
  check(`chatterbox available (${wantMode})`, !!engine?.available, JSON.stringify(engine));
  check(
    "catalog note names the mode",
    external ? !engine?.note.includes("managed") : (engine?.note.includes("managed") ?? false),
    engine?.note,
  );
  const voice = catalog.voices.find((v) => v.id === "sterling") ?? catalog.voices.find((v) => v.kind === "cloned");
  check("a cloned voice is on the roster", !!voice, JSON.stringify(voice));
  if (!voice) throw new Error("no cloned voice to synthesize with");

  /* ---- 5: generate ---- */
  const projects = await api.projects.list.query();
  const project = projects[0].id;
  const t0 = Date.now();
  const job = await api.labs.voice.generate.mutate({
    project,
    text: "Do come in. There is always time for good manners, even on a render farm.",
    voice: voice.id,
    engine: "chatterbox",
    emotion: 0.65,
    pace: 1,
  });
  console.log(`enqueued ${job.id} (${job.title}) voice=${voice.id}`);

  let final = job;
  const stages: string[] = [];
  for (let i = 0; i < 600; i++) {
    await sleep(1000);
    const jobs = await api.jobs.list.query();
    final = jobs.find((j) => j.id === job.id) ?? final;
    if (final.stage && stages[stages.length - 1] !== final.stage) {
      stages.push(final.stage);
      console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${final.progress}% ${final.stage}`);
    }
    if (final.status === "completed" || final.status === "failed") break;
  }

  check("job completed", final.status === "completed", final.error ?? final.status);
  check("saw the synthesis stage", stages.includes("Synthesizing"), stages.join(" | "));
  check("output recorded", !!final.output, final.output);

  if (final.output) {
    const abs = path.isAbsolute(final.output)
      ? final.output
      : path.join(settings.storage.dataRoot, final.output);
    const size = fs.existsSync(abs) ? fs.statSync(abs).size : 0;
    check("wav exists and is real", size > 100_000, `${abs} (${Math.round(size / 1024)} KB)`);
    check("imported into project assets", final.output.includes("assets"), final.output);
  }

  const library = await api.library.list.query();
  check(
    "library sees the new take",
    library.assets.some((a) => a.kind === "audio" && final.output?.endsWith(a.name)),
  );
} finally {
  if (external) await api.settings.update.mutate({ engines: { ttsMode: "managed" } });
  await handle.close();
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
