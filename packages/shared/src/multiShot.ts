/* A boarded shot → LTX 2.5 multi-shot prose: one generation that CUTS.
 *
 * Proven on 2026-08-31 (MULTI-SHOT-PODCAST-PILOT.md): one 8s generation from a
 * single boarded keyframe produced wide → single → reaction, with cuts measured
 * at 2.54s and 4.58s, both scripted lines spoken verbatim, and the voices
 * holding across the cuts. A single-take control at the same seed cut zero
 * times, so the prose structure is causal — this is a real capability, not a
 * lucky sample. Until now it was written by hand each time.
 *
 * The rules are pooled from three independent sources that agree, which is why
 * they are enforced here rather than left as advice:
 *
 *   LTX's own guide + the pilot — one chronological prose paragraph, never a
 *   shot list; every transition NAMED in prose ("a hard cut transitions to");
 *   re-establish scale, angle, who is in frame and the light at every cut; one
 *   stable visual tag per recurring character; state audio continuity across
 *   the cut; 2-4 shots per generation.
 *
 *   joeygambino's PROMPTING.md (ComfyUI-H3-Multishot) — repeat the character
 *   and room descriptions VERBATIM in every shot; open each shot with a ~2s
 *   "airlock" before anything important; land settled with a ~2s hold; a line
 *   of dialogue never straddles a cut; and a line budget per shot length
 *   (10s ≈ 15 words, 15s ≈ 27 words — so a 5s shot cannot hold both an airlock
 *   and a line).
 *
 * The budget rules are the ones worth code: they are arithmetic, they are the
 * difference between a cut that reads and a line that gets clipped in half,
 * and nobody does the sums by hand at 1am. Violations come back as warnings
 * rather than errors — a director who wants a tight shot may have it, they
 * just shouldn't have it by accident.
 *
 * Note for every caller: a prompt from here MUST render with `enhance: false`.
 * The Gemma enhancer flattens the structure to zero cuts and drops a line
 * outright (measured, same pilot). `isMultiShotProse` detects the shape, and
 * composeShotFromBoard already forces the flag off when it matches. */

import { planDialogue, speakerPhrase, type ShotTakeInput } from "./shotSpec.js";
import { cineClause, composeCineClause, shotCharacters, shotLocation, withLook } from "./storyboard.js";
import type { Bible, BibleCharacter, CameraSpec, Scene, Shot } from "./index.js";

/** the airlock: how long a shot holds after a cut before anything matters */
export const AIRLOCK_SEC = 2;
/** words a shot of a given length can hold, measured off joeygambino's budgets
 * (10s ≈ 15 words, 15s ≈ 27 words → ~1.8 words per second of NON-airlock time) */
export const WORDS_PER_SPOKEN_SEC = 1.8;
/** past this many cuts in one generation identity starts to drift (LTX guide) */
export const MAX_SHOTS = 4;

export interface MultiShotSegment {
  /** how this framing is described in the prose */
  framing: string;
  /** who is in it, in the verbatim tags the whole paragraph reuses */
  subjects: string[];
  /** the line spoken over it, if any */
  line: { speaker: string; text: string } | null;
  lengthSec: number;
}

export interface ComposedMultiShot {
  /** the prose paragraph — one prompt, several shots */
  prompt: string;
  durationSec: number;
  startFrame: string | null;
  segments: MultiShotSegment[];
  /** rule violations, in the words a director would want to hear them */
  warnings: string[];
  notes: string[];
}

export interface MultiShotOptions {
  durationSec?: number;
  takes?: ShotTakeInput[];
  gapSec?: number;
  leadInSec?: number;
  /** camera ids from a lane preset, under the shot's own */
  camera?: Partial<CameraSpec>;
  /** the project's look; appended once, at the end, like everywhere else */
  look?: string;
}

/** How many words a shot of this length can actually carry, after the airlock
 * it has to open with. Zero means the shot is too short to speak in at all. */
export function lineBudget(lengthSec: number): number {
  return Math.max(0, Math.floor((lengthSec - AIRLOCK_SEC) * WORDS_PER_SPOKEN_SEC));
}

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** The stable visual tag for a character — the SAME string every time they
 * appear. Pronouns drift and paraphrases drift; a repeated tag is what holds
 * identity across a cut (and, separately, what localises lip-sync). */
const tagOf = (c: BibleCharacter) => speakerPhrase(c);

