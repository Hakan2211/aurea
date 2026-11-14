/* Zod schemas shared by studiod (packages/core) and every client (desktop
 * renderer, CLI, MCP). These mirror the shapes the screens were built against
 * in apps/desktop/src/data/sample.ts — the renderer hooks keep their return
 * types when they swap from sample data to live queries. */

import { z } from "zod";

/** Every MiniMax-H3 distill candidate a payload may name. The recipes live in
 * core (MINIMAX_ALT_DISTILL, keyed by exactly this list — the compiler holds
 * the two together); this is only the vocabulary the schema accepts.
 *
 * The 2026-11-10 additions come from the autumn LightX2V releases (whose
 * published fl2v shift is 6, not the 12 Aurea's Standard tier has run at),
 * HyperFlow (Video Rebirth) and drbaph's v4 step-600 conversion. */
export const MINIMAX_DISTILL_IDS = [
  "tutu-8step",
  "tutu-8step-200",
  "tutu-8step-300",
  "lightx2v-8step-v1.0-shift6",
  "lightx2v-8step-v1.1",
  "lightx2v-4step-v1.2",
  "hyperflow-8step",
  "drbaph-v4-6step",
] as const;
export type MinimaxDistillId = (typeof MINIMAX_DISTILL_IDS)[number];

/* ---------- jobs ---------- */

