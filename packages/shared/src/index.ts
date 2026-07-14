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
 * payload run on the simulated worker (UI demos, seed fixtures). */
export const jobPayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("videofast"),
    /** account id — resolved to <videofastDir>/accounts/<id>.json */
    account: z.string().min(1),
    topic: z.string().min(1),
    seed: z.number().int().optional(),
    /** third topic-CSV cell: title hint, or attribution for the quote format */
    titleHint: z.string().optional(),
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
  providers: z.object({
    default: z.enum(["claude", "openrouter", "ollama"]).default("claude"),
    openrouterApiKey: z.string().default(""),
    ollamaBaseUrl: z.string().default("http://localhost:11434"),
    ollamaModel: z.string().default("llama3.1:8b-instruct-q4_K_M"),
  }),
  general: z.object({
    launchAtLogin: z.boolean().default(false),
    hardwareAcceleration: z.boolean().default(true),
    keepInTray: z.boolean().default(true),
    telemetry: z.boolean().default(false),
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
  meta: z.string(),
});
export type Project = z.infer<typeof projectSchema>;

/* ---------- studiod discovery ---------- */

/** Contents of ~/.aurea/studiod.json — how shells and CLIs find a running core. */
export const portFileSchema = z.object({
  port: z.number().int(),
  token: z.string(),
  pid: z.number().int(),
});
export type PortFile = z.infer<typeof portFileSchema>;
