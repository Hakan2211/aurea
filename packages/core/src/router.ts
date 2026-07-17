/* The studiod tRPC surface. Iron rule (PRD): every feature lands here first —
 * the desktop renderer, the CLI, and the MCP server are all equal clients. */

import { on } from "node:events";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  enqueueJobSchema,
  imageGenerateSchema,
  musicGenerateSchema,
  projectCreateSchema,
  projectRenameSchema,
  directorSendSchema,
  modelDownloadSchema,
  settingsUpdateSchema,
  timelineUpdateSchema,
  ttsGenerateSchema,
  videoGenerateSchema,
  voiceAddSchema,
  voiceRemoveSchema,
  type DirectorState,
  type Job,
  type JobPayload,
  type ModelEntry,
  type RuntimeStatus,
  type Vram,
} from "@aurea/shared";
import { labEnqueue } from "./labs.js";
import { scanLibrary } from "./library.js";
import { procedure, router, type Context } from "./trpc.js";

const jobId = z.object({ id: z.string() });

/** enqueue a lab job into the target project (which must actually exist) */
function generate(ctx: Context, payload: JobPayload, project: string): Job {
  if (!ctx.projects.list().some((p) => p.id === project)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `unknown project "${project}"` });
  }
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
  }),

  labs: router({
    image: router({
      catalog: procedure.query(({ ctx }) => ctx.labs.imageCatalog()),
      generate: procedure.input(imageGenerateSchema).mutation(({ ctx, input }) => {
        const { project, ...payload } = input;
        return generate(ctx, { type: "image", ...payload }, project);
      }),
    }),
    voice: router({
      catalog: procedure.query(({ ctx }) => ctx.labs.voiceCatalog()),
      generate: procedure.input(ttsGenerateSchema).mutation(({ ctx, input }) => {
        const { project, ...payload } = input;
        return generate(ctx, { type: "tts", ...payload }, project);
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

    /** delete a model's files from disk */
    remove: procedure.input(jobId).mutation(({ ctx, input }) => ctx.models.remove(input.id)),

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
