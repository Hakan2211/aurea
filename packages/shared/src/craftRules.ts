/* The craft-rule table — measured facts about what the engines do with a
 * prompt, written as rows the composer runs LAST, after every other clause.
 *
 * Until 2026-09-02 these lived in notes and in people's heads: "say stays
 * seated", "no camera LoRA on 2.5", "past 7s hold the background", "the
 * enhancer flattens multi-shot prose". Each one was learned from a render
 * that cost minutes and forgotten by the next session. A rule here is a row:
 * an id, the engines and composer modes it applies to, a check or a rewrite,
 * and the WHY with the date it was measured, so the note a composer emits
 * ("Rule stays-seated changed the prompt: …") can be traced to the evidence.
 *
 * Two kinds:
 *   • `rewrite` rules change the prompt or the payload, idempotently — running
 *     the table twice over the same prompt changes nothing the second time;
 *   • `lint` rules only speak. They fire on prompts a human wrote around the
 *     composer, or on shapes the composer cannot fix on its own (a silent 2.5
 *     shot needs a sound cue the operator has to choose).
 *
 * Pure and dependency-free (types only) so every composer — shared and core —
 * can call it without a cycle. */

import type { Bible, BibleLocation, CameraSpec, Shot } from "./index.js";

/** which composer produced the prompt — the rules are mode-specific */
export type CraftMode =
  | "keyframe"
  | "i2v-single"
  /** the Freeform composer with no start frame (freeform.ts) */
  | "t2v"
  | "multi-shot"
  | "director"
  | "h3"
  | "coverage";

/** a prompt that names what the scene SOUNDS like. LTX 2.5 renders named
 * ambience (the kettle's hiss and whistle landed at mean −23 dB, 2026-09-02);
 * it is silent only when the prompt says nothing about sound at all. The
 * list is the vocabulary a sound cue is written in, not every noise a scene
 * could make — a miss here costs a note, not a render. */
export const NAMES_SOUND =
  /\b(sounds?|audio|ambien(?:ce|t)|room tone|soundscape|noise|hiss(?:es|ing)?|hums?|humming|whistl(?:e|es|ing)|rumbl(?:e|es|ing)|crackl(?:e|es|ing)|sizzl(?:e|es|ing)|creak(?:s|ing)?|drip(?:s|ping)?|buzz(?:es|ing)?|tick(?:s|ing)?|roar(?:s|ing)?|clatter(?:s|ing)?|rustl(?:e|es|ing)|chatter|murmur(?:s|ing)?|footsteps|birdsong|traffic noise|wind (?:in|through|over)|rain (?:on|against)|waves? (?:break|lap)|music|silence|silent|quiet)\b/i;

export interface CraftContext {
  prompt: string;
  mode: CraftMode;
  /** "ltx2" | "ltx25" | "minimax-h3" | … ; absent for a keyframe */
  engine?: string;
  durationSec?: number;
  /** the shot has dialogue lines / placed takes — silence is a defect then */
  hasDialogue?: boolean;
  /** an audio bed or Director audio lane is attached */
  hasAudio?: boolean;
  /** payload fields the rules may rewrite */
  enhance?: boolean;
  cameraLora?: unknown;
  director?: unknown;
  camera?: Partial<CameraSpec>;
  shot?: Shot;
  bible?: Bible;
  location?: BibleLocation;
  /** coverage bearings requested, in degrees */
  bearings?: number[];
}

export interface CraftPatch {
  prompt?: string;
  enhance?: boolean | undefined;
  /** true = strip the camera LoRA */
  dropCameraLora?: boolean;
  /** true = strip the Director timeline */
  dropDirector?: boolean;
}

export interface CraftRule {
  id: string;
  kind: "lint" | "rewrite";
  /** what was measured, in one sentence, with the date */
  why: string;
  modes?: CraftMode[];
  engines?: string[];
  /** return null when the rule does not fire; a rewrite returns its patch
   * plus what it did, a lint returns only what it saw */
  run(ctx: CraftContext): { what: string; patch?: CraftPatch } | null;
}

