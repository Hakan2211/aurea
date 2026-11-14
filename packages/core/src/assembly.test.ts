/* Scene assembly (N1.1): the planner's step logic and the runner's passes.
 *
 * The planner is held to the playbook's rules — do only what a shot is
 * missing, never guess a voice, never lay an unapproved take. The runner is
 * held to the batch contract: a failed step skips only its own shot, the
 * gates stop where `through` says, and every job it queues carries the batch. */

import test from "node:test";
import assert from "node:assert/strict";
import type { z } from "zod";
import {
  bibleSchema,
  laneForShot,
  planSceneAssembly,
  sceneSchema,
  shotSchema,
  videoPresetSchema,
  type AssemblyPlanInput,
  type Job,
  type Scene,
} from "@aurea/shared";
import { AssemblyRunner, type AssemblyVerbs } from "./assembly.js";

const shot = (patch: Partial<z.input<typeof shotSchema>>) => shotSchema.parse(patch);
const line = (id: string, character: string | null, text = "Hello.") => ({ id, character, text });

const bible = bibleSchema.parse({
  characters: [
    { id: "milo", name: "Milo", voice: { voiceId: "milo-clone" } },
    { id: "sterling", name: "Sterling", voice: { voiceId: "sterling-clone" } },
    { id: "gus", name: "Gus" }, // never cast
  ],
  locations: [{ id: "lounge", name: "Lounge", refs: ["projects/p/assets/image/lounge.png"] }],
});

const presets = [
  videoPresetSchema.parse({ id: "zoo-interview-single", label: "Interview", payload: { engine: "ltx25", durationSec: 8, resolution: "1280 × 704 (16:9)" } }),
  videoPresetSchema.parse({ id: "zoo-room-coverage", label: "Coverage", payload: { engine: "ltx25", durationSec: 12 } }),
  videoPresetSchema.parse({ id: "zoo-broll-insert", label: "B-roll", payload: { engine: "minimax-h3", durationSec: 5 } }),
  videoPresetSchema.parse({ id: "zoo-field-note", label: "Field Note", payload: { engine: "minimax-h3", durationSec: 5, resolution: "768 × 1344 (9:16 · native)" } }),
];

function plan(scene: Scene, patch: Partial<AssemblyPlanInput> = {}, options: AssemblyPlanInput["options"] = { through: "board" }) {
  return planSceneAssembly({ project: "p", scene, bible, presets, jobs: [], timelineAssets: [], options, ...patch });
}
const step = (p: ReturnType<typeof plan>, id: string) => p.steps.find((s) => s.id === id);

test("lane follows who speaks: nobody, one voice, a conversation", () => {
  assert.equal(laneForShot(shot({ id: "a" })), "zoo-broll-insert");
  assert.equal(laneForShot(shot({ id: "a", scriptLines: [line("l1", "milo"), line("l2", "milo")] })), "zoo-interview-single");
  assert.equal(laneForShot(shot({ id: "a", scriptLines: [line("l1", "milo"), line("l2", "sterling")] })), "zoo-room-coverage");
  // an action line (no character) is not a speaker
  assert.equal(laneForShot(shot({ id: "a", scriptLines: [line("l1", null, "He sits.")] })), "zoo-broll-insert");
});

test("a fresh shot plans voice + board now and its render after gate 1", () => {
  const scene = sceneSchema.parse({ id: "sc", slugline: "INT. LOUNGE", location: "lounge", shots: [shot({ id: "s1", characters: ["milo"], scriptLines: [line("l1", "milo")] })] });
  const p = plan(scene);
  assert.equal(step(p, "voice:s1")?.status, "todo");
  assert.deepEqual(step(p, "voice:s1")?.lineIds, ["l1"]);
  assert.equal(step(p, "board:s1")?.status, "todo");
  assert.equal(step(p, "render:s1")?.status, "later");
  assert.equal(step(p, "render:s1")?.lane, "zoo-interview-single");
  // only queued work is estimated: one TTS line + one board
  assert.equal(p.estSec, 20 + 300);
  // through render, the same shot's render is in this run
  assert.equal(step(plan(scene, {}, { through: "render" }), "render:s1")?.status, "todo");
});

test("an uncast speaker blocks the voice and the render, never a guessed voice", () => {
  const scene = sceneSchema.parse({ id: "sc", slugline: "X", location: "lounge", shots: [shot({ id: "s1", scriptLines: [line("l1", "gus")] })] });
  const p = plan(scene, {}, { through: "render" });
  assert.equal(step(p, "voice-uncast:s1")?.status, "blocked");
  assert.match(step(p, "voice-uncast:s1")!.reason!, /Gus has no cast voice/);
  assert.equal(step(p, "render:s1")?.status, "blocked");
  assert.equal(step(p, "voice:s1"), undefined);
});

