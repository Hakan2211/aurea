/* H3's camera control (upgrade plan §3.2).
 *
 * Until now MiniMax-H3 had none at all — the adapter refused a camera LoRA
 * outright and the move was a sentence the model could ignore. Jojocodex's
 * weight gives it one, and two details decide whether it does anything:
 * the LoRA has to sit on the model chain in the right place, and the trigger
 * phrase has to OPEN the prompt. Both are invisible when wrong — the render
 * succeeds and simply doesn't move — so both are held here. */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MINIMAX_CAMERA_TRIGGER,
  MINIMAX_NODES,
  MINIMAX_REF_NODES,
  minimaxH3Graph,
} from "./comfy/minimax-graphs.js";

const models = {
  unet: "minimax_h3_fl2va.gguf",
  textEncoder: "qwen3vl.gguf",
  videoVae: "h3_video_vae.safetensors",
  audioVae: "h3_audio_vae.safetensors",
};

const base = {
  prompt: "camera motion, push-in. Sterling behind the desk.",
  durationSec: 5,
  width: 1344,
  height: 768,
  seed: 7,
  models,
};

const turbo = {
  lora: "loras\\minimax_h3_fl2v_turbo_4step_v1.1_768p_comfyui_bf16.safetensors",
  steps: 4,
  strength: 1.2,
  shiftVideo: 6,
  shiftAudio: 3,
};

const cameraLora = { lora: "loras\\camera_motion_h3_lora_v1_3000_pruned.safetensors", strength: 0.9 };

test("the camera LoRA rides the unet after the distill, not instead of it", () => {
  const graph = minimaxH3Graph({ ...base, turbo, cameraLora });
  const N = MINIMAX_NODES;

  const cam = graph[N.cameraLora];
  assert.ok(cam, "no camera LoRA node in the graph");
  assert.equal(cam.class_type, "LoraLoaderModelOnly");
  assert.equal(cam.inputs.lora_name, cameraLora.lora);
  assert.equal(cam.inputs.strength_model, 0.9);
  // it takes the distill's output — the distill decides HOW the model samples,
  // the camera LoRA what it draws, and swapping them drops one of the two
  assert.deepEqual(cam.inputs.model, [N.turboLora, 0]);
  // …and the sigma shift, which must stay last on the turbo path, reads it
  assert.deepEqual(graph[N.sigmaShift].inputs.model, [N.cameraLora, 0]);
});

test("with no camera move the chain is exactly what it always was", () => {
  const graph = minimaxH3Graph({ ...base, turbo });
  assert.equal(graph[MINIMAX_NODES.cameraLora], undefined);
  assert.deepEqual(graph[MINIMAX_NODES.sigmaShift].inputs.model, [MINIMAX_NODES.turboLora, 0]);
});

test("the camera LoRA node id cannot collide with the reference loaders", () => {
  /* ref2va numbers its reference slots from 20 (<Picture 1> IS node 20). A
   * camera node parked there would overwrite the first reference image and the
   * render would quietly lose a face. */
  const refIds = new Set([
    ...Array.from({ length: 9 }, (_, i) => MINIMAX_REF_NODES.image(i)),
    ...Array.from({ length: 3 }, (_, i) => MINIMAX_REF_NODES.video(i)),
    ...Array.from({ length: 3 }, (_, i) => MINIMAX_REF_NODES.videoParts(i)),
    ...Array.from({ length: 3 }, (_, i) => MINIMAX_REF_NODES.audio(i)),
    ...Array.from({ length: 8 }, (_, i) => MINIMAX_REF_NODES.batch(i)),
  ]);
  assert.ok(
    !refIds.has(MINIMAX_NODES.cameraLora),
    `camera node ${MINIMAX_NODES.cameraLora} collides with a ref2va loader`,
  );
});

test("the trigger phrase is the one the weight was trained on", () => {
  // buried mid-paragraph it does nothing; the adapter prepends it, so the
  // string itself is the contract between the two halves
  assert.equal(MINIMAX_CAMERA_TRIGGER, "camera motion");
});
