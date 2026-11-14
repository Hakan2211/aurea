/* Hard take verification (P3.1) and the room-tone fallback (P3.2).
 *
 * Two of the pilot's session-eating failures were SILENT: a ComfyUI job that
 * reported success with no video in it, and a take that came back digitally
 * silent under placed lines. Neither was caught until a human pressed play.
 * This module measures a take the moment it lands (server import hook) and
 * judges it against what the render was asked for, so a broken take shows red
 * in the Desk and approve_shot refuses to lock it.
 *
 * Pure half (`judgeTake`) is unit-tested; the ffmpeg half is exercised by a
 * live take. */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { TakeVerify } from "@aurea/shared";
import { probeMedia } from "./adapters/ffmpeg-export.js";

/* ---------- thresholds ---------- */

/** below this mean level the track is digital silence, not a quiet room —
 * LTX 2.5's no-dialogue output measures −91 dB (A/B 2026-09-02) */
export const DIGITAL_SILENCE_DB = -80;
/** how far a take may run from the length it was asked for */
export const DURATION_TOLERANCE = 0.15;
/** the mean LEVEL the bed is set to under the take — well under any
 * dialogue, well above qc.shot's −50 dB "effectively silent" line, and a
 * level rather than a gain so a hot stock file and a quiet ACE-Step seed
 * land in the same place */
export const ROOM_TONE_LEVEL_DB = -40;

/* ---------- ffmpeg plumbing ---------- */

const MAX_BUF = 64 * 1024 * 1024;

function run(bin: "ffmpeg" | "ffprobe", args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      ["-hide_banner", ...args],
      { windowsHide: true, maxBuffer: MAX_BUF, encoding: "utf8" },
      (err, stdout, stderr) => {
        // ffmpeg writes analysis output to stderr; -f null runs "fail" with ok output
        if (err && !stdout && !stderr) reject(new Error(`${bin} failed: ${String(err.message)}`));
        else resolve(`${stdout}\n${stderr}`);
      },
    );
  });
}

/* ---------- measurement ---------- */

export interface TakeMeasurement {
  hasVideo: boolean;
  /** decoded video frames, null when the count could not be read */
  frames: number | null;
  durationSec: number | null;
  hasAudio: boolean;
  /** volumedetect mean level, null when there is no audio or it failed */
  meanDb: number | null;
}

