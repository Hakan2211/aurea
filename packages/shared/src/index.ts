/* Zod schemas shared by studiod (packages/core) and every client (desktop
 * renderer, CLI, MCP). These mirror the shapes the screens were built against
 * in apps/desktop/src/data/sample.ts — the renderer hooks keep their return
 * types when they swap from sample data to live queries. */

import { z } from "zod";

/* ---------- jobs ---------- */

export const jobStatusSchema = z.enum(["running", "queued", "completed", "failed"]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const jobKindSchema = z.enum(["video", "image", "tts", "music"]);
export type JobKind = z.infer<typeof jobKindSchema>;

export const jobPrioritySchema = z.enum(["interactive", "preview", "batch"]);
export type JobPriority = z.infer<typeof jobPrioritySchema>;

/** What an engine adapter needs to actually execute the job. Jobs without a
 * payload run on the simulated worker (UI demos, seed fixtures). Payloads
 * carry user intent — adapters map them onto engine flags and ignore knobs
 * their engine doesn't have. */
export const imageAspectSchema = z.enum(["1:1", "3:2", "16:9", "4:3", "9:16"]);
export type ImageAspect = z.infer<typeof imageAspectSchema>;

export const videofastPayloadSchema = z.object({
  type: z.literal("videofast"),
  /** account id — resolved to <videofastDir>/accounts/<id>.json */
  account: z.string().min(1),
  topic: z.string().min(1),
  seed: z.number().int().optional(),
  /** third topic-CSV cell: title hint, or attribution for the quote format */
  titleHint: z.string().optional(),
});

export const imagePayloadSchema = z.object({
  type: z.literal("image"),
  prompt: z.string().min(1),
  /** engine id from the image-lab catalog; all run on the managed engine
   * (krea2/qwen-edit through the GGUF loader nodes) or an external ComfyUI */
  model: z.string().default("z-image"),
  aspect: imageAspectSchema.default("3:2"),
  /** style preset name folded into the prompt by the adapter */
  preset: z.string().optional(),
  seed: z.number().int().optional(),
  /** images per run — each lands as its own asset */
  count: z.number().int().min(1).max(4).default(1),
  /** dataRoot-relative reference images (qwen-edit): subject first, then
   * scene/prop/style — the QIE multi-ref consistency stack */
  refs: z.array(z.string()).max(3).default([]),
  /** storyboard delivery: attach finished stills to this shot's keyframes */
  board: z.object({ shotId: z.string().min(1) }).optional(),
});

export const ttsPayloadSchema = z.object({
  type: z.literal("tts"),
  text: z.string().min(1),
  /** character/voice id from the voice-lab roster */
  voice: z.string().min(1),
  engine: z.string().default("chatterbox"),
  pace: z.number().min(0.5).max(1.5).default(1),
  emotion: z.number().min(0).max(1).default(0.65),
});

export const musicPayloadSchema = z.object({
  type: z.literal("music"),
  description: z.string().min(1),
  styles: z.array(z.string()).default([]),
  durationSec: z.number().int().min(5).max(180).default(30),
  arrangement: z.enum(["instrumental", "vocals"]).default("instrumental"),
  /** cloned character voice for sung vocals (arrangement === "vocals") */
  singVoice: z.string().optional(),
});

export const videoPayloadSchema = z.object({
  type: z.literal("video"),
  prompt: z.string().min(1),
  engine: z.string().default("ltx2"),
  /** start frame as a dataRoot-relative library path (i2v); required by LTX */
  startFrame: z.string().optional(),
  /** dialogue audio as a dataRoot-relative library path (switches to ia2v lip-sync) */
  audio: z.string().optional(),
  durationSec: z.number().min(1).max(15).default(5),
  /** "1280 × 720" style; adapter parses W/H */
  resolution: z.string().default("1280 × 720"),
  motionStrength: z.number().min(0).max(1).optional(),
  seed: z.number().int().optional(),
});

export const jobPayloadSchema = z.discriminatedUnion("type", [
  videofastPayloadSchema,
  imagePayloadSchema,
  ttsPayloadSchema,
  musicPayloadSchema,
  videoPayloadSchema,
  // declared below (timeline section) — z.lazy keeps the forward reference legal
  z.object({
    type: z.literal("export"),
    project: z.string().min(1),
    /** the sequence snapshot taken when the export was enqueued */
    timeline: z.lazy(() => timelineSchema),
  }),
]);
export type JobPayload = z.infer<typeof jobPayloadSchema>;

export const jobSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: jobKindSchema,
  engine: z.string(),
  status: jobStatusSchema,
  progress: z.number().min(0).max(100),
  stage: z.string().optional(),
  eta: z.string().optional(),
  priority: jobPrioritySchema,
  /** second line in the job table: resolution, counts, voice… */
  detail: z.string().optional(),
  /** project path shown under the title */
  project: z.string().optional(),
  elapsed: z.string().optional(),
  /** failure reason (status === "failed") */
  error: z.string().optional(),
  payload: jobPayloadSchema.optional(),
  /** where the finished artifact landed (adapter jobs, status === "completed") */
  output: z.string().optional(),
});
export type Job = z.infer<typeof jobSchema>;

