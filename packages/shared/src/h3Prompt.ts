/* A boarded shot → the prompt shape MiniMax-H3 was trained to read.
 *
 * H3's whole control surface is the prompt: no timeline node, no audio lane,
 * no IC-LoRA. Everything you can steer, you steer by writing it down — and
 * the model was trained against a specific written FORM, which the published
 * ComfyUI workflows carry as an LLM system prompt (javawock7618's fl2va pack,
 * read 2026-09-02): labelled subject definitions, a one-line summary, an
 * interval-stamped description, dialogue wrapped in <d>…</d>, then the
 * soundscape and the non-diegetic music as their own lines.
 *
 * Until now that form lived in `labs.ts` as prose rules for whoever was
 * writing the prompt by hand, which meant every shot was a fresh act of
 * recall. This module writes it instead, off the same placed dialogue the
 * Director timeline is built from — so the two engines shoot the same shot.
 *
 * Two things carry over from the LTX work and are not style choices:
 *   • the speaker is NAMED in the beat that carries their line, and the
 *     others are told to keep their mouths closed (measured 2026-07-25; a
 *     pronoun gives a closed mouth);
 *   • the identity anchor for each subject is repeated VERBATIM, which is
 *     what the multi-shot guides all independently arrived at.
 *
 * Pure — no filesystem, no probes. Take lengths come measured from the caller,
 * exactly as composeShotSpec takes them. */

import { planDialogue, type ShotTakeInput } from "./shotSpec.js";
import { composeCineClause, shotCharacters, shotLocation } from "./storyboard.js";
import type { Bible, BibleCharacter, CameraSpec, Scene, Shot } from "./index.js";

export interface H3Subject {
  /** the name the description and every dialogue tag uses */
  name: string;
  /** the identity anchor, repeated verbatim wherever the subject appears */
  description: string;
}

export interface H3Line {
  speaker: string;
  text: string;
}

export interface H3Beat {
  fromSec: number;
  toSec: number;
  /** what happens and how it is framed */
  action: string;
  lines: H3Line[];
}

export interface H3PromptInput {
  subjects: H3Subject[];
  /** one line: the whole shot in a sentence */
  summary: string;
  beats: H3Beat[];
  /** everything heard that isn't dialogue — H3 invents whatever is unsaid */
  soundscape: string;
  /** score; null renders as "N/A", which is what a documentary shot wants */
  music: string | null;
}

const secs = (n: number) => `${Math.round(n * 10) / 10}s`;

/** `<d>Sterling: "The fund is fine."</d>` — the tag the model was trained to
 * read as "this is spoken aloud, by this character, in these words". */
const dialogueTag = (line: H3Line) => `<d>${line.speaker}: "${line.text.replace(/"/g, "'")}"</d>`;

/** The block form. Deliberately plain text rather than JSON: the published
 * workflows feed the model a paragraphed prompt, and the labels are the part
 * it keys on. */
export function composeH3Prompt(input: H3PromptInput): string {
  const blocks: string[] = [];

  if (input.subjects.length) {
    blocks.push(
      [
        "Subject definitions:",
        ...input.subjects.map((s) => `${s.name}: ${s.description.replace(/\.$/, "")}.`),
      ].join("\n"),
    );
  }

  if (input.summary.trim()) blocks.push(`Summary: ${input.summary.trim().replace(/\.$/, "")}.`);

  if (input.beats.length) {
    blocks.push(
      [
        "Detailed description:",
        ...input.beats.map((beat) => {
          const spoken = beat.lines.map(dialogueTag).join(" ");
          return `[${secs(beat.fromSec)}-${secs(beat.toSec)}] ${beat.action.replace(/\s*$/, "")}${
            spoken ? ` ${spoken}` : ""
          }`;
        }),
      ].join("\n"),
    );
  }

  blocks.push(`Overall soundscape: ${input.soundscape.trim() || "natural room tone only"}`);
  blocks.push(`Non-diegetic music: ${input.music?.trim() || "N/A"}`);

  return blocks.join("\n\n");
}

/** The identity anchor a subject definition repeats. Wider than
 * `speakerPhrase` (which is cut to one clause so a BEAT stays readable): a
 * subject definition is the one place the whole description belongs, because
 * everything after it refers back by name alone. */
function subjectOf(c: BibleCharacter): H3Subject {
  const anchors = [c.anchors.face || c.anchors.body, c.signatureFeature]
    .map((s) => s.trim())
    .filter(Boolean)
    .join("; ");
  return {
    name: c.name,
    description: [
      `a ${c.species || "animal"} character`,
      c.wardrobe ? `wearing ${c.wardrobe}` : "",
      anchors,
    ]
      .filter(Boolean)
      .join(", "),
  };
}

export interface H3ShotOptions {
  durationSec?: number;
  takes?: ShotTakeInput[];
  gapSec?: number;
  leadInSec?: number;
  /** camera ids from a lane preset, under the shot's own */
  camera?: Partial<CameraSpec>;
  /** the project's look, appended to the summary; omitted = none */
  look?: string;
  soundscape?: string;
  music?: string | null;
}

