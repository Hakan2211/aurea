/* The art-director composer for the Freeform front door — one image or one
 * sentence in, a render-ready prompt out, with NO bible and NO cast
 * (VIDEO-LAB-FREEFORM-PLAN.md §2.3).
 *
 * `composeShotSpec` needs a boarded shot with characters; this is its
 * sibling for the user who has a picture and a verb. It writes the same
 * sentence stream every time, in the order the engines weigh it:
 *
 *   1. subject   — t2v: the user's line verbatim. i2v: the IMAGE is the
 *                  subject, so only what CHANGES is written (the acceptance
 *                  pilot's defect: a prompt that re-describes the plate
 *                  describes a different, wider shot and beats the frame);
 *   2. motion    — one clause of what moves AND what stays, because both
 *                  engines escalate small motion into large;
 *   3. camera    — the look's cine ids (or the user's override) as prose,
 *                  expanded through the shipped bank when there is no bible;
 *   4. look      — the look prose, appended once (withLook refuses to stack);
 *   5. sound     — on H3 the block form with a soundscape line, so the clip
 *                  does not arrive silent; on LTX 2.5 the `silent` rule is
 *                  recorded for the finish layer to add room tone — unless
 *                  the user's own line names a sound (2.5 renders named
 *                  ambience, measured on the kettle; it is silent only when
 *                  nothing about sound is said);
 *   6. never     — text, captions, logos, signs: always in the negative,
 *                  never in the positive.
 *
 * The craft-rule table runs over the user's part (1 + 2) before the camera
 * and the look go on, so "stays seated" / background-hold / enhancer state
 * come from one place and the lints judge what the user wrote, not the
 * look's own lens clause. Pure: no filesystem, no probes. */

import { applyCraftRules, type CraftMode } from "./craftRules.js";
import { CINEMATOGRAPHY_BANK } from "./cinematographyBank.js";
import { composeH3Prompt } from "./h3Prompt.js";
import { composeCineClause, withLook } from "./storyboard.js";
import type { BibleCinematography, CameraSpec, MinimaxRefs, VideoPreset } from "./index.js";
import { minimaxRefLabels } from "./index.js";

export type FreeformMode = "i2v" | "t2v";

/** the negative every freeform render carries, whatever the look says */
export const NO_TEXT_NEGATIVE = "text, letters, captions, subtitles, watermark, logo, signage";

/** i2v: what the frame already settles, said once so the model keeps it */
export const FRAME_HOLD_CLAUSE = "Everything else in the frame stays as it is";
/** the camera when the look names no move and the user picked none */
export const CAMERA_HOLD_CLAUSE = "the camera holds";
/** H3 soundscape when the look does not name one */
export const DEFAULT_SOUNDSCAPE = "the natural ambient sound of the scene, no music";

/** the pieces of a look the composer reads — a VideoPreset satisfies it */
export type FreeformLook = Pick<VideoPreset, "look" | "cine" | "negative" | "payload"> &
  Partial<Pick<VideoPreset, "sound">>;

export interface FreeformInput {
  /** the line the user typed — the whole subject in t2v; in i2v it is read as
   * the motion unless `motion` is given separately */
  subject: string;
  /** i2v: what changes. When present, `subject` is NOT written — the image
   * already establishes the scene */
  motion?: string;
  mode: FreeformMode;
  look: FreeformLook;
  /** the director's own camera ids, over the look's; empty strings are ignored */
  cine?: Partial<CameraSpec>;
  /** defaults to the look's engine, then "ltx25" */
  engine?: string;
  /** defaults to the look's duration, then 5 */
  durationSec?: number;
  /** a project's bank if it has one; an empty bank falls back to the shipped one */
  bank?: BibleCinematography;
  /** an audio bed or Director lane rides along — silences the `silent` rule */
  hasAudio?: boolean;
}

export interface ComposedFreeform {
  prompt: string;
  /** LTX only — the caller drops it for engines with no negative arm */
  negative: string;
  /** what the enhancer should be — the look's explicit state after the table */
  enhance: boolean | undefined;
  engine: string;
  durationSec: number;
  /** composer facts a later stage acts on: "silent", "i2v-motion-only", "text-in-positive" */
  rules: string[];
  /** one line per decision, in the Desk's own note format where a rule fired */
  notes: string[];
}