export const jobStatusSchema = z.enum(["running", "queued", "completed", "failed"]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const jobKindSchema = z.enum(["video", "image", "tts", "music", "model3d"]);
export type JobKind = z.infer<typeof jobKindSchema>;

export const jobPrioritySchema = z.enum(["interactive", "preview", "batch"]);
export type JobPriority = z.infer<typeof jobPrioritySchema>;

/** What an engine adapter needs to actually execute the job. Jobs without a
 * payload run on the simulated worker (UI demos, seed fixtures). Payloads
 * carry user intent — adapters map them onto engine flags and ignore knobs
 * their engine doesn't have. */
export const imageAspectSchema = z.enum(["1:1", "3:2", "16:9", "4:3", "9:16"]);
export type ImageAspect = z.infer<typeof imageAspectSchema>;

export const videofastPayloadSchema = z.object({
  type: z.literal("videofast"),
  /** account id — resolved to <videofastDir>/accounts/<id>.json */
  account: z.string().min(1),
  topic: z.string().min(1),
  seed: z.number().int().optional(),
  /** third topic-CSV cell: title hint, or attribution for the quote format */
  titleHint: z.string().optional(),
  /** format id from the videofast registry — overrides the account's format
   * via a synthesized per-run account file */
  format: z.string().optional(),
  /** style pack id — pins the pack pool to exactly this pack for the run */
  stylePack: z.string().optional(),
  /** target runtime, seconds — scales the writer's word budget + scene count;
   * the finished video lands within ~±15% (durations retime to the spoken VO).
   * Omitted → the account's targetDurationSec, else the natural 25-45s. */
  durationSec: z.number().int().min(15).max(300).optional(),
  /** hand-authored blend: becomes the video's StyleBrief verbatim (the
   * strategist pass is skipped). The adapter fills schema-required fields the
   * caller leaves out and normalizes the mix shares to sum to 1. */
  brief: z
    .object({
      /** paradigm id → share; ONE dominant (≥ 0.5) plus any number of
       * contrasts (one is the tuned sweet spot, each extra reads busier).
       * ids: jsx2d, svgChoreo, d3Data, p5Canvas, r3f3d, parallax25d, manimClip */
      paradigmMix: z.record(z.string(), z.number().min(0).max(1)),
      narrativeArc: z
        .enum(["problem-shift-payoff", "myth-bust", "countdown", "metaphor-journey", "data-story"])
        .optional(),
      /** the concrete image the whole video hangs on */
      visualMetaphor: z.string().optional(),
      hookStrategy: z.string().optional(),
      /** worn-out images/angles to steer away from */
      avoid: z.array(z.string()).optional(),
    })
    .optional(),
});

/* ---------- 3D ---------- */

/** Every knob the Hunyuan3D runner takes that is not the input image. Split
 * out because two payloads carry the same set: the model3d job itself, and
 * the image job that draws a concept still *for* one (the 3D lab's prompt
 * mode is a two-stage chain and the settings have to survive the hand-off). */
export const model3dOptionsSchema = z.object({
  /** asset title; absent = derived from the source image's filename */
  name: z.string().min(1).max(120).optional(),
  /** paint PBR textures after the shape pass. Off = an untextured grey mesh
   * in roughly a third of the time — the right default while iterating on
   * silhouette, the wrong one for anything that ships. */
  textured: z.boolean().default(true),
  seed: z.number().int().optional(),
  /** flow-matching steps for the shape pass (runner default 50) */
  shapeSteps: z.number().int().min(10).max(100).optional(),
  /** marching-cubes octree resolution — the single biggest lever on both
   * detail and time. 256 drafts, 384 ships, 512 is for hero props. */
  octree: z.number().int().min(128).max(512).optional(),
  /** decimate the raw shape to this face count before texturing (0 = keep) */
  maxFaces: z.number().int().min(0).max(400000).optional(),
  /** baked texture resolution */
  textureSize: z.number().int().min(512).max(4096).optional(),
});
export type Model3dOptions = z.infer<typeof model3dOptionsSchema>;

export const imagePayloadSchema = z.object({
  type: z.literal("image"),
  prompt: z.string().min(1),
  /** engine id from the image-lab catalog; all run on the managed engine
   * (krea2/qwen-edit through the GGUF loader nodes) or an external ComfyUI */
  model: z.string().default("z-image"),
  aspect: imageAspectSchema.default("3:2"),
  /** style preset name folded into the prompt by the adapter */
  preset: z.string().optional(),
  seed: z.number().int().optional(),
  /** explicit output size — overrides the aspect bucket when both are set.
   * The outer bound is the cloud models' 4K; local ComfyUI models cap at 2048
   * (labs.imageCatalog().advanced.sizeMax), which is what the UI enforces. */
  width: z.number().int().min(512).max(4096).multipleOf(16).optional(),
  height: z.number().int().min(512).max(4096).multipleOf(16).optional(),
  /** sampler overrides; absent → per-model proven defaults in graphs.ts */
  steps: z.number().int().min(1).max(50).optional(),
  cfg: z.number().min(0).max(15).optional(),
  /** images per run — each lands as its own asset */
  count: z.number().int().min(1).max(4).default(1),
  /** dataRoot-relative reference images, most important first. The usable
   * ceiling is per-model (labs.imageCatalog().refsMax): qwen-edit takes 3 —
   * subject, then scene/prop, then style — while gpt-image-2 takes 16. This
   * cap is only the outer bound; the adapter rejects anything its model
   * can't actually encode. */
  refs: z.array(z.string()).max(16).default([]),
  /** dataRoot-relative inpainting mask — white marks the region to redraw.
   * Cloud edit models only; local graphs ignore it. */
  mask: z.string().optional(),
  /** cloud-only knobs (gpt-image-2). Local ComfyUI models ignore all three:
   * their equivalents are the steps/cfg sampler overrides above. */
  quality: z.enum(["auto", "low", "medium", "high"]).optional(),
  outputFormat: z.enum(["png", "jpeg", "webp"]).optional(),
  /** "auto" lets the model infer output size from the references, which is
   * usually what you want for an edit; "aspect" uses aspect/width/height. */
  sizeMode: z.enum(["auto", "aspect"]).optional(),
  /** storyboard delivery: attach finished stills to this shot's keyframes */
  board: z.object({ shotId: z.string().min(1) }).optional(),
  /** cover-art delivery: the finished still becomes the cover of this music
   * track (a dataRoot-relative wav path). Same shape as `board` above — a
   * "where does this picture belong when it lands" address, not a render knob.
   * Covers are a byproduct of a music run, so the Image lab's roll filters
   * them out; they stay in the Assets library like any other real file. */
  cover: z.string().optional(),
  /** 3D hand-off: this still was drawn to be turned into a model, so chain a
   * model3d job on it when it lands. Same "where does this picture belong"
   * shape as `board` and `cover` — the 3D lab's prompt mode is a two-stage
   * chain (draw a clean white-background concept, then lift it into a mesh)
   * and this is the address the first stage carries for the second. */
  model3d: model3dOptionsSchema.optional(),
});

/** bulk deck — one job renders every prompt of a themed set into
 * assets/image/decks/<deck-slug>/ (t2i models only; refs decks are a later rung) */
export const imageDeckPayloadSchema = z.object({
  type: z.literal("imageDeck"),
  deckName: z.string().min(1).max(60),
  prompts: z.array(z.string().min(1)).min(1).max(100),
  model: z.string().default("z-image"),
  aspect: imageAspectSchema.default("3:2"),
  preset: z.string().optional(),
  /** base seed — image i renders with seed + i, so decks reproduce exactly */
  seed: z.number().int().optional(),
  width: z.number().int().min(512).max(2048).multipleOf(16).optional(),
  height: z.number().int().min(512).max(2048).multipleOf(16).optional(),
  steps: z.number().int().min(1).max(50).optional(),
  cfg: z.number().min(0).max(15).optional(),
});

/** Enlarge an existing still. Two rungs, because they answer different needs:
 *
 *   fast   — Real-ESRGAN x4+ through ImageUpscaleWithModel. Seconds, no
 *            diffusion, no hallucinated detail. The safe default.
 *   refine — Qwen-Image-Edit re-renders the picture at ~2K with the
 *            Upscale2K LoRA on the model. Minutes, and it *invents* detail
 *            (skin, fabric, text) — better looking, less faithful.
 */
export const imageUpscalePayloadSchema = z.object({
  type: z.literal("imageUpscale"),
  /** dataRoot-relative path of the still to enlarge */
  source: z.string().min(1),
  mode: z.enum(["fast", "refine"]).default("fast"),
  /** refine only: long-edge target, snapped into the /16 grid by the adapter */
  targetLongEdge: z.number().int().min(1024).max(4096).default(2048),
  steps: z.number().int().min(1).max(50).optional(),
  cfg: z.number().min(0).max(15).optional(),
  seed: z.number().int().optional(),
});

export const ttsPayloadSchema = z.object({
  type: z.literal("tts"),
  text: z.string().min(1),
  /** character/voice id from the voice-lab roster */
  voice: z.string().min(1),
  /** "chatterbox" | "qwen" | "dramabox" */
  engine: z.string().default("chatterbox"),
  pace: z.number().min(0.5).max(1.5).default(1),
  emotion: z.number().min(0).max(1).default(0.65),
  // DramaBox-only knobs (engine === "dramabox"); other engines ignore them.
  // All optional with no schema default so pre-existing jobs.json entries
  // reparse unchanged and the engine's own defaults stay authoritative.
  /** fixed timbre seed (engine default 42) */
  seed: z.number().int().optional(),
  /** classifier-free guidance — higher = more text-faithful (default 2.5) */
  cfgScale: z.number().min(1).max(10).optional(),
  /** spatiotemporal-guidance scale (default 1.5) */
  stgScale: z.number().min(0).max(5).optional(),
  /** time budget — <1 = faster/tighter delivery (default 0.9) */
  durationMultiplier: z.number().min(0.5).max(2).optional(),
  /** explicit output seconds; absent/0 = auto-estimated from the prompt */
  genDuration: z.number().min(0).max(300).optional(),
  /** seconds of voice-ref conditioning window (default 10) */
  refDuration: z.number().min(3).max(30).optional(),
  /** Perth watermark on the output (default off for own content) */
  watermark: z.boolean().optional(),
  /** speaker-timbre description override ("a refined posh British male voice …") */
  design: z.string().max(400).optional(),
  /** table-read delivery, the voice half of the video payload's board field:
   * the finished wav attaches to this shot's voTakes, tagged with the script
   * line it speaks, and studio.onUpdate broadcasts the save */
  board: z
    .object({ shotId: z.string().min(1), lineId: z.string().min(1).optional() })
    .optional(),
});

export const musicPayloadSchema = z.object({
  type: z.literal("music"),
  /** music engine — "acestep" (default) or "minimax-music3" (full songs with
   * expressive vocals, up to 5 min, local diffusers pipeline on music3Python) */
  engine: z.enum(["acestep", "minimax-music3"]).default("acestep"),
  description: z.string().min(1),
  styles: z.array(z.string()).default([]),
  durationSec: z.number().int().min(5).max(420).default(30),
  arrangement: z.enum(["instrumental", "vocals"]).default("instrumental"),
  /** cloned character voice for sung vocals (arrangement === "vocals") */
  singVoice: z.string().optional(),
  /** own lyrics ("[verse]"/"[chorus]" section tags welcome). Absent + vocals =
   * wordless singing: the 5Hz LM returns tempo/key/caption and hands the DiT an
   * empty lyric block, so it improvises a vocal line rather than writing words. */
  lyrics: z.string().max(4096).optional(),
  /** absent = the model estimates tempo */
  bpm: z.number().int().min(30).max(300).optional(),
  /** absent = random each run (engine seed -1) */
  seed: z.number().int().optional(),
  /** ACE-Step language code ("en", "de", …); "unknown" lets the model decide */
  language: z.string().max(8).default("unknown"),
  /** musical key, e.g. "C Major" / "Am"; blank = auto */
  keyscale: z.string().max(20).optional(),
  timesignature: z.enum(["2", "3", "4", "6"]).optional(),
  /** diffusion steps (turbo default 8) and timestep shift (default 3.0) */
  steps: z.number().int().min(1).max(100).optional(),
  shift: z.number().min(0.5).max(10).optional(),
  /** best-effort two-singer treatment — folded into the caption; ACE-Step has
   * no first-class duet parameter */
  duet: z.boolean().default(false),
  /** room-tone delivery (P3.2): the finished track becomes this bible
   * location's `roomTone` bed, the way a boarded still becomes a keyframe */
  roomTone: z.object({ location: z.string().min(1) }).optional(),
});

/** Seed-VC voice conversion — re-voice existing audio (speech or singing)
 * into a cloned voice from the roster. kind rides on "tts" (voice shelf)
 * unless context says otherwise. */
export const voiceConvertPayloadSchema = z.object({
  type: z.literal("voiceConvert"),
  /** dataRoot-relative source audio (library relPath or an uploaded clip) */
  source: z.string().min(1),
  /** target cloned-voice id from the voice roster */
  voice: z.string().min(1),
  /** "music" = sing-conversion chained off a Music-lab track — routes the
   * output to the music shelf and the Music lab's job views; absent = Voice lab */
  context: z.enum(["music"]).optional(),
  /** conversion engine — absent = Seed-VC (local); "rvc" = Replicate RVC v2
   * cloud with this voice's trained model (needs the Replicate token + a
   * finished rvcTrain job) */
  engine: z.enum(["seedvc", "rvc"]).optional(),
  /** sing enables F0 conditioning (singing voice conversion) */
  mode: z.enum(["speak", "sing"]).default("speak"),
  /** diffusion steps — 25 speech / 30–50 singing */
  diffusionSteps: z.number().int().min(4).max(100).default(25),
  /** singing only: transpose in semitones (e.g. -12 male→female source gap) */
  semitoneShift: z.number().int().min(-24).max(24).default(0),
  /** singing only (RVC): octave correction of the vocals so the melody lands in
   * the target voice's natural register. "auto" measures source vs voice-ref
   * pitch and picks the nearest octave — works for any voice, male or female. */
  pitchMode: z.enum(["auto", "none", "octave-down", "octave-up"]).default("auto"),
  lengthAdjust: z.number().min(0.5).max(2).default(1),
  cfgRate: z.number().min(0).max(1).default(0.7),
});

/** Train an RVC v2 model for a cloned voice on Replicate (paid, ~15 min).
 * The finished model zip lands in <dataRoot>/voices/rvc/<voice>.zip and from
 * then on unlocks voiceConvert engine "rvc" — the songlar-quality path. */
export const rvcTrainPayloadSchema = z.object({
  type: z.literal("rvcTrain"),
  /** cloned-voice id from the roster (its reference clip is the dataset) */
  voice: z.string().min(1),
});

/* ---------- Shot Director ----------
 * The optional `director` block on a video job. Absent → the proven
 * single-keyframe graph renders exactly as before. Present → the shot is a
 * timeline: images pinned at times, prompts that change over the take, voice
 * takes locked to timecodes, an optional motion reference, and a retake
 * window. Times are authored in SECONDS; the builder converts and snaps to
 * LTX's 8n+1 frame rule so callers never have to think in frames. */

export const directorKeyframeSchema = z.object({
  /** library relPath of the still */
  image: z.string().min(1),
  /** when it lands, in seconds from the start of the shot */
  atSec: z.number().min(0).default(0),
  /** 1 = locked to this exact frame, lower = a suggestion LTX may drift from */
  strength: z.number().min(0).max(1).default(1),
});

export const directorPromptZoneSchema = z.object({
  /** the beat as the relay will read it — camera references already expanded */
  prompt: z.string().min(1),
  /** how long this beat holds before the next one takes over */
  lengthSec: z.number().min(0.1),
  /** cinematography-bank ids this beat was composed from ("ws", "push-in").
   * Kept beside the composed prompt so a saved shot can be re-opened with its
   * pickers intact. Expansion belongs to whoever COMPOSES the spec (the lab
   * panel, the Director agent) via composeZonePrompt — the render path takes
   * `prompt` verbatim, so a beat is never expanded twice. */
  shot: z.string().default(""),
  move: z.string().default(""),
});
export type DirectorPromptZone = z.infer<typeof directorPromptZoneSchema>;

export const directorAudioSchema = z.object({
  /** library relPath of a voice take (or any audio asset) */
  take: z.string().min(1),
  atSec: z.number().min(0).default(0),
  /** skip this far into the take before using it */
  trimStartSec: z.number().min(0).default(0),
});

export const directorMotionSchema = z.object({
  /** library relPath of the video whose motion is transferred */
  video: z.string().min(1),
  atSec: z.number().min(0).default(0),
  /** how much of the reference to use; omitted = to the end of the shot */
  lengthSec: z.number().min(0.1).optional(),
  /** skip this far into the reference before its motion starts driving */
  trimStartSec: z.number().min(0).default(0),
  /** which IC-LoRA carries the motion: "motionTrack" follows the reference's
   * movement closely, "union" takes its staging more loosely */
  icLora: z.enum(["union", "motionTrack"]).default("motionTrack"),
  /** 0..1 — how hard the reference's motion is imposed */
  strength: z.number().min(0).max(1).default(1),
  /** lift the reference's own audio onto the shot instead of the audio lane */
  useItsAudio: z.boolean().default(false),
});

/* A cast reference. LTX reads subjects off a REFERENCE SHEET — one image whose
 * cells hold the characters, props and settings the shot needs — carried into
 * the render by the Ingredients IC-LoRA. So refs are authored one subject at a
 * time here and the render path lays them out into a sheet, writing the
 * "Top Row Left (Character - Sterling)" description block the model expects.
 * That's the whole reason a ref carries prose: the picture alone doesn't tell
 * LTX which cell is a character and which is a prop. */
export const directorRefSchema = z.object({
  /** library relPath of the still — a hero frame or a character-sheet crop */
  image: z.string().min(1),
  /** what to call it in the sheet description, and in the shot prompt */
  name: z.string().default(""),
  kind: z.enum(["character", "prop", "setting"]).default("character"),
  /** wardrobe, markings, colour — what must stay true across the shot */
  description: z.string().default(""),
});
export type DirectorRef = z.infer<typeof directorRefSchema>;

export const directorRetakeSchema = z.object({
  /** library relPath of the finished take being fixed */
  source: z.string().min(1),
  atSec: z.number().min(0),
  lengthSec: z.number().min(0.1),
  prompt: z.string().min(1),
  strength: z.number().min(0).max(1).default(1),
  /** Re-render the window's SOUND as well as its picture. Off by default: the
   * original audio is what the rest of the take is cut to, and LTX asked for
   * free air invents dialogue rather than matching it (measured 2026-07-25). */
  regenerateAudio: z.boolean().default(false),
});

export const directorSpecSchema = z.object({
  /** anchors cast, wardrobe and style across every beat */
  globalPrompt: z.string().default(""),
  negativePrompt: z.string().optional(),
  /** 24 is the house rate; 48 buys cleaner fast motion at double the cost */
  fps: z.number().min(1).max(60).default(24),
  keyframes: z.array(directorKeyframeSchema).max(24).default([]),
  promptZones: z.array(directorPromptZoneSchema).max(12).default([]),
  audio: z.array(directorAudioSchema).max(12).default([]),
  motion: directorMotionSchema.optional(),
  /** the cast (and props, and sets) this shot must stay on-model for. Six is
   * the sheet's own ceiling — three rows of two, the layout the Ingredients
   * IC-LoRA's own examples use. */
  refs: z.array(directorRefSchema).max(6).default([]),
  /** 0..1 — how hard the sheet holds the shot to its subjects. 1 = as trained. */
  refStrength: z.number().min(0).max(1).default(1),
  retake: directorRetakeSchema.optional(),
  /** fill the silence between voice takes with generated sound */
  inpaintAudio: z.boolean().default(true),
  /** prompt-zone boundary softness: 0.001 = a hard cut between beats,
   * 0.5+ = a dissolve. The relay paper's default is 0.001. */
  epsilon: z.number().min(0.0001).max(0.99).default(0.001),
});
export type DirectorSpec = z.infer<typeof directorSpecSchema>;

/* ---------- MiniMax-H3 references (ref2va) ---------- */

/* H3's second head reads REFERENCES rather than keyframes: stills, clips and
 * sound it must carry forward into a new take. It is a different checkpoint
 * (ref2va, not fl2va) and a different node, so a shot uses one mode or the
 * other — a reference shot has no first/last frame at all.
 *
 * The tags are the whole interface. Each reference is presented to the model as
 * <Picture i> / <Video k> / <Audio j>, and the prompt has to name them for them
 * to mean anything: "use <Picture 1> as the character and <Video 1>'s camera
 * move". minimaxRefLabels() computes those numbers, because the numbering has
 * one trap in it — see there. */

/** One reference clip: a window of a library video, and whether its own
 * soundtrack rides along as a reference too. */
export const minimaxRefVideoSchema = z.object({
  /** library relPath of the clip */
  video: z.string().min(1),
  /** skip this far into it before the referenced window starts */
  startSec: z.number().min(0).default(0),
  /** how much of it to show the model. Reference frames are VAE-encoded and
   * ride through every sampling step, so this is a real cost, not a pointer. */
  lengthSec: z.number().min(0.3).max(15).default(3),
  /** present its soundtrack as well — a voice to keep, a rhythm to match */
  useItsAudio: z.boolean().default(false),
});
export type MinimaxRefVideo = z.infer<typeof minimaxRefVideoSchema>;

export const minimaxRefsSchema = z.object({
  /** library relPaths of stills — identity, wardrobe, style, a set */
  images: z.array(z.string().min(1)).max(9).default([]),
  /** what each still is FOR, index-aligned with `images` (missing = subject).
   * A `subject` is a character or prop the shot must carry on-model; a
   * `style` still is reference footage — palette, grade, texture and light
   * are taken from it and nothing in it appears in the scene. The adapter
   * writes the style wording into the prompt (withStyleRefs) so the tag is
   * never read as "put this in the shot" (VIDEO-LAB-FREEFORM-PLAN.md §2.4). */
  imageRoles: z.array(z.enum(["subject", "style"])).max(9).default([]),
  videos: z.array(minimaxRefVideoSchema).max(3).default([]),
  /** library relPaths of audio — a voice to clone, a piece of score */
  audios: z.array(z.string().min(1)).max(3).default([]),
  /** "match" scales each reference still to the render's pixel area; "max"
   * gives it a 2048px short edge for stronger identity, several times slower
   * because the extra tokens ride through every step. */
  imageSize: z.enum(["match", "max"]).default("match"),
});
export type MinimaxRefs = z.infer<typeof minimaxRefsSchema>;

export interface MinimaxRefLabels {
  /** <Picture i> for each entry of refs.images, in order */
  images: string[];
  /** per reference clip: its own <Video k>, and its soundtrack's <Audio j> */
  videos: { video: string; audio: string | null }[];
  /** <Audio j> for each standalone clip in refs.audios */
  audios: string[];
  /** every tag that exists, in the order the model is shown them */
  all: string[];
}

/** Which tag names this reference set will actually have.
 *
 * The trap: ordinals are 1-based PER TYPE, and a reference video's soundtrack
 * counts as an <Audio j> of its own — emitted just before its <Video k>. So a
 * shot with one clip-with-sound plus one standalone voice clip has the clip's
 * sound as <Audio 1> and the voice as <Audio 2>, which is the opposite of the
 * order they were authored in. Getting this wrong doesn't fail the render; it
 * quietly points the prompt at the wrong reference. */
export function minimaxRefLabels(refs: MinimaxRefs): MinimaxRefLabels {
  const all: string[] = [];
  const images = refs.images.map((_, i) => {
    const tag = `<Picture ${i + 1}>`;
    all.push(tag);
    return tag;
  });
  let audioN = 0;
  const videos = refs.videos.map((v, i) => {
    const audio = v.useItsAudio ? `<Audio ${++audioN}>` : null;
    if (audio) all.push(audio);
    const video = `<Video ${i + 1}>`;
    all.push(video);
    return { video, audio };
  });
  const audios = refs.audios.map(() => {
    const tag = `<Audio ${++audioN}>`;
    all.push(tag);
    return tag;
  });
  return { images, videos, audios, all };
}

/** Tags a prompt uses that this reference set doesn't have — a typo'd
 * <Picture 3> when only two were attached, or an ordinal shifted by a
 * soundtrack. The model is given nothing under that name. */
export function unknownMinimaxRefTags(prompt: string, refs: MinimaxRefs): string[] {
  const have = new Set(minimaxRefLabels(refs).all.map((t) => t.toLowerCase()));
  /* The separator is \s* rather than \s+ on purpose: the tokenizer presents
   * each reference as the literal text "<Picture 1>: ", so "<Picture1>" is not
   * a formatting variant the model forgives — it is a different string, and
   * saying so is more use than staying quiet. */
  const used = prompt.match(/<\s*(?:picture|video|audio)\s*\d+\s*>/gi) ?? [];
  const missing = new Set<string>();
  for (const raw of used) {
    const tag = raw.replace(/\s+/g, " ").replace(/<\s*/, "<").replace(/\s*>/, ">");
    const norm = tag.toLowerCase();
    if (!have.has(norm)) missing.add(tag.replace(/^<(\w)/, (_, c: string) => `<${c.toUpperCase()}`));
  }
  return [...missing];
}

/** Does this reference set carry anything at all? An empty one is not a
 * reference shot — it would just be text-to-video on the wrong checkpoint. */
export function hasMinimaxRefs(refs: MinimaxRefs | undefined | null): refs is MinimaxRefs {
  return !!refs && refs.images.length + refs.videos.length + refs.audios.length > 0;
}

/* Declared up here, above videoPayloadSchema, because the video payload
 * carries a partial camera spec of its own and a zod schema evaluates its
 * shape at module load — a reference to a `const` declared further down the
 * file is a TDZ crash on import, not a forward declaration.
 *
 * Free-text this step; storyboard later swaps these to structured refs into
 * the cinematography bible's banks ("MS", "low angle", "sitcom lighting"). */
export const cameraSpecSchema = z.object({
  shotSize: z.string().default(""),
  angle: z.string().default(""),
  move: z.string().default(""),
  lens: z.string().default(""),
  lighting: z.string().default(""),
  notes: z.string().default(""),
});
export type CameraSpec = z.infer<typeof cameraSpecSchema>;

export const videoPayloadSchema = z.object({
  type: z.literal("video"),
  prompt: z.string().min(1),
  /** negative prompt for the simple (non-Director) LTX paths; omitted = the
   * template's own default. A look sets it; H3 and Seedance ignore it. */
  negativePrompt: z.string().max(2000).optional(),
  engine: z.string().default("ltx2"),
  /** start frame as a dataRoot-relative library path (i2v); required by LTX */
  startFrame: z.string().optional(),
  /** the frame the take must LAND on. MiniMax-H3's fl2va mode (the "FL" in
   * its name), and — where the install carries the core guide nodes — LTX's
   * end-frame guide. Seedance ignores it. */
  endFrame: z.string().optional(),
  /** mid-shot anchor frames for the LTX simple path — each image is imposed at
   * its time on the way to (or instead of) an end frame. The Director timeline
   * has its own richer keyframe lane; this one is for quick lab renders. */
  keyframes: z
    .array(
      z.object({
        /** dataRoot-relative library path */
        image: z.string().min(1),
        atSec: z.number().min(0),
        strength: z.number().min(0).max(1).default(1),
      }),
    )
    .max(8)
    .default([]),
  /** dialogue audio as a dataRoot-relative library path (switches to ia2v lip-sync) */
  audio: z.string().optional(),
  /** LTX 2.3 has no fixed clip length — the ceiling here is VRAM headroom on a
   * 24 GB card, not the model. Seedance rounds to its API's 5s/10s. */
  durationSec: z.number().min(1).max(30).default(5),
  /** "1280 × 720" style; adapter parses W/H */
  resolution: z.string().default("1280 × 720"),
  /** LTX only: 24 is the trained default; 48 doubles the frame count for the
   * same seconds — smoother, roughly double the render time and VRAM. */
  fps: z.union([z.literal(24), z.literal(48)]).default(24),
  /** Draft mode, with a per-engine meaning. LTX: stop after the base sampling
   * pass and skip the ×2 upscale + refine stage — half the pixels, well under
   * half the wait. MiniMax-H3: the distilled Draft tier (see minimaxTier).
   * Both are for blocking a shot, not keeping it. */
  fast: z.boolean().default(false),
  /** LTX 2.5's Gemma prompt enhancer. Omitted = on whenever its weights are
   * installed (the behavior every queued job predating this field expects);
   * false = the prompt reaches the encoder verbatim. A multi-shot prose
   * prompt MUST run with false — the enhancer rewrites away the cut structure
   * and drops dialogue (measured 2026-08-31, MULTI-SHOT-PODCAST-PILOT.md).
   * Engines with no enhancer ignore it. */
  enhance: z.boolean().optional(),
  /** MiniMax-H3's quality ladder, which has three rungs rather than two: the
   * 4-step distill (Draft), the 8-step distill (Standard), and the model's own
   * 25-step schedule with no LoRA at all (Final). Absent = read `fast`, so a
   * job queued before this field existed still means what it meant. */
  minimaxTier: z.enum(["draft", "standard", "final"]).optional(),
  /** Which Standard-tier distill to render on (MiniMax-H3, fl2va head).
   *
   * Absent = the shipped LightX2V weight, which stays the default until a
   * candidate beats it on evidence. The alternates exist to BE compared —
   * this is the knob the A/B queue turns, which is why it is a payload field
   * and not a setting: a bake-off is per-render, not per-machine. A candidate
   * carries its own sampler, strength and sigma ladder (see
   * MINIMAX_ALT_DISTILL); the adapter refuses if its weights are missing
   * rather than silently rendering the default and reporting a comparison.
   *
   * Each candidate declares the tier it belongs to (MINIMAX_ALT_DISTILL in
   * core) and the adapter refuses it on any other — Final is never a
   * candidate's tier. */
  minimaxDistill: z.enum(MINIMAX_DISTILL_IDS).optional(),
  /** stackable adapter LoRAs (LTX only) — names must come from the install's
   * own list (capabilities.availableLoras); ComfyUI validates them verbatim */
  loras: z
    .array(
      z.object({
        name: z.string().min(1),
        strength: z.number().min(-1).max(2).default(1),
      }),
    )
    .max(3)
    .default([]),
  /** camera-control LoRA move (LTX only). Gated on capabilities.cameraLoras —
   * hidden until the weights are in the install's lora folder (the Lightricks
   * set loads on 2.3 despite its 19b name; see resolveCameraLoras). */
  cameraLora: z
    .object({
      move: z.enum([
        "dolly-in",
        "dolly-out",
        "dolly-left",
        "dolly-right",
        "jib-up",
        "jib-down",
        "static",
      ]),
      strength: z.number().min(0).max(1.5).default(1),
    })
    .optional(),
  motionStrength: z.number().min(0).max(1).optional(),
  /** The director's edit, in cinematography-bank ids ("mcu", "push-in",
   * "sitcom.warm-home"). PROVENANCE ONLY as far as the adapters are concerned:
   * the composer — the panel for a lab render, composeShotSpec for a boarded
   * one — expands these to prose and puts them in `prompt` itself. An adapter
   * that expanded them again would say the framing twice, which is the same
   * stacking rule the art direction and the look line live under. */
  cine: cameraSpecSchema.partial().optional(),
  seed: z.number().int().optional(),
  /** the take is meant to loop: the panel set `endFrame` = `startFrame` so
   * the last frame lands back on the first. Provenance only as far as the
   * adapters go — the end frame does the work — but it travels into the
   * take's sidecar (`AssetMeta.loop`) so an export can trim the seam frame
   * and the monitor can say why the clip cycles cleanly. */
  loop: z.boolean().optional(),
  /** Shot Director timeline. Omitted = the single-keyframe render this lab
   * has always done; present = the Director graph (external ComfyUI with the
   * WhatDreamsCost pack, or managed once its node spec is installed). */
  director: directorSpecSchema.optional(),
  /** MiniMax-H3's reference mode. Present and non-empty = the take renders on
   * the ref2va checkpoint against these references instead of fl2va, which is
   * also how a clip gets EDITED: reference the clip, describe the change.
   * There are no keyframes in this mode — the ref2va node has no first/last
   * frame input, so a still that must be in the shot goes in as a reference. */
  minimaxRefs: minimaxRefsSchema.optional(),
  /** storyboard delivery: attach the finished take to this shot's videoTakes
   * (and move a boarded shot to "generated"), the way a finished keyframe
   * attaches to its shot's keyframes */
  board: z
    .object({
      shotId: z.string().min(1),
      /** P5: the take that lands is a preview — flagged on the take, never
       * bedded with room tone, never the shot's "rendered" milestone */
      preview: z.boolean().optional(),
    })
    .optional(),
  /** LTX 2.5 FINISHING: a pass over an existing take instead of a fresh
   * sample. Two modes, both cheaper and more faithful than re-rendering:
   *
   *   refine  — the source is a draft that kept its base-pass latents
   *             (`AssetMeta.draft`). Only the ×2 latent upscale + refine pass
   *             runs, so the full render has the draft's EXACT blocking — what
   *             was approved is what ships. Measured 2026-09-03: bit-identical
   *             to a fresh full render at the same seed, and NO faster on this
   *             card (187s vs 186s for 5s at 1280×704) — the base pass is ~25s
   *             of a render whose fixed cost (encoders, enhancer, decode) is
   *             the rest. Its value is the promotion path: one click on a
   *             take, no inputs to re-supply, the same picture guaranteed.
   *             Every other field of this payload is ignored: the draft's own
   *             request is what the refine pass conditions on.
   *   upscale — Lightricks' Pixel Spatial Upscaler IC-LoRA: a ×2 generative
   *             pass that reads the take as an in-context reference and
   *             reinvents fur/edge detail 2.5 renders soft at full quality
   *             (measured 2026-09-02). Works on any take, not only LTX ones.
   *             `prompt` is the source take's own prompt; `resolution` is the
   *             output canvas the router computed (source ×2, snapped). */
  finish: z
    .object({
      /** dataRoot-relative library path of the take being finished */
      source: z.string().min(1),
      mode: z.enum(["refine", "upscale"]),
      /** upscale only: how far the pass may depart from the source. 1 = the
       * whole 8-step ladder from pure noise (as trained); lower drops the top
       * sigmas so the output stays closer to the reference frames. */
      strength: z.number().min(0.3).max(1).default(1),
    })
    .optional(),
});

export type VideoPayload = z.infer<typeof videoPayloadSchema>;

/** Is this prompt written as multi-shot prose — the LTX 2.5 grammar that makes
 * one generation cut between framings ("A hard cut transitions to…")? The
 * pilot's rules require every transition to be named in prose, so the cut
 * phrase is the reliable signature. Composition uses this to force
 * enhance: false: a prompt authored to a structure must not be rewritten. */
export function isMultiShotProse(prompt: string): boolean {
  return /\b(?:hard |match |jump |smash )?cuts? (?:transitions? to|to)\b/i.test(prompt);
}

/** Image → textured mesh through the local Hunyuan3D-2.1 runner. Two stages
 * inside one job: a flow-matching DiT samples an occupancy field and marches
 * it to a mesh, then a multiview diffusion pass paints PBR textures and bakes
 * them onto the UVs. The shape stage is cached to `<out>.shape.ply`, so a
 * texture retry costs the paint pass only.
 *
 * Licence note carried into every asset's sidecar: Hunyuan3D 2.1 ships under
 * the Tencent Community License — attribution is required, and it is not
 * licensed in the EU, UK or South Korea. */
export const model3dPayloadSchema = model3dOptionsSchema.extend({
  type: z.literal("model3d"),
  engine: z.literal("hunyuan3d-2.1").default("hunyuan3d-2.1"),
  /** dataRoot-relative concept still. A clean subject on a plain background
   * is what the model expects; anything else and the background is silently
   * removed first (u2net), which rarely improves the shape. */
  source: z.string().min(1),
});

/* ---------- coverage pass ---------- */

/** One approved plate → eight on-model angles of the same room and cast, in
 * one ref2va generation. See `coverage.ts` for why 124 frames and why those
 * offsets; this is only the request.
 *
 * There is no `engine` field on purpose. The pass IS the ethanfel ref2va
 * recipe — a different engine would be a different technique with different
 * offsets, not the same job pointed elsewhere. */
export const coveragePayloadSchema = z.object({
  type: z.literal("coverage"),
  /** the approved keyframe or set plate, as a dataRoot-relative library path */
  source: z.string().min(1),
  /** one line naming what must survive the orbit — "the lion at the desk;
   * keep this exact lion". Quoted into the prompt verbatim. */
  subject: z.string().trim().min(1).max(400),
  /** the bible location these angles belong to, for the canon library's
   * Angles tab. Empty = unplaced, the same convention the boarded keyframes
   * already use. */
  location: z.string().default(""),
  /** "1344 × 768" style; the adapter snaps and draft-scales it like any H3
   * render, so a coverage pass costs what a Draft take costs. */
  resolution: z.string().default("1344 × 768"),
  seed: z.number().int().optional(),
  /** Draft is the default because a coverage pass is a reference sheet, not a
   * take: the angles are boarded from, then rendered properly. Standard is
   * there for a plate whose geometry the 4-step distill keeps losing. */
  tier: z.enum(["draft", "standard"]).default("draft"),
});
export type CoveragePayload = z.infer<typeof coveragePayloadSchema>;

export const jobPayloadSchema = z.discriminatedUnion("type", [
  videofastPayloadSchema,
  imagePayloadSchema,
  imageDeckPayloadSchema,
  imageUpscalePayloadSchema,
  ttsPayloadSchema,
  voiceConvertPayloadSchema,
  rvcTrainPayloadSchema,
  musicPayloadSchema,
  model3dPayloadSchema,
  coveragePayloadSchema,
  videoPayloadSchema,
  // declared below (timeline section) — z.lazy keeps the forward reference legal
  z.object({
    type: z.literal("export"),
    project: z.string().min(1),
    /** the sequence snapshot taken when the export was enqueued */
    timeline: z.lazy(() => timelineSchema),
    /** Integrated loudness the mix is normalised to before muxing. The takes
     * come out of LTX and Chatterbox at wildly different levels and the raw
     * mix of the pilot's Field Note measured mean −28.3 dB — unwatchable on a
     * phone (defect #11). −16 LUFS is the mono/vertical delivery target; null
     * ships the mix at its own level. */
    loudnessLufs: z.number().min(-40).max(-6).nullable().default(-16),
  }),
]);
export type JobPayload = z.infer<typeof jobPayloadSchema>;

export const jobSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: jobKindSchema,
  engine: z.string(),
  status: jobStatusSchema,
  progress: z.number().min(0).max(100),
  stage: z.string().optional(),
  eta: z.string().optional(),
  priority: jobPrioritySchema,
  /** second line in the job table: resolution, counts, voice… */
  detail: z.string().optional(),
  /** project path shown under the title */
  project: z.string().optional(),
  elapsed: z.string().optional(),
  /** failure reason (status === "failed") */
  error: z.string().optional(),
  payload: jobPayloadSchema.optional(),
  /** where the finished artifact landed (adapter jobs, status === "completed") */
  output: z.string().optional(),
  /** the scene-assembly batch that queued it (N1.1) — the Job Center groups on it */
  batch: z.string().optional(),
});
export type Job = z.infer<typeof jobSchema>;

