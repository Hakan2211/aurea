/* Animal Sitcom seed — the six locked characters as structured bible data,
 * plus the file copier that pulls their reference images and voice ref clips
 * out of the videofast repo (settings.paths.videofastDir) into the project's
 * own assets tree. The prose fields are transcribed from the locked docs
 * (character-sheets-v2 §3 fill values, the TTS bake-off characters.json,
 * gen_char_vo.py delivery tuning) — only FILES are read from videofast at
 * seed time, so the import never depends on parsing Markdown. */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  bibleCharacterSchema,
  bibleLocationSchema,
  bibleStyleSchema,
  type BibleCharacter,
  type BibleLocation,
  type BibleRefs,
  type BibleStyle,
} from "@aurea/shared";

type SeedCharacter = Omit<BibleCharacter, "refs" | "lora">;

const seedChar = (c: Partial<BibleCharacter> & { id: string; name: string }): SeedCharacter => {
  const { refs: _refs, lora: _lora, ...rest } = bibleCharacterSchema.parse(c);
  return rest;
};

export const ANIMAL_SITCOM_CHARACTERS: SeedCharacter[] = [
  seedChar({
    id: "sterling",
    name: "Sterling",
    species: "lion",
    build: "medium-tall, broad chest, full flowing golden mane",
    face: "warm tan muzzle, amber eyes, tufted rounded ears, confident charming look",
    wardrobe:
      "a tiny royal-blue velvet blazer with gold trim, a cream waistcoat, a burgundy bow tie, " +
      "a pocket watch on a gold chain, polished brown loafers",
    props: "a monocle over his right eye",
    colors: "golden-tan fur, royal blue, gold, burgundy, cream",
    signatureFeature: "the gold monocle on its chain and the engraved pocket watch resting in his paw",
    anchors: {
      body: "a small clean notch missing from the top of his LEFT ear and a faint thin scar nicking his right eyebrow",
      face: "left-ear notch + right-eyebrow nick visible",
      macro: "the notched top-left ear and the thin healed scar through the right eyebrow",
    },
    personality:
      "The leader — posh, charming, unfailingly polite; believes there is a correct way to do " +
      "everything and is quietly wounded when standards slip.",
    speechPattern:
      "Refined posh British RP, smooth measured and warm, a touch theatrical, unhurried; " +
      "an elegant \"ho-ho\" laugh.",
    seed: 7,
    voice: { voiceId: "sterling", engine: "chatterbox", exaggeration: 0.6, cfgWeight: 0.4, deliveryNotes: "plummy, measured, mid-range; never rushed" },
  }),
  seedChar({
    id: "grant",
    name: "Grant",
    species: "giraffe",
    build: "very tall, long neck and long legs, upright posture",
    face: "long gentle face, calm dark eyes behind round glasses, two ossicones, tan-and-cream giraffe patches",
    wardrobe:
      "a structured navy marching-style jacket with brass buttons, high collar and epaulets, " +
      "slim khaki pants, black boots",
    props: "round glasses sliding down his nose, a silver whistle on a lanyard",
    colors: "tan-orange patches on cream, navy, brass gold, khaki",
    signatureFeature: "the round glasses and the silver whistle on its lanyard against the brass-buttoned collar",
    anchors: {
      body: "a small chip on the tip of his LEFT ossicone and a heart-shaped patch in his spot pattern on the left of his neck",
      face: "chipped left ossicone tip + heart-shaped neck spot",
      macro: "the chipped left horn tip and the heart-shaped spot on the neck",
    },
    personality:
      "The coach — steady, authoritative, unflappable; keeps the crew organized and calm, " +
      "one step at a time.",
    speechPattern: "Deep, steady, clear projecting diction; grounded and reassuring, natural authority.",
    seed: 11,
    voice: { voiceId: "grant", engine: "chatterbox", exaggeration: 0.5, cfgWeight: 0.4, deliveryNotes: "calm coach cadence; firm, never shouty" },
  }),
  seedChar({
    id: "milo",
    name: "Milo",
    species: "meerkat",
    build: "small, wiry, alert twitchy posture",
    face: "big watchful dark-ringed eyes, small pointed snout, sandy fur, dark eye-patches",
    wardrobe:
      "a slightly-too-big rust-and-cream striped sweater, skinny dark jeans, a mustard beanie, " +
      "a tiny backpack stuffed with supplies",
    props: "the beanie he keeps adjusting, backpack straps over both shoulders",
    colors: "sandy-brown fur, rust, cream, mustard yellow, denim blue",
    signatureFeature: "his wide watchful eyes under the mustard beanie, paws gripping the backpack straps",
    anchors: {
      body: "a permanent bent kink at the very tip of his tail and a tiny nick in his right ear",
      face: "nicked right ear + alert eyes",
      macro: "the kinked bent tail-tip and the small nick in the right ear",
    },
    personality:
      "The anxious comic engine — hyper-alert, double-checks everything, catastrophizes small " +
      "problems; means well and loves the crew.",
    speechPattern:
      "Fast, slightly high-pitched, jittery; quick nervous bursts that trail off, a nervous little laugh.",
    seed: 13,
    voice: { voiceId: "milo", engine: "chatterbox", exaggeration: 0.85, cfgWeight: 0.4, deliveryNotes: "jittery bursts, trail-offs; let the panic peak" },
  }),
  seedChar({
    id: "bruno",
    name: "Bruno",
    species: "gorilla",
    build: "huge and muscular with broad shoulders and a gentle, shy stoop",
    face: "kind soft dark eyes, gentle heavy brow, shy warm half-smile",
    wardrobe: "a soft mint pastel hoodie, rolled-up paint-splattered denim overalls, big chunky sneakers",
    props: "colorful friendship bracelets on both wrists",
    colors: "charcoal-black fur, mint green, faded denim blue, paint speckles",
    signatureFeature: "the stacked friendship bracelets on his big gentle hands, knuckles flecked with paint",
    anchors: {
      body: "a pale heart-shaped patch of lighter fur on his chest and a small chip in one lower canine that shows when he smiles",
      face: "chipped lower canine in his shy grin",
      macro: "the heart-shaped light-fur patch on the chest and the chipped tooth",
    },
    personality:
      "The gentle giant — soft-spoken, kind, shy; makes room for everyone and shares the good chips.",
    speechPattern: "Low warm gentle rumble, soft-spoken and slightly slow; occasionally hums softly.",
    seed: 17,
    voice: { voiceId: "bruno", engine: "chatterbox", exaggeration: 0.45, cfgWeight: 0.4, deliveryNotes: "soft, slow, kind; the rumble does the work" },
  }),
  seedChar({
    id: "jax",
    name: "Jax",
    species: "eagle",
    build: "lean and upright, folded wings that work as arms",
    face: "sharp confident gaze, golden hooked beak, white head feathers, piercing amber eyes",
    wardrobe: "a sleek slate bomber jacket with geometric orange patterns, fitted cargo pants, fingerless gloves",
    props: "aviator goggles pushed up on his head",
    colors: "white head, brown body feathers, golden beak, slate grey, geometric orange",
    signatureFeature: "the aviator goggles resting on his crown and his sharp amber eye",
    anchors: {
      body: "one crown feather that always sits slightly out of place like a cowlick and a faint pale scar line across the upper beak",
      face: "the out-of-place crown feather + beak scar",
      macro: "the single stray crown feather and the healed scar line on the beak",
    },
    personality:
      "The visionary — sees the bigger picture (literally, from above); deliberate, thoughtful, " +
      "occasionally grandiose about snacks.",
    speechPattern: "Clear, confident, slightly airy resonance; deliberate pauses, calm big-picture delivery.",
    seed: 19,
    voice: { voiceId: "jax", engine: "chatterbox", exaggeration: 0.55, cfgWeight: 0.4, deliveryNotes: "let the pauses land; calm altitude" },
  }),
  seedChar({
    id: "barney",
    name: "Barney",
    species: "snake",
    build: "a long body and expressive upper coils that gesture like arms",
    face: "sly half-lidded smirk, subtle iridescent green scale shimmer, slit pupils",
    wardrobe:
      "a long patterned scarf that doubles as part of his body, a tiny leather jacket over his " +
      "upper coils, a thin gold chain",
    props: "round dark shades (worn or pushed up)",
    colors: "iridescent emerald-green scales, black leather, gold, patterned scarf",
    signatureFeature: "the round dark shades and gold chain against his shimmering green scales",
    anchors: {
      body: "a healed pale scar band across his mid-body and one lighter mismatched scale near his jaw like a beauty mark",
      face: "the mismatched pale scale near the jaw",
      macro: "the pale healed scar band across the mid-body and the single mismatched jaw scale",
    },
    personality:
      "The sarcastic one — dry, unhurried, effortlessly cool; narrates the crew's disasters with " +
      "delighted disdain.",
    speechPattern: "Smooth sly slightly raspy drawl, amused and unhurried; elongated hissing S sounds.",
    seed: 23,
    voice: { voiceId: "barney", engine: "chatterbox", exaggeration: 0.7, cfgWeight: 0.4, deliveryNotes: "drawl it; lean into the sssibilants" },
  }),
];

