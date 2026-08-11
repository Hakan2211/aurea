/* Headless driver for EngineRuntime.install() — the same code path as
 * Settings → Engines → Install engine runtime, with progress on stdout.
 *
 * Useful when a pin moves (COMFY_PIN, a CustomNodeSpec version) and the
 * installed runtime has to catch up without clicking through the app, and for
 * seeing the real pip/download failure instead of a component turning red.
 *
 * Run: npx tsx scripts/install-runtime.mts
 * Aurea should be closed — this writes runtime/ and runtime.json, which a
 * running studiod also owns.
 */

import { EngineRuntime, SettingsStore } from "@aurea/core";

const settings = new SettingsStore();
const runtime = new EngineRuntime(settings);

let last = "";
runtime.on("update", (s) => {
  const line = s.components
    .filter((c) => c.state === "installing" || c.state === "error")
    .map((c) => {
      const pct = c.progress != null ? ` ${Math.round(c.progress)}%` : "";
      const detail = c.detail ? ` (${c.detail})` : "";
      const err = c.error ? ` ERROR ${c.error}` : "";
      return `${c.id}: ${c.stage ?? c.state}${pct}${detail}${err}`;
    })
    .join(" | ");
  if (line && line !== last) {
    last = line;
    console.log(line);
  }
});

const started = runtime.install();
console.log(
  "start:",
  started.components.map((c) => `${c.id}=${c.state}`).join(" "),
);

await new Promise<void>((resolve) => {
  const tick = setInterval(() => {
    if (runtime.status().installing) return;
    clearInterval(tick);
    resolve();
  }, 2_000);
});

const final = runtime.status();
console.log("\nFINAL");
for (const c of final.components) {
  const mark = c.state === "ready" ? "OK  " : "FAIL";
  console.log(`  ${mark} ${c.id} ${c.installedVersion ?? "-"} ${c.error ?? ""}`);
}
console.log(`ready: ${final.ready}`);
process.exit(final.ready ? 0 : 1);