export const enqueueJobSchema = z.object({
  title: z.string().min(1),
  kind: jobKindSchema,
  engine: z.string().min(1),
  priority: jobPrioritySchema.default("batch"),
  detail: z.string().optional(),
  project: z.string().optional(),
  payload: jobPayloadSchema.optional(),
});
export type EnqueueJob = z.input<typeof enqueueJobSchema>;
/** post-parse shape (defaults applied) — what JobEngine.enqueue actually takes */
export type EnqueueJobResolved = z.infer<typeof enqueueJobSchema>;

/* ---------- lab generate inputs ---------- */
/* Each lab's generate mutation takes its payload (minus the discriminant)
 * plus the project the artifact should land in. */

const projectField = { project: z.string().min(1) };

export const imageGenerateSchema = imagePayloadSchema.omit({ type: true }).extend(projectField);
export type ImageGenerate = z.input<typeof imageGenerateSchema>;

export const ttsGenerateSchema = ttsPayloadSchema.omit({ type: true }).extend(projectField);
export type TtsGenerate = z.input<typeof ttsGenerateSchema>;

export const musicGenerateSchema = musicPayloadSchema.omit({ type: true }).extend(projectField);
export type MusicGenerate = z.input<typeof musicGenerateSchema>;

export const videoGenerateSchema = videoPayloadSchema.omit({ type: true }).extend(projectField);
export type VideoGenerate = z.input<typeof videoGenerateSchema>;

/* ---------- voice cloning ---------- */

/** Freeze a reference clip as a named cloned voice. The renderer re-encodes
 * whatever the user uploaded or recorded into a PCM WAV before sending, so
 * studiod only ever stores canonical RIFF/WAVE files in <dataRoot>/voices/. */
export const voiceAddSchema = z.object({
  name: z.string().trim().min(1).max(40),
  /** base64 of the complete WAV file */
  wavBase64: z.string().min(100),
});
export type VoiceAdd = z.input<typeof voiceAddSchema>;

export const voiceRemoveSchema = z.object({ id: z.string().min(1) });

/* ---------- system ---------- */

export const vramSchema = z.object({
  /** GB actually in use */
  used: z.number(),
  /** GB reserved/allocated by processes (>= used) */
  allocated: z.number(),
  /** GB on the card */
  total: z.number(),
});
export type Vram = z.infer<typeof vramSchema>;

export const systemInfoSchema = z.object({
  gpu: z.string(),
  driver: z.string(),
  cudaCores: z.string(),
  vram: z.string(),
  ram: z.string(),
  storage: z.string(),
  tempC: z.number(),
  queuePaused: z.boolean(),
});
export type SystemInfo = z.infer<typeof systemInfoSchema>;

export const preflightSchema = z.object({
  message: z.string(),
  after: z.string(),
});
export type Preflight = z.infer<typeof preflightSchema>;

/* ---------- settings ---------- */

/** Persisted studio configuration (~/.aurea/settings.json). Anything that was
 * a hardcoded path in the P0 skeleton lives here instead. */
export const settingsSchema = z.object({
  version: z.literal(1).default(1),
  storage: z.object({
    /** projects/assets/cache root; storage telemetry measures this volume */
    dataRoot: z.string().min(1),
  }),
  paths: z.object({
    /** videofast repo root — drives the first engine adapter; null until detected/set */
    videofastDir: z.string().nullable().default(null),
  }),
  /** Where the local generation engines live — detected on boot from the
   * machine's known install conventions, editable like every other path.
   * null = not found, the matching lab reports the engine unavailable. */
  engines: z
    .object({
      /** "managed" = studiod spawns its own headless ComfyUI from
       * <dataRoot>/runtime/; "external" = talk to comfyUrl (the escape hatch
       * for machines that already run ComfyUI Desktop or a custom install) */
      comfyMode: z.enum(["managed", "external"]).default("managed"),
      /** ComfyUI HTTP API when comfyMode is "external" */
      comfyUrl: z.string().default("http://127.0.0.1:8000"),
      /** "managed" = character voices run in the runtime's own Chatterbox
       * venv with model-manager weights; "external" = spawn chatterboxPython
       * against the videofast scripts (narrator/qwen voices are always
       * external — no managed build yet) */
      ttsMode: z.enum(["managed", "external"]).default("managed"),
      /** "managed" = music runs in the runtime's own ACE-Step venv (pinned
       * source checkout + model-manager checkpoints); "external" = spawn the
       * acestepDir checkout's own venv against the videofast CLI */
      musicMode: z.enum(["managed", "external"]).default("managed"),
      /** "managed" = LTX-2.3 renders on the managed ComfyUI with model-manager
       * weights (a ~42 GB gated download, so this is the only mode defaulting
       * to external); "external" = queue on comfyUrl, whose install already
       * has the LTX weights under their conventional names */
      videoMode: z.enum(["managed", "external"]).default("external"),
      /** python.exe of the Chatterbox TTS venv (character voices) */
      chatterboxPython: z.string().nullable().default(null),
      /** python.exe of the Qwen3-TTS venv (narrator voices) */
      qwenTtsPython: z.string().nullable().default(null),
      /** ACE-Step 1.5 checkout (its .venv/Scripts/python.exe runs music gen) */
      acestepDir: z.string().nullable().default(null),
    })
    .default({}),
  providers: z.object({
    default: z.enum(["claude", "openrouter", "ollama"]).default("claude"),
    /** Claude Code model alias the Director runs on (resolved by the local CLI) */
    claudeModel: z.enum(["sonnet", "opus", "haiku"]).default("sonnet"),
    openrouterApiKey: z.string().default(""),
    /** fal.ai key — unlocks the Seedance cloud video engine (paid per clip) */
    falApiKey: z.string().default(""),
    ollamaBaseUrl: z.string().default("http://localhost:11434"),
    ollamaModel: z.string().default("llama3.1:8b-instruct-q4_K_M"),
  }),
  general: z.object({
    launchAtLogin: z.boolean().default(false),
    hardwareAcceleration: z.boolean().default(true),
    keepInTray: z.boolean().default(true),
    telemetry: z.boolean().default(false),
    /** first-run wizard completed (or skipped) — the renderer stops showing it */
    onboarded: z.boolean().default(false),
  }),
  advanced: z.object({
    prereleaseEngines: z.boolean().default(false),
    verboseJobLogs: z.boolean().default(false),
    keepModelsWarm: z.boolean().default(false),
  }),
});
export type Settings = z.infer<typeof settingsSchema>;