test("only missing work is planned: voiced lines, boards and takes on the shot are done", () => {
  const scene = sceneSchema.parse({
    id: "sc",
    slugline: "X",
    location: "lounge",
    shots: [
      shot({
        id: "s1",
        scriptLines: [line("l1", "milo"), line("l2", "milo")],
        voTakes: [{ id: "v1", asset: "a.wav", lineId: "l1" }],
        keyframes: [{ id: "k1", asset: "k.png" }],
      }),
    ],
  });
  const p = plan(scene, {}, { through: "render" });
  assert.deepEqual(step(p, "voice:s1")?.lineIds, ["l2"]);
  assert.equal(step(p, "board:s1")?.status, "done");
  assert.equal(step(p, "render:s1")?.status, "todo");
});

test("a rendered shot is not re-voiced, even when its takes predate line tagging", () => {
  const scene = sceneSchema.parse({
    id: "sc",
    slugline: "X",
    location: "lounge",
    shots: [
      shot({
        id: "s1",
        scriptLines: [line("l1", "milo")],
        voTakes: [{ id: "v-old", asset: "a.wav" }], // pre-P0: no lineId
        keyframes: [{ id: "k1", asset: "k.png" }],
        videoTakes: [{ id: "t1", asset: "t.mp4", engine: "ltx25" }],
      }),
    ],
  });
  const p = plan(scene, {}, { through: "render" });
  assert.equal(step(p, "voice:s1")?.status, "done");
  assert.equal(step(p, "render:s1")?.status, "done");
  assert.equal(p.estSec, 0);
});

test("work already in the queue is inflight, not queued twice", () => {
  const scene = sceneSchema.parse({ id: "sc", slugline: "X", location: "lounge", shots: [shot({ id: "s1", scriptLines: [line("l1", "milo")] })] });
  const jobs = [
    { id: "j-tts", title: "t", kind: "tts", engine: "x", status: "queued", progress: 0, priority: "batch", payload: { type: "tts", text: "Hello.", voice: "milo-clone", board: { shotId: "s1", lineId: "l1" } } },
    { id: "j-img", title: "t", kind: "image", engine: "x", status: "running", progress: 10, priority: "batch", payload: { type: "image", prompt: "p", board: { shotId: "s1" } } },
  ] as unknown as Job[];
  const p = plan(scene, { jobs });
  assert.equal(step(p, "voice:s1")?.status, "inflight");
  assert.deepEqual(step(p, "voice:s1")?.jobIds, ["j-tts"]);
  assert.equal(step(p, "board:s1")?.status, "inflight");
  assert.equal(p.estSec, 0);
});

test("a vertical lane boards in 9:16; a missing lane or missing refs blocks with a reason", () => {
  const scene = sceneSchema.parse({ id: "sc", slugline: "X", location: "lounge", shots: [shot({ id: "s1" })] });
  assert.equal(step(plan(scene, {}, { through: "board", lane: "zoo-field-note" }), "board:s1")?.aspect, "9:16");
  assert.equal(step(plan(scene), "board:s1")?.aspect, "16:9");
  const bad = plan(scene, {}, { through: "render", lanes: { s1: "nope" } });
  assert.match(step(bad, "render:s1")!.reason!, /unknown render lane "nope"/);
  const bare = sceneSchema.parse({ id: "sc", slugline: "X", shots: [shot({ id: "s1" })] });
  assert.equal(step(plan(bare), "board:s1")?.status, "blocked");
});

test("the cut lays approved takes only — gate 2 stays a human's", () => {
  const take = (id: string) => ({ id, asset: `projects/p/assets/video/${id}.mp4`, engine: "ltx25" });
  const scene = sceneSchema.parse({
    id: "sc",
    slugline: "X",
    location: "lounge",
    shots: [
      shot({ id: "a", keyframes: [{ id: "k", asset: "k.png" }], videoTakes: [take("ta")], selectedTake: "ta", status: "approved" }),
      shot({ id: "b", keyframes: [{ id: "k", asset: "k.png" }], videoTakes: [take("tb")], selectedTake: "tb" }),
      shot({ id: "c", keyframes: [{ id: "k", asset: "k.png" }], videoTakes: [take("tc")], selectedTake: "tc", status: "approved" }),
    ],
  });
  const p = plan(scene, { timelineAssets: [take("tc").asset] }, { through: "cut" });
  assert.equal(step(p, "cut:a")?.status, "todo");
  assert.equal(step(p, "cut:b")?.status, "blocked");
  assert.match(step(p, "cut:b")!.reason!, /awaiting your verdict/);
  assert.equal(step(p, "cut:c")?.status, "done");
});

/* ---------- the runner, over fakes ---------- */