/** words that ask the model to letter something — text is post, never a prompt */
const TEXT_IN_POSITIVE =
  /\b(caption|captions|subtitle|subtitles|logo|watermark|lower[- ]third|ticker|on[- ]screen text|the words?\b|text (?:that )?(?:reads|reading|says)|sign (?:that )?(?:reads|reading|says))\b/i;

/** "holds", "stays", "static", "locked" — the prompt already says what stays */
const SAYS_WHAT_STAYS = /\b(holds?|stays?|remains?|static|locked[- ]off|does not move|doesn't move|motionless)\b/i;
const SAYS_CAMERA = /\bcamera\b/i;

const clean = (s: string | undefined | null) => (s ?? "").trim().replace(/[.\s]+$/, "");
const sentence = (s: string) => (s ? `${s}.` : "");

/** camera ids from the look, with the user's non-empty picks over them */
function mergeCine(look: Partial<CameraSpec>, over: Partial<CameraSpec> | undefined): Partial<CameraSpec> {
  const picked = Object.fromEntries(
    Object.entries(over ?? {}).filter(([, v]) => typeof v === "string" && v.trim()),
  ) as Partial<CameraSpec>;
  return { ...look, ...picked };
}

/** a project's bank when it has entries, the shipped doc-26 bank otherwise —
 * so a look's "handheld" becomes a clause with no bible in sight */
export function freeformBank(bank: BibleCinematography | undefined): BibleCinematography {
  if (bank && (bank.moves.length || bank.shotSizes.length || bank.lenses.length)) return bank;
  return CINEMATOGRAPHY_BANK;
}

/** look negative + the text rule, deduplicated on comma boundaries, look first */
export function freeformNegative(lookNegative: string | undefined): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of `${lookNegative ?? ""}, ${NO_TEXT_NEGATIVE}`.split(",")) {
    const term = raw.trim();
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out.join(", ");
}

export function composeFreeform(input: FreeformInput): ComposedFreeform {
  const notes: string[] = [];
  const rules: string[] = [];
  const engine = input.engine ?? input.look.payload.engine ?? "ltx25";
  const durationSec = input.durationSec ?? input.look.payload.durationSec ?? 5;
  const isH3 = engine === "minimax-h3";
  const bank = freeformBank(input.bank);
  const cine = mergeCine(input.look.cine ?? {}, input.cine);

  /* 1 · subject */
  const subject = clean(input.subject);
  const motion = clean(input.motion);
  let action: string;
  if (input.mode === "i2v") {
    // the image is the subject: write what changes, never what is there
    action = motion || subject;
    rules.push("i2v-motion-only");
    if (motion && subject) {
      notes.push(
        "i2v: the subject line was not written — the start frame already establishes the scene, so only the motion is prompted.",
      );
    }
  } else {
    action = motion ? `${sentence(subject)} ${motion}`.trim() : subject;
  }

  /* 2 · motion — what stays, said once */
  const holds: string[] = [];
  if (input.mode === "i2v" && !SAYS_WHAT_STAYS.test(action)) holds.push(FRAME_HOLD_CLAUSE);
  const move = (cine.move ?? "").trim();
  if (!move && !SAYS_CAMERA.test(action)) holds.push(CAMERA_HOLD_CLAUSE);

  /* the table runs over the USER's part — action and holds — before the
   * camera and the look go on. The lints judge what the user wrote (the
   * motion-only rule would otherwise fire on the look's own lens clause,
   * which is meant to be there), and the rewrites land as sentences in the
   * action where they belong, ahead of the framing. */
  const mode: CraftMode = input.mode === "i2v" ? "i2v-single" : "t2v";
  const craft = applyCraftRules({
    prompt: [clean(action), clean(holds.join(", "))].filter(Boolean).map(sentence).join(" "),
    mode,
    engine,
    durationSec,
    hasDialogue: false,
    hasAudio: input.hasAudio ?? false,
    enhance: input.look.payload.enhance,
    camera: cine,
  });
  if (craft.rulesFired.includes("silence-25")) rules.push("silent");
  notes.push(...craft.notes);

  /* 3 · camera */
  const camera = composeCineClause(cine, bank);

  /* 4 · look */
  const body = [clean(craft.prompt), clean(camera)].filter(Boolean).map(sentence).join(" ");
  const withLookProse = withLook(body, clean(input.look.look));

  /* 6 · never — a lint, not a rewrite: the user's words stay the user's */
  const textAsk = `${subject} ${motion}`.match(TEXT_IN_POSITIVE);
  if (textAsk) {
    rules.push("text-in-positive");
    notes.push(
      `"${textAsk[0]}" asks the model to letter something — the models cannot; captions and logos are post-production, and the negative already refuses them.`,
    );
  }

  /* 5 · sound */
  let prompt: string;
  if (isH3) {
    const soundscape = clean(input.look.sound) || DEFAULT_SOUNDSCAPE;
    prompt = composeH3Prompt({
      subjects: [],
      summary: withLookProse,
      beats: [{ fromSec: 0, toSec: durationSec, action: withLookProse, lines: [] }],
      soundscape,
      music: null,
    });
    if (!clean(input.look.sound)) {
      notes.push(`H3 invents whatever sound is unsaid — the soundscape line says "${DEFAULT_SOUNDSCAPE}".`);
    }
  } else {
    prompt = withLookProse;
  }

  return {
    prompt,
    negative: freeformNegative(input.look.negative),
    enhance: craft.enhance ?? input.look.payload.enhance,
    engine,
    durationSec,
    rules,
    notes,
  };
}

