/* Lab catalogs + generate helpers. Catalogs describe what this machine can
 * actually run: rosters are scanned from disk (voice refs), availability from
 * the settings-store engine paths. Results never live here — a lab's takes
 * are its project assets plus its running jobs, both already served by the
 * library scanner and the job engine. */

import fs from "node:fs";
import path from "node:path";
import {
  FAL_SIZE_RULES,
  falImageEstimate,
  MAX_SHEET_REFS,
  OPEN_AIR_WARN_SEC,
  type EnqueueJobResolved,
  type JobPayload,
} from "@aurea/shared";
import type { SettingsStore } from "./settings.js";
import type { ModelManager } from "./models/manager.js";
import type { EngineRuntime } from "./runtime/runtime.js";
import type { ComfyService } from "./comfy/service.js";
import { probeVideoCapabilities, type VideoCapabilities } from "./comfy/capabilities.js";
import { seedanceEstimate } from "./adapters/seedance.js";
import { GPT_IMAGE_2_MAX_REFS } from "./adapters/fal-image.js";
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
  /** hidden from the rosters — the clip is still on disk and still speakable */
  hidden?: boolean;
}

/** <dataRoot>/voices/registry.json — display names and hidden ids. Ids stay
 * the filename forever (jobs, bible characters and shot specs reference them),
 * so a rename is an overlay, never a file move. */
