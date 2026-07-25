/* The timeline builder writes JSON that a python node parses, so the contract
 * is invisible to the type system — these tests pin the rules read out of
 * ltx_director.py. `insert` below mirrors the node's own arithmetic:
 *
 *   insert_frame = isEndFrame ? start + length - 1 : start
 *
 * so a test that asserts on `insert` is asserting on where the image actually
 * lands in the render, not merely on the shape of our JSON. */

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTimelineData,
  snapFrames,
  snapSize,
  secToFrames,
  type TimelineInput,
} from "./director-timeline.js";

interface ParsedSegment {
  start: number;
  length: number;
  imageFile: string;
  isEndFrame: boolean;
}

interface ParsedMotion {
  videoFile: string;
  start: number;
  length: number;
  trimStart: number;
  videoStrength: number;
  /** only a cast sheet carries these — a motion clip is a clip */
  isStaticImage?: boolean;
  videoDurationFrames?: number;
  videoAttentionStrength?: number;
  resampleMode?: string;
}

/** what the node will do with our JSON */
function parse(inputs: ReturnType<typeof buildTimelineData>) {
  const data = JSON.parse(inputs.timeline_data) as {
    segments: ParsedSegment[];
    audioSegments: Array<{ audioFile: string; start: number; length: number; trimStart: number }>;
    motionSegments: ParsedMotion[];
    global_prompt: string;
    retakeMode: boolean;
  };
  const sorted = [...data.segments].sort((a, b) => a.start - b.start);
  const strengths = inputs.guide_strength
    ? inputs.guide_strength.split(",").map((s) => Number(s.trim()))
    : [];
  return {
    ...data,
    guides: sorted.map((s, i) => ({
      file: s.imageFile,
      insert: s.isEndFrame ? s.start + s.length - 1 : s.start,
      strength: strengths[i] ?? 1.0,
    })),
    zones: inputs.local_prompts ? inputs.local_prompts.split("|") : [],
    lengths: inputs.segment_lengths
      ? inputs.segment_lengths.split(",").map((s) => Number(s.trim()))
      : [],
  };
}

const base: TimelineInput = { globalPrompt: "a warm kitchen", fps: 24, durationFrames: 121 };

test("frame and size snapping follow LTX's 8n+1 / ÷32 rules", () => {
  assert.equal(snapFrames(120), 121);
  assert.equal(snapFrames(121), 121);
  assert.equal(snapFrames(122), 129); // rounds UP — never short-changes the ask
  assert.equal(snapFrames(1), 1);
  assert.equal(snapSize(700), 672);
  assert.equal(snapSize(704), 704);
  assert.equal(secToFrames(5, 24), 120);
});

test("a keyframes-only shot leaves the prompt-relay inputs empty", () => {
  // empty local_prompts is the node's signal to use the global prompt alone
  const out = buildTimelineData({ ...base, keyframes: [{ file: "a.png", atFrame: 0, strength: 1 }] });
  assert.equal(out.local_prompts, "");
  assert.equal(out.segment_lengths, "");
  assert.equal(parse(out).global_prompt, "a warm kitchen");
});

test("start and end frames land on the first and last frame", () => {
  const out = buildTimelineData({
    ...base,
    keyframes: [
      { file: "start.png", atFrame: 0, strength: 1 },
      { file: "end.png", atFrame: 120, strength: 0.85 },
    ],
  });
  const { guides } = parse(out);
  assert.deepEqual(
    guides.map((g) => [g.file, g.insert]),
    [
      ["start.png", 0],
      ["end.png", 120],
    ],
  );
});

test("guide strengths follow sorted order, not authoring order", () => {
  // the node zips guide_strength against segments sorted by start — authoring
  // the end frame first must not hand it the start frame's strength
  const out = buildTimelineData({
    ...base,
    keyframes: [
      { file: "end.png", atFrame: 120, strength: 0.4 },
      { file: "start.png", atFrame: 0, strength: 1 },
      { file: "mid.png", atFrame: 60, strength: 0.7 },
    ],
  });
  assert.deepEqual(
    parse(out).guides.map((g) => [g.file, g.insert, g.strength]),
    [
      ["start.png", 0, 1],
      ["mid.png", 60, 0.7],
      ["end.png", 120, 0.4],
    ],
  );
});

test("keyframes past the end of the clip are dropped", () => {
  const out = buildTimelineData({
    ...base,
    keyframes: [
      { file: "in.png", atFrame: 0, strength: 1 },
      { file: "out.png", atFrame: 200, strength: 1 },
    ],
  });
  const { guides } = parse(out);
  assert.equal(guides.length, 1);
  assert.equal(guides[0].file, "in.png");
});

