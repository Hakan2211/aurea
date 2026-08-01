/* Stage 2 — one voice take per line, through the Aurea Voice lab.
 *
 * Each character speaks in their own cloned voice (bible voice.voiceId, the
 * "<id>-custom" chatterbox clones), with the bible's delivery settings unless
 * the line asks for a different heat. Every take is measured with ffprobe,
 * because the shot's beat boundaries are cut to these numbers — a guessed
 * length puts a mouth out of sync with the words. */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createStudiodApi } from "../../packages/core/src/tools.js";
import { readPortFile } from "../../packages/core/src/portfile.js";
import { ALL_SHOTS, PROJECT, lineId } from "./lines.js";

const DATA_ROOT = path.join(process.env.USERPROFILE!, "Aurea");
const OUT = path.join(process.cwd(), "scripts", "debate", "takes.json");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rel = (abs: string) => path.relative(DATA_ROOT, abs).split(path.sep).join("/");

async function main() {
  const pf = await readPortFile();
  if (!pf) throw new Error("no studiod port file");
  const api = createStudiodApi(pf.port, pf.token);

  const bible: any = await api.studio.bible.get.query({ project: PROJECT });
  const voiceOf = (id: string) => {
    const c = bible.characters.find((x: any) => x.id === id);
    if (!c?.voice?.voiceId) throw new Error(`"${id}" has no cloned voice in the bible`);
    return c.voice;
  };

  const takes: Record<string, { rel: string; sec: number; who: string; text: string }> =
    fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};

  const wanted: Array<{ key: string; who: string; text: string; emotion: number; cfg: number }> = [];
  for (const shot of ALL_SHOTS) {
    shot.lines.forEach((line, i) => {
      const key = lineId(shot, i);
      if (takes[key]) return;
      const v = voiceOf(line.who);
      wanted.push({
        key,
        who: line.who,
        text: line.text,
        emotion: line.emotion ?? v.exaggeration ?? 0.6,
        cfg: v.cfgWeight ?? 0.4,
      });
    });
  }
  if (wanted.length === 0) {
    console.log("all takes already recorded");
    process.exit(0);
  }

  /* the Voice lab runs on the cpu lane, so queueing them all at once is fine —
   * the scheduler serialises what needs serialising */
  const ids: Record<string, string> = {};
  for (const w of wanted) {
    const v = voiceOf(w.who);
    const job: any = await api.labs.voice.generate.mutate({
      project: PROJECT,
      text: w.text,
      voice: v.voiceId,
      engine: "chatterbox",
      emotion: w.emotion,
      pace: 1,
    });
    ids[w.key] = job.id;
    console.log(`queued ${w.key.padEnd(28)} ${w.who.padEnd(10)} job=${job.id}`);
  }

  const done: Record<string, any> = {};
  const deadline = Date.now() + 40 * 60_000;
  while (Object.keys(done).length < wanted.length && Date.now() < deadline) {
    const jobs: any[] = await api.jobs.list.query();
    for (const w of wanted) {
      if (done[w.key]) continue;
      const j = jobs.find((x) => x.id === ids[w.key]);
      if (j && (j.status === "completed" || j.status === "failed")) {
        done[w.key] = j;
        console.log(`${j.status === "completed" ? "OK  " : "FAIL"} ${w.key.padEnd(28)} ${j.output ?? j.error ?? ""}`);
      }
    }
    if (Object.keys(done).length < wanted.length) await sleep(3000);
  }

  for (const w of wanted) {
    const j = done[w.key];
    if (!j || j.status !== "completed" || !j.output) {
      console.log(`MISSING ${w.key}`);
      continue;
    }
    const probe = spawnSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", j.output],
      { encoding: "utf8" },
    );
    const sec = Number((probe.stdout ?? "0").trim());
    if (!sec) {
      console.log(`UNMEASURABLE ${w.key}`);
      continue;
    }
    takes[w.key] = { rel: rel(j.output), sec: Math.round(sec * 100) / 100, who: w.who, text: w.text };
  }

  fs.writeFileSync(OUT, JSON.stringify(takes, null, 2));
  console.log("\n=== takes ===");
  for (const [k, t] of Object.entries(takes)) console.log(`${k.padEnd(28)} ${String(t.sec).padStart(5)}s  ${t.rel}`);
  console.log(`\nwritten to ${OUT}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
