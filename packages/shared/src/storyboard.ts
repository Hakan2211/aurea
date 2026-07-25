/* Storyboard prompt composition — pure functions shared by studiod (the
 * studio.board.generate mutation) and the renderer (live prompt preview in
 * the Storyboard screen), so what the user reads is exactly what the engine
 * gets. Mirrors the proven videofast QIE recipe (gen_ref_scene.py): address
 * the subject as "this exact <species> character", restate the identity
 * anchors, then scene + camera + art direction. */

import type {
  Bible,
  BibleCharacter,
  BibleCinematography,
  BibleLocation,
  CameraSpec,
  CineClause,
  Scene,
  Shot,
} from "./index.js";

/** QIE takes at most 3 reference images (subject / scene / style). */
export const MAX_KEYFRAME_REFS = 3;

const byId = <T extends { id: string }>(list: T[], id: string | null | undefined): T | undefined =>
  id ? list.find((x) => x.id === id) : undefined;

export function shotCharacters(shot: Shot, bible: Bible): BibleCharacter[] {
  return shot.characters
    .map((id) => byId(bible.characters, id))
    .filter((c): c is BibleCharacter => Boolean(c));
}

export function shotLocation(shot: Shot, scene: Scene | undefined, bible: Bible): BibleLocation | undefined {
  return byId(bible.locations, shot.location ?? scene?.location);
}

/** The best single reference image for a character, storyboard-first:
 * the designated keyframeRef, then the clean hero, then the sheets. */
export function characterRef(c: BibleCharacter): string | null {
  return (
    c.refs.keyframeRef ??
    c.refs.hero ??
    c.refs.turnaround ??
    c.refs.sheet ??
    c.refs.frames[0] ??
    null
  );
}

/** Reference images for a shot: up to two character subjects (script order),
 * then a location still if the budget allows — QIE's multi-ref stack. */
export function resolveKeyframeRefs(shot: Shot, scene: Scene | undefined, bible: Bible): string[] {
  const refs: string[] = [];
  for (const c of shotCharacters(shot, bible)) {
    if (refs.length >= 2) break;
    const ref = characterRef(c);
    if (ref && !refs.includes(ref)) refs.push(ref);
  }
  const locationRef = shotLocation(shot, scene, bible)?.refs[0];
  if (locationRef && refs.length < MAX_KEYFRAME_REFS) refs.push(locationRef);
  return refs;
}

/* ---------- cinematography-bank resolution ----------
 * Camera-spec fields stay plain strings, but once the doc-26 bank is imported
 * into the bible a value that names a bank entry — its id ("ws"), its name
 * ("WS — wide / full shot"), or the abbreviation before the dash ("WS") —
 * expands to the entry's full paste-in clause. Lighting also accepts
 * "<bank>.<entry>" ("concert.follow-spot"). Anything unrecognized passes
 * through untouched, so free-text specs keep working bank or no bank. */

const norm = (s: string) => s.trim().toLowerCase();

function findClause(list: CineClause[], value: string): CineClause | undefined {
  const v = norm(value);
  if (!v) return undefined;
  return list.find(
    (c) => norm(c.id) === v || norm(c.name) === v || norm(c.name.split("—")[0]) === v,
  );
}

function resolveLighting(cine: BibleCinematography, value: string): string | undefined {
  const v = norm(value);
  if (!v) return undefined;
  const [bankId, entryId] = v.split(".", 2);
  if (entryId) {
    const bank = cine.lighting.find((b) => norm(b.id) === bankId || norm(b.name) === bankId);
    return bank ? findClause(bank.entries, entryId)?.clause : undefined;
  }
  for (const bank of cine.lighting) {
    const hit = findClause(bank.entries, v);
    if (hit) return hit.clause;
  }
  return undefined;
}

/** Expand a camera spec's bank references to full clauses (free text passes
 * through). `move` resolves too — S-P2 video prompts consume it; the keyframe
 * still never does (the still owns framing/light, motion is the video's job). */
export function resolveCameraSpec(camera: CameraSpec, cine: BibleCinematography): CameraSpec {
  const pick = (list: CineClause[], value: string) => findClause(list, value)?.clause ?? value;
  return {
    ...camera,
    shotSize: pick(cine.shotSizes, camera.shotSize),
    angle: pick(cine.angles, camera.angle),
    move: pick(cine.moves, camera.move),
    lens: pick(cine.lenses, camera.lens),
    lighting: resolveLighting(cine, camera.lighting) ?? camera.lighting,
    notes: findClause(cine.compositions, camera.notes)?.clause ?? camera.notes,
  };
}

/** One bank entry's paste-in clause. Unknown values pass through unchanged, so
 * free text keeps working with or without an imported bank. */
export function cineClause(list: CineClause[], value: string | undefined | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  return findClause(list, raw)?.clause ?? raw;
}

/** One prompt beat's text for the LTX prompt relay: what happens, then how
 * it's shot. Same order as composeKeyframePrompt so a beat reads like the
 * storyboard line it came from.
 *
 * This is where camera ids become language — call it when COMPOSING a shot
 * spec, never when rendering one (directorSpec.promptZones[].prompt is
 * already expanded; expanding again would stack the clause twice). */
export function composeZonePrompt(
  zone: { prompt: string; shot?: string; move?: string },
  cine: BibleCinematography,
): string {
  return [
    zone.prompt.trim(),
    cineClause(cine.shotSizes, zone.shot),
    cineClause(cine.moves, zone.move),
  ]
    .filter(Boolean)
    .map((p) => p.replace(/[.,\s]*$/, ""))
    .join(", ");
}

const cameraPhrase = (camera: CameraSpec, cine: BibleCinematography): string => {
  const resolved = resolveCameraSpec(camera, cine);
  return [resolved.shotSize, resolved.angle, resolved.lens, resolved.lighting, resolved.notes]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
};

/** action/stage-direction lines (no character) describe what we see */
const actionText = (shot: Shot): string =>
  shot.scriptLines
    .filter((l) => l.character === null && l.text.trim())
    .map((l) => l.text.trim())
    .join(" ");

/** One deterministic paragraph per shot: subjects (with identity anchors),
 * the action, the setting, the camera spec, the show's art direction. */
export function composeKeyframePrompt(shot: Shot, scene: Scene | undefined, bible: Bible): string {
  const parts: string[] = [];

  const cast = shotCharacters(shot, bible).slice(0, 2);
  if (cast.length) {
    const subjects = cast.map((c, i) => {
      const anchors = [c.anchors.face || c.anchors.body, c.signatureFeature]
        .map((s) => s.trim())
        .filter(Boolean)
        .join("; ");
      const image = cast.length > 1 ? ` (reference image ${i + 1})` : "";
      return `this exact ${c.species || "animal"} character ${c.name}${image}, wearing ${
        c.wardrobe || "their signature outfit"
      }${anchors ? ` — ${anchors}` : ""}`;
    });
    parts.push(subjects.join(" and "));
  }

  const action = actionText(shot) || shot.title || shot.notes;
  if (action.trim()) parts.push(action.trim());

  const location = shotLocation(shot, scene, bible);
  if (location) parts.push(`in ${location.name}: ${location.stylePrompt || location.description}`);

  const camera = cameraPhrase(shot.camera, bible.cinematography);
  if (camera) parts.push(camera);

  if (bible.style.artDirection) parts.push(bible.style.artDirection);

  return parts
    .filter(Boolean)
    .map((p) => p.replace(/\.\s*$/, ""))
    .join(". ");
}
