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
import { seedanceEstimate } from "./adapters/seedance.js";
import { RVC_CONVERT_ESTIMATE, RVC_TRAIN_ESTIMATE, rvcModelPath } from "./adapters/replicate-rvc.js";

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
  /** a trained RVC v2 model exists for this voice (voices/rvc/<id>.zip) */
  rvcTrained?: boolean;
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
    // "ready" spans a copy we downloaded and one linked from the user's own
    // model library — the picker must not say "not installed" about weights
    // that are sitting right there
    const installed = (id: string) => this.models.ready(id);
    return {
      models: [
        {
          id: "z-image",
          label: "z-image-turbo · local",
          note: managed ? "fast drafts · managed engine" : "fast drafts",
          role: "generate",
          // managed: needs the runtime + weights; external: the user's ComfyUI has its own
          available: managed
            ? this.runtime.componentReady("comfy") && installed("z-image-turbo")
            : true,
        },
        {
          id: "krea2",
          label: "Krea 2 · local",
          note: managed ? "photoreal · managed engine" : "photoreal · free",
          role: "generate",
          // managed additionally needs the GGUF loader nodes + the Q8 weights
          available: managed
            ? this.runtime.componentReady("comfy") &&
              this.runtime.componentReady("gguf") &&
              installed("krea2-turbo-gguf")
            : true,
        },
        {
          id: "qwen-edit",
          label: "Qwen Edit 2509 · local",
          note: managed ? "reference editing · managed engine" : "reference editing",
          role: "edit",
          // same GGUF loader stack as krea2, plus the Q5 edit weights
          available: managed
            ? this.runtime.componentReady("comfy") &&
              this.runtime.componentReady("gguf") &&
              installed("qwen-image-edit-2509-gguf")
            : true,
        },
      ] satisfies (LabEngine & { role?: "generate" | "edit" })[],
      aspects: ["1:1", "3:2", "16:9", "4:3", "9:16"],
      presets: ["Cinematic", "Photographic", "Concept Art", "Minimal", "Moody", "Vintage", "Fantasy"],
      promptMax: 1000,
      refsMax: 3,
      countMax: 4,
      advanced: {
        sizeMin: 512,
        sizeMax: 2048,
        sizeStep: 16,
        stepsMax: 50,
        cfgMax: 15,
        /** per-model proven defaults (graphs.ts) shown as placeholders */
        defaults: {
          "z-image": { steps: 8, cfg: 1.0 },
          krea2: { steps: 8, cfg: 1.0 },
          "qwen-edit": { steps: 20, cfg: 4.0 },
        } as Record<string, { steps: number; cfg: number }>,
      },
    };
  }

  /** cloned roster = every frozen reference clip in <dataRoot>/voices plus
   * videofast's char_refs (studio's own folder wins on id collisions) */
  voiceCatalog() {
    const { storage, engines, providers } = this.settings.get();
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
        voices.push({
          id,
          name: voiceName(id),
          kind: "cloned",
          engine: "Chatterbox",
          source,
          rvcTrained: fs.existsSync(rvcModelPath(storage.dataRoot, id)),
        });
      }
    }
    voices.push(
      { id: "gravel", name: "Gravel narrator", kind: "preset", engine: "Qwen3-TTS" },
      { id: "aiden", name: "Aiden", kind: "preset", engine: "Qwen3-TTS" },
    );
    const managed = engines.ttsMode === "managed";
    const chatterboxReady = managed
      ? this.runtime.componentReady("chatterbox") &&
        this.models.ready("chatterbox-tts")
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
        {
          id: "dramabox",
          label: "DramaBox · local",
          note: "expressive acting · stage directions",
          available:
            !!engines.dramaboxPython &&
            fs.existsSync(engines.dramaboxPython) &&
            !!engines.dramaboxRepo &&
            voices.some((v) => v.kind === "cloned"),
        },
      ] satisfies LabEngine[],
      voices,
      scriptMax: 5000,
      /** Seed-VC voice/singing conversion (managed engine only) */
      convert: {
        available: this.runtime.componentReady("seedvc"),
        // singing needs the deeper end of the schedule — 30 was audibly rough
        stepsDefault: { speak: 25, sing: 50 },
      },
      /** Replicate RVC v2 — per-voice trained cloud conversion (paid) */
      rvc: {
        available: !!providers.replicateApiToken,
        trainEstimate: RVC_TRAIN_ESTIMATE,
        convertEstimate: RVC_CONVERT_ESTIMATE,
      },
    };
  }

  /** The engine that actually owns a voice. Callers (and the Director) often
   * leave the engine on its chatterbox default while naming a Qwen narrator
   * preset — that used to die minutes later inside the adapter with "no
   * reference clip". Route by roster instead of trusting the pairing. */
  routeTtsEngine(voice: string, requested: string): string {
    const entry = this.voiceCatalog().voices.find((v) => v.id === voice.toLowerCase());
    if (!entry) return requested; // unknown voice — the adapter reports it cleanly
    if (entry.kind === "preset") return "qwen";
    // cloned voices: DramaBox is an explicit opt-in; anything else normalizes
    // to chatterbox (the "engine left on its default" fix)
    return requested === "dramabox" ? "dramabox" : "chatterbox";
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

  /** absolute path of a roster voice's reference clip — what the /voiceref/
   * preview route streams (cloned voices only; presets have no clip) */
  voiceRefPath(id: string): string | null {
    const v = this.voiceCatalog().voices.find(
      (x) => x.id === id.toLowerCase() && x.kind === "cloned",
    );
    if (!v) return null;
    const file =
      v.source === "studio"
        ? path.join(this.settings.get().storage.dataRoot, "voices", `${v.id}.wav`)
        : this.vf()
          ? path.join(this.vf()!, "assets", "vo", "char_refs", `${v.id}.wav`)
          : null;
    return file && fs.existsSync(file) ? file : null;
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
        this.models.ready("acestep-v15")
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
      durationMax: 420,
      descriptionMax: 500,
      lyricsMax: 4096,
      bpmRange: [30, 300] as [number, number],
      timesignatures: ["2", "3", "4", "6"],
      /** ACE-Step VALID_LANGUAGES (acestep/constants.py); "unknown" = model decides */
      languages: [
        "unknown", "ar", "az", "bg", "bn", "ca", "cs", "da", "de", "el", "en",
        "es", "fa", "fi", "fr", "he", "hi", "hr", "ht", "hu", "id",
        "is", "it", "ja", "ko", "la", "lt", "ms", "ne", "nl", "no",
        "pa", "pl", "pt", "ro", "ru", "sa", "sk", "sr", "sv", "sw",
        "ta", "te", "th", "tl", "tr", "uk", "ur", "vi", "yue", "zh",
      ],
      stepsDefault: 8,
      shiftDefault: 3.0,
      /** language/keyscale/timesignature reach the engine in managed mode only —
       * the external CLI has no flags for them */
      metadataManagedOnly: !managed,
      singVoices: cloned.map((v) => ({ id: v.id, label: v.name })),
    };
  }

  videoCatalog() {
    const { engines, providers } = this.settings.get();
    const managed = engines.videoMode === "managed";
    // external mode queues on comfyUrl, whose install carries the LTX weights;
    // managed needs the runtime's ComfyUI plus the model-manager weight set
    const available = managed
      ? this.runtime.componentReady("comfy") &&
        this.models.ready("ltx-23-22b-fp8")
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
        {
          id: "seedance",
          label: "Seedance 1.0",
          sub: "cloud · paid",
          note: "Quality fallback via fal.ai",
          available: !!providers.falApiKey,
        },
      ],
      engineNotes: {
        ltx2: "Renders on your GPU — $0.00",
        seedance: providers.falApiKey
          ? "Cloud render on your fal.ai account — ≈ $0.05/s at 720p, $0.15/s at 1080p"
          : "Add your fal.ai API key in Settings → AI Providers to enable",
      } as Record<string, string>,
      // LTX 2.3 is length-agnostic — the graph derives frames as duration*24+1,
      // so the ceiling is VRAM, not the model (the shipped template defaults to
      // 9s). Seedance's API only offers 5s/10s, so its adapter rounds.
      durations: [
        "3 seconds",
        "4 seconds",
        "5 seconds",
        "6 seconds",
        "8 seconds",
        "10 seconds",
        "12 seconds",
        "15 seconds",
        "20 seconds",
      ],
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
        engine:
          payload.model === "z-image"
            ? "z-image-turbo"
            : payload.model === "qwen-edit"
              ? "Qwen Edit 2509"
              : "Krea 2",
        detail: `${payload.aspect} · ${payload.count} image${payload.count === 1 ? "" : "s"}${payload.preset ? ` · ${payload.preset}` : ""}`,
      };
    case "imageDeck":
      return {
        ...base,
        // decks are bulk work — don't starve interactive lab jobs
        priority: "batch",
        title: payload.deckName,
        kind: "image",
        engine: payload.model === "z-image" ? "z-image-turbo" : "Krea 2",
        detail: `deck · ${payload.prompts.length} image${payload.prompts.length === 1 ? "" : "s"} · ${payload.aspect}${payload.preset ? ` · ${payload.preset}` : ""}`,
      };
    case "imageUpscale": {
      const stem = payload.source.split("/").pop() ?? payload.source;
      const refine = payload.mode === "refine";
      return {
        ...base,
        title: `Upscale — ${stem.replace(/\.[^.]+$/, "")}`,
        kind: "image",
        engine: refine ? "Qwen Edit · Upscale2K" : "Real-ESRGAN x4+",
        detail: refine ? `refine · ~${payload.targetLongEdge}px long edge` : "fast · 4× · no new detail",
      };
    }
    case "tts":
      return {
        ...base,
        title: title(payload.text),
        kind: "tts",
        engine:
          payload.engine === "qwen"
            ? "Qwen3-TTS"
            : payload.engine === "dramabox"
              ? "DramaBox"
              : "Chatterbox",
        detail:
          payload.engine === "dramabox"
            ? `${cap(payload.voice)} · seed ${payload.seed ?? 42} · cfg ${payload.cfgScale ?? 2.5}`
            : `${cap(payload.voice)} · emotion ${payload.emotion.toFixed(2)}`,
      };
    case "voiceConvert":
      return {
        ...base,
        title: `Convert to ${cap(payload.voice)}`,
        // chained music conversions ship a song — file it on the music shelf
        kind: payload.context === "music" ? "music" : "tts",
        engine: payload.engine === "rvc" ? "RVC v2 · Replicate" : "Seed-VC",
        detail:
          payload.engine === "rvc"
            ? `${payload.mode === "sing" ? "singing" : "speech"}${
                payload.mode === "sing"
                  ? {
                      auto: " · pitch auto-match",
                      none: "",
                      "octave-down": " · octave down",
                      "octave-up": " · octave up",
                    }[payload.pitchMode ?? "auto"]
                  : ""
              } · trained voice model · cloud ${RVC_CONVERT_ESTIMATE}`
            : `${payload.mode === "sing" ? "singing" : "speech"} · ${payload.diffusionSteps} steps${
                payload.mode === "sing" && payload.semitoneShift !== 0
                  ? ` · ${payload.semitoneShift > 0 ? "+" : ""}${payload.semitoneShift} st`
                  : ""
              }`,
      };
    case "rvcTrain":
      return {
        ...base,
        title: `Train RVC voice — ${cap(payload.voice)}`,
        kind: "tts",
        engine: "RVC v2 · Replicate",
        detail: `48k · v2 · 50 epochs · cloud ${RVC_TRAIN_ESTIMATE}`,
      };
    case "music":
      return {
        ...base,
        title: title(payload.description),
        kind: "music",
        engine: "ACE-Step",
        detail: [
          `${payload.durationSec}s`,
          payload.duet ? "duet" : payload.arrangement,
          payload.bpm !== undefined ? `${payload.bpm} bpm` : "",
          payload.seed !== undefined ? `seed ${payload.seed}` : "",
          payload.styles.join(", "),
        ]
          .filter(Boolean)
          .join(" · "),
      };
    case "video": {
      const seedance = payload.engine === "seedance";
      return {
        ...base,
        title: title(payload.prompt),
        kind: "video",
        engine: seedance ? "Seedance" : "LTX-2.3",
        detail: `${payload.resolution} · ${payload.durationSec}s${payload.audio ? " · lip-sync" : ""}${
          seedance ? ` · ${seedanceEstimate(payload.durationSec, payload.resolution)}` : ""
        }`,
      };
    }
    default:
      throw new Error("not a lab payload");
  }
}
