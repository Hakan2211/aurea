/* PromptLibrary — the Image lab's persisted prompt system (Track B of the
 * 2026-08 upgrade). Folder-is-the-database, like everything else under
 * dataRoot:
 *
 *   <dataRoot>/promptlib/presets/<id>.json   one preset per file
 *   <dataRoot>/promptlib/packs/<id>.json     one style pack per file
 *   <dataRoot>/promptlib/decks/<id>.json     one saved deck per file
 *   <dataRoot>/promptlib/video-presets/<id>.json   one render lane per file
 *
 * Builtin presets and the shipped packs are seeded on first read and are
 * ordinary files afterwards — the user may edit or delete them, and a
 * deleted builtin stays deleted (a tombstone in .seeded.json remembers the
 * seed ran, so reseeding never resurrects an intentional delete).
 *
 * The per-project "from the bible" pack is NOT a file: it is derived live
 * from bible.style.artDirection every time packs() is called, so editing the
 * bible edits the pack. */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  promptDeckSchema,
  promptPresetSchema,
  stylePackSchema,
  type Bible,
  type PromptDeck,
  type PromptDeckSave,
  type PromptPreset,
  type PromptPresetSave,
  type StylePack,
  type VideoPreset,
  type VideoPresetSave,
  NO_TEXT_NEGATIVE,
  videoPresetSchema,
} from "@aurea/shared";
import type { SettingsStore } from "./settings.js";

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "preset";

/** The 7 strings that used to BE the whole preset system (labs.ts imageCatalog
 * `presets`), kept word-for-word so old jobs reproduce, plus the fragments a
 * one-word style could never carry. */
const BUILTIN_PRESETS: Array<Omit<PromptPreset, "id" | "createdAt" | "builtin">> = [
  // the legacy seven — their text is what the adapters have always appended
  { title: "Cinematic", category: "style", text: "cinematic style", tags: ["legacy"] },
  { title: "Photographic", category: "style", text: "photographic style", tags: ["legacy"] },
  { title: "Concept Art", category: "style", text: "concept art style", tags: ["legacy"] },
  { title: "Minimal", category: "style", text: "minimal style", tags: ["legacy"] },
  { title: "Moody", category: "style", text: "moody style", tags: ["legacy"] },
  { title: "Vintage", category: "style", text: "vintage style", tags: ["legacy"] },
  { title: "Fantasy", category: "style", text: "fantasy style", tags: ["legacy"] },
  // styles with an opinion
  {
    title: "Editorial photo",
    category: "style",
    text: "editorial magazine photography, medium format, natural color grading, crisp detail",
    tags: ["photo"],
  },
  {
    title: "Stylized 3D",
    category: "style",
    text: "stylized 3D animated render, Pixar-quality, soft subsurface scattering, appealing rounded shapes, physically-based materials",
    tags: ["3d", "character"],
  },
  {
    title: "Film still",
    category: "style",
    text: "film still, anamorphic lens, shallow depth of field, subtle film grain, cinematic color grade",
    tags: ["photo", "cinematic"],
  },
  // lighting
  {
    title: "Golden hour",
    category: "lighting",
    text: "golden hour sunlight, long soft shadows, warm rim light",
    tags: [],
  },
  {
    title: "Soft window light",
    category: "lighting",
    text: "soft window light from camera left, gentle falloff, no harsh shadows",
    tags: [],
  },
  {
    title: "Neon night",
    category: "lighting",
    text: "neon signage as the key light, wet reflective surfaces, deep teal shadows",
    tags: [],
  },
  {
    title: "Overcast diffuse",
    category: "lighting",
    text: "overcast daylight, big soft diffuse light, muted contrast, true-to-life color",
    tags: [],
  },
  // camera
  {
    title: "85mm portrait",
    category: "camera",
    text: "85mm lens, f/1.8, eye-level, subject fills the frame, creamy background blur",
    tags: [],
  },
  {
    title: "Wide establishing",
    category: "camera",
    text: "wide-angle establishing shot, deep focus, strong leading lines, room to breathe",
    tags: [],
  },
  {
    title: "Macro detail",
    category: "camera",
    text: "macro close-up, razor-thin focus plane, texture-forward",
    tags: [],
  },
  {
    title: "Low hero angle",
    category: "camera",
    text: "low angle looking up, subject towers, mild wide-angle drama",
    tags: [],
  },
  // mood
  {
    title: "Quiet morning",
    category: "mood",
    text: "calm, unhurried, morning stillness, gentle optimism",
    tags: [],
  },
  {
    title: "High energy",
    category: "mood",
    text: "kinetic, vivid, mid-action, caught motion with light blur",
    tags: [],
  },
  // the negative everything photoreal wants
  {
    title: "Clean render",
    category: "negative",
    text: "blurry, deformed, extra limbs, mutated hands, text, watermark, signature, low detail, jpeg artifacts",
    tags: ["legacy"],
  },
];

