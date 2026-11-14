/* Block until the named jobs (or every non-terminal job) leave the queue.
 * Crew runs enqueue in batches and then need one line per job back:
 *   npx tsx scripts/wait-jobs.mts j-abc j-def
 *   npx tsx scripts/wait-jobs.mts --all */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStudiodApi } from "../packages/core/src/tools.js";

const pf = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".aurea", "studiod.json"), "utf8"),
) as { port: number; token: string };
const api = createStudiodApi(pf.port, pf.token);

const args = process.argv.slice(2);
const all = args.includes("--all");
const ids = new Set(args.filter((a) => !a.startsWith("--")));
const done = new Set(["completed", "failed", "canceled", "cancelled"]);

let last = "";
for (;;) {
  const jobs = await api.jobs.list.query();
  const watched = all ? jobs.filter((j) => !done.has(j.status)) : jobs.filter((j) => ids.has(j.id));
  const pending = watched.filter((j) => !done.has(j.status));
  const line = pending.map((j) => `${j.status}:${Math.round(j.progress * 100)}% ${j.stage ?? ""}`).join(" | ");
  if (line !== last) {
    process.stderr.write(`${new Date().toLocaleTimeString()}  ${pending.length} pending  ${line}\n`);
    last = line;
  }
  if (!pending.length) {
    for (const j of jobs.filter((j) => ids.has(j.id) || (all && done.has(j.status) && false))) {
      const out = (j as { output?: { path?: string } }).output?.path ?? "";
      console.log(`${j.status.padEnd(10)} ${j.id} ${j.title.slice(0, 44).padEnd(46)} ${j.error ?? out}`);
    }
    break;
  }
  await new Promise((r) => setTimeout(r, 5000));
}
process.exit(0);
