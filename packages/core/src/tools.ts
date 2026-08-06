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
  directorSpecSchema,
  episodePatchSchema,
  imageDeckGenerateSchema,
  imageGenerateSchema,
  jobStatusSchema,
  libraryKindSchema,
  minimaxRefVideoSchema,
  musicGenerateSchema,
  productionAddEpisodeSchema,
  productionAddSceneSchema,
  productionAddShotSchema,
  scenePatchSchema,
  settingsUpdateSchema,
  shotPatchSchema,
  shotRenderSchema,
  storyboardGenerateSchema,
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
        if (lab === "video") {
          // the video lab has a second, live question — which LTX features the
          // ComfyUI it points at can actually reach. Report it beside the
          // catalog so an agent never has to guess whether generate_shot works.
          const [catalog, capabilities] = await Promise.all([
            api.labs.video.catalog.query(),
            api.labs.video.capabilities.query(),
          ]);
          return json({
            ...catalog,
            director: { ...catalog.director, capabilities },
          });
        }
        const catalogs = {
          image: () => api.labs.image.catalog.query(),
          voice: () => api.labs.voice.catalog.query(),
          music: () => api.labs.music.catalog.query(),
        };
        return json(await catalogs[lab]());
      },
    }),

    defineTool({
      name: "prompt_library",
      title: "Prompt library",
      description:
        "The user's saved prompt fragments and style packs (Zoo Logic, Animal Sitcom, and a " +
        "live pack derived from the project's bible). Read it before composing image/video " +
        "prompts so your language matches the looks the user already curated — categories are " +
        "style/subject/lighting/camera/mood/negative, and a pack's `negative` belongs in the " +
        "negative prompt, not appended to the positive one.",
      schema: { project: z.string().default("playground") },
      handler: async ({ project }) =>
        json({
          presets: await api.prompts.list.query({ project }),
          packs: await api.prompts.packs.query({ project }),
        }),
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
      name: "generate_image_deck",
      title: "Generate image deck",
      description:
        "Enqueue a themed bulk image set as ONE batch job (t2i models: z-image fast, krea2 photoreal). " +
        "You author the prompts yourself — one per image, up to 100 — and every render lands together in " +
        "assets/image/decks/<deck-slug>/. Shared aspect/preset/seed apply to the whole deck (image i uses " +
        "seed+i, so a fixed seed reproduces the deck exactly). Returns the job — wait_for_job for the folder.",
      schema: withProjectDefault(imageDeckGenerateSchema.omit({ project: true })),
      handler: async ({ project, ...payload }) => {
        await requireProject(project);
        return json(await api.labs.image.generateDeck.mutate({ ...payload, project }));
      },
    }),

    defineTool({
      name: "generate_speech",
      title: "Generate speech",
      description:
        "Enqueue local TTS (Chatterbox cloned character voices / Qwen3-TTS narrators / DramaBox " +
        "expressive acting — engine 'dramabox' performs stage-direction tags like [laughs] or " +
        "(nervously) instead of reading them; its optional knobs are seed, cfgScale, stgScale, " +
        "durationMultiplier (<1 = tighter), genDuration, refDuration, watermark, design). Returns " +
        "the job — wait_for_job for the wav. Check lab_catalog('voice') for the voice roster.",
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
        "Enqueue local music generation (ACE-Step; instrumental or sung vocals — omit singVoice to " +
        "keep ACE-Step's own singing, set it to chain a cloned-voice conversion pass). Returns the " +
        "job — wait_for_job for the audio. Check lab_catalog('music') for styles.",
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
        "Enqueue a local video clip. Default engine 'ltx2': startFrame (library relPath from " +
        "list_assets) anchors identity (i2v); adding audio (relPath of a speech take) switches to " +
        "lip-sync (ia2v). LTX-only extras: endFrame (the take lands on it), keyframes " +
        "([{image, atSec, strength}] mid-shot anchors, ≤8), fps 48 (smoother, ~2× time), " +
        "fast:true (draft — skips the refine pass, HALF-size picture in far less time; block " +
        "with drafts, deliver without), loras ([{name, strength}] ≤3, names verbatim from " +
        "lab_catalog capabilities.availableLoras), and cameraLora ({move, strength} — gated on " +
        "capabilities.cameraLoras; no 22b camera weights ship yet, so normally keep the move in " +
        "the prompt). engine 'minimax-h3' is the opposite trade — it writes and performs the " +
        "dialogue, sound effects and music ITSELF in the same pass as the picture, so pass no " +
        "audio and put the lines in the prompt under an 'Audio:' heading; 4-15s only, 24fps only, " +
        "no Director timeline, and roughly 10x LTX's render time, so reserve it for a hero beat; " +
        "its 2K presets cost ~2.4× the native canvas. On H3, " +
        "minimaxRefs carries stills/clips/sound the shot must keep — see reference_video, which " +
        "is the same thing with the tag rules stated. Returns the " +
        "job — wait_for_job for the mp4. Check lab_catalog('video') for which engines this machine " +
        "can actually run, plus resolutionsByEngine/durations and the ltx block's option surface.",
      schema: withProjectDefault(videoGenerateSchema.omit({ project: true })),
      handler: async ({ project, ...payload }) => {
        await requireProject(project);
        return json(await api.labs.video.generate.mutate({ ...payload, project }));
      },
    }),

    defineTool({
      name: "generate_shot",
      title: "Generate a Director shot",
      description:
        "Enqueue ONE continuous LTX take composed as a timeline — the Shot Director. Use this " +
        "instead of generate_video whenever a shot needs more than a single prompt and a start " +
        "frame: keyframes pinned at times (a start frame at 0s, an end frame the take morphs " +
        "into), prompt beats that change the action or camera mid-take, cloned-voice takes locked " +
        "to timecodes so each character lip-syncs their own line, a motion reference, or cast " +
        "references that hold an ensemble on-model. The payload's loras/cameraLora ride a " +
        "Director shot too (chained before the timeline patches the model). Everything is " +
        "authored in SECONDS. Read " +
        "lab_catalog('video').director first: it carries the limits, the rules that are measured " +
        "facts about LTX (beat wording, gap length, the one IC-LoRA slot), and whether this " +
        "machine can run Director shots at all. Returns the job — wait_for_job for the mp4.",
      schema: withProjectDefault(
        videoGenerateSchema.omit({ project: true }).extend({
          director: directorSpecSchema.describe(
            "the shot timeline — keyframes, promptZones, audio, refs, motion (see lab_catalog)",
          ),
        }),
      ),
      handler: async ({ project, ...payload }) => {
        await requireProject(project);
        return json(await api.labs.video.generate.mutate({ ...payload, project }));
      },
    }),

    defineTool({
      name: "reference_video",
      title: "Render or edit a clip from references",
      description:
        "Render on MiniMax-H3's REFERENCE head (ref2va): a take conditioned on things you hand " +
        "it — up to 9 stills, 3 clips (optionally with their own sound) and 3 sound clips — " +
        "instead of on a start frame. Two jobs, one tool. (1) Carry something forward: a " +
        "character's face, a set, a voice, a camera move, held across a new shot the way a start " +
        "frame can't. (2) EDIT a clip: reference the clip and describe the change ('keep " +
        "<Video 1>'s staging and blocking, restyle it as a night scene'). The result is " +
        "regenerated, not composited — a new performance of the same idea, with its own audio, " +
        "so it is the right tool for a restyle or a redirect and the wrong one for a two-second " +
        "artefact (use shot_retake for that). " +
        "THE PROMPT MUST NAME THE REFERENCES: they are presented as <Picture 1>…, <Video 1>…, " +
        "<Audio 1>… in that order, ordinals 1-based per type, and a clip's own soundtrack takes " +
        "an <Audio> number of its own BEFORE any standalone sound. Naming a tag that doesn't " +
        "exist is rejected rather than ignored. Needs the ref2va weights — check " +
        "lab_catalog('video').minimax.reference.available first. Returns the job.",
      schema: {
        project: z.string().default("playground"),
        prompt: z
          .string()
          .min(1)
          .describe("the shot, naming its references by tag; H3 also performs whatever the " +
            "'Audio:' block describes"),
        images: z
          .array(z.string().min(1))
          .max(9)
          .default([])
          .describe("library relPaths of stills — these become <Picture 1>…<Picture 9>"),
        videos: z
          .array(minimaxRefVideoSchema)
          .max(3)
          .default([])
          .describe(
            "reference clips — { video: relPath, startSec, lengthSec, useItsAudio }. Keep each " +
              "to a few seconds: reference frames ride through every sampling step.",
          ),
        audios: z
          .array(z.string().min(1))
          .max(3)
          .default([])
          .describe("library relPaths of sound — a voice to keep, a piece of score to match"),
        imageSize: z
          .enum(["match", "max"])
          .default("match")
          .describe("'max' holds identity harder at several times the cost"),
        durationSec: z.number().min(4).max(15).default(5),
        resolution: z.string().default("1344 × 768"),
        seed: z.number().int().optional(),
      },
      handler: async ({ project, prompt, images, videos, audios, imageSize, ...rest }) => {
        await requireProject(project);
        return json(
          await api.labs.video.generate.mutate({
            ...rest,
            project,
            prompt,
            engine: "minimax-h3",
            minimaxRefs: { images, videos, audios, imageSize },
          }),
        );
      },
    }),

    defineTool({
      name: "shot_retake",
      title: "Retake part of a shot",
      description:
        "Re-render ONE window of a finished take in place, against the take itself — the fix for " +
        "a two-second artefact that would otherwise cost a whole re-roll. Everything outside the " +
        "window is the original's own pixels, so the cut is seamless. Keyframes, prompt beats and " +
        "voice takes do not apply, and the length, frame rate and size come from the source. Two " +
        "things to know: the window opens up to 8 frames EARLY (mark the bad bit, not its first " +
        "frame), and a retake fixes artefacts, not choreography — asked for a new action inside a " +
        "window pinned at both ends, LTX declines it. Returns the job.",
      schema: {
        project: z.string().default("playground"),
        source: z.string().min(1).describe("library relPath of the finished take (list_assets)"),
        atSec: z.number().min(0).describe("start of the window to re-render"),
        lengthSec: z.number().min(0.3).max(30).describe("how much of it to re-render"),
        prompt: z.string().min(1).describe("what the window should show instead"),
        shotPrompt: z
          .string()
          .optional()
          .describe("what the whole take is of — anchors the frames outside the window"),
        strength: z
          .number()
          .min(0)
          .max(1)
          .default(1)
          .describe("how far from the original the window may go"),
        regenerateAudio: z
          .boolean()
          .default(false)
          .describe("re-render the window's SOUND too; off keeps the original line under it"),
        seed: z.number().int().optional(),
      },
      handler: async ({ project, source, atSec, lengthSec, prompt, shotPrompt, strength, regenerateAudio, seed }) => {
        await requireProject(project);
        const anchor = shotPrompt?.trim() || prompt;
        return json(
          await api.labs.video.generate.mutate({
            project,
            prompt: anchor,
            seed,
            director: {
              globalPrompt: anchor,
              retake: { source, atSec, lengthSec, prompt, strength, regenerateAudio },
              inpaintAudio: regenerateAudio,
            },
          }),
        );
      },
    }),

    defineTool({
      name: "shot_from_storyboard",
      title: "Render a boarded shot",
      description:
        "Compose a boarded shot into a Director timeline and render it — the storyboard's own " +
        "answer to 'now shoot it'. The spec is composed from what the show already knows: the " +
        "selected keyframe becomes the start frame, each script line becomes a prompt beat that " +
        "names its speaker (and tells everyone else to keep their mouth shut, which is what " +
        "localises lip-sync), the bible's characters become cast references when this machine can " +
        "render them, and voice takes are laid on the audio lane at measured lengths. Pass takes " +
        "to say which wav speaks which character's line — generate_speech them first — and atSec " +
        "to place one exactly. dryRun returns the composed spec without rendering, which is the " +
        "way to check the beats before spending a render. The finished mp4 attaches to the shot " +
        "and moves it to 'generated'. Returns the job plus the spec and any composition notes.",
      schema: {
        ...shotRenderSchema.omit({ project: true }).shape,
        project: z.string().default("playground"),
        dryRun: z
          .boolean()
          .default(false)
          .describe("compose and return the spec without enqueueing a render"),
      },
      handler: async ({ project, dryRun, ...input }) => {
        await requireProject(project);
        if (dryRun) return json(await api.studio.board.shotSpec.query({ ...input, project }));
        return json(await api.studio.board.renderShot.mutate({ ...input, project }));
      },
    }),

    defineTool({
      name: "create_video",
      title: "Create finished video (videofast)",
      description:
        "Enqueue a complete short video through the videofast batch pipeline (script → voiceover → music " +
        "→ render → thumbnails). Pass format to pick the recipe (motivational, quote, imageMotion, " +
        "metaphor, dataStory, mathExplainer, generative, cinematic, whiteboard, strategist) and " +
        "stylePack to pin the look; omit account to auto-pick the channel built for that format. " +
        "Runs minutes, GPU-heavy — do not wait_for_job on it. Returns the job.",
      schema: {
        account: z
          .string()
          .min(1)
          .optional()
          .describe("account id — <videofastDir>/accounts/<id>.json; omit to derive from format"),
        topic: z.string().min(1).describe("what the video is about (drives the script)"),
        titleHint: z.string().optional().describe("title hint, or attribution for the quote format"),
        seed: z.number().int().optional(),
        format: z
          .string()
          .optional()
          .describe("format id from the videofast registry — overrides the account's format"),
        stylePack: z
          .string()
          .optional()
          .describe(
            "style pack id: noirLuxury, emberNoir, neuronGlow, therapyMinimal, kurzFlat, paperCollage, " +
              "blueprintSchematic, gradientMeshSoft, chalkboardManim, editorialMagazine, terminalGreen, sketchbook",
          ),
        paradigmMix: z
          .record(z.string(), z.number().min(0).max(1))
          .optional()
          .describe(
            "blend formats in ONE video: paradigm id → share, ONE dominant (≥ 0.5) plus any number of " +
              "contrasts, shares summing to 1 — e.g. {\"d3Data\": 0.6, \"jsx2d\": 0.4} is 60% charts + " +
              "40% 2D metaphors. One contrast is the tuned sweet spot; each extra visual language makes " +
              "the video busier (warn past two). Give each paradigm a DIFFERENT claim — a mix fails by " +
              "proving the same number twice in two languages long before it fails by looking busy. " +
              "ids: jsx2d (2D metaphors), svgChoreo (vector morphs), " +
              "d3Data (charts), p5Canvas (generative physics), r3f3d (3D heroes), parallax25d (2.5D " +
              "worlds), manimClip (Manim math). Sets format to strategist automatically; the dominant " +
              "picks the recipe.",
          ),
        durationSec: z
          .number()
          .int()
          .min(15)
          .max(300)
          .optional()
          .describe(
            "target runtime in seconds, 15-300 (word budget + scene count scale to it; lands within " +
              "~±15% since scenes retime to the spoken VO). Long-form targets exist: 180 = 3 min, " +
              "300 = 5 min. Omit for the channel's default, else the writer's natural 25-45s.",
          ),
        narrativeArc: z
          .enum(["problem-shift-payoff", "myth-bust", "countdown", "metaphor-journey", "data-story"])
          .optional()
          .describe("story shape for a blend (default problem-shift-payoff)"),
        visualMetaphor: z
          .string()
          .optional()
          .describe("blend only: the ONE concrete image the video hangs on (≥ 8 chars)"),
        hookStrategy: z
          .string()
          .optional()
          .describe("blend only: how the first two seconds grab (≥ 10 chars)"),
        avoid: z
          .array(z.string())
          .optional()
          .describe("blend only: worn-out images/angles to steer away from"),
        project: z.string().default("playground"),
      },
      handler: async ({
        account,
        topic,
        titleHint,
        seed,
        format,
        stylePack,
        paradigmMix,
        durationSec,
        narrativeArc,
        visualMetaphor,
        hookStrategy,
        avoid,
        project,
      }) => {
        await requireProject(project);
        const wantFormat = format ?? (paradigmMix ? "strategist" : undefined);
        if (!account) {
          const accounts = await api.videofast.accounts.query();
          account =
            (wantFormat ? accounts.find((a) => a.format === wantFormat)?.id : undefined) ??
            accounts.find((a) => a.id === "strategist-mind")?.id ??
            accounts[0]?.id;
          if (!account) {
            throw new Error("no videofast accounts found — set the videofast path in Settings → Storage");
          }
        }
        const brief = paradigmMix
          ? { paradigmMix, narrativeArc, visualMetaphor, hookStrategy, avoid }
          : undefined;
        const job = await api.jobs.enqueue.mutate({
          title: topic.length > 44 ? `${topic.slice(0, 43)}…` : topic,
          kind: "video",
          engine: "videofast",
          priority: "batch",
          detail: [
            account,
            brief ? `blend ${Object.keys(paradigmMix!).join("+")}` : wantFormat,
            stylePack,
            durationSec ? `~${durationSec}s` : undefined,
            "full pipeline",
          ]
            .filter(Boolean)
            .join(" · "),
          project: `/${project}`,
          payload: {
            type: "videofast",
            account,
            topic,
            titleHint,
            seed,
            format: wantFormat,
            stylePack,
            durationSec,
            brief,
          },
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
        "lines), the characters present, and a camera spec written in the cinematography bank's " +
        "vocabulary when one is installed (bible_get → cinematography): shotSize \"ws\", angle " +
        "\"low\", move \"push-in\", lighting \"sitcom.warm-home\", notes = a composition id or free " +
        "text — prompts expand ids to the full clauses. Respect the bank's rules (one move, one " +
        "lighting logic per shot; dance never tighter than ws). New shots start at status " +
        "\"draft\"; location defaults to the scene's.",
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
      name: "generate_keyframe",
      title: "Generate storyboard keyframe",
      description:
        "Board a shot: generate its keyframe still with qwen-edit reference consistency — character " +
        "bible refs keep the cast on-model, and the prompt is composed from the shot's script lines, " +
        "camera spec, location, and the style bible (pass prompt to override). Finished stills attach " +
        "to the shot's keyframes automatically and move a draft shot to boarded. Returns the job — " +
        "wait_for_job to see it land. Needs the shot to have characters with bible refs.",
      schema: withProjectDefault(storyboardGenerateSchema.omit({ project: true })),
      handler: async ({ project, ...input }) => {
        await requireProject(project);
        return json(await api.studio.board.generate.mutate({ ...input, project }));
      },
    }),

    defineTool({
      name: "bible_get",
      title: "Get bible",
      description:
        "The production bible — the persistent cast & world memory: characters (appearance slots, " +
        "identity anchors, personality, speech pattern, locked voice, reference images), locations, " +
        "the style bible (art direction, negative prompt), and the cinematography bank (shot-size/" +
        "angle/move/lens/lighting/composition clause banks + per-dancer camera signatures + grammar " +
        "rules — the vocabulary for shot camera specs). Consult it before writing dialogue, " +
        "describing a character, or speccing shots, and keep it authoritative: new recurring " +
        "characters/locations belong in the bible, not just in a script.",
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
      name: "import_cinematography",
      title: "Import cinematography bank",
      description:
        "Install the doc-26 cinematography prompt bible into bible.cinematography as structured " +
        "banks: shot sizes, angles, camera moves, lenses, lighting banks (dune/avatar/sitcom/" +
        "concert/universal), compositions, per-dancer camera signatures, crew formations, the " +
        "LTX/Seedance prompt templates, and the grammar rules. After importing, write shot camera " +
        "specs in bank vocabulary — shotSize \"ws\", angle \"low\", move \"push-in\", lighting " +
        "\"sitcom.warm-home\", notes \"symmetry\" — and composed prompts expand them to the full " +
        "paste-in clauses (free text still passes through). Replaces any existing bank.",
      schema: { project: z.string().default("playground") },
      handler: async ({ project }) => {
        await requireProject(project);
        const bible = await api.studio.bible.importCinematography.mutate({ project });
        const cine = bible.cinematography;
        return json({
          ok: true,
          shotSizes: cine.shotSizes.map((c) => c.id),
          angles: cine.angles.map((c) => c.id),
          moves: cine.moves.map((c) => c.id),
          lenses: cine.lenses.map((c) => c.id),
          compositions: cine.compositions.map((c) => c.id),
          lighting: cine.lighting.map((b) => ({ bank: b.id, entries: b.entries.map((e) => e.id) })),
          danceSignatures: cine.danceSignatures.map((d) => d.character),
          formations: cine.formations.map((f) => f.id),
        });
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