test("prompt zones tile the clip exactly", () => {
  // the node needs one length per prompt and clamps the total to the clip;
  // a short tiling would leave the last beat never arriving
  const out = buildTimelineData({
    ...base,
    promptZones: [
      { prompt: "wide establishing", lengthFrames: 40 },
      { prompt: "push in", lengthFrames: 40 },
      { prompt: "reaction close-up", lengthFrames: 20 },
    ],
  });
  const { zones, lengths } = parse(out);
  assert.equal(zones.length, lengths.length);
  assert.deepEqual(zones, ["wide establishing", "push in", "reaction close-up"]);
  assert.equal(
    lengths.reduce((a, b) => a + b, 0),
    121,
  );
});

test("zones that overrun the clip are truncated, not silently dropped", () => {
  const out = buildTimelineData({
    ...base,
    promptZones: [
      { prompt: "one", lengthFrames: 100 },
      { prompt: "two", lengthFrames: 100 },
      { prompt: "three", lengthFrames: 100 },
    ],
  });
  const { zones, lengths } = parse(out);
  assert.deepEqual(zones.length, lengths.length);
  assert.equal(
    lengths.reduce((a, b) => a + b, 0),
    121,
  );
  assert.deepEqual(lengths, [100, 21]); // the third never starts
});

test("a pipe in a prompt can't break the delimiter", () => {
  const out = buildTimelineData({
    ...base,
    promptZones: [{ prompt: "he says | she says", lengthFrames: 121 }],
  });
  assert.equal(parse(out).zones.length, 1);
});

test("voice takes become audio segments at their timecodes", () => {
  const out = buildTimelineData({
    ...base,
    audio: [
      { file: "aurea/sterling.wav", atFrame: 24, lengthFrames: 48 },
      { file: "aurea/grant.wav", atFrame: 84, lengthFrames: 30, trimStartFrames: 5 },
    ],
  });
  assert.deepEqual(parse(out).audioSegments, [
    { audioFile: "aurea/sterling.wav", start: 24, length: 48, trimStart: 0 },
    { audioFile: "aurea/grant.wav", start: 84, length: 30, trimStart: 5 },
  ]);
});

test("a take running past the end is truncated, one starting past it is dropped", () => {
  const out = buildTimelineData({
    ...base, // 121 frames
    audio: [
      // starts 1s in with 4s of speech in a 5s shot: 24 frames of it don't fit
      { file: "aurea/long.wav", atFrame: 24, lengthFrames: 121 },
      { file: "aurea/late.wav", atFrame: 121, lengthFrames: 48 },
    ],
  });
  assert.deepEqual(parse(out).audioSegments, [
    { audioFile: "aurea/long.wav", start: 24, length: 97, trimStart: 0 },
  ]);
});

test("overlapping takes both survive — the node mixes them additively", () => {
  const out = buildTimelineData({
    ...base,
    audio: [
      { file: "aurea/a.wav", atFrame: 0, lengthFrames: 60 },
      { file: "aurea/b.wav", atFrame: 40, lengthFrames: 60 },
    ],
  });
  assert.equal(parse(out).audioSegments.length, 2);
});

test("a motion reference carries its own trim and strength", () => {
  const out = buildTimelineData({
    ...base,
    keyframes: [{ file: "hero.png", atFrame: 0, strength: 1 }],
    motion: [
      { file: "aurea/dance.mp4", atFrame: 0, lengthFrames: 121, trimStartFrames: 12, strength: 0.8 },
    ],
  });
  assert.deepEqual(parse(out).motionSegments, [
    { videoFile: "aurea/dance.mp4", start: 0, length: 121, trimStart: 12, videoStrength: 0.8 },
  ]);
});

test("motion strength defaults to the node's full-bite 1.0", () => {
  const out = buildTimelineData({
    ...base,
    motion: [{ file: "aurea/dance.mp4", atFrame: 0, lengthFrames: 121 }],
  });
  assert.deepEqual(parse(out).motionSegments[0], {
    videoFile: "aurea/dance.mp4",
    start: 0,
    length: 121,
    trimStart: 0,
    videoStrength: 1,
  });
});

test("retake carries the source video and the window to re-render", () => {
  const out = buildTimelineData({
    ...base,
    retake: {
      file: "aurea/take.mp4",
      atFrame: 48,
      lengthFrames: 48,
      prompt: "replace the mug with a glass",
      sourceDurationFrames: 121,
    },
  });
  const data = JSON.parse(out.timeline_data) as Record<string, unknown>;
  assert.equal(data.retakeMode, true);
  assert.equal(data.retakeStart, 48);
  assert.equal(data.retakeLength, 48);
  assert.equal(data.retakeStrength, 1);
  assert.deepEqual(data.retakeVideo, {
    fileName: "take.mp4",
    imageFile: "aurea/take.mp4",
    videoDurationFrames: 121,
  });
  // in retake mode the node reads its global prompt from retake_global_prompt,
  // so leaving that empty would render the fix with no cast anchored
  assert.equal(data.retake_global_prompt, "a warm kitchen");
});