/** Partial update — every section optional, every field within it optional. */
export const settingsUpdateSchema = z.object({
  storage: settingsSchema.shape.storage.partial().optional(),
  paths: settingsSchema.shape.paths.partial().optional(),
  engines: settingsSchema.shape.engines.removeDefault().partial().optional(),
  providers: settingsSchema.shape.providers.partial().optional(),
  general: settingsSchema.shape.general.partial().optional(),
  advanced: settingsSchema.shape.advanced.partial().optional(),
});
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

/** Live disk figures for the volume holding storage.dataRoot (null = unknown). */
export const storageStatsSchema = z.object({
  root: z.string(),
  freeGb: z.number().nullable(),
  totalGb: z.number().nullable(),
});
export type StorageStats = z.infer<typeof storageStatsSchema>;

/* ---------- projects ---------- */

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** subtitle in the switcher — computed by the store ("3 assets · Jul 14") */
  meta: z.string(),
  createdAt: z.string(),
});
export type Project = z.infer<typeof projectSchema>;

export const projectCreateSchema = z.object({ name: z.string().trim().min(1) });
export const projectRenameSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
});

/* ---------- asset library ---------- */

export const libraryKindSchema = z.enum(["image", "video", "audio", "music", "model3d"]);
export type LibraryKind = z.infer<typeof libraryKindSchema>;

/* ---------- timeline (OTIO-shaped, exporter later) ---------- */

/** One clip on a track. All times are seconds; `asset` is a library relPath. */
export const timelineClipSchema = z.object({
  id: z.string(),
  asset: z.string(),
  /** display label (defaults to the asset file name) */
  label: z.string().default(""),
  /** where on the timeline the clip starts */
  start: z.number().min(0),
  /** trim into the source media */
  in: z.number().min(0).default(0),
  /** clip length on the timeline */
  duration: z.number().positive(),
  /** crossfade INTO this clip from the previous clip on the same track */
  transitionSec: z.number().min(0).default(0),
});
export type TimelineClip = z.infer<typeof timelineClipSchema>;

export const timelineTrackKindSchema = z.enum(["video", "voice", "music", "sfx"]);
export type TimelineTrackKind = z.infer<typeof timelineTrackKindSchema>;

export const timelineTrackSchema = z.object({
  id: z.string(),
  kind: timelineTrackKindSchema,
  name: z.string(),
  muted: z.boolean().default(false),
  clips: z.array(timelineClipSchema).default([]),
});
export type TimelineTrack = z.infer<typeof timelineTrackSchema>;

/** The whole sequence for one project — <dataRoot>/projects/<id>/timeline.json */
export const timelineSchema = z.object({
  version: z.literal(1).default(1),
  fps: z.number().default(24),
  width: z.number().default(1280),
  height: z.number().default(720),
  tracks: z.array(timelineTrackSchema).default([]),
});
export type Timeline = z.infer<typeof timelineSchema>;

export const timelineUpdateSchema = z.object({
  project: z.string().min(1),
  timeline: timelineSchema,
});

/* Granular clip operations — the server-side edit surface used by the
 * Director's timeline_* tools (the desktop editor keeps whole-document saves).
 * addClip probes the media's real duration with ffprobe when none is given. */

