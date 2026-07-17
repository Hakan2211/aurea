/* Timeline export — the ffmpeg cuts-first fast path (PRD F8 / P3). One ffmpeg
 * pass renders the sequence exactly as the Timeline screen previews it: video
 * tracks composite in array order — later tracks sit on top (Video 2 =
 * inserts/cutaways over the base) — clips overlaid by absolute start onto a
 * black base, `transitionSec` = alpha crossfade into the clip, image clips are
 * held stills. Every unmuted track's audio — including audio embedded in video
 * takes on any track — is placed at its timeline position and mixed; muting a
 * video track silences it without hiding its picture.
 *
 * The filter graph goes through -filter_complex_script (Windows command lines
 * cap at 8k chars), progress rides -progress pipe:1, and the finished mp4
 * lands in the job's run dir for the usual importOutput pickup. */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Job, JobPayload, Timeline, TimelineClip } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import type { JobResources } from "../scheduler.js";
import { jobRunDir, runProcess, LastError } from "./proc.js";
import type { AdapterProgress, AdapterRun, EngineAdapter } from "./types.js";

type ExportPayload = Extract<JobPayload, { type: "export" }>;

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);

export const isImageFile = (file: string) => IMAGE_EXT.has(path.extname(file).toLowerCase());

/* ---------- ffprobe ---------- */

export interface MediaProbe {
  /** seconds, null when the container doesn't say (stills) */
  duration: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
}

export function probeMedia(file: string): Promise<MediaProbe> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", file],
      { windowsHide: true },
      (err, stdout) => {
        if (err) {
          reject(new Error(`ffprobe failed on ${path.basename(file)} — is ffmpeg installed and on PATH?`));
          return;
        }
        try {
          const info = JSON.parse(stdout) as {
            format?: { duration?: string };
            streams?: Array<{ codec_type?: string }>;
          };
          const duration = Number(info.format?.duration);
          resolve({
            duration: Number.isFinite(duration) && duration > 0 ? duration : null,
            hasAudio: !!info.streams?.some((s) => s.codec_type === "audio"),
            hasVideo: !!info.streams?.some((s) => s.codec_type === "video"),
          });
        } catch (parseErr) {
          reject(parseErr instanceof Error ? parseErr : new Error(String(parseErr)));
        }
      },
    );
  });
}

/** clip length for placement — probed for real media, the editor's 4s hold for stills */
export async function defaultClipDuration(file: string): Promise<number> {
  if (isImageFile(file)) return 4;
  const probe = await probeMedia(file);
  return probe.duration ?? 5;
}

/* ---------- sequence geometry ---------- */

export function sequenceEnd(tl: Timeline): number {
  return tl.tracks.reduce(
    (m, t) => t.clips.reduce((mm, c) => Math.max(mm, c.start + c.duration), m),
    0,
  );
}

const n = (v: number) => Number((Math.max(0, v)).toFixed(4));

/* ---------- the adapter ---------- */

export class FfmpegExportAdapter implements EngineAdapter {
  id = "ffmpeg-export";

  constructor(private settings: SettingsStore) {}

  canRun(job: Job): boolean {
    return job.payload?.type === "export";
  }

