/* Run a coverage pass against the running app and watch it settle.
 *
 *   npx tsx scripts/coverage-pass.mts <project> <plate relPath> "<subject>" [location]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { createStudiodApi } = await import("../packages/core/src/tools.js");

const [project, source, subject, location = ""] = process.argv.slice(2);
if (!project || !source || !subject) {
  throw new Error('usage: coverage-pass.mts <project> <plate relPath> "<subject>" [location]');
}

const pf = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".aurea", "studiod.json"), "utf8"),
) as { port: number; token: string };
const api = createStudiodApi(pf.port, pf.token);

const run = await api.studio.canon.coverage.mutate({ project, source, subject, location });
console.log(`run ${run.id}  job ${run.jobId}  seed ${run.seed}`);

let last = "";
for (;;) {
  await new Promise((r) => setTimeout(r, 8000));
  const now = await api.studio.canon.coverageGet.query({ id: run.id });
  if (!now) throw new Error("run vanished");
  const job = (await api.jobs.list.query()).find((j) => j.id === run.jobId);
  const line = `${now.status} ${job?.stage ?? ""} ${job?.progress ?? 0}%`;
  if (line !== last) {
    last = line;
    console.log(`[${new Date().toLocaleTimeString()}] ${line}`);
  }
  if (now.status === "completed" || now.status === "failed") {
    console.log("\n--- settled ---");
    console.log(now.status, now.error ?? "");
    for (const a of now.angles) console.log(`  ${String(a.deg).padStart(3)}°  ${a.asset ?? "—"}`);
    console.log(`  sheet: ${now.sheet ?? "—"}`);
    break;
  }
}
process.exit(0);