export const timelineAddClipSchema = z.object({
  project: z.string().min(1),
  /** library relPath of the media to place */
  asset: z.string().min(1),
  /** target track kind; defaults from the asset kind (video/image → video, audio → voice, music → music) */
  track: timelineTrackKindSchema.optional(),
  /** nth track of that kind (0 = base layer; later video tracks composite on top).
   * One past the end creates the track ("Video 2"). Default 0. */
  trackIndex: z.number().int().min(0).optional(),
  /** timeline start in seconds; defaults to the end of the target track */
  start: z.number().min(0).optional(),
  in: z.number().min(0).default(0),
  /** seconds; defaults to the probed media duration (images: 4s) */
  duration: z.number().positive().optional(),
  transitionSec: z.number().min(0).default(0),
  label: z.string().optional(),
});
export type TimelineAddClip = z.input<typeof timelineAddClipSchema>;

export const timelineClipPatchSchema = z.object({
  start: z.number().min(0).optional(),
  in: z.number().min(0).optional(),
  duration: z.number().positive().optional(),
  transitionSec: z.number().min(0).optional(),
  label: z.string().optional(),
});

export const timelineUpdateClipSchema = z.object({
  project: z.string().min(1),
  clip: z.string().min(1),
  patch: timelineClipPatchSchema,
});

export const timelineRemoveClipSchema = z.object({
  project: z.string().min(1),
  clip: z.string().min(1),
});

export const timelineExportSchema = z.object({ project: z.string().min(1) });

/** One real file inside a project's assets/ tree, as scanned by studiod. */
export const libraryAssetSchema = z.object({
  /** stable identity — the dataRoot-relative path */
  id: z.string(),
  kind: libraryKindSchema,
  name: z.string(),
  project: z.string(),
  projectName: z.string(),
  /** posix-style path relative to storage.dataRoot */
  relPath: z.string(),
  /** studiod media route ("/media/<escaped relPath>") — client adds host + token */
  url: z.string(),
  sizeBytes: z.number(),
  createdAt: z.string(),
  /** lowercase extension without the dot */
  ext: z.string(),
});
export type LibraryAsset = z.infer<typeof libraryAssetSchema>;

/* ---------- production (Studio data spine) ---------- */
/* The V2 Studio hierarchy — Production → Season → Episode → Scene → Shot —
 * persisted whole as <dataRoot>/projects/<id>/production.json (project =
 * production; the folder-is-the-database rule applies unchanged). A Shot is
 * the atomic production unit and already carries the slots later S-P1/S-P2
 * steps fill in: script lines (writers room), camera spec + keyframes
 * (storyboard), video/VO takes + lipsync (shot generation). */

export const shotStatusSchema = z.enum([
  "draft",
  "boarded",
  "generated",
  "synced",
  "approved",
]);
export type ShotStatus = z.infer<typeof shotStatusSchema>;

/** Free-text this step; storyboard later swaps these to structured refs into
 * the cinematography bible's banks ("MS", "low angle", "sitcom lighting"). */
export const cameraSpecSchema = z.object({
  shotSize: z.string().default(""),
  angle: z.string().default(""),
  move: z.string().default(""),
  lens: z.string().default(""),
  lighting: z.string().default(""),
  notes: z.string().default(""),
});
export type CameraSpec = z.infer<typeof cameraSpecSchema>;

export const scriptLineSchema = z.object({
  id: z.string(),
  /** bible character id; null = action/stage direction line */
  character: z.string().nullable().default(null),
  text: z.string().default(""),
  /** per-line VO direction ("more sarcastic") */
  deliveryNotes: z.string().default(""),
});
export type ScriptLine = z.infer<typeof scriptLineSchema>;

export const shotKeyframeSchema = z.object({
  id: z.string(),
  /** library relPath of the still */
  asset: z.string(),
  approved: z.boolean().default(false),
});
export type ShotKeyframe = z.infer<typeof shotKeyframeSchema>;

export const shotTakeSchema = z.object({
  id: z.string(),
  /** library relPath of the rendered clip */
  asset: z.string(),
  /** engine that produced it ("ltx2", "seedance", "chatterbox") */
  engine: z.string().default(""),
  label: z.string().default(""),
});
export type ShotTake = z.infer<typeof shotTakeSchema>;

export const shotSchema = z.object({
  id: z.string(),
  title: z.string().default(""),
  scriptLines: z.array(scriptLineSchema).default([]),
  /** bible character ids present in the shot */
  characters: z.array(z.string()).default([]),
  /** bible location id */
  location: z.string().nullable().default(null),
  camera: cameraSpecSchema.default({}),
  keyframes: z.array(shotKeyframeSchema).default([]),
  selectedKeyframe: z.string().nullable().default(null),
  videoTakes: z.array(shotTakeSchema).default([]),
  voTakes: z.array(shotTakeSchema).default([]),
  selectedTake: z.string().nullable().default(null),
  /** library relPath of the lip-synced result (S-P2) */
  lipsync: z.string().nullable().default(null),
  status: shotStatusSchema.default("draft"),
  notes: z.string().default(""),
});
export type Shot = z.infer<typeof shotSchema>;

