import assert from "node:assert/strict";
import { test } from "node:test";
import {
  minimaxRefLabels,
  minimaxRefsSchema,
  unknownMinimaxRefTags,
  type MinimaxRefs,
} from "@aurea/shared";
import {
  DRAFT_SAFE_MPX,
  MINIMAX_FINAL_STEPS,
  MINIMAX_H3_MANAGED,
  MINIMAX_H3_REF_MANAGED,
  MINIMAX_H3_REF_W4A8,
  MINIMAX_H3_W4A8,
  MINIMAX_TRAINED_MAX_SEC,
  MINIMAX_TURBO,
  draftCanvas,
  endlessChunkFrames,
  needsEndless,
  estimateRenderMinutes,
  frameLength,
  minimaxH3Graph,
  minimaxH3RefGraph,
  snapCanvas,
  unetLoaderFor,
} from "./minimax-graphs.js";

/* The 17k+5 grid is the one number in this graph that ComfyUI will not fix for
 * you: an off-grid `length` fails inside MiniMaxH3ImageToVideo, after the 24 GB
 * of weights have already been read off disk. Worth pinning. */
test("draftCanvas leaves safe canvases alone and scales hot ones under the 4-step line", () => {
  // 0.34 MPx — the measured verification shape, untouched
  assert.deepEqual(draftCanvas(768, 448), [768, 448]);
  // H3's 1.03 MPx default lands on the published artifact zone → 0.72 target
  assert.deepEqual(draftCanvas(1344, 768), [1120, 640]);
  // portrait is symmetric
  assert.deepEqual(draftCanvas(768, 1344), [640, 1120]);
  // every preset above the line comes back safe, /32, aspect roughly kept
  for (const [w, h] of [[1024, 1024], [1920, 1088], [1088, 1920]] as const) {
    const [dw, dh] = draftCanvas(w, h);
    assert.ok((dw * dh) / 1e6 <= DRAFT_SAFE_MPX, `${w}x${h} → ${dw}x${dh} still hot`);
    assert.equal(dw % 32, 0);
    assert.equal(dh % 32, 0);
    assert.ok(Math.abs(dw / dh - w / h) < 0.1, `${w}x${h} → ${dw}x${dh} bent the aspect`);
  }
});

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

/* The estimator only has to be right enough to separate "wait for it" from
 * "this will not finish". Both anchors are real renders on the 3090 Ti; the
 * third case is the one that took the driver down on 2026-08-23. */
test("estimateRenderMinutes brackets the two measured renders", () => {
  // 768×448, 107 frames, 25 steps — measured 5.6 min
  const small = estimateRenderMinutes(768, 448, 107, 25);
  assert.ok(small > 3 && small < 12, `${small} min is nowhere near the measured 5.6`);

  // 1344×768, 107 frames, 8 steps (Draft) — measured 8.6 min
  const draft = estimateRenderMinutes(1344, 768, 107, 8);
  assert.ok(draft > 5 && draft < 15, `${draft} min is nowhere near the measured 8.6`);
});

/* Pins the adapter's MAX_ESTIMATED_MINUTES from the outside: the shape that
 * crashed has to land above the line and the shapes that work below it, or the
 * guard is decoration. */
test("the estimate sorts the crashed render from the ones that work", () => {
  const LINE = 40; // MAX_ESTIMATED_MINUTES in adapters/minimax-video.ts

  // 1024×1024, 8s → 192 frames, Final's 25 steps — died at step 3 on 2026-08-23
  assert.ok(estimateRenderMinutes(1024, 1024, frameLength(8), 25) > LINE);
  // …and Draft brings that same shot back under, which is what the error offers
  assert.ok(estimateRenderMinutes(1024, 1024, frameLength(8), 8) < LINE);

  // the two renders that have actually completed, nowhere near the line
  assert.ok(estimateRenderMinutes(768, 448, 107, 25) < LINE);
  assert.ok(estimateRenderMinutes(1344, 768, 107, 8) < LINE);
  // a Final hero shot on the native canvas, and a full-length Draft: both allowed
  assert.ok(estimateRenderMinutes(1344, 768, frameLength(4), 25) < LINE);
  assert.ok(estimateRenderMinutes(1344, 768, frameLength(15), 8) < LINE);
  // 15s at full steps is not
  assert.ok(estimateRenderMinutes(1344, 768, frameLength(15), 25) > LINE);
});

test("estimateRenderMinutes rises with every one of its three inputs", () => {
  const base = estimateRenderMinutes(768, 448, 107, 8);
  assert.ok(estimateRenderMinutes(1344, 768, 107, 8) > base, "canvas");
  assert.ok(estimateRenderMinutes(768, 448, 192, 8) > base, "frames");
  assert.ok(estimateRenderMinutes(768, 448, 107, 25) > base, "steps");
});

