import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const { createStudiodApi } = await import("../packages/core/src/tools.js");
const pf = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".aurea", "studiod.json"), "utf8"));
const api = createStudiodApi(pf.port, pf.token);
const live = (await api.jobs.list.query()).filter(j => j.status === "running" || j.status === "queued");
for (const j of live) { await api.jobs.cancel.mutate({ id: j.id }); console.log("cancelled", j.id, j.title); }
