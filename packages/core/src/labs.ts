/* Lab catalogs + generate helpers. Catalogs describe what this machine can
 * actually run: rosters are scanned from disk (voice refs), availability from
 * the settings-store engine paths. Results never live here — a lab's takes
 * are its project assets plus its running jobs, both already served by the
 * library scanner and the job engine. */

import fs from "node:fs";
import path from "node:path";
import type { EnqueueJobResolved, JobPayload } from "@aurea/shared";
import type { SettingsStore } from "./settings.js";
import type { ModelManager } from "./models/manager.js";
import type { EngineRuntime } from "./runtime/runtime.js";

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
  /** where the reference clip lives — only "studio" voices are deletable */
  source?: "studio" | "videofast";
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "studio-narrator" → "Studio Narrator" */
const voiceName = (id: string) => id.split(/[-_]+/).filter(Boolean).map(cap).join(" ");

const VOICE_ID = /^[a-z0-9][a-z0-9-]*$/;
const VOICE_MAX_BYTES = 64 * 1024 * 1024;

export class Labs {
  constructor(
    private settings: SettingsStore,
    private models: ModelManager,
    private runtime: EngineRuntime,
  ) {}

  private vf(): string | null {
    return this.settings.get().paths.videofastDir;
  }

  imageCatalog() {
    const managed = this.settings.get().engines.comfyMode === "managed";
    const installed = (id: string) =>
      this.models.list().find((m) => m.id === id)?.status.state === "installed";
    return {
      models: [
        {
          id: "z-image",
          label: "z-image-turbo · local",
          note: managed ? "fast drafts · managed engine" : "fast drafts",
          // managed: needs the runtime + weights; external: the user's ComfyUI has its own
          available: managed
            ? this.runtime.componentReady("comfy") && installed("z-image-turbo")
            : true,
        },
        {
          id: "krea2",
          label: "Krea 2 · local",
          note: managed ? "photoreal · managed engine" : "photoreal · free",
          // managed additionally needs the GGUF loader nodes + the Q8 weights
          available: managed
            ? this.runtime.componentReady("comfy") &&
              this.runtime.componentReady("gguf") &&
              installed("krea2-turbo-gguf")
            : true,
        },
      ] satisfies LabEngine[],
      aspects: ["1:1", "3:2", "16:9", "4:3", "9:16"],
      presets: ["Cinematic", "Photographic", "Concept Art", "Minimal", "Moody", "Vintage", "Fantasy"],
      promptMax: 1000,
    };
  }

  /** cloned roster = every frozen reference clip in <dataRoot>/voices plus
   * videofast's char_refs (studio's own folder wins on id collisions) */
  voiceCatalog() {
    const { storage, engines } = this.settings.get();
    const vf = this.vf();
    const voices: LabVoice[] = [];
    const refDirs: Array<[string, NonNullable<LabVoice["source"]>]> = [
      [path.join(storage.dataRoot, "voices"), "studio"],
    ];
    if (vf) refDirs.push([path.join(vf, "assets", "vo", "char_refs"), "videofast"]);
    for (const [refDir, source] of refDirs) {
      if (!fs.existsSync(refDir)) continue;
      for (const entry of fs.readdirSync(refDir)) {
        if (!entry.endsWith(".wav")) continue;
        const id = entry.slice(0, -4).toLowerCase();
        if (voices.some((v) => v.id === id)) continue;
        voices.push({ id, name: voiceName(id), kind: "cloned", engine: "Chatterbox", source });
      }
    }
    voices.push(
      { id: "gravel", name: "Gravel narrator", kind: "preset", engine: "Qwen3-TTS" },
      { id: "aiden", name: "Aiden", kind: "preset", engine: "Qwen3-TTS" },
    );
    const managed = engines.ttsMode === "managed";
    const chatterboxReady = managed
      ? this.runtime.componentReady("chatterbox") &&
        this.models.list().find((m) => m.id === "chatterbox-tts")?.status.state === "installed"
      : !!engines.chatterboxPython;
    return {
      engines: [
        {
          id: "chatterbox",
          label: "Chatterbox · local",
          note: managed ? "cloned voices · managed engine" : "cloned voices · default",
          available: chatterboxReady && voices.some((v) => v.kind === "cloned"),
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

  /** clone a voice: freeze the (already wav-encoded) sample as
   * <dataRoot>/voices/<id>.wav — from then on it's on every roster */
  addVoice(name: string, wav: Buffer): LabVoice {
    const id = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!VOICE_ID.test(id)) {
      throw new Error("voice name needs at least one letter or digit");
    }
    if (wav.length > VOICE_MAX_BYTES) {
      throw new Error("reference clip too large (64 MB max)");
    }
    if (
      wav.length < 1024 ||
      wav.toString("ascii", 0, 4) !== "RIFF" ||
      wav.toString("ascii", 8, 12) !== "WAVE"
    ) {
      throw new Error("sample is not a WAV file");
    }
    if (this.voiceCatalog().voices.some((v) => v.id === id)) {
      throw new Error(`a voice named "${id}" already exists`);
    }
    const dir = path.join(this.settings.get().storage.dataRoot, "voices");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.wav`), wav);
    return { id, name: voiceName(id), kind: "cloned", engine: "Chatterbox", source: "studio" };
  }

  /** delete a studio voice's reference clip; videofast char_refs and presets
   * aren't ours to delete */
  removeVoice(id: string): void {
    if (!VOICE_ID.test(id)) throw new Error(`invalid voice id "${id}"`);
    const file = path.join(this.settings.get().storage.dataRoot, "voices", `${id}.wav`);
    if (!fs.existsSync(file)) throw new Error(`"${id}" is not a studio voice`);
    fs.unlinkSync(file);
  }

  musicCatalog() {
    const { engines } = this.settings.get();
    const cloned = this.voiceCatalog().voices.filter((v) => v.kind === "cloned");
    const managed = engines.musicMode === "managed";
    const acestepReady = managed
      ? this.runtime.componentReady("acestep") &&
        this.models.list().find((m) => m.id === "acestep-v15")?.status.state === "installed"
      : !!engines.acestepDir;
    return {
      engine: {
        id: "acestep",
        label: "ACE-Step · local",
        note: managed ? "songs + stems · managed engine" : "songs + stems · $0.00",
        available: acestepReady,
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
    const { engines } = this.settings.get();
    const managed = engines.videoMode === "managed";
    // external mode queues on comfyUrl, whose install carries the LTX weights;
    // managed needs the runtime's ComfyUI plus the model-manager weight set
    const available = managed
      ? this.runtime.componentReady("comfy") &&
        this.models.list().find((m) => m.id === "ltx-23-22b-fp8")?.status.state === "installed"
      : true;
    return {
      engines: [
        {
          id: "ltx2",
          label: "LTX-2.3",
          sub: managed ? "local · managed" : "local · free",
          note: "Best for local runs",
          available,
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
