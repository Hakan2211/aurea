/* The Milo confessional (2026-11-10): one recorded line, an 8 s render, and
 * five seconds of a mouth moving over silence. Three separate faults, each
 * pinned here:
 *   1. the take fell on the shot's FIRST open line (his long unrecorded
 *      speech) instead of the line it was recorded for;
 *   2. the unrecorded line stayed in the ia2v prompt as a talking beat;
 *   3. the MCU keyframe prompt named jeans and a whole loft, and came back
 *      a wide standing shot. */

import assert from "node:assert/strict";
import test from "node:test";
import {
  bibleSchema,
  composeIa2vShot,
  composeKeyframe,
  inFrameWardrobe,
  shotSchema,
  type Bible,
  type Shot,
} from "@aurea/shared";

const bible: Bible = bibleSchema.parse({
  characters: [
    {
      id: "milo",
      name: "Milo",
      species: "meerkat",
      wardrobe: "a striped sweater, skinny dark jeans, a mustard beanie",
    },
  ],
  locations: [{ id: "loft", name: "the loft", description: "a converted loft, brick walls, tall windows, string lights, a sofa" }],
});

const shot: Shot = shotSchema.parse({
  id: "s1",
  title: "Confessional - Milo",
  characters: ["milo"],
  location: "loft",
  camera: { shotSize: "mcu", angle: "eye", move: "static" },
  scriptLines: [
    { id: "long", character: "milo", text: "Okay so the fund started because Jax bought a bag of beans and then nobody paid him back.", deliveryNotes: "fast, jittery" },
    { id: "short", character: "milo", text: "I've thought about that a lot.", deliveryNotes: "the nervous little laugh" },
  ],
});

const take = { take: "a/short.wav", lineId: "short", durationSec: 1.8 };

test("a take binds to the line it was recorded for, not the first open one", () => {
  const out = composeIa2vShot(shot, undefined, bible, { takes: [take] });
  assert.equal(out.planned.length, 1);
  assert.equal(out.planned[0]!.text, "I've thought about that a lot.");
  assert.match(out.prompt, /nervous little laugh/);
  assert.doesNotMatch(out.prompt, /jittery/, "the unrecorded line's direction leaked in");
});

test("unrecorded lines leave an ia2v prompt and the clock closes up", () => {
  const out = composeIa2vShot(shot, undefined, bible, { takes: [take] });
  assert.equal((out.prompt.match(/talks/g) ?? []).length, 1, "one talking beat for one recorded line");
  assert.equal(out.planned[0]!.atSec, 1, "recorded line moves up to the lead-in");
  assert.equal(out.durationSec, 4, "1 s lead-in + 1.8 s line + tail, rounded up");
  assert.ok(out.notes.some((n) => /unrecorded line was left out/.test(n)));
});

test("a shot with no takes keeps every line (the engine scores it itself)", () => {
  const out = composeIa2vShot(shot, undefined, bible, {});
  assert.equal(out.planned.length, 2);
});

test("an unbound take still falls on the next open line, as before", () => {
  const out = composeIa2vShot(shot, undefined, bible, { takes: [{ take: "a/x.wav", durationSec: 3 }] });
  assert.equal(out.planned[0]!.text.startsWith("Okay so the fund"), true);
});

test("tight framing names only what is in frame", () => {
  assert.equal(inFrameWardrobe("a striped sweater, skinny dark jeans, a mustard beanie"), "a striped sweater, a mustard beanie");
  assert.equal(inFrameWardrobe("blue jeans"), "blue jeans", "an all-lower-body outfit is kept, not erased");
  assert.equal(
    inFrameWardrobe("a silk robe over a sequined set (matching top and wide-leg trousers)"),
    "a silk robe over a sequined set",
  );
  const k = composeKeyframe(shot, undefined, bible).prompt;
  assert.doesNotMatch(k, /jeans/);
  assert.match(k, /no legs, no feet/);
  assert.doesNotMatch(k, /string lights, a sofa/, "the whole set plate came through at MCU");
});
