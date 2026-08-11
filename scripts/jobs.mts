/* The queue, at a glance. Run: npx tsx scripts/jobs.mts */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { createStudiodApi } = await import("../packages/core/src/tools.js");

const pf = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".aurea", "studiod.json"), "utf8"),
) as { port: number; token: string };
const api = createStudiodApi(pf.port, pf.token);

for (const j of (await api.jobs.list.query()).slice(0, 6)) {
  console.log(
    `${j.status.padEnd(10)} ${j.engine.padEnd(12)} ${(j.stage ?? "-").padEnd(28)} ` +
      `${j.title.slice(0, 40)} ${j.error ?? ""}`,
  );
}