/* ---------- weight formats and the distilled tiers ---------- */

test("the loader follows the file, not a setting", () => {
  assert.equal(unetLoaderFor("minimax-h3-gguf/diffusion_models/x.gguf"), "UnetLoaderGGUF");
  assert.equal(unetLoaderFor("x.GGUF"), "UnetLoaderGGUF");
  assert.equal(unetLoaderFor(MINIMAX_H3_W4A8.unet), "UNETLoader");
  assert.equal(unetLoaderFor(MINIMAX_H3_REF_W4A8), "UNETLoader");
});

test("a w4a8 unet loads through core's loader, at the checkpoint's own dtype", () => {
  const g = minimaxH3Graph({
    prompt: "a shot",
    durationSec: 5,
    width: 1344,
    height: 768,
    seed: 1,
    models: { ...MINIMAX_H3_MANAGED, ...MINIMAX_H3_W4A8 },
  });
  assert.equal(g["1"].class_type, "UNETLoader");
  // "default" is what makes load_diffusion_model read the quant metadata
  // instead of casting the weights to something else
  assert.equal(g["1"].inputs.weight_dtype, "default");
  assert.equal(g["1"].inputs.unet_name, MINIMAX_H3_W4A8.unet);
  // the GGUF path takes no dtype at all
  const gguf = minimaxH3Graph({
    prompt: "a shot",
    durationSec: 5,
    width: 1344,
    height: 768,
    seed: 1,
    models: MINIMAX_H3_MANAGED,
  });
  assert.equal(gguf["1"].class_type, "UnetLoaderGGUF");
  assert.ok(!("weight_dtype" in gguf["1"].inputs));
});

test("a tier brings its own steps, strength and the schedule it was trained on", () => {
  const spec = MINIMAX_TURBO.draft.fl2v;
  const g = minimaxH3Graph({
    prompt: "a shot",
    durationSec: 5,
    width: 1344,
    height: 768,
    seed: 1,
    turbo: { lora: `loras/${spec.file}`, ...spec },
    models: MINIMAX_H3_MANAGED,
  });
  assert.equal(g["18"].inputs.strength_model, spec.strength);
  assert.equal(g["19"].inputs.shift_video, spec.shiftVideo);
  assert.equal(g["19"].inputs.shift_audio, spec.shiftAudio);
  // the scheduler runs the tier's step count, not Final's
  assert.equal(g["9"].inputs.steps, spec.steps);
  assert.equal(g["9"].inputs.steps, 4);
});

test("no tier = Final: no LoRA, no shift patch, the model's own 25 steps", () => {
  const g = minimaxH3Graph({
    prompt: "a shot",
    durationSec: 5,
    width: 1344,
    height: 768,
    seed: 1,
    models: MINIMAX_H3_MANAGED,
  });
  assert.equal(g["18"], undefined);
  assert.equal(g["19"], undefined);
  assert.equal(g["9"].inputs.steps, MINIMAX_FINAL_STEPS);
  assert.deepEqual(g["7"].inputs.model, ["1", 0]);
});

test("the two heads get different distills — a fl2v LoRA is not a ref2v one", () => {
  for (const tier of ["draft", "standard"] as const) {
    assert.notEqual(MINIMAX_TURBO[tier].fl2v.file, MINIMAX_TURBO[tier].ref2v.file);
  }
  // Draft really is fewer steps than Standard, on both heads
  assert.ok(MINIMAX_TURBO.draft.fl2v.steps < MINIMAX_TURBO.standard.fl2v.steps);
  assert.ok(MINIMAX_TURBO.draft.ref2v.steps < MINIMAX_TURBO.standard.ref2v.steps);
  // …and every tier is cheaper than Final, which is the whole point
  for (const tier of ["draft", "standard"] as const) {
    for (const head of ["fl2v", "ref2v"] as const) {
      assert.ok(MINIMAX_TURBO[tier][head].steps < MINIMAX_FINAL_STEPS);
    }
  }
});

/* ---------- long-form: where one pass stops being possible ---------- */

