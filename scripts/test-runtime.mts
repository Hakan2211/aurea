/* EngineRuntime E2E — a REAL install of the managed engine substrate into the
 * machine's actual dataRoot (this is not a sandbox: on success the machine
 * has the runtime the app will use).
 *
 *   1. status() reports absent components with the expected pins
 *   2. install() brings python + comfy to ready with live progress
 *   3. the portable python answers --version with the pinned build
 *   4. the comfy venv imports torch with CUDA available
 *   5. extra_model_paths.yaml points every category at <dataRoot>/models
 *
 * Run: npx tsx scripts/test-runtime.mts  (first run downloads several GB) */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const { SettingsStore } = await import("../packages/core/src/settings.js");
const { EngineRuntime, PYTHON_PIN, COMFY_PIN } = await import(
  "../packages/core/src/runtime/runtime.js"
);

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const settings = new SettingsStore();
const runtime = new EngineRuntime(settings);
console.log(`dataRoot: ${settings.get().storage.dataRoot}`);

const before = runtime.status();
console.log(
  "before:",
  before.components.map((c) => `${c.id}=${c.state}`).join(" "),
);
check(
  "status pins match",
  before.components[0].pinned === PYTHON_PIN.version &&
    before.components[1].pinned === COMFY_PIN.tag,
);

if (!before.ready) {
  let lastLine = "";
  runtime.on("update", (s: ReturnType<typeof runtime.status>) => {
    for (const c of s.components) {
      if (c.state !== "installing") continue;
      const line = `[${c.id}] ${Math.round(c.progress)}% ${c.stage ?? ""} ${c.detail ?? ""}`;
      if (line !== lastLine) {
        lastLine = line;
        console.log(line);
      }
    }
  });
  runtime.install();
  await new Promise<void>((resolve, reject) => {
    runtime.on("update", (s: ReturnType<typeof runtime.status>) => {
      if (s.ready) resolve();
      const failed = s.components.find((c) => c.state === "error");
      if (failed && !s.installing) reject(new Error(`${failed.id}: ${failed.error}`));
    });
  });
}

const after = runtime.status();
check("runtime ready", after.ready);

const py = spawnSync(runtime.pythonExe(), ["--version"], { encoding: "utf8" });
check(
  "portable python answers",
  py.stdout.includes(PYTHON_PIN.version) || py.stderr.includes(PYTHON_PIN.version),
  (py.stdout + py.stderr).trim(),
);

const torch = spawnSync(
  runtime.venvPython(),
  ["-c", "import torch;print(torch.__version__, torch.cuda.is_available())"],
  { encoding: "utf8" },
);
check("venv torch imports with CUDA", /True/.test(torch.stdout), torch.stdout.trim());

check("comfy main.py present", fs.existsSync(path.join(runtime.comfyDir(), "main.py")));

runtime.writeExtraModelPaths();
const yaml = fs.readFileSync(runtime.extraModelPathsFile(), "utf8");
const modelsDir = path
  .join(settings.get().storage.dataRoot, "models")
  .replaceAll("\\", "/");
check(
  "extra_model_paths.yaml targets dataRoot/models",
  yaml.includes(`base_path: ${modelsDir}`) && yaml.includes("diffusion_models:"),
);

runtime.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
