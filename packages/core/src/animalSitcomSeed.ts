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
    role: "Lead",
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
    role: "Coach",
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
    role: "Comic engine",
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
    role: "Gentle giant",
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
    role: "Visionary",
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
    role: "Sarcastic foil",
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
  /* --- Wardrobe Set B / Zoo Logic expansion cast (doc 31 §8.1) --- */
  seedChar({
    id: "alli",
    name: "Allistaire",
    species: "emperor penguin",
    role: "Strategist",
    build:
      "compact and barrel-chested, short strong flippers that work as arms, upright military " +
      "posture, webbed orange feet",
    face:
      "crisp black-and-white face mask, golden-orange ear patches sweeping down the neck, sharp " +
      "attentive slate-blue eyes, a straight orange-and-black beak",
    wardrobe:
      "a fitted navy turtleneck under a slim charcoal tactical vest with MOLLE webbing, flat matte " +
      "buckles and a chest pocket, dark slate utility trousers, black boots",
    props: "a red grease pencil clipped to the vest and a small folded briefing card",
    colors: "black-and-white plumage, golden-orange ear patches, navy, charcoal grey, orange beak and feet",
    signatureFeature:
      "the red grease pencil and folded briefing card held in his flipper against the vest webbing",
    anchors: {
      body:
        "a small squared-off chip in the LEFT edge of his upper beak and a single stray white " +
        "feather flash high on the RIGHT side of his chest, offset from the clean white bib",
      face: "the squared chip in the left beak edge",
      macro: "the squared chip in the left upper beak edge and the offset white feather flash on the right chest",
    },
    personality:
      "The tactical strategist — runs the crew's plans like briefings, thinks three moves ahead, " +
      "allergic to improvisation; commands out of care, not ego.",
    speechPattern:
      "Clipped, precise, mid-range; short declarative sentences delivered like orders, brief " +
      "pauses between beats, occasional dry command-voice snap.",
    seed: 29,
    voice: { voiceId: "alli", engine: "chatterbox", exaggeration: 0.55, cfgWeight: 0.4, deliveryNotes: "clipped and precise; command cadence, no rushing" },
  }),
  seedChar({
    id: "silas",
    name: "Silas",
    species: "tiger",
    role: "Guarded survivor",
    build: "lean and athletic with wide shoulders and a slouched hands-in-pockets stance",
    face:
      "broad orange-and-black striped face, cream muzzle and cheek ruff, guarded jade-green eyes, " +
      "ears held slightly back",
    wardrobe:
      "an oversized dark-wash denim jacket worn open over a black hoodie with the hood up, black " +
      "jeans, scuffed black high-top sneakers",
    props: "the hood up over his ears, hands buried in the jacket pockets, a thin black cord bracelet",
    colors: "burnt-orange fur with black stripes, cream muzzle, indigo denim, black, jade green",
    signatureFeature: "his guarded jade-green eyes in the shadow of the black hood, striped brow above",
    anchors: {
      body:
        "a pale mismatched patch on his LEFT forearm where the stripes grew back broken and white, " +
        "and a small clean split in the tip of his RIGHT ear",
      face: "the split right ear tip",
      macro: "the broken white stripe patch on the left forearm and the split right ear tip",
    },
    personality:
      "The guarded survivor — keeps everyone at arm's length and uses sarcasm as armor; unlike " +
      "Barney's delighted disdain his edge is defensive, and it drops when someone he trusts is hurting.",
    speechPattern:
      "Low, flat and unhurried with a sardonic lift at the end of a line; talks in short deflections, " +
      "goes quiet rather than loud when it actually matters.",
    seed: 31,
    voice: { voiceId: "silas", engine: "chatterbox", exaggeration: 0.6, cfgWeight: 0.4, deliveryNotes: "flat and low; let the sarcasm sit under the line, never mug it" },
  }),
  seedChar({
    id: "valentino",
    name: "Valentino",
    species: "hippo",
    role: "Diva",
    build: "big and rounded with a broad soft frame and a grand sweeping posture",
    face:
      "wide soft muzzle, long lashes, warm hazel eyes, small round ears, dewy well-moisturised skin " +
      "with a subtle sheen",
    wardrobe:
      "a flowing silk floral robe in a blush-and-emerald botanical print, worn open over a gold " +
      "sequined loungewear set (matching top and wide gold sequin lounge trousers), gold slide sandals",
    props:
      "oversized dark celebrity sunglasses (worn or pushed up on the head), gold hoop earrings, a " +
      "gold-capped serum bottle in one hand",
    colors: "soft grey-mauve skin, blush pink, emerald green, champagne gold, sequin sparkle",
    signatureFeature:
      "the oversized dark sunglasses pushed up on the head and the gold-capped serum bottle held in " +
      "one hand, sequins catching the light",
    anchors: {
      body:
        "a small heart-shaped cluster of freckles high on the LEFT cheek and one chipped lower-left " +
        "tusk capped in gold",
      face: "the gold-capped lower-left tusk and the heart-shaped cheek freckles",
      macro: "the gold-capped chipped lower-left tusk and the heart-shaped freckle cluster on the left cheek",
    },
    personality:
      "The luxury diva with a heart of gold — theatrical, high-maintenance and utterly generous; " +
      "fixes everyone's crisis with a spa day and means it. Uses they/them pronouns.",
    speechPattern:
      "Warm, plush and languid with big theatrical swoops; drawn-out vowels, \"darling\" as " +
      "punctuation, a delighted gasp on every reveal. Referred to as they/them.",
    seed: 37,
    voice: { voiceId: "valentino", engine: "chatterbox", exaggeration: 0.8, cfgWeight: 0.4, deliveryNotes: "plush and theatrical; stretch the vowels, land the gasps" },
  }),
  seedChar({
    id: "omar",
    name: "Omar",
    species: "elephant",
    role: "Wise elder",
    build:
      "large and slow-moving with a heavy rounded frame, a gently curled trunk, broad fanning ears " +
      "and slightly stooped shoulders",
    face:
      "deep-set kind amber-brown eyes with heavy lids and long lashes, a softly wrinkled brow, short " +
      "ivory tusks, warm slate-grey skin",
    wardrobe:
      "an oversized unbleached linen shirt with shell buttons and rolled sleeves, worn loose over " +
      "soft wide-leg oatmeal linen trousers, simple leather sandals",
    props:
      "tortoiseshell reading glasses on a beaded chain, worn low on the brow or hanging at his chest, " +
      "and a worn hardback book held in the curl of his trunk",
    colors: "warm slate-grey skin, unbleached linen cream, oatmeal, ivory, tortoiseshell brown",
    signatureFeature:
      "the tortoiseshell reading glasses on their beaded chain resting against the linen shirt, " +
      "beside the curled trunk tip",
    anchors: {
      body:
        "his LEFT tusk is worn blunt and noticeably shorter than the right, and there is a ragged " +
        "healed notch in the lower edge of his RIGHT ear like a coastline on a map",
      face: "the blunt shorter left tusk and the notched lower right ear",
      macro: "the blunted shorter left tusk and the ragged healed notch in the lower edge of the right ear",
    },
    personality:
      "The wise old soul — the crew's anchor; says one sentence after everyone else has said twenty, " +
      "and it is the one that lands. Remembers everything, judges nobody.",
    speechPattern:
      "Deep, slow and unhurried with long comfortable pauses; a low amused \"mm-hmm\" before he " +
      "answers, warm gravel underneath.",
    seed: 41,
    voice: { voiceId: "omar", engine: "chatterbox", exaggeration: 0.4, cfgWeight: 0.4, deliveryNotes: "slow and low; the pauses are the performance" },
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
