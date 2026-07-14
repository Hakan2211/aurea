/* The studiod tRPC surface. Iron rule (PRD): every feature lands here first —
 * the desktop renderer, the CLI, and the MCP server are all equal clients. */

import { on } from "node:events";
import { z } from "zod";
import { enqueueJobSchema, settingsUpdateSchema, type Job, type Vram } from "@aurea/shared";
import { procedure, router } from "./trpc.js";

const jobId = z.object({ id: z.string() });

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
    list: procedure.query(({ ctx }) => ctx.projects),
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
