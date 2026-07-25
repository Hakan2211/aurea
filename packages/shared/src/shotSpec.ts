/* A boarded shot → a Director shot spec.
 *
 * The storyboard already knows everything a Director render needs and says it
 * in the show's own vocabulary: who is in the shot (bible characters, with the
 * wardrobe and identity anchors the character sheets were built around), what
 * they say (script lines), where it happens (a bible location), how it's framed
 * (a camera spec in the cinematography bank's ids), and what the first frame
 * looks like (the approved keyframe). This module is the one place that turns
 * all of that into a `DirectorSpec` — so "Send to Director" in the Storyboard
 * screen and the `shot_from_storyboard` tool compose the SAME shot, and neither
 * one re-invents the beat wording.
 *
 * The beat wording is not a style choice. Three renders on 2026-07-25 (V4)
 * established that LTX localises lip-sync to whichever character a beat NAMES,
 * and that the other characters keep their mouths shut only if the beat says
 * so. So a dialogue line becomes "<speaker, identified by species and wardrobe>
 * talks, mouth moving while speaking; <the others> listen in silence, mouth
 * closed" — the phrasing the two-voice breakroom shot passed on.
 *
 * Pure and dependency-free: no filesystem, no ffprobe, no ComfyUI. Take lengths
 * are measured by the caller (studiod probes them) and passed in, because a
 * voice take's length is the one fact the production documents don't hold. */

import { composeKeyframePrompt, shotCharacters, characterRef, cineClause } from "./storyboard.js";
import { castRef, MAX_SHEET_REFS } from "./refSheet.js";
import type { Bible, BibleCharacter, DirectorSpec, Scene, Shot } from "./index.js";

/** One voice take, placed. `durationSec` is measured by the caller. */
export interface ShotTakeInput {
  /** library relPath of the take */
  take: string;
  /** bible character id whose line this is; null/absent = unattributed */
  character?: string | null;
  durationSec: number;
  /** explicit placement in the shot; omitted = laid out in script order */
  atSec?: number;
}

export interface ShotSpecOptions {
  /** total shot length; omitted = long enough to hold the placed takes */
  durationSec?: number;
  takes?: ShotTakeInput[];
  /** air between consecutive lines. The default sits under the ~1.5s at which
   * LTX starts inventing dialogue into open air (V4, measured). */
  gapSec?: number;
  /** how long the shot holds before the first line lands */
  leadInSec?: number;
  /** compose cast references — only true when this machine can render them
   * (labs.video.capabilities.multiRef), since the adapter refuses otherwise */
  refs?: boolean;
  fps?: number;
  /** override the anchor prompt (defaults to the shot's composed prompt) */
  prompt?: string;
  /** boundary softness between beats: 0.001 a cut, 0.5 a dissolve */
  epsilon?: number;
}

export interface ComposedShot {
  /** the video payload's top-level prompt — the same anchor as globalPrompt */
  prompt: string;
  /** library relPath of the shot's selected keyframe, or null if unboarded */
  startFrame: string | null;
  durationSec: number;
  director: DirectorSpec;
  /** what was assumed, filled in or dropped — shown in the UI, returned to the
   * agent. Composition never fails silently; it says what it did. */
  notes: string[];
}

export const DEFAULT_GAP_SEC = 0.6;
export const DEFAULT_LEAD_IN_SEC = 1;
/** past this much open air between takes LTX improvises speech (V4) */
export const OPEN_AIR_WARN_SEC = 1.5;
/** a shot with nothing to time itself against */
const FALLBACK_DURATION_SEC = 5;
/** videoPayloadSchema's ceiling */
const MAX_DURATION_SEC = 30;
/** rough speaking rate, used only when a line has no take to measure */
const WORDS_PER_SEC = 2.6;

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** "Sterling the lion in a blue velvet blazer" — enough for LTX to tell two
 * characters apart in one frame, which is what localises lip-sync. Wardrobe is
 * cut at its first clause: the bible's full description belongs in the anchor
 * prompt, and a beat that long stops reading as an instruction. */
export function speakerPhrase(c: BibleCharacter): string {
  const wardrobe = c.wardrobe.split(/[,;]/)[0]?.trim();
  return [c.name, c.species && `the ${c.species}`, wardrobe && `in ${wardrobe}`]
    .filter(Boolean)
    .join(" ");
}

/** "Bruno and Milo" */
const joinNames = (names: string[]): string =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** The beat that puts one line in one mouth. Everyone else is told to keep
 * quiet — an unmentioned character in a shared frame mouths the line too. */
function dialogueBeat(speaker: BibleCharacter, others: BibleCharacter[], delivery: string): string {
  const listeners = others.map(speakerPhrase);
  const parts = [
    `${speakerPhrase(speaker)} talks, mouth moving while speaking${
      delivery.trim() ? `, ${delivery.trim().replace(/\.$/, "")}` : ""
    }`,
  ];
  if (listeners.length) {
    parts.push(
      `${joinNames(listeners)} ${listeners.length > 1 ? "listen" : "listens"} in silence, ${
        listeners.length > 1 ? "mouths" : "mouth"
      } closed`,
    );
  }
  return `${parts.join("; ")}.`;
}