export interface ComposedH3Shot {
  prompt: string;
  durationSec: number;
  startFrame: string | null;
  input: H3PromptInput;
  notes: string[];
}

const DEFAULT_GAP = 0.6;
const DEFAULT_LEAD_IN = 1;
/** H3's own trained window; past it the shot has to be chunked */
const MAX_DURATION_SEC = 15;

export function composeH3Shot(
  shot: Shot,
  scene: Scene | undefined,
  bible: Bible,
  options: H3ShotOptions = {},
): ComposedH3Shot {
  const notes: string[] = [];
  const gapSec = Math.max(0, options.gapSec ?? DEFAULT_GAP);
  const leadInSec = Math.max(0, options.leadInSec ?? DEFAULT_LEAD_IN);
  const cast = shotCharacters(shot, bible);
  const camera: Partial<CameraSpec> = { ...options.camera, ...nonEmpty(shot.camera) };
  const cineText = composeCineClause(camera, bible.cinematography);

  const { planned, estimated } = planDialogue(
    shot,
    cast,
    { takes: options.takes, gapSec, leadInSec },
    notes,
  );
  if (estimated > 0) {
    notes.push(
      `${estimated} line${estimated === 1 ? " is" : "s are"} timed from the word count — H3 performs the dialogue itself, so the stamps are a shape, not a lock.`,
    );
  }

  const last = planned[planned.length - 1];
  const needed = last ? last.atSec + last.lengthSec + 0.5 : 5;
  const durationSec = Math.min(
    MAX_DURATION_SEC,
    Math.max(4, Math.ceil(options.durationSec ?? needed)),
  );
  if (options.durationSec === undefined && needed > MAX_DURATION_SEC) {
    notes.push(
      `The lines run ${Math.ceil(needed)}s, past H3's ${MAX_DURATION_SEC}s window — split the shot, or render it on LTX.`,
    );
  }

  /* Beats tile the shot. The lead-in is its own beat (the shot has to exist
   * before anyone speaks, and an H3 prompt with no [0s-…] stamp starts on
   * whatever it invents), and the last line's beat runs to the end. */
  const action = shot.scriptLines
    .filter((l) => l.character === null && l.text.trim())
    .map((l) => l.text.trim())
    .join(" ");
  const staging = [
    cast.length
      ? `${cast.map((c) => c.name).join(" and ")} in frame, settled, before anyone speaks`
      : shot.title || "The shot holds",
    cineText,
  ]
    .filter(Boolean)
    .join(", ");

  const beats: H3Beat[] = [];
  const firstStart = planned[0]?.atSec ?? durationSec;
  if (firstStart > 0.05) {
    beats.push({
      fromSec: 0,
      toSec: Math.min(firstStart, durationSec),
      action: action || `${staging}.`,
      lines: [],
    });
  }
  for (const [i, line] of planned.entries()) {
    const next = planned[i + 1]?.atSec ?? durationSec;
    beats.push({
      fromSec: line.atSec,
      toSec: Math.max(line.atSec + 0.1, next),
      // the measured wording: the speaker is named, the others are told to
      // keep their mouths shut, and only then is the line quoted
      action: line.prompt.replace(/\.$/, ""),
      lines: [{ speaker: line.speaker.name, text: line.text }],
    });
  }
  if (beats.length === 0) {
    beats.push({ fromSec: 0, toSec: durationSec, action: action || `${staging}.`, lines: [] });
  }

  const location = shotLocation(shot, scene, bible);
  const summary = [
    shot.title || action || "A shot",
    location ? `in ${location.name}` : "",
    cineText,
    options.look ?? "",
  ]
    .map((p) => p.trim().replace(/\.$/, ""))
    .filter(Boolean)
    .join(". ");

  const input: H3PromptInput = {
    subjects: cast.map(subjectOf),
    summary,
    beats,
    soundscape:
      options.soundscape ??
      (location
        ? `the natural room tone of ${location.name}, no music`
        : "quiet natural room tone, no music"),
    music: options.music ?? null,
  };

  const selected =
    shot.keyframes.find((k) => k.id === shot.selectedKeyframe) ??
    shot.keyframes.find((k) => k.approved) ??
    shot.keyframes[shot.keyframes.length - 1];

  if (planned.length && cast.length > 1) {
    notes.push(
      `${planned.length} line${planned.length === 1 ? "" : "s"} — each names its speaker and silences the rest, the wording lip-sync localises on.`,
    );
  }

  return {
    prompt: composeH3Prompt(input),
    durationSec,
    startFrame: selected?.asset ?? null,
    input,
    notes,
  };
}

/** drop the empty fields of a camera spec so a lane's value can show through */
function nonEmpty(camera: CameraSpec): Partial<CameraSpec> {
  return Object.fromEntries(
    Object.entries(camera).filter(([, v]) => typeof v === "string" && v.trim()),
  ) as Partial<CameraSpec>;
}