export const enqueueJobSchema = z.object({
  title: z.string().min(1),
  kind: jobKindSchema,
  engine: z.string().min(1),
  priority: jobPrioritySchema.default("batch"),
  detail: z.string().optional(),
  project: z.string().optional(),
  payload: jobPayloadSchema.optional(),
});
export type EnqueueJob = z.input<typeof enqueueJobSchema>;
/** post-parse shape (defaults applied) — what JobEngine.enqueue actually takes */
export type EnqueueJobResolved = z.infer<typeof enqueueJobSchema>;

/* ---------- lab generate inputs ---------- */
/* Each lab's generate mutation takes its payload (minus the discriminant)
 * plus the project the artifact should land in. */

const projectField = { project: z.string().min(1) };

export const imageGenerateSchema = imagePayloadSchema.omit({ type: true }).extend(projectField);
export type ImageGenerate = z.input<typeof imageGenerateSchema>;

export const imageDeckGenerateSchema = imageDeckPayloadSchema
  .omit({ type: true })
  .extend(projectField);
export type ImageDeckGenerate = z.input<typeof imageDeckGenerateSchema>;

export const imageUpscaleGenerateSchema = imageUpscalePayloadSchema
  .omit({ type: true })
  .extend(projectField);
export type ImageUpscaleGenerate = z.input<typeof imageUpscaleGenerateSchema>;

/** upload a reference image into the project's refs/ staging folder (returns
 * its dataRoot-relative path, ready for imagePayloadSchema.refs). Staged refs
 * live OUTSIDE assets/ on purpose — an uploaded source is an input, not a
 * generated take, and must never show up in the library or the lab's roll. */
export const imageRefAddSchema = z.object({
  ...projectField,
  name: z.string().min(1).max(80),
  /** PNG bytes, base64 (renderer re-encodes any picked file to PNG) */
  pngBase64: z.string().min(1),
});
export type ImageRefAdd = z.input<typeof imageRefAddSchema>;

export const ttsGenerateSchema = ttsPayloadSchema.omit({ type: true }).extend(projectField);
export type TtsGenerate = z.input<typeof ttsGenerateSchema>;

export const musicGenerateSchema = musicPayloadSchema.omit({ type: true }).extend(projectField);
export type MusicGenerate = z.input<typeof musicGenerateSchema>;

/** lift an image already in the library into a mesh */
export const model3dGenerateSchema = model3dPayloadSchema
  .omit({ type: true })
  .extend(projectField);
