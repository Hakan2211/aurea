/* TimelineStore — one OTIO-shaped sequence per project, persisted whole as
 * <dataRoot>/projects/<id>/timeline.json (the folder-is-the-database rule:
 * copy the project folder, keep the cut). The renderer edits optimistically
 * and saves the full document; there is no delta protocol because sequences
 * are small. A fresh project gets the default three tracks. */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { timelineSchema, type Timeline } from "@aurea/shared";
import type { SettingsStore } from "./settings.js";

const DEFAULT_TRACKS: Array<{ kind: "video" | "voice" | "music"; name: string }> = [
  { kind: "video", name: "Video" },
  { kind: "voice", name: "Voice" },
  { kind: "music", name: "Music" },
];

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
}