/* ---------- F3 · style LoRAs ---------- */

/** The name ComfyUI wants for a LoRA a look names by FILE. A look ships with
 * the bare filename ("Fantasy_Anime.safetensors") because the install's own
 * name for it depends on where it landed and on the platform: Aurea's store
 * walks as "ltx-style-anime\loras\Fantasy_Anime.safetensors" on Windows and
 * with slashes elsewhere, and ComfyUI validates the combo value verbatim. So
 * a look never carries the path — the panel, the adapters and a script all
 * resolve it here against the live option list, and a name that is already
 * an exact option passes straight through. Undefined = not installed. */
export function resolveLoraByFile(available: readonly string[], name: string): string | undefined {
  if (available.includes(name)) return name;
  const file = name.split(/[\\/]/).pop()?.toLowerCase();
  if (!file) return undefined;
  const hits = available.filter((o) => o.split(/[\\/]/).pop()?.toLowerCase() === file);
  // two installs of the same file is an ambiguity, not a match
  return hits.length === 1 ? hits[0] : undefined;
}

/* ---------- F3 · H3 style references ---------- */

/** the wording a style still is tagged with — reference footage, never a
 * character; the palette, grade, texture and light come from it and nothing
 * in it appears in the scene */
export function styleRefClause(tag: string): string {
  return `Match the visual style of ${tag} — its palette, colour grade, surface texture and lighting — treating it as reference footage: nothing that appears in ${tag} is in this scene.`;
}

/** Every still with `role: "style"` gets its clause appended once, after the
 * user's prose, unless the prompt already addresses the tag itself (the
 * director wrote their own wording — keep it). Subject stills are untouched:
 * they are named in the prompt by the user, as before. */
export function withStyleRefs(prompt: string, refs: MinimaxRefs | undefined | null): string {
  if (!refs || !refs.images.length) return prompt;
  const labels = minimaxRefLabels(refs);
  const lower = prompt.toLowerCase();
  const clauses: string[] = [];
  refs.images.forEach((_, i) => {
    if (refs.imageRoles[i] !== "style") return;
    const tag = labels.images[i];
    if (lower.includes(tag.toLowerCase())) return;
    clauses.push(styleRefClause(tag));
  });
  if (!clauses.length) return prompt;
  return `${prompt.trimEnd()}${prompt.trim() ? " " : ""}${clauses.join(" ")}`;
}

/* ---------- F4 · the sketch tier and the seed spray ---------- */