export const sceneSchema = z.object({
  id: z.string(),
  /** screenplay slugline ("INT. THE LOFT — NIGHT") */
  slugline: z.string(),
  summary: z.string().default(""),
  /** bible location id */
  location: z.string().nullable().default(null),
  shots: z.array(shotSchema).default([]),
});
export type Scene = z.infer<typeof sceneSchema>;

export const episodeSchema = z.object({
  id: z.string(),
  number: z.number().int().min(1),
  title: z.string(),
  logline: z.string().default(""),
  synopsis: z.string().default(""),
  scenes: z.array(sceneSchema).default([]),
});
export type Episode = z.infer<typeof episodeSchema>;

export const seasonSchema = z.object({
  id: z.string(),
  number: z.number().int().min(1),
  title: z.string().default(""),
  episodes: z.array(episodeSchema).default([]),
});
export type Season = z.infer<typeof seasonSchema>;

/** The whole show for one project — <dataRoot>/projects/<id>/production.json */
export const productionSchema = z.object({
  version: z.literal(1).default(1),
  title: z.string(),
  logline: z.string().default(""),
  /** "series" | "film" | free-form — display only for now */
  format: z.string().default("series"),
  seasons: z.array(seasonSchema).default([]),
  updatedAt: z.string().default(""),
});
export type Production = z.infer<typeof productionSchema>;

export const productionGetSchema = z.object({ project: z.string().min(1) });

export const productionUpdateSchema = z.object({
  project: z.string().min(1),
  production: productionSchema,
});

export const productionAddEpisodeSchema = z.object({
  project: z.string().min(1),
  /** season to add to (created if missing); defaults to 1 */
  seasonNumber: z.number().int().min(1).default(1),
  title: z.string().trim().min(1),
  logline: z.string().default(""),
});
export type ProductionAddEpisode = z.input<typeof productionAddEpisodeSchema>;

export const productionAddSceneSchema = z.object({
  project: z.string().min(1),
  episodeId: z.string().min(1),
  slugline: z.string().trim().min(1),
  summary: z.string().default(""),
  location: z.string().nullable().default(null),
});
export type ProductionAddScene = z.input<typeof productionAddSceneSchema>;

export const productionAddShotSchema = z.object({
  project: z.string().min(1),
  sceneId: z.string().min(1),
  title: z.string().default(""),
  scriptLines: z.array(scriptLineSchema).default([]),
  characters: z.array(z.string()).default([]),
  location: z.string().nullable().default(null),
  camera: cameraSpecSchema.default({}),
});
export type ProductionAddShot = z.input<typeof productionAddShotSchema>;

export const episodePatchSchema = episodeSchema
  .omit({ id: true, number: true, scenes: true })
  .partial();
export const productionUpdateEpisodeSchema = z.object({
  project: z.string().min(1),
  episodeId: z.string().min(1),
  patch: episodePatchSchema,
});

export const scenePatchSchema = sceneSchema.omit({ id: true, shots: true }).partial();
export const productionUpdateSceneSchema = z.object({
  project: z.string().min(1),
  sceneId: z.string().min(1),
  patch: scenePatchSchema,
});

export const shotPatchSchema = shotSchema.omit({ id: true }).partial();
export const productionUpdateShotSchema = z.object({
  project: z.string().min(1),
  shotId: z.string().min(1),
  patch: shotPatchSchema,
});

export const productionRemoveNodeSchema = z.object({
  project: z.string().min(1),
  id: z.string().min(1),
});

/** storyboard: enqueue keyframe generation for one shot. Prompt defaults to
 * the composed shot prompt (composeKeyframePrompt) — pass one to override. */
export const storyboardGenerateSchema = z.object({
  project: z.string().min(1),
  shotId: z.string().min(1),
  prompt: z.string().optional(),
  aspect: imageAspectSchema.default("16:9"),
  seed: z.number().int().optional(),
  /** takes per run — each lands as its own keyframe on the shot */
  count: z.number().int().min(1).max(4).default(1),
});
export type StoryboardGenerate = z.input<typeof storyboardGenerateSchema>;

/** studio.onUpdate payload — which document changed for which project, so
 * open screens can converge on Director/MCP edits without polling */
export const studioUpdateEventSchema = z.object({
  project: z.string(),
  doc: z.enum(["production", "bible"]),
});
export type StudioUpdateEvent = z.infer<typeof studioUpdateEventSchema>;

/* ---------- bible (persistent cast & world memory) ---------- */
/* What makes episode 12 look and sound like episode 1 — persisted as
 * <dataRoot>/projects/<id>/bible.json. Reference images are library relPaths
 * (copied into the project's assets tree, so /media serves them and the
 * scanner sees them); voices bind to the voice-lab roster by id. */

export const bibleVoiceSchema = z.object({
  /** voice-lab roster id (cloned ref clip); null = not cast yet */
  voiceId: z.string().nullable().default(null),
  engine: z.string().default("chatterbox"),
  /** Chatterbox expressiveness knob per character (bake-off tuning) */
  exaggeration: z.number().min(0).max(1).default(0.5),
  cfgWeight: z.number().min(0).max(1).default(0.4),
  deliveryNotes: z.string().default(""),
});
export type BibleVoice = z.infer<typeof bibleVoiceSchema>;

