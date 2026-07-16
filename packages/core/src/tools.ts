/* The Aurea tool surface — one registry, two hosts. Every tool is a thin
 * translation onto the studiod tRPC procedures (PRD iron rule: the renderer,
 * the MCP server, and the Director are equal clients). mcp.ts registers these
 * on the stdio MCP server for external agents (Claude Code and friends);
 * director.ts registers the very same definitions on an in-process SDK MCP
 * server for the Director chat. Change a tool here and both surfaces move. */

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { z } from "zod";
import {
  imageGenerateSchema,
  jobStatusSchema,
  libraryKindSchema,
  musicGenerateSchema,
  settingsUpdateSchema,
  ttsGenerateSchema,
  videoGenerateSchema,
  type Job,
} from "@aurea/shared";
import type { AppRouter } from "./router.js";

/** loopback tRPC client for a running studiod — what every tool handler calls */
export type StudiodApi = ReturnType<typeof createStudiodApi>;

export function createStudiodApi(port: number, token: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `http://127.0.0.1:${port}`,
        headers: { authorization: `Bearer ${token}` },
      }),
    ],
  });
}

/* ---------- registry types ---------- */

export interface ToolResult {
  /** MCP CallToolResult allows arbitrary extra fields; the index signature keeps both hosts happy */
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
}

/** the slice of MCP's RequestHandlerExtra that wait_for_job uses for progress;
 * hosts that don't stream progress (the Director's SDK server) pass nothing */
export interface ToolExtra {
  _meta?: { progressToken?: string | number };
  sendNotification?: (notification: {
    method: "notifications/progress";
    params: { progressToken: string | number; progress: number; total: number; message: string };
  }) => Promise<void>;
}

export interface AureaTool<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  schema: S;
  handler: (args: Record<string, unknown>, extra?: ToolExtra) => Promise<ToolResult>;
}

const defineTool = <S extends z.ZodRawShape>(t: {
  name: string;
  title: string;
  description: string;
  schema: S;
  handler: (args: z.infer<z.ZodObject<S>>, extra?: ToolExtra) => Promise<ToolResult>;
}): AureaTool =>
  ({ ...t, handler: t.handler as AureaTool["handler"] }) as AureaTool;

/* ---------- helpers ---------- */

