/* A boarded shot → the MOTION-ONLY prompt an image-to-video take wants.
 *
 * The acceptance pilot (2026-09-02, Field Note 15) found this the hard way.
 * `composeShotSpec` writes a Director anchor: the location's whole style
 * prompt, every character head to toe, the lens and the light — a description
 * of a WIDE STANDING SHOT. Handed to an ia2v render whose first frame is a
 * tight single, that anchor beats the frame: within half a second the subject
 * stood up, the camera pulled back and the set re-invented itself. Every take
 * on the composed prompt drifted; a motion-only paragraph fixed it outright,
 * and delivered the tight framing the boarder wouldn't give.
 *
 * The cinematography bank already stated the rule that was being broken:
 * "In i2v the locked still already decided composition and lighting — the
 * video prompt's only job is motion."
 *
 * So this composer writes ONLY what changes over the take:
 *   • the named-beat lip-sync wording, verbatim from `planDialogue` — the
 *     speaker is named, everyone else is told to keep their mouth closed
 *     (measured 2026-07-25; a pronoun gives a closed mouth);
 *   • the camera MOVE, if the board asked for one;
 *   • accumulated desk direction, which is written as instruction;
 *   • past ~7s, one background-hold clause. Also measured on the pilot:
 *     FN15-3 dissolved into grey limbo at 8s and held at 6s.
 * and never the set, the wardrobe, the lens or the look — all four are
 * already in the frame the render starts from.
 *
 * Pure — the caller measures take lengths and builds the voice bed. */

import { planDialogue, type PlannedLine, type ShotTakeInput } from "./shotSpec.js";
import { cineClause, shotCharacters, shotLocation } from "./storyboard.js";
import { applyCraftRules } from "./craftRules.js";
import type { Bible, CameraSpec, Scene, Shot } from "./index.js";

export interface Ia2vShotOptions {
  durationSec?: number;
  takes?: ShotTakeInput[];
  gapSec?: number;
  leadInSec?: number;
  /** camera ids from a lane preset, under the shot's own */
  camera?: Partial<CameraSpec>;
}

export interface ComposedIa2vShot {
  prompt: string;
  startFrame: string | null;
  durationSec: number;
  /** the placed lines, so the caller can lay the voice bed on the same clock */
  planned: PlannedLine[];
  notes: string[];
  /** craft-rule ids that fired on this prompt (see craftRules.ts) */
  rulesFired: string[];
}

