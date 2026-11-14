/* The coverage pass — one approved still turned into eight on-model angles of
 * the same room and cast in a SINGLE generation.
 *
 * The problem it solves is drift, not cost. The room-coverage lane needs a
 * wide, a single and a reaction of the *same* room; today each of those is a
 * fresh keyframe generation, and every generation is another chance for the
 * lamp to move, the panelling to change pitch, or the lion's blazer to shift
 * a shade. Eight angles sampled out of one continuous take cannot drift from
 * each other, because the model only ever built the room once.
 *
 * The technique is ethanfel's H3_Cinematic_Multishot_Coverage workflow, ported
 * here as data rather than a graph JSON: H3's ref2va head is asked, in one
 * 124-frame pass, to orbit a locked subject through eight named bearings, and
 * the frame that sits in the middle of each bearing's dwell is lifted out.
 *
 * Two numbers below are the whole trick and neither is a preference:
 *
 *   • 124 frames is H3's trained block length (frameLength(5) lands on it
 *     exactly), so the model is not being asked to hold a shape for longer
 *     than it was trained to;
 *   • the offsets are the MIDDLE of each of the eight dwells, not their
 *     edges. The camera is still swinging at a boundary and the frame there
 *     is motion-blurred and half-way between two angles — which is exactly
 *     the frame a naive `length / 8` slice would pick.
 *
 * Pure data + string building; no filesystem, no probes. */

/** One bearing in the orbit. `deg` is the camera's clockwise bearing around
 * the subject from the plate's own viewpoint, which is 0. */
export interface CoverageAngle {
  /** stable id — the filename, the tag, and the Angles-tab key */
  id: string;
  deg: number;
  /** what the prompt asks for at this bearing */
  label: string;
  /** the frame lifted for this angle, 0-based, inside COVERAGE_FRAMES */
  frame: number;
}

/** H3's trained block length, and the length the workflow's offsets are
 * measured against — see the header. Do not change one without the other. */
export const COVERAGE_FRAMES = 124;

/** The eight bearings, in the order the camera visits them, each with the
 * frame at the middle of its dwell. The offsets are ethanfel's measured ones
 * (2, 15, 31, 46, 62, 77, 92, 108) — the first is 2 rather than 0 because the
 * first frames of an H3 take are still settling out of the reference. */
export const COVERAGE_ANGLES: readonly CoverageAngle[] = [
  { id: "front", deg: 0, label: "straight on, matching the reference exactly", frame: 2 },
  { id: "front-right", deg: 45, label: "three-quarters from the right", frame: 15 },
  { id: "right", deg: 90, label: "full profile from the right", frame: 31 },
  { id: "rear-right", deg: 135, label: "three-quarters from behind on the right", frame: 46 },
  { id: "rear", deg: 180, label: "from directly behind", frame: 62 },
  { id: "rear-left", deg: 225, label: "three-quarters from behind on the left", frame: 77 },
  { id: "left", deg: 270, label: "full profile from the left", frame: 92 },
  { id: "front-left", deg: 315, label: "three-quarters from the left", frame: 108 },
] as const;

/** The contact sheet's shape — 8 angles as 4 across, 2 down. */
export const COVERAGE_SHEET_COLUMNS = 4;

/** Zero-padded, angle-named, and sorted by the orbit rather than the
 * alphabet: the files are read back by a directory listing, and "01-front"
 * before "02-front-right" is the only thing that keeps the sheet in camera
 * order without a second index to trust. */
export function coverageFileName(angle: CoverageAngle, index: number): string {
  return `${String(index + 1).padStart(2, "0")}-${angle.id}`;
}

/** The prompt for a coverage pass.
 *
 * Written against `<Picture 1>` — the ref2va tag for the plate — and repeating
 * the subject line verbatim, which is the same identity rule the multi-shot
 * work arrived at independently: the model holds what it is told again, and
 * drops what it is told once.
 *
 * `subject` is the caller's one-line coverage target ("the lion at the desk;
 * keep this exact lion"). It is quoted rather than paraphrased. */
export function coveragePrompt(subject: string): string {
  const target = subject.trim().replace(/\s+/g, " ");
  const bearings = COVERAGE_ANGLES.map(
    (a, i) => `Shot ${i + 1} — ${a.deg}°: the camera is ${a.label}.`,
  ).join("\n");
  return [
    `Camera coverage pass of <Picture 1>: ${target}`,
    "",
    `Subject and set are IDENTICAL to <Picture 1> in every shot — same character, same ` +
      `wardrobe, same room, same lighting, same time of day. Nothing in the scene moves, ` +
      `changes or is added. Only the camera moves.`,
    "",
    `The camera orbits the subject once, clockwise, holding still at eight bearings and ` +
      `swinging quickly between them. It stops at each bearing long enough for the frame to ` +
      `settle. The subject stays in the centre of frame at the same size throughout.`,
    "",
    bearings,
    "",
    "Audio: room tone only. No dialogue, no music.",
  ].join("\n");
}

/** What a finished coverage pass leaves behind — one record per run, written
 * to `<dataRoot>/coverage/<id>/run.json` the way an A/B run is. The angle
 * assets are dataRoot-relative library paths, so a shot can be boarded
 * straight off one. */
export interface CoverageAngleResult {
  id: string;
  deg: number;
  frame: number;
  /** dataRoot-relative library path, once the job's output is imported */
  asset?: string;
}
