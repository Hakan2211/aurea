import assert from "node:assert/strict";
import { test } from "node:test";
import {
  minimaxRefLabels,
  minimaxRefsSchema,
  unknownMinimaxRefTags,
  type MinimaxRefs,
} from "@aurea/shared";
import {
  MINIMAX_H3_MANAGED,
  MINIMAX_H3_REF_MANAGED,
  frameLength,
  minimaxH3Graph,
  minimaxH3RefGraph,
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

test("sage patches the unet and everything model-side reads the patch", () => {
  const g = minimaxH3Graph({
    prompt: "a shot",
    durationSec: 5,
    width: 1344,
    height: 768,
    seed: 1,
    sage: true,
    models: MINIMAX_H3_MANAGED,
  });
  assert.equal(g["17"].class_type, "PathchSageAttentionKJ");
  assert.deepEqual(g["7"].inputs.model, ["17", 0]);
  assert.deepEqual(g["9"].inputs.model, ["17", 0]);
  // and OFF leaves the verified wiring untouched
  const plain = minimaxH3Graph({
    prompt: "a shot",
    durationSec: 5,
    width: 1344,
    height: 768,
    seed: 1,
    models: MINIMAX_H3_MANAGED,
  });
  assert.equal(plain["17"], undefined);
  assert.deepEqual(plain["7"].inputs.model, ["1", 0]);
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

/* ---------- ref2va ---------- */

const REF_MODELS = { ...MINIMAX_H3_MANAGED, refUnet: MINIMAX_H3_REF_MANAGED };

const refGraph = (over: Partial<Parameters<typeof minimaxH3RefGraph>[0]> = {}) =>
  minimaxH3RefGraph({
    prompt: "<Picture 1> walks in",
    refImageNames: [],
    refVideos: [],
    refAudioNames: [],
    durationSec: 5,
    width: 1344,
    height: 768,
    seed: 1,
    models: REF_MODELS,
    ...over,
  });

/* The autogrow input names are the one thing in this graph that cannot be
 * guessed from the node's Python signature: `execute` receives grouped dicts,
 * but an API prompt addresses each slot by its DOTTED path. Get it wrong and
 * ComfyUI accepts the prompt and renders with no references at all. */
test("reference slots use their dotted autogrow paths, 0-based and contiguous", () => {
  const g = refGraph({
    refImageNames: ["a.png", "b.png"],
    refVideos: [{ file: "clip.mp4", withAudio: true }],
    refAudioNames: ["voice.wav"],
  });
  const cond = g["5"].inputs as Record<string, unknown>;
  assert.equal(g["5"].class_type, "MiniMaxH3ReferenceToVideo");
  assert.deepEqual(cond["ref_images.ref_image_0"], ["20", 0]);
  assert.deepEqual(cond["ref_images.ref_image_1"], ["21", 0]);
  // frames off output 0 of GetVideoComponents, its soundtrack off output 1
  assert.deepEqual(cond["ref_videos.ref_video_0"], ["35", 0]);
  assert.deepEqual(cond["ref_video_audios.ref_video_audio_0"], ["35", 1]);
  assert.deepEqual(cond["ref_audios.ref_audio_0"], ["40", 0]);
  assert.equal(g["30"].class_type, "LoadVideo");
  assert.equal(g["35"].class_type, "GetVideoComponents");
  assert.equal(g["40"].class_type, "LoadAudio");
});

test("a silent reference clip wires no soundtrack", () => {
  const g = refGraph({ refVideos: [{ file: "clip.mp4", withAudio: false }] });
  const cond = g["5"].inputs as Record<string, unknown>;
  assert.ok("ref_videos.ref_video_0" in cond);
  assert.ok(!("ref_video_audios.ref_video_audio_0" in cond));
});

/* ref2va and fl2va are different checkpoints. Rendering references against the
 * fl2va unet does not fail — it ignores them. */
test("the reference graph loads the ref2va head and reads sound", () => {
  const g = refGraph({ refImageNames: ["a.png"] });
  assert.equal(g["1"].inputs.unet_name, MINIMAX_H3_REF_MANAGED);
  assert.notEqual(g["1"].inputs.unet_name, MINIMAX_H3_MANAGED.unet);
  // the audio VAE conditions the shot here, not just the decode
  assert.deepEqual((g["5"].inputs as Record<string, unknown>).audio_vae, ["4", 0]);
  assert.equal((g["5"].inputs as Record<string, unknown>).ref_image_size, "match");
  assert.equal(g["5"].inputs.length, frameLength(5));
});

const refs = (over: Partial<MinimaxRefs> = {}): MinimaxRefs => minimaxRefsSchema.parse(over);

/* The numbering trap: a clip's own soundtrack is an <Audio j> in its own
 * right, emitted BEFORE its <Video k>. So a standalone voice attached second
 * is <Audio 2>, and a prompt that calls it <Audio 1> silently points at the
 * clip's room tone. */
test("a clip's soundtrack takes the first <Audio> number", () => {
  const l = minimaxRefLabels(
    refs({
      images: ["a.png"],
      videos: [{ video: "clip.mp4", startSec: 0, lengthSec: 3, useItsAudio: true }],
      audios: ["voice.wav"],
    }),
  );
  assert.deepEqual(l.images, ["<Picture 1>"]);
  assert.deepEqual(l.videos, [{ video: "<Video 1>", audio: "<Audio 1>" }]);
  assert.deepEqual(l.audios, ["<Audio 2>"]);
  assert.deepEqual(l.all, ["<Picture 1>", "<Audio 1>", "<Video 1>", "<Audio 2>"]);
});

test("a silent clip leaves <Audio 1> to the standalone sound", () => {
  const l = minimaxRefLabels(
    refs({
      videos: [{ video: "clip.mp4", startSec: 0, lengthSec: 3, useItsAudio: false }],
      audios: ["voice.wav"],
    }),
  );
  assert.deepEqual(l.videos, [{ video: "<Video 1>", audio: null }]);
  assert.deepEqual(l.audios, ["<Audio 1>"]);
});

test("tags the prompt invents are reported, tags it has are not", () => {
  const set = refs({ images: ["a.png", "b.png"] });
  assert.deepEqual(unknownMinimaxRefTags("<Picture 1> meets <Picture 2>", set), []);
  assert.deepEqual(unknownMinimaxRefTags("<Picture 3> arrives", set), ["<Picture 3>"]);
  // case and stray whitespace are the model's tolerance, not a different tag
  assert.deepEqual(unknownMinimaxRefTags("<picture 2> arrives", set), []);
  assert.deepEqual(unknownMinimaxRefTags("< Picture  1 > arrives", set), []);
  assert.deepEqual(unknownMinimaxRefTags("nothing tagged here", set), []);
});
