/* Voice takes for the 4 new Zoo Logic characters (their cloned -custom voices). */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createStudiodApi } from "../packages/core/src/tools.js";
import { readPortFile } from "../packages/core/src/portfile.js";

const PROJECT = "playground";

const LINES = [
  { id: "valentino", voice: "valentino-custom", emotion: 0.8, text: "Darling, you have been wearing that hood for eleven days." },
  { id: "silas", voice: "silas-custom", emotion: 0.6, text: "It's not a hood. It's a personality." },
  { id: "alli", voice: "alli-custom", emotion: 0.55, text: "New plan. Everyone reports here at oh-nine-hundred. Sharp." },
  { id: "omar", voice: "omar-custom", emotion: 0.4, text: "Mm-hmm. Or we could just have breakfast." },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const pf = await readPortFile();
  if (!pf) throw new Error("no studiod port file");
  const api = createStudiodApi(pf.port, pf.token);

  const ids: Record<string, string> = {};
  for (const l of LINES) {
    const job: any = await api.labs.voice.generate.mutate({
      project: PROJECT, text: l.text, voice: l.voice, engine: "chatterbox", emotion: l.emotion, pace: 1,
    });
    ids[l.id] = job.id;
    console.log(`queued ${l.id.padEnd(10)} job=${job.id}`);
  }

  const done: Record<string, any> = {};
  const deadline = Date.now() + 20 * 60_000;
  while (Object.keys(done).length < LINES.length && Date.now() < deadline) {
    const jobs: any[] = await api.jobs.list.query();
    for (const l of LINES) {
      if (done[l.id]) continue;
      const j = jobs.find((x) => x.id === ids[l.id]);
      if (j && (j.status === "completed" || j.status === "failed")) {
        done[l.id] = j;
        console.log(`${j.status === "completed" ? "OK  " : "FAIL"} ${l.id.padEnd(10)} ${j.output ?? j.error ?? ""}`);
      }
    }
    if (Object.keys(done).length < LINES.length) await sleep(3000);
  }

  console.log("\n=== takes ===");
  const out: Record<string, { rel: string; sec: number }> = {};
  for (const l of LINES) {
    const j = done[l.id];
    if (!j || j.status !== "completed" || !j.output) { console.log(`${l.id}: MISSING`); continue; }
    const abs = j.output as string;
    const dur = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", abs], { encoding: "utf8" });
    const sec = Number((dur.stdout ?? "0").trim());
    const rel = path.relative(path.join(process.env.USERPROFILE!, "Aurea"), abs).split(path.sep).join("/");
    out[l.id] = { rel, sec };
    console.log(`${l.id.padEnd(10)} ${sec.toFixed(2)}s  ${rel}`);
  }
  console.log("\nJSON:" + JSON.stringify(out));
  process.exit(0);
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
