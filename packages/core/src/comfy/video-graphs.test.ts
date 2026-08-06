import assert from "node:assert/strict";
import { test } from "node:test";
import { LTX23_MANAGED, ltx23Graph, type VideoGraphSpec } from "./video-graphs.js";
import { resolveCameraLoras } from "./capabilities.js";

const spec = (over: Partial<VideoGraphSpec> = {}): VideoGraphSpec => ({
  prompt: "a shot",
  imageName: "aurea/frame.png",
  silenceName: "aurea/silence.wav",
  durationSec: 5,
  width: 896,
  height: 704,
  seed: 7,
  models: LTX23_MANAGED,
  ...over,
});

const links = (g: ReturnType<typeof ltx23Graph>, id: string, input: string) =>
  g[id].inputs[input] as [string, number];

/* The default graph is the verified pipeline — every new knob must leave it
 * byte-identical when unused. */
test("no new knobs → the graph carries no aurea:* nodes", () => {
  const g = ltx23Graph(spec());
  assert.ok(Object.keys(g).every((id) => !id.startsWith("aurea:")));
  // both passes and their decode wiring intact
  assert.ok(g["340:310"] && g["340:295"]);
  assert.deepEqual(links(g, "340:316", "samples"), ["340:311", 0]);
});

test("fps reaches the frame-rate primitive both length and conditioning read", () => {
  const g = ltx23Graph(spec({ fps: 48 }));
  assert.equal(g["340:323"].inputs.value, 48);
  // frames = duration*fps+1 flows through the math node — the wiring must stand
  assert.deepEqual(links(g, "340:329", "values.b"), ["340:323", 0]);
});

test("adapter LoRAs chain after the distilled LoRA and re-point both guiders", () => {
  const g = ltx23Graph(
    spec({ loras: [{ name: "a.safetensors", strength: 0.8 }, { name: "b.safetensors", strength: 1 }] }),
  );
  assert.deepEqual(links(g, "aurea:lora_0", "model"), ["340:293", 0]);
  assert.deepEqual(links(g, "aurea:lora_1", "model"), ["aurea:lora_0", 0]);
  assert.deepEqual(links(g, "340:315", "model"), ["aurea:lora_1", 0]);
  assert.deepEqual(links(g, "340:290", "model"), ["aurea:lora_1", 0]);
  // the prompt-enhance branch (external mode) keeps the bare distilled model
  assert.equal(g["340:345"], undefined); // managed strips it entirely
});

test("an end frame becomes a frame_idx -1 guide wired through the crop", () => {
  const g = ltx23Graph(spec({ endFrameName: "aurea/end.png" }));
  assert.equal(g["aurea:guide_0"].class_type, "LTXVAddGuide");
  assert.equal(g["aurea:guide_0"].inputs.frame_idx, -1);
  // conditioning flows conditioning → guide → base guider AND the crop
  assert.deepEqual(links(g, "aurea:guide_0", "positive"), ["340:307", 0]);
  assert.deepEqual(links(g, "340:315", "positive"), ["aurea:guide_0", 0]);
  assert.deepEqual(links(g, "340:292", "positive"), ["aurea:guide_0", 0]);
  // latent detours through the guide, and the upsampler reads the CROPPED one
  assert.deepEqual(links(g, "340:326", "video_latent"), ["aurea:guide_0", 2]);
  assert.deepEqual(links(g, "340:295", "samples"), ["340:292", 2]);
});

