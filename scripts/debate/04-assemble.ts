/* Stage 4 — cut each video together on the Aurea timeline and export it.
 *
 * One project timeline is a single sequence, so the three videos are cut and
 * exported one after another: lay the video's shots end to end on the video
 * track, run the ffmpeg cuts-first export, copy the master out to the delivery
 * folder, then move on. Hard cuts — the shots already open on a beat of room
 * and close on a tail, so a dissolve would only soften the joke.
 *
 * The shots carry their own dialogue in their own audio, so there is no
 * separate voice track: the export lifts each clip's embedded audio. */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createStudiodApi } from "../../packages/core/src/tools.js";
import { readPortFile } from "../../packages/core/src/portfile.js";
import { PROJECT, VIDEOS } from "./lines.js";

const HERE = path.join(process.cwd(), "scripts", "debate");
const RENDERS = path.join(HERE, "renders.json");
const DATA_ROOT = path.join(process.env.USERPROFILE!, "Aurea");
const DELIVERY = path.join(
  process.env.USERPROFILE!,
  "videoproduction",
  "videofast",
  "output",
  "debates",
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function probeDuration(file: string): number {
  const p = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8" },
  );
  const sec = Number((p.stdout ?? "0").trim());
  if (!sec) throw new Error(`could not measure ${file}`);
  return Math.round(sec * 1000) / 1000;
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const pf = await readPortFile();
  if (!pf) throw new Error("no studiod port file");
  const api = createStudiodApi(pf.port, pf.token);

  const renders: Record<string, string> = JSON.parse(fs.readFileSync(RENDERS, "utf8"));
  fs.mkdirSync(DELIVERY, { recursive: true });

  for (const video of VIDEOS) {
    if (only.length && !only.includes(video.slug)) continue;

    const clips = video.shots.map((s) => {
      const rel = renders[s.slug];
      if (!rel) throw new Error(`shot "${s.slug}" has not been rendered`);
      return { rel, slug: s.slug, duration: probeDuration(path.join(DATA_ROOT, rel)) };
    });

    let start = 0;
    const timeline = {
      version: 1 as const,
      fps: 24,
      width: 896,
      height: 704,
      tracks: [
        {
          id: randomUUID(),
          kind: "video" as const,
          name: "Video",
          muted: false,
          gain: 1,
          clips: clips.map((c) => {
            const clip = {
              id: randomUUID().slice(0, 8),
              asset: c.rel,
              label: c.slug,
              start,
              in: 0,
              duration: c.duration,
              transitionSec: 0,
            };
            start += c.duration;
            return clip;
          }),
        },
      ],
    };

    console.log(`\n=== ${video.slug} — ${video.title} ===`);
    for (const c of timeline.tracks[0].clips) {
      console.log(`  ${c.label.padEnd(16)} ${c.start.toFixed(2)}s +${c.duration.toFixed(2)}s`);
    }
    console.log(`  total ${start.toFixed(2)}s`);

    await api.timeline.update.mutate({ project: PROJECT, timeline });
    const job: any = await api.timeline.export.mutate({ project: PROJECT });
    console.log(`  export job=${job.id}`);

    let out: string | null = null;
    const deadline = Date.now() + 30 * 60_000;
    while (!out && Date.now() < deadline) {
      const jobs: any[] = await api.jobs.list.query();
      const j = jobs.find((x) => x.id === job.id);
      if (j?.status === "completed" && j.output) out = j.output as string;
      else if (j?.status === "failed") throw new Error(`export failed: ${j.error}`);
      else await sleep(4000);
    }
    if (!out) throw new Error("export timed out");

    const dest = path.join(DELIVERY, `${video.slug}.mp4`);
    fs.copyFileSync(out, dest);
    console.log(`  delivered ${dest}`);
  }

  console.log(`\nall masters in ${DELIVERY}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e?.message ?? e, e?.stack);
  process.exit(1);
});
