/* Read-only: print scene_assemble's plan for every scene of a project, straight
 * from the files on disk — no studiod, no queue side effects.
 *
 *   npx tsx scripts/plan-assembly.mts [projectId] [through] [sceneId]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bibleSchema, jobSchema, planSceneAssembly, productionSchema, timelineSchema, videoPresetSchema, type AssemblyThrough } from "@aurea/shared";
import { z } from "zod";

const [project = "zoo-logic", through = "render", only] = process.argv.slice(2);
const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".aurea", "settings.json"), "utf8"));
const root: string = settings.storage?.dataRoot ?? path.join(os.homedir(), "Aurea");
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const prod = productionSchema.parse(read(`projects/${project}/production.json`));
const bible = bibleSchema.parse(read(`projects/${project}/bible.json`));
const jobs = z.array(jobSchema).parse(read("jobs.json"));
const presetDir = path.join(root, "promptlib", "video-presets");
const presets = fs.readdirSync(presetDir).filter((f) => f.endsWith(".json")).flatMap((f) => { const r = videoPresetSchema.safeParse(JSON.parse(fs.readFileSync(path.join(presetDir, f), "utf8"))); return r.success ? [r.data] : []; });
let timelineAssets: string[] = [];
try {
  timelineAssets = timelineSchema.parse(read(`projects/${project}/timeline.json`)).tracks.find((t) => t.kind === "video")?.clips.map((c) => c.asset) ?? [];
} catch {}

for (const season of prod.seasons)
  for (const ep of season.episodes)
    for (const scene of ep.scenes) {
      if (only && scene.id !== only) continue;
      const p = planSceneAssembly({ project, scene, bible, presets, jobs, timelineAssets, options: { through: through as AssemblyThrough } });
      const count = (st: string) => p.steps.filter((s) => s.status === st).length;
      console.log(`\n${ep.id} / ${scene.id} — ${scene.slugline} (${scene.shots.length} shots): todo ${count("todo")}, done ${count("done")}, inflight ${count("inflight")}, blocked ${count("blocked")}, later ${count("later")} · ~${Math.round(p.estSec / 60)} min`);
      if (only) for (const s of p.steps) console.log(`  ${s.kind.padEnd(6)} ${s.status.padEnd(8)} ${s.shotTitle.slice(0, 40).padEnd(40)} ${s.lane ?? s.aspect ?? (s.lineIds ? s.lineIds.length + " lines" : "")} ${s.reason ?? ""}`);
    }
