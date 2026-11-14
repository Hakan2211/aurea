import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LTX25_EXTERNAL,
  LTX25_MANAGED,
  UPSCALE_MAX_PIXELS,
  ltx25Graph,
  ltx25UpscaleGraph,
  upscaleCanvas,
  upscaleSigmas,
  type Ltx25GraphSpec,
  type Ltx25UpscaleSpec,
} from "./ltx25-graph.js";

const spec = (over: Partial<Ltx25GraphSpec> = {}): Ltx25GraphSpec => ({
  prompt: "a shot",
  imageName: "aurea/frame.png",
  durationSec: 5,
  width: 896,
  height: 704,
  seed: 7,
  models: LTX25_EXTERNAL,
  ...over,
});

const links = (g: ReturnType<typeof ltx25Graph>, id: string, input: string) =>
  g[id].inputs[input] as [string, number];

test("i2v: the one preprocessed frame feeds both passes at template strengths", () => {
  const g = ltx25Graph(spec());
  assert.deepEqual(links(g, "i2vbase", "image"), ["imgprep", 0]);
  assert.deepEqual(links(g, "i2vref", "image"), ["imgprep", 0]);
  assert.equal(g["i2vbase"].inputs.strength, 0.7);
  assert.equal(g["i2vref"].inputs.strength, 1);
  // the base pass runs at half resolution; refine reads the ×2 upscale
  assert.equal(g["vidlat"].inputs.width, 448);
  assert.equal(g["vidlat"].inputs.height, 352);
  assert.deepEqual(links(g, "i2vref", "latent"), ["up", 0]);
  // frames = duration*fps+1 on the 8n+1 grid, video and audio agreeing
  assert.equal(g["vidlat"].inputs.length, 121);
  assert.equal(g["audlat"].inputs.frames_number, 121);
});

test("t2v: no image chain at all — the empty latent goes straight to concat", () => {
  const g = ltx25Graph(spec({ imageName: undefined }));
  assert.equal(g["img"], undefined);
  assert.equal(g["i2vbase"], undefined);
  assert.equal(g["i2vref"], undefined);
  assert.deepEqual(links(g, "cat1", "video_latent"), ["vidlat", 0]);
  assert.deepEqual(links(g, "cat2", "video_latent"), ["up", 0]);
});

test("draft stops after the base pass and decodes it directly", () => {
  const g = ltx25Graph(spec({ fast: true }));
  assert.equal(g["up"], undefined);
  assert.equal(g["run2"], undefined);
  assert.equal(g["upmodel"], undefined);
  assert.deepEqual(links(g, "vdec", "samples"), ["sep1", 0]);
  assert.deepEqual(links(g, "adec", "samples"), ["sep1", 1]);
});

test("an end frame becomes a frame_idx -1 guide, cropped before the upscale", () => {
  const g = ltx25Graph(spec({ endFrameName: "aurea/end.png" }));
  assert.equal(g["guide_0"].class_type, "LTXVAddGuide");
  assert.equal(g["guide_0"].inputs.frame_idx, -1);
  // conditioning: cond → guide → base guider; latent detours through the guide
  assert.deepEqual(links(g, "guide_0", "positive"), ["cond", 0]);
  assert.deepEqual(links(g, "guider1", "positive"), ["guide_0", 0]);
  assert.deepEqual(links(g, "cat1", "video_latent"), ["guide_0", 2]);
  // the appendix comes off before the upscale, and refine reads the cropped cond
  assert.deepEqual(links(g, "up", "samples"), ["crop", 2]);
  assert.deepEqual(links(g, "guider2", "positive"), ["crop", 0]);
});

test("keyframes snap to the 8-frame grid like the 2.3 builder", () => {
  const g = ltx25Graph(
    spec({ guides: [{ imageName: "aurea/kf.png", atSec: 2.1, strength: 0.8 }] }),
  );
  // 2.1s * 24fps = 50.4 → nearest multiple of 8 is 48
  assert.equal(g["guide_0"].inputs.frame_idx, 48);
});

test("adapter LoRAs chain after the transformer and feed both guiders", () => {
  const g = ltx25Graph(
    spec({ loras: [{ name: "a.safetensors", strength: 0.8 }, { name: "b.safetensors", strength: 1 }] }),
  );
  assert.deepEqual(links(g, "lora_0", "model"), ["unet", 0]);
  assert.deepEqual(links(g, "lora_1", "model"), ["lora_0", 0]);
  assert.deepEqual(links(g, "guider1", "model"), ["lora_1", 0]);
  assert.deepEqual(links(g, "guider2", "model"), ["lora_1", 0]);
});