export const ANIMAL_SITCOM_LOCATIONS: BibleLocation[] = [
  bibleLocationSchema.parse({
    id: "the-loft",
    name: "The Loft",
    description:
      "The crew's shared home base — a warm cluttered warehouse loft with mismatched furniture, " +
      "string lights, a battered sofa and the communal snack shelf.",
    stylePrompt:
      "interior of a warm industrial loft apartment, exposed brick, string lights, mismatched " +
      "cozy furniture, evening tungsten glow, sitcom three-camera staging",
  }),
  bibleLocationSchema.parse({
    id: "the-club",
    name: "The Club",
    description:
      "The dance club where the crew performs — neon-washed stage, LED floor, haze and moving heads.",
    stylePrompt:
      "interior of a nightclub stage, saturated neon and LED panels, atmospheric haze, dramatic " +
      "concert lighting, wide dance floor",
  }),
  bibleLocationSchema.parse({
    id: "the-office",
    name: "The Office",
    description:
      "The daytime day-job office — grey cubicles, fluorescent light, motivational posters nobody reads.",
    stylePrompt:
      "interior of a bland corporate open-plan office, grey cubicles, flat fluorescent lighting, " +
      "glass meeting room in the background, mundane realism",
  }),
];

export const ANIMAL_SITCOM_STYLE: BibleStyle = bibleStyleSchema.parse({
  artDirection:
    "Lane B (doc 23, LOCKED): stylized 3D animated characters, Pixar / Illumination quality, soft " +
    "subsurface scattering, appealing rounded shapes, detailed fur and fabric, physically-based " +
    "materials, cinematic 3D render. Heroes are GPT-Image photoreal-leaning re-shoots; keyframes " +
    "stay on-model via the Qwen-Image-Edit reference workflow.",
  negativePrompt:
    "blurry, deformed, extra limbs, extra fingers, mutated hands, fused fingers, inconsistent " +
    "design, different character, off-model, text, labels, watermark, signature, low detail, " +
    "duplicated face, flat lighting, harsh shadows, nsfw",
  cinematographyNotes:
    "The doc-26 cinematography bible is installed as structured banks in bible.cinematography " +
    "(shot sizes, angles, moves, lenses, Dune/Avatar/sitcom/concert lighting, compositions, " +
    "per-dancer camera signatures). Write shot camera specs in bank vocabulary — ids like " +
    '"ws", "low", "push-in", "sitcom.warm-home" — and prompts expand them to the full clauses.',
});