export type Model3dGenerate = z.input<typeof model3dGenerateSchema>;

/** the prompt path: draw a concept still on a clean background, then chain
 * the mesh job onto it. Two jobs, one intent — the lab shows them as one row
 * because the still is scaffolding, not a deliverable. */
export const model3dFromPromptSchema = z.object({
  ...projectField,
  /** what the thing IS ("a dented brass kettle"), not a photographic brief —
   * the lab wraps it in the framing the shape model expects */
  subject: z.string().min(1).max(400),
  /** image engine id from the image-lab catalog */
  model: z.string().default("z-image"),
  textured: z.boolean().default(true),
  seed: z.number().int().optional(),
  octree: z.number().int().min(128).max(512).optional(),
  textureSize: z.number().int().min(512).max(4096).optional(),
});
export type Model3dFromPrompt = z.input<typeof model3dFromPromptSchema>;

export const voiceConvertGenerateSchema = voiceConvertPayloadSchema
  .omit({ type: true })
  .extend(projectField);
export type VoiceConvertGenerate = z.input<typeof voiceConvertGenerateSchema>;

export const rvcTrainGenerateSchema = rvcTrainPayloadSchema
  .omit({ type: true })
  .extend(projectField);
export type RvcTrainGenerate = z.input<typeof rvcTrainGenerateSchema>;

/** upload a conversion source clip (already wav-encoded by the renderer) into
 * the project's assets; returns its dataRoot-relative path */
export const voiceSourceAddSchema = z.object({
  ...projectField,
  name: z.string().min(1).max(80),
  wavBase64: z.string().min(1),
});
export type VoiceSourceAdd = z.input<typeof voiceSourceAddSchema>;

export const videoGenerateSchema = videoPayloadSchema.omit({ type: true }).extend(projectField);
export type VideoGenerate = z.input<typeof videoGenerateSchema>;

/** Finish an existing take (see videoPayloadSchema.finish). The router reads
 * the source's sidecar and composes the whole payload — callers name the take
 * and the mode, nothing else. `shotId` attaches the finished take to a
 * boarded shot the way a render does (the Desk passes the active shot). */
export const videoFinishSchema = z.object({
  project: z.string().min(1),
  /** dataRoot-relative library path of the take to finish */
  source: z.string().min(1),
  mode: z.enum(["refine", "upscale"]),
  strength: z.number().min(0.3).max(1).optional(),
  shotId: z.string().optional(),
});
export type VideoFinish = z.input<typeof videoFinishSchema>;

/* ---------- A/B render queue ----------
 *
 * One base payload + N overrides, queued back-to-back at batch priority with
 * ONE shared seed, so the only difference between the takes is the thing under
 * test. The comparison record is the point: every experiment in the speed doc
 * is "did this change make it faster / better", and a stopwatch plus a memory
 * of last week's render is not evidence. Timings, outputs and QC verdicts land
 * in <dataRoot>/ab/<id>/run.json, which the Desk's A/B tab plays side by side. */

/** the fields a variant may move. Everything else is the base's business —
 * an override that changed the prompt or the start frame would not be an
 * experiment, it would be a different shot. */
export const abOverridesSchema = videoPayloadSchema
  .omit({ type: true, prompt: true, startFrame: true, board: true, director: true })
  .partial();
export type AbOverrides = z.infer<typeof abOverridesSchema>;

export const abVariantInputSchema = z.object({
  label: z.string().trim().min(1).max(60),
  overrides: abOverridesSchema.default({}),
});

export const videoAbSchema = z.object({
  ...projectField,
  /** what the experiment is testing, for the record and the Desk card */
  title: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(2000).optional(),
  /** the shot every variant renders; its seed is overwritten by the shared one */
  base: videoPayloadSchema.omit({ type: true }),
  variants: z.array(abVariantInputSchema).min(2).max(6),
  /** shared seed; omitted = one is drawn so the run is still reproducible */
  seed: z.number().int().optional(),
  /** "shared" (the experiment): every variant renders at ONE seed, so the
   * only difference between takes is the override. "spray" (the seed spray,
   * VIDEO-LAB-FREEFORM-PLAN.md §2.5): every variant gets its OWN seed — the
   * override's `seed` when given, a fresh draw otherwise — because here the
   * seed IS the thing being compared. */
  seedPolicy: z.enum(["shared", "spray"]).default("shared"),
});
export type VideoAb = z.input<typeof videoAbSchema>;

export const abVariantSchema = z.object({
  label: z.string(),
  jobId: z.string(),
  overrides: abOverridesSchema,
  status: jobStatusSchema,
  /** the seed THIS variant rendered at — equal to the run's under "shared",
   * its own under "spray"; promoting a sprayed take re-renders at exactly it */
  seed: z.number().int().optional(),
  /** dataRoot-relative take, once the job's output is imported */
  output: z.string().optional(),
  error: z.string().optional(),
  /** wall clock from admission to completion — the number the experiments compare */
  renderMs: z.number().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  /** qc.shot verdict when the run was started from a boarded shot */
  qc: z
    .object({ verdict: z.enum(["pass", "review", "fail"]), notes: z.array(z.string()).default([]) })
    .optional(),
});
export type AbVariant = z.infer<typeof abVariantSchema>;

export const abRunSchema = z.object({
  id: z.string(),
  project: z.string(),
  title: z.string(),
  notes: z.string().optional(),
  createdAt: z.string(),
  seed: z.number().int(),
  seedPolicy: z.enum(["shared", "spray"]).default("shared"),
  engine: z.string(),
  /** the base payload as queued, minus the per-variant overrides */
  base: videoPayloadSchema.omit({ type: true }),
  variants: z.array(abVariantSchema),
});
export type AbRun = z.infer<typeof abRunSchema>;

/** Has every variant stopped? A finished run is never re-synced from the queue,
 * so its numbers survive the job history rolling over (HISTORY_CAP). */
export function abRunSettled(run: AbRun): boolean {
  return run.variants.every((v) => v.status === "completed" || v.status === "failed");
}

/* ---------- voice cloning ---------- */

/** Freeze a reference clip as a named cloned voice. The renderer re-encodes
 * whatever the user uploaded or recorded into a PCM WAV before sending, so
 * studiod only ever stores canonical RIFF/WAVE files in <dataRoot>/voices/. */
export const voiceAddSchema = z.object({
  name: z.string().trim().min(1).max(40),
  /** base64 of the complete WAV file */
  wavBase64: z.string().min(100),
});
export type VoiceAdd = z.input<typeof voiceAddSchema>;

export const voiceRemoveSchema = z.object({ id: z.string().min(1) });

/** Display-name overlay. The id keeps pointing at the same reference clip, so
 * renaming never orphans a job, a bible character or a shot spec. */
export const voiceRenameSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(40),
});

/** Hide/restore a voice in the pickers — how read-only voices (videofast
 * char_refs, presets) leave the roster without deleting anyone's files. */
export const voiceHideSchema = z.object({ id: z.string().min(1), hidden: z.boolean() });

/* ---------- system ---------- */

export const vramSchema = z.object({
  /** GB actually in use */
  used: z.number(),
  /** GB reserved/allocated by processes (>= used) */
  allocated: z.number(),
  /** GB on the card */
  total: z.number(),
});
export type Vram = z.infer<typeof vramSchema>;

export const systemInfoSchema = z.object({
  gpu: z.string(),
  driver: z.string(),
  cudaCores: z.string(),
  vram: z.string(),
  ram: z.string(),
  storage: z.string(),
  tempC: z.number(),
  queuePaused: z.boolean(),
  /** the studiod this app is talking to was built before the code now on
   * disk — it has been superseded and only a restart will pick that up.
   * Surfaced in the global status strip because the failure is otherwise
   * invisible: a stale backend looks and behaves exactly like a healthy one,
   * right up until a fix you were told had shipped does nothing. */
  staleBuild: z.boolean().default(false),
});
export type SystemInfo = z.infer<typeof systemInfoSchema>;

export const preflightSchema = z.object({
  message: z.string(),
  after: z.string(),
});
export type Preflight = z.infer<typeof preflightSchema>;

/* ---------- settings ---------- */

/** Persisted studio configuration (~/.aurea/settings.json). Anything that was
 * a hardcoded path in the P0 skeleton lives here instead. */
/** Bumped when a stored default changes meaning and the OLD value has to be
 * lifted rather than kept. SettingsStore.load() migrates forward; see
 * SETTINGS_VERSION's history there. 1 → 2 (2026-08-30): sageAttention. */
export const SETTINGS_VERSION = 2;

export const settingsSchema = z.object({
  /** an older file parses as its own version and is migrated on load */
  version: z.number().int().default(SETTINGS_VERSION),
  storage: z.object({
    /** projects/assets/cache root; storage telemetry measures this volume */
    dataRoot: z.string().min(1),
    /** Model libraries the user already owns, in conventional ComfyUI layout
     * (unet/, diffusion_models/, text_encoders/, vae/, loras/, …). Mounted
     * read-only: weights found here count as installed, are never verified,
     * and are never deleted. First root wins on a filename collision. */
    modelRoots: z.array(z.string().min(1)).default([]),
  }),
  paths: z.object({
    /** videofast repo root — drives the first engine adapter; null until detected/set */
    videofastDir: z.string().nullable().default(null),
  }),
  /** Where the local generation engines live — detected on boot from the
   * machine's known install conventions, editable like every other path.
   * null = not found, the matching lab reports the engine unavailable. */
  engines: z
    .object({
      /** "managed" = studiod spawns its own headless ComfyUI from
       * <dataRoot>/runtime/; "external" = talk to comfyUrl (the escape hatch
       * for machines that already run ComfyUI Desktop or a custom install) */
      comfyMode: z.enum(["managed", "external"]).default("managed"),
      /** ComfyUI HTTP API when comfyMode is "external" */
      comfyUrl: z.string().default("http://127.0.0.1:8000"),
      /** "managed" = character voices run in the runtime's own Chatterbox
       * venv with model-manager weights; "external" = spawn chatterboxPython
       * against the videofast scripts (narrator/qwen voices are always
       * external — no managed build yet) */
      ttsMode: z.enum(["managed", "external"]).default("managed"),
      /** "managed" = music runs in the runtime's own ACE-Step venv (pinned
       * source checkout + model-manager checkpoints); "external" = spawn the
       * acestepDir checkout's own venv against the videofast CLI */
      musicMode: z.enum(["managed", "external"]).default("managed"),
      /** "managed" = LTX-2.3 renders on the managed ComfyUI with model-manager
       * weights (a ~42 GB gated download, so this is the only mode defaulting
       * to external); "external" = queue on comfyUrl, whose install already
       * has the LTX weights under their conventional names */
      videoMode: z.enum(["managed", "external"]).default("external"),
      /** MiniMax-H3 needs ComfyUI 0.30.0+ (comfy/ldm/minimax landed there),
       * while the proven LTX-2.3 pipeline runs on an older install with the
       * WhatDreamsCost pack. Rather than force one install to be both, H3
       * queues on its OWN ComfyUI — a side-by-side 0.30.x on another port.
       * Empty = the engine is off and the Video lab says so. */
      minimaxUrl: z.string().default(""),
      /** LTX render tuning — all opt-in, all needing comfyui-kjnodes. Defaults
       * keep the render byte-identical to the verified pipeline. */
      videoTuning: z
        .object({
          /** Chunk each transformer block's feed-forward. Pure torch, no extra
           * dependencies, and measured on a 3090 Ti (2026-07-25, seed 424242):
           * neutral on a 5s 704×896 shot (83.9s vs 83.6s, inside the ±20% run
           * noise) but a clear win once the shot is big — 10s at 896×1152 ran
           * 173.8s vs 224.6s over three alternating pairs, with the chunked
           * arm's WORST run still beating the plain arm's best. It only bites
           * when activations strain the allocator, which is exactly where
           * Director shots live, so it defaults on. The adapter drops it
           * automatically when KJNodes isn't installed. */
          chunkFeedForward: z.boolean().default(true),
          /** INT8 attention kernels — needs `sageattention` installed in
           * ComfyUI's python, or the render fails at the patch node */
          sageAttention: z.boolean().default(false),
          /** "cfg_pp" = ancestral base + cfg++ refine (the official 2.3
           * pairing); "euler" = what this pipeline has always shipped */
          sampler: z.enum(["euler", "cfg_pp"]).default("euler"),
          /** normalized attention guidance — makes the negative prompt bite
           * at cfg 1, where classifier-free guidance does nothing */
          nag: z.boolean().default(false),
        })
        .default({}),
      /** MiniMax-H3 tuning — a DIFFERENT ComfyUI install with a different
       * python, so its knobs are separate from videoTuning on purpose. */
      minimaxTuning: z
        .object({
          /* The KJ Sage patch on the H3 instance. Defaults ON since
           * 2026-08-30, when the managed runtime started installing
           * `sageattention` itself (see runtime.ts ACCEL_PACKAGES) — before
           * that the toggle pointed at a library nothing had put there, so off
           * was the only default that couldn't fail a render.
           *
           * It matters most here of any engine: H3's latent is ~100k tokens at
           * its native 1344×768 × 107 frames, and attention is quadratic, so
           * the measured 2.9× on the attention op is most of the step. The
           * adapter still drops it when the install has no KJ node — an
           * unavailable speed-up must not turn a working engine into a failing
           * one. */
          sageAttention: z.boolean().default(true),
        })
        .default({}),
      /** python.exe of the Chatterbox TTS venv (character voices) */
      chatterboxPython: z.string().nullable().default(null),
      /** python.exe of the Qwen3-TTS venv (narrator voices) */
      qwenTtsPython: z.string().nullable().default(null),
      /** python.exe of the DramaBox venv (expressive acted character voices) */
      dramaboxPython: z.string().nullable().default(null),
      /** DramaBox repo checkout (src/inference_server.py lives here) */
      dramaboxRepo: z.string().nullable().default(null),
      /** ACE-Step 1.5 checkout (its .venv/Scripts/python.exe runs music gen) */
      acestepDir: z.string().nullable().default(null),
      /** python.exe of the MiniMax-Music3 venv (pinned diffusers build);
       * null = probe the D:\music3env convention at use time */
      music3Python: z.string().nullable().default(null),
      /** local MiniMax-Music3 weights snapshot (modular_model_index.json root);
       * null = probe the D:\models\MiniMax-Music3 convention at use time */
      music3ModelDir: z.string().nullable().default(null),
      /** Hunyuan3D-2.1 checkout (the one holding generate.py, its shim/ and
       * repo/); null = probe the D:\hunyuan3d convention at use time */
      hunyuan3dDir: z.string().nullable().default(null),
      /** python.exe of that checkout's venv; null = <hunyuan3dDir>/.venv */
      hunyuan3dPython: z.string().nullable().default(null),
    })
    .default({}),
  providers: z.object({
    default: z.enum(["claude", "openrouter", "ollama"]).default("claude"),
    /** Claude Code model alias the Director runs on (resolved by the local CLI) */
    claudeModel: z.enum(["sonnet", "opus", "haiku"]).default("sonnet"),
    openrouterApiKey: z.string().default(""),
    /** fal.ai key — unlocks the Seedance cloud video engine (paid per clip) */
    falApiKey: z.string().default(""),
    /** Replicate token — unlocks RVC v2 voice training + conversion (paid per run) */
    replicateApiToken: z.string().default(""),
    ollamaBaseUrl: z.string().default("http://localhost:11434"),
    ollamaModel: z.string().default("llama3.1:8b-instruct-q4_K_M"),
  }),
  general: z.object({
    launchAtLogin: z.boolean().default(false),
    hardwareAcceleration: z.boolean().default(true),
    keepInTray: z.boolean().default(true),
    telemetry: z.boolean().default(false),
    /** first-run wizard completed (or skipped) — the renderer stops showing it */
    onboarded: z.boolean().default(false),
    /** the project the app's screens act on (P6) — null = the oldest project.
     * Persisted here, not in the renderer, so the Desk, the labs and any
     * shell that asks projects.active agree on which project is open. */
    activeProject: z.string().nullable().default(null),
  }),
  advanced: z.object({
    prereleaseEngines: z.boolean().default(false),
    verboseJobLogs: z.boolean().default(false),
    keepModelsWarm: z.boolean().default(false),
  }),
});
export type Settings = z.infer<typeof settingsSchema>;

