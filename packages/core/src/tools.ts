/* The Aurea tool surface — one registry, two hosts. Every tool is a thin
 * translation onto the studiod tRPC procedures (PRD iron rule: the renderer,
 * the MCP server, and the Director are equal clients). mcp.ts registers these
 * on the stdio MCP server for external agents (Claude Code and friends);
 * director.ts registers the very same definitions on an in-process SDK MCP
 * server for the Director chat. Change a tool here and both surfaces move. */

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { z } from "zod";
import {
  bibleCharacterSchema,
  bibleLocationSchema,
  episodePatchSchema,
  imageGenerateSchema,
  jobStatusSchema,
  libraryKindSchema,
  musicGenerateSchema,
  productionAddEpisodeSchema,
  productionAddSceneSchema,
  productionAddShotSchema,
  scenePatchSchema,
  settingsUpdateSchema,
  shotPatchSchema,
  timelineAddClipSchema,
  timelineClipPatchSchema,
  ttsGenerateSchema,
  videoGenerateSchema,
  type Job,
  type Timeline,
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

const timelineEnd = (tl: Timeline): number =>
  tl.tracks.reduce((m, t) => t.clips.reduce((mm, c) => Math.max(mm, c.start + c.duration), m), 0);

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
        "Enqueue a local image generation (ComfyUI: z-image fast drafts, krea2 photoreal — both run managed). Returns the " +
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
      name: "timeline_get",
      title: "Get timeline",
      description:
        "The project's sequence: tracks (video/voice/music) with clips (id, asset relPath, start, in, " +
        "duration, transitionSec — all seconds). durationSec is the cut's total length.",
      schema: { project: z.string().default("playground") },
      handler: async ({ project }) => {
        await requireProject(project);
        const timeline = await api.timeline.get.query({ project });
        return json({ durationSec: timelineEnd(timeline), ...timeline });
      },
    }),

    defineTool({
      name: "timeline_add_clip",
      title: "Add clip to timeline",
      description:
        "Place a library asset (relPath from list_assets) on the project's sequence. Omit start to " +
        "append at the end of the track, omit duration to use the media's real length (images hold 4s). " +
        "transitionSec crossfades into the clip from whatever plays before it. trackIndex targets the " +
        "nth track of the kind (0 = base; later video tracks composite ON TOP — use trackIndex 1 for " +
        "inserts/cutaways over the base cut; one past the end creates the track). Returns the new clip.",
      schema: withProjectDefault(timelineAddClipSchema.omit({ project: true })),
      handler: async ({ project, ...input }) => {
        await requireProject(project);
        const { clip, timeline } = await api.timeline.addClip.mutate({ project, ...input });
        return json({ clip, durationSec: timelineEnd(timeline) });
      },
    }),

    defineTool({
      name: "timeline_update_clip",
      title: "Update timeline clip",
      description:
        "Retime or trim one clip by id (see timeline_get): start (move), in/duration (trim), " +
        "transitionSec (crossfade), label.",
      schema: {
        project: z.string().default("playground"),
        clip: z.string().describe("clip id from timeline_get"),
        ...timelineClipPatchSchema.shape,
      },
      handler: async ({ project, clip, ...patch }) => {
        await requireProject(project);
        const timeline = await api.timeline.updateClip.mutate({ project, clip, patch });
        return json({ ok: true, durationSec: timelineEnd(timeline) });
      },
    }),

    defineTool({
      name: "timeline_remove_clip",
      title: "Remove timeline clip",
      description: "Delete one clip from the project's sequence by id.",
      schema: { project: z.string().default("playground"), clip: z.string() },
      handler: async ({ project, clip }) => {
        await requireProject(project);
        const timeline = await api.timeline.removeClip.mutate({ project, clip });
        return json({ ok: true, durationSec: timelineEnd(timeline) });
      },
    }),

    defineTool({
      name: "timeline_export",
      title: "Export timeline",
      description:
        "Render the project's sequence to a finished mp4 (ffmpeg, runs beside GPU jobs). Returns the " +
        "job — wait_for_job for the file; it also lands in the project's video assets.",
      schema: { project: z.string().default("playground") },
      handler: async ({ project }) => {
        await requireProject(project);
        return json(await api.timeline.export.mutate({ project }));
      },
    }),

    defineTool({
      name: "production_get",
      title: "Get production",
      description:
        "The project's show structure: seasons → episodes → scenes → shots, with every node's id. " +
        "A shot carries script lines, characters (bible ids), a location, a camera spec, keyframe/take " +
        "slots and a status (draft→boarded→generated→synced→approved). Read this before editing the show.",
      schema: { project: z.string().default("playground") },
      handler: async ({ project }) => {
        await requireProject(project);
        return json(await api.studio.production.get.query({ project }));
      },
    }),

    defineTool({
      name: "production_add_episode",
      title: "Add episode",
      description:
        "Append an episode to a season (season 1 by default; the season is created if missing). " +
        "Episode numbers auto-increment. Returns the new episode with its id.",
      schema: withProjectDefault(productionAddEpisodeSchema.omit({ project: true })),
      handler: async ({ project, ...input }) => {
        await requireProject(project);
        return json(await api.studio.production.addEpisode.mutate({ project, ...input }));
      },
    }),

    defineTool({
      name: "production_add_scene",
      title: "Add scene",
      description:
        "Append a scene to an episode (episodeId from production_get). slugline is the screenplay " +
        "heading (\"INT. THE LOFT — NIGHT\"); location is a bible location id (bible_get lists them).",
      schema: withProjectDefault(productionAddSceneSchema.omit({ project: true })),
      handler: async ({ project, ...input }) => {
        await requireProject(project);
        return json(await api.studio.production.addScene.mutate({ project, ...input }));
      },
    }),

    defineTool({
      name: "production_add_shot",
      title: "Add shot",
      description:
        "Append a shot to a scene (sceneId from production_get). Shots are the atomic production " +
        "unit: give each one its script lines (character = bible character id, null for action " +
        "lines), the characters present, and a camera spec drawn from the style bible's " +
        "cinematography language. New shots start at status \"draft\"; location defaults to the scene's.",
      schema: withProjectDefault(productionAddShotSchema.omit({ project: true })),
      handler: async ({ project, ...input }) => {
        await requireProject(project);
        return json(await api.studio.production.addShot.mutate({ project, ...input }));
      },
    }),

    defineTool({
      name: "episode_update",
      title: "Update episode",
      description:
        "Patch an episode's title, logline, or synopsis by id (production_get lists episode ids). " +
        "The writers room reads the synopsis as the episode's outline paragraph.",
      schema: {
        project: z.string().default("playground"),
        episodeId: z.string().describe("episode id from production_get"),
        ...episodePatchSchema.shape,
      },
      handler: async ({ project, episodeId, ...patch }) => {
        await requireProject(project);
        await api.studio.production.updateEpisode.mutate({ project, episodeId, patch });
        return json({ ok: true });
      },
    }),

    defineTool({
      name: "scene_update",
      title: "Update scene",
      description: "Patch a scene's slugline, summary, or location by id (production_get lists scene ids).",
      schema: {
        project: z.string().default("playground"),
        sceneId: z.string().describe("scene id from production_get"),
        ...scenePatchSchema.shape,
      },
      handler: async ({ project, sceneId, ...patch }) => {
        await requireProject(project);
        await api.studio.production.updateScene.mutate({ project, sceneId, patch });
        return json({ ok: true });
      },
    }),

    defineTool({
      name: "shot_update",
      title: "Update shot",
      description:
        "Patch any shot fields by id (production_get lists shot ids): title, scriptLines, characters, " +
        "location, camera, notes, and status along the ladder draft→boarded→generated→synced→approved. " +
        "Arrays replace wholesale — send the complete new scriptLines list, not a delta.",
      schema: {
        project: z.string().default("playground"),
        shotId: z.string().describe("shot id from production_get"),
        ...shotPatchSchema.shape,
      },
      handler: async ({ project, shotId, ...patch }) => {
        await requireProject(project);
        const { shot } = await api.studio.production.updateShot.mutate({ project, shotId, patch });
        return json(shot);
      },
    }),

    defineTool({
      name: "bible_get",
      title: "Get bible",
      description:
        "The production bible — the persistent cast & world memory: characters (appearance slots, " +
        "identity anchors, personality, speech pattern, locked voice, reference images), locations, " +
        "and the style bible (art direction, negative prompt). Consult it before writing dialogue or " +
        "describing a character, and keep it authoritative: new recurring characters/locations belong " +
        "in the bible, not just in a script.",
      schema: { project: z.string().default("playground") },
      handler: async ({ project }) => {
        await requireProject(project);
        return json(await api.studio.bible.get.query({ project }));
      },
    }),

    defineTool({
      name: "bible_upsert_character",
      title: "Upsert bible character",
      description:
        "Create or replace one bible character (matched by character.id). Send the COMPLETE character " +
        "object — read the current one from bible_get first when editing. voice.voiceId is a cloned " +
        "voice id from list_voices; refs are library relPaths.",
      schema: {
        project: z.string().default("playground"),
        character: bibleCharacterSchema,
      },
      handler: async ({ project, character }) => {
        await requireProject(project);
        const bible = await api.studio.bible.upsertCharacter.mutate({ project, character });
        return json({ ok: true, characters: bible.characters.map((c) => c.id) });
      },
    }),

    defineTool({
      name: "bible_upsert_location",
      title: "Upsert bible location",
      description:
        "Create or replace one bible location (matched by location.id): name, description, stylePrompt " +
        "(paste-in block for keyframe generation), refs (library relPaths).",
      schema: {
        project: z.string().default("playground"),
        location: bibleLocationSchema,
      },
      handler: async ({ project, location }) => {
        await requireProject(project);
        const bible = await api.studio.bible.upsertLocation.mutate({ project, location });
        return json({ ok: true, locations: bible.locations.map((l) => l.id) });
      },
    }),

    defineTool({
      name: "seed_animal_sitcom",
      title: "Seed Animal Sitcom bible",
      description:
        "Populate the project's bible with the six locked Animal Sitcom characters (Sterling, Grant, " +
        "Milo, Bruno, Jax, Barney), their reference art and cloned voices, plus starter locations and " +
        "the style bible — copied from the videofast repo. Idempotent; re-run to pick up newly " +
        "generated character-sheet frames. overwrite=true resets seed characters to their locked values.",
      schema: {
        project: z.string().default("playground"),
        overwrite: z.boolean().default(false),
      },
      handler: async ({ project, overwrite }) => {
        await requireProject(project);
        const result = await api.studio.seedAnimalSitcom.mutate({ project, overwrite });
        return json({
          copiedFiles: result.copiedFiles,
          warnings: result.warnings,
          characters: result.bible.characters.map((c) => c.id),
          locations: result.bible.locations.map((l) => l.id),
        });
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
