import { initTRPC, TRPCError } from "@trpc/server";
import type { JobEngine } from "./jobs.js";
import type { SystemMonitor } from "./system.js";
import type { SettingsStore } from "./settings.js";
import type { ProjectStore } from "./projects.js";
import type { Labs } from "./labs.js";
import type { DirectorService } from "./director.js";
import type { ModelManager } from "./models/manager.js";
import type { EngineRuntime } from "./runtime/runtime.js";
import type { TimelineStore } from "./timeline.js";
import type { StudioStore } from "./studio.js";
import type { PromptLibrary } from "./promptlib.js";
import type { AbStore } from "./ab.js";
import type { CoverageStore } from "./coverage.js";
import type { InboxWatcher } from "./inbox.js";
import type { AssemblyRunner } from "./assembly.js";

export interface Context {
  /** did the request present the boot token (HTTP bearer / WS connectionParams)? */
  authed: boolean;
  engine: JobEngine;
  monitor: SystemMonitor;
  settings: SettingsStore;
  projects: ProjectStore;
  labs: Labs;
  director: DirectorService;
  models: ModelManager;
  runtime: EngineRuntime;
  timelines: TimelineStore;
  studio: StudioStore;
  prompts: PromptLibrary;
  /** the A/B render queue's comparison records */
  ab: AbStore;
  /** coverage passes — eight angles of one plate, and their records */
  coverage: CoverageStore;
  /** the per-project image inbox (Midjourney / GPT / Krea drops); absent in
   * test contexts, which never start one */
  inbox?: InboxWatcher;
  /** scene-assembly batches (N1.1); absent in test contexts that don't need one */
  assembly?: AssemblyRunner;
}

const t = initTRPC.context<Context>().create();

export const router = t.router;

/** in-process callers (tests, the crew parity check) — same procedures, no HTTP */
export const createCallerFactory = t.createCallerFactory;

/** every procedure requires the token — localhost ports are reachable by any local process */
export const procedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.authed) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next();
});
