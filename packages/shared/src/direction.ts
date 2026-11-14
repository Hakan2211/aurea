/* Retake direction — instructions, never diagnoses.
 *
 * A desk note is folded into every later render's prompt verbatim as
 * "Direction: …". That is the right mechanism (direction accumulates on the
 * shot, not in a session) with one sharp edge the pilot cut itself on: a note
 * that DESCRIBES the failure — "he stood up and the set vanished" — hands the
 * next render the words of the failure as its instruction. The playbook said
 * "write instructions"; this file makes the tool say it at the boundary.
 *
 * Two layers:
 *   • `lintDirectionNote` refuses a note that reads as a diagnosis, with the
 *     rewrite pattern in the message. `allowDiagnosis` on the call bypasses
 *     it for the rare note that is genuinely fine and merely looks wrong;
 *   • `FIX_VOCABULARY` is a short list of fixes with a MEASURED phrasing each.
 *     `retake_shot({ fix: ["stay-seated"] })` puts the phrase that held the
 *     blocking on the pilot into the prompt, spelled the way the engine
 *     honoured it. */

export const FIX_VOCABULARY = {
  "hold-framing": "hold the framing exactly as it is in the first frame, the camera does not pull back",
  "stay-seated": "stays seated throughout, does not stand up",
  "hold-set": "the room, the furniture and the lighting stay exactly as they are in the first frame, nothing in the set changes",
  tighter: "tighter framing, closer on the face",
  looser: "looser framing, a little more room around the subject",
  slower: "slower, calmer movement, let each beat land",
  static: "static camera, locked off, no camera movement",
} as const;

export type FixId = keyof typeof FIX_VOCABULARY;
export const FIX_IDS = Object.keys(FIX_VOCABULARY) as FixId[];

/** the words a diagnosis uses and an instruction does not */
const DIAGNOSIS = [
  /^\s*(the|this|that|last|previous)\s+(take|render|shot|version|one)\b/i,
  /\b(didn't|did not|doesn't|does not|wasn't|was not|weren't|isn't|couldn't|failed|failure|broke|broken|wrong|bad|ugly|drifted|abandoned|lost|dissolved|vanished|disappeared|ignored)\b/i,
  /\binstead of\b/i,
  /\bshould have\b/i,
  /^\s*(he|she|they|it)\s+\w+ed\b/i,
];

/** null when the note reads as an instruction; otherwise why it doesn't */
export function lintDirectionNote(note: string): string | null {
  const text = note.trim();
  if (!text) return null;
  const hit = DIAGNOSIS.find((re) => re.test(text));
  if (!hit) return null;
  return (
    `This note reads as a diagnosis and would be rendered verbatim as "Direction: ${text}". ` +
    `Write what to DO next time, not what went wrong — e.g. "stay seated, hold the framing", ` +
    `"static camera, no pull-back" — or pick a fix (${FIX_IDS.join(", ")}). ` +
    `Pass allowDiagnosis: true if the note really is an instruction.`
  );
}

/** the phrases a retake call actually puts on the shot: fixes first (measured
 * wording), then the free note */
export function directionPhrases(fix: readonly FixId[] | undefined, note: string | undefined): string[] {
  const out: string[] = [];
  for (const id of fix ?? []) {
    const phrase = FIX_VOCABULARY[id];
    if (phrase && !out.includes(phrase)) out.push(phrase);
  }
  const free = (note ?? "").trim();
  if (free) out.push(free);
  return out;
}
