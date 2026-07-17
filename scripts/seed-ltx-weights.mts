/* Seed the ltx-23-22b-fp8 weight set from the local D:\models copies (the
 * external ComfyUI's files — byte-identical to the registry's HF sources)
 * instead of re-downloading ~42 GB. Every file is sha256-verified against the
 * registry during the copy; the manifest gets the install + license-acceptance
 * entries the ModelManager expects. Idempotent — verified files are skipped.
 *
 * Run: npx tsx scripts/seed-ltx-weights.mts */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const { MODEL_REGISTRY } = await import("../packages/core/src/models/registry.js");
const { SettingsStore } = await import("../packages/core/src/settings.js");

const MODEL_ID = "ltx-23-22b-fp8";
const SRC_ROOT = "D:\\models";
/** registry file name → path under D:\models (identical category layout) */
const SRC: Record<string, string> = {
  "checkpoints/ltx-2.3-22b-dev-fp8.safetensors": "checkpoints\\ltx-2.3-22b-dev-fp8.safetensors",
  "loras/ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors":
    "loras\\ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors",
  "text_encoders/gemma_3_12B_it_fp4_mixed.safetensors":
    "text_encoders\\gemma_3_12B_it_fp4_mixed.safetensors",
  "latent_upscale_models/ltx-2.3-spatial-upscaler-x2-1.1.safetensors":
    "latent_upscale_models\\ltx-2.3-spatial-upscaler-x2-1.1.safetensors",
};

const info = MODEL_REGISTRY.find((m) => m.id === MODEL_ID);
if (!info) throw new Error(`${MODEL_ID} missing from the registry`);
const dataRoot = new SettingsStore().get().storage.dataRoot;
const destRoot = path.join(dataRoot, "models", MODEL_ID);

function sha256(file: string, label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const total = fs.statSync(file).size;
    let seen = 0;
    let lastPct = -10;
    fs.createReadStream(file, { highWaterMark: 8 * 1024 * 1024 })
      .on("data", (chunk) => {
        hash.update(chunk as Buffer);
        seen += (chunk as Buffer).length;
        const pct = Math.floor((seen / total) * 100);
        if (pct >= lastPct + 10) {
          lastPct = pct;
          process.stdout.write(`\r  ${label}: hashing ${pct}%   `);
        }
      })
      .on("end", () => {
        process.stdout.write("\r");
        resolve(hash.digest("hex"));
      })
      .on("error", reject);
  });
}

for (const file of info.files) {
  const src = path.join(SRC_ROOT, SRC[file.name]);
  const dest = path.join(destRoot, file.name);
  const label = path.basename(file.name);
  if (!fs.existsSync(src)) throw new Error(`source missing: ${src}`);
  if (fs.statSync(src).size !== file.sizeBytes) {
    throw new Error(`size mismatch at source for ${label} — not the registry file`);
  }
  if (fs.existsSync(dest) && fs.statSync(dest).size === file.sizeBytes) {
    const sum = await sha256(dest, label);
    if (sum === file.sha256) {
      console.log(`OK   ${label} already installed + verified`);
      continue;
    }
    console.log(`??   ${label} present but sha mismatch — recopying`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  console.log(`copy ${label} (${(file.sizeBytes / 1024 ** 3).toFixed(1)} GB)…`);
  fs.copyFileSync(src, `${dest}.part`);
  const sum = await sha256(`${dest}.part`, label);
  if (sum !== file.sha256) {
    fs.rmSync(`${dest}.part`);
    throw new Error(`sha256 mismatch after copy for ${label}: ${sum}`);
  }
  fs.renameSync(`${dest}.part`, dest);
  console.log(`OK   ${label} installed + verified`);
}

/* mark installed + license accepted, exactly like a finished download */
const manifestFile = path.join(dataRoot, "models", "manifest.json");
let manifest: { accepted: string[]; installed: Record<string, string> } = {
  accepted: [],
  installed: {},
};
try {
  manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
} catch {
  /* fresh */
}
if (!manifest.accepted.includes(MODEL_ID)) manifest.accepted.push(MODEL_ID);
manifest.installed[MODEL_ID] = new Date().toISOString();
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
console.log(`manifest updated — ${MODEL_ID} installed + license accepted`);
