/* Timeline internals shared by the screen's parts — the sequence's frame grid,
 * timecode, the per-kind palette every lane/clip/header reads from, and the
 * tick plan the ruler draws at the current zoom. */

import type { Timeline, TimelineTrack } from "@aurea/shared";

/** the sequence runs at 24fps; every edit quantises to a frame boundary */
export const FPS = 24;
export const FRAME = 1 / FPS;

/** timeline geometry — one place, so headers/lanes/playhead can't drift */
export const RULER_H = 30;
export const TRACK_H = 64;
export const HEADER_W = 168;
/** height of a clip inside its lane (the rest is breathing room) */
export const CLIP_H = TRACK_H - 14;

/** zoom range, in pixels per second of sequence */
export const ZOOM_MIN = 8;
export const ZOOM_MAX = 400;
export const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

export const uid = () => Math.random().toString(36).slice(2, 10);

/** seconds → the nearest frame, never negative */
export const snap = (v: number) => Math.max(0, Math.round(v * FPS) / FPS);

const pad = (n: number) => String(n).padStart(2, "0");

/** editorial timecode — mm:ss:ff, or hh:mm:ss:ff once the cut runs that long */
export function fmtTc(sec: number, withHours = false): string {
  const f = Math.max(0, Math.round(sec * FPS));
  const s = Math.floor(f / FPS);
  const tail = `${pad(withHours ? Math.floor(s / 60) % 60 : Math.floor(s / 60))}:${pad(s % 60)}:${pad(f % FPS)}`;
  return withHours ? `${pad(Math.floor(s / 3600))}:${tail}` : tail;
}

/** a duration for a chip — 4.2s / 1:04 */
export function fmtDur(sec: number): string {
  return sec < 60 ? `${sec.toFixed(1)}s` : `${Math.floor(sec / 60)}:${pad(Math.round(sec % 60))}`;
}

/** one palette per track kind — accent drives the header chip, the lane tint,
 * the clip's edge and its waveform, so a lane is identifiable at a glance */
export const KIND: Record<
  TimelineTrack["kind"],
  { code: string; label: string; accent: string; wave: string }
> = {
  video: { code: "V", label: "Video", accent: "#c9a96e", wave: "rgba(201,169,110,0.8)" },
  voice: { code: "A", label: "Voice", accent: "#8fb4d8", wave: "rgba(143,180,216,0.8)" },
  music: { code: "M", label: "Music", accent: "#7fbf9a", wave: "rgba(127,191,154,0.75)" },
  sfx: { code: "S", label: "SFX", accent: "#a99bee", wave: "rgba(169,155,238,0.75)" },
};

export function trackEnd(track: TimelineTrack): number {
  return track.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
}
export function sequenceEnd(tl: Timeline): number {
  return tl.tracks.reduce((m, t) => Math.max(m, trackEnd(t)), 0);
}
export function clipCount(tl: Timeline): number {
  return tl.tracks.reduce((m, t) => m + t.clips.length, 0);
}

/** V1 / A2 / M1 — the lane's NLE short code, counted within its own kind */
export function trackCode(tl: Timeline, index: number): string {
  const kind = tl.tracks[index].kind;
  return (
    KIND[kind].code + (tl.tracks.slice(0, index).filter((t) => t.kind === kind).length + 1)
  );
}

/** probe a media file's duration (falls back for images) */
export function probeDuration(url: string | undefined, kind: string): Promise<number> {
  if (!url || kind === "image") return Promise.resolve(4);
  return new Promise((resolve) => {
    const el = document.createElement(kind === "video" ? "video" : "audio");
    const done = (d: number) => {
      el.src = "";
      resolve(Number.isFinite(d) && d > 0 ? d : 5);
    };
    el.preload = "metadata";
    el.onloadedmetadata = () => done(el.duration);
    el.onerror = () => done(5);
    el.src = url;
  });
}

/** what the timeline resolves a clip's asset to */
export type ResolvedAsset =
  | {
      url?: string;
      kind: string;
      name: string;
      meta?: { text?: string; voice?: string; engine?: string; prompt?: string; nativeAudio?: boolean };
    }
  | undefined;

/** the ruler's two tick sizes at this zoom: labelled majors ≥ ~92px apart,
 * unlabelled minors only while they stay readable */
export function tickPlan(pxPerSec: number): { major: number; minor: number } {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const major = steps.find((s) => s * pxPerSec >= 92) ?? steps[steps.length - 1];
  const minor = major / 5;
  return { major, minor: minor * pxPerSec >= 7 ? minor : major };
}