const json = (value: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** lab generate inputs, with the project defaulting to the built-in Playground */
const withProjectDefault = <S extends z.ZodRawShape>(schema: z.ZodObject<S>) => ({
  ...schema.shape,
  project: z
    .string()
    .default("playground")
    .describe("project id the artifact lands in (see list_projects)"),
});

/* ---------- the registry ---------- */

export function buildTools(api: StudiodApi): AureaTool[] {
  async function getJob(id: string): Promise<Job> {
    const job = (await api.jobs.list.query()).find((j) => j.id === id);
    if (!job) throw new Error(`unknown job "${id}"`);
    return job;
  }

  async function requireProject(project: string): Promise<void> {
    if (!(await api.projects.list.query()).some((p) => p.id === project)) {
      const ids = (await api.projects.list.query()).map((p) => p.id).join(", ");
      throw new Error(`unknown project "${project}" — existing: ${ids} (or create_project first)`);
    }
  }

  return [
    defineTool({
      name: "system_overview",
      title: "System overview",
      description:
        "GPU, VRAM, temperature and queue preflight for this machine — check before enqueueing heavy jobs.",
      schema: {},
      handler: async () => {
        const [overview, vram, jobs] = await Promise.all([
          api.system.overview.query(),
          api.system.vram.query(),
          api.jobs.list.query(),
        ]);
        const count = (s: Job["status"]) => jobs.filter((j) => j.status === s).length;
        return json({
          ...overview,
          vram,
          queue: { running: count("running"), queued: count("queued") },
        });
      },
    }),

    defineTool({
      name: "list_jobs",
      title: "List jobs",
      description: "The job queue and history (running first). Optional status filter.",
      schema: { status: jobStatusSchema.optional() },
      handler: async ({ status }) => {
        const jobs = await api.jobs.list.query();
        return json(status ? jobs.filter((j) => j.status === status) : jobs);
      },
    }),

    defineTool({
      name: "get_job",
      title: "Get job",
      description: "One job by id — status, progress, stage, and output path once completed.",
      schema: { id: z.string() },
      handler: async ({ id }) => json(await getJob(id)),
    }),

    defineTool({
      name: "wait_for_job",
      title: "Wait for job",
      description:
        "Block until a job completes or fails (polls every 2s). Returns the final job — output is an " +
        "absolute file path. On timeout the job keeps running; call wait_for_job again to keep waiting.",
      schema: {
        id: z.string(),
        timeoutSec: z.number().int().min(5).max(3600).default(300),
      },
      handler: async ({ id, timeoutSec }, extra) => {
        const deadline = Date.now() + timeoutSec * 1000;
        const progressToken = extra?._meta?.progressToken;
        for (;;) {
          const job = await getJob(id);
          if (job.status === "completed" || job.status === "failed") return json(job);
          if (Date.now() >= deadline) {
            return json({ ...job, timedOut: true, note: `still ${job.status} after ${timeoutSec}s` });
          }
          if (progressToken !== undefined && extra?.sendNotification) {
            // keeps clients that reset their request timeout on progress from hanging up
            await extra
              .sendNotification({
                method: "notifications/progress",
                params: {
                  progressToken,
                  progress: job.progress,
                  total: 100,
                  message: `${job.status}${job.stage ? ` — ${job.stage}` : ""}`,
                },
              })
              .catch(() => undefined);
          }
          await sleep(2000);
        }
      },
    }),

    defineTool({
      name: "cancel_job",
      title: "Cancel job",
      description: "Cancel a queued or running job.",
      schema: { id: z.string() },
      handler: async ({ id }) => json(await api.jobs.cancel.mutate({ id })),
    }),

    defineTool({
      name: "retry_job",
      title: "Retry job",
      description: "Re-queue a failed job.",
      schema: { id: z.string() },
      handler: async ({ id }) => json(await api.jobs.retry.mutate({ id })),
    }),

    defineTool({
      name: "list_projects",
      title: "List projects",
      description: "All projects (folders under the Aurea data root). Project ids are slugs.",
      schema: {},
      handler: async () => json(await api.projects.list.query()),
    }),

    defineTool({
      name: "create_project",
      title: "Create project",
      description: "Create a new project; returns it (id is the slugified name).",
      schema: { name: z.string().min(1) },
      handler: async ({ name }) => json(await api.projects.create.mutate({ name })),
    }),

    defineTool({
      name: "list_assets",
      title: "List assets",
      description:
        "Every media file in every project's assets tree, newest first. absPath is openable directly.",
      schema: {
        project: z.string().optional().describe("filter to one project id"),
        kind: libraryKindSchema.optional(),
        limit: z.number().int().min(1).max(500).default(50),
      },
      handler: async ({ project, kind, limit }) => {
        const [{ assets }, settings] = await Promise.all([
          api.library.list.query(),
          api.settings.get.query(),
        ]);
        const dataRoot = settings.storage.dataRoot;
        const filtered = assets
          .filter((a) => (!project || a.project === project) && (!kind || a.kind === kind))
          .slice(0, limit)
          .map((a) => ({ ...a, absPath: `${dataRoot}/${a.relPath}`.replace(/\//g, "\\") }));
        return json({ total: assets.length, shown: filtered.length, assets: filtered });
      },
    }),

    defineTool({
      name: "lab_catalog",
      title: "Lab catalog",
      description:
        "What a lab can run on this machine: engines/models with availability, plus valid option values " +
        "(aspects, presets, voices, styles, resolutions).",
      schema: { lab: z.enum(["image", "voice", "music", "video"]) },
      handler: async ({ lab }) => {
        const catalogs = {
          image: () => api.labs.image.catalog.query(),
          voice: () => api.labs.voice.catalog.query(),
          music: () => api.labs.music.catalog.query(),
          video: () => api.labs.video.catalog.query(),
        };
        return json(await catalogs[lab]());
      },
    }),

    defineTool({
      name: "generate_image",
      title: "Generate image",
      description:
        "Enqueue a local image generation (ComfyUI: z-image default, runs managed; krea2 photoreal needs external ComfyUI). Returns the " +
        "job — wait_for_job for the file. Check lab_catalog('image') for models/aspects/presets.",
      schema: withProjectDefault(imageGenerateSchema.omit({ project: true })),
      handler: async ({ project, ...payload }) => {
        await requireProject(project);
        return json(await api.labs.image.generate.mutate({ ...payload, project }));
      },
    }),

    defineTool({
      name: "generate_speech",
      title: "Generate speech",
      description:
        "Enqueue local TTS (Chatterbox cloned character voices / Qwen3-TTS narrators). Returns the job — " +
        "wait_for_job for the wav. Check lab_catalog('voice') for the voice roster.",
      schema: withProjectDefault(ttsGenerateSchema.omit({ project: true })),
      handler: async ({ project, ...payload }) => {
        await requireProject(project);
        return json(await api.labs.voice.generate.mutate({ ...payload, project }));
      },
    }),

    defineTool({
      name: "generate_music",
      title: "Generate music",
      description:
        "Enqueue local music generation (ACE-Step; instrumental or sung vocals in a cloned character " +
        "voice). Returns the job — wait_for_job for the audio. Check lab_catalog('music') for styles.",
      schema: withProjectDefault(musicGenerateSchema.omit({ project: true })),
      handler: async ({ project, ...payload }) => {
        await requireProject(project);
        return json(await api.labs.music.generate.mutate({ ...payload, project }));
      },
    }),

    defineTool({
      name: "generate_video",
      title: "Generate video clip",
      description:
        "Enqueue a local LTX-2 video clip. startFrame (library relPath from list_assets) anchors identity " +
        "(i2v); adding audio (relPath of a speech take) switches to lip-sync (ia2v). Returns the job — " +
        "wait_for_job for the mp4. Check lab_catalog('video') for resolutions/durations.",
      schema: withProjectDefault(videoGenerateSchema.omit({ project: true })),
      handler: async ({ project, ...payload }) => {
        await requireProject(project);
        return json(await api.labs.video.generate.mutate({ ...payload, project }));
      },
    }),

    defineTool({
      name: "create_video",
      title: "Create finished video (videofast)",
      description:
        "Enqueue a complete short video through the videofast batch pipeline (script → voiceover → music " +
        "→ render → thumbnails). account = a JSON file in <videofastDir>/accounts (e.g. 'mind'). Runs " +
        "minutes, GPU-heavy — wait_for_job with a generous timeout. Returns the job.",
      schema: {
        account: z.string().min(1).describe("account id — <videofastDir>/accounts/<id>.json"),
        topic: z.string().min(1).describe("what the video is about (drives the script)"),
        titleHint: z.string().optional().describe("title hint, or attribution for the quote format"),
        seed: z.number().int().optional(),
        project: z.string().default("playground"),
      },
      handler: async ({ account, topic, titleHint, seed, project }) => {
        await requireProject(project);
        const job = await api.jobs.enqueue.mutate({
          title: topic.length > 44 ? `${topic.slice(0, 43)}…` : topic,
          kind: "video",
          engine: "videofast",
          priority: "batch",
          detail: `${account} · full pipeline`,
          project: `/${project}`,
          payload: { type: "videofast", account, topic, titleHint, seed },
        });
        return json(job);
      },
    }),

    defineTool({
      name: "get_settings",
      title: "Get settings",
      description: "Studio settings: data root, videofast dir, engine paths/URLs, providers.",
      schema: {},
      handler: async () => {
        const [settings, storage] = await Promise.all([
          api.settings.get.query(),
          api.settings.storage.query(),
        ]);
        return json({ ...settings, storageStats: storage });
      },
    }),

    defineTool({
      name: "update_settings",
      title: "Update settings",
      description: "Partial settings update (any section, any field). Returns the full new settings.",
      schema: settingsUpdateSchema.shape,
      handler: async (update) => json(await api.settings.update.mutate(update)),
    }),
  ];
}