test("a retake confines its prompt to the window and anchors the rest", () => {
  // mirrors the pack's own editor: [anchor | the fix | anchor] with the guide
  // strengths zeroed outside the window
  const out = buildTimelineData({
    ...base, // 121 frames
    retake: {
      file: "aurea/take.mp4",
      atFrame: 48,
      lengthFrames: 24,
      prompt: "he blinks instead of flinching",
      sourceDurationFrames: 121,
      strength: 0.9,
    },
  });
  const { zones, lengths } = parse(out);
  assert.deepEqual(zones, ["a warm kitchen", "he blinks instead of flinching", "a warm kitchen"]);
  assert.deepEqual(lengths, [48, 24, 49]);
  assert.equal(
    lengths.reduce((a, b) => a + b, 0),
    121,
  );
  assert.equal(out.guide_strength, "0.00, 0.90, 0.00");
});

test("a retake at frame 0 has no leading zone to describe", () => {
  const out = buildTimelineData({
    ...base,
    retake: {
      file: "aurea/take.mp4",
      atFrame: 0,
      lengthFrames: 121,
      prompt: "the whole thing, warmer",
      sourceDurationFrames: 121,
    },
  });
  const { zones, lengths } = parse(out);
  assert.deepEqual(zones, ["the whole thing, warmer"]);
  assert.deepEqual(lengths, [121]);
});

test("a retake drops keyframes, takes and motion the node would ignore", () => {
  // the guide node returns before it reads any of them — a timeline claiming
  // them would describe a render nobody gets
  const out = buildTimelineData({
    ...base,
    keyframes: [{ file: "hero.png", atFrame: 0, strength: 1 }],
    audio: [{ file: "aurea/line.wav", atFrame: 0, lengthFrames: 48 }],
    motion: [{ file: "aurea/dance.mp4", atFrame: 0, lengthFrames: 121 }],
    retake: {
      file: "aurea/take.mp4",
      atFrame: 24,
      lengthFrames: 24,
      prompt: "fix his hand",
      sourceDurationFrames: 121,
    },
  });
  const data = parse(out);
  assert.deepEqual(data.segments, []);
  assert.deepEqual(data.audioSegments, []);
  assert.deepEqual(data.motionSegments, []);
});

/* --- cast references ------------------------------------------------
 * The sheet rides the same IC-LoRA track as a motion reference, so these pin
 * the two things that make it a REFERENCE rather than a clip: it starts at
 * frame 0, and it is one frame long unless someone asks otherwise. */

test("a cast sheet lands at frame 0 as a one-frame still", () => {
  const out = buildTimelineData({
    ...base,
    keyframes: [{ file: "hero.png", atFrame: 0, strength: 1 }],
    refSheet: { file: "aurea/sheet.png", strength: 0.9 },
  });
  assert.deepEqual(parse(out).motionSegments, [
    {
      videoFile: "aurea/sheet.png",
      isStaticImage: true,
      start: 0,
      length: 1,
      trimStart: 0,
      videoDurationFrames: 1,
      videoStrength: 0.9,
      videoAttentionStrength: 0.65,
      resampleMode: "nearest",
    },
  ]);
});

test("a sheet held for longer snaps to LTX's frame stride and the clip", () => {
  const span = (spanFrames: number) =>
    parse(buildTimelineData({ ...base, refSheet: { file: "aurea/sheet.png", spanFrames } }))
      .motionSegments[0];
  // 24 frames of hold → the next valid 8n+1
  assert.equal(span(24).length, 25);
  assert.equal(span(24).videoDurationFrames, 25);
  // and never past the end of the shot
  assert.equal(span(500).length, base.durationFrames);
});

test("a retake drops the cast sheet too", () => {
  const out = buildTimelineData({
    ...base,
    refSheet: { file: "aurea/sheet.png" },
    retake: {
      file: "aurea/take.mp4",
      atFrame: 24,
      lengthFrames: 24,
      prompt: "fix his hand",
      sourceDurationFrames: 121,
    },
  });
  assert.deepEqual(parse(out).motionSegments, []);
});

test("no retake means retakeMode stays off", () => {
  const data = JSON.parse(buildTimelineData(base).timeline_data) as { retakeMode: boolean };
  assert.equal(data.retakeMode, false);
});