test("a chunk is the shape that loads whole, scaled by canvas area", () => {
  // the measured single-pass shapes on this class of card, per weight format
  assert.equal(endlessChunkFrames(1344, 768), 107);
  // on the 4-bit weights the native canvas holds H3's whole window, so there
  // the cap is the model rather than the card
  assert.equal(endlessChunkFrames(1344, 768, "w4a8"), frameLength(MINIMAX_TRAINED_MAX_SEC));
  // twice the pixels, so roughly half the frames per chunk
  const twoK = endlessChunkFrames(1920, 1088);
  assert.ok(twoK < 107, `${twoK} should be under 107`);
  assert.ok(endlessChunkFrames(1920, 1088, "w4a8") < frameLength(MINIMAX_TRAINED_MAX_SEC));
  // a smaller canvas gets more
  assert.ok(endlessChunkFrames(768, 448) > 107);
  // …but no canvas, and no weight format, buys a chunk past H3's own window
  for (const w of ["gguf", "w4a8"] as const) {
    assert.equal(endlessChunkFrames(256, 256, w), frameLength(MINIMAX_TRAINED_MAX_SEC));
  }
  // the smaller weights are never the smaller chunk
  for (const [w, h] of [
    [1344, 768],
    [1920, 1088],
    [768, 448],
  ]) {
    assert.ok(endlessChunkFrames(w, h, "w4a8") >= endlessChunkFrames(w, h));
  }
});

test("every chunk size is legal for the sampler", () => {
  for (const [w, h] of [
    [1344, 768],
    [1920, 1088],
    [768, 448],
    [1024, 1024],
    [2048, 2048],
  ]) {
    const n = endlessChunkFrames(w, h);
    assert.equal((n - 5) % 17, 0, `${w}x${h} → ${n} is off the 17k+5 grid`);
    // the node's own floor
    assert.ok(n >= 22, `${w}x${h} → ${n} is below the node's 22-frame floor`);
  }
});

test("long-form starts at H3's window, not at the chunk size", () => {
  /* The chunk is 107 frames at the native canvas, but a 5-15s shot has always
   * rendered in one pass — paging, and finishing. Chunking it instead would put
   * a Gemma pass in front of every ordinary shot for roughly the same wall
   * clock, and would change the output. So everything inside the window stays
   * on the plain sampler, on every canvas. */
  for (const [w, h] of [
    [1344, 768],
    [1920, 1088],
    [768, 448],
  ]) {
    for (let sec = 4; sec <= MINIMAX_TRAINED_MAX_SEC; sec += 0.5) {
      assert.equal(needsEndless(w, h, sec), false, `${w}x${h} ${sec}s`);
    }
    assert.equal(needsEndless(w, h, MINIMAX_TRAINED_MAX_SEC + 0.5), true);
    assert.equal(needsEndless(w, h, 120), true);
  }
});

test("the chunked sampler replaces the plain one, on the reference head", () => {
  /* Long-form is a ref2va graph, always: each finished chunk is carried into
   * the next as H3's own <Video N> reference, and only this head has that
   * channel. */
  const g = minimaxH3RefGraph({
    prompt: "[Shot 1] a ridge",
    refImageNames: ["ridge.png"],
    refVideos: [],
    refAudioNames: [],
    durationSec: 30,
    width: 1344,
    height: 768,
    seed: 1,
    endless: { chunkFrames: 362, continuationFrames: 22, prompt: "[Shot 1] a ridge" },
    models: { ...MINIMAX_H3_MANAGED, refUnet: MINIMAX_H3_REF_MANAGED },
  });
  assert.equal(g["10"].class_type, "HREndlessSampler");
  assert.equal(g["5"].class_type, "MiniMaxH3ReferenceToVideo");
  assert.equal(g["10"].inputs.chunk_frames, 362);
  assert.equal(g["10"].inputs.video_continuation, 22);
  assert.equal(g["10"].inputs.fps, 24);
  // it needs the encoder and the video VAE to build each continuation
  assert.deepEqual(g["10"].inputs.clip, ["2", 0]);
  assert.deepEqual(g["10"].inputs.vae, ["3", 0]);
  /* Every one of the node's REQUIRED inputs has to be present: ComfyUI does not
   * apply a schema default in an API graph, it rejects the prompt. Found the
   * hard way — "Required input is missing (pytorch_memory_fraction)". */
  for (const k of [
    "noise", "guider", "sampler", "sigmas", "latent_image", "clip", "prompt",
    "fps", "chunk_frames", "video_continuation", "video_continuation_res", "vae",
    "cache_gemma_preproduction", "gemma4_mtp", "pytorch_memory_fraction",
    "debug", "debug_stop_chunk", "debug_start_chunk",
  ]) {
    assert.ok(k in g["10"].inputs, `HREndlessSampler is missing ${k}`);
  }
  // both decoders still read output 0, exactly as with the plain sampler
  assert.deepEqual(g["11"].inputs.samples, ["10", 0]);
  assert.deepEqual(g["12"].inputs.samples, ["10", 0]);
});

