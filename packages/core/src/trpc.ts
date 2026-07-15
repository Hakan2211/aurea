import { initTRPC, TRPCError } from "@trpc/server";
import type { JobEngine } from "./jobs.js";
import type { SystemMonitor } from "./system.js";
import type { SettingsStore } from "./settings.js";
import type { ProjectStore } from "./projects.js";
import type { Labs } from "./labs.js";

export interface Context {
  /** did the request present the boot token (HTTP bearer / WS connectionParams)? */
  authed: boolean;
  engine: JobEngine;
  monitor: SystemMonitor;
  settings: SettingsStore;
  projects: ProjectStore;
  labs: Labs;
}

const t = initTRPC.context<Context>().create();

export const router = t.router;

/** every procedure requires the token — localhost ports are reachable by any local process */
export const procedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.authed) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next();
});
