/* The studiod tRPC surface. Iron rule (PRD): every feature lands here first —
 * the desktop renderer, the CLI, and the MCP server are all equal clients. */

import { on } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { InboxWatcher } from "./inbox.js";
import {
  enqueueJobSchema,
  imageDeckGenerateSchema,
  imageGenerateSchema,
  imageRefAddSchema,
  imageUpscaleGenerateSchema,
  libraryRemoveSchema,
  musicGenerateSchema,
  coverageStartSchema,
  model3dGenerateSchema,
  model3dFromPromptSchema,
  projectCreateSchema,
  projectRenameSchema,
  projectSetActiveSchema,
  directorSendSchema,
  directorThreadBindSchema,
  modelDownloadSchema,
  settingsUpdateSchema,
  timelineAddClipSchema,
  timelineExportSchema,
  timelineRemoveClipSchema,
  timelineUpdateClipSchema,
  timelineUpdateSchema,
  bibleGetSchema,
  bibleImportCinematographySchema,
  bibleRemoveCharacterSchema,
  bibleRemoveLocationSchema,
  bibleUpdateSchema,
  bibleUpdateStyleSchema,
  bibleUpsertCharacterSchema,
  bibleUpsertLocationSchema,
  productionAddEpisodeSchema,
  productionAddSceneSchema,
  productionAddShotSchema,
  productionApproveShotSchema,
  productionVerifyTakeSchema,
  productionNormalizeSchema,
  previewFields,
  randomSeed,
  bibleSeedRoomToneSchema,
  productionGetSchema,
  productionRetakeShotSchema,
  productionRemoveNodeSchema,
  productionUpdateEpisodeSchema,
  productionUpdateSceneSchema,
  productionUpdateSchema,
  productionUpdateShotSchema,
  promptDeckSaveSchema,
  qcSceneVoicesSchema,
  qcShotSchema,
  promptEnhanceSchema,
  promptPresetSaveSchema,
  composeKeyframePrompt,
  directionPhrases,
  lintDirectionNote,
  resolveKeyframeRefs,
  type Production,
  type Shot,
  shotComposeSchema,
  shotRenderSchema,
  tableReadSchema,
  sceneAssembleSchema,
  assemblyGetSchema,
  assemblyListSchema,
  storyboardGenerateSchema,
  studioSeedSchema,
  ttsGenerateSchema,
  videoAbSchema,
  videoPresetSaveSchema,
  videoGenerateSchema,
  videoFinishSchema,
  videoPayloadSchema,
  voiceAddSchema,
  voiceConvertGenerateSchema,
  rvcTrainGenerateSchema,
  voiceHideSchema,
  voiceRemoveSchema,
  voiceRenameSchema,
  voiceSourceAddSchema,
  type DirectorState,
  type DirectorThreads,
  type Job,
  type JobPayload,
  type ModelEntry,
  type RuntimeStatus,
  type StudioUpdateEvent,
  type Vram,
  videoEnhanceSystem,
} from "@aurea/shared";
import { describeExport, probeMedia, sequenceEnd } from "./adapters/ffmpeg-export.js";
import { upscaleCanvas } from "./comfy/ltx25-graph.js";
import { composeShotFromBoard } from "./shot-director.js";
import { qcSceneVoices, qcShotTake } from "./qc.js";
import { verifyDeliveredTake } from "./take-delivery.js";
import { roomTonePrompt } from "./take-verify.js";
import { normalizeProject } from "./normalize.js";
import { labEnqueue } from "./labs.js";
import { buildIsStale } from "./buildstamp.js";
import { removeAssets, scanLibrary, transcodeAsset } from "./library.js";
import { listVideofastAccounts } from "./videofast.js";
import { createCallerFactory, procedure, router, type Context } from "./trpc.js";

const jobId = z.object({ id: z.string() });

function requireProject(ctx: Context, project: string): void {
  if (!ctx.projects.list().some((p) => p.id === project)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `unknown project "${project}"` });
  }
}

/** Thread mutations fail on an unknown/closed thread or a thread that holds the
 * run lock. Both are the caller's problem to fix, not server faults. */
function threadOp<T>(op: () => T): T {
  try {
    return op();
  } catch (err) {
    throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
  }
}

/** enqueue a lab job into the target project (which must actually exist) */
function requireAssembly(ctx: Context) {
  if (!ctx.assembly) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "scene assembly is not running in this studiod" });
  return ctx.assembly;
}

function generate(ctx: Context, payload: JobPayload, project: string): Job {
  requireProject(ctx, project);
  return ctx.engine.enqueue(labEnqueue(payload, project));
}

