import assert from "node:assert/strict";
import { test } from "node:test";
import { h3ImageGraph } from "./graphs.js";

const names = { unet: "dit.safetensors", textEncoder: "te.gguf", vae: "vae.safetensors" };
const spec = { prompt: "a fox", width: 2500, height: 1660, seed: 7 };

test("h3ImageGraph t2i: official recipe, latent from the conditioning node, canvas on the 32 grid", () => {
  const g = h3ImageGraph(spec, names);
  assert.equal(g.clip.class_type, "CLIPLoaderGGUF");
  assert.equal(g.clip.inputs.type, "minimax");
  const s = g.sampler.inputs;
  assert.equal(s.steps, 6);
  assert.equal(s.cfg, 1);
  assert.equal(s.sampler_name, "euler");
  assert.equal(s.scheduler, "simple");
  assert.deepEqual(s.latent_image, ["positive", 1]);
  assert.equal(g.positive.inputs.width, 2496);
  assert.equal(g.positive.inputs.height, 1664);
  assert.ok(!Object.keys(g.positive.inputs).some((k) => k.startsWith("images.")));
});

test("h3ImageGraph edit: refs become images.image_N in order; 0x0 sizes from Picture 1", () => {
  const g = h3ImageGraph({ ...spec, width: 0, height: 0 }, names, ["a.png", "b.png"]);
  assert.deepEqual(g.positive.inputs["images.image_1"], ["ref1", 0]);
  assert.deepEqual(g.positive.inputs["images.image_2"], ["ref2", 0]);
  assert.equal(g.ref2.inputs.image, "b.png");
  assert.equal(g.positive.inputs.width, 0);
  assert.equal(g.positive.inputs.height, 0);
});