/** Partial update — every section optional, every field within it optional. */
export const settingsUpdateSchema = z.object({
  storage: settingsSchema.shape.storage.partial().optional(),
  paths: settingsSchema.shape.paths.partial().optional(),
  engines: settingsSchema.shape.engines
    .removeDefault()
    .partial()
    // videoTuning is a nested object: accept a partial so toggling one knob
    // doesn't silently reset the others to their schema defaults (the store
    // merges it onto the current value)
    .extend({
      videoTuning: settingsSchema.shape.engines
        .removeDefault()
        .shape.videoTuning.removeDefault()
        .partial()
        .optional(),
      minimaxTuning: settingsSchema.shape.engines
        .removeDefault()
        .shape.minimaxTuning.removeDefault()
        .partial()
        .optional(),
    })
    .optional(),
  providers: settingsSchema.shape.providers.partial().optional(),
  general: settingsSchema.shape.general.partial().optional(),
  advanced: settingsSchema.shape.advanced.partial().optional(),
});
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

/** Live disk figures for the volume holding storage.dataRoot (null = unknown). */
export const storageStatsSchema = z.object({
  root: z.string(),
  freeGb: z.number().nullable(),
  totalGb: z.number().nullable(),
});
export type StorageStats = z.infer<typeof storageStatsSchema>;

/* ---------- projects ---------- */

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** subtitle in the switcher — computed by the store ("3 assets · Jul 14") */
  meta: z.string(),
  createdAt: z.string(),
});
export type Project = z.infer<typeof projectSchema>;

export const projectCreateSchema = z.object({ name: z.string().trim().min(1) });
export const projectSetActiveSchema = z.object({ id: z.string().min(1) });

export const projectRenameSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
});

/* ---------- asset library ---------- */

export const libraryKindSchema = z.enum(["image", "video", "audio", "music", "model3d"]);
export type LibraryKind = z.infer<typeof libraryKindSchema>;

/* ---------- timeline (OTIO-shaped, exporter later) ---------- */

/** One clip on a track. All times are seconds; `asset` is a library relPath. */
export const timelineClipSchema = z.object({
  id: z.string(),
  asset: z.string(),
  /** display label (defaults to the asset file name) */
  label: z.string().default(""),
  /** where on the timeline the clip starts */
  start: z.number().min(0),
  /** trim into the source media */
  in: z.number().min(0).default(0),
  /** clip length on the timeline */
  duration: z.number().positive(),
  /** crossfade INTO this clip from the previous clip on the same track */
  transitionSec: z.number().min(0).default(0),
});
export type TimelineClip = z.infer<typeof timelineClipSchema>;

export const timelineTrackKindSchema = z.enum(["video", "voice", "music", "sfx"]);
export type TimelineTrackKind = z.infer<typeof timelineTrackKindSchema>;

export const timelineTrackSchema = z.object({
  id: z.string(),
  kind: timelineTrackKindSchema,
  name: z.string(),
  muted: z.boolean().default(false),
  /** track volume, 0..2 (1 = unity) — applied in the preview player and the
   * ffmpeg export mix; lets music/voice sit under the video takes */
  gain: z.number().min(0).max(2).default(1),
  clips: z.array(timelineClipSchema).default([]),
});
export type TimelineTrack = z.infer<typeof timelineTrackSchema>;

/** The whole sequence for one project — <dataRoot>/projects/<id>/timeline.json */
export const timelineSchema = z.object({
  version: z.literal(1).default(1),
  fps: z.number().default(24),
  width: z.number().default(1280),
  height: z.number().default(720),
  tracks: z.array(timelineTrackSchema).default([]),
});
export type Timeline = z.infer<typeof timelineSchema>;

export const timelineUpdateSchema = z.object({
  project: z.string().min(1),
  timeline: timelineSchema,
});

/* Granular clip operations — the server-side edit surface used by the
 * Director's timeline_* tools (the desktop editor keeps whole-document saves).
 * addClip probes the media's real duration with ffprobe when none is given. */

export const timelineAddClipSchema = z.object({
  project: z.string().min(1),
  /** library relPath of the media to place */
  asset: z.string().min(1),
  /** target track kind; defaults from the asset kind (video/image → video, audio → voice, music → music) */
  track: timelineTrackKindSchema.optional(),
  /** nth track of that kind (0 = base layer; later video tracks composite on top).
   * One past the end creates the track ("Video 2"). Default 0. */
  trackIndex: z.number().int().min(0).optional(),
  /** timeline start in seconds; defaults to the end of the target track */
  start: z.number().min(0).optional(),
  in: z.number().min(0).default(0),
  /** seconds; defaults to the probed media duration (images: 4s) */
  duration: z.number().positive().optional(),
  transitionSec: z.number().min(0).default(0),
  label: z.string().optional(),
});
export type TimelineAddClip = z.input<typeof timelineAddClipSchema>;

export const timelineClipPatchSchema = z.object({
  start: z.number().min(0).optional(),
  in: z.number().min(0).optional(),
  duration: z.number().positive().optional(),
  transitionSec: z.number().min(0).optional(),
  label: z.string().optional(),
});

export const timelineUpdateClipSchema = z.object({
  project: z.string().min(1),
  clip: z.string().min(1),
  patch: timelineClipPatchSchema,
});

export const timelineRemoveClipSchema = z.object({
  project: z.string().min(1),
  clip: z.string().min(1),
});

export const timelineExportSchema = z.object({
  project: z.string().min(1),
  /** integrated loudness for the mix; null ships it un-normalised */
  loudnessLufs: z.number().min(-40).max(-6).nullable().default(-16),
});

/** Provenance sidecar (.{filename}.meta.json) written next to a file when a
 * job's output is imported. Best-effort: assets without one are fine. */
export const assetMetaSchema = z.object({
  /** payload type of the job that produced the file ("imageUpscale", "music", "voiceConvert") */
  origin: z.string().optional(),
  arrangement: z.enum(["instrumental", "vocals"]).optional(),
  /** dataRoot-relative source the job transformed (upscale/convert) */
  source: z.string().optional(),
  /** the words a music take was sung to — either the ones you wrote or the
   * ones the LM wrote for you. Job history is capped, so unless the sidecar
   * keeps them the lyrics are gone the moment the job ages out. */
  lyrics: z.string().optional(),
  /** the brief the take was generated from (music: description + styles) */
  prompt: z.string().optional(),
  /** the take's name as a person would write it. Filenames are slugified on
   * import ("german-party-rock-duet-male-and-female-voc-2"), and a slug is
   * what every list was printing — this keeps the readable original. */
  title: z.string().optional(),
  /** the style chips a music take was asked for, kept apart from the caption
   * so a track row can show them as chips instead of one run-on sentence */
  styles: z.array(z.string()).optional(),
  /** dataRoot-relative cover art generated for a music take. Written after
   * the fact: the picture is a separate, lower-priority job that finishes
   * well after the track, so it patches the sidecar rather than being in it. */
  cover: z.string().optional(),
  bpm: z.number().optional(),
  /** musical key as requested, e.g. "C Major" */
  keyscale: z.string().optional(),
  /** engine that rendered the file, when more than one could have ("ltx2",
   * "minimax-h3") — the take's look and its limits both follow from this */
  engine: z.string().optional(),
  /** the video arrived with its soundtrack already in it (MiniMax-H3 scores
   * picture and sound in one pass). Timeline and export treat such a take as
   * finished audio rather than a mute clip waiting for a voice track. */
  nativeAudio: z.boolean().optional(),
  /** the take was rendered to loop (its end frame IS its start frame): the
   * last frame duplicates the first, so a seamless cut drops one frame */
  loop: z.boolean().optional(),
  /** the words a voice take speaks — the timeline prints them on the clip */
  text: z.string().optional(),
  /** voice/character id the take was spoken with */
  voice: z.string().optional(),
  /** 3D: triangle count of the delivered mesh, and whether it carries PBR
   * maps or is bare geometry — the two things you need to know about a model
   * before opening it */
  faces: z.number().optional(),
  textured: z.boolean().optional(),
  /** 3D: the licence the generating model imposes on the OUTPUT. Hunyuan3D
   * 2.1 requires attribution and is not licensed in the EU/UK/KR, so the
   * obligation has to travel with the file rather than live in a doc. */
  license: z.string().optional(),
  attribution: z.string().optional(),
  /** LTX 2.5 draft: the base-pass latents the refine pass would have read,
   * kept beside the take (assets/video/.latents/) so "render this full"
   * (finish: refine) picks up exactly where the draft stopped instead of
   * sampling the shot again. `request` is the draft's own video payload —
   * the refine pass must condition on the same prompt, frame, guides and
   * voice take, and jobs.json is capped, so the sidecar keeps it. */
  draftLatents: z
    .object({
      /** dataRoot-relative .latent files (video and audio halves of the AV latent) */
      video: z.string(),
      audio: z.string(),
      /** the base pass's geometry — the refine pass refuses a mismatch */
      width: z.number(),
      height: z.number(),
      frames: z.number(),
      fps: z.number(),
      request: z.record(z.string(), z.unknown()),
    })
    .optional(),
  /** which finishing pass made this take (finish.mode); `source` names the
   * take it was finished from */
  finish: z.enum(["refine", "upscale"]).optional(),
  /** a still that came in through the project inbox (`origin: "inbox"`):
   * which tool made it, as far as its name and metadata tell. Its `prompt`
   * is the one the tool embedded, when it embedded one. */
  importedFrom: z.enum(["midjourney", "gpt", "krea", "local", "other"]).optional(),
});
export type AssetMeta = z.infer<typeof assetMetaSchema>;

/** One real file inside a project's assets/ tree, as scanned by studiod. */
export const libraryAssetSchema = z.object({
  /** stable identity — the dataRoot-relative path */
  id: z.string(),
  kind: libraryKindSchema,
  name: z.string(),
  project: z.string(),
  projectName: z.string(),
  /** posix-style path relative to storage.dataRoot */
  relPath: z.string(),
  /** studiod media route ("/media/<escaped relPath>") — client adds host + token */
  url: z.string(),
  sizeBytes: z.number(),
  createdAt: z.string(),
  /** lowercase extension without the dot */
  ext: z.string(),
  meta: assetMetaSchema.optional(),
});
export type LibraryAsset = z.infer<typeof libraryAssetSchema>;

/** Delete files from disk for good. Paths are dataRoot-relative (a
 * LibraryAsset.relPath, or a staged ref from labs.image.addRef); the core
 * confines them to <dataRoot>/projects/ before unlinking. Batched because the
 * grid deletes a whole selection in one gesture. */
export const libraryRemoveSchema = z.object({
  relPaths: z.array(z.string().min(1)).min(1).max(500),
});
export type LibraryRemove = z.input<typeof libraryRemoveSchema>;

/* ---------- production (Studio data spine) ---------- */
/* The V2 Studio hierarchy — Production → Season → Episode → Scene → Shot —
 * persisted whole as <dataRoot>/projects/<id>/production.json (project =
 * production; the folder-is-the-database rule applies unchanged). A Shot is
 * the atomic production unit and already carries the slots later S-P1/S-P2
 * steps fill in: script lines (writers room), camera spec + keyframes
 * (storyboard), video/VO takes + lipsync (shot generation). */

export const shotStatusSchema = z.enum([
  "draft",
  "boarded",
  "generated",
  "synced",
  "approved",
]);
export type ShotStatus = z.infer<typeof shotStatusSchema>;

export const scriptLineSchema = z.object({
  id: z.string(),
  /** bible character id; null = action/stage direction line */
  character: z.string().nullable().default(null),
  text: z.string().default(""),
  /** per-line VO direction ("more sarcastic") */
  deliveryNotes: z.string().default(""),
});
export type ScriptLine = z.infer<typeof scriptLineSchema>;

export const shotKeyframeSchema = z.object({
  id: z.string(),
  /** library relPath of the still */
  asset: z.string(),
  approved: z.boolean().default(false),
});
export type ShotKeyframe = z.infer<typeof shotKeyframeSchema>;

/** Hard take verification (P3.1, 2026-09-02). Measured at delivery, before
 * the take is judged: a take with no decodable video, digital silence under
 * placed lines, or a length off by more than 15% is BROKEN — it shows red and
 * approve_shot refuses it without `force`. Both session-eating failures of
 * the pilot were silent versions of these. */
export const takeVerifySchema = z.object({
  status: z.enum(["pending", "ok", "broken"]),
  /** one line per failing check, in plain words — the badge's title */
  reasons: z.array(z.string()).default([]),
  checkedAt: z.string().optional(),
  measuredDurationSec: z.number().nullable().optional(),
  meanDb: z.number().nullable().optional(),
  /** library relPath of the room-tone bed laid under a silent take (P3.2) */
  roomTone: z.string().optional(),
});
export type TakeVerify = z.infer<typeof takeVerifySchema>;

