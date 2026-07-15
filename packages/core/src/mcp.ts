/* Aurea MCP server — the studiod surface for agent clients (Claude Code and
 * friends), PRD iron rule: everything the app can do is reachable headlessly.
 * Speaks MCP over stdio (stdout is protocol-only; logs go to stderr), and is
 * a thin translation layer: every tool call lands on the same tRPC procedures
 * the desktop renderer uses.
 *
 * Boot: reuse a running studiod via ~/.aurea/studiod.json, else start one
 * in-process (the port file is written, so a later app launch reuses ours).
 *
 * Agent workflow: generate_* / create_video enqueue a job and return it —
 * follow with wait_for_job to block until the artifact lands; completed jobs
 * carry an absolute output path the agent can open directly. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
import { PORT_FILE, probeStudiod, readPortFile } from "./portfile.js";
import { startStudiod, type StudiodHandle } from "./server.js";

/* ---------- studiod discovery / ownership ---------- */

let owned: StudiodHandle | null = null;

async function connect(): Promise<{ port: number; token: string }> {
  const existing = await readPortFile();
  if (existing && (await probeStudiod(existing))) {
    console.error(`aurea-mcp: reusing studiod on 127.0.0.1:${existing.port} (pid ${existing.pid})`);
    return existing;
  }
  const preferred = Number(process.env.AUREA_PORT ?? 4114);
  try {
    owned = await startStudiod({ port: preferred, writePortFile: true });
  } catch {
    // preferred port taken by something that isn't a healthy studiod
    owned = await startStudiod({ port: 0, writePortFile: true });
  }
  console.error(`aurea-mcp: started studiod on 127.0.0.1:${owned.port} (discovery: ${PORT_FILE})`);
  return owned;
}

const { port, token } = await connect();

const api = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `http://127.0.0.1:${port}`,
      headers: { authorization: `Bearer ${token}` },
    }),
  ],
});

/* ---------- helpers ---------- */

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** lab generate inputs, with the project defaulting to the built-in Playground */
const withProjectDefault = <S extends z.ZodRawShape>(schema: z.ZodObject<S>) => ({
  ...schema.shape,
  project: z
    .string()
    .default("playground")
    .describe("project id the artifact lands in (see list_projects)"),
});

/* ---------- server + tools ---------- */

const server = new McpServer({ name: "aurea", version: "0.1.0" });