export const appRouter = router({
  system: router({
    /** static-ish facts + the preflight strip for the job center */
    overview: procedure.query(({ ctx }) => ({
      // computed per request, not cached on the monitor: the bundle can be
      // rebuilt at any moment while the app is open, and the whole point is
      // to notice that without being restarted first
      system: { ...ctx.monitor.info, staleBuild: buildIsStale() },
      preflight: ctx.monitor.preflight(),
    })),

    vram: procedure.query(({ ctx }) => ctx.monitor.vram),

    onVram: procedure.subscription(async function* ({ ctx, signal }) {
      yield ctx.monitor.vram;
      for await (const [vram] of on(ctx.monitor, "vram", { signal })) {
        yield vram as Vram;
      }
    }),
  }),

  jobs: router({
    list: procedure.query(({ ctx }) => ctx.engine.snapshot()),

    enqueue: procedure
      .input(enqueueJobSchema)
      .mutation(({ ctx, input }) => ctx.engine.enqueue(input)),

    cancel: procedure.input(jobId).mutation(({ ctx, input }) => ctx.engine.cancel(input.id)),

    retry: procedure.input(jobId).mutation(({ ctx, input }) => ctx.engine.retry(input.id)),

    /** drop one finished job from the history (live jobs: cancel first) */
    dismiss: procedure.input(jobId).mutation(({ ctx, input }) => ctx.engine.dismiss(input.id)),

    /** drop the whole history; returns how many went */
    clearFinished: procedure.mutation(({ ctx }) => ctx.engine.clearFinished()),

    /** queue-level state the Job[] snapshot doesn't carry */
    state: procedure.query(({ ctx }) => ({ paused: ctx.engine.isPaused })),

    /** hold admission (running jobs are left to finish) or let it go again */
    setPaused: procedure
      .input(z.object({ paused: z.boolean() }))
      .mutation(({ ctx, input }) => ({ paused: ctx.engine.setPaused(input.paused) })),

    /** full-queue snapshots; small N, so no delta protocol yet */
    onSnapshot: procedure.subscription(async function* ({ ctx, signal }) {
      yield ctx.engine.snapshot();
      for await (const [jobs] of on(ctx.engine, "snapshot", { signal })) {
        yield jobs as Job[];
      }
    }),
  }),

  videofast: router({
    /** the channel presets the finished-video pipeline renders as */
    accounts: procedure.query(({ ctx }) => listVideofastAccounts(ctx.settings)),
  }),

  projects: router({
    list: procedure.query(({ ctx }) => ctx.projects.list()),

    /** The project's image inbox: the folder to drop Midjourney / GPT / Krea
     * stills into, and what has come in through it lately. `scan: true`
     * imports anything already settled without waiting for the next tick. */
    inbox: procedure
      .input(z.object({ project: z.string().min(1), scan: z.boolean().default(false) }))
      .query(async ({ ctx, input }) => {
        requireProject(ctx, input.project);
        const dir = InboxWatcher.dirFor(ctx.projects, input.project);
        fs.mkdirSync(dir, { recursive: true });
        if (input.scan && ctx.inbox) await ctx.inbox.scan();
        return {
          dir,
          recent: (ctx.inbox?.recent ?? []).filter((r) => r.project === input.project),
        };
      }),

    create: procedure
      .input(projectCreateSchema)
      .mutation(({ ctx, input }) => ctx.projects.create(input.name)),

    rename: procedure
      .input(projectRenameSchema)
      .mutation(({ ctx, input }) => ctx.projects.rename(input.id, input.name)),

    /** the project the app's screens act on (P6) — see ProjectStore.activeId */
    active: procedure.query(({ ctx }) => ({ id: ctx.projects.activeId() })),

    setActive: procedure
      .input(projectSetActiveSchema)
      .mutation(({ ctx, input }) => {
        try {
          return ctx.projects.setActive(input.id);
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),
  }),

  library: router({
    /** every real file in every project's assets tree, newest first */
    list: procedure.query(({ ctx }) => ({
      assets: scanLibrary(ctx.settings.get().storage.dataRoot, ctx.projects),
    })),

    /** delete files from disk for good — the folder IS the database, so there
     * is no trash to move them to and no row to soft-delete */
    remove: procedure.input(libraryRemoveSchema).mutation(({ ctx, input }) => ({
      removed: removeAssets(ctx.settings.get().storage.dataRoot, input.relPaths),
    })),

    /** hand a file back in another format — a track as .mp3 to send someone.
     * Lands in <dataRoot>/exports/, which the scanner doesn't walk, so a copy
     * of a track never shows up as a second track. */
    transcode: procedure
      .input(z.object({ relPath: z.string().min(1), format: z.enum(["mp3"]) }))
      .mutation(({ ctx, input }) =>
        transcodeAsset(ctx.settings.get().storage.dataRoot, input.relPath, input.format).then(
          (relPath) => ({ relPath }),
        ),
      ),
  }),

  labs: router({
    image: router({
      catalog: procedure.query(({ ctx }) => ctx.labs.imageCatalog()),
      generate: procedure.input(imageGenerateSchema).mutation(({ ctx, input }) => {
        const { project, ...payload } = input;
        return generate(ctx, { type: "image", ...payload }, project);
      }),
      /** bulk themed deck — one batch job renders every prompt into
       * assets/image/decks/<deck-slug>/ */
      generateDeck: procedure.input(imageDeckGenerateSchema).mutation(({ ctx, input }) => {
        const { project, ...payload } = input;
        return generate(ctx, { type: "imageDeck", ...payload }, project);
      }),
      /** enlarge an existing still — "fast" is a Real-ESRGAN 4× pass,
       * "refine" re-renders it at ~2K through qwen-edit + the Upscale2K LoRA */
      upscale: procedure.input(imageUpscaleGenerateSchema).mutation(({ ctx, input }) => {
        const { project, ...payload } = input;
        return generate(ctx, { type: "imageUpscale", ...payload }, project);
      }),
      /** stage an uploaded reference image as a project asset; returns its
       * dataRoot-relative path (what imagePayloadSchema.refs wants) */
      addRef: procedure.input(imageRefAddSchema).mutation(({ ctx, input }) => {
        requireProject(ctx, input.project);
        const bytes = Buffer.from(input.pngBase64, "base64");
        // PNG magic — the renderer re-encodes every picked file to PNG
        if (bytes.length < 64 || bytes.readUInt32BE(0) !== 0x89504e47) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "reference must be a PNG image" });
        }
        if (bytes.length > 32 * 1024 * 1024) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "reference too large (32 MB max)" });
        }
        return { ref: ctx.projects.importRef(input.project, input.name, "png", bytes) };
      }),
    }),
    voice: router({
      catalog: procedure.query(({ ctx }) => ctx.labs.voiceCatalog()),
      generate: procedure.input(ttsGenerateSchema).mutation(({ ctx, input }) => {
        const { project, ...payload } = input;
        const engine = ctx.labs.routeTtsEngine(payload.voice, payload.engine);
        return generate(ctx, { type: "tts", ...payload, engine }, project);
      }),
      /** freeze an uploaded/recorded sample as a named cloned voice */
      add: procedure.input(voiceAddSchema).mutation(({ ctx, input }) => {
        try {
          return ctx.labs.addVoice(input.name, Buffer.from(input.wavBase64, "base64"));
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),
      /** delete a studio voice's reference clip (videofast/preset voices are read-only) */
      remove: procedure.input(voiceRemoveSchema).mutation(({ ctx, input }) => {
        try {
          ctx.labs.removeVoice(input.id);
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),
      /** rename any voice for display — the id (and every reference to it) stays */
      rename: procedure.input(voiceRenameSchema).mutation(({ ctx, input }) => {
        try {
          return ctx.labs.renameVoice(input.id, input.name);
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),
      /** hide/restore a voice — works for read-only voices too, nothing is deleted */
      setHidden: procedure.input(voiceHideSchema).mutation(({ ctx, input }) => {
        try {
          ctx.labs.setVoiceHidden(input.id, input.hidden);
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),
      /** Seed-VC: re-voice existing audio (speech or singing) into a cloned voice */
      convert: procedure.input(voiceConvertGenerateSchema).mutation(({ ctx, input }) => {
        const { project, ...payload } = input;
        return generate(ctx, { type: "voiceConvert", ...payload }, project);
      }),
      /** train a per-voice RVC v2 model on Replicate (paid, ~15 min) —
       * unlocks the "rvc" conversion engine for that voice */
      trainRvc: procedure.input(rvcTrainGenerateSchema).mutation(({ ctx, input }) => {
        const { project, ...payload } = input;
        return generate(ctx, { type: "rvcTrain", ...payload }, project);
      }),
      /** stage an uploaded conversion source as a project voice asset; returns
       * its dataRoot-relative path (what voiceConvertPayloadSchema.source wants) */
      addSource: procedure.input(voiceSourceAddSchema).mutation(({ ctx, input }) => {
        requireProject(ctx, input.project);
        const bytes = Buffer.from(input.wavBase64, "base64");
        if (
          bytes.length < 1024 ||
          bytes.toString("ascii", 0, 4) !== "RIFF" ||
          bytes.toString("ascii", 8, 12) !== "WAVE"
        ) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "source must be a WAV file" });
        }
        if (bytes.length > 128 * 1024 * 1024) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "source too large (128 MB max)" });
        }
        return { source: ctx.projects.importBuffer(input.project, "audio", input.name, "wav", bytes) };
      }),
    }),
    music: router({
      catalog: procedure.query(({ ctx }) => ctx.labs.musicCatalog()),
      generate: procedure.input(musicGenerateSchema).mutation(({ ctx, input }) => {
        const { project, ...payload } = input;
        return generate(ctx, { type: "music", ...payload }, project);
      }),
      /** Draw this track's cover again. Covers are generated unasked when a
       * song finishes, so there has to be a way to say "not that one" —
       * and a way to get one at all for the tracks that predate them. */
      cover: procedure
        .input(z.object({ relPath: z.string().min(1), project: z.string().min(1) }))
        .mutation(({ ctx, input }) => {
          requireProject(ctx, input.project);
          const meta = ctx.projects.assetMeta(input.relPath);
          const job = ctx.labs.coverArtJob(input.relPath, input.project, {
            // a track with no sidecar still has a filename to draw from
            title: meta?.title ?? input.relPath.split("/").pop()?.replace(/\.[^.]+$/, ""),
            prompt: meta?.prompt,
            styles: meta?.styles,
          });
          if (!job) throw new Error("No local image engine installed — Settings → Engines");
          // a re-roll is something you're waiting on, unlike the automatic one
          return ctx.engine.enqueue({ ...job, priority: "interactive" });
        }),
    }),
    model3d: router({
      catalog: procedure.query(({ ctx }) => ctx.labs.model3dCatalog()),
      /** lift a still that already exists — a keyframe, a photo you dropped
       * in, a frame you liked — into a mesh */
      generate: procedure.input(model3dGenerateSchema).mutation(({ ctx, input }) => {
        const { project, ...payload } = input;
        return generate(ctx, { type: "model3d", ...payload }, project);
      }),
      /** The prompt path. This enqueues the IMAGE job, not the mesh job: the
       * concept still has to exist before anything can be lifted from it, so
       * the mesh job is chained when the still lands (server.ts importOutput,
       * the same way a music take chains its cover art). What comes back is
       * therefore an image job — the lab follows it to the model. */
      fromPrompt: procedure.input(model3dFromPromptSchema).mutation(({ ctx, input }) => {
        const { project, subject, model, ...options } = input;
        const catalog = ctx.labs.model3dCatalog();
        return generate(
          ctx,
          {
            type: "image",
            prompt: catalog.conceptPrompt.replace("{subject}", subject.trim()),
            model,
            // square, because the shape model orthographically frames a
            // centred subject and a wide plate just adds empty background
            aspect: "1:1",
            count: 1,
            refs: [],
            ...(options.seed !== undefined ? { seed: options.seed } : {}),
            model3d: { ...options, name: subject.trim().slice(0, 120) },
          },
          project,
        );
      }),
    }),
    video: router({
      catalog: procedure.query(({ ctx }) => ctx.labs.videoCatalog()),
      capabilities: procedure.query(({ ctx }) => ctx.labs.videoCapabilities()),
      /** Bring a still in from outside as a LIBRARY asset (assets/image/imports),
       * so it can be a start frame, an end frame or a keyframe like any
       * generated still. Same PNG contract as image.addRef; different shelf,
       * because a ref is deliberately kept out of the library and a start
       * frame has to be in it. Returns the dataRoot-relative path. */
      importStill: procedure.input(imageRefAddSchema).mutation(({ ctx, input }) => {
        requireProject(ctx, input.project);
        const bytes = Buffer.from(input.pngBase64, "base64");
        if (bytes.length < 64 || bytes.readUInt32BE(0) !== 0x89504e47) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "still must be a PNG image" });
        }
        if (bytes.length > 32 * 1024 * 1024) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "still too large (32 MB max)" });
        }
        return { relPath: ctx.projects.importAsset(input.project, "image", input.name, "png", bytes) };
      }),
      generate: procedure.input(videoGenerateSchema).mutation(({ ctx, input }) => {
        const { project, ...payload } = input;
        return generate(ctx, { type: "video", ...payload }, project);
      }),

      /** FINISH an existing take (Video Lab quality plan Q1 + Q2). The
       * whole payload is composed here from the take's sidecar — a caller
       * names the take and the mode, and the job card, the estimate and the
       * adapter all read one consistent request:
       *   refine  — needs a draft that kept its latents (AssetMeta.draftLatents);
       *             the payload mirrors the draft's request at full size
       *   upscale — any take with a video stream; the canvas is the source
       *             ×2 fitted to the card's cap (upscaleCanvas), the prompt
       *             the take's own */
      finish: procedure.input(videoFinishSchema).mutation(async ({ ctx, input }) => {
        requireProject(ctx, input.project);
        const meta = ctx.projects.assetMeta(input.source);
        const dataRoot = ctx.settings.get().storage.dataRoot;
        const file = path.join(dataRoot, input.source);
        if (!fs.existsSync(file)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `take not found: ${input.source}` });
        }
        const board = input.shotId ? { board: { shotId: input.shotId } } : {};
        try {
          if (input.mode === "refine") {
            const draft = meta?.draftLatents;
            if (!draft) {
              throw new Error(
                "this take kept no draft latents — only LTX 2.5 drafts rendered since the finish " +
                  "pass existed keep them. Render a draft of the shot, then finish that one.",
              );
            }
            const request = videoPayloadSchema.parse({ type: "video", ...draft.request });
            return generate(
              ctx,
              {
                ...request,
                fast: false,
                enhance: request.enhance,
                finish: { source: input.source, mode: "refine", strength: 1 },
                ...board,
              },
              input.project,
            );
          }
          const probe = await probeMedia(file);
          if (!probe.hasVideo || !probe.width || !probe.height || !probe.fps) {
            throw new Error(`"${input.source}" has no readable video stream`);
          }
          const canvas = upscaleCanvas(probe.width, probe.height);
          const fps = Math.round(probe.fps) === 48 ? 48 : 24;
          const prompt =
            meta?.prompt?.trim() ||
            (typeof meta?.draftLatents?.request.prompt === "string" ? meta.draftLatents.request.prompt : "") ||
            "The same shot, rendered with more detail.";
          return generate(
            ctx,
            {
              type: "video",
              engine: "ltx25",
              prompt,
              resolution: `${canvas.width} × ${canvas.height}`,
              durationSec: Math.max(1, Math.round((probe.duration ?? 5) * 100) / 100),
              fps,
              fast: false,
              enhance: false,
              keyframes: [],
              loras: [],
              seed: randomSeed(),
              finish: { source: input.source, mode: "upscale", strength: input.strength ?? 1 },
              ...board,
            },
            input.project,
          );
        } catch (err) {
          if (err instanceof TRPCError) throw err;
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),

      /** Queue one experiment: the same shot rendered N ways at one seed, at
       * batch priority, with a comparison record that outlives the queue. */
      ab: procedure.input(videoAbSchema).mutation(({ ctx, input }) => {
        requireProject(ctx, input.project);
        try {
          return ctx.ab.create(input);
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),

      abList: procedure
        .input(z.object({ project: z.string().optional() }).default({}))
        .query(({ ctx, input }) => ctx.ab.list(input.project)),

      abGet: procedure
        .input(z.object({ id: z.string().min(1) }))
        .query(({ ctx, input }) => ctx.ab.get(input.id)),

      abRemove: procedure
        .input(z.object({ id: z.string().min(1) }))
        .mutation(({ ctx, input }) => ({ removed: ctx.ab.remove(input.id) })),
    }),
  }),

  /* ---------- prompt library ---------- */
  prompts: router({
    /** presets visible to a project (global + its own), sorted by category */
    list: procedure
      .input(z.object({ project: z.string().optional() }).default({}))
      .query(({ ctx, input }) => ctx.prompts.presets(input.project)),

    save: procedure.input(promptPresetSaveSchema).mutation(({ ctx, input }) => {
      try {
        return ctx.prompts.savePreset(input);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
      }
    }),

    remove: procedure
      .input(z.object({ id: z.string().min(1) }))
      .mutation(({ ctx, input }) => ctx.prompts.removePreset(input.id)),

    /** shipped packs + the live "from the bible" pack for the project */
    packs: procedure
      .input(z.object({ project: z.string().optional() }).default({}))
      .query(({ ctx, input }) =>
        ctx.prompts.packs(
          input.project,
          input.project ? ctx.studio.getBible(input.project) : null,
        ),
      ),

    /** render lanes for the Video lab — the Image lab's preset idea, applied
     * to everything a video render is besides its prompt */
    videoPresets: procedure
      .input(z.object({ project: z.string().optional() }).default({}))
      .query(({ ctx, input }) => ctx.prompts.videoPresets(input.project)),

    videoPresetSave: procedure.input(videoPresetSaveSchema).mutation(({ ctx, input }) => {
      try {
        return ctx.prompts.saveVideoPreset(input);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
      }
    }),

    videoPresetRemove: procedure
      .input(z.object({ id: z.string().min(1) }))
      .mutation(({ ctx, input }) => ctx.prompts.removeVideoPreset(input.id)),

    deckList: procedure.query(({ ctx }) => ctx.prompts.decks()),

    deckSave: procedure.input(promptDeckSaveSchema).mutation(({ ctx, input }) => {
      try {
        return ctx.prompts.saveDeck(input);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
      }
    }),

    deckRemove: procedure
      .input(z.object({ id: z.string().min(1) }))
      .mutation(({ ctx, input }) => ctx.prompts.removeDeck(input.id)),

    /** one-shot agent expansion of a prompt, steered by the project's art
     * direction — runs on the same local Claude login the Director uses */
    enhance: procedure.input(promptEnhanceSchema).mutation(async ({ ctx, input }) => {
      const bible = input.projectId ? ctx.studio.getBible(input.projectId) : null;
      const art = bible?.style.artDirection.trim();
      const negative = bible?.style.negativePrompt.trim();
      // video carries the freeform composer's six rules (shared/freeform.ts)
      // so the expansion cannot undo what the composer writes after it
      const system =
        input.intent === "video"
          ? videoEnhanceSystem({ art, negative, look: input.look, mode: input.mode })
          : "You expand terse image prompts into rich, specific, render-ready prompts " +
            "for diffusion models. Keep the user's subject and intent exactly; add concrete " +
            "visual language — lighting, lens, materials, composition, palette. One paragraph, " +
            "no lists, no preamble, no quotes. Return ONLY the improved prompt." +
            (art ? `

This project's locked art direction (respect it):
${art}` : "") +
            (negative ? `

Never include: ${negative}` : "");
      try {
        return { enhanced: await ctx.director.oneShot(input.prompt, system) };
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: String((err as Error).message),
        });
      }
    }),
  }),

  director: router({
    /** the switcher's list. threadId is optional everywhere below — omitted, the
     * project's persisted active thread answers. */
    threads: procedure
      .input(z.object({ project: z.string().min(1) }))
      .query(({ ctx, input }) => ctx.director.threadList(input.project)),

    /** the list + who holds the run lock. Separate from onUpdate because that
     * one is filtered to a single thread, so it can't report a sibling's run
     * starting or ending. */
    onThreads: procedure
      .input(z.object({ project: z.string().min(1) }))
      .subscription(async function* ({ ctx, input, signal }) {
        yield ctx.director.threadList(input.project);
        for await (const [list] of on(ctx.director, "threads", { signal })) {
          const next = list as DirectorThreads;
          if (next.project === input.project) yield next;
        }
      }),

    createThread: procedure
      .input(
        z.object({
          project: z.string().min(1),
          title: z.string().trim().max(80).optional(),
          bind: directorThreadBindSchema.nullish(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.director.createThread(input.project, input.title, input.bind ?? null),
      ),

    renameThread: procedure
      .input(
        z.object({
          project: z.string().min(1),
          threadId: z.string().min(1),
          title: z.string().trim().min(1).max(80),
        }),
      )
      .mutation(({ ctx, input }) =>
        threadOp(() => ctx.director.renameThread(input.project, input.threadId, input.title)),
      ),

    /** read-only + collapsed, never a delete — the chat file survives */
    closeThread: procedure
      .input(z.object({ project: z.string().min(1), threadId: z.string().min(1) }))
      .mutation(({ ctx, input }) =>
        threadOp(() => ctx.director.closeThread(input.project, input.threadId)),
      ),

    reopenThread: procedure
      .input(z.object({ project: z.string().min(1), threadId: z.string().min(1) }))
      .mutation(({ ctx, input }) =>
        threadOp(() => ctx.director.reopenThread(input.project, input.threadId)),
      ),

    deleteThread: procedure
      .input(z.object({ project: z.string().min(1), threadId: z.string().min(1) }))
      .mutation(({ ctx, input }) =>
        threadOp(() => ctx.director.deleteThread(input.project, input.threadId)),
      ),

    setActiveThread: procedure
      .input(z.object({ project: z.string().min(1), threadId: z.string().min(1) }))
      .mutation(({ ctx, input }) =>
        threadOp(() => ctx.director.setActiveThread(input.project, input.threadId)),
      ),

    get: procedure
      .input(z.object({ project: z.string().min(1), threadId: z.string().optional() }))
      .query(({ ctx, input }) => ctx.director.get(input.project, input.threadId)),

    send: procedure.input(directorSendSchema).mutation(({ ctx, input }) => {
      if (!ctx.projects.list().some((p) => p.id === input.project)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `unknown project "${input.project}"` });
      }
      try {
        return ctx.director.send(input.project, input.threadId, input.text, input.attachments);
      } catch (err) {
        throw new TRPCError({ code: "CONFLICT", message: String((err as Error).message) });
      }
    }),

    /** abort the in-flight Claude run; no-op when the Director is idle. The run
     * lock is per project, so this stops whichever thread holds it. */
    stop: procedure
      .input(z.object({ project: z.string().min(1), threadId: z.string().optional() }))
      .mutation(({ ctx, input }) => ctx.director.stop(input.project, input.threadId)),

    /** full-thread snapshots per update — chats are short, so no delta protocol.
     * The threadId filter matters: without it a background run's stream lands in
     * whichever thread the panel happens to be showing. */
    onUpdate: procedure
      .input(z.object({ project: z.string().min(1), threadId: z.string().optional() }))
      .subscription(async function* ({ ctx, input, signal }) {
        const threadId = input.threadId ?? ctx.director.activeThreadId(input.project);
        yield ctx.director.get(input.project, threadId);
        for await (const [state] of on(ctx.director, "update", { signal })) {
          const next = state as DirectorState;
          if (next.project === input.project && next.threadId === threadId) yield next;
        }
      }),
  }),

  timeline: router({
    get: procedure
      .input(z.object({ project: z.string().min(1) }))
      .query(({ ctx, input }) => ctx.timelines.get(input.project)),

    /** whole-document save — sequences are small, the renderer owns edit state */
    update: procedure.input(timelineUpdateSchema).mutation(({ ctx, input }) => {
      if (!ctx.projects.list().some((p) => p.id === input.project)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `unknown project "${input.project}"` });
      }
      return ctx.timelines.update(input.project, input.timeline);
    }),

    /* granular clip ops — the Director's edit surface over the same file */

    addClip: procedure.input(timelineAddClipSchema).mutation(async ({ ctx, input }) => {
      requireProject(ctx, input.project);
      try {
        const { project, ...rest } = input;
        return await ctx.timelines.addClip(project, rest);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
      }
    }),

    updateClip: procedure.input(timelineUpdateClipSchema).mutation(({ ctx, input }) => {
      requireProject(ctx, input.project);
      try {
        return ctx.timelines.updateClip(input.project, input.clip, input.patch);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
      }
    }),

    removeClip: procedure.input(timelineRemoveClipSchema).mutation(({ ctx, input }) => {
      requireProject(ctx, input.project);
      try {
        return ctx.timelines.removeClip(input.project, input.clip);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
      }
    }),

    /** render the saved sequence to an mp4 — enqueues an ffmpeg job on the cpu lane */
    export: procedure.input(timelineExportSchema).mutation(({ ctx, input }) => {
      requireProject(ctx, input.project);
      const timeline = ctx.timelines.get(input.project);
      if (sequenceEnd(timeline) <= 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "the timeline is empty — add clips before exporting" });
      }
      const name = ctx.projects.list().find((p) => p.id === input.project)?.name ?? input.project;
      return ctx.engine.enqueue({
        title: `Export — ${name}`,
        kind: "video",
        engine: "ffmpeg",
        priority: "interactive",
        detail: describeExport(timeline),
        project: `/${input.project}`,
        payload: {
          type: "export",
          project: input.project,
          timeline,
          loudnessLufs: input.loudnessLufs,
        },
      });
    }),
  }),

  studio: router({
    /* the V2 Studio data spine: production.json + bible.json per project.
     * Whole-document saves for the renderer, granular ops for the Director —
     * same file, both surfaces interchangeable (timeline precedent). */

    /* The coverage pass: one approved plate, eight on-model angles of the
     * same room, in one render. The canon library's Angles tab is the
     * consumer — see coverage.ts for why the record outlives the queue. */
    canon: router({
      coverage: procedure.input(coverageStartSchema).mutation(({ ctx, input }) => {
        requireProject(ctx, input.project);
        try {
          return ctx.coverage.create(input);
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),

      coverageList: procedure
        .input(
          z
            .object({ project: z.string().optional(), location: z.string().optional() })
            .default({}),
        )
        .query(({ ctx, input }) => ctx.coverage.list(input.project, input.location)),

      coverageGet: procedure
        .input(z.object({ id: z.string().min(1) }))
        .query(({ ctx, input }) => ctx.coverage.get(input.id)),

      coverageRemove: procedure
        .input(z.object({ id: z.string().min(1) }))
        .mutation(({ ctx, input }) => ({ removed: ctx.coverage.remove(input.id) })),
    }),

    production: router({
      get: procedure.input(productionGetSchema).query(({ ctx, input }) => {
        requireProject(ctx, input.project);
        return ctx.studio.getProduction(input.project);
      }),

      update: procedure.input(productionUpdateSchema).mutation(({ ctx, input }) => {
        requireProject(ctx, input.project);
        return ctx.studio.updateProduction(input.project, input.production);
      }),

      addEpisode: procedure.input(productionAddEpisodeSchema).mutation(({ ctx, input }) => {
        requireProject(ctx, input.project);
        const { project, ...rest } = input;
        return ctx.studio.addEpisode(project, rest);
      }),

      addScene: procedure.input(productionAddSceneSchema).mutation(({ ctx, input }) => {
        requireProject(ctx, input.project);
        try {
          const { project, ...rest } = input;
          return ctx.studio.addScene(project, rest);
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),

      addShot: procedure.input(productionAddShotSchema).mutation(({ ctx, input }) => {
        requireProject(ctx, input.project);
        try {
          const { project, ...rest } = input;
          return ctx.studio.addShot(project, rest);
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),

      updateEpisode: procedure.input(productionUpdateEpisodeSchema).mutation(({ ctx, input }) => {
        requireProject(ctx, input.project);
        try {
          return ctx.studio.updateEpisode(input.project, input.episodeId, input.patch);
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),

      updateScene: procedure.input(productionUpdateSceneSchema).mutation(({ ctx, input }) => {
        requireProject(ctx, input.project);
        try {
          return ctx.studio.updateScene(input.project, input.sceneId, input.patch);
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),

      updateShot: procedure.input(productionUpdateShotSchema).mutation(({ ctx, input }) => {
        requireProject(ctx, input.project);
        try {
          return ctx.studio.updateShot(input.project, input.shotId, input.patch);
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),

      /** Desk verdict (P1): lock a rendered take as the shot's pick, approve
       * the shot, and drop the take on the sequence's video track (server-side
       * addClip, so the duration is ffprobe'd and clips land in approve
       * order — script order when you approve in order). */
      approveShot: procedure.input(productionApproveShotSchema).mutation(async ({ ctx, input }) => {
        requireProject(ctx, input.project);
        try {
          const { shot, take, production } = ctx.studio.approveShot(
            input.project,
            input.shotId,
            input.takeId,
            input.force,
          );
          /* a preview's approval (P5) is a blocking verdict, not a cut:
           * nothing lands on the sequence — the seed is carried instead */
          if (take.preview) {
            return { shot, take, production, clip: null, timeline: ctx.timelines.get(input.project) };
          }
          const { clip } = await ctx.timelines.addClip(input.project, {
            asset: take.asset,
            track: "video",
            label: shot.title || shot.id,
          });
          /* …then re-lay the base track in the production's own order. The
           * desk approves in review order, which is not script order, and a
           * cut assembled in approve order was wrong silently (defect #10). */
          const timeline = ctx.timelines.orderVideoTrack(
            input.project,
            ctx.studio.approvedTakeAssets(input.project),
          );
          return { shot, take, production, clip, timeline };
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),

      /** Hard verification on demand (P3.1): re-measure a take — one from
       * before delivery verification existed, or after a room-tone bed was
       * seeded for its location. Same path the import hook runs. */
      verifyTake: procedure.input(productionVerifyTakeSchema).mutation(async ({ ctx, input }) => {
        requireProject(ctx, input.project);
        try {
          const { shot } = ctx.studio.getShotContext(input.project, input.shotId);
          const take = input.takeId
            ? shot.videoTakes.find((t) => t.id === input.takeId)
            : (shot.videoTakes.find((t) => t.id === shot.selectedTake) ?? shot.videoTakes.at(-1));
          if (!take) throw new Error(input.takeId ? `unknown take "${input.takeId}"` : "no rendered takes to verify");
          /* intent as it composes today — placed lines mean silence is a failure */
          const composed = await composeShotFromBoard(ctx, { project: input.project, shotId: input.shotId }).catch(() => null);
          const expectAudio = composed ? composed.director.audio.length > 0 || composed.director.inpaintAudio : false;
          const result = await verifyDeliveredTake(ctx, input.project, input.shotId, take.id, {
            expectAudio,
            requestedDurationSec: take.durationSec ?? composed?.durationSec ?? null,
          });
          const after = ctx.studio.getShotContext(input.project, input.shotId).shot;
          return { ...result, takeId: take.id, shot: after, production: ctx.studio.getProduction(input.project) };
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),

      /** Project hygiene (P4): adopt a canvas, re-lay the base track in the
       * production's order, re-export at the delivery loudness. The explicit
       * override of the two once-only automatic rules. dryRun = the diff. */
      normalize: procedure.input(productionNormalizeSchema).mutation(async ({ ctx, input }) => {
        requireProject(ctx, input.project);
        try {
          return await normalizeProject(ctx, input);
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),

      /** Desk verdict (P1): record the direction note on the shot, then
       * re-render it — the note (and every earlier one) rides the composed
       * prompt via composeShotSpec. A shot with no keyframe keeps the note and
       * skips the render: direction must survive a boarding gap. */
      retakeShot: procedure.input(productionRetakeShotSchema).mutation(async ({ ctx, input }) => {
        requireProject(ctx, input.project);
        try {
          const { note, fix, allowDiagnosis, resolution, seed, ...compose } = input;
          /* A note lands in the prompt verbatim, so a note that describes the
           * failure injects it (defect #8). Instructions only, unless waved. */
          if (!allowDiagnosis) {
            const lint = lintDirectionNote(note);
            if (lint) throw new Error(lint);
          }
          let noted: { shot: Shot; production: Production } | undefined;
          for (const phrase of directionPhrases(fix, note)) {
            noted = ctx.studio.addTakeNote(input.project, input.shotId, phrase);
          }
          if (!noted) throw new Error("a retake needs a direction: a note, a fix, or both");
          const { shot, production } = noted;
          const composed = await composeShotFromBoard(ctx, compose);
          if (!composed.startFrame) {
            return {
              job: null,
              spec: composed.director,
              durationSec: composed.durationSec,
              notes: [
                ...composed.notes,
                "No keyframe — the note is saved on the shot; board it, then render.",
              ],
              shot,
              production,
            };
          }
          /* The caller's canvas wins only when they NAMED one — an absent
           * resolution must leave the lane's own in place (defect #3). */
          /* the seed is assigned here so it lands on the take (P5) — a retake
           * is a new roll by default; pass seed to hold the dice */
          const payload: JobPayload = {
            type: "video",
            ...composed.videoInput,
            ...(resolution ? { resolution } : {}),
            seed: seed ?? randomSeed(),
          };
          return {
            job: generate(ctx, payload, input.project),
            spec: composed.director,
            durationSec: composed.durationSec,
            seed: payload.seed,
            notes: composed.notes,
            rulesFired: composed.rulesFired,
            shot,
            production,
          };
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),

      removeEpisode: procedure.input(productionRemoveNodeSchema).mutation(({ ctx, input }) => {
        requireProject(ctx, input.project);
        try {
          return ctx.studio.removeEpisode(input.project, input.id);
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),

      removeScene: procedure.input(productionRemoveNodeSchema).mutation(({ ctx, input }) => {
        requireProject(ctx, input.project);
        try {
          return ctx.studio.removeScene(input.project, input.id);
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),

      removeShot: procedure.input(productionRemoveNodeSchema).mutation(({ ctx, input }) => {
        requireProject(ctx, input.project);
        try {
          return ctx.studio.removeShot(input.project, input.id);
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),
    }),

    board: router({
      /** Storyboard: compose the shot's keyframe prompt + reference stack and
       * enqueue qwen-edit generation. Finished stills auto-attach to the shot
       * (JobEngine import hook) and broadcast over studio.onUpdate. */
      generate: procedure.input(storyboardGenerateSchema).mutation(({ ctx, input }) => {
        requireProject(ctx, input.project);
        try {
          const { shot, scene } = ctx.studio.getShotContext(input.project, input.shotId);
          const bible = ctx.studio.getBible(input.project);
          const refs = resolveKeyframeRefs(shot, scene, bible);
          if (refs.length === 0) {
            throw new Error(
              "no reference images for this shot — give it characters with bible refs (seed the Animal Sitcom bible, or add refs in /bible) first",
            );
          }
          const prompt = input.prompt?.trim() || composeKeyframePrompt(shot, scene, bible);
          return ctx.engine.enqueue({
            title: `Keyframe — ${shot.title || shot.id}`,
            kind: "image",
            engine: "Qwen Edit 2509",
            priority: "interactive",
            detail: `${input.aspect} · ${input.count} take${input.count === 1 ? "" : "s"} · ${refs.length} ref${refs.length === 1 ? "" : "s"}`,
            project: `/${input.project}`,
            payload: {
              type: "image",
              prompt,
              model: "qwen-edit",
              aspect: input.aspect,
              seed: input.seed,
              count: input.count,
              refs,
              board: { shotId: shot.id },
            },
          });
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),

      /** Shot Director: a boarded shot → a renderable Director spec (beats
       * from the script lines, cast refs from the bible, the audio lane from
       * measured voice takes). Read-only — the Storyboard's "Send to Director"
       * previews it, and shot_from_storyboard renders the same thing. */
      shotSpec: procedure.input(shotComposeSchema).query(async ({ ctx, input }) => {
        requireProject(ctx, input.project);
        try {
          return await composeShotFromBoard(ctx, input);
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),

      /** …and render it. The composed spec rides back with the job so callers
       * can see what was assumed without recomposing. */
      renderShot: procedure.input(shotRenderSchema).mutation(async ({ ctx, input }) => {
        requireProject(ctx, input.project);
        try {
          const composed = await composeShotFromBoard(ctx, input);
          if (!composed.startFrame) {
            throw new Error(
              `shot "${input.shotId}" has no keyframe — board it first (generate_keyframe)`,
            );
          }
          const { shot } = ctx.studio.getShotContext(input.project, input.shotId);
          /* The seed is assigned HERE, not in the adapter, so it is recorded
           * on the take (P5): a preview's seed is what its approval carries
           * into the full render, and a full render without a seed of its
           * own rolls the approved preview's. */
          const carried = !input.preview && input.seed === undefined ? shot.approvedPreview?.seed : undefined;
          const seed = input.seed ?? carried ?? randomSeed();
          const notes = [...composed.notes];
          if (carried !== undefined) notes.push(`Seed ${carried} carried from the approved preview.`);
          const preview = input.preview ? previewFields(composed.videoInput) : null;
          if (preview) {
            notes.push(
              `Preview: ${preview.durationSec}s at ${preview.resolution}, draft tier, enhancer off, no audio — approve it to carry seed ${seed} into the render.`,
            );
          }
          const payload: JobPayload = {
            type: "video",
            ...composed.videoInput,
            ...(input.resolution ? { resolution: input.resolution } : {}),
            ...(preview ?? {}),
            seed,
            board: { shotId: input.shotId, ...(preview ? { preview: true } : {}) },
          };
          return {
            job: generate(ctx, payload, input.project),
            spec: composed.director,
            durationSec: payload.durationSec,
            seed,
            preview: !!preview,
            notes,
            rulesFired: composed.rulesFired,
          };
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),
    }),

    voice: router({
      /** Table read: one call voices a whole scene. Walks the scene's dialogue
       * lines in script order and enqueues one TTS job per line in that
       * character's cast voice; finished wavs attach to the owning shot's
       * voTakes tagged with the line id (server import hook + studio.onUpdate,
       * the storyboard delivery pattern). Lines whose character has no cast
       * voice come back in `skipped` — never voiced with a guessed voice. */
      tableRead: procedure.input(tableReadSchema).mutation(({ ctx, input }) => {
        requireProject(ctx, input.project);
        try {
          const scene = ctx.studio.getScene(input.project, input.sceneId);
          const bible = ctx.studio.getBible(input.project);
          const only = new Set(input.lineIds);
          const queued: Array<{ job: Job; shotId: string; lineId: string; character: string }> = [];
          const skipped: Array<{ lineId: string; reason: string }> = [];

          for (const shot of scene.shots) {
            for (const line of shot.scriptLines) {
              if (only.size && !only.has(line.id)) continue;
              if (!line.character || !line.text.trim()) continue; // action lines don't speak
              const character = bible.characters.find((c) => c.id === line.character);
              if (!character?.voice.voiceId) {
                skipped.push({
                  lineId: line.id,
                  reason: `${character?.name ?? line.character} has no cast voice — cast one in /bible`,
                });
                continue;
              }
              const v = character.voice;
              const engine = ctx.labs.routeTtsEngine(v.voiceId!, v.engine);
              // the bible stores Chatterbox's exaggeration directly; the TTS
              // payload speaks emotion 0..1, which the adapter maps back as
              // exag = 0.25 + emotion * 0.75 — invert so the cast knob wins
              const emotion = Math.min(1, Math.max(0, (v.exaggeration - 0.25) / 0.75));
              // DramaBox performs stage directions instead of reading them —
              // the one engine where a delivery note belongs in the text
              const direction =
                engine === "dramabox" && (line.deliveryNotes || v.deliveryNotes)
                  ? `(${line.deliveryNotes || v.deliveryNotes}) `
                  : "";
              queued.push({
                job: generate(
                  ctx,
                  {
                    type: "tts",
                    text: `${direction}${line.text.trim()}`,
                    voice: v.voiceId!,
                    engine,
                    pace: 1,
                    emotion,
                    board: { shotId: shot.id, lineId: line.id },
                  },
                  input.project,
                ),
                shotId: shot.id,
                lineId: line.id,
                character: character.name,
              });
            }
          }
          return { queued, skipped };
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),
    }),

    /** Scene assembly (N1.1): plan → execute. `plan` is read-only — the
     * concrete step list and a GPU estimate for the confirm dialog (and the
     * Director's preview). `start` runs the same plan as a background batch
     * over the very procedures the Desk calls; jobs carry the batch id. Re-run
     * is the resume. Gates stay human: see sceneAssembleSchema.through. */
    assembly: router({
      plan: procedure.input(sceneAssembleSchema).query(({ ctx, input }) => {
        requireProject(ctx, input.project);
        try {
          return requireAssembly(ctx).plan(input);
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),
      start: procedure.input(sceneAssembleSchema).mutation(({ ctx, input }) => {
        requireProject(ctx, input.project);
        try {
          return requireAssembly(ctx).start(input);
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
      }),
      get: procedure.input(assemblyGetSchema).query(({ ctx, input }) => {
        const batch = requireAssembly(ctx).get(input.id);
        if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: `unknown assembly batch "${input.id}"` });
        return batch;
      }),
      list: procedure.input(assemblyListSchema).query(({ ctx, input }) => requireAssembly(ctx).list(input.project)),
      cancel: procedure.input(assemblyGetSchema).mutation(({ ctx, input }) => {
        const batch = requireAssembly(ctx).cancel(input.id);
        if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: `unknown assembly batch "${input.id}"` });
        return batch;
      }),
    }),

    bible: router({
      get: procedure.input(bibleGetSchema).query(({ ctx, input }) => {
        requireProject(ctx, input.project);
        return ctx.studio.getBible(input.project);
      }),

      update: procedure.input(bibleUpdateSchema).mutation(({ ctx, input }) => {
        requireProject(ctx, input.project);
        return ctx.studio.updateBible(input.project, input.bible);
      }),

      upsertCharacter: procedure.input(bibleUpsertCharacterSchema).mutation(({ ctx, input }) => {
        requireProject(ctx, input.project);
        return ctx.studio.upsertCharacter(input.project, input.character);
      }),

      removeCharacter: procedure.input(bibleRemoveCharacterSchema).mutation(({ ctx, input }) => {
        requireProject(ctx, input.project);
        return ctx.studio.removeCharacter(input.project, input.id);
      }),

      upsertLocation: procedure.input(bibleUpsertLocationSchema).mutation(({ ctx, input }) => {
        requireProject(ctx, input.project);
        return ctx.studio.upsertLocation(input.project, input.location);
      }),
      /** Room-tone bed for a location (P3.2): point at a library file, or
       * seed one from ACE-Step — the finished track lands on the location via
       * the import hook (payload.roomTone). */
      seedRoomTone: procedure.input(bibleSeedRoomToneSchema).mutation(({ ctx, input }) => {
        requireProject(ctx, input.project);
        const bible = ctx.studio.getBible(input.project);
        const location = bible.locations.find((l) => l.id === input.locationId);
        if (!location) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `unknown location "${input.locationId}"` });
        }
        if (input.source !== undefined) {
          return { bible: ctx.studio.setLocationRoomTone(input.project, input.locationId, input.source), job: null };
        }
        const job = generate(
          ctx,
          {
            type: "music",
            engine: "acestep",
            description: roomTonePrompt(location),
            styles: ["ambient", "field recording", "room tone", "atmosphere"],
            durationSec: input.durationSec,
            arrangement: "instrumental",
            language: "unknown",
            duet: false,
            roomTone: { location: input.locationId },
          },
          input.project,
        );
        return { bible, job };
      }),

      removeLocation: procedure.input(bibleRemoveLocationSchema).mutation(({ ctx, input }) => {
        requireProject(ctx, input.project);
        return ctx.studio.removeLocation(input.project, input.id);
      }),

      updateStyle: procedure.input(bibleUpdateStyleSchema).mutation(({ ctx, input }) => {
        requireProject(ctx, input.project);
        return ctx.studio.updateStyle(input.project, input.style);
      }),

      /** install the doc-26 cinematography bank (or a caller-provided one) */
      importCinematography: procedure
        .input(bibleImportCinematographySchema)
        .mutation(({ ctx, input }) => {
          requireProject(ctx, input.project);
          return ctx.studio.importCinematography(input.project, input.cinematography);
        }),
    }),

    /** one event per production.json/bible.json save, whoever wrote it —
     * how an open Writers Room watches the Director draft in real time */
    onUpdate: procedure.subscription(async function* ({ ctx, signal }) {
      for await (const [event] of on(ctx.studio, "update", { signal })) {
        yield event as StudioUpdateEvent;
      }
    }),

    /** populate the Animal Sitcom bible from the videofast repo (idempotent) */
    seedAnimalSitcom: procedure.input(studioSeedSchema).mutation(({ ctx, input }) => {
      requireProject(ctx, input.project);
      try {
        return ctx.studio.seedAnimalSitcom(input.project, input.overwrite);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
      }
    }),
  }),

  /* ---------- QC (P2) — the crew's own judgment calls ----------
   * Measurement, not taste: what ffmpeg can prove about a take (cuts vs the
   * composed intent, audio integrity, articulation during speech windows,
   * per-character f0 consistency), plus review artifacts for the vision
   * checks only eyes can do. Runs ffmpeg inline — seconds, not a job. */
  qc: router({
    shot: procedure.input(qcShotSchema).mutation(async ({ ctx, input }) => {
      requireProject(ctx, input.project);
      try {
        return await qcShotTake(ctx, input);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
      }
    }),

    sceneVoices: procedure.input(qcSceneVoicesSchema).mutation(async ({ ctx, input }) => {
      requireProject(ctx, input.project);
      try {
        return await qcSceneVoices(ctx, input);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
      }
    }),
  }),

  models: router({
    /** the curated registry with live install status per entry */
    list: procedure.query(({ ctx }) => ctx.models.list()),

    /** start (or resume) a download; gated licenses need acceptLicense once */
    download: procedure.input(modelDownloadSchema).mutation(({ ctx, input }) => {
      try {
        return ctx.models.download(input.id, input.acceptLicense);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
      }
    }),

    /** stop an in-flight download — partial files stay for a later resume */
    cancel: procedure.input(jobId).mutation(({ ctx, input }) => ctx.models.cancel(input.id)),

    /** delete a model's files from disk (refuses for linked models — those
     * files belong to the user, not to us) */
    remove: procedure.input(jobId).mutation(({ ctx, input }) => {
      try {
        return ctx.models.remove(input.id);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
      }
    }),

    /** What would linking this folder give us? Answers "we found 6 models,
     * 23 GB you don't need to download" before anything is saved. */
    previewRoot: procedure
      .input(z.object({ root: z.string().min(1) }))
      .query(({ ctx, input }) => ({ models: ctx.models.previewRoot(input.root) })),

    /** Add/remove a linked model root. Rewrites extra_model_paths.yaml so the
     * managed ComfyUI picks the folder up on its next start. */
    linkRoot: procedure
      .input(z.object({ root: z.string().min(1) }))
      .mutation(({ ctx, input }) => {
        const roots = ctx.settings.get().storage.modelRoots;
        const root = input.root.replace(/[\\/]+$/, "");
        if (!roots.includes(root)) {
          ctx.settings.update({ storage: { modelRoots: [...roots, root] } });
          ctx.runtime.writeExtraModelPaths();
          ctx.models.refresh();
        }
        return ctx.models.list();
      }),

    unlinkRoot: procedure
      .input(z.object({ root: z.string().min(1) }))
      .mutation(({ ctx, input }) => {
        const roots = ctx.settings.get().storage.modelRoots.filter((r) => r !== input.root);
        ctx.settings.update({ storage: { modelRoots: roots } });
        ctx.runtime.writeExtraModelPaths();
        ctx.models.refresh();
        return ctx.models.list();
      }),

    /** registry snapshots — throttled to ~2/s while a download streams */
    onUpdate: procedure.subscription(async function* ({ ctx, signal }) {
      yield ctx.models.list();
      for await (const [list] of on(ctx.models, "update", { signal })) {
        yield list as ModelEntry[];
      }
    }),
  }),

  runtime: router({
    /** the managed engine substrate (portable Python + headless ComfyUI) */
    status: procedure.query(({ ctx }) => ctx.runtime.status()),

    /** install (or resume installing) whatever isn't ready; idempotent */
    install: procedure.mutation(({ ctx }) => ctx.runtime.install()),

    /** stop an in-flight install — archives keep their partials */
    cancel: procedure.mutation(({ ctx }) => ctx.runtime.cancel()),

    onUpdate: procedure.subscription(async function* ({ ctx, signal }) {
      yield ctx.runtime.status();
      for await (const [status] of on(ctx.runtime, "update", { signal })) {
        yield status as RuntimeStatus;
      }
    }),
  }),

  settings: router({
    get: procedure.query(({ ctx }) => ctx.settings.get()),

    update: procedure
      .input(settingsUpdateSchema)
      .mutation(({ ctx, input }) => ctx.settings.update(input)),

    /** live disk figures for the volume holding storage.dataRoot */
    storage: procedure.query(({ ctx }) => ctx.settings.storageStats()),
  }),
});

export type AppRouter = typeof appRouter;

/** call the router in-process against a Context — the crew parity test's
 * second path (the Desk's), and any future headless host without HTTP */
export const createCaller = createCallerFactory(appRouter);