/* ---------- file import ---------- */

export interface SeedFilesResult {
  /** refs per character id, as dataRoot-relative posix paths */
  refs: Map<string, BibleRefs>;
  /** character ids whose VoiceDesign custom voice landed as "<id>-custom" */
  customVoices: Set<string>;
  copiedFiles: number;
  warnings: string[];
}

const IMG_EXT = /\.(png|jpg|jpeg|webp)$/i;

/** Normalize the hand-named GPT sheet files ("Version1.jpg",
 * "self-contained.jpg", grant's "slef-contained prompt.jpg") to stable
 * per-character names the bible can match on. */
const gptSheetName = (charId: string, name: string): string => {
  const ext = path.extname(name).toLowerCase();
  const base = name
    .slice(0, name.length - path.extname(name).length)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (base.includes("version1")) return `${charId}-gpt-v1${ext}`;
  if (base.includes("version2")) return `${charId}-gpt-v2${ext}`;
  if (base.includes("contained")) return `${charId}-gpt-self${ext}`;
  return `${charId}-gpt-${base}${ext}`;
};

/** Copy the videofast character art + voice ref clips into the project.
 * Never throws on a missing source — records a warning instead. Existing
 * destination files are kept (re-running the seed is cheap and idempotent);
 * refs are built from what's actually on disk afterwards, so sheets the
 * user generates later show up on the next seed run. */
