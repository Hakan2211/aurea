/* The craft-rule table (PRODUCTION-EXPERIENCE-PLAN.md §2).
 *
 * Every row is a measured fact; every row gets a fires / does-not-fire pair
 * and its note is checked for the shape the Desk drawer groups on. The last
 * test runs the pilot's own drifting prompt through the table: the lint must
 * name motion-only-i2v, which is the rule the pilot fixed by hand. */

import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCraftRules,
  bibleSchema,
  composeIa2vShot,
  ruleOfNote,
  sceneSchema,
  shotSchema,
  BACKGROUND_HOLD_CLAUSE,
  STAYS_SEATED_CLAUSE,
  CINEMATOGRAPHY_BANK,
  CRAFT_RULES,
  type Bible,
  type Shot,
} from "@aurea/shared";

const bible: Bible = bibleSchema.parse({
  characters: [
    {
      id: "silas",
      name: "Silas",
      species: "tiger",
      wardrobe: "a grey henley, worn at the cuffs, dark denim",
      signatureFeature: "a notched left ear",
    },
  ],
  locations: [
    {
      id: "loft",
      name: "the loft",
      description: "a converted loft",
      stylePrompt: "warm dusk light through a tall window, deep focus, no bokeh",
      refs: [],
    },
  ],
  style: { artDirection: "warm sitcom lighting", negativePrompt: "blurry, text" },
  cinematography: CINEMATOGRAPHY_BANK,
});
const scene = sceneSchema.parse({ id: "sc1", slugline: "INT. THE LOFT — DUSK", location: "loft" });
const shot = (patch: Partial<Shot> = {}): Shot =>
  shotSchema.parse({
    id: "sh1",
    title: "Silas, to camera",
    characters: ["silas"],
    location: "loft",
    camera: { shotSize: "mcu", move: "static", lens: "shallow" },
    keyframes: [{ id: "k1", asset: "projects/p/assets/image/silas.png", approved: true }],
    selectedKeyframe: "k1",
    scriptLines: [{ id: "l1", character: "silas", text: "Let the mud settle." }],
    ...patch,
  });
const location = bible.locations[0];

test("every rule has a why with a date, and the note format round-trips through ruleOfNote", () => {
  for (const rule of CRAFT_RULES) {
    assert.match(rule.why, /20\d\d-\d\d-\d\d|FN15|V3|Krea2/, `${rule.id} has no measurement`);
  }
  assert.deepEqual(ruleOfNote("Rule stays-seated changed the prompt: x. Why: y"), { id: "stays-seated", changed: true });
  assert.deepEqual(ruleOfNote("Rule silence-25: x. Why: y"), { id: "silence-25", changed: false });
  assert.equal(ruleOfNote("No voice takes on this shot"), null);
});

test("motion-only-i2v fires on the pilot's drifting prompt and not on the composer's own", () => {
  const drifting =
    "This exact tiger character Silas, wearing a grey henley, worn at the cuffs, dark denim. " +
    "In the loft: warm dusk light through a tall window, deep focus, no bokeh. Silas the tiger in a grey henley talks.";
  const out = applyCraftRules({ prompt: drifting, mode: "i2v-single", engine: "ltx25", shot: shot(), bible, location, hasDialogue: true, hasAudio: true, durationSec: 6 });
  assert.ok(out.rulesFired.includes("motion-only-i2v"), out.rulesFired.join());
  assert.ok(out.notes.some((n) => n.startsWith("Rule motion-only-i2v:")));

  const own = composeIa2vShot(shot(), scene, bible, { durationSec: 6, takes: [{ take: "a.wav", character: "silas", durationSec: 2 }] });
  assert.ok(!own.rulesFired.includes("motion-only-i2v"), own.notes.join("\n"));
});

