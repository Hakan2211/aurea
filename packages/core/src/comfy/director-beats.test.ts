/* Prompt beats: the two things between a picked camera id and a render — the
 * bank expansion that turns "ws" into language, and the epsilon that decides
 * whether a beat boundary is a cut or a dissolve. Both are pure, so they get
 * pinned here rather than eyeballed on a 10-minute render. */

import test from "node:test";
import assert from "node:assert/strict";
import { CINEMATOGRAPHY_BANK, composeZonePrompt } from "@aurea/shared";
import { directorGraph } from "./director-graph.js";
import { buildTimelineData } from "./director-timeline.js";

const cine = CINEMATOGRAPHY_BANK;

test("a beat reads as action first, then how it's shot", () => {
  const out = composeZonePrompt(
    { prompt: "Sterling freezes as the realization lands.", shot: "cu", move: "push-in" },
    cine,
  );
  assert.match(out, /^Sterling freezes as the realization lands, close-up of the character's face/);
  assert.ok(/push-in toward the subject$/.test(out), out);
});

test("camera ids resolve by id, abbreviation or full name", () => {
  const clause = composeZonePrompt({ prompt: "the crew arrives", shot: "ws" }, cine);
  assert.equal(composeZonePrompt({ prompt: "the crew arrives", shot: "WS" }, cine), clause);
  assert.equal(
    composeZonePrompt({ prompt: "the crew arrives", shot: "WS — wide / full shot" }, cine),
    clause,
  );
});

test("free text passes through, so beats work before the bank is imported", () => {
  const out = composeZonePrompt(
    { prompt: "he leans in", shot: "shot from behind the fridge door" },
    cine,
  );
  assert.equal(out, "he leans in, shot from behind the fridge door");
});

test("a beat that is only a camera change still has a prompt", () => {
  const out = composeZonePrompt({ prompt: "", shot: "ecu", move: "" }, cine);
  assert.ok(out.length > 0);
  assert.ok(!out.startsWith(","), out);
});

/** the LTXDirector node inputs from a built graph */
function directorNode(epsilon?: number) {
  const graph = directorGraph({
    timeline: buildTimelineData({
      globalPrompt: "Sterling in the breakroom",
      fps: 24,
      durationFrames: 241,
      keyframes: [{ file: "aurea/kf0.png", atFrame: 0, strength: 1 }],
      promptZones: [
        { prompt: "wide establishing", lengthFrames: 80 },
        { prompt: "push in", lengthFrames: 80 },
        { prompt: "reaction close-up", lengthFrames: 81 },
      ],
    }),
    negativePrompt: "",
    fps: 24,
    durationFrames: 241,
    width: 704,
    height: 896,
    seed: 1,
    epsilon,
    hasCustomAudio: false,
    inpaintAudio: true,
    hasIcLoraTrack: false,
    models: null,
  });
  return graph.director.inputs as Record<string, unknown>;
}

test("the blend slider reaches the node, and out-of-range values are clamped", () => {
  assert.equal(directorNode(0.35).epsilon, 0.35);
  assert.equal(directorNode(undefined).epsilon, 0.001); // the relay paper's default
  assert.equal(directorNode(0).epsilon, 0.0001); // the node's declared minimum
  assert.equal(directorNode(5).epsilon, 0.99);
});

test("the beats arrive on the node as prompts and matching lengths", () => {
  const node = directorNode(0.001);
  assert.equal(node.local_prompts, "wide establishing|push in|reaction close-up");
  assert.equal(node.segment_lengths, "80, 80, 81");
});