server.registerTool(
  "system_overview",
  {
    title: "System overview",
    description:
      "GPU, VRAM, temperature and queue preflight for this machine — check before enqueueing heavy jobs.",
    inputSchema: {},
  },
  async () => {
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
);

server.registerTool(
  "list_jobs",
  {
    title: "List jobs",
    description: "The job queue and history (running first). Optional status filter.",
    inputSchema: { status: jobStatusSchema.optional() },
  },
  async ({ status }) => {
    const jobs = await api.jobs.list.query();
    return json(status ? jobs.filter((j) => j.status === status) : jobs);
  },
);

server.registerTool(
  "get_job",
  {
    title: "Get job",
    description: "One job by id — status, progress, stage, and output path once completed.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => json(await getJob(id)),
);

server.registerTool(
  "wait_for_job",
  {
    title: "Wait for job",
    description:
      "Block until a job completes or fails (polls every 2s). Returns the final job — output is an " +
      "absolute file path. On timeout the job keeps running; call wait_for_job again to keep waiting.",
    inputSchema: {
      id: z.string(),
      timeoutSec: z.number().int().min(5).max(3600).default(300),
    },
  },
  async ({ id, timeoutSec }, extra) => {
    const deadline = Date.now() + timeoutSec * 1000;
    const progressToken = extra._meta?.progressToken;
    for (;;) {
      const job = await getJob(id);
      if (job.status === "completed" || job.status === "failed") return json(job);
      if (Date.now() >= deadline) {
        return json({ ...job, timedOut: true, note: `still ${job.status} after ${timeoutSec}s` });
      }
      if (progressToken !== undefined) {
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
);

server.registerTool(
  "cancel_job",
  {
    title: "Cancel job",
    description: "Cancel a queued or running job.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => json(await api.jobs.cancel.mutate({ id })),
);

server.registerTool(
  "retry_job",
  {
    title: "Retry job",
    description: "Re-queue a failed job.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => json(await api.jobs.retry.mutate({ id })),
);

server.registerTool(
  "list_projects",
  {
    title: "List projects",
    description: "All projects (folders under the Aurea data root). Project ids are slugs.",
    inputSchema: {},
  },
  async () => json(await api.projects.list.query()),
);

server.registerTool(
  "create_project",
  {
    title: "Create project",
    description: "Create a new project; returns it (id is the slugified name).",
    inputSchema: { name: z.string().min(1) },
  },
  async ({ name }) => json(await api.projects.create.mutate({ name })),
);

server.registerTool(
  "list_assets",
  {
    title: "List assets",
    description:
      "Every media file in every project's assets tree, newest first. absPath is openable directly.",
    inputSchema: {
      project: z.string().optional().describe("filter to one project id"),
      kind: libraryKindSchema.optional(),
      limit: z.number().int().min(1).max(500).default(50),
    },
  },
  async ({ project, kind, limit }) => {
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
);

server.registerTool(
  "lab_catalog",
  {
    title: "Lab catalog",
    description:
      "What a lab can run on this machine: engines/models with availability, plus valid option values " +
      "(aspects, presets, voices, styles, resolutions).",
    inputSchema: { lab: z.enum(["image", "voice", "music", "video"]) },
  },
  async ({ lab }) => {
    const catalogs = {
      image: () => api.labs.image.catalog.query(),
      voice: () => api.labs.voice.catalog.query(),
      music: () => api.labs.music.catalog.query(),
      video: () => api.labs.video.catalog.query(),
    };
    return json(await catalogs[lab]());
  },
);

server.registerTool(
  "generate_image",
  {
    title: "Generate image",
    description:
      "Enqueue a local image generation (ComfyUI: krea2 photoreal / z-image fast drafts). Returns the " +
      "job — wait_for_job for the file. Check lab_catalog('image') for models/aspects/presets.",
    inputSchema: withProjectDefault(imageGenerateSchema.omit({ project: true })),
  },
  async ({ project, ...payload }) => {
    await requireProject(project);
    return json(await api.labs.image.generate.mutate({ ...payload, project }));
  },
);

server.registerTool(
  "generate_speech",
  {
    title: "Generate speech",
    description:
      "Enqueue local TTS (Chatterbox cloned character voices / Qwen3-TTS narrators). Returns the job — " +
      "wait_for_job for the wav. Check lab_catalog('voice') for the voice roster.",
    inputSchema: withProjectDefault(ttsGenerateSchema.omit({ project: true })),
  },
  async ({ project, ...payload }) => {
    await requireProject(project);
    return json(await api.labs.voice.generate.mutate({ ...payload, project }));
  },
);

server.registerTool(
  "generate_music",
  {
    title: "Generate music",
    description:
      "Enqueue local music generation (ACE-Step; instrumental or sung vocals in a cloned character " +
      "voice). Returns the job — wait_for_job for the audio. Check lab_catalog('music') for styles.",
    inputSchema: withProjectDefault(musicGenerateSchema.omit({ project: true })),
  },
  async ({ project, ...payload }) => {
    await requireProject(project);
    return json(await api.labs.music.generate.mutate({ ...payload, project }));
  },
);

server.registerTool(
  "generate_video",
  {
    title: "Generate video clip",
    description:
      "Enqueue a local LTX-2 video clip. startFrame (library relPath from list_assets) anchors identity " +
      "(i2v); adding audio (relPath of a speech take) switches to lip-sync (ia2v). Returns the job — " +
      "wait_for_job for the mp4. Check lab_catalog('video') for resolutions/durations.",
    inputSchema: withProjectDefault(videoGenerateSchema.omit({ project: true })),
  },
  async ({ project, ...payload }) => {
    await requireProject(project);
    return json(await api.labs.video.generate.mutate({ ...payload, project }));
  },
);

server.registerTool(
  "create_video",
  {
    title: "Create finished video (videofast)",
    description:
      "Enqueue a complete short video through the videofast batch pipeline (script → voiceover → music " +
      "→ render → thumbnails). account = a JSON file in <videofastDir>/accounts (e.g. 'mind'). Runs " +
      "minutes, GPU-heavy — wait_for_job with a generous timeout. Returns the job.",
    inputSchema: {
      account: z.string().min(1).describe("account id — <videofastDir>/accounts/<id>.json"),
      topic: z.string().min(1).describe("what the video is about (drives the script)"),
      titleHint: z.string().optional().describe("title hint, or attribution for the quote format"),
      seed: z.number().int().optional(),
      project: z.string().default("playground"),
    },
  },
  async ({ account, topic, titleHint, seed, project }) => {
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
);

server.registerTool(
  "get_settings",
  {
    title: "Get settings",
    description: "Studio settings: data root, videofast dir, engine paths/URLs, providers.",
    inputSchema: {},
  },
  async () => {
    const [settings, storage] = await Promise.all([
      api.settings.get.query(),
      api.settings.storage.query(),
    ]);
    return json({ ...settings, storageStats: storage });
  },
);

server.registerTool(
  "update_settings",
  {
    title: "Update settings",
    description: "Partial settings update (any section, any field). Returns the full new settings.",
    inputSchema: settingsUpdateSchema.shape,
  },
  async (update) => json(await api.settings.update.mutate(update)),
);

/* ---------- lifecycle ---------- */

async function shutdown(code: number): Promise<never> {
  if (owned) await owned.close().catch(() => undefined);
  process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutdown(0));
}

await server.connect(new StdioServerTransport());
// fires when the client hangs up (stdin closes) — take our studiod down with us
server.server.onclose = () => void shutdown(0);
console.error(`aurea-mcp: ready (${owned ? "owns studiod" : "attached to running studiod"})`);
