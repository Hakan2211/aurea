/* Managed ACE-Step E2E — the second venv engine, headless and REAL (installs
 * into the machine's actual dataRoot):
 *
 *   1. runtime.status lists the acestep venv component with its pin
 *   2. runtime.install brings it to ready (pinned source checkout → venv →
 *      CUDA torch 2.7.1 cu128 → pinned deps → bundled nano-vllm)
 *   3. models.download installs the acestep-v15 checkpoints (9.4 GB from HF;
 *      when a local ACE-Step checkout is present its files are seeded in
 *      first, sha-verified, so only missing/corrupt files hit the network)
 *   4. labs.music.catalog reports ACE-Step available on the managed engine
 *   5. labs.music.generate → JobEngine → MusicAdapter spawns the venv against
 *      the embedded script → wav imported into project assets
 *
 * Pass --external to regression-test the escape hatch instead: musicMode is
 * flipped to external for the run (and restored), so the job must go through
 * engines.acestepDir + videofast's gen_music_cli.py.
 *
 * Run: npx tsx scripts/test-managed-acestep.mts [--external]
 * (first managed run downloads several GB) */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const external = process.argv.includes("--external");

const { startStudiod } = await import("../packages/core/src/server.js");
const { createStudiodApi } = await import("../packages/core/src/tools.js");
const { ACESTEP_PIN } = await import("../packages/core/src/runtime/runtime.js");
const { MODEL_REGISTRY } = await import("../packages/core/src/models/registry.js");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const sha256 = (file: string) =>
  new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    fs.createReadStream(file)
      .on("data", (c) => hash.update(c))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });

/** Copy the registry's files from a local ACE-Step checkout into the model
 * manager's folder, verifying each sha256 — the checkout and the HF repo are
 * the same snapshot, so a verified copy is as good as a download. */
async function seedFromLocalCheckout(checkout: string, dataRoot: string): Promise<void> {
  const info = MODEL_REGISTRY.find((m) => m.id === "acestep-v15");
  if (!info) throw new Error("acestep-v15 missing from registry");
  for (const file of info.files) {
    const dest = path.join(dataRoot, "models", "acestep-v15", file.name);
    try {
      if (fs.statSync(dest).size === file.sizeBytes) continue;
    } catch {
      /* not seeded yet */
    }
    // registry names carry the checkpoints/ prefix the checkout also uses
    const src = path.join(checkout, file.name);
    if (!fs.existsSync(src) || fs.statSync(src).size !== file.sizeBytes) {
      console.log(`  [seed] ${file.name}: no local copy — will download`);
      continue;
    }
    if (file.sha256 && (await sha256(src)) !== file.sha256) {
      console.log(`  [seed] ${file.name}: local sha mismatch — will download`);
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`  [seed] ${file.name} ✓${file.sha256 ? " (sha verified)" : ""}`);
  }
}

const handle = await startStudiod({ writePortFile: false });
const api = createStudiodApi(handle.port, handle.token);

try {
  let settings = await api.settings.get.query();
  if (external) {
    settings = await api.settings.update.mutate({ engines: { musicMode: "external" } });
  }
  const wantMode = external ? "external" : "managed";
  check(
    `musicMode is ${wantMode}`,
    settings.engines.musicMode === wantMode,
    settings.engines.musicMode,
  );

  if (!external) {
    /* ---- 1+2: the acestep venv component ---- */
    let runtime = await api.runtime.status.query();
    const componentOf = (s: typeof runtime) => s.components.find((c) => c.id === "acestep");
    const pin = componentOf(runtime);
    check("acestep component listed", !!pin, JSON.stringify(pin));
    check("acestep pin", pin?.pinned === ACESTEP_PIN.version, pin?.pinned);

    if (pin?.state !== "ready") {
      console.log("installing the runtime (acestep venv + source checkout)…");
      await api.runtime.install.mutate();
      let lastLine = "";
      for (let i = 0; i < 3600; i++) {
        await sleep(2000);
        runtime = await api.runtime.status.query();
        const c = componentOf(runtime);
        if (c?.state === "installing") {
          const line = `  [acestep] ${Math.round(c.progress)}% ${c.stage ?? ""} ${c.detail ?? ""}`;
          if (line !== lastLine) {
            lastLine = line;
            console.log(line);
          }
        }
        if (c?.state === "ready") break;
        if (c?.state === "error" && !runtime.installing) {
          throw new Error(`acestep install failed: ${c.error}`);
        }
      }
    }
    check("acestep venv ready", componentOf(runtime)?.state === "ready");

    /* ---- 3: the checkpoints ---- */
    let models = await api.models.list.query();
    const weightsOf = (l: typeof models) => l.find((m) => m.id === "acestep-v15");
    if (weightsOf(models)?.status.state !== "installed") {
      const checkout = settings.engines.acestepDir;
      if (checkout && fs.existsSync(path.join(checkout, "checkpoints"))) {
        console.log(`seeding checkpoints from local checkout ${checkout}…`);
        await seedFromLocalCheckout(checkout, settings.storage.dataRoot);
      }
      console.log("installing acestep-v15 checkpoints…");
      await api.models.download.mutate({ id: "acestep-v15" });
      let lastPct = -1;
      for (let i = 0; i < 3600; i++) {
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
    check("acestep-v15 checkpoints installed", weightsOf(models)?.status.state === "installed");
  }

  /* ---- 4: catalog ---- */
  const catalog = await api.labs.music.catalog.query();
  check(`acestep available (${wantMode})`, catalog.engine.available, JSON.stringify(catalog.engine));
  check(
    "catalog note names the mode",
    external
      ? !catalog.engine.note.includes("managed")
      : catalog.engine.note.includes("managed"),
    catalog.engine.note,
  );

  /* ---- 5: generate ---- */
  const projects = await api.projects.list.query();
  const project = projects[0].id;
  const t0 = Date.now();
  const job = await api.labs.music.generate.mutate({
    project,
    description: "retro funk sitcom sting, brass stabs, tight drums, walking bassline",
    styles: ["Retro funk"],
    durationSec: 12,
    arrangement: "instrumental",
  });
  console.log(`enqueued ${job.id} (${job.title})`);

  let final = job;
  const stages: string[] = [];
  for (let i = 0; i < 1200; i++) {
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
  check("saw the DiT stage", stages.includes("Loading DiT"), stages.join(" | "));
  check(
    "saw the composing stage",
    stages.includes("Composing arrangement and mixing"),
    stages.join(" | "),
  );
  check("output recorded", !!final.output, final.output);

  if (final.output) {
    const abs = path.isAbsolute(final.output)
      ? final.output
      : path.join(settings.storage.dataRoot, final.output);
    const size = fs.existsSync(abs) ? fs.statSync(abs).size : 0;
    check("wav exists and is real", size > 500_000, `${abs} (${Math.round(size / 1024)} KB)`);
    check("imported into project assets", final.output.includes("assets"), final.output);
  }

  const library = await api.library.list.query();
  check(
    "library sees the new track",
    library.assets.some((a) => (a.kind === "music" || a.kind === "audio") && final.output?.endsWith(a.name)),
  );
} finally {
  if (external) await api.settings.update.mutate({ engines: { musicMode: "managed" } });
  await handle.close();
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