export function composeMultiShotProse(
  shot: Shot,
  scene: Scene | undefined,
  bible: Bible,
  options: MultiShotOptions = {},
): ComposedMultiShot {
  const notes: string[] = [];
  const warnings: string[] = [];
  const cast = shotCharacters(shot, bible);
  const camera: Partial<CameraSpec> = { ...options.camera };
  for (const [key, value] of Object.entries(shot.camera)) {
    if (typeof value === "string" && value.trim()) camera[key as keyof CameraSpec] = value;
  }

  const { planned } = planDialogue(
    shot,
    cast,
    { takes: options.takes, gapSec: options.gapSec ?? 0.6, leadInSec: options.leadInSec ?? 1 },
    notes,
  );

  const location = shotLocation(shot, scene, bible);
  /* The room, in the words every shot repeats. Verbatim repetition is the
   * whole mechanism: paraphrasing the set at the second cut is how a room
   * quietly becomes a different room. */
  const room = location
    ? `${location.name} — ${(location.stylePrompt || location.description).trim().replace(/\.$/, "")}`
    : (scene?.slugline ?? "the same room").trim();

  const openWide = cineClause(bible.cinematography.shotSizes, camera.shotSize || "ws") || "a wide shot";
  const single =
    cineClause(bible.cinematography.shotSizes, "mcu") || "a medium close-up";
  const reaction = cineClause(bible.cinematography.shotSizes, "cu") || "a close-up";

  /* --- the segments ----------------------------------------------------
   * A wide to open (it establishes the room and the whole ensemble at once),
   * then one shot per line: the speaker's single, and — for a line answering
   * another character — the framing tightens. One line per shot, never
   * straddling a cut. */
  const segments: MultiShotSegment[] = [];
  const openLength = Math.max(AIRLOCK_SEC, planned[0]?.atSec ?? AIRLOCK_SEC);
  segments.push({
    framing: openWide,
    subjects: cast.map(tagOf),
    line: null,
    lengthSec: Math.round(openLength * 10) / 10,
  });
  for (const [i, line] of planned.entries()) {
    const next = planned[i + 1];
    const lengthSec =
      Math.round(
        ((next ? next.atSec : line.atSec + line.lengthSec + 0.5) - line.atSec) * 10,
      ) / 10;
    segments.push({
      framing: i === 0 ? single : i % 2 === 1 ? reaction : single,
      subjects: [tagOf(line.speaker)],
      line: { speaker: tagOf(line.speaker), text: line.text },
      lengthSec: Math.max(0.5, lengthSec),
    });
  }

  const durationSec =
    options.durationSec ??
    Math.ceil(segments.reduce((sum, s) => sum + s.lengthSec, 0) + AIRLOCK_SEC);

  /* --- the rules, checked ---------------------------------------------- */
  if (segments.length > MAX_SHOTS) {
    warnings.push(
      `${segments.length} shots in one generation — past ${MAX_SHOTS} the cast starts drifting between cuts. Split the coverage across two renders.`,
    );
  }
  if (segments.length < 2) {
    warnings.push(
      "Only one framing — this will render as a single take. Multi-shot needs at least one cut, which needs at least one line to cut to.",
    );
  }
  for (const segment of segments) {
    if (!segment.line) continue;
    const budget = lineBudget(segment.lengthSec);
    const spoken = words(segment.line.text);
    if (budget === 0) {
      warnings.push(
        `"${segment.line.text.slice(0, 40)}…" sits in a ${segment.lengthSec}s shot — under ${AIRLOCK_SEC + 1}s a shot cannot hold both its airlock and a line. Lengthen it or cut the line.`,
      );
    } else if (spoken > budget) {
      warnings.push(
        `${segment.line.speaker}'s line is ${spoken} words in a ${segment.lengthSec}s shot (budget ${budget}). It will be clipped at the cut.`,
      );
    }
  }

  /* --- the paragraph ---------------------------------------------------
   * One chronological block of prose. Every transition is NAMED, every shot
   * re-states its framing and its subjects verbatim, and the audio is stated
   * as continuous across each cut — the four things the pilot's cuts depended
   * on. Never a shot list: sluglines and numbered shots are exactly what the
   * model does not cut on. */
  const sentences: string[] = [];
  for (const [i, segment] of segments.entries()) {
    const who = segment.subjects.join(" and ");
    const framing = `${segment.framing}${who ? ` of ${who}` : ""} in ${room}`;
    if (i === 0) {
      sentences.push(
        `${cap(framing)}; the shot holds for about ${AIRLOCK_SEC} seconds, everyone settled and still`,
      );
    } else {
      sentences.push(
        `A hard cut transitions to ${framing}, the conversation continuing unbroken under the cut`,
      );
    }
    if (segment.line) {
      sentences.push(
        `${cap(segment.line.speaker)} talks, mouth moving while speaking, and says: "${segment.line.text.replace(/"/g, "'")}"`,
      );
    }
  }
  sentences.push(
    `The take lands settled, holding the last framing for about ${AIRLOCK_SEC} seconds with no new movement`,
  );

  const lit = composeCineClause({ lighting: camera.lighting, lens: camera.lens }, bible.cinematography);
  const paragraph = [sentences.join(". "), lit].filter(Boolean).join(". ");

  return {
    prompt: withLook(`${paragraph}.`, options.look ?? ""),
    durationSec,
    startFrame:
      (
        shot.keyframes.find((k) => k.id === shot.selectedKeyframe) ??
        shot.keyframes.find((k) => k.approved) ??
        shot.keyframes[shot.keyframes.length - 1]
      )?.asset ?? null,
    segments,
    warnings,
    notes: [
      ...notes,
      "Multi-shot prose must render with the Gemma enhancer OFF — it rewrites away the cut structure and drops lines (measured 2026-08-31).",
    ],
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