test("background-hold-7s adds its clause once, past 7s only, and is idempotent", () => {
  const short = applyCraftRules({ prompt: "Silas talks.", mode: "i2v-single", engine: "ltx25", durationSec: 6 });
  assert.ok(!short.rulesFired.includes("background-hold-7s"));
  const long = applyCraftRules({ prompt: "Silas talks.", mode: "i2v-single", engine: "ltx25", durationSec: 8 });
  assert.ok(long.rulesFired.includes("background-hold-7s"));
  assert.ok(long.prompt.endsWith(BACKGROUND_HOLD_CLAUSE));
  const again = applyCraftRules({ prompt: long.prompt, mode: "i2v-single", engine: "ltx25", durationSec: 8 });
  assert.equal(again.prompt, long.prompt);
  assert.ok(!again.rulesFired.includes("background-hold-7s"));
  // and the ia2v composer still carries it, now via the table
  const out = composeIa2vShot(shot(), scene, bible, { durationSec: 8 });
  assert.ok(out.prompt.includes(BACKGROUND_HOLD_CLAUSE));
  assert.ok(out.rulesFired.includes("background-hold-7s"));
  assert.ok(out.notes.some((n) => n.startsWith("Rule background-hold-7s changed the prompt:")));
});

test("stays-seated rewrites a chair adjustment on every video mode, never twice", () => {
  for (const mode of ["i2v-single", "multi-shot", "director", "h3"] as const) {
    const out = applyCraftRules({ prompt: "Silas shifts in his chair and talks.", mode, engine: "ltx25" });
    assert.ok(out.rulesFired.includes("stays-seated"), mode);
    assert.ok(out.prompt.endsWith(STAYS_SEATED_CLAUSE));
    const again = applyCraftRules({ prompt: out.prompt, mode, engine: "ltx25" });
    assert.ok(!again.rulesFired.includes("stays-seated"));
  }
  const calm = applyCraftRules({ prompt: "Silas talks, still.", mode: "i2v-single", engine: "ltx25" });
  assert.ok(!calm.rulesFired.includes("stays-seated"));
  const key = applyCraftRules({ prompt: "Silas shifts in his chair.", mode: "keyframe" });
  assert.ok(!key.rulesFired.includes("stays-seated"), "a still has no motion to hold");
});

test("named-beat-lipsync lints a pronoun speaker only when there is dialogue", () => {
  const bad = applyCraftRules({ prompt: "He talks, mouth moving.", mode: "i2v-single", engine: "ltx25", hasDialogue: true });
  assert.ok(bad.rulesFired.includes("named-beat-lipsync"));
  const named = applyCraftRules({ prompt: "Silas the tiger talks, mouth moving.", mode: "i2v-single", engine: "ltx25", hasDialogue: true });
  assert.ok(!named.rulesFired.includes("named-beat-lipsync"));
  const silent = applyCraftRules({ prompt: "He talks.", mode: "i2v-single", engine: "ltx25", hasDialogue: false });
  assert.ok(!silent.rulesFired.includes("named-beat-lipsync"));
});

test("the enhancer: off on multi-shot (rewrite), warned when off on a 2.5 single", () => {
  const multi = applyCraftRules({ prompt: "Wide shot… cut to…", mode: "multi-shot", engine: "ltx25", enhance: undefined });
  assert.ok(multi.rulesFired.includes("enhance-off-multishot"));
  assert.equal(multi.enhance, false);
  const already = applyCraftRules({ prompt: "x", mode: "multi-shot", engine: "ltx25", enhance: false });
  assert.ok(!already.rulesFired.includes("enhance-off-multishot"));

  const single = applyCraftRules({ prompt: "x", mode: "i2v-single", engine: "ltx25", enhance: false });
  assert.ok(single.rulesFired.includes("enhance-on-single"));
  assert.equal(single.enhance, false, "a lint does not override the lane");
  const on = applyCraftRules({ prompt: "x", mode: "i2v-single", engine: "ltx25", enhance: undefined });
  assert.ok(!on.rulesFired.includes("enhance-on-single"));
  const v23 = applyCraftRules({ prompt: "x", mode: "i2v-single", engine: "ltx2", enhance: false });
  assert.ok(!v23.rulesFired.includes("enhance-on-single"), "2.3 is not measured");
});