export interface CraftResult {
  prompt: string;
  enhance: boolean | undefined;
  dropCameraLora: boolean;
  dropDirector: boolean;
  /** ids of every rule that fired, in table order */
  rulesFired: string[];
  /** one line per fired rule, in the shape the Desk drawer groups on */
  notes: string[];
}

/* ---------- helpers ---------- */

const has = (prompt: string, re: RegExp) => re.test(prompt);
const sentence = (s: string) => `${s.trim().replace(/\.+$/, "")}.`;
const appendSentence = (prompt: string, s: string) =>
  `${prompt.trim().replace(/\s+$/, "")} ${sentence(s)}`.trim();

/** the clause ia2v adds past 7s — one string so idempotence is a substring test */
export const BACKGROUND_HOLD_CLAUSE =
  "The room behind them, the framing and the lighting stay exactly as they are in the first frame throughout, nothing in the set changes.";
/** past this length a motion-only prompt lets the set dissolve (FN15-3) */
export const BACKGROUND_HOLD_AFTER_SEC = 7;

export const STAYS_SEATED_CLAUSE = "They stay seated throughout.";
const SEATED_TRIGGER =
  /\b(shift|shifts|shifting|settle|settles|settling|adjust|adjusts|adjusting|lean|leans|leaning|slump|slumps)\b[^.;]{0,40}\b(chair|seat|sofa|couch|stool|bench)\b/i;
const SEATED_ALREADY = /\bstays? seated\b|\bremains? seated\b/i;

/** words that name a text-bearing object — Krea2 and qwen-edit paint text on them */
const TEXT_OBJECT =
  /\b(sign|signage|signboard|billboard|poster|banner|newspaper|magazine|book title|headline|caption|subtitle|label|logo|menu board|whiteboard|chalkboard|blackboard|screen text|monitor text|nameplate|name tag|lower[- ]third|station bug|ticker)\b/i;

/** wardrobe / set tokens the start frame already carries — an i2v prompt that
 * repeats them describes a wide standing shot and beats the frame */
function repeatsTheFrame(ctx: CraftContext): string | null {
  const p = ctx.prompt.toLowerCase();
  const style = (ctx.location?.stylePrompt || ctx.location?.description || "").trim();
  if (style) {
    const clauses = style
      .split(/[.,;]/)
      .map((c) => c.trim().toLowerCase())
      .filter((c) => c.split(/\s+/).length >= 3);
    const hit = clauses.find((c) => p.includes(c));
    if (hit) return `the set clause "${hit}"`;
  }
  const wardrobe = (ctx.shot?.characters ?? [])
    .map((id) => ctx.bible?.characters.find((c) => c.id === id)?.wardrobe ?? "")
    .flatMap((w) => w.split(/[,;]/))
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.split(/\s+/).length >= 3);
  // the first wardrobe clause is the speaker phrase's identity anchor and is
  // allowed; a SECOND clause is the head-to-toe list the frame already has
  const extra = wardrobe.slice(1).find((w) => p.includes(w));
  if (extra) return `the wardrobe clause "${extra}"`;
  if (/\bshallow depth of field\b|\bdeep focus\b|\bbokeh\b|\b35mm film grain\b/i.test(ctx.prompt))
    return "a lens clause";
  return null;
}

/* ---------- the table ---------- */

