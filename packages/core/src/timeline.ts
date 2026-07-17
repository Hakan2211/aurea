/* TimelineStore — one OTIO-shaped sequence per project, persisted whole as
 * <dataRoot>/projects/<id>/timeline.json (the folder-is-the-database rule:
 * copy the project folder, keep the cut). The renderer edits optimistically
 * and saves the full document; there is no delta protocol because sequences
 * are small. A fresh project gets the default three tracks. */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  timelineSchema,
  type Timeline,
  type TimelineAddClip,
  type TimelineClip,
  type TimelineTrackKind,
} from "@aurea/shared";
import type { SettingsStore } from "./settings.js";
import { defaultClipDuration } from "./adapters/ffmpeg-export.js";

const DEFAULT_TRACKS: Array<{ kind: "video" | "voice" | "music"; name: string }> = [
  { kind: "video", name: "Video" },
  { kind: "voice", name: "Voice" },
  { kind: "music", name: "Music" },
];

/** which track a library kind lands on — mirrors the Timeline screen's rail */
const TRACK_FOR_KIND: Record<string, TimelineTrackKind> = {
  video: "video",
  image: "video",
  audio: "voice",
  music: "music",
};

export class TimelineStore {
  constructor(private settings: SettingsStore) {}

  private file(project: string): string {
    return path.join(
      this.settings.get().storage.dataRoot,
      "projects",
      project,
      "timeline.json",
    );
  }

  get(project: string): Timeline {
    try {
      return timelineSchema.parse(JSON.parse(fs.readFileSync(this.file(project), "utf8")));
    } catch {
      return timelineSchema.parse({
        tracks: DEFAULT_TRACKS.map((t) => ({ id: randomUUID(), ...t })),
      });
    }
  }

  update(project: string, timeline: Timeline): Timeline {
    const file = this.file(project);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(timeline, null, 2));
    fs.renameSync(tmp, file);
    return timeline;
  }

  /* ---- granular clip ops (the Director's edit surface) ----
   * The desktop editor saves whole documents; these read-modify-write the same
   * file so both surfaces stay interchangeable. */

  /** place a library asset on the sequence; returns the new clip + timeline */
  async addClip(project: string, input: Omit<TimelineAddClip, "project">): Promise<{ clip: TimelineClip; timeline: Timeline }> {
    const file = path.join(this.settings.get().storage.dataRoot, input.asset);
    if (!fs.existsSync(file)) {
      throw new Error(`asset not found: ${input.asset} (use a library relPath)`);
    }
    // assets live at projects/<id>/assets/<kind>/… — the tree names the kind
    const kindFromPath = input.asset.split("/").at(-2) ?? "";
    const kind =
      input.track ??
      TRACK_FOR_KIND[kindFromPath] ??
      (/\.(wav|mp3|flac|ogg|m4a)$/i.test(file) ? "voice" : "video");
    const duration = input.duration ?? (await defaultClipDuration(file));

    const tl = this.get(project);
    let track = tl.tracks.find((t) => t.kind === kind);
    if (!track) {
      track = { id: randomUUID(), kind, name: kind.charAt(0).toUpperCase() + kind.slice(1), muted: false, clips: [] };
      tl.tracks.push(track);
    }
    const trackEnd = track.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
    const clip: TimelineClip = {
      id: randomUUID().slice(0, 8),
      asset: input.asset,
      label: input.label ?? path.basename(file),
      start: input.start ?? trackEnd,
      in: input.in ?? 0,
      duration,
      transitionSec: input.transitionSec ?? 0,
    };
    track.clips.push(clip);
    return { clip, timeline: this.update(project, tl) };
  }

  updateClip(project: string, clipId: string, patch: Partial<Omit<TimelineClip, "id" | "asset">>): Timeline {
    const tl = this.get(project);
    const clip = tl.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
    if (!clip) throw new Error(`unknown clip "${clipId}" — timeline_get lists clip ids`);
    Object.assign(clip, patch);
    return this.update(project, tl);
  }

  removeClip(project: string, clipId: string): Timeline {
    const tl = this.get(project);
    const track = tl.tracks.find((t) => t.clips.some((c) => c.id === clipId));
    if (!track) throw new Error(`unknown clip "${clipId}" — timeline_get lists clip ids`);
    track.clips = track.clips.filter((c) => c.id !== clipId);
    return this.update(project, tl);
  }
}