test("prompt enhancement is opt-in and reads the start frame when there is one", () => {
  const off = ltx25Graph(spec());
  assert.equal(off["enhance"], undefined);
  assert.equal(off["pos"].inputs.text, "a shot");

  const on = ltx25Graph(spec({ enhanceClipName: "gemma4_e2b_it_bf16.safetensors" }));
  assert.deepEqual(links(on, "pos", "text"), ["enhance", 0]);
  assert.deepEqual(links(on, "enhance", "image"), ["imgprep", 0]);

  const t2v = ltx25Graph(
    spec({ imageName: undefined, enhanceClipName: "gemma4_e2b_it_bf16.safetensors" }),
  );
  assert.equal(t2v["enhance"].inputs.image, undefined);
});

test("decode tiling matches the official template — one temporal tile", () => {
  const g = ltx25Graph(spec());
  assert.equal(g["vdec"].inputs.tile_size, 768);
  assert.equal(g["vdec"].inputs.temporal_size, 4096);
  assert.equal(g["vdec"].inputs.temporal_overlap, 32);
});

test("each pass has its own sampler node, both euler_ancestral by default", () => {
  const g = ltx25Graph(spec());
  assert.equal(g["sampler"].inputs.sampler_name, "euler_ancestral");
  assert.equal(g["sampler2"].inputs.sampler_name, "euler_ancestral");
  assert.deepEqual(links(g, "run1", "sampler"), ["sampler", 0]);
  assert.deepEqual(links(g, "run2", "sampler"), ["sampler2", 0]);
  // draft has no refine pass, so no second sampler node
  assert.equal(ltx25Graph(spec({ fast: true }))["sampler2"], undefined);
});

test("tuning splices into the model chain and both guiders re-read it", () => {
  const tuning = { chunkFeedForward: true, sageAttention: false, sampler: "euler" as const, nag: false };
  const g = ltx25Graph(spec({ tuning }));
  assert.deepEqual(links(g, "aurea:chunk_ff", "model"), ["unet", 0]);
  assert.deepEqual(links(g, "guider1", "model"), ["aurea:chunk_ff", 0]);
  assert.deepEqual(links(g, "guider2", "model"), ["aurea:chunk_ff", 0]);
  // the enhance branch keeps the plain model — it is not a tuning consumer
  const enhanced = ltx25Graph(
    spec({ tuning, enhanceClipName: "gemma4_e2b_it_bf16.safetensors" }),
  );
  assert.deepEqual(links(enhanced, "enhance", "clip"), ["eclip", 0]);

  // a draft graph tunes its single pass without tripping on the absent refine
  const draft = ltx25Graph(spec({ tuning, fast: true }));
  assert.deepEqual(links(draft, "guider1", "model"), ["aurea:chunk_ff", 0]);

  // no tuning leaves the graph untouched
  const plain = ltx25Graph(spec());
  assert.equal(plain["aurea:chunk_ff"], undefined);
  assert.deepEqual(links(plain, "guider1", "model"), ["unet", 0]);
});

test("cfg_pp tuning pairs an ancestral base with a cfg++ refine", () => {
  const tuning = { chunkFeedForward: false, sageAttention: false, sampler: "cfg_pp" as const, nag: false };
  const g = ltx25Graph(spec({ tuning }));
  assert.equal(g["sampler"].inputs.sampler_name, "euler_ancestral_cfg_pp");
  assert.equal(g["sampler2"].inputs.sampler_name, "euler_cfg_pp");
});

test("managed names are registry-relative; external names are bare", () => {
  assert.ok(LTX25_MANAGED.transformer.startsWith("ltx-25-22b-int8"));
  assert.ok(!LTX25_EXTERNAL.transformer.includes("ltx-25-22b-int8"));
  const g = ltx25Graph(spec({ models: LTX25_MANAGED }));
  assert.equal(g["unet"].inputs.unet_name, LTX25_MANAGED.transformer);
});

test("a look's negative reaches the 2.5 negative encoder", () => {
  const g = ltx25Graph(spec({ negative: "text, letters, watermark" }));
  assert.equal(g["neg"].inputs.text, "text, letters, watermark");
});

/* ---------- finishing passes (Video Lab quality plan Q1 + Q2) ---------- */

