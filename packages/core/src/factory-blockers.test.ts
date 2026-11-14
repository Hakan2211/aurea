/* The four blockers the acceptance pilot found (2026-09-02), pinned.
 *
 * Each of these is invisible in a passing build and expensive in a session:
 * a lane that hard-errors seconds into the GPU, a retake you can't approve, a
 * cut in the wrong order, a canvas that pillarboxes the master. */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { productionSchema, shotSchema, timelineSchema, shotRenderSchema } from "@aurea/shared";
import { StudioStore } from "./studio.js";
import { TimelineStore } from "./timeline.js";
import type { SettingsStore } from "./settings.js";
import type { ProjectStore } from "./projects.js";

const take = (id: string) => ({
  id,
  asset: `projects/p/assets/video/${id}.mp4`,
  engine: "ltx25",
  label: "",
});

function harness(shots: Array<Record<string, unknown>>) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aurea-blockers-"));
  const settings = { get: () => ({ storage: { dataRoot: tmp } }) } as unknown as SettingsStore;
  const projects = { list: () => [{ id: "p", name: "P" }] } as unknown as ProjectStore;
  const studio = new StudioStore(settings, projects);
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
              scenes: [{ id: "sc1", slugline: "INT.", shots: shots.map((s) => shotSchema.parse(s)) }],
            },
          ],
        },
      ],
    }),
  );
  return { studio, timelines: new TimelineStore(settings), tmp };
}

/* ---- #9: a retake must become the take under review ---- */

test("a delivered take becomes the selected one — a retake is what you judge", () => {
  const { studio } = harness([
    { id: "sh1", videoTakes: [take("t1")], selectedTake: "t1", status: "generated" },
  ]);
  const { shot } = studio.attachTake("p", "sh1", ["projects/p/assets/video/t2.mp4"], "ltx25");
  assert.equal(shot.videoTakes.length, 2);
  assert.equal(shot.selectedTake, shot.videoTakes[1].id);
  // …so approving without a takeId locks the RETAKE, not the reject
  assert.equal(studio.approveShot("p", "sh1").take.asset, "projects/p/assets/video/t2.mp4");
});

test("an approved shot keeps its picked take when a later render lands", () => {
  const { studio } = harness([
    { id: "sh1", videoTakes: [take("t1")], selectedTake: "t1", status: "approved" },
  ]);
  const { shot } = studio.attachTake("p", "sh1", ["projects/p/assets/video/t2.mp4"], "ltx25");
  assert.equal(shot.selectedTake, "t1");
  assert.equal(shot.status, "approved");
});

/* ---- #10: the cut is in script order, not approve order ---- */

test("approvals out of order still lay the cut in script order", () => {
  const { studio, timelines } = harness([
    { id: "sh1", videoTakes: [take("a")], selectedTake: "a", status: "generated" },
    { id: "sh2", videoTakes: [take("b")], selectedTake: "b", status: "generated" },
    { id: "sh3", videoTakes: [take("c")], selectedTake: "c", status: "generated" },
  ]);
  // the hard shot is approved last, as it always is
  for (const id of ["sh2", "sh3", "sh1"]) studio.approveShot("p", id);
  const tl = timelineSchema.parse({
    tracks: [
      {
        id: "v",
        kind: "video",
        name: "Video",
        clips: [
          { id: "c1", asset: "projects/p/assets/video/b.mp4", start: 0, duration: 2 },
          { id: "c2", asset: "projects/p/assets/video/c.mp4", start: 2, duration: 3 },
          { id: "c3", asset: "projects/p/assets/video/a.mp4", start: 5, duration: 4 },
        ],
      },
    ],
  });
  timelines.update("p", tl);
  const ordered = timelines.orderVideoTrack("p", studio.approvedTakeAssets("p"));
  const clips = ordered.tracks.find((t) => t.kind === "video")!.clips;
  assert.deepEqual(
    clips.map((c) => c.asset),
    [
      "projects/p/assets/video/a.mp4",
      "projects/p/assets/video/b.mp4",
      "projects/p/assets/video/c.mp4",
    ],
  );
  // …and re-butted, so the cut has no holes where the old order was
  assert.deepEqual(clips.map((c) => c.start), [0, 4, 6]);
});

test("a clip the production doesn't own keeps its place at the end", () => {
  const { studio, timelines } = harness([
    { id: "sh1", videoTakes: [take("a")], selectedTake: "a", status: "approved" },
  ]);
  timelines.update(
    "p",
    timelineSchema.parse({
      tracks: [
        {
          id: "v",
          kind: "video",
          name: "Video",
          clips: [
            { id: "x", asset: "projects/p/assets/video/cutaway.mp4", start: 0, duration: 1 },
            { id: "c1", asset: "projects/p/assets/video/a.mp4", start: 1, duration: 2 },
          ],
        },
      ],
    }),
  );
  const clips = timelines
    .orderVideoTrack("p", studio.approvedTakeAssets("p"))
    .tracks.find((t) => t.kind === "video")!.clips;
  assert.deepEqual(clips.map((c) => c.id), ["c1", "x"]);
});

/* ---- #3: the lane's canvas survives a caller who says nothing ---- */

test("render resolution has no default — an omitted canvas is the lane's own", () => {
  const parsed = shotRenderSchema.parse({ project: "p", shotId: "sh1" });
  assert.equal(parsed.resolution, undefined);
  assert.equal(
    shotRenderSchema.parse({ project: "p", shotId: "sh1", resolution: "768 × 1344 (9:16)" })
      .resolution,
    "768 × 1344 (9:16)",
  );
});

