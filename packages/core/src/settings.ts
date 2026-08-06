/* SettingsStore — persisted studio configuration at ~/.aurea/settings.json.
 * The "zero hardcoded paths" rule: everything location-like is either detected
 * structurally on first boot (and persisted, so detection runs once) or set by
 * the user through settings.update. Nothing ships as a string literal. */

import { EventEmitter } from "node:events";
import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { settingsSchema, type Settings, type SettingsUpdate, type StorageStats } from "@aurea/shared";
import { AUREA_DIR } from "./portfile.js";

export const SETTINGS_FILE = path.join(AUREA_DIR, "settings.json");

const isVideofastRoot = (dir: string): boolean =>
  fs.existsSync(path.join(dir, "webapp", "package.json")) &&
  fs.existsSync(path.join(dir, "webapp", "scripts", "batch", "run-batch.ts"));

/** Find the videofast repo near where studiod itself lives (aurea and
 * videofast are sibling checkouts). Walk up from this module and from cwd,
 * checking each ancestor and its direct children for a videofast root. */
export function detectVideofastDir(): string | null {
  if (process.env.AUREA_VIDEOFAST_DIR && isVideofastRoot(process.env.AUREA_VIDEOFAST_DIR)) {
    return process.env.AUREA_VIDEOFAST_DIR;
  }
  const origins = [path.dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const origin of origins) {
    let dir = origin;
    for (let depth = 0; depth < 8; depth++) {
      for (const candidate of [dir, path.join(dir, "videofast")]) {
        if (isVideofastRoot(candidate)) return candidate;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

/** Probe the machine's known engine install conventions. Candidates come from
 * the videofast operator docs (each engine owns one venv); first hit wins. */
export function detectEnginePaths(): Pick<
  Settings["engines"],
  "chatterboxPython" | "qwenTtsPython" | "dramaboxPython" | "dramaboxRepo" | "acestepDir"
> {
  const first = (candidates: string[], probe: (c: string) => string = (c) => c) =>
    candidates.find((c) => fs.existsSync(probe(c))) ?? null;
  return {
    chatterboxPython: first(["D:/ttsenvs/chatterbox/Scripts/python.exe"]),
    qwenTtsPython: first([
      path.join(homedir(), "localai", "envs", "qwen-tts", "Scripts", "python.exe"),
    ]),
    dramaboxPython: first(["D:/ttsenvs/DramaBox/.venv/Scripts/python.exe"]),
    dramaboxRepo: first(["D:/ttsenvs/DramaBox"], (c) =>
      path.join(c, "src", "inference_server.py"),
    ),
    acestepDir: first(
      [path.join(homedir(), "acestep1.5", "ACE-Step-1.5"), "D:/acestep1.5/ACE-Step-1.5"],
      (c) => path.join(c, ".venv", "Scripts", "python.exe"),
    ),
  };
}

const defaults = (): Settings =>
  settingsSchema.parse({
    storage: { dataRoot: process.env.AUREA_DATA_ROOT ?? path.join(homedir(), "Aurea") },
    paths: { videofastDir: detectVideofastDir() },
    engines: detectEnginePaths(),
    providers: {},
    general: {},
    advanced: {},
  });

export class SettingsStore extends EventEmitter {
  private settings: Settings;

  constructor() {
    super();
    this.settings = this.load();
  }

  get(): Settings {
    return this.settings;
  }

  update(patch: SettingsUpdate): Settings {
    this.settings = settingsSchema.parse({
      ...this.settings,
      storage: { ...this.settings.storage, ...patch.storage },
      paths: { ...this.settings.paths, ...patch.paths },
      engines: {
        ...this.settings.engines,
        ...patch.engines,
        // nested objects — merge so a one-knob patch keeps the other knobs
        videoTuning: { ...this.settings.engines.videoTuning, ...patch.engines?.videoTuning },
        minimaxTuning: {
          ...this.settings.engines.minimaxTuning,
          ...patch.engines?.minimaxTuning,
        },
      },
      providers: { ...this.settings.providers, ...patch.providers },
      general: { ...this.settings.general, ...patch.general },
      advanced: { ...this.settings.advanced, ...patch.advanced },
    });
    this.save();
    this.emit("change", this.settings);
    return this.settings;
  }

  /** Live figures for the volume that holds dataRoot (statfs walks up to the
   * nearest existing ancestor so a not-yet-created root still answers). */
  async storageStats(): Promise<StorageStats> {
    const root = this.settings.storage.dataRoot;
    let probe = root;
    while (!fs.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    try {
      const s = await fs.promises.statfs(probe);
      const gb = (blocks: number) => Math.round(((blocks * s.bsize) / 1024 ** 3) * 10) / 10;
      return { root, freeGb: gb(s.bavail), totalGb: gb(s.blocks) };
    } catch {
      return { root, freeGb: null, totalGb: null };
    }
  }

  private load(): Settings {
    try {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
      const settings = settingsSchema.parse(raw);
      let dirty = false;
      // re-run detection if the stored path went stale (repo moved)
      if (settings.paths.videofastDir && !isVideofastRoot(settings.paths.videofastDir)) {
        settings.paths.videofastDir = detectVideofastDir();
        dirty = true;
      }
      // engine paths added after this settings file was written: detect once
      const detected = detectEnginePaths();
      for (const key of [
        "chatterboxPython",
        "qwenTtsPython",
        "dramaboxPython",
        "dramaboxRepo",
        "acestepDir",
      ] as const) {
        if (settings.engines[key] === null && detected[key] !== null) {
          settings.engines[key] = detected[key];
          dirty = true;
        }
      }
      if (dirty) {
        this.settings = settings;
        this.save();
      }
      return settings;
    } catch {
      const settings = defaults();
      this.settings = settings;
      this.save();
      return settings;
    }
  }

  private save(): void {
    fs.mkdirSync(AUREA_DIR, { recursive: true });
    const tmp = `${SETTINGS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.settings, null, 2));
    fs.renameSync(tmp, SETTINGS_FILE);
  }
}