function harness(sceneInit: Scene, failBoardFor: string[] = []) {
  let scene = structuredClone(sceneInit);
  const jobs = new Map<string, Job>();
  const tags = new Map<string, string>();
  const calls: string[] = [];
  let n = 0;
  const mkJob = (status: Job["status"], error?: string): Job => {
    const job = { id: `j${++n}`, title: "t", kind: "image", engine: "x", status, progress: 0, priority: "batch", error } as Job;
    jobs.set(job.id, job);
    return job;
  };
  const patchShot = (id: string, fn: (s: Scene["shots"][number]) => void) => {
    scene = structuredClone(scene);
    fn(scene.shots.find((s) => s.id === id)!);
  };
  const verbs: AssemblyVerbs = {
    async tableRead({ lineIds }) {
      calls.push(`tts:${lineIds.join(",")}`);
      const queued = lineIds.map((lineId) => {
        const owner = scene.shots.find((s) => s.scriptLines.some((l) => l.id === lineId))!;
        patchShot(owner.id, (s) => s.voTakes.push({ id: `vo-${lineId}`, asset: "a.wav", engine: "", label: "", lineId, preview: false } as never));
        return { job: mkJob("completed"), shotId: owner.id, lineId };
      });
      return { queued, skipped: [] };
    },
    async board({ shotId }) {
      calls.push(`board:${shotId}`);
      if (failBoardFor.includes(shotId)) return mkJob("failed", "qwen-edit OOM");
      patchShot(shotId, (s) => s.keyframes.push({ id: "k", asset: "k.png", approved: false }));
      return mkJob("completed");
    },
    async render({ shotId, preset }) {
      calls.push(`render:${shotId}@${preset}`);
      patchShot(shotId, (s) => s.videoTakes.push({ id: "t", asset: "t.mp4", engine: "ltx25", label: "", preview: false } as never));
      return { job: mkJob("completed") };
    },
  };
  const runner = new AssemblyRunner({
    engine: {
      snapshot: () => [...jobs.values()],
      get: (id: string) => jobs.get(id),
      tagBatch: (id: string, batch: string) => void tags.set(id, batch),
      cancel: (id: string) => jobs.get(id),
    },
    studio: {
      getScene: () => scene,
      getBible: () => bible,
      approvedTakeAssets: () => [],
      getShotContext: (_p: string, id: string) => ({ shot: scene.shots.find((s) => s.id === id)!, scene }),
    },
    timelines: {
      get: () => ({ tracks: [{ kind: "video", clips: [] }] }) as never,
      addClip: async () => ({}) as never,
      orderVideoTrack: () => ({}) as never,
    },
    presets: () => presets,
    pollMs: 5,
  });
  return { runner, verbs, calls, tags };
}

const twoShots = sceneSchema.parse({
  id: "sc",
  slugline: "INT. LOUNGE",
  location: "lounge",
  shots: [
    shot({ id: "a", scriptLines: [line("l1", "milo")] }),
    shot({ id: "b", scriptLines: [line("l2", "milo"), line("l3", "sterling")] }),
  ],
});

test("through board: voices and boards both shots, then stops at gate 1", async () => {
  const h = harness(twoShots);
  const batch = h.runner.start({ project: "p", sceneId: "sc" }, h.verbs);
  const done = await h.runner.settled(batch.id);
  assert.equal(done.status, "finished");
  assert.deepEqual(h.calls, ["tts:l1,l2,l3", "board:a", "board:b"]);
  assert.match(done.summary!, /2 shots boarded .*gate 1/);
  // every job the batch queued carries its id
  assert.equal(h.tags.size, 5);
  assert.ok([...h.tags.values()].every((b) => b === batch.id));
});

test("a failed board skips only that shot's render; the rest of the batch renders", async () => {
  const h = harness(twoShots, ["b"]);
  const batch = h.runner.start({ project: "p", sceneId: "sc", through: "render" }, h.verbs);
  const done = await h.runner.settled(batch.id);
  assert.deepEqual(h.calls, ["tts:l1,l2,l3", "board:a", "board:b", "render:a@zoo-interview-single"]);
  const board = done.steps.find((s) => s.id === "board:b")!;
  assert.equal(board.status, "failed");
  assert.equal(board.reason, "qwen-edit OOM");
  assert.equal(done.steps.find((s) => s.id === "render:b")?.status, "skipped");
  assert.equal(done.steps.find((s) => s.id === "render:a")?.status, "completed");
  assert.match(done.summary!, /gate 2.*2 steps failed or skipped/);
});

test("one batch per scene at a time", async () => {
  const h = harness(twoShots);
  const batch = h.runner.start({ project: "p", sceneId: "sc" }, h.verbs);
  assert.throws(() => h.runner.start({ project: "p", sceneId: "sc" }, h.verbs), /already assembling/);
  await h.runner.settled(batch.id);
});