/* ---- #6: the interview lane composes something 2.5 will actually take ----
 * The 2.5 adapter hard-errors on a Director timeline and on a camera LoRA, and
 * the single-shot composer emitted both — so `zoo-interview-single` failed
 * within seconds of reaching the GPU, every time, since the day it shipped. */

import { composeShotFromBoard } from "./shot-director.js";
import { PromptLibrary } from "./promptlib.js";
import { execFileSync } from "node:child_process";
import type { Labs } from "./labs.js";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** two seconds of tone per line — measureTakes ffprobes them for real */
function writeTakes(tmp: string) {
  const dir = path.join(tmp, "projects", "p", "assets", "audio");
  fs.mkdirSync(dir, { recursive: true });
  for (const [i, name] of ["silas-1.wav", "silas-2.wav"].entries()) {
    execFileSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `sine=frequency=${200 + i * 40}:duration=2`,
      "-ar", "48000", "-ac", "1", path.join(dir, name),
    ]);
  }
}

const interviewShot = () =>
  ({
    id: "sh1",
    title: "Silas, to camera",
    characters: ["silas"],
    camera: { shotSize: "mcu", move: "static" },
    keyframes: [{ id: "k1", asset: "projects/p/assets/image/silas.png", approved: true }],
    selectedKeyframe: "k1",
    scriptLines: [
      { id: "l1", character: "silas", text: "Let the mud settle." },
      { id: "l2", character: "silas", text: "It always does." },
    ],
  }) as Record<string, unknown>;

test(
  "the interview lane composes a plain ia2v payload — no timeline, no camera LoRA",
  { skip: hasFfmpeg ? false : "ffmpeg not on PATH" },
  async () => {
    const { studio, tmp } = harness([interviewShot()]);
    writeTakes(tmp);
    studio.updateBible("p", {
      characters: [
        { id: "silas", name: "Silas", species: "tiger", wardrobe: "a grey henley" },
      ],
    } as never);

    const settings = { get: () => ({ storage: { dataRoot: tmp } }) } as unknown as SettingsStore;
    const labs = {
      videoCapabilities: async () => ({
        multiRef: false,
        reachable: true,
        cameraLoras: { "push-in": true },
      }),
    } as unknown as Labs;

    const out = await composeShotFromBoard(
      { studio, settings, labs, prompts: new PromptLibrary(settings) },
      {
        project: "p",
        shotId: "sh1",
        preset: "zoo-interview-single",
        takes: [
          { take: "projects/p/assets/audio/silas-1.wav", character: "silas" },
          { take: "projects/p/assets/audio/silas-2.wav", character: "silas" },
        ],
      } as never,
    );

    assert.equal(out.videoInput.engine, "ltx25");
    assert.equal(out.videoInput.director, undefined, "2.5 has no Director node pack");
    assert.equal(out.videoInput.cameraLora, undefined, "the LoRA weights are 2.3-only");
    // …and the lane's own shape survives
    assert.equal(out.videoInput.enhance, false);
    // the two takes are flattened into one bed, which is what 2.5 lip-syncs to
    assert.match(String(out.videoInput.audio), /^beds\/bed-[0-9a-f]{12}\.wav$/);
    assert.ok(fs.existsSync(path.join(tmp, String(out.videoInput.audio))));
    // …while the carried spec still holds the speech WINDOWS, which is what
    // qc_shot measures articulation inside (the bed is one file, the lines are two)
    assert.equal(out.director.audio.length, 2);
    assert.deepEqual(out.director.audio.map((a) => a.atSec), [1, 3.6]);
    // and the prompt is motion only
    assert.doesNotMatch(out.prompt, /grey henley,|art direction|depth of field/i);
    assert.match(out.prompt, /talks, mouth moving while speaking/);
  },
);

/* ---- #4: a re-board is what you judge next (PRODUCTION-EXPERIENCE-PLAN §1.4) ---- */

test("a delivered keyframe becomes the selected one; an approved shot keeps its pick", () => {
  const { studio } = harness([
    {
      id: "sh1",
      keyframes: [{ id: "k1", asset: "projects/p/assets/image/k1.png" }],
      selectedKeyframe: "k1",
      status: "boarded",
    },
    {
      id: "sh2",
      keyframes: [{ id: "k1", asset: "projects/p/assets/image/k1.png" }],
      selectedKeyframe: "k1",
      status: "approved",
    },
  ]);
  const { shot } = studio.attachKeyframes("p", "sh1", ["projects/p/assets/image/k2.png"]);
  assert.equal(shot.selectedKeyframe, shot.keyframes[1].id);
  const kept = studio.attachKeyframes("p", "sh2", ["projects/p/assets/image/k2.png"]).shot;
  assert.equal(kept.selectedKeyframe, "k1");
});

/* ---- #7: the take records the length it was ASKED for ---- */

test("a delivered take carries its requested duration, so QC judges the request not a default", () => {
  const { studio } = harness([{ id: "sh1", status: "boarded" }]);
  const { shot } = studio.attachTake("p", "sh1", ["projects/p/assets/video/t1.mp4"], "ltx25", {
    durationSec: 8,
  });
  assert.equal(shot.videoTakes[0].durationSec, 8);
  const legacy = studio.attachTake("p", "sh1", ["projects/p/assets/video/t2.mp4"], "ltx25").shot;
  assert.equal(legacy.videoTakes[1].durationSec, undefined);
});
