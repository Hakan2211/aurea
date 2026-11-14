/* P3 trust signals (2026-09-02): hard take verification, pinned.
 *
 * The pure judgement over hand-built measurements, the ffmpeg parsers over
 * real-shaped output, and the store rules — a broken take never stays the one
 * under review, and approve_shot refuses it without `force`. The ffmpeg calls
 * themselves are exercised on a live take (verify_take). */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bibleSchema, productionSchema, shotSchema } from "@aurea/shared";
import { StudioStore } from "./studio.js";
import type { SettingsStore } from "./settings.js";
import type { ProjectStore } from "./projects.js";
import { DIGITAL_SILENCE_DB, judgeTake, parseFrameCount, parseMeanDb, roomTonePrompt, verifyRecord, type TakeMeasurement } from "./take-verify.js";
import { expectationOf } from "./take-delivery.js";

const good: TakeMeasurement = { hasVideo: true, frames: 121, durationSec: 5.04, hasAudio: true, meanDb: -23.5 };

/* ---- judgement ---- */

test("a healthy take with placed lines is ok", () => {
  const j = judgeTake(good, { expectAudio: true, requestedDurationSec: 5 });
  assert.equal(j.status, "ok");
  assert.deepEqual(j.reasons, []);
  assert.equal(j.silent, false);
});

test("no video track is broken even when the container 'succeeded'", () => {
  const j = judgeTake({ ...good, hasVideo: false, frames: null }, { expectAudio: false });
  assert.equal(j.status, "broken");
  assert.match(j.reasons[0], /no video track/);
});

test("zero decodable frames is broken — the PNG-in-an-mp4 case", () => {
  const j = judgeTake({ ...good, frames: 0 }, { expectAudio: false });
  assert.equal(j.status, "broken");
  assert.match(j.reasons[0], /zero decodable frames/);
});

test("a single still probes as video — one frame, no duration — and is broken", () => {
  const j = judgeTake({ hasVideo: true, frames: 1, durationSec: null, hasAudio: false, meanDb: null }, { expectAudio: false });
  assert.equal(j.status, "broken");
  assert.match(j.reasons[0], /single still/);
  /* unknown frame count but a real duration is not a still */
  assert.equal(judgeTake({ ...good, frames: null }, { expectAudio: false }).status, "ok");
});

test("digital silence under placed lines is broken; without lines it is silent-but-ok (room-tone candidate)", () => {
  const silent = { ...good, meanDb: -91 };
  const withLines = judgeTake(silent, { expectAudio: true });
  assert.equal(withLines.status, "broken");
  assert.match(withLines.reasons[0], /digital silence/);
  const noLines = judgeTake(silent, { expectAudio: false });
  assert.equal(noLines.status, "ok");
  assert.equal(noLines.silent, true);
  /* a quiet room is not digital silence */
  assert.equal(judgeTake({ ...good, meanDb: DIGITAL_SILENCE_DB + 5 }, { expectAudio: true }).silent, false);
});

test("a missing audio stream reads as silent: broken under lines, ok without", () => {
  const m = { ...good, hasAudio: false, meanDb: null };
  assert.equal(judgeTake(m, { expectAudio: true }).status, "broken");
  const j = judgeTake(m, { expectAudio: false });
  assert.equal(j.status, "ok");
  assert.equal(j.silent, true);
});

test("duration off by more than 15% of the requested length is broken; inside it is fine", () => {
  assert.equal(judgeTake({ ...good, durationSec: 8 }, { expectAudio: true, requestedDurationSec: 5 }).status, "broken");
  assert.equal(judgeTake({ ...good, durationSec: 5.6 }, { expectAudio: true, requestedDurationSec: 5 }).status, "ok");
  /* no requested length → no duration verdict */
  assert.equal(judgeTake({ ...good, durationSec: 8 }, { expectAudio: true }).status, "ok");
});

test("every failing check is its own reason, in one line each", () => {
  const j = judgeTake({ hasVideo: true, frames: 0, durationSec: 1, hasAudio: false, meanDb: null }, { expectAudio: true, requestedDurationSec: 5 });
  assert.equal(j.reasons.length, 3);
});

/* ---- parsers ---- */

test("parseMeanDb reads volumedetect, including -inf", () => {
  assert.equal(parseMeanDb("[Parsed_volumedetect_0 @ 0x1] mean_volume: -23.4 dB\nmax_volume: -1.0 dB"), -23.4);
  assert.equal(parseMeanDb("mean_volume: -inf dB"), -Infinity);
  assert.equal(parseMeanDb("nothing here"), null);
});

test("parseFrameCount reads nb_read_frames; verifyRecord stores -inf as a finite level", () => {
  assert.equal(parseFrameCount("nb_read_frames=121\n"), 121);
  assert.equal(parseFrameCount(""), null);
  const rec = verifyRecord({ ...good, meanDb: -Infinity }, { status: "ok", reasons: [], silent: true }, "projects/p/tone.wav");
  assert.equal(rec.meanDb, -99);
  assert.equal(rec.roomTone, "projects/p/tone.wav");
  assert.equal(rec.status, "ok");
});