export const CRAFT_RULES: CraftRule[] = [
  {
    id: "motion-only-i2v",
    kind: "lint",
    modes: ["i2v-single"],
    why: "An i2v prompt that repeats the set, wardrobe or lens describes a wide standing shot and beats the start frame — every pilot take drifted inside half a second (Field Note 15, 2026-09-02).",
    run(ctx) {
      const hit = repeatsTheFrame(ctx);
      return hit
        ? { what: `the prompt repeats ${hit}, which the start frame already carries — expect the take to abandon its board` }
        : null;
    },
  },
  {
    id: "background-hold-7s",
    kind: "rewrite",
    modes: ["i2v-single"],
    why: "Past ~7s a motion-only prompt has nothing holding the set together and LTX dissolves it into grey — FN15-3 failed at 8s and held at 6s (2026-09-02).",
    run(ctx) {
      if ((ctx.durationSec ?? 0) <= BACKGROUND_HOLD_AFTER_SEC) return null;
      if (ctx.prompt.includes(BACKGROUND_HOLD_CLAUSE)) return null;
      return {
        what: `${ctx.durationSec}s is past ${BACKGROUND_HOLD_AFTER_SEC}s — a background-hold clause was added`,
        patch: { prompt: appendSentence(ctx.prompt, BACKGROUND_HOLD_CLAUSE) },
      };
    },
  },
  {
    id: "stays-seated",
    kind: "rewrite",
    modes: ["i2v-single", "t2v", "multi-shot", "director", "h3"],
    why: "Both LTX engines turn 'shifts in his chair' / 'settles' / 'adjusts' into leaving the chair; 'stays seated' holds the blocking (A/B 2026-09-02).",
    run(ctx) {
      if (!has(ctx.prompt, SEATED_TRIGGER) || has(ctx.prompt, SEATED_ALREADY)) return null;
      return {
        what: `a seat adjustment is described — "${STAYS_SEATED_CLAUSE}" was appended so the character does not leave the chair`,
        patch: { prompt: appendSentence(ctx.prompt, STAYS_SEATED_CLAUSE) },
      };
    },
  },
  {
    id: "named-beat-lipsync",
    kind: "lint",
    modes: ["i2v-single", "director"],
    why: "ia2v only articulates the mouth of a NAMED speaker at the beat; a pronoun gives a closed mouth (2026-08-23).",
    run(ctx) {
      if (!ctx.hasDialogue) return null;
      if (!/\b(he|she|they)\s+(talks?|speaks?|says|is speaking|are speaking)\b/i.test(ctx.prompt)) return null;
      return { what: "a speaking beat uses a pronoun — name the speaker at the beat or the mouth stays closed" };
    },
  },
  {
    id: "enhance-off-multishot",
    kind: "rewrite",
    modes: ["multi-shot"],
    why: "The Gemma prompt enhancer flattens multi-shot prose to zero cuts and drops a line (measured 2026-08-31).",
    run(ctx) {
      if (ctx.enhance === false) return null;
      return { what: "the enhancer was turned off — it rewrites away the cut structure", patch: { enhance: false } };
    },
  },
  {
    id: "enhance-on-single",
    kind: "lint",
    modes: ["i2v-single", "t2v", "director"],
    engines: ["ltx25"],
    why: "On single-take 2.5 prompts the enhancer helps rather than hurts (measured 2026-09-02); a lane that turns it off on a single is giving something away.",
    run(ctx) {
      return ctx.enhance === false
        ? { what: "the enhancer is off on a single take — on 2.5 singles it measured better on; leave it on unless the prompt is multi-shot prose" }
        : null;
    },
  },
  {
    id: "no-camera-lora-25",
    kind: "rewrite",
    engines: ["ltx25"],
    modes: ["i2v-single", "t2v", "multi-shot", "director"],
    why: "The camera LoRAs are 2.3-trained and the Director node pack is 2.3-only; the 2.5 adapter hard-errors on either (pilot defect #6, 2026-09-02). The move is described in prose instead.",
    run(ctx) {
      const lora = ctx.cameraLora !== undefined && ctx.cameraLora !== null;
      const director = ctx.director !== undefined && ctx.director !== null;
      if (!lora && !director) return null;
      const dropped = [lora && "the camera LoRA", director && "the Director timeline"].filter(Boolean).join(" and ");
      return {
        what: `${dropped} dropped — LTX 2.5 refuses both; the camera move stays in the prompt as prose`,
        patch: { dropCameraLora: lora, dropDirector: director },
      };
    },
  },
  {
    id: "push-in-strength",
    kind: "lint",
    engines: ["ltx25"],
    modes: ["i2v-single"],
    why: "On 2.5 a prose push-in is strong (x1.26 over 8s) and ends tighter than the lane's MCU; shorten the shot to ~6s or lock it off (FN15-2 verify, 2026-09-02).",
    run(ctx) {
      const move = (ctx.camera?.move ?? ctx.shot?.camera.move ?? "").toLowerCase();
      if (!/push-in|dolly-in|push in/.test(move)) return null;
      if ((ctx.durationSec ?? 0) <= 6) return null;
      return { what: `a push-in over ${ctx.durationSec}s will end tighter than the framing asked for — cap the shot at 6s or use move: static for a locked confessional` };
    },
  },
  {
    id: "silence-25",
    kind: "lint",
    engines: ["ltx25"],
    modes: ["i2v-single", "t2v", "multi-shot", "director"],
    why: "LTX 2.5 emits digital silence (−91 dB) on a no-dialogue shot whose prompt names no sound, where 2.3 makes room tone (A/B 2026-09-02); a prompt that NAMES its ambience renders it (the kettle, mean −23 dB, same day).",
    run(ctx) {
      if (ctx.hasDialogue || ctx.hasAudio) return null;
      if (NAMES_SOUND.test(ctx.prompt)) return null;
      return { what: "no dialogue, no audio bed and no sound cue in the prompt — this take will be silent on 2.5; name the ambient sound in one clause, or add a room-tone slot" };
    },
  },
  {
    id: "no-text-objects",
    kind: "lint",
    modes: ["keyframe"],
    why: "Naming a text-bearing object in a Krea2 / qwen-edit prompt paints legible text on it, and burned-in text is an automatic retake (Krea2 guard rails).",
    run(ctx) {
      const m = ctx.prompt.match(TEXT_OBJECT);
      return m ? { what: `"${m[0]}" names a text-bearing object — expect legible text painted on it` } : null;
    },
  },
  {
    id: "coverage-180",
    kind: "lint",
    modes: ["coverage"],
    why: "Past ~180° the coverage pass invents the wall the plate never showed — far bearings are continuity-safe for the cast, not for the room (V3 measure, 2026-09-02).",
    run(ctx) {
      const far = (ctx.bearings ?? []).filter((b) => b > 180);
      return far.length
        ? { what: `bearings ${far.map((b) => `${b}°`).join(", ")} look at a wall the plate never showed — cast holds, the room is invented` }
        : null;
    },
  },
];

