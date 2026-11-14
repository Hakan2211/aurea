/* The voice bed: a shot's placed takes flattened into ONE audio file.
 *
 * The Director timeline has an audio LANE — a list of takes with start times,
 * which the 2.3 node pack lays out itself. LTX 2.5 has no such node: its ia2v
 * arm takes a single decodable audio file and lip-syncs the picture to it
 * (LTX25-IA2V, verified 2026-08-23, audio r=0.99). So a 2.5 single needs the
 * lane rendered down first — silence for the lead-in, each take at its planned
 * second, the whole thing exactly as long as the take.
 *
 * Beds are a build artifact, not a library asset: they live in <dataRoot>/beds
 * so the library scanner (which walks projects/*\/assets) doesn't file them as
 * a second voice take of every line. The name is content-addressed, so
 * recomposing the same shot reuses the bed instead of re-running ffmpeg. */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface BedTake {
  /** dataRoot-relative path of the take */
  take: string;
  atSec: number;
}

/** Sample rate the TTS takes already come in at; resampling every bed to one
 * rate keeps amix from picking a surprising one. */
const RATE = 48000;

/** Build (or reuse) the bed. Returns a dataRoot-relative path, or null when
 * there is nothing to lay — a shot whose lines aren't recorded yet renders
 * silent rather than failing. */
export async function buildVoiceBed(
  dataRoot: string,
  takes: BedTake[],
  durationSec: number,
): Promise<string | null> {
  const placed = takes
    .filter((t) => t.take.trim())
    .map((t) => ({ take: t.take, atSec: Math.max(0, Math.round(t.atSec * 1000) / 1000 || 0) }))
    .sort((a, b) => a.atSec - b.atSec);
  if (placed.length === 0) return null;

  const files = placed.map((t) => path.join(dataRoot, t.take));
  for (const [i, file] of files.entries()) {
    if (!fs.existsSync(file)) throw new Error(`voice take not found: ${placed[i].take}`);
  }

  /* A single take that starts at zero IS the bed — no reason to re-encode it,
   * and the original is the file the QC articulation check already knows. */
  if (placed.length === 1 && placed[0].atSec < 0.005) return placed[0].take;

  const key = createHash("sha1")
    .update(JSON.stringify([placed, Math.round(durationSec * 1000)]))
    .digest("hex")
    .slice(0, 12);
  const outDir = path.join(dataRoot, "beds");
  fs.mkdirSync(outDir, { recursive: true });
  const dest = path.join(outDir, `bed-${key}.wav`);
  const rel = `beds/bed-${key}.wav`;

  // reuse unless a take has been re-recorded under the same name since
  try {
    const built = fs.statSync(dest).mtimeMs;
    if (files.every((f) => fs.statSync(f).mtimeMs <= built)) return rel;
  } catch {
    // not built yet
  }

  const filters = placed.map(
    (t, i) =>
      `[${i}:a]aformat=sample_fmts=fltp:sample_rates=${RATE}:channel_layouts=mono,` +
      `asetpts=PTS-STARTPTS,adelay=${Math.round(t.atSec * 1000)}[a${i}]`,
  );
  filters.push(`anullsrc=r=${RATE}:cl=mono,atrim=0:${durationSec}[abase]`);
  filters.push(
    `[abase]${placed.map((_, i) => `[a${i}]`).join("")}` +
      `amix=inputs=${placed.length + 1}:duration=first:normalize=0[aout]`,
  );

  await run([
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    ...files.flatMap((f) => ["-i", f]),
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[aout]",
    "-ar",
    String(RATE),
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    "-t",
    String(durationSec),
    dest,
  ]);
  return rel;
}

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("ffmpeg", args, (err, _out, stderr) => {
      if (!err) return resolve();
      reject(
        new Error(
          (err as NodeJS.ErrnoException).code === "ENOENT"
            ? "ffmpeg not found on PATH — it lays the voice bed for a 2.5 ia2v single"
            : stderr.trim() || err.message,
        ),
      );
    });
  });
}
