/* One Zoo Logic dialogue single, end to end: cast voice (table read) → keyframe → LTX 2.5 ia2v lip-sync.
 *   npx tsx scripts/zoo-ia2v-single.mts   (needs Aurea running) */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const { createStudiodApi } = await import("../packages/core/src/tools.js");
const pf = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".aurea", "studiod.json"), "utf8"));
const api: any = createStudiodApi(pf.port, pf.token);
const project = "zoo-logic", sceneId = "54b13b31", shotId = "eb2d6692", lineId = "06d58bb7";
const log = (...a: unknown[]) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);

async function waitJobs(ids: string[]) {
  for (;;) {
    const snap: any = await api.jobs.list.query();
    const jobs: any[] = Array.isArray(snap) ? snap : snap.jobs ?? [];
    const mine = ids.map((id) => jobs.find((j) => j.id === id));
    if (mine.every((j) => j && (j.status === "completed" || j.status === "failed"))) return mine;
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

const tr: any = await api.studio.voice.tableRead.mutate({ project, sceneId, lineIds: [lineId] });
log("table read queued", tr.queued.map((q: any) => `${q.character}:${q.job.id}`), "skipped", tr.skipped);
const kf: any = await api.studio.board.generate.mutate({ project, shotId, count: 1 });
const kfJobs = (Array.isArray(kf) ? kf : kf.jobs ?? [kf.job ?? kf]).map((j: any) => j.id ?? j.job?.id).filter(Boolean);
log("keyframe queued", kfJobs, JSON.stringify(kf).slice(0, 300));

const done = await waitJobs([...tr.queued.map((q: any) => q.job.id), ...kfJobs]);
for (const j of done) log(j.kind, j.status, j.output ?? "", j.error ?? "");
if (done.some((j) => j.status === "failed")) process.exit(1);
await new Promise((r) => setTimeout(r, 3000)); // let the import hook attach takes

const r: any = await api.studio.board.renderShot.mutate({ project, shotId, preset: "zoo-interview-single" });
log("render queued", r.job.id, `${r.durationSec}s seed ${r.seed}`);
for (const n of r.notes ?? []) log("  note:", n);
log("prompt:", (r.job.payload?.prompt ?? "").slice(0, 600));
log("audio:", r.job.payload?.audio ?? r.job.payload?.voiceTake ?? "(none)");
const [v] = await waitJobs([r.job.id]);
log("video", v.status, v.output ?? "", v.error ?? "");
process.exit(0);
