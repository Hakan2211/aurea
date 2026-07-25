/* The tuning splice is pure graph surgery, so it is testable without a GPU or
 * a running ComfyUI. The property that matters most: an all-off tuning must
 * leave the graph byte-identical, because that is the verified render path. */

import test from "node:test";
import assert from "node:assert/strict";
import type { ComfyGraph } from "./client.js";
import { NO_TUNING, applyTuning, type TuningAnchors } from "./tuning.js";

const anchors: TuningAnchors = {
  source: ["lora", 0],
  consumers: [
    ["guiderA", "model"],
    ["guiderB", "model"],
  ],
  negative: ["neg", 0],
  baseSampler: "samplerA",
  refineSampler: "samplerB",
};

const fixture = (): ComfyGraph => ({
  lora: { class_type: "LoraLoaderModelOnly", inputs: { model: ["ckpt", 0] } },
  neg: { class_type: "CLIPTextEncode", inputs: { text: "ugly" } },
  guiderA: { class_type: "CFGGuider", inputs: { cfg: 1, model: ["lora", 0] } },
  guiderB: { class_type: "CFGGuider", inputs: { cfg: 1, model: ["lora", 0] } },
  samplerA: { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
  samplerB: { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
  // stands in for the Gemma prompt-enhance branch: deliberately NOT a consumer
  enhance: { class_type: "LoraLoader", inputs: { model: ["lora", 0] } },
});

test("all-off tuning leaves the graph untouched", () => {
  const graph = fixture();
  const before = JSON.stringify(graph);
  applyTuning(graph, NO_TUNING, anchors);
  assert.equal(JSON.stringify(graph), before);
});

test("chunked feed-forward splices in and repoints every consumer", () => {
  const graph = fixture();
  applyTuning(graph, { ...NO_TUNING, chunkFeedForward: true }, anchors);

  assert.equal(graph["aurea:chunk_ff"].class_type, "LTXVChunkFeedForward");
  assert.deepEqual(graph["aurea:chunk_ff"].inputs.model, ["lora", 0]);
  assert.deepEqual(graph.guiderA.inputs.model, ["aurea:chunk_ff", 0]);
  assert.deepEqual(graph.guiderB.inputs.model, ["aurea:chunk_ff", 0]);
  // the enhance branch keeps the plain model — it runs text generation
  assert.deepEqual(graph.enhance.inputs.model, ["lora", 0]);
});

test("sage + chunk + nag chain in order, each feeding the next", () => {
  const graph = fixture();
  applyTuning(
    graph,
    { chunkFeedForward: true, sageAttention: true, sampler: "euler", nag: true },
    anchors,
  );

  assert.deepEqual(graph["aurea:sage"].inputs.model, ["lora", 0]);
  assert.deepEqual(graph["aurea:sage_mem"].inputs.model, ["aurea:sage", 0]);
  assert.deepEqual(graph["aurea:chunk_ff"].inputs.model, ["aurea:sage_mem", 0]);
  assert.deepEqual(graph["aurea:nag"].inputs.model, ["aurea:chunk_ff", 0]);
  assert.deepEqual(graph["aurea:nag"].inputs.nag_cond_video, ["neg", 0]);
  assert.deepEqual(graph.guiderA.inputs.model, ["aurea:nag", 0]);
});

test("NAG is skipped without a negative conditioning to guide against", () => {
  const graph = fixture();
  applyTuning(graph, { ...NO_TUNING, nag: true }, { ...anchors, negative: undefined });
  assert.equal(graph["aurea:nag"], undefined);
  assert.deepEqual(graph.guiderA.inputs.model, ["lora", 0]);
});

test("cfg_pp sets the ancestral base and cfg++ refine samplers", () => {
  const graph = fixture();
  applyTuning(graph, { ...NO_TUNING, sampler: "cfg_pp" }, anchors);
  assert.equal(graph.samplerA.inputs.sampler_name, "euler_ancestral_cfg_pp");
  assert.equal(graph.samplerB.inputs.sampler_name, "euler_cfg_pp");
});