const SHIPPED_PACKS: Array<Omit<StylePack, "fromBible">> = [
  {
    id: "zoo-logic",
    title: "Zoo Logic",
    description:
      "The Zoo Logic house look — stylized-3D animal cast on grounded sets. Night scenes " +
      "shift hue, never just exposure.",
    presets: [
      {
        id: "zoo-logic-cast",
        title: "Zoo Logic cast",
        category: "style",
        text: "stylized 3D animated animal character, Pixar / Illumination quality, soft subsurface scattering, appealing rounded shapes, detailed fur and fabric, physically-based materials, cinematic 3D render",
        tags: ["character"],
        builtin: true,
        createdAt: "seed",
      },
      {
        id: "zoo-logic-set",
        title: "Zoo Logic set plate",
        category: "style",
        text: "empty environment plate matching a stylized-3D animated series, warm practical lighting, believable clutter, no characters, no text or signage",
        tags: ["set"],
        builtin: true,
        createdAt: "seed",
      },
      {
        id: "zoo-logic-night",
        title: "Zoo Logic night",
        category: "lighting",
        text: "night interior read as a HUE shift — cool blue-violet ambience with warm practical pools — not an exposure drop; detail stays readable everywhere",
        tags: ["set", "night"],
        builtin: true,
        createdAt: "seed",
      },
    ],
    negative:
      "blurry, deformed, extra limbs, off-model, different character, text, labels, watermark, " +
      "flat lighting, harsh shadows, low detail",
  },
  {
    id: "animal-sitcom",
    title: "Animal Sitcom",
    description:
      "The doc-23 locked look for the sitcom pipeline — Lane B stylized 3D, sitcom warm-home " +
      "lighting, keyframes that stay on-model.",
    presets: [
      {
        id: "animal-sitcom-hero",
        title: "Sitcom hero frame",
        category: "style",
        text: "stylized 3D animated character, Pixar / Illumination quality, soft subsurface scattering, appealing rounded shapes, detailed fur and fabric, physically-based materials, cinematic 3D render",
        tags: ["character"],
        builtin: true,
        createdAt: "seed",
      },
      {
        id: "animal-sitcom-warmhome",
        title: "Sitcom warm home",
        category: "lighting",
        text: "warm tungsten key with soft fill, lived-in home interior, gentle window daylight mixing in, inviting sitcom lighting",
        tags: ["set"],
        builtin: true,
        createdAt: "seed",
      },
      {
        id: "animal-sitcom-twoshot",
        title: "Sitcom two-shot",
        category: "camera",
        text: "eye-level medium two-shot, both characters fully in frame with headroom, 35mm, television staging",
        tags: [],
        builtin: true,
        createdAt: "seed",
      },
    ],
    negative:
      "blurry, deformed, extra limbs, extra fingers, mutated hands, fused fingers, inconsistent " +
      "design, different character, off-model, text, labels, watermark, signature, low detail, " +
      "duplicated face, flat lighting, harsh shadows, nsfw",
  },
];

/* ---------- shipped video lanes ----------
 *
 * The four shapes the Zoo Logic factory actually shoots (the crew skill's own
 * lanes), written down so a shot is one click from the right engine, canvas,
 * length, tier, enhancer state and camera. Numbers are the measured-safe ones,
 * not aspirations: H3 stays at 1344×768 · 4–6s · Draft (the shape that doesn't
 * starve the DiT), 2.5 interviews run with the Gemma enhancer OFF (it rewrites
 * away structure and drops lines), and coverage is the only lane that asks for
 * multi-shot prose. */