interface VoiceRegistry {
  names: Record<string, string>;
  hidden: string[];
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
    private comfy: ComfyService,
  ) {}

  private vf(): string | null {
    return this.settings.get().paths.videofastDir;
  }

  imageCatalog() {
    const { engines, providers } = this.settings.get();
    const managed = engines.comfyMode === "managed";
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
        {
          id: "gpt-image-2",
          label: "GPT Image 2 · cloud",
          note: providers.falApiKey
            ? `text-to-image or up to ${GPT_IMAGE_2_MAX_REFS} references · paid per image`
            : "needs a fal.ai API key",
          // the one model on both tabs: fal routes a prompt-only run to
          // openai/gpt-image-2 and a referenced one to .../edit
          role: "both",
          // nothing to install — the render happens on fal's hardware
          available: !!providers.falApiKey,
        },
      ] satisfies (LabEngine & { role?: "generate" | "edit" | "both" })[],
      aspects: ["1:1", "3:2", "16:9", "4:3", "9:16"],
      presets: ["Cinematic", "Photographic", "Concept Art", "Minimal", "Moody", "Vintage", "Fantasy"],
      promptMax: 1000,
      /** outer bound across every model — the UI enforces refsMaxByModel */
      refsMax: GPT_IMAGE_2_MAX_REFS,
      /** what each edit model can actually encode. Local qwen-edit is stuck at
       * 3 because ComfyUI's TextEncodeQwenImageEditPlus only declares
       * image1..image3; the cloud model has no such ceiling. */
      refsMaxByModel: {
        "qwen-edit": 3,
        "gpt-image-2": GPT_IMAGE_2_MAX_REFS,
      } as Record<string, number>,
      /** models that bill per image — the UI shows an estimate before spend */
      cloudModels: ["gpt-image-2"],
      modelNotes: {
        "qwen-edit": "Renders on your GPU — $0.00 · 3 references max",
        "gpt-image-2": providers.falApiKey
          ? `Cloud render on your fal.ai account — ≈ $0.015/image at low quality, ≈ $0.22 at high`
          : "Add your fal.ai API key in Settings → AI Providers to enable",
      } as Record<string, string>,
      /** decks stay local: a 40-prompt run on a paid model is a $9 button, and
       * the deck adapter path is t2i-on-Comfy only */
      deckModels: ["z-image", "krea2"],
      countMax: 4,
      /** gpt-image-2 knobs; absent for the local graphs, which use steps/cfg */
      qualities: ["auto", "low", "medium", "high"],
      outputFormats: ["png", "jpeg", "webp"],
      /** models that can infer the output size from their references */
      autoSizeModels: ["gpt-image-2"],
      /** models that accept an inpainting mask alongside the references */
      maskModels: ["gpt-image-2"],
      advanced: {
        sizeMin: 512,
        sizeMax: 2048,
        sizeStep: 16,
        /** cloud renders aren't bounded by this GPU's VRAM — but they are
         * bounded by fal's own rules (max edge 3840, and a minimum total
         * pixel count, both enforced in falSizeError) */
        sizeMaxByModel: { "gpt-image-2": FAL_SIZE_RULES.maxEdge } as Record<string, number>,
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

  private voicesDir(): string {
    return path.join(this.settings.get().storage.dataRoot, "voices");
  }

  private readVoiceRegistry(): VoiceRegistry {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(this.voicesDir(), "registry.json"), "utf8"));
      return {
        names: raw && typeof raw.names === "object" ? raw.names : {},
        hidden: Array.isArray(raw?.hidden) ? raw.hidden.filter((x: unknown) => typeof x === "string") : [],
      };
    } catch {
      return { names: {}, hidden: [] };
    }
  }

  private writeVoiceRegistry(reg: VoiceRegistry): void {
    const dir = this.voicesDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "registry.json"), JSON.stringify(reg, null, 2));
  }

  /** every voice this machine knows, hidden ones included — what routing and
   * the /voiceref/ preview resolve against (hiding must never break a take
   * that already names the voice) */
  voiceRoster(): LabVoice[] {
    const { storage } = this.settings.get();
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
    const reg = this.readVoiceRegistry();
    return voices.map((v) => ({
      ...v,
      name: reg.names[v.id] ?? v.name,
      ...(reg.hidden.includes(v.id) ? { hidden: true } : {}),
    }));
  }

  /** cloned roster = every frozen reference clip in <dataRoot>/voices plus
   * videofast's char_refs (studio's own folder wins on id collisions) */
  voiceCatalog() {
    const { engines, providers } = this.settings.get();
    const roster = this.voiceRoster();
    const voices = roster.filter((v) => !v.hidden);
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
      /** hidden from the pickers, restorable from the Voice lab */
      hiddenVoices: roster.filter((v) => v.hidden),
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
    const entry = this.voiceRoster().find((v) => v.id === voice.toLowerCase());
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
    if (this.voiceRoster().some((v) => v.id === id)) {
      throw new Error(`a voice named "${id}" already exists`);
    }
    const dir = this.voicesDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.wav`), wav);
    // the id has to be slug-safe, the label doesn't — keep what was typed
    const label = name.trim().slice(0, 40);
    const reg = this.readVoiceRegistry();
    reg.hidden = reg.hidden.filter((h) => h !== id);
    if (label && label !== voiceName(id)) reg.names[id] = label;
    else delete reg.names[id];
    this.writeVoiceRegistry(reg);
    return {
      id,
      name: reg.names[id] ?? voiceName(id),
      kind: "cloned",
      engine: "Chatterbox",
      source: "studio",
    };
  }

  /** rename a voice for display only — the id stays the filename, so every
   * job, bible character and shot spec that references it keeps working */
  renameVoice(id: string, name: string): LabVoice {
    const voice = this.voiceRoster().find((v) => v.id === id.toLowerCase());
    if (!voice) throw new Error(`unknown voice "${id}"`);
    const label = name.trim().slice(0, 40);
    if (!label) throw new Error("voice name cannot be empty");
    const reg = this.readVoiceRegistry();
    if (label === voiceName(voice.id)) delete reg.names[voice.id];
    else reg.names[voice.id] = label;
    this.writeVoiceRegistry(reg);
    return { ...voice, name: label };
  }

  /** hide/restore a voice in the pickers. Non-studio clips (videofast's
   * char_refs) and presets aren't ours to delete, so hiding is how they leave
   * the roster — and it's reversible for studio voices too. */
  setVoiceHidden(id: string, hidden: boolean): void {
    const voice = this.voiceRoster().find((v) => v.id === id.toLowerCase());
    if (!voice) throw new Error(`unknown voice "${id}"`);
    const reg = this.readVoiceRegistry();
    reg.hidden = reg.hidden.filter((h) => h !== voice.id);
    if (hidden) reg.hidden.push(voice.id);
    this.writeVoiceRegistry(reg);
  }

  /** absolute path of a roster voice's reference clip — what the /voiceref/
   * preview route streams (cloned voices only; presets have no clip) */
  voiceRefPath(id: string): string | null {
    const v = this.voiceRoster().find(
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
   * aren't ours to delete — those hide instead (setVoiceHidden) */
  removeVoice(id: string): void {
    if (!VOICE_ID.test(id)) throw new Error(`invalid voice id "${id}"`);
    const { dataRoot } = this.settings.get().storage;
    const file = path.join(dataRoot, "voices", `${id}.wav`);
    if (!fs.existsSync(file)) {
      const voice = this.voiceRoster().find((v) => v.id === id);
      throw new Error(
        voice
          ? `"${voice.name}" isn't a studio voice — hide it instead of deleting it`
          : `"${id}" is not a studio voice`,
      );
    }
    fs.unlinkSync(file);
    // a trained RVC model outlives its clip otherwise, and a re-clone under the
    // same id would inherit a model trained on someone else's voice
    const rvc = rvcModelPath(dataRoot, id);
    if (fs.existsSync(rvc)) fs.unlinkSync(rvc);
    const reg = this.readVoiceRegistry();
    delete reg.names[id];
    reg.hidden = reg.hidden.filter((h) => h !== id);
    this.writeVoiceRegistry(reg);
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
          id: "minimax-h3",
          label: "MiniMax-H3",
          sub: "local · free",
          note: "Speaks and scores itself",
          // its own ComfyUI (0.30.0+) and its own weights — neither is implied
          // by the LTX pipeline being set up
          available: !!engines.minimaxUrl.trim() && this.models.ready("minimax-h3-gguf"),
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
        "minimax-h3": !engines.minimaxUrl.trim()
          ? "Needs a second ComfyUI on 0.30.0+ — set its URL in Settings → Engines"
          : !this.models.ready("minimax-h3-gguf")
            ? "Weights not installed — Settings → Models → MiniMax-H3 (GGUF)"
            : "Renders picture AND its dialogue/SFX/music in one pass — $0.00, but " +
              "roughly 10× LTX's render time. 4–15s, no voice takes, no Director timeline.",
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
      // Every side here MUST divide by 64, not 32. The x2 spatial upscaler runs
      // the base pass at half resolution, so 32 is the latent stride but 64 is
      // the pipeline's real constraint — ComfyUI silently floors anything else
      // and the take comes back a size nobody chose. Measured 2026-08-02: a
      // 608 × 1088 request rendered 576 × 1088 (608 = 64 × 9.5), which is how
      // this was found. Aurea never sees the snap, so a wrong preset here is
      // invisible until you ffprobe the output.
      //
      // 576 × 1088 was also not the 9:16 it claimed (0.529). 576 × 1024 is
      // exact 9:16, costs less (590k vs 627k px), and because the start frame
      // is centre-cropped to the render aspect, it keeps 98.4% of a 768 × 1344
      // keyframe's width where 576 × 1088 kept 92.6%. It is the only true 9:16
      // on the 64 grid at a sane cost — the next one up is 1152 × 2048, 4× the
      // pixels.
      //
      // The last two are MiniMax-H3's native canvas — a 768 short edge, which
      // is what it was trained on and what its own workflows ship. They are
      // also both multiples of 64, so they stay legal for LTX; the reverse
      // isn't a problem either, since H3 only needs multiples of 32 and every
      // preset above already is one.
      resolutions: [
        "704 × 896 (portrait)",
        "576 × 1024 (9:16 vertical)",
        "896 × 704 (landscape)",
        "1280 × 704 (16:9)",
        "1344 × 768 (16:9 · H3 native)",
        "768 × 1344 (9:16 · H3 native)",
      ],
      promptMax: 1000,
      tip: "The start frame anchors identity — generate it in the Image lab first, then describe the motion here.",
      /** The Shot Director surface, stated rather than discovered: what a spec
       * may hold (the schema's own ceilings) and the handful of rules that are
       * measured facts about LTX, not preferences. Whether this machine can
       * actually run a Director shot is a separate, live question —
       * labs.video.capabilities probes the node pack and the weights. */
      director: {
        limits: {
          keyframes: 24,
          promptZones: 12,
          audio: 12,
          refs: MAX_SHEET_REFS,
          durationSecMax: 30,
          fpsMax: 60,
          /** past this much open air between voice takes, LTX improvises */
          openAirWarnSec: OPEN_AIR_WARN_SEC,
        },
        rules: [
          "Every time is in seconds; the builder converts to frames and snaps the clip to LTX's 8n+1 rule.",
          "Prompt beats tile the shot in order from 0s — the first beat starts the take and the last one stretches to the end.",
          "A beat must NAME the character who speaks and say the others keep their mouths closed; that is what localises lip-sync when two characters share a frame.",
          `Keep open air between voice takes under ~${OPEN_AIR_WARN_SEC}s — LTX fills a longer gap with invented dialogue, not room tone (measured 2026-07-25).`,
          "Cast references and a motion reference share the single IC-LoRA slot: a shot can carry one or the other, never both.",
          "A retake re-renders one window of a finished take in place. It ignores keyframes, beats and the audio lane, takes its length/rate/size from the source, opens up to 8 frames early, and fixes artefacts rather than choreography.",
        ],
      },
      /** MiniMax-H3's control surface is the prompt and nothing else — there
       * is no timeline node, no audio lane, no IC-LoRA. Everything a caller
       * can steer, it steers by writing it down, so the shape of a good H3
       * prompt is part of the API rather than a style note. */
      minimax: {
        limits: {
          durationSecMin: 4,
          durationSecMax: 15,
          fps: 24,
          /** the canvas H3 was trained on; sides must be multiples of 32 */
          shortEdge: 768,
        },
        rules: [
          "Do NOT attach a voice take — H3 performs the dialogue itself. A take passed here is rejected, not mixed in.",
          "Write the prompt as labelled blocks: a look/mood line, then 'Timeline:' with [0s-2.5s] style beats, then 'Camera:', then 'Audio:'.",
          "The 'Audio:' block is the whole soundtrack — name the speaker and quote their line for dialogue, and describe the SFX and score in the same paragraph. Anything left unsaid, H3 invents.",
          "Length snaps up to the model's 17k+5 frame grid at 24fps (5s = 124 frames); the request is never rounded short.",
          "Both a first and a last frame are optional: none = text-to-video, first only = animate forward, both = the take must land on the last one.",
          "Roughly 10x LTX-2.3's render time for the same length on the same card — budget it as a hero shot, not a draft.",
        ],
      },
    };
  }

  /** Which LTX features the video engine can reach right now (Director
   * timeline, attention patches, multi-subject refs). Probed live against the
   * ComfyUI that videoMode points at — never boots one to find out. */
  videoCapabilities(): Promise<VideoCapabilities> {
    const mode = this.settings.get().engines.videoMode;
    return probeVideoCapabilities(this.comfy.idleUrl(mode), mode);
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
    case "image": {
      const cloud = payload.model === "gpt-image-2";
      return {
        ...base,
        title: title(payload.prompt),
        kind: "image",
        engine:
          payload.model === "z-image"
            ? "z-image-turbo"
            : payload.model === "qwen-edit"
              ? "Qwen Edit 2509"
              : cloud
                ? "GPT Image 2 · fal.ai"
                : "Krea 2",
        detail: [
          // an auto-sized cloud edit has no aspect of its own — it inherits
          // the references', so claiming one on the card would be a lie
          cloud && payload.sizeMode === "auto" ? "auto size" : payload.aspect,
          `${payload.count} image${payload.count === 1 ? "" : "s"}`,
          payload.refs.length
            ? `${payload.refs.length} ref${payload.refs.length === 1 ? "" : "s"}`
            : "",
          payload.mask ? "masked" : "",
          cloud ? payload.quality ?? "high" : "",
          payload.preset ?? "",
          cloud
            ? falImageEstimate(payload.quality, payload.count, payload.width, payload.height)
            : "",
        ]
          .filter(Boolean)
          .join(" · "),
      };
    }
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
      const minimax = payload.engine === "minimax-h3";
      const d = payload.director;
      // a Director shot is a timeline, so the rail says what's on it rather
      // than the single "lip-sync" flag the one-take path could get away with
      const voices = d ? d.audio.length : payload.audio ? 1 : 0;
      return {
        ...base,
        title: title(payload.prompt),
        kind: "video",
        engine: seedance ? "Seedance" : minimax ? "MiniMax-H3" : "LTX-2.3",
        detail: [
          payload.resolution,
          `${payload.durationSec}s`,
          d ? `Director · ${d.keyframes.length} keyframe${d.keyframes.length === 1 ? "" : "s"}` : "",
          d && d.promptZones.length ? `${d.promptZones.length} beats` : "",
          voices ? (d ? `${voices} voice${voices === 1 ? "" : "s"}` : "lip-sync") : "",
          seedance ? seedanceEstimate(payload.durationSec, payload.resolution) : "",
          // the reason to pick H3 is that the take arrives already scored —
          // worth saying on the card, since nothing else here produces sound
          minimax ? "native audio" : "",
        ]
          .filter(Boolean)
          .join(" · "),
      };
    }
    default:
      throw new Error("not a lab payload");
  }
}
