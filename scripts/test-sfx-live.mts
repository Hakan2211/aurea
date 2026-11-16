/* Live smoke test for the Sound FX adapters, outside studiod.
 * Spends ~$0.004 on fal (one 2 s ElevenLabs take); MOSS runs on the local GPU.
 * usage: npx tsx scripts/test-sfx-live.mts [elevenlabs|moss|both] */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sfxPayloadSchema, type Job } from "@aurea/shared";
import { FalSfxAdapter, MossSfxAdapter, mossSfxPaths } from "../packages/core/src/adapters/sfx.ts";

const raw = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".aurea", "settings.json"), "utf8"));
const settings = { get: () => ({ engines: {}, providers: {}, storage: {}, ...raw, engines: { mossSfxPython: null, mossSfxModelDir: null, ...(raw.engines ?? {}) } }) } as never;
const comfy = { idleUrlResolved: async () => null } as never;
const which = process.argv[2] ?? "both";

async function run(engine: "elevenlabs" | "moss", prompt: string, durationSec: number) {
  const job = { id: `sfx-live-${engine}-${Date.now()}`, payload: sfxPayloadSchema.parse({ type: "sfx", engine, prompt, durationSec }) } as Job;
  const adapter = engine === "moss" ? new MossSfxAdapter(settings, comfy) : new FalSfxAdapter(settings);
  const t0 = Date.now();
  let last = "";
  const { output } = await adapter.start(job, (p) => {
    const s = `${Math.round(p.progress ?? 0)}% ${p.stage ?? ""}`;
    if (p.stage && p.stage !== last) { console.log(`  [${engine}] ${s}`); last = p.stage; }
  }).done;
  const size = fs.statSync(output!).size;
  console.log(`${engine}: ${output} (${(size / 1024).toFixed(0)} KB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

console.log("moss paths:", mossSfxPaths(settings));
if (which !== "moss") await run("elevenlabs", "A single deep cinematic boom with a short metallic ring", 2);
if (which !== "elevenlabs") await run("moss", "A single deep cinematic boom with a short metallic ring", 2);