export const shotTakeSchema = z.object({
  id: z.string(),
  /** library relPath of the rendered clip */
  asset: z.string(),
  /** delivery-time hard verification; absent on takes from before P3 */
  verify: takeVerifySchema.optional(),
  /** engine that produced it ("ltx2", "seedance", "chatterbox") */
  engine: z.string().default(""),
  label: z.string().default(""),
  /** the script line this take speaks (voTakes from a table read carry it, so
   * the scene strip can pair each line with its newest recording) */
  lineId: z.string().optional(),
  /** the length the render was ASKED for, in seconds. qc.shot compares the
   * take against this rather than against a recomposed default, which warned
   * on every correct take of the pilot (defect #7, 2026-09-02) */
  durationSec: z.number().positive().optional(),
  /** a PREVIEW (P5): the 2s/480p blocking pass, not a deliverable. Never
   * lands on the sequence and does not make the shot "rendered"; approving
   * one only carries its seed into the real render. */
  preview: z.boolean().optional(),
  /** the seed the render ran at, when the router assigned one up front —
   * what a preview hands to the render that follows it */
  seed: z.number().int().optional(),
});
export type ShotTake = z.infer<typeof shotTakeSchema>;

export const shotSchema = z.object({
  id: z.string(),
  title: z.string().default(""),
  scriptLines: z.array(scriptLineSchema).default([]),
  /** bible character ids present in the shot */
  characters: z.array(z.string()).default([]),
  /** bible location id */
  location: z.string().nullable().default(null),
  camera: cameraSpecSchema.default({}),
  keyframes: z.array(shotKeyframeSchema).default([]),
  selectedKeyframe: z.string().nullable().default(null),
  videoTakes: z.array(shotTakeSchema).default([]),
  voTakes: z.array(shotTakeSchema).default([]),
  selectedTake: z.string().nullable().default(null),
  /** library relPath of the lip-synced result (S-P2) */
  lipsync: z.string().nullable().default(null),
  status: shotStatusSchema.default("draft"),
  notes: z.string().default(""),
  /** direction that accumulates take over take ("tighter framing", "let the
   * pause land") — appended by Retake-with-note, ridden by the next render's
   * prompt/spec so notes live on the shot instead of in someone's head */
  takeNotes: z.array(z.string()).default([]),
  /** the preview the human approved (P5): its seed is carried into the next
   * full render of this shot, so what was blocked at 2s is what gets shot.
   * Cleared by a later preview approval; never touches the sequence. */
  approvedPreview: z
    .object({ takeId: z.string(), seed: z.number().int(), approvedAt: z.string().optional() })
    .nullable()
    .default(null),
});
export type Shot = z.infer<typeof shotSchema>;

/** The pipeline stage a shot is actually at — derived from what is on the
 * shot rather than persisted, so it can never disagree with the data (the one
 * human verdict, "approved", stays on `status`). The furthest milestone wins:
 * a shot boarded before its lines are voiced still reads "boarded". This is
 * the field every dashboard, crew agent and batch query keys on. */
export type ShotStage = "script" | "voiced" | "boarded" | "rendered" | "approved";
export function shotStage(shot: Shot): ShotStage {
  if (shot.status === "approved") return "approved";
  // a preview (P5) is a blocking pass, not a render — the column must not move
  if (shot.videoTakes.some((t) => !t.preview)) return "rendered";
  if (shot.keyframes.length > 0) return "boarded";
  if (shot.voTakes.length > 0) return "voiced";
  return "script";
}

export const sceneSchema = z.object({
  id: z.string(),
  /** screenplay slugline ("INT. THE LOFT — NIGHT") */
  slugline: z.string(),
  summary: z.string().default(""),
  /** bible location id */
  location: z.string().nullable().default(null),
  shots: z.array(shotSchema).default([]),
});
export type Scene = z.infer<typeof sceneSchema>;

export const episodeSchema = z.object({
  id: z.string(),
  number: z.number().int().min(1),
  title: z.string(),
  logline: z.string().default(""),
  synopsis: z.string().default(""),
  scenes: z.array(sceneSchema).default([]),
});
export type Episode = z.infer<typeof episodeSchema>;

export const seasonSchema = z.object({
  id: z.string(),
  number: z.number().int().min(1),
  title: z.string().default(""),
  episodes: z.array(episodeSchema).default([]),
});
export type Season = z.infer<typeof seasonSchema>;

/** The whole show for one project — <dataRoot>/projects/<id>/production.json */
export const productionSchema = z.object({
  version: z.literal(1).default(1),
  title: z.string(),
  logline: z.string().default(""),
  /** "series" | "film" | free-form — display only for now */
  format: z.string().default("series"),
  seasons: z.array(seasonSchema).default([]),
  updatedAt: z.string().default(""),
});
export type Production = z.infer<typeof productionSchema>;

export const productionGetSchema = z.object({ project: z.string().min(1) });

export const productionUpdateSchema = z.object({
  project: z.string().min(1),
  production: productionSchema,
});

export const productionAddEpisodeSchema = z.object({
  project: z.string().min(1),
  /** season to add to (created if missing); defaults to 1 */
  seasonNumber: z.number().int().min(1).default(1),
  title: z.string().trim().min(1),
  logline: z.string().default(""),
});
export type ProductionAddEpisode = z.input<typeof productionAddEpisodeSchema>;

export const productionAddSceneSchema = z.object({
  project: z.string().min(1),
  episodeId: z.string().min(1),
  slugline: z.string().trim().min(1),
  summary: z.string().default(""),
  location: z.string().nullable().default(null),
});
export type ProductionAddScene = z.input<typeof productionAddSceneSchema>;

export const productionAddShotSchema = z.object({
  project: z.string().min(1),
  sceneId: z.string().min(1),
  title: z.string().default(""),
  scriptLines: z.array(scriptLineSchema).default([]),
  characters: z.array(z.string()).default([]),
  location: z.string().nullable().default(null),
  camera: cameraSpecSchema.default({}),
});
export type ProductionAddShot = z.input<typeof productionAddShotSchema>;

export const episodePatchSchema = episodeSchema
  .omit({ id: true, number: true, scenes: true })
  .partial();
export const productionUpdateEpisodeSchema = z.object({
  project: z.string().min(1),
  episodeId: z.string().min(1),
  patch: episodePatchSchema,
});

export const scenePatchSchema = sceneSchema.omit({ id: true, shots: true }).partial();
export const productionUpdateSceneSchema = z.object({
  project: z.string().min(1),
  sceneId: z.string().min(1),
  patch: scenePatchSchema,
});

export const shotPatchSchema = shotSchema.omit({ id: true }).partial();
export const productionUpdateShotSchema = z.object({
  project: z.string().min(1),
  shotId: z.string().min(1),
  patch: shotPatchSchema,
});

export const productionRemoveNodeSchema = z.object({
  project: z.string().min(1),
  id: z.string().min(1),
});

/** storyboard: enqueue keyframe generation for one shot. Prompt defaults to
 * the composed shot prompt (composeKeyframePrompt) — pass one to override. */
export const storyboardGenerateSchema = z.object({
  project: z.string().min(1),
  shotId: z.string().min(1),
  prompt: z.string().optional(),
  aspect: imageAspectSchema.default("16:9"),
  seed: z.number().int().optional(),
  /** takes per run — each lands as its own keyframe on the shot */
  count: z.number().int().min(1).max(4).default(1),
});
export type StoryboardGenerate = z.input<typeof storyboardGenerateSchema>;

/** Table read: voice a whole scene in one call. Walks the scene's dialogue
 * lines in script order and enqueues one TTS job per line in that character's
 * cast voice; each finished wav attaches to the owning shot's voTakes tagged
 * with its lineId (ttsPayloadSchema.board). Lines whose character has no cast
 * voice are reported back as skipped, never guessed at. */
export const tableReadSchema = z.object({
  project: z.string().min(1),
  sceneId: z.string().min(1),
  /** retakes: voice only these line ids; empty = every dialogue line */
  lineIds: z.array(z.string()).default([]),
});
export type TableRead = z.input<typeof tableReadSchema>;

/* ---------- storyboard → Shot Director ----------
 * Composing a boarded shot into a Director timeline (composeShotSpec) needs
 * two facts the production documents don't hold: how long each voice take runs,
 * and whether this machine can render cast references. studiod supplies both,
 * so callers only say which shot — and, optionally, which takes speak which
 * lines and where they land. */

export const shotTakeInputSchema = z.object({
  /** library relPath of a voice take (list_assets / generate_speech output) */
  take: z.string().min(1),
  /** bible character id whose line it is; null = fall on the next open line */
  character: z.string().nullable().default(null),
  /** the script line it was recorded for — binds exactly, beating `character` */
  lineId: z.string().nullable().optional(),
  /** exact placement; omitted = laid out in script order after the lead-in */
  atSec: z.number().min(0).optional(),
});

export const shotComposeSchema = z.object({
  project: z.string().min(1),
  shotId: z.string().min(1),
  /** omitted = long enough to hold the placed takes */
  durationSec: z.number().min(1).max(30).optional(),
  /** the shot's own voTakes are used when this is empty */
  takes: z.array(shotTakeInputSchema).max(12).default([]),
  gapSec: z.number().min(0).max(10).optional(),
  leadInSec: z.number().min(0).max(10).optional(),
  /** override the anchor prompt (defaults to the shot's composed prompt) */
  prompt: z.string().optional(),
  /** force cast references on/off; omitted = on when the engine supports them */
  refs: z.boolean().optional(),
  /** a render lane (promptlib video preset) — supplies engine, canvas, tier,
   * enhancer state, camera ids and the composer rules in one id */
  preset: z.string().optional(),
  /** override the lane's engine (or the "ltx2" default). "minimax-h3" composes
   * the block prompt instead of a Director timeline — the engines don't share
   * a control surface. */
  engine: z.string().optional(),
  /** compose the beats as ONE cutting prose paragraph (LTX 2.5 multi-shot).
   * Omitted = whatever the lane says. */
  multiShot: z.boolean().optional(),
});
export type ShotCompose = z.input<typeof shotComposeSchema>;

/** compose + enqueue, in one call */
export const shotRenderSchema = shotComposeSchema.extend({
  /** Override the canvas. OPTIONAL and deliberately without a default: this
   * used to default to "896 × 704 (landscape)", which meant every caller who
   * simply didn't mention resolution stamped landscape over the lane's own
   * canvas — a 9:16 Field Note lane could never survive the render path it
   * was composed for (pilot defect #3, 2026-09-02). Omitted = whatever the
   * lane and composer chose. */
  resolution: z.string().optional(),
  seed: z.number().int().optional(),
  /** P5: render the PREVIEW of this shot instead of the shot — the lane's
   * composition at 2s (4s on H3, its floor), a 480p-class canvas inside the
   * 1MP draft guard, draft tier, enhancer off. Under a minute on 2.5, so a
   * board drift is caught before a four-minute render. The seed is assigned
   * up front and recorded on the take; approving the preview carries it. */
  preview: z.boolean().default(false),
});
export type ShotRender = z.input<typeof shotRenderSchema>;

/* ---------- Production Desk verdicts (P1) ----------
 * The two calls the review drawer makes. Approve locks one rendered take as
 * the shot's pick, marks the shot approved, and drops the take on the
 * sequence's video track. Retake records a direction note on the shot
 * (takeNotes) and re-renders it — composeShotSpec folds every note into the
 * prompt, so direction accumulates on the shot instead of in a session. */

export const productionApproveShotSchema = z.object({
  project: z.string().min(1),
  shotId: z.string().min(1),
  /** videoTake to lock; omitted = the shot's selected take, else its newest */
  takeId: z.string().optional(),
  /** approve a take that failed hard verification anyway (P3.1) */
  force: z.boolean().default(false),
});
export type ProductionApproveShot = z.input<typeof productionApproveShotSchema>;

/** Re-run hard verification on a take (P3.1) — e.g. one from before delivery
 * verification existed, or after a room-tone bed was seeded. */
export const productionVerifyTakeSchema = z.object({
  project: z.string().min(1),
  shotId: z.string().min(1),
  /** omitted = the shot's selected take, else its newest */
  takeId: z.string().optional(),
});
export type ProductionVerifyTake = z.input<typeof productionVerifyTakeSchema>;

/** Project hygiene (P4): the explicit override of the two automatic rules
 * that only fire once — the canvas is adopted from the FIRST clip on an
 * empty sequence, and the base track is re-laid in script order on the NEXT
 * approval. `zoo-logic` was still 1280×720 with FN15-4 ahead of FN15-3 after
 * the pilot. This adopts a lane's canvas (or the takes' own), re-lays the base
 * track in production order, and re-exports at the delivery loudness. */
export const productionNormalizeSchema = z.object({
  project: z.string().min(1),
  /** render lane whose canvas to adopt; omitted = the canvas the approved
   * takes were actually rendered at (majority by probe) */
  lane: z.string().optional(),
  /** print the diff, change nothing */
  dryRun: z.boolean().default(false),
  /** enqueue the export after the re-lay (never on a dry run) */
  export: z.boolean().default(true),
  /** integrated loudness for that export; null ships it un-normalised */
  loudnessLufs: z.number().min(-40).max(-6).nullable().default(-16),
});
export type ProductionNormalize = z.input<typeof productionNormalizeSchema>;

/** Room-tone bed for a location (P3.2): either point at an existing library
 * audio file (`source`), or seed one from ACE-Step — the finished track lands
 * on the location when the job completes. */
export const bibleSeedRoomToneSchema = z.object({
  project: z.string().min(1),
  locationId: z.string().min(1),
  /** library relPath of a loopable bed to use as-is; null clears the bed */
  source: z.string().nullable().optional(),
  /** ACE-Step seed length when generating (loops under longer takes) */
  durationSec: z.number().int().min(10).max(120).default(30),
});
export type BibleSeedRoomTone = z.input<typeof bibleSeedRoomToneSchema>;

export const productionRetakeShotSchema = shotRenderSchema
  .extend({
    /** what to fix this time — kept on the shot, ridden by every later render.
     * Written as an INSTRUCTION: it lands in the prompt verbatim, so a note
     * that describes the failure injects the failure (pilot defect #8). The
     * router lints it; `allowDiagnosis` waves a false positive through. */
    note: z.string().trim().default(""),
    /** fixes with a measured phrasing each — see FIX_VOCABULARY */
    fix: z
      .array(z.enum(["hold-framing", "stay-seated", "hold-set", "tighter", "looser", "slower", "static"]))
      .default([]),
    allowDiagnosis: z.boolean().default(false),
  });