const SHIPPED_VIDEO_PRESETS: VideoPreset[] = [
  {
    id: "zoo-interview-single",
    label: "Interview single",
    description:
      "The documentary spine: one animal, to camera, saying their line. LTX 2.5 with the enhancer off so the named-beat lip-sync wording survives.",
    lane: "interview",
    builtin: true,
    payload: {
      engine: "ltx25",
      resolution: "1280 × 704 (16:9)",
      durationSec: 8,
      fps: 24,
      fast: false,
      enhance: false,
    },
    cine: { shotSize: "mcu", angle: "eye", move: "static", lens: "shallow", lighting: "sitcom.three-point" },
    look: null,
    negative: "",
    sample: null,
    sound: "",
    rules: { multiShot: false, namedBeats: true, verbatimSubjects: false },
  },
  {
    id: "zoo-room-coverage",
    label: "Room coverage",
    description:
      "Wide → single → reaction inside ONE generation, using the multi-shot prose proven on 2026-08-31. Longer, and the enhancer must stay off or the cuts vanish.",
    lane: "coverage",
    builtin: true,
    payload: {
      engine: "ltx25",
      resolution: "1280 × 704 (16:9)",
      durationSec: 12,
      fps: 24,
      fast: false,
      enhance: false,
    },
    cine: { shotSize: "ws", angle: "eye", move: "static", lighting: "sitcom.warm-home" },
    look: null,
    negative: "",
    sample: null,
    sound: "",
    rules: { multiShot: true, namedBeats: true, verbatimSubjects: true },
  },
  {
    id: "zoo-broll-insert",
    label: "B-roll insert",
    description:
      "The wordless action beat, on H3 so it arrives already scored. Draft tier at H3's native canvas — the shape that renders in minutes rather than an hour.",
    lane: "broll",
    builtin: true,
    payload: {
      engine: "minimax-h3",
      resolution: "1344 × 768 (16:9 · native)",
      durationSec: 5,
      fast: true,
      minimaxTier: "draft",
    },
    cine: { shotSize: "ms", move: "push-in" },
    look: null,
    negative: "",
    sample: null,
    sound: "",
    rules: { multiShot: false, namedBeats: false, verbatimSubjects: false },
  },
  {
    id: "zoo-field-note",
    label: "Field Note (vertical)",
    description:
      "The 45s vertical format the show launches in, one shot at a time: H3 native 9:16, five seconds, draft tier, native audio.",
    lane: "fieldnote",
    builtin: true,
    payload: {
      engine: "minimax-h3",
      resolution: "768 × 1344 (9:16 · native)",
      durationSec: 5,
      fast: true,
      minimaxTier: "draft",
    },
    cine: { shotSize: "mcu", angle: "eye", move: "static" },
    look: null,
    negative: "",
    sample: null,
    sound: "",
    rules: { multiShot: false, namedBeats: true, verbatimSubjects: false },
  },
];

/* ---------- shipped looks ----------
 *
 * The bible-free lane (VIDEO-LAB-FREEFORM-PLAN.md §2.2). A look answers the
 * same eight questions a Zoo Logic lane does, but with aesthetics instead of
 * a show's production shape: stock or medium, lens, light, palette, texture,
 * era — plus an engine default that follows the measurements rather than the
 * brochure. LTX 2.5 carries the silent single-take picture looks (25–30%
 * faster than 2.3, better blocked, enhancer ON because these are single
 * takes); H3 at its native Draft canvas carries anything that should arrive
 * already scored. `enhance` is written on EVERY LTX look so an engine switch
 * can never flip it silently.
 *
 * Two rules every look obeys: the negative always refuses text (the models
 * cannot letter; captions are post-production, never a prompt), and the look
 * prose describes a picture, never a subject — the user's sentence or the
 * user's image is the subject. For the same reason a look sets NO shot size:
 * the bank's size clauses describe a character ("from the waist up, hands
 * visible and gesturing"), which the first freeform render pasted onto a
 * kettle (2026-09-02). Angle, move, lens and light are the look's; the
 * framing is the subject's. */

const NO_TEXT = NO_TEXT_NEGATIVE;

const LTX_LOOK = {
  engine: "ltx25",
  resolution: "1280 × 704 (16:9)",
  durationSec: 5,
  fps: 24 as const,
  fast: true,
  enhance: true,
};
const H3_LOOK = {
  engine: "minimax-h3",
  resolution: "1344 × 768 (16:9 · native)",
  durationSec: 5,
  fast: true,
  minimaxTier: "draft" as const,
};
const LOOK_RULES = { multiShot: false, namedBeats: false, verbatimSubjects: false };

/* F3 — the style adapters a look may ride (VIDEO-LAB-FREEFORM-PLAN.md §2.4).
 *
 * Measured 2026-09-02, one seed, enhancer OFF, 4 s draft t2v, the same fox
 * in the same market: `anime` and `painterly` change the picture outright
 * (2D cel over CG; oil brushwork and canvas over photographic) and ship on
 * their looks. `pixarToon`, `papercut` and `claymation` did not clear the
 * bar — the prose was already doing the work — so they stay registered and
 * installable but ride no look. Prose first; an adapter has to earn its
 * place, exactly as the camera LoRA had to.
 * Named by FILE, never by path: the install's own name for the file depends
 * on where the model manager put it and on the platform's separator, and
 * `resolveLoraByFile` finds it against the live option list. The panel skips
 * a LoRA that is not installed rather than sending it, and the adapters
 * refuse one they cannot find — so a look with a LoRA still renders (as
 * prose alone) on an install that never downloaded the set. Each one was
 * measured against prose alone at one seed before it went on a look; the
 * strengths below are the measured ones. */