/** Run the table over a composed prompt. Rewrites are applied in table
 * order; every fired rule leaves one note in the Desk's own format. */
export function applyCraftRules(input: CraftContext, rules: CraftRule[] = CRAFT_RULES): CraftResult {
  let ctx: CraftContext = { ...input };
  let dropCameraLora = false;
  let dropDirector = false;
  const rulesFired: string[] = [];
  const notes: string[] = [];

  for (const rule of rules) {
    if (rule.modes && !rule.modes.includes(ctx.mode)) continue;
    if (rule.engines && (!ctx.engine || !rule.engines.includes(ctx.engine))) continue;
    const hit = rule.run(ctx);
    if (!hit) continue;
    rulesFired.push(rule.id);
    if (hit.patch) {
      if (hit.patch.prompt !== undefined) ctx = { ...ctx, prompt: hit.patch.prompt };
      if ("enhance" in hit.patch) ctx = { ...ctx, enhance: hit.patch.enhance };
      if (hit.patch.dropCameraLora) {
        dropCameraLora = true;
        ctx = { ...ctx, cameraLora: undefined };
      }
      if (hit.patch.dropDirector) {
        dropDirector = true;
        ctx = { ...ctx, director: undefined };
      }
      notes.push(`Rule ${rule.id} changed the prompt: ${hit.what}. Why: ${rule.why}`);
    } else {
      notes.push(`Rule ${rule.id}: ${hit.what}. Why: ${rule.why}`);
    }
  }

  return { prompt: ctx.prompt, enhance: ctx.enhance, dropCameraLora, dropDirector, rulesFired, notes };
}

/** the rule a note came from, or null for an ordinary composer note */
export function ruleOfNote(note: string): { id: string; changed: boolean } | null {
  const m = note.match(/^Rule ([a-z0-9-]+)( changed the prompt)?:/);
  return m ? { id: m[1], changed: Boolean(m[2]) } : null;
}

export function craftRule(id: string): CraftRule | undefined {
  return CRAFT_RULES.find((r) => r.id === id);
}