export const bibleRefsSchema = z.object({
  /** all library relPaths */
  /** the designated storyboard reference — what qwen-edit gets as the subject
   * image when boarding a shot with this character (GPT hero frame ideally) */
  keyframeRef: z.string().nullable().default(null),
  turnaround: z.string().nullable().default(null),
  hero: z.string().nullable().default(null),
  /** composite contact sheet from the char-sheet pipeline */
  sheet: z.string().nullable().default(null),
  /** single-view frames (S1 front … S9 anchor) */
  frames: z.array(z.string()).default([]),
  /** LoRA training set */
  dataset: z.array(z.string()).default([]),
  custom: z.array(z.string()).default([]),
});
export type BibleRefs = z.infer<typeof bibleRefsSchema>;

export const bibleCharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
  species: z.string().default(""),
  /** structured appearance slots (character-sheets-v2 fill values) */
  build: z.string().default(""),
  face: z.string().default(""),
  wardrobe: z.string().default(""),
  props: z.string().default(""),
  colors: z.string().default(""),
  signatureFeature: z.string().default(""),
  /** identity-anchor macros — the scars/marks that lock identity across shots */
  anchors: z
    .object({
      body: z.string().default(""),
      face: z.string().default(""),
      macro: z.string().default(""),
    })
    .default({}),
  personality: z.string().default(""),
  speechPattern: z.string().default(""),
  /** canonical image-gen seed from the char spec */
  seed: z.number().int().optional(),
  voice: bibleVoiceSchema.default({}),
  refs: bibleRefsSchema.default({}),
  /** trained character LoRA (S-P2) — null until trained/imported */
  lora: z
    .object({ asset: z.string().default(""), trigger: z.string().default("") })
    .nullable()
    .default(null),
});
export type BibleCharacter = z.infer<typeof bibleCharacterSchema>;

export const bibleLocationSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(""),
  /** paste-in prompt block for keyframe generation */
  stylePrompt: z.string().default(""),
  /** library relPaths of reference stills */
  refs: z.array(z.string()).default([]),
});
export type BibleLocation = z.infer<typeof bibleLocationSchema>;

export const bibleStyleSchema = z.object({
  artDirection: z.string().default(""),
  negativePrompt: z.string().default(""),
  cinematographyNotes: z.string().default(""),
  notes: z.string().default(""),
});
export type BibleStyle = z.infer<typeof bibleStyleSchema>;

/* ---------- cinematography bank (doc 26 as structured data) ---------- */
/* The director's language — shot sizes, camera moves, lighting banks,
 * composition — imported into the bible so shot specs can reference entries
 * by id ("ws", "sitcom.warm-home") and prompts expand to the full paste-in
 * clause. Camera-spec fields stay strings: a value that matches an entry id
 * or name resolves to its clause; anything else passes through as free text. */

export const cineClauseSchema = z.object({
  /** short stable slug referenced from camera specs ("ws", "push-in") */
  id: z.string(),
  name: z.string(),
  /** the paste-in prompt clause this entry expands to */
  clause: z.string().default(""),
  /** when/why to use it — shown in pickers and fed to the director agent */
  use: z.string().default(""),
});
export type CineClause = z.infer<typeof cineClauseSchema>;

export const cineLightingBankSchema = z.object({
  /** bank slug — entries resolve as "<bank>.<entry>" ("concert.follow-spot") */
  id: z.string(),
  name: z.string(),
  use: z.string().default(""),
  entries: z.array(cineClauseSchema).default([]),
});
export type CineLightingBank = z.infer<typeof cineLightingBankSchema>;

/** Per-dancer signature camera — "the camera dances their style too". */
export const cineDanceSignatureSchema = z.object({
  /** bible character name (matched case-insensitively; ids differ per seed) */
  character: z.string(),
  danceStyle: z.string().default(""),
  camera: z.string().default(""),
  clause: z.string().default(""),
});
export type CineDanceSignature = z.infer<typeof cineDanceSignatureSchema>;

/** Master prompt formulas (doc 26 §10.1) — S-P2 shot generation consumes
 * ltxCoverage/transitionMorph/seedanceHero; keyframe documents the still side. */
export const cineTemplatesSchema = z.object({
  keyframe: z.string().default(""),
  ltxCoverage: z.string().default(""),
  transitionMorph: z.string().default(""),
  seedanceHero: z.string().default(""),
});
export type CineTemplates = z.infer<typeof cineTemplatesSchema>;