test("mid-shot keyframes snap to the 8-frame grid and chain in order", () => {
  const g = ltx23Graph(
    spec({
      guides: [
        { imageName: "aurea/kf0.png", atSec: 2, strength: 0.9 },
        { imageName: "aurea/kf1.png", atSec: 3.1, strength: 1 },
      ],
      endFrameName: "aurea/end.png",
    }),
  );
  assert.equal(g["aurea:guide_0"].inputs.frame_idx, 48); // 2s × 24 = 48 ✓ on grid
  assert.equal(g["aurea:guide_1"].inputs.frame_idx, 72); // 3.1s × 24 = 74.4 → 72
  assert.equal(g["aurea:guide_2"].inputs.frame_idx, -1); // the end frame rides last
  assert.deepEqual(links(g, "aurea:guide_1", "positive"), ["aurea:guide_0", 0]);
  assert.deepEqual(links(g, "aurea:guide_2", "latent"), ["aurea:guide_1", 2]);
});

test("draft mode deletes the refine stage and decodes the base pass", () => {
  const g = ltx23Graph(spec({ fast: true }));
  for (const id of ["340:310", "340:311", "340:295", "340:296", "340:290", "340:288", "340:289", "340:287"]) {
    assert.equal(g[id], undefined, `${id} should be gone`);
  }
  assert.deepEqual(links(g, "340:316", "samples"), ["340:309", 0]);
  assert.deepEqual(links(g, "340:303", "samples"), ["340:309", 1]);
});

test("draft + guides decodes the cropped latent, not the guide-padded one", () => {
  const g = ltx23Graph(spec({ fast: true, endFrameName: "aurea/end.png" }));
  assert.deepEqual(links(g, "340:316", "samples"), ["340:292", 2]);
});

/* resolveCameraLoras is expected to find NOTHING on today's installs (only 19b
 * camera weights exist) — but must find tomorrow's the moment they land. */
test("camera LoRA resolution: empty today, keyed matches when weights land", () => {
  assert.deepEqual(
    resolveCameraLoras([
      "ltx-2.3-22b-distilled-lora-384.safetensors",
      "ltxv\\ltx2\\ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors",
    ]),
    {},
  );
  const found = resolveCameraLoras([
    "ltxv\\camera\\ltx-2.3-22b-lora-camera-control-dolly-in.safetensors",
    "ltxv\\camera\\ltx-2.3-22b-lora-camera-control-dolly-out.safetensors",
    "ltxv\\camera\\ltx-2.3-22b-lora-camera-control-jib-up.safetensors",
  ]);
  assert.equal(found["dolly-in"], "ltxv\\camera\\ltx-2.3-22b-lora-camera-control-dolly-in.safetensors");
  assert.equal(found["dolly-out"], "ltxv\\camera\\ltx-2.3-22b-lora-camera-control-dolly-out.safetensors");
  assert.equal(found["jib-up"], "ltxv\\camera\\ltx-2.3-22b-lora-camera-control-jib-up.safetensors");
  assert.equal(found["static"], undefined);
});

test("no voice take wires LoadAudio to the staged silence, never to the image", () => {
  // regression: it used to fall back to imageName, and ComfyUI failed the whole
  // render with "No audio stream found in the file" (measured 2026-08-06)
  const g = ltx23Graph(spec());
  assert.equal(g["276"].inputs.audio, "aurea/silence.wav");
  assert.equal(g["340:333"].inputs.value, 1); // freed — LTX invents the sound
});

test("a voice take drives the lips and pins the audio mask", () => {
  const g = ltx23Graph(spec({ audioName: "aurea/take.wav" }));
  assert.equal(g["276"].inputs.audio, "aurea/take.wav");
  assert.equal(g["340:333"].inputs.value, 0);
});

test("text-to-video flips the template's own bypass switch", () => {
  const g = ltx23Graph(spec({ textToVideo: true, imageName: "aurea/placeholder.png" }));
  assert.equal(g["340:305"].inputs.value, true);
  // the loader still runs and must point at a really-staged file: a dangling
  // name makes ComfyUI prune the branch and report success with no video
  assert.equal(g["269"].inputs.image, "aurea/placeholder.png");
});

test("an i2v render leaves the text-to-video switch alone", () => {
  assert.equal(ltx23Graph(spec())["340:305"].inputs.value, false);
});