test("the chunk planner gets every reference still, in order, as one batch", () => {
  const refImageNames = ["a.png", "b.png", "c.png"];
  const g = minimaxH3RefGraph({
    prompt: "[Shot 1] a ridge",
    refImageNames,
    refVideos: [],
    refAudioNames: [],
    durationSec: 30,
    width: 1344,
    height: 768,
    seed: 1,
    endless: { chunkFrames: 362, continuationFrames: 22, prompt: "[Shot 1] a ridge" },
    models: { ...MINIMAX_H3_MANAGED, refUnet: MINIMAX_H3_REF_MANAGED },
  });
  // the sampler matches images one-for-one against the conditioning's own
  // reference list, so the batch has to be exactly the stills, in order
  assert.deepEqual(g["50"].inputs, { image1: ["20", 0], image2: ["21", 0] });
  assert.deepEqual(g["51"].inputs, { image1: ["50", 0], image2: ["22", 0] });
  assert.deepEqual(g["10"].inputs.images, ["51", 0]);

  // one still needs no batch node at all
  const single = minimaxH3RefGraph({
    prompt: "[Shot 1] a ridge",
    refImageNames: ["a.png"],
    refVideos: [],
    refAudioNames: [],
    durationSec: 30,
    width: 1344,
    height: 768,
    seed: 1,
    endless: { chunkFrames: 362, continuationFrames: 22, prompt: "[Shot 1] a ridge" },
    models: { ...MINIMAX_H3_MANAGED, refUnet: MINIMAX_H3_REF_MANAGED },
  });
  assert.equal(single["50"], undefined);
  assert.deepEqual(single["10"].inputs.images, ["20", 0]);
});

test("a shot that fits uses the plain sampler and no batch", () => {
  const g = minimaxH3RefGraph({
    prompt: "a ridge",
    refImageNames: ["a.png", "b.png"],
    refVideos: [],
    refAudioNames: [],
    durationSec: 5,
    width: 1344,
    height: 768,
    seed: 1,
    models: { ...MINIMAX_H3_MANAGED, refUnet: MINIMAX_H3_REF_MANAGED },
  });
  assert.equal(g["10"].class_type, "SamplerCustomAdvanced");
  assert.equal(g["50"], undefined);
  assert.ok(!("images" in g["10"].inputs));
});

/* ---------- the encoder eviction ---------- */

test("evicting the encoder sits between conditioning and the sampler", () => {
  const g = minimaxH3Graph({
    prompt: "a shot",
    durationSec: 5,
    width: 768,
    height: 1344,
    seed: 1,
    evictEncoder: true,
    models: MINIMAX_H3_MANAGED,
  });
  assert.equal(g["60"].class_type, "VRAM_Debug");
  assert.equal(g["60"].inputs.unload_all_models, true);
  /* any_input is what orders it: the node cannot run until the prompt is
   * encoded, so the encoder is only dropped once it has done its job. */
  assert.deepEqual(g["60"].inputs.any_input, ["5", 0]);
  // and everything model-side reads the pass-through, so the sample waits on it
  assert.deepEqual(g["60"].inputs.model_pass, ["1", 0]);
  assert.deepEqual(g["7"].inputs.model, ["60", 2]);
  assert.deepEqual(g["9"].inputs.model, ["60", 2]);
});

test("eviction rides at the END of the patch chain, not in the middle of it", () => {
  const spec = MINIMAX_TURBO.draft.fl2v;
  const g = minimaxH3Graph({
    prompt: "a shot",
    durationSec: 5,
    width: 1344,
    height: 768,
    seed: 1,
    sage: true,
    turbo: { lora: `loras/${spec.file}`, ...spec },
    evictEncoder: true,
    models: MINIMAX_H3_MANAGED,
  });
  // unet → LoRA → sage → shift → evict → guider/scheduler
  assert.deepEqual(g["18"].inputs.model, ["1", 0]);
  assert.deepEqual(g["17"].inputs.model, ["18", 0]);
  assert.deepEqual(g["19"].inputs.model, ["17", 0]);
  assert.deepEqual(g["60"].inputs.model_pass, ["19", 0]);
  assert.deepEqual(g["7"].inputs.model, ["60", 2]);
});

test("no KJNodes, no eviction — and the chain closes up behind it", () => {
  const g = minimaxH3Graph({
    prompt: "a shot",
    durationSec: 5,
    width: 1344,
    height: 768,
    seed: 1,
    models: MINIMAX_H3_MANAGED,
  });
  assert.equal(g["60"], undefined);
  assert.deepEqual(g["7"].inputs.model, ["1", 0]);
});