export const bibleCinematographySchema = z.object({
  shotSizes: z.array(cineClauseSchema).default([]),
  angles: z.array(cineClauseSchema).default([]),
  moves: z.array(cineClauseSchema).default([]),
  lenses: z.array(cineClauseSchema).default([]),
  compositions: z.array(cineClauseSchema).default([]),
  lighting: z.array(cineLightingBankSchema).default([]),
  danceSignatures: z.array(cineDanceSignatureSchema).default([]),
  /** full-crew dance shots (overhead kaleidoscope, formation wide, finale crane) */
  formations: z.array(cineClauseSchema).default([]),
  templates: cineTemplatesSchema.default({}),
  /** grammar digest for the director agent (one move per clip, i2v agrees
   * with the still, dance never tighter than WS, …) */
  rules: z.string().default(""),
  negativePrompt: z.string().default(""),
});
export type BibleCinematography = z.infer<typeof bibleCinematographySchema>;

export const bibleSchema = z.object({
  version: z.literal(1).default(1),
  characters: z.array(bibleCharacterSchema).default([]),
  locations: z.array(bibleLocationSchema).default([]),
  style: bibleStyleSchema.default({}),
  cinematography: bibleCinematographySchema.default({}),
  updatedAt: z.string().default(""),
});
export type Bible = z.infer<typeof bibleSchema>;

export const bibleGetSchema = z.object({ project: z.string().min(1) });

export const bibleUpdateSchema = z.object({
  project: z.string().min(1),
  bible: bibleSchema,
});

export const bibleUpsertCharacterSchema = z.object({
  project: z.string().min(1),
  character: bibleCharacterSchema,
});
export type BibleUpsertCharacter = z.input<typeof bibleUpsertCharacterSchema>;

export const bibleRemoveCharacterSchema = z.object({
  project: z.string().min(1),
  id: z.string().min(1),
});

export const bibleUpsertLocationSchema = z.object({
  project: z.string().min(1),
  location: bibleLocationSchema,
});
export type BibleUpsertLocation = z.input<typeof bibleUpsertLocationSchema>;

export const bibleRemoveLocationSchema = z.object({
  project: z.string().min(1),
  id: z.string().min(1),
});

export const bibleUpdateStyleSchema = z.object({
  project: z.string().min(1),
  style: bibleStyleSchema,
});

/** Import/replace the cinematography bank (empty = curated doc-26 bank). */
export const bibleImportCinematographySchema = z.object({
  project: z.string().min(1),
  cinematography: bibleCinematographySchema.optional(),
});
export type BibleImportCinematography = z.input<typeof bibleImportCinematographySchema>;

/** Seed the Animal Sitcom bible from the videofast repo (paths.videofastDir):
 * six structured characters, reference images + voice ref clips copied in. */
export const studioSeedSchema = z.object({
  project: z.string().min(1),
  /** replace existing characters/locations with the seed versions */
  overwrite: z.boolean().default(false),
});
export type StudioSeed = z.input<typeof studioSeedSchema>;

export const studioSeedResultSchema = z.object({
  bible: bibleSchema,
  production: productionSchema,
  copiedFiles: z.number(),
  warnings: z.array(z.string()),
});
export type StudioSeedResult = z.infer<typeof studioSeedResultSchema>;

/* ---------- director chat ---------- */

/** A library asset the user pinned to a message. relPath is the id the studio
 * tools understand (generate_video startFrame/audio take it directly); images
 * are additionally shown to the Director as real image content. */
export const directorAttachmentSchema = z.object({
  kind: libraryKindSchema,
  name: z.string(),
  /** posix-style path relative to storage.dataRoot — the library asset id */
  relPath: z.string(),
});
export type DirectorAttachment = z.infer<typeof directorAttachmentSchema>;

/** One tool call the Director made mid-conversation, rendered as a card. */
export const directorToolCallSchema = z.object({
  /** tool name without the mcp__aurea__ prefix (e.g. "generate_image") */
  name: z.string(),
  /** compact one-line rendering of the tool input */
  summary: z.string(),
  status: z.enum(["running", "done", "error"]),
  /** set when the tool enqueued a job — the UI attaches live progress from the jobs stream */
  jobId: z.string().optional(),
});
export type DirectorToolCall = z.infer<typeof directorToolCallSchema>;

export const directorMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "director"]),
  /** ISO timestamp */
  at: z.string(),
  text: z.string().optional(),
  /** assets the user pinned to this message (user role only) */
  attachments: z.array(directorAttachmentSchema).optional(),
  tool: directorToolCallSchema.optional(),
  /** transient — this text is still arriving token by token; never true on disk */
  streaming: z.boolean().optional(),
});
export type DirectorMessage = z.infer<typeof directorMessageSchema>;

/** The whole chat thread for one project, as streamed to the renderer. */
export const directorStateSchema = z.object({
  project: z.string(),
  /** thinking = a Claude run is in flight; the composer disables itself */
  status: z.enum(["idle", "thinking"]),
  messages: z.array(directorMessageSchema),
});
export type DirectorState = z.infer<typeof directorStateSchema>;

export const directorSendSchema = z.object({
  project: z.string().min(1),
  text: z.string().trim().min(1),
  attachments: z.array(directorAttachmentSchema).max(8).default([]),
});

