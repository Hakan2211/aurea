/* Switch engines.videoMode to the managed runtime, through the running
 * studiod so the app and the settings file don't fight over the write.
 *
 * Refuses while jobs are in flight: the adapters read videoMode per job, so
 * flipping mid-queue sends half a queue to a different ComfyUI.
 *
 * Run: npx tsx scripts/set-video-managed.mts   (Aurea must be running)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { createStudiodApi } = await import("../packages/core/src/tools.js");

const pf = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".aurea", "studiod.json"), "utf8"),
) as { port: number; token: string };
const api = createStudiodApi(pf.port, pf.token);

const jobs = await api.jobs.list.query();
const live = jobs.filter((j) => j.status === "running" || j.status === "queued");
if (live.length) {
  console.error(`refusing: ${live.length} job(s) in flight — let the queue drain first`);
  process.exit(1);
}

const before = await api.settings.get.query();
console.log("before:", {
  videoMode: before.engines.videoMode,
  minimaxUrl: before.engines.minimaxUrl,
});

await api.settings.update.mutate({
  engines: {
    ...before.engines,
    videoMode: "managed",
    // empty = "same ComfyUI as LTX"; on 0.30.2 that server carries the H3
    // nodes too, so one managed engine serves both
    minimaxUrl: "",
  },
});

const after = await api.settings.get.query();
console.log("after: ", {
  videoMode: after.engines.videoMode,
  minimaxUrl: after.engines.minimaxUrl,
});
