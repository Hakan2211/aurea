import { initTRPC, TRPCError } from "@trpc/server";
import type { Project } from "@aurea/shared";
import type { JobEngine } from "./jobs.js";
import type { SystemMonitor } from "./system.js";

export interface Context {
  /** did the request present the boot token (HTTP bearer / WS connectionParams)? */
  authed: boolean;
  engine: JobEngine;
  monitor: SystemMonitor;
  projects: Project[];
}

const t = initTRPC.context<Context>().create();

export const router = t.router;

/** every procedure requires the token — localhost ports are reachable by any local process */
export const procedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.authed) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next();
});