// (note or fix must be present — enforced by the router, because a refine
// here would turn the schema into a ZodEffects the tool registry can't .omit)
export type ProductionRetakeShot = z.input<typeof productionRetakeShotSchema>;

/* ---------- QC (P2) ----------
 * Automated checks so crew agents can judge their own output instead of
 * asking a human to watch every take. Measurement, not taste: cut count vs
 * the composed intent, audio integrity, articulation during speech windows,
 * plus review artifacts (contact sheet, cut-straddling frames) for the vision
 * checks only eyes can do. */

export const qcShotSchema = z.object({
  project: z.string().min(1),
  shotId: z.string().min(1),
  /** videoTake to check; omitted = the shot's selected take, else its newest */
  takeId: z.string().optional(),
});
export type QcShot = z.input<typeof qcShotSchema>;

export const qcSceneVoicesSchema = z.object({
  project: z.string().min(1),
  sceneId: z.string().min(1),
});
export type QcSceneVoices = z.input<typeof qcSceneVoicesSchema>;

/** studio.onUpdate payload — which document changed for which project, so
 * open screens can converge on Director/MCP edits without polling */
export const studioUpdateEventSchema = z.object({
  project: z.string(),
  doc: z.enum(["production", "bible"]),
});
export type StudioUpdateEvent = z.infer<typeof studioUpdateEventSchema>;

/* ---------- bible (persistent cast & world memory) ---------- */
/* What makes episode 12 look and sound like episode 1 — persisted as
 * <dataRoot>/projects/<id>/bible.json. Reference images are library relPaths
 * (copied into the project's assets tree, so /media serves them and the
 * scanner sees them); voices bind to the voice-lab roster by id. */

export const bibleVoiceSchema = z.object({
  /** voice-lab roster id (cloned ref clip); null = not cast yet */
  voiceId: z.string().nullable().default(null),
  engine: z.string().default("chatterbox"),
  /** Chatterbox expressiveness knob per character (bake-off tuning) */
  exaggeration: z.number().min(0).max(1).default(0.5),
  cfgWeight: z.number().min(0).max(1).default(0.4),
  deliveryNotes: z.string().default(""),
});
export type BibleVoice = z.infer<typeof bibleVoiceSchema>;

export const bibleRefsSchema = z.object({
  /** all library relPaths */
  /** the designated storyboard reference — what qwen-edit gets as the subject
   * image when boarding a shot with this character (GPT hero frame ideally) */
  keyframeRef: z.string().nullable().default(null),
  turnaround: z.string().nullable().default(null),
  hero: z.string().nullable().default(null),
  /** composite contact sheet from the char-sheet pipeline */
  sheet: z.string().nullable().default(null),
  /** single-view frames (S1 front … S9 anchor) */
  frames: z.array(z.string()).default([]),
  /** LoRA training set */
  dataset: z.array(z.string()).default([]),
  custom: z.array(z.string()).default([]),
});
export type BibleRefs = z.infer<typeof bibleRefsSchema>;

export const bibleCharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
  species: z.string().default(""),
  /** the character's job in the story ("Lead", "Antagonist", "Comic engine") —
   * the orienting line under the name in the Bible cast rail */
  role: z.string().default(""),
  /** structured appearance slots (character-sheets-v2 fill values) */
  build: z.string().default(""),
  face: z.string().default(""),
  wardrobe: z.string().default(""),
  props: z.string().default(""),
  colors: z.string().default(""),
  signatureFeature: z.string().default(""),
  /** identity-anchor macros — the scars/marks that lock identity across shots */
  anchors: z
    .object({
      body: z.string().default(""),
      face: z.string().default(""),
      macro: z.string().default(""),
    })
    .default({}),
  personality: z.string().default(""),
  speechPattern: z.string().default(""),
  /** canonical image-gen seed from the char spec */
  seed: z.number().int().optional(),
  voice: bibleVoiceSchema.default({}),
  refs: bibleRefsSchema.default({}),
  /** trained character LoRA (S-P2) — null until trained/imported */
  lora: z
    .object({ asset: z.string().default(""), trigger: z.string().default("") })
    .nullable()
    .default(null),
});
export type BibleCharacter = z.infer<typeof bibleCharacterSchema>;

export const bibleLocationSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(""),
  /** paste-in prompt block for keyframe generation */
  stylePrompt: z.string().default(""),
  /** library relPaths of reference stills */
  refs: z.array(z.string()).default([]),
  /** library relPath of a loopable room-tone bed (P3.2). Laid at −40 dB under
   * a take that came back digitally silent with no placed lines — LTX 2.5's
   * habit on no-dialogue shots. Seeded from ACE-Step or a stock file. */
  roomTone: z.string().nullable().default(null),
});
export type BibleLocation = z.infer<typeof bibleLocationSchema>;

export const bibleStyleSchema = z.object({
  artDirection: z.string().default(""),
  negativePrompt: z.string().default(""),
  cinematographyNotes: z.string().default(""),
  notes: z.string().default(""),
  /** The project's LOOK in one line — the sentence every render ends with, so
   * a shot boarded in July and a shot boarded in September grade the same.
   * Empty = derived from artDirection (see `projectLook`), which is what every
   * project has today; setting it is how a project says the look is narrower
   * than its whole art direction. Appended ONCE, by the composer, never by an
   * adapter — the same no-stacking rule the art direction already lives under. */
  lookLine: z.string().default(""),
  /** Room-tone fallback (P3.2): "auto" lays the location's bed under a take
   * delivered digitally silent with no placed lines; "off" leaves it silent
   * (and the silence-25 rule's warning stands). */
  roomTone: z.enum(["auto", "off"]).default("auto"),
});
export type BibleStyle = z.infer<typeof bibleStyleSchema>;

/* ---------- cinematography bank (doc 26 as structured data) ---------- */
/* The director's language — shot sizes, camera moves, lighting banks,
 * composition — imported into the bible so shot specs can reference entries
 * by id ("ws", "sitcom.warm-home") and prompts expand to the full paste-in
 * clause. Camera-spec fields stay strings: a value that matches an entry id
 * or name resolves to its clause; anything else passes through as free text. */

export const cineClauseSchema = z.object({
  /** short stable slug referenced from camera specs ("ws", "push-in") */
  id: z.string(),
  name: z.string(),
  /** the paste-in prompt clause this entry expands to */
  clause: z.string().default(""),
  /** when/why to use it — shown in pickers and fed to the director agent */
  use: z.string().default(""),
});
export type CineClause = z.infer<typeof cineClauseSchema>;

export const cineLightingBankSchema = z.object({
  /** bank slug — entries resolve as "<bank>.<entry>" ("concert.follow-spot") */
  id: z.string(),
  name: z.string(),
  use: z.string().default(""),
  entries: z.array(cineClauseSchema).default([]),
});
export type CineLightingBank = z.infer<typeof cineLightingBankSchema>;

/** Per-dancer signature camera — "the camera dances their style too". */
export const cineDanceSignatureSchema = z.object({
  /** bible character name (matched case-insensitively; ids differ per seed) */
  character: z.string(),
  danceStyle: z.string().default(""),
  camera: z.string().default(""),
  clause: z.string().default(""),
});
export type CineDanceSignature = z.infer<typeof cineDanceSignatureSchema>;

/** Master prompt formulas (doc 26 §10.1) — S-P2 shot generation consumes
 * ltxCoverage/transitionMorph/seedanceHero; keyframe documents the still side. */
export const cineTemplatesSchema = z.object({
  keyframe: z.string().default(""),
  ltxCoverage: z.string().default(""),
  transitionMorph: z.string().default(""),
  seedanceHero: z.string().default(""),
});
export type CineTemplates = z.infer<typeof cineTemplatesSchema>;

export const bibleCinematographySchema = z.object({
  shotSizes: z.array(cineClauseSchema).default([]),
  angles: z.array(cineClauseSchema).default([]),
  moves: z.array(cineClauseSchema).default([]),
  lenses: z.array(cineClauseSchema).default([]),
  compositions: z.array(cineClauseSchema).default([]),
  lighting: z.array(cineLightingBankSchema).default([]),
  danceSignatures: z.array(cineDanceSignatureSchema).default([]),
  /** full-crew dance shots (overhead kaleidoscope, formation wide, finale crane) */
  formations: z.array(cineClauseSchema).default([]),
  templates: cineTemplatesSchema.default({}),
  /** grammar digest for the director agent (one move per clip, i2v agrees
   * with the still, dance never tighter than WS, …) */
  rules: z.string().default(""),
  negativePrompt: z.string().default(""),
});
export type BibleCinematography = z.infer<typeof bibleCinematographySchema>;

export const bibleSchema = z.object({
  version: z.literal(1).default(1),
  characters: z.array(bibleCharacterSchema).default([]),
  locations: z.array(bibleLocationSchema).default([]),
  style: bibleStyleSchema.default({}),
  cinematography: bibleCinematographySchema.default({}),
  updatedAt: z.string().default(""),
});
export type Bible = z.infer<typeof bibleSchema>;

export const bibleGetSchema = z.object({ project: z.string().min(1) });

export const bibleUpdateSchema = z.object({
  project: z.string().min(1),
  bible: bibleSchema,
});

export const bibleUpsertCharacterSchema = z.object({
  project: z.string().min(1),
  character: bibleCharacterSchema,
});
export type BibleUpsertCharacter = z.input<typeof bibleUpsertCharacterSchema>;

export const bibleRemoveCharacterSchema = z.object({
  project: z.string().min(1),
  id: z.string().min(1),
});

export const bibleUpsertLocationSchema = z.object({
  project: z.string().min(1),
  location: bibleLocationSchema,
});
export type BibleUpsertLocation = z.input<typeof bibleUpsertLocationSchema>;

export const bibleRemoveLocationSchema = z.object({
  project: z.string().min(1),
  id: z.string().min(1),
});

export const bibleUpdateStyleSchema = z.object({
  project: z.string().min(1),
  style: bibleStyleSchema,
});

/** Import/replace the cinematography bank (empty = curated doc-26 bank). */
export const bibleImportCinematographySchema = z.object({
  project: z.string().min(1),
  cinematography: bibleCinematographySchema.optional(),
});
export type BibleImportCinematography = z.input<typeof bibleImportCinematographySchema>;

/** Seed the Animal Sitcom bible from the videofast repo (paths.videofastDir):
 * six structured characters, reference images + voice ref clips copied in. */
export const studioSeedSchema = z.object({
  project: z.string().min(1),
  /** replace existing characters/locations with the seed versions */
  overwrite: z.boolean().default(false),
});
export type StudioSeed = z.input<typeof studioSeedSchema>;

export const studioSeedResultSchema = z.object({
  bible: bibleSchema,
  production: productionSchema,
  copiedFiles: z.number(),
  warnings: z.array(z.string()),
});
export type StudioSeedResult = z.infer<typeof studioSeedResultSchema>;

/* ---------- director chat ---------- */

/** A library asset the user pinned to a message. relPath is the id the studio
 * tools understand (generate_video startFrame/audio take it directly); images
 * are additionally shown to the Director as real image content. */
export const directorAttachmentSchema = z.object({
  kind: libraryKindSchema,
  name: z.string(),
  /** posix-style path relative to storage.dataRoot — the library asset id */
  relPath: z.string(),
});
export type DirectorAttachment = z.infer<typeof directorAttachmentSchema>;

/** One tool call the Director made mid-conversation, rendered as a card. */
export const directorToolCallSchema = z.object({
  /** tool name without the mcp__aurea__ prefix (e.g. "generate_image") */
  name: z.string(),
  /** compact one-line rendering of the tool input */
  summary: z.string(),
  /** scalar tool-input fields, rendered as the card's parameter table */
  params: z.record(z.string(), z.string()).optional(),
  status: z.enum(["running", "done", "error"]),
  /** set when the tool enqueued a job — the UI attaches live progress from the jobs stream */
  jobId: z.string().optional(),
});
export type DirectorToolCall = z.infer<typeof directorToolCallSchema>;

export const directorMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "director"]),
  /** ISO timestamp */
  at: z.string(),
  text: z.string().optional(),
  /** assets the user pinned to this message (user role only) */
  attachments: z.array(directorAttachmentSchema).optional(),
  tool: directorToolCallSchema.optional(),
  /** transient — this text is still arriving token by token; never true on disk */
  streaming: z.boolean().optional(),
});
export type DirectorMessage = z.infer<typeof directorMessageSchema>;

/** The production node a thread works on. null bind = the project-wide Studio
 * thread. Only episodes bind for now; the shape leaves room for scene/shot. */
export const directorThreadBindSchema = z.object({
  kind: z.literal("episode"),
  episodeId: z.string(),
});
export type DirectorThreadBind = z.infer<typeof directorThreadBindSchema>;

/** One Director conversation. A thread owns its own Claude Code session, so a
 * new thread is a genuinely fresh context window — that is the whole point. */
export const directorThreadSchema = z.object({
  id: z.string(),
  title: z.string(),
  bind: directorThreadBindSchema.nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** closed threads are read-only and collapse into their own group; the chat
   * file survives — closing is never a delete */
  closed: z.boolean().default(false),
  /** handoff written on close (D5); seeds the preamble of the next thread on
   * the same node, which is why it lives here and not on the episode */
  summary: z.string().default(""),
});
export type DirectorThread = z.infer<typeof directorThreadSchema>;

/** On-disk index — <dataRoot>/projects/<id>/director/index.json */
export const directorThreadIndexSchema = z.object({
  version: z.literal(1).default(1),
  threads: z.array(directorThreadSchema).default([]),
  activeId: z.string().nullable().default(null),
});
export type DirectorThreadIndex = z.infer<typeof directorThreadIndexSchema>;

/** what the thread switcher renders */
export const directorThreadsSchema = z.object({
  project: z.string(),
  threads: z.array(directorThreadSchema),
  activeId: z.string(),
  /** the thread currently holding the project's run lock, if any — the
   * switcher marks it so a background run is visible from another thread */
  runningId: z.string().nullable(),
});
export type DirectorThreads = z.infer<typeof directorThreadsSchema>;

/** One chat thread, as streamed to the renderer. */
export const directorStateSchema = z.object({
  project: z.string(),
  threadId: z.string(),
  /** thinking = a Claude run is in flight ON THIS THREAD; the composer disables
   * itself. A run on a sibling thread leaves this idle — the lock is reported
   * separately as directorThreads.runningId */
  status: z.enum(["idle", "thinking"]),
  messages: z.array(directorMessageSchema),
});
export type DirectorState = z.infer<typeof directorStateSchema>;

