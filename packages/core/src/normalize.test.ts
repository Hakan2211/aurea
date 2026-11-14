/* normalize_project (P4) — the pure plan over gathered facts, and the
 * timeline store's canvas override. The diff is the deliverable: a dry run
 * has to say exactly what an apply would do. */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { timelineSchema, videoPresetSchema } from "@aurea/shared";
import { majorityCanvas, planNormalize, type NormalizeFacts } from "./normalize.js";
import { TimelineStore } from "./timeline.js";
import type { SettingsStore } from "./settings.js";

const clip = (label: string, asset: string, start: number, duration = 5) => ({
  id: label,
  asset,
  label,
  start,
  in: 0,
  duration,
  transitionSec: 0,
});

/** the pilot's own state: 1280×720, four approved vertical takes, FN15-4
 * laid ahead of FN15-3 because it was approved earlier */
function pilotFacts(overrides: Partial<NormalizeFacts> = {}): NormalizeFacts {
  const takes = ["fn15-1", "fn15-2", "fn15-3", "fn15-4"].map((id) => `projects/z/assets/video/${id}.mp4`);
  return {
    timeline: timelineSchema.parse({
      width: 1280,
      height: 720,
      tracks: [
        {
          id: "v",
          kind: "video",
          name: "Video",
          clips: [
            clip("FN15-1", takes[0], 0),
            clip("FN15-2", takes[1], 5),
            clip("FN15-4", takes[3], 10),
            clip("FN15-3", takes[2], 15),
          ],
        },
      ],
    }),
    approved: takes.map((asset, i) => ({
      shotId: `s${i + 1}`,
      title: `FN15-${i + 1}`,
      asset,
      canvas: { width: 768, height: 1344 },
    })),
    lane: null,
    ...overrides,
  };
}

test("majorityCanvas picks the most common geometry, ties to the first seen", () => {
  assert.deepEqual(majorityCanvas([{ width: 1, height: 2 }, null, { width: 3, height: 4 }, { width: 3, height: 4 }]), { width: 3, height: 4 });
  assert.deepEqual(majorityCanvas([{ width: 1, height: 2 }, { width: 3, height: 4 }]), { width: 1, height: 2 });
  assert.equal(majorityCanvas([null, null]), null);
});

test("no lane: the canvas comes from the takes, the order from the production", () => {
  const plan = planNormalize(pilotFacts());
  assert.deepEqual(plan.canvas.from, { width: 1280, height: 720 });
  assert.deepEqual(plan.canvas.to, { width: 768, height: 1344 });
  assert.equal(plan.canvas.source, "takes");
  assert.match(plan.canvas.detail, /4 of 4 approved takes/);
  assert.deepEqual(plan.order.before, ["FN15-1", "FN15-2", "FN15-4", "FN15-3"]);
  assert.deepEqual(plan.order.after, ["FN15-1", "FN15-2", "FN15-3", "FN15-4"]);
  assert.equal(plan.order.changed, true);
  assert.deepEqual(plan.order.missing, []);
  assert.deepEqual(plan.order.extra, []);
});

test("a lane's canvas wins over the takes', and a mismatch is said out loud", () => {
  const lane = videoPresetSchema.parse({
    id: "zoo-interview-single",
    label: "Interview single",
    payload: { resolution: "1280 × 704 (16:9)" },
  });
  const plan = planNormalize(pilotFacts({ lane }));
  assert.deepEqual(plan.canvas.to, { width: 1280, height: 704 });
  assert.equal(plan.canvas.source, "lane");
  assert.ok(plan.notes.some((n) => /4 approved takes were rendered at another canvas/.test(n)));
});

test("an unknown lane is reported, not silently ignored", () => {
  const plan = planNormalize(pilotFacts({ laneMissing: "zoo-nope" }));
  assert.equal(plan.canvas.source, "takes");
  assert.ok(plan.notes.some((n) => /No render lane "zoo-nope"/.test(n)));
});

test("already normal: no canvas change, order unchanged, nothing invented", () => {
  const facts = pilotFacts();
  facts.timeline.width = 768;
  facts.timeline.height = 1344;
  const track = facts.timeline.tracks[0];
  track.clips = [track.clips[0], track.clips[1], track.clips[3], track.clips[2]].map((c, i) => ({ ...c, start: i * 5 }));
  const plan = planNormalize(facts);
  assert.equal(plan.canvas.to, null);
  assert.equal(plan.canvas.source, "unchanged");
  assert.equal(plan.order.changed, false);
});

test("approved takes off the sequence are listed as missing; hand-placed clips are kept at the end", () => {
  const facts = pilotFacts();
  const track = facts.timeline.tracks[0];
  // the pilot fixture lays FN15-4 third and FN15-3 fourth
  track.clips = [
    { ...track.clips[2], start: 0 },
    { ...track.clips[0], start: 5 },
    clip("cutaway", "projects/z/assets/video/cut.mp4", 10),
  ];
  const plan = planNormalize(facts);
  assert.deepEqual(plan.order.before, ["FN15-4", "FN15-1", "cutaway"]);
  assert.deepEqual(plan.order.missing, ["FN15-2", "FN15-3"]);
  assert.deepEqual(plan.order.extra, ["cutaway"]);
  assert.deepEqual(plan.order.after, ["FN15-1", "FN15-4", "cutaway"]);
});

test("TimelineStore.setCanvas writes the geometry and orderVideoTrack re-butts in the given order", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aurea-normalize-"));
  const settings = { get: () => ({ storage: { dataRoot: tmp } }) } as unknown as SettingsStore;
  const store = new TimelineStore(settings);
  const facts = pilotFacts();
  store.update("z", facts.timeline);
  const tl = store.setCanvas("z", 768, 1344);
  assert.equal(tl.width, 768);
  assert.equal(tl.height, 1344);
  const ordered = store.orderVideoTrack("z", facts.approved.map((a) => a.asset));
  const video = ordered.tracks.find((t) => t.kind === "video")!;
  assert.deepEqual(video.clips.map((c) => c.label), ["FN15-1", "FN15-2", "FN15-3", "FN15-4"]);
  assert.deepEqual(video.clips.map((c) => c.start), [0, 5, 10, 15]);
  // persisted
  const back = store.get("z");
  assert.equal(back.width, 768);
  assert.deepEqual(back.tracks[0].clips.map((c) => c.label), ["FN15-1", "FN15-2", "FN15-3", "FN15-4"]);
});
