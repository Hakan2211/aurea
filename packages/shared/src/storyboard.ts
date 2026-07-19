/* Storyboard prompt composition — pure functions shared by studiod (the
 * studio.board.generate mutation) and the renderer (live prompt preview in
 * the Storyboard screen), so what the user reads is exactly what the engine
 * gets. Mirrors the proven videofast QIE recipe (gen_ref_scene.py): address
 * the subject as "this exact <species> character", restate the identity
 * anchors, then scene + camera + art direction. */

import type { Bible, BibleCharacter, BibleLocation, CameraSpec, Scene, Shot } from "./index.js";

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

const cameraPhrase = (camera: CameraSpec): string =>
  [camera.shotSize, camera.angle, camera.lens, camera.lighting, camera.notes]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");

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

  const camera = cameraPhrase(shot.camera);
  if (camera) parts.push(camera);

  if (bible.style.artDirection) parts.push(bible.style.artDirection);

  return parts.filter(Boolean).join(". ");
}
