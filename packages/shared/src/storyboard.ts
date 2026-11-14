/* Storyboard prompt composition — pure functions shared by studiod (the
 * studio.board.generate mutation) and the renderer (live prompt preview in
 * the Storyboard screen), so what the user reads is exactly what the engine
 * gets. Mirrors the proven videofast QIE recipe (gen_ref_scene.py): address
 * the subject as "this exact <species> character", restate the identity
 * anchors, then scene + camera + art direction. */

import { applyCraftRules } from "./craftRules.js";
import { COMPOSITION_SHOT_SIZES, compositionFitsShotSize } from "./cinematographyBank.js";
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

/** Bank move ids that have a camera-control LoRA counterpart. Only the moves
 * with an unambiguous physical translation map — "tracking" has no direction
 * and "orbit" has no LoRA, so they stay prompt-only. The prose clause always
 * stays in the prompt regardless: the LoRA steers, the prompt describes, and
 * on installs without camera weights (all of them, until Lightricks ships a
 * 22b set) the prompt is the whole mechanism. */
export function cameraMoveToLora(
  moveId: string,
):
  | "dolly-in"
  | "dolly-out"
  | "dolly-left"
  | "dolly-right"
  | "jib-up"
  | "jib-down"
  | "static"
  | null {
  switch (moveId) {
    case "push-in":
      return "dolly-in";
    case "pull-back":
      return "dolly-out";
    case "crane-up":
      return "jib-up";
    case "crane-down":
      return "jib-down";
    case "static":
      return "static";
    default:
      return null;
  }
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

/** The director's edit as one prose clause — what a shot picker's five
 * choices actually say to the model.
 *
 * The MOVE is included here and deliberately not in `cameraPhrase`: a still
 * has no move, so the keyframe composer leaves it out, while a video prompt is
 * the one place it belongs. Unknown ids pass through as themselves, so this
 * works before a project has imported the doc-26 bank.
 *
 * Call it when COMPOSING, once. The adapters never see bank ids. */
export function composeCineClause(
  camera: Partial<CameraSpec>,
  cine: BibleCinematography,
): string {
  return [
    cineClause(cine.shotSizes, camera.shotSize),
    cineClause(cine.angles, camera.angle),
    cineClause(cine.lenses, camera.lens),
    cineClause(cine.moves, camera.move),
    camera.lighting ? (resolveLighting(cine, camera.lighting) ?? camera.lighting) : "",
    cineClause(cine.compositions, camera.notes),
  ]
    .map((part) => part.trim().replace(/[.,\s]*$/, ""))
    .filter(Boolean)
    .join(", ");
}

/** action/stage-direction lines (no character) describe what we see */
const actionText = (shot: Shot): string =>
  shot.scriptLines
    .filter((l) => l.character === null && l.text.trim())
    .map((l) => l.text.trim())
    .join(" ");

/** The project's look in one line — the sentence every composed video prompt
 * ends with, so shots boarded weeks apart still grade the same.
 *
 * `style.lookLine` when the project set one; otherwise the first sentence of
 * the art direction, which is what a look line IS for every project that has
 * never been asked the question. Capped, because a whole art-direction
 * paragraph repeated at the end of a prompt is not a look, it is noise. */
export function projectLook(bible: Bible): string {
  const explicit = bible.style.lookLine.trim();
  if (explicit) return explicit;
  const art = bible.style.artDirection.trim();
  if (!art) return "";
  const first = art.split(/(?<=[.!?])\s+/)[0]?.trim() ?? art;
  return (first.length > LOOK_MAX ? `${first.slice(0, LOOK_MAX).trimEnd()}…` : first).replace(
    /\.$/,
    "",
  );
}

/** how much look line is still a look line */
const LOOK_MAX = 160;

/** Append the look ONCE. The art direction is already inside a keyframe-
 * composed prompt, and a derived look is its first sentence — so appending
 * blind would say the same thing twice in the same paragraph. This is the
 * same no-stacking rule the adapters live under: the composer owns the tail
 * of the prompt, and it checks before it writes. */
export function withLook(prompt: string, look: string): string {
  const trimmed = prompt.trim();
  if (!look.trim()) return trimmed;
  const has = trimmed.toLowerCase().includes(look.trim().toLowerCase());
  return has ? trimmed : `${trimmed.replace(/\.$/, "")}. ${look.trim().replace(/\.$/, "")}.`;
}

export interface ComposedKeyframe {
  prompt: string;
  /** what the composer decided on the operator's behalf, one line each */
  notes: string[];
}

/** the tokens a deep-focus set plate and a shallow lens fight over */
const DEEP_TOKENS = /\b(deep focus|no bokeh|everything sharp[^,.;]*|sharp front to back)\b[,;]?\s*/gi;
const SHALLOW_TOKENS =
  /\b(shallow depth of field|background softly blurred|soft bokeh|oval bokeh|(?<!no )bokeh)\b[,;]?\s*/gi;
const tidy = (s: string) => s.replace(/\s*,\s*,/g, ",").replace(/[,;\s]+$/, "").replace(/\s{2,}/g, " ").trim();

/** One deterministic paragraph per shot, in the order the image model
 * weighs it: FRAMING first (shot size, angle, lens), then the subjects with
 * their identity anchors, the action, the set, the light and composition,
 * and the show's art direction last.
 *
 * The order is the pilot's defect #1: with the ~90-word set block first and
 * the camera phrase last, every board came back medium-wide whatever the
 * shot size said, and a hand-written override didn't beat it either. The
 * composer also resolves two contradictions the old paragraph shipped —
 * a `deep focus, no bokeh` set plate against a `shallow depth of field`
 * lens (#2), and a composition id that only makes sense at a different
 * shot size (#5) — and says what it did in `notes`. */
export function composeKeyframe(shot: Shot, scene: Scene | undefined, bible: Bible): ComposedKeyframe {
  const notes: string[] = [];
  const cine = bible.cinematography;
  const resolved = resolveCameraSpec(shot.camera, cine);
  const shotSizeEntry = findClause(cine.shotSizes, shot.camera.shotSize);
  const shotSizeId = shotSizeEntry?.id ?? "";
  const lensEntry = findClause(cine.lenses, shot.camera.lens);

  /* ---- framing, first ---- */
  /* the bank's clauses overlap ("cu" already says shallow depth of field;
   * the "shallow" lens says it again) — keep each fragment once */
  const framing = dedupeFragments(
    [resolved.shotSize, resolved.angle, resolved.lens].map((s) => s.trim()).filter(Boolean).join(", "),
  );

  /* A tight size is fought by everything below the frame line. Every item of
   * wardrobe and every square metre of set the prompt names is something the
   * image model tries to SHOW, and with a full-body reference sheet that is
   * what pulled the Milo confessional (MCU) back to a wide standing shot of
   * the whole loft, jeans and all (2026-11-10). So at MCU and tighter the
   * prompt names only what is in frame. */
  const tight = TIGHT_SIZES.has(shotSizeId || shot.camera.shotSize.trim().toLowerCase());

  /* ---- subjects ---- */
  const cast = shotCharacters(shot, bible).slice(0, 2);
  const subjects = cast.map((c, i) => {
    const wardrobe = tight ? inFrameWardrobe(c.wardrobe) : c.wardrobe;
    const anchors = [c.anchors.face || c.anchors.body, c.signatureFeature]
      .map((s) => s.trim())
      .filter(Boolean)
      .join("; ");
    const image = cast.length > 1 ? ` (reference image ${i + 1})` : "";
    return `this exact ${c.species || "animal"} character ${c.name}${image}, wearing ${
      wardrobe || "their signature outfit"
    }${anchors ? ` — ${anchors}` : ""}`;
  });
  if (tight && cast.some((c) => c.wardrobe && inFrameWardrobe(c.wardrobe) !== c.wardrobe)) {
    notes.push(`Below-the-frame wardrobe was left out of this ${shotSizeEntry?.name ?? shotSizeId}: what the prompt names, the model tries to show.`);
  }

  const parts: string[] = [];
  if (framing && subjects.length) parts.push(`${framing} of ${subjects.join(" and ")}`);
  else if (framing) parts.push(framing);
  else if (subjects.length) parts.push(subjects.join(" and "));

  const action = actionText(shot) || shot.title || shot.notes;
  if (action.trim()) parts.push(action.trim());

  /* ---- the set, with the lens's focus winning over the plate's ---- */
  const location = shotLocation(shot, scene, bible);
  if (location) {
    let plate = (location.stylePrompt || location.description).trim();
    const lensClause = (resolved.lens || "").toLowerCase();
    const lensShallow = /shallow|bokeh|softly blurred/.test(lensClause);
    const lensDeep = /deep focus|sharp front to back/.test(lensClause);
    if (lensShallow && DEEP_TOKENS.test(plate)) {
      DEEP_TOKENS.lastIndex = 0;
      const dropped = plate.match(DEEP_TOKENS)?.map((m) => tidy(m)) ?? [];
      plate = tidy(plate.replace(DEEP_TOKENS, ""));
      notes.push(
        `The set plate's "${dropped.join(", ")}" was dropped: the ${lensEntry?.name ?? "lens"} asks for shallow focus and the two cannot share a sentence (defect #2).`,
      );
    } else if (lensDeep && SHALLOW_TOKENS.test(plate)) {
      SHALLOW_TOKENS.lastIndex = 0;
      const dropped = plate.match(SHALLOW_TOKENS)?.map((m) => tidy(m)) ?? [];
      plate = tidy(plate.replace(SHALLOW_TOKENS, ""));
      notes.push(
        `The set plate's "${dropped.join(", ")}" was dropped: the lens asks for deep focus (defect #2).`,
      );
    }
    DEEP_TOKENS.lastIndex = 0;
    SHALLOW_TOKENS.lastIndex = 0;
    if (tight) {
      // the set is only what shows behind a head: its opening clauses, soft
      const gist = plate.split(/,\s*/).slice(0, 3).join(", ").replace(/^[^:]{0,60}:\s*/, "");
      parts.push(`behind them, only a glimpse of ${location.name} (${gist}), out of focus`);
      notes.push(`The ${location.name} plate was cut to a background glimpse: a full set description pulls a ${shotSizeEntry?.name ?? shotSizeId} wide.`);
    } else {
      parts.push(`in ${location.name}: ${plate}`);
    }
  }

  /* ---- light and composition ---- */
  const composition = findClause(cine.compositions, shot.camera.notes);
  let compositionClause = resolved.notes.trim();
  if (composition && !compositionFitsShotSize(composition.id, shotSizeId)) {
    compositionClause = "";
    notes.push(
      `Composition "${composition.name}" only works at ${
        COMPOSITION_SHOT_SIZES[composition.id]?.join("/") ?? "wider sizes"
      } and was left out of this ${shotSizeEntry?.name ?? shot.camera.shotSize} (defect #5).`,
    );
  }
  const light = [resolved.lighting.trim(), compositionClause].filter(Boolean).join(", ");
  if (light) parts.push(light);

  if (tight) parts.push(TIGHT_FRAME_CLAUSE[shotSizeId] ?? TIGHT_FRAME_CLAUSE.mcu!);

  if (bible.style.artDirection) parts.push(bible.style.artDirection);

  /* the character ref is a full-body sheet; a tight size fights it */
  if (["ecu", "cu", "mcu"].includes(shotSizeId) && cast.length) {
    notes.push(
      `Framing leads the prompt, but the character reference is full body — a ${shotSizeEntry?.name ?? shotSizeId} may still come back wider. One retake with the same seed usually lands it; don't loop.`,
    );
  }

  const prompt = parts
    .filter(Boolean)
    .map((p) => p.replace(/\.\s*$/, ""))
    .join(". ");

  const craft = applyCraftRules({ prompt, mode: "keyframe", shot, bible, location });
  notes.push(...craft.notes);
  return { prompt: craft.prompt, notes };
}

/** shot sizes at which the frame line sits at or above the chest */
const TIGHT_SIZES = new Set(["mcu", "cu", "ecu"]);

/** the framing said once more, plainly, as what is NOT in shot — a full-body
 * reference sheet otherwise wins the argument */
const TIGHT_FRAME_CLAUSE: Record<string, string> = {
  mcu: "Framed from the chest up, the character fills most of the frame; no legs, no feet, no full body in shot",
  cu: "The face fills the frame, cut at the shoulders; no body below the shoulders in shot",
  ecu: "Extreme close-up on the face alone, edge to edge",
};

/** wardrobe items that live below a chest-up frame line */
const BELOW_FRAME = /\b(jeans|trousers|pants|shorts|skirt|leggings|socks|shoes|sneakers|trainers|boots|sandals|slippers|heels|loafers|feet|tail)\b/i;

/** "a sweater, skinny dark jeans, a beanie" → "a sweater, a beanie". Splits
 * on commas and "and"; an outfit that is ALL lower-body is kept whole rather
 * than erased. */
export function inFrameWardrobe(wardrobe: string): string {
  const items = wardrobe
    .split(/,\s*|\s+and\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const kept = items
    .filter((i) => !BELOW_FRAME.test(i))
    // a parenthetical split by its own "and" leaves a dangling "(matching top"
    .map((i) => ((i.match(/\(/g)?.length ?? 0) > (i.match(/\)/g)?.length ?? 0) ? i.replace(/\s*\([^)]*$/, "") : i))
    .filter(Boolean);
  return kept.length && kept.length < items.length ? kept.join(", ") : wardrobe;
}

/** the prompt alone — what the Storyboard preview and the board mutation read */
export function composeKeyframePrompt(shot: Shot, scene: Scene | undefined, bible: Bible): string {
  return composeKeyframe(shot, scene, bible).prompt;
}

/** "a, b, a" → "a, b" — case-insensitive, first occurrence kept */
function dedupeFragments(text: string): string {
  const seen = new Set<string>();
  return text
    .split(/,\s*/)
    .map((f) => f.trim())
    .filter((f) => {
      const key = f.toLowerCase();
      if (!f || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(", ");
}
