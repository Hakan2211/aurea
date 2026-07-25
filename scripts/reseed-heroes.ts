/* Re-seed the Animal Sitcom bible so the 5 new S1 heroes become keyframeRefs.
 * Seed-only (no test episode / no board job). Run: npx tsx scripts/reseed-heroes.ts */
import { createStudiodApi } from "../packages/core/src/tools.js";
import { readPortFile } from "../packages/core/src/portfile.js";

async function main() {
  const pf = await readPortFile();
  if (!pf) throw new Error("no studiod port file — start Aurea (studiod) first");
  const api = createStudiodApi(pf.port, pf.token);

  const projects = await api.projects.list.query();
  const project = projects[0].id;
  console.log(`project: ${project}`);

  const seed = await api.studio.seedAnimalSitcom.mutate({ project, overwrite: false });
  console.log(`seed: ${seed.copiedFiles} files copied, ${seed.warnings.length} warnings`);
  for (const w of seed.warnings) console.log(`  warn: ${w}`);
  console.log("keyframeRefs:");
  for (const c of seed.bible.characters) {
    console.log(`  ${c.id.padEnd(9)} ${c.refs.keyframeRef ?? "NONE"}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
