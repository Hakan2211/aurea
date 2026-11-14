/* Crew console parity (production experience plan P6).
 *
 * Two paths reach every crew verb: the Desk calls a tRPC procedure, the
 * shell (scripts/tool.mts / MCP / the Director) calls a tool whose handler
 * calls the same procedure. They diverged once — pilot defects #9 and #10
 * were visible from one side only. CREW_VERBS (shared) is the contract; this
 * file holds both sides to it:
 *
 *   1. every verb names a tool that exists, whose schema covers the verb's
 *      argument keys, and a procedure that exists on the router;
 *   2. a fixture project run through BOTH paths — the tool handler over an
 *      in-process caller, and the caller directly (what the Desk does) —
 *      leaves the same production.json and timeline.json behind and
 *      enqueues the same render payload.
 *
 * Offline: a recording engine stands in for the job engine, ComfyUI is
 * "unreachable" (the composer notes it and carries on), and the takes are
 * placeholder files, so the verbs that need ffmpeg on real media (qc_shot on
 * a rendered take) are held to parity on their failure text instead. */

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CREW_VERBS,
  crewVerbTool,
  productionSchema,
  settingsSchema,
  shotSchema,
} from "@aurea/shared";
import { StudioStore } from "./studio.js";
import { TimelineStore } from "./timeline.js";
import { PromptLibrary } from "./promptlib.js";
import { ProjectStore } from "./projects.js";
import { appRouter, createCaller } from "./router.js";
import { buildTools, type StudiodApi } from "./tools.js";
import type { SettingsStore } from "./settings.js";
import type { Context } from "./trpc.js";

/* ---------- 1. the contract against the registry and the router ---------- */

const registry = buildTools({} as StudiodApi);
const procedures = Object.keys(
  (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures,
);

for (const verb of CREW_VERBS) {
  test(`crew verb ${verb.id}: tool, argument keys and procedure all exist`, () => {
    const tool = registry.find((t) => t.name === crewVerbTool(verb.id));
    assert.ok(tool, `no tool "${crewVerbTool(verb.id)}" in the registry`);
    const keys = Object.keys(tool.schema);
    for (const arg of verb.args) assert.ok(keys.includes(arg), `tool ${tool.name} has no "${arg}" argument`);
    if (verb.id.endsWith(":dryRun")) assert.ok(keys.includes("dryRun"), `${tool.name} has no dryRun`);
    assert.ok(procedures.includes(verb.procedure), `router has no procedure "${verb.procedure}"`);
  });
}

test("every verb id is unique and every verb has a title", () => {
  const ids = CREW_VERBS.map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const v of CREW_VERBS) assert.ok(v.title.trim());
});

/* ---------- 2. the fixture, both paths ---------- */

interface Fixture {
  root: string;
  ctx: Context;
  caller: ReturnType<typeof createCaller>;
  /** the tool path: registry handlers over an in-process caller */
  tools: ReturnType<typeof buildTools>;
  /** every payload the recording engine was handed */
  enqueued: unknown[];
}

/** a StudiodApi (tRPC client shape: api.a.b.query/mutate) over a caller */
function apiFromCaller(caller: unknown): StudiodApi {
  const make = (parts: string[]): unknown =>
    new Proxy(() => undefined, {
      get(_, prop) {
        if (typeof prop !== "string") return undefined;
        if (prop === "query" || prop === "mutate") {
          return (input: unknown) => {
            const fn = parts.reduce<unknown>(
              (o, k) => (o as Record<string, unknown>)[k],
              caller,
            ) as (i: unknown) => unknown;
            return fn(input);
          };
        }
        return make([...parts, prop]);
      },
    });
  return make([]) as StudiodApi;
}

const TAKE_FILE = "projects/p/assets/video/t1.mp4";

/** one real 1s clip, made once with ffmpeg — approve_shot probes the take it
 * lands; null when ffmpeg is not on PATH (that test is skipped, not faked) */
const realTake: string | null = (() => {
  const file = path.join(os.tmpdir(), "aurea-parity-take.mp4");
  try {
    if (!fs.existsSync(file)) {
      execFileSync(
        "ffmpeg",
        ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=1", "-pix_fmt", "yuv420p", file],
        { stdio: "ignore" },
      );
    }
    return file;
  } catch {
    return null;
  }
})();

function makeFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aurea-parity-"));
  const settingsValue = settingsSchema.parse({
    storage: { dataRoot: root },
    paths: {},
    engines: {},
    providers: {},
    general: {},
    advanced: {},
  });
  const settings = {
    get: () => settingsValue,
    update: (patch: { general?: Record<string, unknown> }) => {
      Object.assign(settingsValue.general, patch.general ?? {});
      return settingsValue;
    },
  } as unknown as SettingsStore;
  const projects = new ProjectStore(settings);
  projects.create("P"); // id "p"
  const studio = new StudioStore(settings, projects);
  const timelines = new TimelineStore(settings);
  const prompts = new PromptLibrary(settings);
  const enqueued: unknown[] = [];
  const engine = {
    enqueue: (job: { title?: string; payload: unknown }) => {
      enqueued.push(job.payload);
      return { id: `job-${enqueued.length}`, title: job.title ?? "", status: "queued", payload: job.payload };
    },
  };
  const labs = {
    videoCapabilities: async () => {
      throw new Error("offline");
    },
  };
  const ctx = {
    authed: true,
    settings,
    projects,
    studio,
    timelines,
    prompts,
    engine,
    labs,
  } as unknown as Context;

  // a keyframe and three takes: one missing on disk, one placeholder file,
  // one preview (P5)
  const image = path.join(root, "projects/p/assets/image");
  fs.mkdirSync(image, { recursive: true });
  fs.writeFileSync(path.join(image, "k1.png"), "");
  if (realTake) fs.copyFileSync(realTake, path.join(root, TAKE_FILE));
  else fs.writeFileSync(path.join(root, TAKE_FILE), "");

  studio.updateProduction(
    "p",
    productionSchema.parse({
      title: "P",
      seasons: [
        {
          id: "s1",
          number: 1,
          episodes: [
            {
              id: "e1",
              number: 1,
              title: "E1",
              scenes: [
                {
                  id: "sc1",
                  slugline: "INT. LOFT — NIGHT",
                  shots: [
                    shotSchema.parse({
                      id: "sh1",
                      title: "Silas at the window",
                      scriptLines: [{ id: "l1", character: null, text: "He looks out at the city." }],
                      keyframes: [{ id: "k1", asset: "projects/p/assets/image/k1.png" }],
                      selectedKeyframe: "k1",
                      videoTakes: [
                        { id: "t0", asset: "projects/p/assets/video/missing.mp4", engine: "ltx25" },
                        { id: "t1", asset: TAKE_FILE, engine: "ltx25" },
                        { id: "tp", asset: "projects/p/assets/video/tp.mp4", engine: "ltx25", preview: true, seed: 7 },
                      ],
                      selectedTake: "t1",
                      status: "generated",
                    }),
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
  );
  const caller = createCaller(ctx);
  return { root, ctx, caller, tools: buildTools(apiFromCaller(caller)), enqueued };
}

/** what the project looks like on disk after a verb — timestamps blanked */
function snapshot(f: Fixture): { production: string; timeline: string } {
  const read = (rel: string) => {
    const file = path.join(f.root, "projects/p", rel);
    return fs.existsSync(file)
      ? fs
          .readFileSync(file, "utf8")
          .replace(/\d{4}-\d{2}-\d{2}T[0-9:.]+Z/g, "<t>")
          // fresh track/clip ids are random on both sides
          .replace(/"id": "[0-9a-f-]{8,36}"/g, '"id": "<id>"')
      : "";
  };
  return { production: read("production.json"), timeline: read("timeline.json") };
}

async function viaTool(f: Fixture, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const t = f.tools.find((x) => x.name === tool)!;
  const r = await t.handler({ project: "p", ...args });
  if (r.isError) throw new Error(r.content.map((c) => c.text).join("\n"));
  return JSON.parse(r.content[0].text);
}

const call = (f: Fixture, procedure: string, args: Record<string, unknown>): Promise<unknown> => {
  const fn = procedure
    .split(".")
    .reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], f.caller) as (i: unknown) => Promise<unknown>;
  return fn({ project: "p", ...args });
};

/** run one verb through both paths on two fresh fixtures; return both
 * results and assert the projects they leave behind are identical */
async function bothPaths(
  verbId: (typeof CREW_VERBS)[number]["id"],
  args: Record<string, unknown>,
  toolArgs: Record<string, unknown> = args,
): Promise<{ tool: unknown; desk: unknown; a: Fixture; b: Fixture }> {
  const verb = CREW_VERBS.find((v) => v.id === verbId)!;
  const a = makeFixture();
  const b = makeFixture();
  const tool = await viaTool(a, crewVerbTool(verbId), toolArgs);
  const desk = await call(b, verb.procedure, args);
  assert.deepEqual(snapshot(a), snapshot(b), `${verbId}: the two paths left different projects behind`);
  assert.deepEqual(a.enqueued, b.enqueued, `${verbId}: the two paths enqueued different work`);
  return { tool, desk, a, b };
}

test("approve_shot (preview): both paths carry the seed and touch nothing else", async () => {
  const { a } = await bothPaths("approve_shot", { shotId: "sh1", takeId: "tp" });
  const shot = a.ctx.studio.getShotContext("p", "sh1").shot;
  assert.equal(shot.approvedPreview?.takeId, "tp");
  assert.equal(shot.approvedPreview?.seed, 7);
  assert.equal(shot.status, "generated");
  assert.equal(shot.selectedTake, "t1");
});

test("approve_shot (rendered take): both paths lock the take and land the clip", { skip: !realTake && "ffmpeg not on PATH" }, async () => {
  const { a, tool } = await bothPaths("approve_shot", { shotId: "sh1", takeId: "t1" });
  const shot = a.ctx.studio.getShotContext("p", "sh1").shot;
  assert.equal(shot.status, "approved");
  assert.equal(shot.selectedTake, "t1");
  const tl = a.ctx.timelines.get("p");
  assert.equal(tl.tracks.find((t) => t.kind === "video")?.clips.length, 1);
  assert.equal((tool as { clip: { asset: string } }).clip.asset, TAKE_FILE);
});

test("retake_shot: both paths record the same direction and enqueue the same render", async () => {
  const { a, tool } = await bothPaths("retake_shot", {
    shotId: "sh1",
    note: "stay seated, hold the framing",
    fix: ["hold-framing"],
    seed: 42,
  });
  const shot = a.ctx.studio.getShotContext("p", "sh1").shot;
  assert.equal(shot.takeNotes.length, 2, "one note per fix + the free note");
  assert.equal(a.enqueued.length, 1);
  assert.equal((a.enqueued[0] as { seed: number }).seed, 42);
  assert.equal((tool as { seed: number }).seed, 42);
});

test("retake_shot: a diagnosis is refused identically on both paths", async () => {
  const a = makeFixture();
  const b = makeFixture();
  const note = "he stood up and the camera drifted";
  const toolErr = await viaTool(a, "retake_shot", { shotId: "sh1", note }).then(
    () => null,
    (e: Error) => e.message,
  );
  const deskErr = await call(b, "studio.production.retakeShot", { shotId: "sh1", note }).then(
    () => null,
    (e: Error) => e.message,
  );
  assert.ok(toolErr, "the tool path accepted a diagnosis");
  assert.equal(toolErr, deskErr);
  assert.deepEqual(snapshot(a), snapshot(b));
});

test("shot_from_storyboard: both paths enqueue the same payload in the same lane", async () => {
  const args = { shotId: "sh1", preset: "zoo-interview-single", seed: 42 };
  const { a, tool, desk } = await bothPaths("shot_from_storyboard", args);
  assert.equal(a.enqueued.length, 1);
  const payload = a.enqueued[0] as { type: string; seed: number; board?: { shotId: string } };
  assert.equal(payload.type, "video");
  assert.equal(payload.seed, 42);
  assert.equal(payload.board?.shotId, "sh1");
  assert.equal((tool as { seed: number }).seed, (desk as { seed: number }).seed);
});

test("shot_from_storyboard:dryRun: both paths compose the same spec and render nothing", async () => {
  const args = { shotId: "sh1", preset: "zoo-interview-single" };
  const { a, tool, desk } = await bothPaths("shot_from_storyboard:dryRun", args, { ...args, dryRun: true });
  assert.equal(a.enqueued.length, 0);
  assert.deepEqual(tool, JSON.parse(JSON.stringify(desk)));
});

test("preview_shot: both paths enqueue the same 2s preview at the given seed", async () => {
  const { a, tool } = await bothPaths("preview_shot", { shotId: "sh1", seed: 42, preview: true }, { shotId: "sh1", seed: 42 });
  assert.equal(a.enqueued.length, 1);
  const payload = a.enqueued[0] as { durationSec: number; board: { preview?: boolean } };
  assert.equal(payload.durationSec, 2);
  assert.equal(payload.board.preview, true);
  assert.equal((tool as { seed: number }).seed, 42);
});

test("verify_take: both paths record the same verdict on the shot", async () => {
  const { a, tool } = await bothPaths("verify_take", { shotId: "sh1", takeId: "t0" });
  const take = a.ctx.studio.getShotContext("p", "sh1").shot.videoTakes.find((t) => t.id === "t0")!;
  assert.equal(take.verify?.status, "broken");
  assert.equal((tool as { verify: { status: string } }).verify.status, "broken");
});

test("normalize_project (dry run): both paths return the same plan and change nothing", async () => {
  const { tool, desk, a } = await bothPaths("normalize_project", { dryRun: true });
  const plan = (tool as { plan: unknown }).plan;
  assert.deepEqual(plan, JSON.parse(JSON.stringify((desk as { plan: unknown }).plan)));
  assert.equal(a.enqueued.length, 0);
});

test("qc_shot: a take that cannot be measured fails identically on both paths", async () => {
  const a = makeFixture();
  const b = makeFixture();
  const toolErr = await viaTool(a, "qc_shot", { shotId: "sh1", takeId: "t0" }).then(
    () => null,
    (e: Error) => e.message,
  );
  const deskErr = await call(b, "qc.shot", { shotId: "sh1", takeId: "t0" }).then(
    () => null,
    (e: Error) => e.message,
  );
  assert.ok(toolErr, "qc on a missing file should fail");
  assert.equal(toolErr, deskErr);
});

test("projects.setActive persists and projects.active falls back to the oldest", async () => {
  const f = makeFixture();
  assert.deepEqual(await f.caller.projects.active(), { id: "p" });
  f.ctx.projects.create("Second");
  await f.caller.projects.setActive({ id: "second" });
  assert.deepEqual(await f.caller.projects.active(), { id: "second" });
  const listed = await viaTool(f, "list_projects", {});
  assert.deepEqual(
    (listed as { id: string; active: boolean }[]).map((p) => [p.id, p.active]),
    [
      ["p", false],
      ["second", true],
    ],
  );
  await assert.rejects(f.caller.projects.setActive({ id: "nope" }), /unknown project/);
});