test("no-camera-lora-25 strips both things the 2.5 adapter refuses", () => {
  const out = applyCraftRules({ prompt: "x", mode: "director", engine: "ltx25", cameraLora: { move: "dolly-in", strength: 1 }, director: { promptZones: [] } });
  assert.ok(out.rulesFired.includes("no-camera-lora-25"));
  assert.equal(out.dropCameraLora, true);
  assert.equal(out.dropDirector, true);
  const clean = applyCraftRules({ prompt: "x", mode: "director", engine: "ltx2", cameraLora: { move: "dolly-in", strength: 1 } });
  assert.ok(!clean.rulesFired.includes("no-camera-lora-25"));
});

test("push-in-strength warns on a long 2.5 push-in, silence-25 on a no-audio 2.5 shot", () => {
  const push = applyCraftRules({ prompt: "x", mode: "i2v-single", engine: "ltx25", durationSec: 8, camera: { move: "push-in" } });
  assert.ok(push.rulesFired.includes("push-in-strength"));
  const shortPush = applyCraftRules({ prompt: "x", mode: "i2v-single", engine: "ltx25", durationSec: 6, camera: { move: "push-in" } });
  assert.ok(!shortPush.rulesFired.includes("push-in-strength"));

  const silent = applyCraftRules({ prompt: "Nobody speaks.", mode: "i2v-single", engine: "ltx25", hasDialogue: false, hasAudio: false });
  assert.ok(silent.rulesFired.includes("silence-25"));
  const voiced = applyCraftRules({ prompt: "x", mode: "i2v-single", engine: "ltx25", hasDialogue: true, hasAudio: true });
  assert.ok(!voiced.rulesFired.includes("silence-25"));
  const v23 = applyCraftRules({ prompt: "Nobody speaks.", mode: "i2v-single", engine: "ltx2", hasDialogue: false });
  assert.ok(!v23.rulesFired.includes("silence-25"), "2.3 makes room tone");
  // a prompt that NAMES its sound renders it on 2.5 (the kettle, −23 dB mean, 2026-09-02)
  const cued = applyCraftRules({
    prompt: "A kettle comes to the boil; the hiss rises into a whistle.",
    mode: "t2v",
    engine: "ltx25",
    hasDialogue: false,
    hasAudio: false,
  });
  assert.ok(!cued.rulesFired.includes("silence-25"), "a sound cue in the prompt is not silence");
  const ambient = applyCraftRules({ prompt: "A fox crosses the square, the ambient sound of a market.", mode: "t2v", engine: "ltx25" });
  assert.ok(!ambient.rulesFired.includes("silence-25"));
  const chosen = applyCraftRules({ prompt: "A fox crosses the square in silence.", mode: "t2v", engine: "ltx25" });
  assert.ok(!chosen.rulesFired.includes("silence-25"), "silence the user asked for is not a defect");
});

test("no-text-objects lints a keyframe prompt that names a sign; coverage-180 names far bearings", () => {
  const sign = applyCraftRules({ prompt: "Silas under a neon sign in the lounge.", mode: "keyframe" });
  assert.ok(sign.rulesFired.includes("no-text-objects"));
  const clean = applyCraftRules({ prompt: "Silas under a warm lamp in the lounge.", mode: "keyframe" });
  assert.ok(!clean.rulesFired.includes("no-text-objects"));

  const far = applyCraftRules({ prompt: "x", mode: "coverage", bearings: [0, 45, 90, 135, 180, 225, 270, 315] });
  assert.ok(far.rulesFired.includes("coverage-180"));
  assert.match(far.notes.find((n) => n.includes("coverage-180")) ?? "", /225°, 270°, 315°/);
  const front = applyCraftRules({ prompt: "x", mode: "coverage", bearings: [0, 90, 180] });
  assert.ok(!front.rulesFired.includes("coverage-180"));
});