/** On-disk shape — <dataRoot>/projects/<id>/director.json */
export const directorChatFileSchema = z.object({
  /** Claude Code session id for resume-based conversation continuity */
  sessionId: z.string().nullable().default(null),
  messages: z.array(directorMessageSchema).default([]),
});
export type DirectorChatFile = z.infer<typeof directorChatFileSchema>;

/* ---------- model manager ---------- */

/** which lab a model powers ("utility" = pipeline stages like upscaling) */
export const modelUseSchema = z.enum(["image", "video", "voice", "music", "utility"]);
export type ModelUse = z.infer<typeof modelUseSchema>;

/** One file of a model, downloaded to <dataRoot>/models/<modelId>/<name>. */
export const modelFileSchema = z.object({
  /** path relative to the model's folder */
  name: z.string(),
  url: z.string(),
  sizeBytes: z.number(),
  /** hex sha256 of the complete file (from the publisher's LFS metadata);
   * null for tiny non-LFS files — those install unverified */
  sha256: z.string().nullable(),
  /** the engine rewrites this file in place after install (e.g. ACE-Step
   * syncs its remote-code .py files into the checkpoint dir) — installed
   * means it exists, not that it still matches size/sha */
  mutable: z.boolean().optional(),
});
export type ModelFile = z.infer<typeof modelFileSchema>;

export const modelLicenseSchema = z.object({
  name: z.string(),
  url: z.string(),
  /** true = the user must explicitly accept before the download can start */
  gated: z.boolean(),
});

/** Registry entry — the curated catalog studiod ships with. */
export const modelInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  use: modelUseSchema,
  /** which engine consumes it (display only) */
  engine: z.string(),
  description: z.string(),
  /** sum of files[].sizeBytes, precomputed for display */
  sizeBytes: z.number(),
  files: z.array(modelFileSchema),
  license: modelLicenseSchema,
  /** the first-run wizard preselects these */
  essential: z.boolean(),
});
export type ModelInfo = z.infer<typeof modelInfoSchema>;

export const modelStateSchema = z.enum([
  "absent",
  "downloading",
  "verifying",
  "installed",
  "error",
]);
export type ModelState = z.infer<typeof modelStateSchema>;

/** Live install status. "absent" with bytes > 0 = a paused/partial download
 * that the next download() call resumes where it stopped. */
export const modelStatusSchema = z.object({
  state: modelStateSchema,
  /** bytes on disk so far, across finished files and .part files */
  bytes: z.number(),
  progress: z.number().min(0).max(100),
  /** live transfer rate; null unless downloading */
  bytesPerSec: z.number().nullable(),
  /** file currently transferring (downloading/verifying) */
  file: z.string().nullable(),
  error: z.string().nullable(),
  licenseAccepted: z.boolean(),
});
export type ModelStatus = z.infer<typeof modelStatusSchema>;

export const modelEntrySchema = modelInfoSchema.extend({ status: modelStatusSchema });
export type ModelEntry = z.infer<typeof modelEntrySchema>;

export const modelDownloadSchema = z.object({
  id: z.string().min(1),
  /** records acceptance of a gated license before starting */
  acceptLicense: z.boolean().default(false),
});

/* ---------- engine runtime ---------- */

/** The managed pieces under <dataRoot>/runtime/: a portable CPython, a
 * headless ComfyUI checkout with its own venv, one venv per Python engine
 * ("chatterbox" and "acestep" so far), and pinned ComfyUI custom-node packs
 * ("gguf" = ComfyUI-GGUF quantized loaders). */
export const runtimeComponentIdSchema = z.enum(["python", "comfy", "gguf", "chatterbox", "acestep"]);
export type RuntimeComponentId = z.infer<typeof runtimeComponentIdSchema>;

export const runtimeComponentStateSchema = z.enum(["absent", "installing", "ready", "error"]);

export const runtimeComponentSchema = z.object({
  id: runtimeComponentIdSchema,
  name: z.string(),
  state: runtimeComponentStateSchema,
  /** pinned upstream version this studiod installs (display) */
  pinned: z.string(),
  /** installed version; null until ready */
  version: z.string().nullable(),
  /** 0–100 within this component's install */
  progress: z.number(),
  stage: z.string().nullable(),
  /** live sub-line under the stage (current package, bytes moved, …) */
  detail: z.string().nullable(),
  error: z.string().nullable(),
});
export type RuntimeComponent = z.infer<typeof runtimeComponentSchema>;

export const runtimeStatusSchema = z.object({
  /** every component ready — managed ComfyUI can be spawned */
  ready: z.boolean(),
  installing: z.boolean(),
  components: z.array(runtimeComponentSchema),
});
export type RuntimeStatus = z.infer<typeof runtimeStatusSchema>;

/* ---------- studiod discovery ---------- */

/** Contents of ~/.aurea/studiod.json — how shells and CLIs find a running core. */
export const portFileSchema = z.object({
  port: z.number().int(),
  token: z.string(),
  pid: z.number().int(),
});
export type PortFile = z.infer<typeof portFileSchema>;

export * from "./storyboard.js";
export * from "./cinematographyBank.js";