/** "mean_volume: -23.4 dB" → -23.4 */
export function parseMeanDb(text: string): number | null {
  const m = text.match(/mean_volume:\s*(-?[\d.]+|-inf)\s*dB/);
  if (!m) return null;
  if (m[1] === "-inf") return -Infinity;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

/** "nb_read_frames=120" → 120 */
export function parseFrameCount(text: string): number | null {
  const m = text.match(/nb_read_frames=(\d+)/);
  return m ? Number(m[1]) : null;
}

export async function measureTake(file: string): Promise<TakeMeasurement> {
  const probe = await probeMedia(file);
  let frames: number | null = null;
  if (probe.hasVideo) {
    /* decodable frames, not the header's claim: a truncated or PNG-in-an-mp4
     * container probes as "video" and decodes to nothing */
    frames = parseFrameCount(
      await run("ffprobe", [
        "-v", "error",
        "-select_streams", "v:0",
        "-count_frames",
        "-show_entries", "stream=nb_read_frames",
        "-of", "default=noprint_wrappers=1",
        file,
      ]).catch(() => ""),
    );
  }
  let meanDb: number | null = null;
  if (probe.hasAudio) {
    meanDb = parseMeanDb(
      await run("ffmpeg", ["-nostats", "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"]).catch(() => ""),
    );
  }
  return { hasVideo: probe.hasVideo, frames, durationSec: probe.duration, hasAudio: probe.hasAudio, meanDb };
}

/* ---------- judgement (pure) ---------- */

export interface TakeExpectation {
  /** the render carried placed lines or a sound cue — silence is a failure */
  expectAudio: boolean;
  /** the length the render was asked for */
  requestedDurationSec?: number | null;
  /** a preview (P5): judged the same way, never bedded with room tone */
  preview?: boolean;
}

export interface TakeJudgement {
  status: "ok" | "broken";
  reasons: string[];
  /** no audio, or audio at digital silence — the room-tone candidate */
  silent: boolean;
}

export function judgeTake(m: TakeMeasurement, expect: TakeExpectation): TakeJudgement {
  const reasons: string[] = [];
  if (!m.hasVideo) reasons.push("no video track — the render reported success with nothing in it");
  else if (m.frames === 0) reasons.push("zero decodable frames — the file is not a playable video");
  else if (m.frames === 1 || (m.frames === null && m.durationSec === null)) {
    /* a PNG probes as "video" with one frame and no duration (the LoadAudio
     * bug once pointed a take at exactly that) */
    reasons.push("a single still, not a take — one decodable frame and no duration");
  }
  const silent = !m.hasAudio || (m.meanDb !== null && m.meanDb < DIGITAL_SILENCE_DB);
  if (silent && expect.expectAudio) {
    reasons.push(
      m.hasAudio
        ? `digital silence (mean ${m.meanDb === -Infinity ? "−∞" : m.meanDb?.toFixed(0)} dB) under placed lines or a sound cue`
        : "no audio track under placed lines or a sound cue",
    );
  }
  const asked = expect.requestedDurationSec ?? null;
  if (asked && m.durationSec) {
    const drift = Math.abs(m.durationSec - asked) / asked;
    if (drift > DURATION_TOLERANCE) {
      reasons.push(`runs ${m.durationSec.toFixed(2)}s vs the ${asked}s requested (${(drift * 100).toFixed(0)}% off)`);
    }
  }
  return { status: reasons.length ? "broken" : "ok", reasons, silent };
}

/** the record that lands on the take */
export function verifyRecord(m: TakeMeasurement, j: TakeJudgement, roomTone?: string): TakeVerify {
  return {
    status: j.status,
    reasons: j.reasons,
    checkedAt: new Date().toISOString(),
    measuredDurationSec: m.durationSec,
    meanDb: m.meanDb === -Infinity ? -99 : m.meanDb,
    ...(roomTone ? { roomTone } : {}),
  };
}

/* ---------- room tone (P3.2) ---------- */

/** Lay a looped bed under the take, its mean level set to ROOM_TONE_LEVEL_DB.
 * The picture is copied, not re-encoded; the output is a sibling file so the
 * silent original stays on disk. Returns the output path. */
export async function bedRoomTone(takeFile: string, bedFile: string, levelDb = ROOM_TONE_LEVEL_DB): Promise<string> {
  const probe = await probeMedia(takeFile);
  const bedMean = parseMeanDb(
    await run("ffmpeg", ["-nostats", "-i", bedFile, "-vn", "-af", "volumedetect", "-f", "null", "-"]).catch(() => ""),
  );
  if (bedMean === null || bedMean === -Infinity) throw new Error("room-tone bed is silent or unreadable");
  const gainDb = levelDb - bedMean;
  const ext = path.extname(takeFile);
  const out = path.join(path.dirname(takeFile), `${path.basename(takeFile, ext)}.tone${ext}`);
  const filter = probe.hasAudio
    ? `[1:a]volume=${gainDb}dB[bed];[0:a][bed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`
    : `[1:a]volume=${gainDb}dB[a]`;
  await run("ffmpeg", [
    "-nostats", "-y",
    "-i", takeFile,
    "-stream_loop", "-1", "-i", bedFile,
    "-filter_complex", filter,
    "-map", "0:v:0", "-map", "[a]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
    "-shortest",
    out,
  ]);
  if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new Error("room-tone bed produced no file");
  return out;
}

/** the caption ACE-Step gets when a location's bed is seeded (no melody, no
 * rhythm — a room, not a score) */
export function roomTonePrompt(location: { name: string; description?: string }): string {
  const desc = location.description?.trim();
  return (
    `Room tone, ambient field recording of ${location.name}${desc ? `: ${desc}` : ""}. ` +
    "Quiet continuous background atmosphere, air and distant room sounds, no music, no melody, no rhythm, no voices, seamless loop."
  );
}
