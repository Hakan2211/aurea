/* Lab catalogs + generate helpers. Catalogs describe what this machine can
 * actually run: rosters are scanned from disk (voice refs), availability from
 * the settings-store engine paths. Results never live here — a lab's takes
 * are its project assets plus its running jobs, both already served by the
 * library scanner and the job engine. */

import fs from "node:fs";
import path from "node:path";
import type { EnqueueJobResolved, JobPayload } from "@aurea/shared";
import type { SettingsStore } from "./settings.js";

export interface LabEngine {
  id: string;
  label: string;
  note: string;
  available: boolean;
}

export interface LabVoice {
  id: string;
  name: string;
  kind: "cloned" | "preset";
  engine: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export class Labs {
  constructor(private settings: SettingsStore) {}

  private vf(): string | null {
    return this.settings.get().paths.videofastDir;
  }

  imageCatalog() {
    const vf = this.vf();
    const workflow = (name: string) =>
      !!vf && fs.existsSync(path.join(vf, "images", "workflows", `${name}.json`));
    return {
      models: [
        { id: "krea2", label: "Krea 2 · local", note: "photoreal · free", available: workflow("krea2") },
        { id: "z-image", label: "z-image-turbo · local", note: "fast drafts", available: workflow("z-image-turbo") },
      ] satisfies LabEngine[],
      aspects: ["1:1", "3:2", "16:9", "4:3", "9:16"],
      presets: ["Cinematic", "Photographic", "Concept Art", "Minimal", "Moody", "Vintage", "Fantasy"],
      promptMax: 1000,
    };
  }

  /** cloned roster = every frozen reference clip in videofast's char_refs */
  voiceCatalog() {
    const { engines } = this.settings.get();
    const vf = this.vf();
    const voices: LabVoice[] = [];
    const refDir = vf ? path.join(vf, "assets", "vo", "char_refs") : null;
    if (refDir && fs.existsSync(refDir)) {
      for (const entry of fs.readdirSync(refDir)) {
        if (entry.endsWith(".wav")) {
          const id = entry.slice(0, -4).toLowerCase();
          voices.push({ id, name: cap(id), kind: "cloned", engine: "Chatterbox" });
        }
      }
    }
    voices.push(
      { id: "gravel", name: "Gravel narrator", kind: "preset", engine: "Qwen3-TTS" },
      { id: "aiden", name: "Aiden", kind: "preset", engine: "Qwen3-TTS" },
    );
    return {
      engines: [
        {
          id: "chatterbox",
          label: "Chatterbox · local",
          note: "cloned voices · default",
          available: !!engines.chatterboxPython && voices.some((v) => v.kind === "cloned"),
        },
        {
          id: "qwen",
          label: "Qwen3-TTS · local",
          note: "narration",
          available: !!engines.qwenTtsPython,
        },
      ] satisfies LabEngine[],
      voices,
      scriptMax: 5000,
    };
  }

  musicCatalog() {
    const { engines } = this.settings.get();
    const cloned = this.voiceCatalog().voices.filter((v) => v.kind === "cloned");
    return {
      engine: {
        id: "acestep",
        label: "ACE-Step · local",
        note: "songs + stems · $0.00",
        available: !!engines.acestepDir,
      } satisfies LabEngine,
      styleLibrary: [
        "Retro funk", "Sitcom brass", "Upbeat", "Lo-fi", "Orchestral",
        "Synthwave", "Jazz combo", "Cinematic", "Disco",
      ],
      durationMin: 5,
      durationMax: 180,
      descriptionMax: 500,
      singVoices: cloned.map((v) => ({ id: v.id, label: v.name })),
    };
  }

  videoCatalog() {
    const vf = this.vf();
    const runner = (name: string) => !!vf && fs.existsSync(path.join(vf, "workflows", name));
    return {
      engines: [
        {
          id: "ltx2",
          label: "LTX-2",
          sub: "local · free",
          note: "Best for local runs",
          available: runner("run_ltx_i2v.py"),
        },
      ],
      engineNotes: { ltx2: "Renders on your GPU — $0.00" } as Record<string, string>,
      durations: ["3 seconds", "4 seconds", "5 seconds", "6 seconds", "8 seconds"],
      resolutions: ["704 × 896 (portrait)", "896 × 704 (landscape)", "1280 × 720 (16:9)"],
      promptMax: 1000,
      tip: "The start frame anchors identity — generate it in the Image lab first, then describe the motion here.",
    };
  }
}

/** slice a prompt/script into a job-card title */
const title = (text: string, max = 44) => {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean || "Untitled";
};

/** lab generate input → the job the engine runs; catalogs name the engines */
export function labEnqueue(payload: JobPayload, project: string): EnqueueJobResolved {
  const base = { priority: "interactive" as const, project: `/${project}`, payload };
  switch (payload.type) {
    case "image":
      return {
        ...base,
        title: title(payload.prompt),
        kind: "image",
        engine: payload.model === "z-image" ? "z-image-turbo" : "Krea 2",
        detail: `${payload.aspect} · ${payload.count} image${payload.count === 1 ? "" : "s"}${payload.preset ? ` · ${payload.preset}` : ""}`,
      };
    case "tts":
      return {
        ...base,
        title: title(payload.text),
        kind: "tts",
        engine: payload.engine === "qwen" ? "Qwen3-TTS" : "Chatterbox",
        detail: `${cap(payload.voice)} · emotion ${payload.emotion.toFixed(2)}`,
      };
    case "music":
      return {
        ...base,
        title: title(payload.description),
        kind: "music",
        engine: "ACE-Step",
        detail: `${payload.durationSec}s · ${payload.arrangement}${payload.styles.length ? ` · ${payload.styles.join(", ")}` : ""}`,
      };
    case "video":
      return {
        ...base,
        title: title(payload.prompt),
        kind: "video",
        engine: "LTX-2",
        detail: `${payload.resolution} · ${payload.durationSec}s${payload.audio ? " · lip-sync" : ""}`,
      };
    default:
      throw new Error("not a lab payload");
  }
}
