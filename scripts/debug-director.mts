import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { createStudiodApi } = await import("../packages/core/src/tools.js");
const pf = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".aurea", "studiod.json"), "utf8")) as {
  port: number;
  token: string;
};
const api = createStudiodApi(pf.port, pf.token);
const project = process.argv[2] ?? "pilot-62388";
const state = await api.director.get.query({ project });
for (const m of state.messages) {
  const tool = m.tool ? ` [tool ${m.tool.name} ${m.tool.status}: ${m.tool.summary.slice(0, 100)}]` : "";
  console.log(`--- ${m.role}${tool}`);
  if (m.text) console.log(m.text.slice(0, 350));
}
console.log("\nJOBS:");
for (const j of (await api.jobs.list.query()).slice(0, 14)) {
  console.log(`${j.status} | ${j.engine} | ${j.project} | ${j.title.slice(0, 50)} | ${j.error ?? ""}`);
}