/** the tier a seed spray renders at: 3 s (the LTX ladder's floor), draft, the
 * smallest 64-grid 16:9 canvas the engines share. Never the deliverable —
 * only enough picture to pick a seed by. A look may override it (`sketch`). */
export const SKETCH_TIER = {
  durationSec: 3,
  resolution: "896 × 704 (landscape)",
  fast: true,
} as const;

/** how many seeds one spray files — four first frames fit a contact sheet */
export const SPRAY_COUNT = 4;

/** the A/B overrides a sketch renders under: the shipped tier, then the
 * look's own `sketch` on top. Draft is spelled for both engine families
 * (LTX reads `fast`, H3 its own `minimaxTier`). */
export function sketchOverrides(
  look: Pick<VideoPreset, "sketch"> | null | undefined,
  engine: string | undefined,
): Record<string, unknown> {
  const over: Record<string, unknown> = { ...SKETCH_TIER, ...(look?.sketch ?? {}) };
  if (engine === "minimax-h3") {
    // H3's native canvas is the only one its 768-short-edge weights like
    if (!look?.sketch?.resolution) over.resolution = "1344 × 768 (16:9 · H3 native)";
    over.minimaxTier = "draft";
  }
  return over;
}

/** the variants of one spray: N seeds, each at the sketch tier. The seeds
 * are drawn HERE rather than left to the store so the caller can print
 * them — a contact sheet without the numbers on it is not a contact sheet. */
export function sprayVariants(
  look: Pick<VideoPreset, "sketch"> | null | undefined,
  engine: string | undefined,
  count = SPRAY_COUNT,
): { label: string; overrides: Record<string, unknown> }[] {
  const over = sketchOverrides(look, engine);
  return Array.from({ length: count }, () => {
    const seed = Math.floor(Math.random() * 2_147_483_647);
    return { label: `Seed ${seed}`, overrides: { ...over, seed } };
  });
}

/* ---------- the Claude enhance steer ---------- */

export interface EnhanceSteer {
  /** the project's locked art direction, when there is a project */
  art?: string;
  /** the project's negative prompt */
  negative?: string;
  /** the active look's prose — steers the expansion when there is no bible */
  look?: string;
  /** i2v: the expansion must stay motion-only */
  mode?: FreeformMode;
}

/** The system prompt behind `prompts.enhance` for video. It carries the same
 * six rules as the composer, so the expansion cannot undo what the composer
 * writes after it. Kept here so a unit test can read it and the router
 * cannot drift from the composer. */
export function videoEnhanceSystem(steer: EnhanceSteer): string {
  const i2v = steer.mode === "i2v";
  const lines = [
    "You expand terse video prompts into specific, render-ready prompts for a video diffusion model.",
    "Keep the user's subject and intent exactly. One paragraph, no lists, no preamble, no quotes. Return ONLY the improved prompt.",
    "",
    "Rules, in order of weight:",
    i2v
      ? "1. The prompt animates an existing image. The image already establishes the scene — write ONLY what changes: the motion, its pace, its size. Never describe the subject, the set, the wardrobe, the lens or the light; every such sentence pulls the model off the frame."
      : "1. Lead with the subject in one concrete sentence: who or what, where, doing what.",
    "2. Say what moves AND what stays. Small motion escalates — a shift becomes standing, a glance becomes a turn — so name the limit (\"stays seated\", \"only the hands move\", \"the camera holds\").",
    "3. Describe ONE continuous shot: one framing, one camera move, no cuts, no montage.",
    "4. Do not restate the look — it is appended after you. Do not name a film stock, grain, palette or era unless the user did.",
    "5. Name the ambient sound of the scene in one short clause (the models render audio too).",
    "6. Never ask for text, captions, subtitles, logos, signs or on-screen graphics. Never quote dialogue unless the user wrote it.",
  ];
  if (steer.look?.trim()) lines.push("", `The look this shot will be rendered in (write to it, do not repeat it):\n${steer.look.trim()}`);
  if (steer.art?.trim()) lines.push("", `This project's locked art direction (respect it):\n${steer.art.trim()}`);
  if (steer.negative?.trim()) lines.push("", `Never include: ${steer.negative.trim()}`);
  return lines.join("\n");
}
