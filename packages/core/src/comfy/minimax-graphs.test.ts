import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MINIMAX_H3_MANAGED,
  frameLength,
  minimaxH3Graph,
  snapCanvas,
} from "./minimax-graphs.js";

/* The 17k+5 grid is the one number in this graph that ComfyUI will not fix for
 * you: an off-grid `length` fails inside MiniMaxH3ImageToVideo, after the 24 GB
 * of weights have already been read off disk. Worth pinning. */
test("frameLength lands on the 17k+5 grid", () => {
  for (let sec = 4; sec <= 15; sec += 0.1) {
    const n = frameLength(sec);
    assert.equal((n - 5) % 17, 0, `${sec}s → ${n} is off the grid`);
  }
});

test("frameLength snaps UP, never short", () => {
  for (let sec = 4; sec <= 15; sec += 0.25) {
    assert.ok(
      frameLength(sec) >= Math.round(sec * 24),
      `${sec}s rounded down to ${frameLength(sec)}`,
    );
  }
  // the published 5s default, and the node's own floor
  assert.equal(frameLength(5), 124);
  assert.equal(frameLength(0), 5);
});

test("snapCanvas floors to multiples of 32", () => {
  assert.deepEqual(snapCanvas(1344, 768), [1344, 768]);
  // 1280 is already on the grid; 700 is not (21.875 × 32) and must not grow
  assert.deepEqual(snapCanvas(1280, 700), [1280, 672]);
  assert.deepEqual(snapCanvas(10, 10), [32, 32]);
});

test("t2v graph carries no image loaders", () => {
  const g = minimaxH3Graph({
    prompt: "a shot",
    durationSec: 5,
    width: 1344,
    height: 768,
    seed: 1,
    models: MINIMAX_H3_MANAGED,
  });
  const classes = Object.values(g).map((n) => n.class_type);
  assert.ok(!classes.includes("LoadImage"));
  assert.ok(!("first_frame" in g["5"].inputs));
});

test("a start frame wires into the conditioning node", () => {
  const g = minimaxH3Graph({
    prompt: "a shot",
    firstFrameName: "aurea/j1-first.png",
    durationSec: 6,
    width: 1344,
    height: 768,
    seed: 1,
    models: MINIMAX_H3_MANAGED,
  });
  assert.equal(g["15"].class_type, "LoadImage");
  assert.deepEqual(g["5"].inputs.first_frame, ["15", 0]);
  assert.equal(g["5"].inputs.length, frameLength(6));
});

/* Picture and sound come out of ONE sampled latent through two VAEs — if a
 * refactor ever forks the sample, the take stops being lip-synced. */
test("both decoders read the same sampled latent", () => {
  const g = minimaxH3Graph({
    prompt: "a shot",
    durationSec: 5,
    width: 1344,
    height: 768,
    seed: 1,
    models: MINIMAX_H3_MANAGED,
  });
  assert.deepEqual(g["11"].inputs.samples, ["10", 0]);
  assert.deepEqual(g["12"].inputs.samples, ["10", 0]);
  assert.deepEqual(g["13"].inputs.audio, ["12", 0]);
});