interface PlannedLine {
  /** index into the resolved takes, or -1 when the line has no take yet */
  takeIndex: number;
  prompt: string;
  atSec: number;
  /** measured take length, or an estimate from the line's word count */
  lengthSec: number;
}

export function composeShotSpec(
  shot: Shot,
  scene: Scene | undefined,
  bible: Bible,
  options: ShotSpecOptions = {},
): ComposedShot {
  const notes: string[] = [];
  const gapSec = Math.max(0, options.gapSec ?? DEFAULT_GAP_SEC);
  const leadInSec = Math.max(0, options.leadInSec ?? DEFAULT_LEAD_IN_SEC);
  const cast = shotCharacters(shot, bible);
  const anchor = (options.prompt?.trim() || composeKeyframePrompt(shot, scene, bible)).trim();

  /* --- the first frame -------------------------------------------------
   * The selected keyframe is the shot as the board approved it; without one
   * there is nothing to render from, and the caller is told rather than handed
   * a spec the adapter will reject. */
  const selected =
    shot.keyframes.find((k) => k.id === shot.selectedKeyframe) ??
    shot.keyframes.find((k) => k.approved) ??
    shot.keyframes[shot.keyframes.length - 1];
  const startFrame = selected?.asset ?? null;
  if (!startFrame) notes.push("This shot has no keyframe — board it first, or pass a start frame.");

  /* --- the takes, in script order --------------------------------------
   * A take names its character when the caller knows it (the Director passes
   * what it generated); otherwise takes fall onto dialogue lines in order,
   * which is how a scene is recorded and how voTakes accumulate on a shot. */
  const dialogue = shot.scriptLines.filter((l) => l.character !== null && l.text.trim());
  const supplied = options.takes ?? [];
  const used = new Set<number>();
  const takeForLine = (characterId: string | null): number => {
    const byCharacter = supplied.findIndex(
      (t, i) => !used.has(i) && t.character && characterId && t.character === characterId,
    );
    const index =
      byCharacter !== -1 ? byCharacter : supplied.findIndex((t, i) => !used.has(i) && !t.character);
    if (index !== -1) used.add(index);
    return index;
  };

  /* --- beats -----------------------------------------------------------
   * One beat per line, each starting where its take does, so the picture and
   * the sound change at the same instant. A line with no take still gets a
   * beat (the shot keeps its shape while the VO is still being recorded); its
   * length is estimated from the word count and the estimate is declared. */
  const planned: PlannedLine[] = [];
  let cursor = leadInSec;
  let estimated = 0;
  for (const line of dialogue) {
    const speaker = cast.find((c) => c.id === line.character);
    if (!speaker) {
      notes.push(
        `Line "${line.text.slice(0, 32)}…" is attributed to "${line.character}", who is not in this shot's characters — skipped.`,
      );
      continue;
    }
    const takeIndex = takeForLine(line.character);
    const take = takeIndex === -1 ? undefined : supplied[takeIndex];
    if (!take) estimated += 1;
    const lengthSec =
      take?.durationSec ??
      Math.max(1, line.text.trim().split(/\s+/).length / WORDS_PER_SEC);
    const atSec = take?.atSec ?? cursor;
    planned.push({
      takeIndex,
      atSec: round1(atSec),
      lengthSec: round1(lengthSec),
      prompt: dialogueBeat(
        speaker,
        cast.filter((c) => c.id !== speaker.id),
        line.deliveryNotes,
      ),
    });
    cursor = atSec + lengthSec + gapSec;
  }
  planned.sort((a, b) => a.atSec - b.atSec);
  if (estimated > 0) {
    notes.push(
      `${estimated} line${estimated === 1 ? " has" : "s have"} no voice take — ${
        estimated === 1 ? "its beat is" : "their beats are"
      } timed from the word count. Generate the takes and recompose to lock the timing.`,
    );
  }

  /* --- length ----------------------------------------------------------
   * Long enough to hold the last line plus a beat of air, unless the caller
   * asked for a length — in which case beats that fall past the end are the
   * builder's problem to tile (fitZones drops them and says so here). */
  const last = planned[planned.length - 1];
  const needed = last ? last.atSec + last.lengthSec + Math.max(gapSec, 0.5) : FALLBACK_DURATION_SEC;
  const durationSec = clamp(
    options.durationSec ?? Math.ceil(needed),
    1,
    MAX_DURATION_SEC,
  );
  if (options.durationSec !== undefined && needed > durationSec + 0.05) {
    notes.push(
      `The lines run ${round1(needed)}s but the shot is ${durationSec}s — the last ${
        planned.filter((p) => p.atSec >= durationSec).length || 1
      } will be cut short.`,
    );
  }

  /* --- prompt zones ----------------------------------------------------
   * Beats tile the shot in order, so each one's length is the distance to the
   * next beat's start. The lead-in covers the air before the first line; the
   * builder stretches the last beat to the end, so no tail beat is written.
   *
   * The camera MOVE rides the first beat: composeKeyframePrompt (the anchor)
   * carries framing, angle, lens and light — the still's business — but never
   * the move, which is the video's. */
  const moveClause = cineClause(bible.cinematography.moves, shot.camera.move);
  const zones: DirectorSpec["promptZones"] = [];
  const action = shot.scriptLines
    .filter((l) => l.character === null && l.text.trim())
    .map((l) => l.text.trim())
    .join(" ");
  const firstStart = planned[0]?.atSec ?? durationSec;
  if (firstStart > 0.05) {
    const stillWaiting = cast.length
      ? `${joinNames(cast.map(speakerPhrase))} in frame, still, before anyone speaks.`
      : `${shot.title || "The shot"} holds before anyone speaks.`;
    zones.push({
      prompt: action || stillWaiting,
      lengthSec: round1(Math.min(firstStart, durationSec)),
      shot: "",
      move: "",
    });
  }
  for (const [i, beat] of planned.entries()) {
    const next = planned[i + 1]?.atSec ?? durationSec;
    const lengthSec = round1(Math.max(0.1, next - beat.atSec));
    zones.push({ prompt: beat.prompt, lengthSec, shot: "", move: "" });
  }
  if (zones.length && moveClause) {
    zones[0] = { ...zones[0], prompt: `${zones[0].prompt.replace(/\.$/, "")}, ${moveClause}.` };
  }

  /* --- the audio lane --------------------------------------------------
   * Only lines that actually have a take reach the lane; a beat without one is
   * a picture instruction with no sound under it, which is exactly what an
   * un-recorded line should be. */
  const audio: DirectorSpec["audio"] = planned
    .filter((p) => p.takeIndex !== -1)
    .map((p) => ({ take: supplied[p.takeIndex].take, atSec: p.atSec, trimStartSec: 0 }));
  /* Air between lines cuts both ways. Too much and LTX fills it with invented
   * speech; a negative gap means two takes are heard AT ONCE — the node mixes
   * them additively rather than letting one replace the other — and the beat
   * hands the shot to the next speaker while the previous line is still
   * running. Both are legitimate (a deliberate talk-over is authored exactly
   * this way), so both are reported rather than silently corrected. */
  let widestGap = 0;
  let deepestOverlap = 0;
  for (const [i, p] of planned.entries()) {
    const prev = planned[i - 1];
    if (!prev) continue;
    const gap = p.atSec - (prev.atSec + prev.lengthSec);
    widestGap = Math.max(widestGap, gap);
    deepestOverlap = Math.max(deepestOverlap, -gap);
  }
  if (deepestOverlap > 0.05) {
    notes.push(
      `Two lines overlap by ${round1(deepestOverlap)}s — LTX mixes takes together rather than cutting one off, so they are heard at once and the beat changes speaker mid-line. Move the later one if that wasn't the intent.`,
    );
  }
  if (widestGap > OPEN_AIR_WARN_SEC) {
    notes.push(
      `${round1(widestGap)}s of open air between lines — past ~${OPEN_AIR_WARN_SEC}s LTX invents dialogue to fill it (measured 2026-07-25). Tighten the gap or score the silence on the Timeline.`,
    );
  }

  /* --- the cast --------------------------------------------------------
   * References hold the ensemble on-model when the start frame can't — the
   * V6 acceptance put two characters in a shot whose plate was an empty room.
   * The sheet is cast only: the set is already in the start frame, and every
   * extra cell is one more thing competing for the model's attention. */
  const refs: DirectorSpec["refs"] = [];
  if (options.refs) {
    for (const c of cast) {
      if (refs.length >= MAX_SHEET_REFS) {
        notes.push(`Only the first ${MAX_SHEET_REFS} characters fit on a reference sheet.`);
        break;
      }
      const image = characterRef(c);
      if (image) refs.push(castRef(c, image));
      else notes.push(`${c.name} has no reference still in the bible — left off the cast sheet.`);
    }
  } else if (cast.length > 1) {
    notes.push(
      "Cast references are off — the shot holds character from the start frame alone. Install the Ingredients IC-LoRA to reference the ensemble.",
    );
  }

  /* Room tone is off whenever we place takes ourselves: asked to fill a gap,
   * LTX puts invented speech in it rather than the ambience the prompt asked
   * for (V4). With no takes at all there's nothing to protect — the shot scores
   * itself, which is what the classic path has always done. */
  const inpaintAudio = audio.length === 0;

  return {
    prompt: anchor,
    startFrame,
    durationSec,
    notes,
    director: {
      globalPrompt: anchor,
      negativePrompt: bible.style.negativePrompt.trim() || undefined,
      fps: options.fps ?? 24,
      keyframes: startFrame ? [{ image: startFrame, atSec: 0, strength: 1 }] : [],
      promptZones: zones,
      audio,
      refs,
      refStrength: 1,
      inpaintAudio,
      epsilon: options.epsilon ?? 0.001,
    },
  };
}
