/* The board prompt after the pilot (PRODUCTION-EXPERIENCE-PLAN.md §1.1).
 *
 * Defect #1: the camera phrase came LAST, after a ~90-word set block, so
 * every board came back medium-wide whatever the shot size said.
 * Defect #2: the set plate's "deep focus, no bokeh" shared a sentence with
 * the lens's "shallow depth of field, bokeh".
 * Defect #5: "small figure in the corner of the frame" directly after
 * "medium close-up". */

import test from "node:test";
import assert from "node:assert/strict";
import {
  bibleSchema,
  composeKeyframe,
  composeKeyframePrompt,
  sceneSchema,
  shotSchema,
  CINEMATOGRAPHY_BANK,
  type Bible,
  type Shot,
} from "@aurea/shared";

const bible: Bible = bibleSchema.parse({
  characters: [
    { id: "silas", name: "Silas", species: "tiger", wardrobe: "a grey henley", signatureFeature: "a notched left ear" },
  ],
  locations: [
    {
      id: "loft",
      name: "the loft",
      description: "a converted loft",
      stylePrompt: "warm dusk light through a tall window, exposed brick, deep focus, no bokeh",
      refs: [],
    },
  ],
  style: { artDirection: "Stylized 3D animation, Pixar-quality.", negativePrompt: "blurry, text" },
  cinematography: CINEMATOGRAPHY_BANK,
});
const scene = sceneSchema.parse({ id: "sc1", slugline: "INT. THE LOFT — DUSK", location: "loft" });
const shot = (camera: Shot["camera"] | Record<string, string>): Shot =>
  shotSchema.parse({
    id: "sh1",
    title: "Silas, to camera",
    characters: ["silas"],
    location: "loft",
    camera,
    scriptLines: [{ id: "a1", character: null, text: "Silas leans into the lamp light." }],
  });

test("framing leads: shot size, angle and lens open the prompt, the set and the look close it", () => {
  const p = composeKeyframePrompt(shot({ shotSize: "mcu", angle: "eye", lens: "shallow" }), scene, bible);
  assert.match(p, /^medium close-up[^.]*eye-level[^.]*shallow depth of field[^.]* of this exact tiger character Silas/i);
  // at MCU the set is a background glimpse (dialogue-single.test.ts), still after the action
  const iSet = p.indexOf("glimpse of the loft");
  const iAction = p.indexOf("leans into the lamp light");
  const iLook = p.indexOf("Stylized 3D animation");
  assert.ok(iAction > 0 && iSet > iAction && iLook > iSet, p);
});

test("a shallow lens drops the plate's deep-focus tokens, and says so", () => {
  const out = composeKeyframe(shot({ shotSize: "cu", lens: "shallow" }), scene, bible);
  assert.doesNotMatch(out.prompt, /deep focus|no bokeh/);
  assert.match(out.prompt, /shallow depth of field/);
  assert.match(out.prompt, /exposed brick/);
  assert.ok(out.notes.some((n) => /deep focus.*dropped|dropped.*deep focus/.test(n)), out.notes.join("\n"));
  // a deep lens keeps the plate untouched
  const deep = composeKeyframe(shot({ shotSize: "ws", lens: "deep" }), scene, bible);
  assert.match(deep.prompt, /no bokeh/);
  assert.ok(!deep.notes.some((n) => /dropped/.test(n)));
});

test("a composition that contradicts the shot size is left out with a note", () => {
  const out = composeKeyframe(shot({ shotSize: "mcu", notes: "negative-space" }), scene, bible);
  assert.doesNotMatch(out.prompt, /small figure in the corner/);
  assert.ok(out.notes.some((n) => /Negative space.*only works/.test(n)), out.notes.join("\n"));
  const wide = composeKeyframe(shot({ shotSize: "ws", notes: "negative-space" }), scene, bible);
  assert.match(wide.prompt, /small figure in the corner/);
  // size-agnostic compositions always pass
  const sym = composeKeyframe(shot({ shotSize: "mcu", notes: "symmetry" }), scene, bible);
  assert.match(sym.prompt, /symmetrical composition/);
});

test("a tight size warns that the character ref is full body; a text-bearing object is linted", () => {
  const tight = composeKeyframe(shot({ shotSize: "cu" }), scene, bible);
  assert.ok(tight.notes.some((n) => /full body/.test(n)));
  const wide = composeKeyframe(shot({ shotSize: "ws" }), scene, bible);
  assert.ok(!wide.notes.some((n) => /full body/.test(n)));

  const signed = composeKeyframe(
    shotSchema.parse({ ...shot({ shotSize: "ws" }), scriptLines: [{ id: "a1", character: null, text: "Silas under the neon sign." }] }),
    scene,
    bible,
  );
  assert.ok(signed.notes.some((n) => n.startsWith("Rule no-text-objects:")), signed.notes.join("\n"));
});