const STYLE_LORA = {
  anime: { name: "Fantasy_Anime.safetensors", strength: 1 },
  claymation: { name: "Claymation.safetensors", strength: 1 },
  painterly: { name: "Fantasy_Painterly.safetensors", strength: 1 },
  pixarToon: { name: "Pixar_Toon.safetensors", strength: 1 },
  papercut: { name: "PaperCutOutStyle.safetensors", strength: 1 },
} as const;
export const STYLE_LORAS = STYLE_LORA;

type ShippedLook = Pick<VideoPreset, "id" | "label" | "description" | "payload" | "cine" | "look" | "negative"> &
  Partial<Pick<VideoPreset, "sound">> & { loras?: { name: string; strength: number }[] };

const look = ({ loras, ...l }: ShippedLook): VideoPreset =>
  videoPresetSchema.parse({
    ...l,
    payload: loras ? { ...l.payload, loras } : l.payload,
    lane: "look",
    builtin: true,
    sample: null,
    rules: LOOK_RULES,
  });

export const SHIPPED_LOOKS: VideoPreset[] = [
  /* ---- artistic ---- */
  look({
    id: "look-16mm-documentary",
    label: "16mm documentary",
    description: "Hand-held 16mm reversal stock: soft grain, warm halation, natural light that is allowed to clip.",
    payload: LTX_LOOK,
    cine: { angle: "eye", move: "handheld", lighting: "universal.three-point" },
    look:
      "Shot on 16mm colour reversal film: visible grain, slight gate weave, warm halation around highlights, muted greens and amber skin tones, natural available light",
    negative: `${NO_TEXT}, clean digital video, oversharpened, HDR, plastic skin`,
  }),
  look({
    id: "look-anamorphic-noir",
    label: "Anamorphic neon noir",
    description: "Wet night streets, 2.39 anamorphic flares, teal shadows against sodium and neon.",
    payload: { ...LTX_LOOK, durationSec: 6 },
    cine: { angle: "low", move: "tracking", lens: "anamorphic", lighting: "universal.neon-wet" },
    look:
      "Anamorphic widescreen night exterior: horizontal blue lens flares, oval bokeh, rain-slick reflections, teal shadows against magenta and sodium-orange neon, deep blacks with a faint haze",
    negative: `${NO_TEXT}, daylight, flat lighting, washed out, cartoon`,
  }),
  look({
    id: "look-pastel-symmetry",
    label: "Pastel symmetry",
    description: "Dead-centre composition, planimetric staging, a pastel palette and a camera that does not move.",
    payload: LTX_LOOK,
    cine: { angle: "eye", move: "static", lens: "deep", lighting: "universal.high-key" },
    look:
      "Perfectly symmetrical frontal composition, flat planimetric staging, pastel pink, mint and mustard palette, soft even daylight, crisp edges, storybook precision",
    negative: `${NO_TEXT}, handheld shake, dutch angle, dark, gritty`,
  }),
  look({
    id: "look-watercolour",
    label: "Watercolour animation",
    description: "Loose wet-on-wet washes that bloom and settle, paper texture visible through every colour.",
    payload: LTX_LOOK,
    cine: { angle: "eye", move: "static", lens: "shallow", lighting: "universal.high-key" },
    look:
      "Hand-painted watercolour animation: translucent wet-on-wet washes, soft bleeding edges, visible cold-pressed paper grain, restrained palette with white paper left as the light",
    negative: `${NO_TEXT}, photorealistic, 3D render, glossy, hard outlines`,
  }),
  look({
    id: "look-claymation",
    label: "Claymation",
    description: "Stop-motion plasticine: thumbprints, slight frame-to-frame jitter, a tabletop world lit like a film set.",
    payload: { ...H3_LOOK },
    cine: { angle: "eye", move: "static", lens: "shallow", lighting: "universal.three-point" },
    look:
      "Stop-motion claymation: hand-sculpted plasticine figures with visible thumbprints, slightly stepped 12-frame motion, miniature tabletop set with real fabric and painted backdrops, soft studio key light and a warm fill",
    negative: `${NO_TEXT}, smooth CGI, photorealistic humans, motion blur`,
    sound: "quiet foley of a miniature set: soft taps and rustles, no music",
  }),
  look({
    id: "look-anime-cel",
    label: "Anime cel",
    description: "Clean cel shading over painted backgrounds, held frames and snap movement, a big sky.",
    payload: LTX_LOOK,
    cine: { angle: "low", move: "static", lens: "deep", lighting: "universal.golden-hour" },
    look:
      "2D anime cel animation: flat cel shading with two-tone shadows, thin clean line art, richly painted background with a vast gradient sky, limited animation on held frames, saturated but harmonious colour",
    negative: `${NO_TEXT}, 3D render, photorealistic, western cartoon, uncanny faces`,
    loras: [STYLE_LORA.anime],
  }),
  look({
    id: "look-oil-paint",
    label: "Oil-paint impressionist",
    description: "Thick visible brushwork that shimmers as the frame moves, colour broken into strokes of light.",
    payload: LTX_LOOK,
    cine: { angle: "eye", move: "push-in", lens: "shallow", lighting: "universal.golden-hour" },
    look:
      "Impressionist oil painting in motion: thick impasto brushstrokes, colour broken into dabs of complementary light, soft undefined edges, warm late-afternoon palette, a canvas texture beneath everything",
    negative: `${NO_TEXT}, photorealistic, sharp digital edges, flat colour`,
    loras: [STYLE_LORA.painterly],
  }),
  look({
    id: "look-macro-nature",
    label: "Macro nature",
    description: "Probe-lens close-up: razor-thin focus, dew and dust catching the light, the world at insect scale.",
    payload: { ...LTX_LOOK, durationSec: 6 },
    cine: { angle: "ground", move: "push-in", lens: "macro", lighting: "universal.rim" },
    look:
      "Extreme macro nature photography: razor-thin plane of focus, creamy background bokeh, backlit dew and dust motes, saturated organic colour, slow deliberate movement at insect scale",
    negative: `${NO_TEXT}, wide shot, people, cartoon, flat lighting`,
  }),
  look({
    id: "look-drone-golden",
    label: "Drone golden hour",
    description: "High, slow aerial at the last twenty minutes of sun, long shadows and a warm haze on the horizon.",
    payload: { ...LTX_LOOK, durationSec: 6 },
    cine: { angle: "high", move: "aerial", lens: "wide-angle", lighting: "universal.golden-hour" },
    look:
      "Cinematic aerial drone footage at golden hour: slow smooth glide, long raking shadows, warm haze on the horizon, gentle gradient from amber to soft blue, immaculate stabilisation",
    negative: `${NO_TEXT}, handheld shake, midday flat light, overexposed sky`,
  }),
  look({
    id: "look-liminal",
    label: "Liminal interior",
    description: "Empty carpeted corridors and humming fluorescents, an uncanny stillness with nobody in it.",
    payload: LTX_LOOK,
    cine: { angle: "eye", move: "static", lens: "wide-angle", lighting: "universal.high-key" },
    look:
      "Liminal space photography: an empty interior under flat fluorescent light, faded carpet and beige walls, slight fisheye distortion, uncanny stillness, a faint yellow-green cast, nobody present",
    negative: `${NO_TEXT}, people, dramatic lighting, warm colour, outdoors`,
  }),
  /* ---- reactive / shitpost ---- */
  look({
    id: "look-broadcast-news",
    label: "Broadcast news",
    description: "The studio desk look: glossy set, three-point key, a slow zoom in — graphics are for post.",
    payload: { ...H3_LOOK, durationSec: 6 },
    cine: { angle: "eye", move: "push-in", lens: "telephoto", lighting: "universal.three-point" },
    look:
      "Live television news studio: glossy curved desk, blue and red backlit set panels, bright even three-point studio lighting, crisp broadcast video, a slow centred zoom",
    negative: `${NO_TEXT}, lower third, ticker, on-screen graphics, film grain, handheld`,
    sound: "the hum of a television studio, faint air handling, no music",
  }),
  look({
    id: "look-security-cam",
    label: "Security camera",
    description: "Fixed high-corner CCTV: fisheye, crushed greys, low frame rate, timestamp feel without legible digits.",
    payload: LTX_LOOK,
    cine: { angle: "high", move: "static", lens: "wide-angle", lighting: "universal.low-key" },
    look:
      "Security camera footage from a fixed high corner: strong fisheye distortion, desaturated crushed greys, heavy compression noise, low frame rate stutter, a faint infrared glow on faces",
    negative: `${NO_TEXT}, legible timestamp, cinematic lighting, shallow depth of field, colour grading`,
  }),
  look({
    id: "look-phone-vertical",
    label: "Phone footage (vertical)",
    description: "9:16 handheld phone video with on-camera flash and the sound the room actually makes.",
    payload: { ...H3_LOOK, resolution: "768 × 1344 (9:16 · native)" },
    cine: { angle: "eye", move: "handheld", lens: "wide-angle", lighting: "universal.underlight" },
    look:
      "Vertical smartphone video: handheld with small corrections, wide phone lens, harsh on-camera flash falling off into a dim room, slightly noisy shadows, everyday realism",
    negative: `${NO_TEXT}, tripod, cinematic grading, anamorphic, film grain`,
    sound: "the room's own sound picked up by a phone microphone: close, slightly clipped, no music",
  }),
  look({
    id: "look-corporate-stock",
    label: "Corporate stock footage",
    description: "Over-lit, over-smiling, slow dolly past glass — the b-roll every explainer video buys.",
    payload: LTX_LOOK,
    cine: { angle: "eye", move: "tracking", lens: "shallow", lighting: "universal.high-key" },
    look:
      "Generic corporate stock footage: bright glass office, slow lateral dolly, shallow focus, clean white and blue palette, everything slightly too well lit and slightly too pleased",
    negative: `${NO_TEXT}, moody lighting, film grain, handheld, clutter`,
  }),
  look({
    id: "look-infomercial-90s",
    label: "1990s infomercial",
    description: "Interlaced tape, bloomed whites, a studio audience glow and a product that is about to change your life.",
    payload: { ...H3_LOOK, durationSec: 6 },
    cine: { angle: "eye", move: "snap-zoom", lens: "deep", lighting: "universal.high-key" },
    look:
      "1990s television infomercial on interlaced videotape: bloomed over-bright whites, slight chroma bleed, soft NTSC resolution, a flat studio set with pastel gradients, enthusiastic staging",
    negative: `${NO_TEXT}, price, phone number, on-screen graphics, cinematic, 4K`,
    sound: "a studio audience murmuring and applauding on cue, bright upbeat synth bed",
  }),

  /* ---- F3 wave (2026-09-02) — APPENDED: the looks marker of a first-wave
     install only counted, so a look added later must come after every look
     that shipped before it (see seedLooks) ---- */
  look({
    id: "look-cgi-toon",
    label: "CGI toon feature",
    description: "Feature-animation CGI: smooth stylised surfaces, big readable eyes, soft bounce light — the family-film look.",
    payload: LTX_LOOK,
    cine: { angle: "eye", move: "push-in", lens: "shallow", lighting: "universal.three-point" },
    look:
      "Stylised 3D feature animation: smooth appealing character surfaces, clean simplified geometry, large expressive eyes, soft global illumination with gentle bounce, vibrant balanced palette, polished cinematic shading",
    negative: `${NO_TEXT}, photorealistic, live action, 2D flat, uncanny, gritty`,
    /* No LoRA: measured 2026-09-02 against Pixar_Toon at one seed, enhancer
     * off. The prose alone already renders a clean CGI toon; the adapter's
     * difference (slightly softer shading, tidier background) was not the
     * visible change the plan requires, so it is not shipped on the look —
     * the model stays installable for anyone who wants to try it. */
  }),
  look({
    id: "look-paper-cutout",
    label: "Paper cut-out",
    description: "A diorama built from layered paper: cut edges, stacked sheets, tape seams, a warm storybook light.",
    payload: LTX_LOOK,
    cine: { angle: "eye", move: "static", lens: "shallow", lighting: "universal.three-point" },
    look:
      "Handcrafted paper cut-out diorama: every shape cut from layered card with visible edges and slight curl, stacked depth with soft layered shadows, folded paper details and tape seams, warm cosy storybook lighting",
    negative: `${NO_TEXT}, photorealistic, 3D render, smooth CGI, glossy`,
    /* No LoRA: measured 2026-09-02 against PaperCutOutStyle at one seed,
     * enhancer off. Neither arm produced true layered paper — the adapter
     * moved the props towards card but left a plush 3D subject, so it fails
     * the "visible difference" bar and the look ships on its prose. */
  }),
];