export function importAnimalSitcomFiles(opts: {
  videofastDir: string;
  dataRoot: string;
  projectId: string;
}): SeedFilesResult {
  const { videofastDir, dataRoot, projectId } = opts;
  const srcRoot = path.join(videofastDir, "assets", "characters");
  const destRoot = path.join(dataRoot, "projects", projectId, "assets", "image", "characters");
  const warnings: string[] = [];
  let copiedFiles = 0;

  const copy = (src: string, dest: string) => {
    if (!fs.existsSync(src) || fs.existsSync(dest)) return;
    // zero-byte sources are aborted generations — useless as refs, and worth flagging
    if (fs.statSync(src).size === 0) {
      warnings.push(`skipped empty source file: ${src}`);
      return;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    copiedFiles += 1;
  };
  const copyDir = (srcDir: string, destDir: string, rename?: (name: string) => string) => {
    if (!fs.existsSync(srcDir)) return;
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      if (!entry.isFile() || !IMG_EXT.test(entry.name)) continue;
      copy(path.join(srcDir, entry.name), path.join(destDir, rename ? rename(entry.name) : entry.name));
    }
  };

  const refs = new Map<string, BibleRefs>();
  for (const c of ANIMAL_SITCOM_CHARACTERS) {
    const src = path.join(srcRoot, c.id);
    const dest = path.join(destRoot, c.id);
    if (!fs.existsSync(src)) {
      warnings.push(`no videofast art for "${c.id}" (${src})`);
    } else {
      for (const name of [`${c.id}-turnaround.png`, `${c.id}-hero.png`]) {
        copy(path.join(src, name), path.join(dest, name));
      }
      copy(path.join(src, "sheet", `${c.id}-sheet.png`), path.join(dest, `${c.id}-sheet.png`));
      copyDir(path.join(src, "sheet", "frames"), dest);
      // GPT re-shoot frames share names with the Qwen frames — keep both
      copyDir(path.join(src, "sheet", "gpt"), dest, (n) => n.replace(`${c.id}-`, `${c.id}-gpt-`));
      // GPT character sheets (Version1 / Version2 / self-contained boards)
      copyDir(path.join(src, "gpt"), dest, (n) => gptSheetName(c.id, n));
      copyDir(path.join(src, "dataset"), dest);
    }
    refs.set(c.id, scanRefs(dataRoot, projectId, c.id));
  }

  copyDir(path.join(srcRoot, "_group"), path.join(destRoot, "_group"));

  // voice ref clips → the global cloned-voice roster (skip ids already cast)
  const voicesDir = path.join(dataRoot, "voices");
  for (const c of ANIMAL_SITCOM_CHARACTERS) {
    const srcWav = path.join(videofastDir, "assets", "vo", "char_refs", `${c.id}.wav`);
    if (!fs.existsSync(srcWav)) {
      warnings.push(`no voice ref clip for "${c.id}" (${srcWav})`);
      continue;
    }
    copy(srcWav, path.join(voicesDir, `${c.id}.wav`));
    copy(srcWav.replace(/\.wav$/, ".txt"), path.join(voicesDir, `${c.id}.txt`));
  }

  // VoiceDesign custom voices (bakeoff mp3s) → "<id>-custom" roster entries;
  // the roster is wav-only, so decode through ffmpeg (PATH)
  const customVoices = new Set<string>();
  for (const c of ANIMAL_SITCOM_CHARACTERS) {
    const srcMp3 = path.join(
      videofastDir, "audio", "bakeoff", "out", "custom_voices", `${c.name}_voice.mp3`,
    );
    const destWav = path.join(voicesDir, `${c.id}-custom.wav`);
    if (fs.existsSync(destWav)) {
      customVoices.add(c.id);
      continue;
    }
    if (!fs.existsSync(srcMp3)) {
      warnings.push(`no custom voice for "${c.id}" (${srcMp3})`);
      continue;
    }
    fs.mkdirSync(voicesDir, { recursive: true });
    const res = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", srcMp3, destWav], {
      stdio: "ignore",
      timeout: 30_000,
    });
    if (res.status === 0 && fs.existsSync(destWav)) {
      customVoices.add(c.id);
      copiedFiles += 1;
    } else {
      warnings.push(`ffmpeg could not convert the custom voice for "${c.id}" — is ffmpeg on PATH?`);
    }
  }

  return { refs, customVoices, copiedFiles, warnings };
}

