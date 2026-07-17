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
  /** engine id from the image-lab catalog; both run on the managed engine
   * (krea2 through the GGUF loader nodes) or an external ComfyUI */
  model: z.string().default("z-image"),
  aspect: imageAspectSchema.default("3:2"),
  /** style preset name folded into the prompt by the adapter */
  preset: z.string().optional(),
  seed: z.number().int().optional(),
  /** images per run — each lands as its own asset */
  count: z.number().int().min(1).max(4).default(1),
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