/** a short stable digest of a shipped look's JSON — only ever compared to a
 * digest this app wrote itself, so it answers "did the user edit this file?"
 * and nothing else */
function looksHash(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

/** the bytes a shipped look is hashed over — the look WITHOUT its `sample`.
 * The sample is this install's own: a still the F5 contact sheet rendered
 * and filed into a project here, which no other install has. Setting it
 * must not read as "the user edited this look" (that would freeze the look
 * out of every later upstream refresh), and a refresh must not wipe it. */
function shippedLookBytes(preset: VideoPreset): string {
  return JSON.stringify({ ...preset, sample: null }, null, 2);
}

/** the same digest for a file on disk — through the schema, so key order
 * from a `saveVideoPreset` round trip does not count as an edit either.
 * `null` = the file does not parse; it is left alone. */
function diskLookDigest(raw: string): { hash: string; sample: string | null } | null {
  try {
    const parsed = videoPresetSchema.parse(JSON.parse(raw));
    return { hash: looksHash(shippedLookBytes(parsed)), sample: parsed.sample };
  } catch {
    return null;
  }
}

export class PromptLibrary {
  constructor(private settings: SettingsStore) {}

  private root(): string {
    return path.join(this.settings.get().storage.dataRoot, "promptlib");
  }
  private dir(kind: "presets" | "packs" | "decks" | "video-presets"): string {
    return path.join(this.root(), kind);
  }

  /** Seed once per dataRoot. The marker file keeps a deleted builtin deleted —
   * reseeding on every boot would resurrect what the user threw away. */
  private seed(): void {
    const marker = path.join(this.root(), ".seeded.json");
    if (fs.existsSync(marker)) return;
    for (const kind of ["presets", "packs", "decks"] as const) {
      fs.mkdirSync(this.dir(kind), { recursive: true });
    }
    const now = new Date().toISOString();
    for (const preset of BUILTIN_PRESETS) {
      const id = slugify(preset.title);
      this.writeJson(path.join(this.dir("presets"), `${id}.json`), {
        ...preset,
        id,
        builtin: true,
        createdAt: now,
      });
    }
    for (const pack of SHIPPED_PACKS) {
      this.writeJson(path.join(this.dir("packs"), `${pack.id}.json`), {
        ...pack,
        fromBible: false,
      });
    }
    this.writeJson(marker, { seededAt: now, presets: BUILTIN_PRESETS.length });
  }

  /* ---------- presets ---------- */

  presets(projectId?: string): PromptPreset[] {
    this.seed();
    const all = this.readAll(this.dir("presets"), promptPresetSchema);
    return all
      .filter((p) => !p.projectId || p.projectId === projectId)
      .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
  }

  savePreset(input: PromptPresetSave): PromptPreset {
    this.seed();
    const id = input.id ?? this.freshId(this.dir("presets"), slugify(input.title));
    const existing = input.id
      ? this.readAll(this.dir("presets"), promptPresetSchema).find((p) => p.id === input.id)
      : undefined;
    const preset = promptPresetSchema.parse({
      ...input,
      id,
      builtin: existing?.builtin ?? false,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    });
    this.writeJson(path.join(this.dir("presets"), `${id}.json`), preset);
    return preset;
  }

  removePreset(id: string): void {
    fs.rmSync(path.join(this.dir("presets"), `${id}.json`), { force: true });
  }

  /* ---------- packs ---------- */

  /** shipped packs (files) + the live per-project pack derived from the bible */
  packs(projectId?: string, bible?: Bible | null): StylePack[] {
    this.seed();
    const packs = this.readAll(this.dir("packs"), stylePackSchema).filter(
      (p) => !p.projectId || p.projectId === projectId,
    );
    const derived = bible ? deriveStylePack(bible, projectId) : null;
    return derived ? [derived, ...packs] : packs;
  }

  /* ---------- decks ---------- */

  decks(): PromptDeck[] {
    this.seed();
    return this.readAll(this.dir("decks"), promptDeckSchema).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  saveDeck(input: PromptDeckSave): PromptDeck {
    this.seed();
    const id = input.id ?? this.freshId(this.dir("decks"), slugify(input.title));
    const deck = promptDeckSchema.parse({ ...input, id, updatedAt: new Date().toISOString() });
    this.writeJson(path.join(this.dir("decks"), `${id}.json`), deck);
    return deck;
  }

  removeDeck(id: string): void {
    fs.rmSync(path.join(this.dir("decks"), `${id}.json`), { force: true });
  }

  /* ---------- video presets (render lanes) ---------- */

  /** Seeded under their OWN marker, not the library's. Every existing dataRoot
   * already carries `.seeded.json` from the day the Image lab shipped, so
   * hanging the lanes off that marker would mean nobody who has ever used
   * Aurea gets them. */
  private seedVideo(): void {
    const dir = this.dir("video-presets");
    const marker = path.join(dir, ".seeded.json");
    if (fs.existsSync(marker)) return;
    fs.mkdirSync(dir, { recursive: true });
    for (const preset of SHIPPED_VIDEO_PRESETS) {
      this.writeJson(path.join(dir, `${preset.id}.json`), videoPresetSchema.parse(preset));
    }
    this.writeJson(marker, { seededAt: new Date().toISOString(), lanes: SHIPPED_VIDEO_PRESETS.length });
  }

  /** Looks seed under a THIRD marker, for the same reason the lanes have
   * their own: every install that ever opened the Video lab after 2026-09-02
   * already carries `.seeded.json` under video-presets. Same folder, same
   * builtin flag, same delete-stays-deleted rule. */
  private seedLooks(): void {
    const dir = this.dir("video-presets");
    const marker = path.join(dir, ".seeded-looks.json");
    fs.mkdirSync(dir, { recursive: true });
    /* The marker remembers, per look id, the EXACT bytes this install was
     * seeded with. That answers both questions a shipped look raises:
     *
     *   - a look added in a later wave (F3's CGI toon and paper cut-out)
     *     still arrives on an install seeded with the first fifteen, while a
     *     look the user deleted stays deleted, because its id is on the list;
     *   - a look CHANGED upstream (the anime look gaining its style LoRA)
     *     reaches an install that already has the old copy — but only if the
     *     file still matches the bytes we wrote. A look the user has edited
     *     is theirs, and is never overwritten.
     *
     * A first-wave marker predates the hashes and only counted: those are the
     * first `looks` entries of SHIPPED_LOOKS, which is append-only for
     * exactly this reason, and they are left alone rather than guessed at. */
    let seeded: Record<string, string | null> = {};
    let firstWave = false;
    if (fs.existsSync(marker)) {
      try {
        const raw = JSON.parse(fs.readFileSync(marker, "utf8")) as {
          looks?: number;
          ids?: string[];
          hashes?: Record<string, string>;
        };
        if (raw.hashes) seeded = raw.hashes;
        else {
          firstWave = true;
          for (const id of raw.ids ?? SHIPPED_LOOKS.slice(0, raw.looks ?? 0).map((l) => l.id)) {
            seeded[id] = null; // seeded, bytes unknown — do not touch
          }
        }
      } catch {
        seeded = {};
      }
    }
    const hashes: Record<string, string> = {};
    for (const preset of SHIPPED_LOOKS) {
      const file = path.join(dir, `${preset.id}.json`);
      const hash = looksHash(shippedLookBytes(preset));
      hashes[preset.id] = hash;
      const known = preset.id in seeded;
      if (!known) {
        this.writeJson(file, preset); // a look from a later wave
        continue;
      }
      const was = seeded[preset.id];
      if (was === null || was === hash || !fs.existsSync(file)) continue;
      // changed upstream — refresh it only if this install never edited it;
      // the sample it rendered for itself rides through the refresh
      let current: string;
      try {
        current = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const disk = diskLookDigest(current);
      if (disk && disk.hash === was) this.writeJson(file, { ...preset, sample: disk.sample });
    }
    const unchanged =
      !firstWave &&
      Object.keys(hashes).length === Object.keys(seeded).length &&
      Object.entries(hashes).every(([id, h]) => seeded[id] === h);
    if (unchanged) return;
    this.writeJson(marker, {
      seededAt: new Date().toISOString(),
      looks: SHIPPED_LOOKS.length,
      ids: SHIPPED_LOOKS.map((l) => l.id),
      hashes,
    });
  }

  videoPresets(projectId?: string): VideoPreset[] {
    this.seedVideo();
    this.seedLooks();
    return this.readAll(this.dir("video-presets"), videoPresetSchema)
      .filter((p) => !p.projectId || p.projectId === projectId)
      .sort((a, b) => a.lane.localeCompare(b.lane) || a.label.localeCompare(b.label));
  }

  saveVideoPreset(input: VideoPresetSave): VideoPreset {
    this.seedVideo();
    this.seedLooks();
    const id = input.id ?? this.freshId(this.dir("video-presets"), slugify(input.label));
    const existing = input.id
      ? this.readAll(this.dir("video-presets"), videoPresetSchema).find((p) => p.id === input.id)
      : undefined;
    // a shipped lane stays shipped through an edit — the flag is what tells
    // the UI it can be reset, not who last touched the file
    const preset = videoPresetSchema.parse({ ...input, id, builtin: existing?.builtin ?? false });
    this.writeJson(path.join(this.dir("video-presets"), `${id}.json`), preset);
    return preset;
  }

  removeVideoPreset(id: string): void {
    fs.rmSync(path.join(this.dir("video-presets"), `${id}.json`), { force: true });
  }

  /* ---------- plumbing ---------- */

  private freshId(dir: string, base: string): string {
    let id = base;
    for (let n = 2; fs.existsSync(path.join(dir, `${id}.json`)); n++) id = `${base}-${n}`;
    return id;
  }

  private readAll<T>(dir: string, schema: { parse(v: unknown): T }): T[] {
    if (!fs.existsSync(dir)) return [];
    const out: T[] = [];
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith(".json") || entry.startsWith(".")) continue;
      try {
        out.push(schema.parse(JSON.parse(fs.readFileSync(path.join(dir, entry), "utf8"))));
      } catch {
        // a hand-edited file that stopped parsing is skipped, not fatal
      }
    }
    return out;
  }

  private writeJson(target: string, value: unknown): void {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, target);
  }
}

/** The project's own style, read off its bible — computed, never stored, so
 * editing the bible edits the pack. */
export function deriveStylePack(bible: Bible, projectId?: string): StylePack | null {
  const art = bible.style.artDirection.trim();
  if (!art) return null;
  return stylePackSchema.parse({
    id: `bible-${projectId ?? "project"}`,
    title: "This project — from the bible",
    description: "Derived live from the story bible's art direction. Edit the bible to change it.",
    projectId,
    fromBible: true,
    presets: [
      {
        id: `bible-${projectId ?? "project"}-art`,
        title: "Art direction",
        category: "style",
        text: art,
        tags: ["bible"],
        builtin: false,
        createdAt: "derived",
      },
    ],
    negative: bible.style.negativePrompt.trim() || undefined,
  });
}
