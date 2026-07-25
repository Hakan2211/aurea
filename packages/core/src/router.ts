/* The studiod tRPC surface. Iron rule (PRD): every feature lands here first —
 * the desktop renderer, the CLI, and the MCP server are all equal clients. */

import { on } from "node:events";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  enqueueJobSchema,
  imageDeckGenerateSchema,
  imageGenerateSchema,
  imageRefAddSchema,
  imageUpscaleGenerateSchema,
  libraryRemoveSchema,
  musicGenerateSchema,
  projectCreateSchema,
  projectRenameSchema,
  directorSendSchema,
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
  productionGetSchema,
  productionRemoveNodeSchema,
  productionUpdateEpisodeSchema,
  productionUpdateSceneSchema,
  productionUpdateSchema,
  productionUpdateShotSchema,
  composeKeyframePrompt,
  resolveKeyframeRefs,
  shotComposeSchema,
  shotRenderSchema,
  storyboardGenerateSchema,
  studioSeedSchema,
  ttsGenerateSchema,
  videoGenerateSchema,
  voiceAddSchema,
  voiceConvertGenerateSchema,
  rvcTrainGenerateSchema,
  voiceRemoveSchema,
  voiceSourceAddSchema,
  type DirectorState,
  type Job,
  type JobPayload,
  type ModelEntry,
  type RuntimeStatus,
  type StudioUpdateEvent,
  type Vram,
} from "@aurea/shared";
import { describeExport, sequenceEnd } from "./adapters/ffmpeg-export.js";
import { composeShotFromBoard } from "./shot-director.js";
import { labEnqueue } from "./labs.js";
import { removeAssets, scanLibrary } from "./library.js";
import { procedure, router, type Context } from "./trpc.js";

const jobId = z.object({ id: z.string() });

function requireProject(ctx: Context, project: string): void {
  if (!ctx.projects.list().some((p) => p.id === project)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `unknown project "${project}"` });
  }
}

/** enqueue a lab job into the target project (which must actually exist) */
function generate(ctx: Context, payload: JobPayload, project: string): Job {
  requireProject(ctx, project);
  return ctx.engine.enqueue(labEnqueue(payload, project));
}

export const appRouter = router({
  system: router({
    /** static-ish facts + the preflight strip for the job center */
    overview: procedure.query(({ ctx }) => ({
      system: ctx.monitor.info,
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

    /** full-queue snapshots; small N, so no delta protocol yet */
    onSnapshot: procedure.subscription(async function* ({ ctx, signal }) {
      yield ctx.engine.snapshot();
      for await (const [jobs] of on(ctx.engine, "snapshot", { signal })) {
        yield jobs as Job[];
      }
    }),
  }),

  projects: router({
    list: procedure.query(({ ctx }) => ctx.projects.list()),

    create: procedure
      .input(projectCreateSchema)
      .mutation(({ ctx, input }) => ctx.projects.create(input.name)),

    rename: procedure
      .input(projectRenameSchema)
      .mutation(({ ctx, input }) => ctx.projects.rename(input.id, input.name)),
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
    }),
    video: router({
      catalog: procedure.query(({ ctx }) => ctx.labs.videoCatalog()),
      capabilities: procedure.query(({ ctx }) => ctx.labs.videoCapabilities()),
      generate: procedure.input(videoGenerateSchema).mutation(({ ctx, input }) => {
        const { project, ...payload } = input;
        return generate(ctx, { type: "video", ...payload }, project);
      }),
    }),
  }),

  director: router({
    get: procedure
      .input(z.object({ project: z.string().min(1) }))
      .query(({ ctx, input }) => ctx.director.get(input.project)),

    send: procedure.input(directorSendSchema).mutation(({ ctx, input }) => {
      if (!ctx.projects.list().some((p) => p.id === input.project)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `unknown project "${input.project}"` });
      }
      try {
        return ctx.director.send(input.project, input.text, input.attachments);
      } catch (err) {
        throw new TRPCError({ code: "CONFLICT", message: String((err as Error).message) });
      }
    }),

    /** abort the in-flight Claude run; no-op when the Director is idle */
    stop: procedure
      .input(z.object({ project: z.string().min(1) }))
      .mutation(({ ctx, input }) => ctx.director.stop(input.project)),

    /** full-thread snapshots per update — chats are short, so no delta protocol */
    onUpdate: procedure
      .input(z.object({ project: z.string().min(1) }))
      .subscription(async function* ({ ctx, input, signal }) {
        yield ctx.director.get(input.project);
        for await (const [state] of on(ctx.director, "update", { signal })) {
          if ((state as DirectorState).project === input.project) yield state as DirectorState;
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
        payload: { type: "export", project: input.project, timeline },
      });
    }),
  }),

  studio: router({
    /* the V2 Studio data spine: production.json + bible.json per project.
     * Whole-document saves for the renderer, granular ops for the Director —
     * same file, both surfaces interchangeable (timeline precedent). */

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
          const payload: JobPayload = {
            type: "video",
            ...composed.videoInput,
            resolution: input.resolution,
            seed: input.seed,
          };
          return {
            job: generate(ctx, payload, input.project),
            spec: composed.director,
            durationSec: composed.durationSec,
            notes: composed.notes,
          };
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: String((err as Error).message) });
        }
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
