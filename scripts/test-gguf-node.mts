/* Managed custom-node install E2E — a REAL install of the ComfyUI-GGUF pack
 * into the machine's actual runtime (not a sandbox: on success the managed
 * ComfyUI can load GGUF-quantized models like krea2-turbo).
 *
 *   1. status() lists the "gguf" component with its pin
 *   2. install() brings it to ready (checkout under runtime/nodes +
 *      pip deps in the comfy venv)
 *   3. the comfy venv imports gguf
 *   4. extra_model_paths.yaml mounts runtime/nodes as a custom_nodes path
 *   5. the managed ComfyUI boots and exposes UnetLoaderGGUF via /object_info
 *
 * Run: npx tsx scripts/test-gguf-node.mts */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const { SettingsStore } = await import("../packages/core/src/settings.js");
const { EngineRuntime, GGUF_NODE_PIN } = await import(
  "../packages/core/src/runtime/runtime.js"
);
const { ComfyService } = await import("../packages/core/src/comfy/service.js");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const settings = new SettingsStore();
const runtime = new EngineRuntime(settings);
console.log(`dataRoot: ${settings.get().storage.dataRoot}`);

const before = runtime.status();
console.log("before:", before.components.map((c) => `${c.id}=${c.state}`).join(" "));
const ggufBefore = before.components.find((c) => c.id === "gguf");
check("gguf component listed with pin", ggufBefore?.pinned === GGUF_NODE_PIN.version);

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
  // poll (don't rely on events): the final publish can land on an unref'd
  // throttle timer, which would let the event loop drain mid-wait
  await new Promise<void>((resolve, reject) => {
    const timer = setInterval(() => {
      const s = runtime.status();
      const failed = s.components.find((c) => c.state === "error");
      if (failed && !s.installing) {
        clearInterval(timer);
        reject(new Error(`${failed.id}: ${failed.error}`));
      } else if (s.ready) {
        clearInterval(timer);
        resolve();
      }
    }, 500);
  });
}

check("gguf component ready", runtime.componentReady("gguf"));
check(
  "node checkout present",
  fs.existsSync(path.join(runtime.nodeDir(GGUF_NODE_PIN), "nodes.py")),
  runtime.nodeDir(GGUF_NODE_PIN),
);

const imp = spawnSync(
  runtime.venvPython(),
  ["-c", "import gguf, sentencepiece; from importlib.metadata import version; print('gguf', version('gguf'))"],
  { encoding: "utf8" },
);
check("comfy venv imports gguf", /gguf \d/.test(imp.stdout), (imp.stdout + imp.stderr).trim());

runtime.writeExtraModelPaths();
const yaml = fs.readFileSync(runtime.extraModelPathsFile(), "utf8");
const nodesDir = runtime.nodesDir().replaceAll("\\", "/");
check("yaml mounts runtime/nodes as custom_nodes", yaml.includes(`custom_nodes: ${nodesDir}`));

// the real proof: managed ComfyUI boots and registers the loader node
const comfy = new ComfyService(settings, runtime);
try {
  const nodeInfo = await comfy.run(async (url) => {
    const res = await fetch(`${url}/object_info/UnetLoaderGGUF`);
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  });
  const loader = nodeInfo?.UnetLoaderGGUF as
    | { input?: { required?: { unet_name?: [string[]] } } }
    | undefined;
  check("managed ComfyUI exposes UnetLoaderGGUF", !!loader);
  const names = loader?.input?.required?.unet_name?.[0] ?? [];
  const krea2 = names.find((n) => n.includes("krea2_turbo-Q8_0.gguf"));
  check("loader lists the krea2 GGUF weight", !!krea2, krea2 ?? `${names.length} entries`);
} finally {
  comfy.close();
  runtime.close();
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
