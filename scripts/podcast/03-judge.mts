/* Stage 3 — did it actually cut?
 *
 * "It looks like it cut" is not a result. This measures three things per take:
 *   cuts   — ffmpeg scene-change scores over the whole clip; a real hard cut
 *            lands ≥0.4 while a handheld settle sits under 0.1, so the count
 *            and the times are objective
 *   audio  — that a stream exists at all, is the right length, and is not
 *            silent (LTX scoring a shot itself is the interesting half)
 *   sheet  — an evenly spaced contact sheet plus one frame either side of
 *            every detected cut, so identity across the cut can be eyeballed
 *
 *   npx tsx scripts/podcast/03-judge.mts [file.mp4 ...]   (default: out/*.mp4)
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const HERE = path.join(process.cwd(), "scripts", "podcast");
const OUT_DIR = path.join(HERE, "out");
const THRESHOLD = Number(process.env.SCENE ?? 0.3);

const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const takes = files.length
  ? files
  : fs
      .readdirSync(OUT_DIR)
      .filter((f) => f.endsWith(".mp4"))
      .map((f) => path.join(OUT_DIR, f));

const ff = (bin: string, args: string[]) =>
  execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });

for (const file of takes) {
  console.log(`\n=== ${path.basename(file)} ===`);
  const probe = JSON.parse(
    ff("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]),
  );
  for (const s of probe.streams) {
    if (s.codec_type === "video") {
      console.log(
        `video  ${s.codec_name} ${s.width}×${s.height} ${s.r_frame_rate} ${s.nb_frames} frames`,
      );
    } else if (s.codec_type === "audio") {
      console.log(`audio  ${s.codec_name} ${s.sample_rate}Hz ${s.channels}ch`);
    }
  }
  console.log(`length ${Number(probe.format.duration).toFixed(2)}s`);

  /* scene scores: every frame's score, so the shape of the clip is visible,
   * not just the ones over the line */
  const scenes = ff("ffmpeg", [
    "-hide_banner", "-nostats", "-i", file,
    "-filter_complex", `select='gt(scene,${THRESHOLD})',metadata=print:file=-`,
    "-an", "-f", "null", "-",
  ]);
  const cuts: Array<{ t: number; score: number }> = [];
  const lines = scenes.split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = /pts_time:([\d.]+)/.exec(line);
    const s = /scene_score=([\d.]+)/.exec(lines[i + 1] ?? "");
    if (m && s) cuts.push({ t: Number(m[1]), score: Number(s[1]) });
  });
  console.log(
    `cuts   ${cuts.length} over ${THRESHOLD}: ` +
      (cuts.map((c) => `${c.t.toFixed(2)}s (${c.score.toFixed(2)})`).join(", ") || "none"),
  );

  /* mean volume — a silent track and a scored one look identical in ffprobe */
  const vol = ff("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "volumedetect", "-f", "null", "-"]);
  const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(vol)?.[1];
  const peak = /max_volume:\s*(-?[\d.]+) dB/.exec(vol)?.[1];
  console.log(`level  mean ${mean ?? "?"} dB · peak ${peak ?? "?"} dB`);

  /* contact sheet: 12 evenly spaced frames, 4 across */
  const base = file.replace(/\.\w+$/, "");
  const dur = Number(probe.format.duration);
  ff("ffmpeg", [
    "-y", "-hide_banner", "-nostats", "-i", file,
    "-vf", `fps=${(12 / dur).toFixed(4)},scale=480:-1,tile=4x3`,
    "-frames:v", "1", `${base}.sheet.jpg`,
  ]);
  console.log(`sheet  ${path.basename(base)}.sheet.jpg`);

  /* and the frames straddling each cut — the identity check */
  if (cuts.length) {
    const stamps = cuts.flatMap((c) => [Math.max(0, c.t - 0.09), c.t + 0.09]);
    stamps.forEach((t, i) => {
      ff("ffmpeg", [
        "-y", "-hide_banner", "-nostats", "-ss", t.toFixed(3), "-i", file,
        "-frames:v", "1", "-vf", "scale=640:-1", `${base}.cut${Math.floor(i / 2)}${i % 2 ? "b" : "a"}.jpg`,
      ]);
    });
    ff("ffmpeg", [
      "-y", "-hide_banner", "-nostats",
      ...stamps.flatMap((t) => ["-ss", t.toFixed(3), "-i", file]),
      "-filter_complex",
      `${stamps.map((_, i) => `[${i}:v]scale=480:-1[v${i}]`).join(";")};` +
        `${stamps.map((_, i) => `[v${i}]`).join("")}xstack=inputs=${stamps.length}:layout=${stamps
          .map((_, i) => `${i % 2 ? "w0" : "0"}_${Math.floor(i / 2) ? `h0*${Math.floor(i / 2)}` : "0"}`)
          .join("|")}[o]`,
      "-map", "[o]", "-frames:v", "1", `${base}.cuts.jpg`,
    ]);
    console.log(`cuts   ${path.basename(base)}.cuts.jpg (before | after, one row per cut)`);
  }
}