  resources(job: Job): JobResources {
    void job;
    return { klass: "cpu" }; // libx264 on cores — the GPU lane stays free
  }

  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun {
    let killed: (() => void) | null = null;
    let canceled = false;

    const done = (async () => {
      const payload = job.payload;
      if (payload?.type !== "export") throw new Error("not an export job");
      const tl = payload.timeline;
      const total = sequenceEnd(tl);
      if (total <= 0) throw new Error("The timeline is empty — add clips before exporting");

      report({ progress: 1, stage: "Preparing", detail: `${tl.width}×${tl.height} · ${total.toFixed(1)}s` });

      const dataRoot = this.settings.get().storage.dataRoot;
      const resolve = (rel: string) => path.join(dataRoot, rel);
      const missing = tl.tracks
        .flatMap((t) => t.clips)
        .map((c) => c.asset)
        .filter((rel) => !fs.existsSync(resolve(rel)));
      if (missing.length) {
        throw new Error(`Timeline references missing media: ${[...new Set(missing)].join(", ")}`);
      }

      // probe every unique source once — embedded-audio detection
      const sources = [...new Set(tl.tracks.flatMap((t) => t.clips.map((c) => c.asset)))];
      const probes = new Map<string, MediaProbe>();
      for (const rel of sources) {
        const file = resolve(rel);
        probes.set(rel, isImageFile(file) ? { duration: null, hasAudio: false, hasVideo: true } : await probeMedia(file));
      }
      if (canceled) throw new Error("Canceled by user");

      /* ---- inputs + filter graph ---- */
      const inputIndex = new Map<string, number>(); // keyed per (asset, image-hold-duration)
      const filters: string[] = [];
      const videoLabels: string[] = [];
      const audioLabels: string[] = [];
      const inputArgs: string[][] = [];
      const indexFor = (clip: TimelineClip, still: boolean): number => {
        const key = still ? `${clip.asset}#${n(clip.duration)}` : clip.asset;
        const existing = inputIndex.get(key);
        if (existing !== undefined) return existing;
        const file = resolve(clip.asset);
        inputArgs.push(
          still
            ? ["-loop", "1", "-framerate", String(tl.fps), "-t", String(n(clip.duration)), "-i", file]
            : ["-i", file],
        );
        const idx = inputArgs.length - 1;
        inputIndex.set(key, idx);
        return idx;
      };

      // picture — every video track in array order; a later track's overlays
      // are applied after (= on top of) an earlier track's, so Video 2 wins
      // wherever clips overlap, mirroring the preview player
      const videoTracks = tl.tracks.filter((t) => t.kind === "video");
      const videoClips = videoTracks.flatMap((t) => [...t.clips].sort((a, b) => a.start - b.start));
      let vi = 0;
      for (const clip of videoClips) {
        const still = isImageFile(resolve(clip.asset));
        const idx = indexFor(clip, still);
        const fade = Math.min(clip.transitionSec, clip.duration);
        const label = `v${vi++}`;
        const chain = [
          still ? null : `trim=start=${n(clip.in)}:end=${n(clip.in + clip.duration)}`,
          "setpts=PTS-STARTPTS",
          // freeze-frame past the source's end, like the paused preview player
          still ? null : "tpad=stop=-1:stop_mode=clone",
          `fps=${tl.fps}`,
          `scale=${tl.width}:${tl.height}:force_original_aspect_ratio=decrease`,
          `pad=${tl.width}:${tl.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
          "setsar=1",
          "format=yuva420p",
          fade > 0 ? `fade=t=in:st=0:d=${n(fade)}:alpha=1` : null,
          `setpts=PTS+${n(clip.start)}/TB`,
        ]
          .filter(Boolean)
          .join(",");
        filters.push(`[${idx}:v]${chain}[${label}]`);
        videoLabels.push(label);
      }

      // audio — every unmuted track's clips, plus sound embedded in video takes
      let ai = 0;
      for (const track of tl.tracks) {
        if (track.muted) continue;
        for (const clip of track.clips) {
          if (!probes.get(clip.asset)?.hasAudio) continue;
          const idx = indexFor(clip, false);
          const fade = Math.min(clip.transitionSec, clip.duration);
          const label = `a${ai++}`;
          const chain = [
            `atrim=start=${n(clip.in)}:end=${n(clip.in + clip.duration)}`,
            "asetpts=PTS-STARTPTS",
            "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo",
            fade > 0 ? `afade=t=in:st=0:d=${n(fade)}` : null,
            `adelay=${Math.round(clip.start * 1000)}:all=1`,
          ]
            .filter(Boolean)
            .join(",");
          filters.push(`[${idx}:a]${chain}[${label}]`);
          audioLabels.push(label);
        }
      }

      // black base + overlays, windowed to each clip's timeline slot
      filters.unshift(`color=c=black:s=${tl.width}x${tl.height}:r=${tl.fps}:d=${n(total)}[base]`);
      let composite = "base";
      videoLabels.forEach((label, i) => {
        const clip = videoClips[i];
        const out = i === videoLabels.length - 1 ? "vcomp" : `o${i}`;
        filters.push(
          `[${composite}][${label}]overlay=eof_action=pass:enable='between(t,${n(clip.start)},${n(clip.start + clip.duration)})'[${out}]`,
        );
        composite = out;
      });
      filters.push(`[${composite}]format=yuv420p[vout]`);

      // silence carries the mix to full length; normalize=0 keeps clip loudness
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${n(total)}[abase]`);
      filters.push(
        `[abase]${audioLabels.map((l) => `[${l}]`).join("")}amix=inputs=${audioLabels.length + 1}:duration=first:normalize=0[aout]`,
      );

      const runDir = jobRunDir(job.id);
      const script = path.join(runDir, "filter.txt");
      fs.writeFileSync(script, filters.join(";\n"));
      const out = path.join(runDir, "out", "final.mp4");
      fs.mkdirSync(path.dirname(out), { recursive: true });

      const args = [
        "-y",
        "-v", "error",
        "-nostats",
        "-progress", "pipe:1",
        ...inputArgs.flat(),
        "-filter_complex_script", script,
        "-map", "[vout]",
        "-map", "[aout]",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "18",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        "-t", String(n(total)),
        out,
      ];

      report({ progress: 3, stage: "Rendering cut", detail: `${videoClips.length} clips · ${audioLabels.length} audio sources` });
      const lastError = new LastError();
      const proc = runProcess({
        exe: "ffmpeg",
        args,
        logFile: path.join(runDir, "run.log"),
        onLine: (line) => {
          lastError.note(line);
          const us = line.match(/^out_time_us=(\d+)/)?.[1];
          const clock = line.match(/^out_time=(\d+):(\d+):([\d.]+)/);
          const sec = us
            ? Number(us) / 1e6
            : clock
              ? Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3])
              : null;
          if (sec !== null && Number.isFinite(sec)) {
            report({ progress: 3 + Math.min(93, (sec / total) * 93), stage: "Rendering cut" });
          }
        },
      });
      killed = proc.kill;
      const code = await proc.exited;
      if (canceled) throw new Error("Canceled by user");
      if (code !== 0) throw new Error(lastError.message(`ffmpeg exited with code ${code}`));
      if (!fs.existsSync(out)) throw new Error("ffmpeg finished but produced no file");

      report({ progress: 100, stage: "Done", detail: `${total.toFixed(1)}s master` });
      return { output: out };
    })();

    return {
      done,
      cancel: () => {
        canceled = true;
        killed?.();
      },
    };
  }
}

/** what the export job shows in the queue before the adapter takes over */
export function describeExport(tl: Timeline): string {
  const clips = tl.tracks.reduce((m, t) => m + t.clips.length, 0);
  return `${clips} clip${clips === 1 ? "" : "s"} · ${sequenceEnd(tl).toFixed(1)}s · ${tl.width}×${tl.height}`;
}

/** narrow helper for callers that already validated the payload */
export type { ExportPayload };