export const directorSendSchema = z.object({
  project: z.string().min(1),
  threadId: z.string().min(1),
  text: z.string().trim().min(1),
  attachments: z.array(directorAttachmentSchema).max(8).default([]),
});

/** On-disk shape — <dataRoot>/projects/<id>/director/<threadId>.json
 * (pre-threads this was the project's single director.json, which the loader
 * still migrates from) */
export const directorChatFileSchema = z.object({
  /** Claude Code session id for resume-based conversation continuity */
  sessionId: z.string().nullable().default(null),
  messages: z.array(directorMessageSchema).default([]),
});
export type DirectorChatFile = z.infer<typeof directorChatFileSchema>;

/* ---------- model manager ---------- */

/** which lab a model powers ("utility" = pipeline stages like upscaling) */
export const modelUseSchema = z.enum(["image", "video", "voice", "music", "utility"]);
export type ModelUse = z.infer<typeof modelUseSchema>;

/** One file of a model, downloaded to <dataRoot>/models/<modelId>/<name>. */
export const modelFileSchema = z.object({
  /** path relative to the model's folder */
  name: z.string(),
  url: z.string(),
  sizeBytes: z.number(),
  /** hex sha256 of the complete file (from the publisher's LFS metadata);
   * null for tiny non-LFS files — those install unverified */
  sha256: z.string().nullable(),
  /** the engine rewrites this file in place after install (e.g. ACE-Step
   * syncs its remote-code .py files into the checkpoint dir) — installed
   * means it exists, not that it still matches size/sha */
  mutable: z.boolean().optional(),
});
export type ModelFile = z.infer<typeof modelFileSchema>;

export const modelLicenseSchema = z.object({
  name: z.string(),
  url: z.string(),
  /** true = the user must explicitly accept before the download can start */
  gated: z.boolean(),
});

/** Registry entry — the curated catalog studiod ships with. */
export const modelInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  use: modelUseSchema,
  /** which engine consumes it (display only) */
  engine: z.string(),
  description: z.string(),
  /** sum of files[].sizeBytes, precomputed for display */
  sizeBytes: z.number(),
  files: z.array(modelFileSchema),
  license: modelLicenseSchema,
  /** the first-run wizard preselects these */
  essential: z.boolean(),
});
export type ModelInfo = z.infer<typeof modelInfoSchema>;

export const modelStateSchema = z.enum([
  "absent",
  "downloading",
  "verifying",
  "installed",
  /** satisfied by a file in one of storage.modelRoots — the user's own copy,
   * mounted read-only. Runs like "installed"; never verified, never deleted. */
  "linked",
  "error",
]);
export type ModelState = z.infer<typeof modelStateSchema>;

/** Live install status. "absent" with bytes > 0 = a paused/partial download
 * that the next download() call resumes where it stopped. */
export const modelStatusSchema = z.object({
  state: modelStateSchema,
  /** bytes on disk so far, across finished files and .part files */
  bytes: z.number(),
  progress: z.number().min(0).max(100),
  /** live transfer rate; null unless downloading */
  bytesPerSec: z.number().nullable(),
  /** file currently transferring (downloading/verifying) */
  file: z.string().nullable(),
  error: z.string().nullable(),
  licenseAccepted: z.boolean(),
  /** which of storage.modelRoots satisfied this model (state "linked") */
  linkedRoot: z.string().nullable().default(null),
});
export type ModelStatus = z.infer<typeof modelStatusSchema>;

export const modelEntrySchema = modelInfoSchema.extend({ status: modelStatusSchema });
export type ModelEntry = z.infer<typeof modelEntrySchema>;

export const modelDownloadSchema = z.object({
  id: z.string().min(1),
  /** records acceptance of a gated license before starting */
  acceptLicense: z.boolean().default(false),
});

/* ---------- engine runtime ---------- */

/** The managed pieces under <dataRoot>/runtime/: a portable CPython, a
 * headless ComfyUI checkout with its own venv, one venv per Python engine
 * ("chatterbox" and "acestep" so far), and pinned ComfyUI custom-node packs
 * ("gguf" = ComfyUI-GGUF quantized loaders). */
export const runtimeComponentIdSchema = z.enum([
  "python",
  "comfy",
  "gguf",
  "kjnodes",
  "director-nodes",
  // long-form MiniMax-H3 — chunked sampling with Gemma between chunks
  "endless-sampler",
  "chatterbox",
  "acestep",
  "seedvc",
]);
export type RuntimeComponentId = z.infer<typeof runtimeComponentIdSchema>;

export const runtimeComponentStateSchema = z.enum(["absent", "installing", "ready", "error"]);

export const runtimeComponentSchema = z.object({
  id: runtimeComponentIdSchema,
  name: z.string(),
  state: runtimeComponentStateSchema,
  /** pinned upstream version this studiod installs (display) */
  pinned: z.string(),
  /** installed version; null until ready */
  version: z.string().nullable(),
  /** 0–100 within this component's install */
  progress: z.number(),
  stage: z.string().nullable(),
  /** live sub-line under the stage (current package, bytes moved, …) */
  detail: z.string().nullable(),
  error: z.string().nullable(),
});
export type RuntimeComponent = z.infer<typeof runtimeComponentSchema>;

export const runtimeStatusSchema = z.object({
  /** every component ready — managed ComfyUI can be spawned */
  ready: z.boolean(),
  installing: z.boolean(),
  components: z.array(runtimeComponentSchema),
});
export type RuntimeStatus = z.infer<typeof runtimeStatusSchema>;

/* ---------- studiod discovery ---------- */

/** Contents of ~/.aurea/studiod.json — how shells and CLIs find a running core. */
export const portFileSchema = z.object({
  port: z.number().int(),
  token: z.string(),
  pid: z.number().int(),
});
export type PortFile = z.infer<typeof portFileSchema>;

/* ---------- prompt library ---------- */

/** what a preset contributes to a prompt — the builder colours chips by it
 * and the composer knows negatives go to the negative prompt, not the end
 * of the positive one */
export const promptCategorySchema = z.enum([
  "style",
  "subject",
  "lighting",
  "camera",
  "mood",
  "negative",
]);
export type PromptCategory = z.infer<typeof promptCategorySchema>;

/** One saved prompt fragment. `builtin` presets ship with Aurea (and reseed
 * if deleted wrongly — see PromptLibrary.seed); user presets are files the
 * same shape under <dataRoot>/promptlib/presets/. */
export const promptPresetSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(80),
  category: promptCategorySchema,
  /** the fragment itself — composed into the prompt verbatim */
  text: z.string().min(1).max(2000),
  tags: z.array(z.string()).default([]),
  /** present = only offered inside this project */
  projectId: z.string().optional(),
  builtin: z.boolean().default(false),
  createdAt: z.string(),
});
export type PromptPreset = z.infer<typeof promptPresetSchema>;

/** A themed set of presets — Zoo Logic's art direction, a lighting kit. The
 * per-project pack derived live from a bible has `fromBible: true` and no
 * file on disk. */
export const stylePackSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(80),
  description: z.string().default(""),
  projectId: z.string().optional(),
  fromBible: z.boolean().default(false),
  presets: z.array(promptPresetSchema).default([]),
  /** pack-level negative prompt, applied when the pack seeds a prompt */
  negative: z.string().optional(),
});
export type StylePack = z.infer<typeof stylePackSchema>;

/** A persisted deck — the Image lab's bulk prompt list, which used to be
 * ephemeral component state and vanished with the screen. */
export const promptDeckSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(80),
  prompts: z.array(z.string()).max(100).default([]),
  model: z.string().default("z-image"),
  updatedAt: z.string(),
});
export type PromptDeck = z.infer<typeof promptDeckSchema>;

export const promptPresetSaveSchema = promptPresetSchema
  .omit({ id: true, createdAt: true, builtin: true })
  .extend({ id: z.string().optional() });
export type PromptPresetSave = z.input<typeof promptPresetSaveSchema>;

export const promptDeckSaveSchema = promptDeckSchema
  .omit({ id: true, updatedAt: true })
  .extend({ id: z.string().optional() });
export type PromptDeckSave = z.input<typeof promptDeckSaveSchema>;

/* ---------- video presets (lanes) ----------
 *
 * The Image lab has had a prompt library for a month; the Video lab has had
 * nothing, so every Zoo Logic shot meant re-typing engine, size, length, tier,
 * enhancer state, lens and light by hand — per shot, from memory. A preset is
 * that memory written down, and a lane is the show's own name for it
 * (interview single, room coverage, B-roll insert, Field Note).
 *
 * A preset carries three separable things, because they are consumed at three
 * different moments: the PAYLOAD (what the adapter is handed), the CINE ids
 * (expanded to prose by the composer, never by an adapter), and the RULES
 * (what the composer must do — multi-shot prose, named beats). */

/** `look` is the bible-free lane: a look answers the same eight questions a
 * Zoo Logic lane does, but with aesthetics (stock, lens, light, palette)
 * instead of a show's production shape. Looks never carry a projectId. */
export const videoLaneSchema = z.enum(["interview", "coverage", "broll", "fieldnote", "look", "custom"]);
export type VideoLane = z.infer<typeof videoLaneSchema>;

/** the payload fields a preset may set. Everything omitted is per-shot: a
 * preset that carried a prompt or a start frame would be a shot, not a lane. */
export const videoPresetPayloadSchema = videoPayloadSchema
  .omit({
    type: true,
    prompt: true,
    startFrame: true,
    endFrame: true,
    keyframes: true,
    audio: true,
    seed: true,
    director: true,
    minimaxRefs: true,
    board: true,
    // a look's negative lives on the preset itself (`negative`), where the
    // rail can show it; style LoRAs ride in the payload like any other field
    negativePrompt: true,
  })
  .partial();
export type VideoPresetPayload = z.infer<typeof videoPresetPayloadSchema>;

export const videoPresetSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(60),
  description: z.string().default(""),
  lane: videoLaneSchema.default("custom"),
  /** present = only offered inside this project */
  projectId: z.string().optional(),
  builtin: z.boolean().default(false),
  payload: videoPresetPayloadSchema.default({}),
  /** cinematography-bank ids; expanded to clauses at compose time */
  cine: cameraSpecSchema.partial().default({}),
  /** a look line for this lane specifically; null = the project's own */
  look: z.string().nullable().default(null),
  /** look-level negative prompt (LTX only — H3 and Seedance have no negative
   * arm). Applied to the render as `payload.negativePrompt`; empty = the
   * engine's own default negative. */
  negative: z.string().default(""),
  /** a dataRoot-relative still that shows what the look does — the rail's
   * thumbnail. null = the chip is a word. */
  sample: z.string().nullable().default(null),
  /** what the scene sounds like (H3 only). The freeform composer writes it
   * as the H3 soundscape line so a look's clip never arrives with invented
   * sound. (LTX 2.5 is silent only when the prompt names no sound — a prompt
   * that names its ambience renders it, measured 2026-09-02.) */
  sound: z.string().default(""),
  /** this look's SKETCH tier — the payload overrides a seed spray renders at
   * (VIDEO-LAB-FREEFORM-PLAN.md §2.5). Never the deliverable, only for
   * picking a seed; null = the shipped default (`SKETCH_TIER`). */
  sketch: videoPresetPayloadSchema.nullable().optional(),
  rules: z
    .object({
      /** compose the beats as one cutting prose paragraph (LTX 2.5) */
      multiShot: z.boolean().default(false),
      /** dialogue beats name their speaker — the measured lip-sync wording */
      namedBeats: z.boolean().default(true),
      /** repeat the character and room descriptions verbatim in every shot */
      verbatimSubjects: z.boolean().default(false),
    })
    .default({}),
});
export type VideoPreset = z.infer<typeof videoPresetSchema>;

export const videoPresetSaveSchema = videoPresetSchema
  .omit({ id: true, builtin: true })
  .extend({ id: z.string().optional() });
export type VideoPresetSave = z.input<typeof videoPresetSaveSchema>;

/** prompts.enhance input — one-shot agent expansion of a prompt using the
 * project's art direction */
export const promptEnhanceSchema = z.object({
  prompt: z.string().min(1).max(4000),
  projectId: z.string().optional(),
  intent: z.enum(["image", "video"]).default("image"),
  /** video: the active look's prose — steers the expansion when there is no
   * project art direction (and sits beside it when there is) */
  look: z.string().max(2000).optional(),
  /** video: i2v keeps the expansion motion-only; t2v may describe the subject */
  mode: z.enum(["i2v", "t2v"]).optional(),
});
export type PromptEnhance = z.input<typeof promptEnhanceSchema>;

/* ---------- coverage pass: request + record ---------- */

/** canon.coverage input — the payload, plus the project it belongs to. */
export const coverageStartSchema = coveragePayloadSchema
  .omit({ type: true })
  .extend(projectField);
export type CoverageStart = z.input<typeof coverageStartSchema>;

/** What a run leaves behind at `<dataRoot>/coverage/<id>/run.json`.
 *
 * Written as it happens rather than derived on read, for the same reason the
 * A/B record is: job history is capped, so a sheet opened next month can no
 * longer ask the queue what it was. */
export const coverageRunSchema = z.object({
  id: z.string(),
  project: z.string(),
  createdAt: z.string(),
  /** dataRoot-relative plate the angles are of */
  source: z.string(),
  subject: z.string(),
  location: z.string().default(""),
  seed: z.number().int(),
  jobId: z.string(),
  status: jobStatusSchema,
  /** the eight angles, in orbit order; `asset` fills in on import */
  angles: z
    .array(
      z.object({
        id: z.string(),
        deg: z.number(),
        frame: z.number().int(),
        asset: z.string().optional(),
      }),
    )
    .default([]),
  /** dataRoot-relative 4x2 contact sheet */
  sheet: z.string().optional(),
  error: z.string().optional(),
});
export type CoverageRun = z.infer<typeof coverageRunSchema>;

export * from "./coverage.js";
export * from "./falImage.js";
export * from "./storyboard.js";
export * from "./cinematographyBank.js";
export * from "./refSheet.js";
export * from "./shotSpec.js";
export * from "./h3Prompt.js";
export * from "./multiShot.js";
export * from "./ia2v.js";
export * from "./craftRules.js";
export * from "./assembly.js";
export * from "./direction.js";
export * from "./preview.js";
export * from "./crewVerbs.js";
export * from "./freeform.js";