/* ---- what the payload promised ---- */

test("expectationOf: placed dialogue audio or director audio means silence is a failure", () => {
  assert.equal(expectationOf({ durationSec: 5 }).expectAudio, false);
  assert.equal(expectationOf({ audio: "projects/p/line.wav" }).expectAudio, true);
  assert.equal(expectationOf({ director: { audio: [{}] } }).expectAudio, true);
  assert.equal(expectationOf({ durationSec: 6 }).requestedDurationSec, 6);
});

test("roomTonePrompt asks for a room, not a score", () => {
  const p = roomTonePrompt({ name: "The Lounge", description: "a warm bar at closing time" });
  assert.match(p, /The Lounge/);
  assert.match(p, /no music/);
  assert.match(p, /no melody/);
});

/* ---- store rules ---- */

const take = (id: string, verify?: { status: "ok" | "broken" | "pending"; reasons: string[] }) => ({
  id,
  asset: `projects/p/assets/video/${id}.mp4`,
  engine: "ltx25",
  label: "",
  ...(verify ? { verify } : {}),
});

function harness(shots: Array<Record<string, unknown>>) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aurea-p3-"));
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
            { id: "e1", number: 1, title: "E1", scenes: [{ id: "sc1", slugline: "INT.", shots: shots.map((s) => shotSchema.parse(s)) }] },
          ],
        },
      ],
    }),
  );
  return { studio, tmp };
}

test("a delivered take lands pending verification and is selected; recording 'broken' moves the pick back", () => {
  const { studio } = harness([{ id: "sh1", videoTakes: [take("t1", { status: "ok", reasons: [] })], selectedTake: "t1", status: "generated" }]);
  const { shot } = studio.attachTake("p", "sh1", ["projects/p/assets/video/t2.mp4"], "ltx25", { durationSec: 5, verify: true });
  const t2 = shot.videoTakes.at(-1)!;
  assert.equal(t2.verify?.status, "pending");
  assert.equal(shot.selectedTake, t2.id);
  const after = studio.recordTakeVerify("p", "sh1", t2.id, { status: "broken", reasons: ["no video track"] });
  assert.equal(after.take.verify?.status, "broken");
  assert.equal(after.shot.selectedTake, "t1", "the newest ok take is the one under review");
});

test("recording 'broken' on an approved shot leaves the human's pick alone", () => {
  const { studio } = harness([{ id: "sh1", videoTakes: [take("t1"), take("t2")], selectedTake: "t2", status: "approved" }]);
  const { shot } = studio.recordTakeVerify("p", "sh1", "t2", { status: "broken", reasons: ["runs 8s vs 5s"] });
  assert.equal(shot.selectedTake, "t2");
});

test("recordTakeVerify can swap the take's asset — the room-tone bed's sibling file", () => {
  const { studio } = harness([{ id: "sh1", videoTakes: [take("t1")], selectedTake: "t1", status: "generated" }]);
  const { take: t } = studio.recordTakeVerify("p", "sh1", "t1", { status: "ok", reasons: [], roomTone: "projects/p/tone.wav" }, { asset: "projects/p/assets/video/t1.tone.mp4" });
  assert.equal(t.asset, "projects/p/assets/video/t1.tone.mp4");
  assert.equal(t.verify?.roomTone, "projects/p/tone.wav");
});

test("approve_shot refuses a broken take with the reason, and force approves it", () => {
  const { studio } = harness([{ id: "sh1", videoTakes: [take("t1", { status: "broken", reasons: ["zero decodable frames — the file is not a playable video"] })], selectedTake: "t1", status: "generated" }]);
  assert.throws(() => studio.approveShot("p", "sh1", "t1"), /zero decodable frames.*force: true/);
  assert.equal(studio.getShotContext("p", "sh1").shot.status, "generated");
  const { shot } = studio.approveShot("p", "sh1", "t1", true);
  assert.equal(shot.status, "approved");
});

test("a take with no verify record (pre-P3) or a pending one still approves", () => {
  const { studio } = harness([{ id: "sh1", videoTakes: [take("t1"), take("t2", { status: "pending", reasons: [] })], selectedTake: "t2", status: "generated" }]);
  assert.equal(studio.approveShot("p", "sh1", "t1").shot.status, "approved");
  assert.equal(studio.approveShot("p", "sh1", "t2").take.id, "t2");
});

test("setLocationRoomTone lands the bed on its location; the style default is auto", () => {
  const { studio } = harness([]);
  studio.updateBible("p", bibleSchema.parse({ locations: [{ id: "lounge", name: "The Lounge" }] }));
  const bible = studio.setLocationRoomTone("p", "lounge", "projects/p/assets/music/tone.wav");
  assert.equal(bible.locations[0].roomTone, "projects/p/assets/music/tone.wav");
  assert.equal(bible.style.roomTone, "auto");
  assert.throws(() => studio.setLocationRoomTone("p", "nope", null), /unknown location/);
  assert.equal(studio.setLocationRoomTone("p", "lounge", null).locations[0].roomTone, null);
});