test("a draft keeps both halves of its base latent, pre-crop, when asked to", () => {
  const g = ltx25Graph(spec({ fast: true, keepLatents: true, filenamePrefix: "aurea/j1" }));
  assert.equal(g["lat_v_save"].class_type, "SaveLatent");
  assert.equal(g["lat_a_save"].class_type, "SaveLatent");
  assert.deepEqual(links(g, "lat_v_save", "samples"), ["sep1", 0]);
  assert.deepEqual(links(g, "lat_a_save", "samples"), ["sep1", 1]);
  assert.equal(g["lat_v_save"].inputs.filename_prefix, "latents/aurea/j1-video");
  assert.equal(g["lat_a_save"].inputs.filename_prefix, "latents/aurea/j1-audio");
  // the video is still decoded straight off the base pass, as any draft is
  assert.deepEqual(links(g, "vdec", "samples"), ["sep1", 0]);
  // a full render never writes latents; nor does a draft that wasn't asked
  assert.equal(ltx25Graph(spec({ keepLatents: true }))["lat_v_save"], undefined);
  assert.equal(ltx25Graph(spec({ fast: true }))["lat_v_save"], undefined);
});

test("refine-from-draft loads the latents, skips the base pass, runs the refine only", () => {
  const g = ltx25Graph(
    spec({
      fast: true, // ignored: a refine is the full ladder's second half
      refineFrom: { videoLatentName: "aurea/j1-video.latent", audioLatentName: "aurea/j1-audio.latent" },
    }),
  );
  assert.equal(g["lat_v"].class_type, "LoadLatent");
  assert.equal(g["lat_v"].inputs.latent, "aurea/j1-video.latent");
  assert.equal(g["lat_a"].inputs.latent, "aurea/j1-audio.latent");
  // no base sampling at all
  assert.equal(g["run1"], undefined);
  assert.equal(g["sep1"], undefined);
  assert.equal(g["cat1"], undefined);
  assert.equal(g["guider1"], undefined);
  // the refine pass reads the loaded halves: video through the upscaler
  // (with the start frame re-injected), audio straight into the concat
  assert.deepEqual(links(g, "up", "samples"), ["lat_v", 0]);
  assert.deepEqual(links(g, "i2vref", "latent"), ["up", 0]);
  assert.deepEqual(links(g, "cat2", "audio_latent"), ["lat_a", 0]);
  assert.equal(g["run2"].class_type, "SamplerCustomAdvanced");
  assert.equal(g["upmodel"].class_type, "LatentUpscaleModelLoader");
  assert.deepEqual(links(g, "vdec", "samples"), ["sep2", 0]);
});

test("refine-from-draft re-pins a voice take's lock and re-crops guides against the rebuilt cond", () => {
  const g = ltx25Graph(
    spec({
      audioName: "aurea/vo.wav",
      endFrameName: "aurea/end.png",
      refineFrom: { videoLatentName: "v.latent", audioLatentName: "a.latent" },
    }),
  );
  // SaveLatent kept samples only, so the ia2v lock (noise mask 0) goes back on
  assert.equal(g["audlat"].class_type, "SetLatentNoiseMask");
  assert.deepEqual(links(g, "audlat", "samples"), ["lat_a", 0]);
  assert.deepEqual(links(g, "cat2", "audio_latent"), ["audlat", 0]);
  // the take itself is not re-encoded — no LoadAudio in a refine
  assert.equal(g["aud"], undefined);
  // the saved latent is pre-crop: the guide chain is rebuilt on the empty
  // latent for its conditioning, and the crop runs on the LOADED latent
  assert.equal(g["guide_0"].class_type, "LTXVAddGuide");
  assert.deepEqual(links(g, "crop", "latent"), ["lat_v", 0]);
  assert.deepEqual(links(g, "crop", "positive"), ["guide_0", 0]);
  assert.deepEqual(links(g, "up", "samples"), ["crop", 2]);
  assert.deepEqual(links(g, "guider2", "positive"), ["crop", 0]);
});

test("upscale sigmas: 1 is the whole ladder, less drops the top and starts at strength", () => {
  assert.equal(
    upscaleSigmas(1),
    "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0",
  );
  assert.equal(upscaleSigmas(0.8), "0.8, 0.725, 0.421875, 0");
  // a strength that IS a rung starts on it rather than doubling it
  assert.equal(upscaleSigmas(0.725), "0.725, 0.421875, 0");
  assert.equal(upscaleSigmas(0.3), "0.3, 0");
});