const DEFAULT_GAP = 0.6;
const DEFAULT_LEAD_IN = 1;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function composeIa2vShot(
  shot: Shot,
  scene: Scene | undefined,
  bible: Bible,
  options: Ia2vShotOptions = {},
): ComposedIa2vShot {
  const notes: string[] = [];
  const gapSec = Math.max(0, options.gapSec ?? DEFAULT_GAP);
  const leadInSec = Math.max(0, options.leadInSec ?? DEFAULT_LEAD_IN);
  const cast = shotCharacters(shot, bible);
  const camera: Partial<CameraSpec> = { ...options.camera, ...nonEmpty(shot.camera) };

  const plan = planDialogue(shot, cast, { takes: options.takes, gapSec, leadInSec }, notes);
  let { planned } = plan;
  const { estimated } = plan;
  /* ia2v lip-syncs to the AUDIO. A line with no take is not in the audio, so
   * describing it ("Milo talks, mouth moving…") only animates a mouth over
   * silence — the Milo confessional of 2026-11-10 talked for five seconds
   * with nothing on the track. Once any line is recorded, the take is the
   * shot: the unrecorded lines leave the prompt and the clock closes up.
   * (A shot with NO takes keeps every line: 2.5 scores it itself.) */
  const voiced = planned.filter((p) => p.takeIndex !== -1);
  if (voiced.length && voiced.length < planned.length) {
    const dropped = planned.length - voiced.length;
    const explicit = new Set(
      voiced.filter((p) => options.takes?.[p.takeIndex]?.atSec !== undefined).map((p) => p.takeIndex),
    );
    let cursor = leadInSec;
    planned = voiced.map((p) => {
      const atSec = explicit.has(p.takeIndex) ? p.atSec : cursor;
      cursor = atSec + p.lengthSec + gapSec;
      return { ...p, atSec };
    });
    notes.push(
      `${dropped} unrecorded line${dropped === 1 ? " was" : "s were"} left out: an ia2v take lip-syncs to its audio, so only the recorded line${voiced.length === 1 ? "" : "s"} ${voiced.length === 1 ? "is" : "are"} performed. Table-read the rest to include ${dropped === 1 ? "it" : "them"}.`,
    );
  } else if (estimated > 0) {
    notes.push(
      `${estimated} line${estimated === 1 ? " has" : "s have"} no voice take — ${
        estimated === 1 ? "its beat is" : "their beats are"
      } timed from the word count. Record them and recompose to lock the lip-sync.`,
    );
  }

  const last = planned[planned.length - 1];
  const needed = last ? last.atSec + last.lengthSec + Math.max(gapSec, 0.5) : 5;
  const durationSec = Math.min(30, Math.max(1, Math.ceil(options.durationSec ?? needed)));

  /* --- the paragraph ---------------------------------------------------
   * Beats in clock order, each one already written as "who talks, who keeps
   * their mouth shut". Nothing else about the picture is asserted. */
  const sentences: string[] = [];

  const action = shot.scriptLines
    .filter((l) => l.character === null && l.text.trim())
    .map((l) => l.text.trim())
    .join(" ");
  if (action) sentences.push(period(action));
  else if (planned.length && (planned[0]?.atSec ?? 0) > 0.05 && cast.length) {
    /* NAMES only. The full identity anchor belongs in the beat that carries a
     * line — that is what localises lip-sync — but repeating a head-to-toe
     * wardrobe clause here is the very thing that beats the start frame. */
    const names = cast.map((c) => c.name);
    sentences.push(
      `${joinNames(names)} ${names.length === 1 ? "holds" : "hold"} still for a beat before speaking.`,
    );
  }

  for (const line of planned) sentences.push(line.prompt);

  /* The move is the one framing fact an i2v prompt is allowed: it describes
   * a change, which is exactly what the still can't carry. The bank's clauses
   * are already written as noun phrases ("slow smooth push-in toward the
   * subject"), so they stand as their own sentence. */
  const moveClause = cineClause(bible.cinematography.moves, camera.move ?? "");
  sentences.push(
    moveClause
      ? `${moveClause.charAt(0).toUpperCase()}${moveClause.slice(1).replace(/\.$/, "")}.`
      : "Static camera, locked off, no camera movement.",
  );

  /* Desk direction is instruction, and instruction is motion — it belongs in
   * an i2v prompt where the set description does not. */
  const direction = shot.takeNotes.map((n) => n.trim()).filter(Boolean);
  if (direction.length) {
    sentences.push(period(`Direction: ${direction.map((d) => d.replace(/\.$/, "")).join("; ")}`));
  }

  const selected =
    shot.keyframes.find((k) => k.id === shot.selectedKeyframe) ??
    shot.keyframes.find((k) => k.approved) ??
    shot.keyframes[shot.keyframes.length - 1];
  const startFrame = selected?.asset ?? null;
  if (!startFrame) {
    notes.push(
      "This shot has no keyframe — an ia2v take is motion over a locked still, so board it first.",
    );
  }

  notes.push(
    "Motion-only prompt: the set, wardrobe, lens and look are carried by the start frame and are deliberately not described (pilot 2026-09-02).",
  );

  /* The craft-rule table runs LAST: the background hold past 7s, "stays
   * seated", the lint that catches a prompt repeating the frame. Each fired
   * rule leaves its own note with the measurement it came from. */
  const craft = applyCraftRules({
    prompt: sentences.join(" ").replace(/\s+/g, " ").trim(),
    mode: "i2v-single",
    engine: "ltx25",
    durationSec,
    hasDialogue: planned.length > 0,
    hasAudio: planned.some((p) => p.takeIndex !== -1),
    camera,
    shot,
    bible,
    location: shotLocation(shot, scene, bible),
  });
  notes.push(...craft.notes);

  return {
    prompt: craft.prompt,
    startFrame,
    durationSec,
    planned: planned.map((p) => ({ ...p, atSec: round1(p.atSec) })),
    notes,
    rulesFired: craft.rulesFired,
  };
}

/** "Bruno and Milo" — the one-name case reads as itself */
function joinNames(names: string[]): string {
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** exactly one full stop, however the source was punctuated */
const period = (text: string) => `${text.trim().replace(/\.+$/, "")}.`;

function nonEmpty(camera: CameraSpec): Partial<CameraSpec> {
  return Object.fromEntries(
    Object.entries(camera).filter(([, v]) => typeof v === "string" && v.trim()),
  ) as Partial<CameraSpec>;
}