/** Build a character's refs from what's on disk in the project tree. */
function scanRefs(dataRoot: string, projectId: string, charId: string): BibleRefs {
  const dir = path.join(dataRoot, "projects", projectId, "assets", "image", "characters", charId);
  const rel = (name: string) =>
    ["projects", projectId, "assets", "image", "characters", charId, name].join("/");
  const refs: BibleRefs = {
    keyframeRef: null,
    turnaround: null,
    hero: null,
    sheet: null,
    frames: [],
    dataset: [],
    custom: [],
  };
  if (!fs.existsSync(dir)) return refs;
  const gpt: Record<string, string> = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !IMG_EXT.test(entry.name)) continue;
    const base = entry.name.replace(/\.[^.]+$/, "");
    if (base === `${charId}-turnaround`) refs.turnaround = rel(entry.name);
    else if (base === `${charId}-hero`) refs.hero = rel(entry.name);
    else if (base === `${charId}-sheet`) refs.sheet = rel(entry.name);
    else if (new RegExp(`^${charId}_\\d+$`).test(base)) refs.dataset.push(rel(entry.name));
    else {
      const gptSuffix = base.toLowerCase().startsWith(`${charId}-gpt-`)
        ? base.toLowerCase().slice(`${charId}-gpt-`.length)
        : null;
      if (gptSuffix) gpt[gptSuffix] = rel(entry.name);
      refs.frames.push(rel(entry.name));
    }
  }
  refs.frames.sort();
  refs.dataset.sort();
  // the storyboard subject reference, best-first: the locked GPT single hero
  // frame (S1), then the GPT boards the user picked (self-contained / v1),
  // then the older hero/turnaround art
  refs.keyframeRef =
    gpt["s1"] ?? gpt["self"] ?? gpt["v1"] ?? refs.hero ?? refs.turnaround ?? refs.sheet ?? null;
  return refs;
}