test("upscale canvas: ×2 on the 64 grid, fitted to the pixel cap when the double is too big", () => {
  // a draft's canvas doubles exactly
  assert.deepEqual(upscaleCanvas(640, 352), { width: 1280, height: 704 });
  // a full 1280×704 take would be 2560×1408 — fitted to the 1080p cap, aspect kept, grid held
  const fitted = upscaleCanvas(1280, 704);
  assert.ok(fitted.width * fitted.height <= UPSCALE_MAX_PIXELS);
  assert.equal(fitted.width % 64, 0);
  assert.equal(fitted.height % 64, 0);
  assert.ok(Math.abs(fitted.width / fitted.height - 1280 / 704) < 0.08);
  assert.deepEqual(fitted, { width: 1920, height: 1024 });
  // vertical H3 (768×1344) fits the same cap the other way round
  const vertical = upscaleCanvas(768, 1344);
  assert.ok(vertical.width * vertical.height <= UPSCALE_MAX_PIXELS);
  assert.ok(vertical.height > vertical.width);
});

const upscaleSpec = (over: Partial<Ltx25UpscaleSpec> = {}): Ltx25UpscaleSpec => ({
  prompt: "the same shot",
  videoName: "aurea/j2-source.mp4",
  icLoraName: "ltx-2.5-22b-ic-lora-pixel-spatial-upscaler-x2-1.0.safetensors",
  width: 1280,
  height: 704,
  fps: 24,
  frames: 121,
  hasAudio: true,
  strength: 1,
  seed: 9,
  models: LTX25_EXTERNAL,
  ...over,
});

test("upscale graph: IC-LoRA on the model, its parameters on the guide, the take as reference", () => {
  const g = ltx25UpscaleGraph(upscaleSpec());
  assert.equal(g["iclora"].class_type, "LoraLoaderModelOnly");
  assert.equal(g["iclora"].inputs.strength_model, 1);
  assert.deepEqual(links(g, "icparams", "iclora_model"), ["iclora", 0]);
  assert.deepEqual(links(g, "guider1", "model"), ["iclora", 0]);
  // the reference is the ORIGINAL frames; the node halves them itself
  assert.equal(g["guide"].class_type, "LTXVAddGuide");
  assert.deepEqual(links(g, "guide", "image"), ["srcparts", 0]);
  assert.deepEqual(links(g, "guide", "iclora_parameters"), ["icparams", 0]);
  assert.equal(g["guide"].inputs.frame_idx, 0);
  // at strength 1 the starting latent is empty, at the output canvas
  assert.equal(g["tgt"].class_type, "EmptyLTXVLatentVideo");
  assert.equal(g["tgt"].inputs.width, 1280);
  assert.equal(g["tgt"].inputs.height, 704);
  assert.equal(g["tgt"].inputs.length, 121);
  assert.equal(g["srcfit"], undefined);
  // the take's own audio, locked; sampled with plain euler on the base ladder
  assert.deepEqual(links(g, "audenc", "audio"), ["srcparts", 1]);
  assert.equal(g["audlat"].class_type, "SetLatentNoiseMask");
  assert.equal(g["sampler"].inputs.sampler_name, "euler");
  assert.equal(g["sig1"].inputs.sigmas, upscaleSigmas(1));
  // reference tokens come off before decode
  assert.deepEqual(links(g, "crop", "latent"), ["sep1", 0]);
  assert.deepEqual(links(g, "vdec", "samples"), ["crop", 2]);
  assert.equal(g["video"].inputs.fps, 24);
});

test("upscale graph: partial denoise starts from the upscaled take; a mute source gets empty audio", () => {
  const g = ltx25UpscaleGraph(upscaleSpec({ strength: 0.7, hasAudio: false }));
  assert.equal(g["srcfit"].class_type, "ResizeImageMaskNode");
  assert.equal(g["srcfit"].inputs["resize_type.width"], 1280);
  assert.equal(g["tgt"].class_type, "VAEEncodeTiled");
  assert.deepEqual(links(g, "tgt", "pixels"), ["srcfit", 0]);
  assert.equal(g["sig1"].inputs.sigmas, "0.7, 0.421875, 0");
  assert.equal(g["audlat"].class_type, "LTXVEmptyLatentAudio");
  assert.equal(g["audlat"].inputs.frames_number, 121);
  assert.equal(g["audenc"], undefined);
});

test("upscale graph: tuning patches the model but never swaps in an ancestral sampler", () => {
  const g = ltx25UpscaleGraph(
    upscaleSpec({
      tuning: { sageAttention: true, chunkFeedForward: false, nag: false, sampler: "cfg_pp" },
    }),
  );
  assert.equal(g["aurea:sage"].class_type, "PathchSageAttentionKJ");
  assert.deepEqual(links(g, "guider1", "model"), ["aurea:sage_mem", 0]);
  assert.equal(g["sampler"].inputs.sampler_name, "euler");
});
