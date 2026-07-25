/* Storyboard → Director spec. The composition is pure, and it encodes every
 * measured fact V4–V6 cost a render to learn — who a beat names, how much open
 * air is safe, what the sheet may hold. Pin it here so a refactor can't quietly
 * unlearn them. */

import test from "node:test";
import assert from "node:assert/strict";
import {
  bibleSchema,
  composeShotSpec,
  sceneSchema,
  shotSchema,
  CINEMATOGRAPHY_BANK,
  type Bible,
  type Scene,
  type Shot,
} from "@aurea/shared";

const bible: Bible = bibleSchema.parse({
  characters: [
    {
      id: "sterling",
      name: "Sterling",
      species: "lion",
      wardrobe: "a blue velvet blazer, cream trousers",
      colors: "golden mane",
      signatureFeature: "amber eyes",
      refs: { keyframeRef: "projects/p/assets/image/sterling-hero.png" },
    },
    {
      id: "bruno",
      name: "Bruno",
      species: "gorilla",
      wardrobe: "a mint hoodie",
      refs: { hero: "projects/p/assets/image/bruno-hero.png" },
    },
    { id: "milo", name: "Milo", species: "meerkat", wardrobe: "a tracksuit" },
  ],
  locations: [
    { id: "breakroom", name: "the breakroom", description: "an office breakroom", refs: [] },
  ],
  style: { artDirection: "warm sitcom lighting", negativePrompt: "blurry, text" },
  cinematography: CINEMATOGRAPHY_BANK,
});

const scene: Scene = sceneSchema.parse({
  id: "sc1",
  slugline: "INT. BREAKROOM — DAY",
  location: "breakroom",
});

const shot = (patch: Partial<Shot> = {}): Shot =>
  shotSchema.parse({
    id: "sh1",
    title: "The decaf confession",
    characters: ["sterling", "bruno"],
    location: "breakroom",
    camera: { shotSize: "ws", move: "push-in" },
    keyframes: [{ id: "k1", asset: "projects/p/assets/image/breakroom.png", approved: true }],
    selectedKeyframe: "k1",
    scriptLines: [
      { id: "l1", character: null, text: "They stand by the coffee machine." },
      { id: "l2", character: "sterling", text: "You switched the pot.", deliveryNotes: "indignant" },
      { id: "l3", character: "bruno", text: "You seemed tense.", deliveryNotes: "sheepish" },
    ],
    ...patch,
  });

const takes = [
  { take: "projects/p/assets/audio/sterling.wav", character: "sterling", durationSec: 2 },
  { take: "projects/p/assets/audio/bruno.wav", character: "bruno", durationSec: 1.5 },
];

test("the selected keyframe is the start frame, pinned at 0s", () => {
  const out = composeShotSpec(shot(), scene, bible, { takes });
  assert.equal(out.startFrame, "projects/p/assets/image/breakroom.png");
  assert.deepEqual(out.director.keyframes, [
    { image: "projects/p/assets/image/breakroom.png", atSec: 0, strength: 1 },
  ]);
});

test("a dialogue beat names its speaker and silences everyone else", () => {
  const out = composeShotSpec(shot(), scene, bible, { takes });
  const [, sterlingBeat, brunoBeat] = out.director.promptZones;
  assert.match(sterlingBeat.prompt, /^Sterling the lion in a blue velvet blazer talks, mouth moving while speaking, indignant/);
  assert.match(sterlingBeat.prompt, /Bruno the gorilla in a mint hoodie listens in silence, mouth closed/);
  assert.match(brunoBeat.prompt, /^Bruno the gorilla in a mint hoodie talks/);
  assert.match(brunoBeat.prompt, /Sterling the lion in a blue velvet blazer listens in silence/);
});

test("three characters listen in the plural", () => {
  const out = composeShotSpec(shot({ characters: ["sterling", "bruno", "milo"] }), scene, bible, {
    takes,
  });
  assert.match(
    out.director.promptZones[1].prompt,
    /Bruno the gorilla in a mint hoodie and Milo the meerkat in a tracksuit listen in silence, mouths closed/,
  );
});

test("beats tile the shot from 0s and the takes land where their beats start", () => {
  const out = composeShotSpec(shot(), scene, bible, { takes, leadInSec: 1, gapSec: 0.6 });
  // lead-in 0→1, Sterling 1→3.6 (2s + 0.6 gap), Bruno 3.6→end
  assert.deepEqual(
    out.director.promptZones.map((z) => z.lengthSec),
    [1, 2.6, out.director.promptZones[2].lengthSec],
  );
  assert.deepEqual(
    out.director.audio.map((a) => [a.take, a.atSec]),
    [
      ["projects/p/assets/audio/sterling.wav", 1],
      ["projects/p/assets/audio/bruno.wav", 3.6],
    ],
  );
  // long enough to hold the last line plus a beat of air
  assert.equal(out.durationSec, 6);
});

test("an explicit atSec places a take, and the beat moves with it", () => {
  const out = composeShotSpec(shot(), scene, bible, {
    takes: [takes[0], { ...takes[1], atSec: 7 }],
    durationSec: 10,
  });
  assert.deepEqual(
    out.director.audio.map((a) => a.atSec),
    [1, 7],
  );
  assert.equal(out.director.promptZones[1].lengthSec, 6);
  assert.match(out.notes.join(" "), /open air between lines/);
});

test("takes that overlap are reported — LTX mixes them, it doesn't cut one off", () => {
  // Sterling runs 2s→5s; asking for Bruno at 4.5s means half a second of both
  const out = composeShotSpec(shot(), scene, bible, {
    takes: [
      { ...takes[0], atSec: 2, durationSec: 3 },
      { ...takes[1], atSec: 4.5 },
    ],
    durationSec: 10,
  });
  assert.match(out.notes.join(" "), /Two lines overlap by 0\.5s/);
  // and it is still what was asked for — the composer reports, it doesn't move them
  assert.deepEqual(
    out.director.audio.map((a) => a.atSec),
    [2, 4.5],
  );
});

test("the camera move rides the first beat — the anchor prompt has no move in it", () => {
  const out = composeShotSpec(shot(), scene, bible, { takes });
  const move = CINEMATOGRAPHY_BANK.moves.find((m) => m.id === "push-in")!.clause;
  assert.ok(out.director.promptZones[0].prompt.includes(move), out.director.promptZones[0].prompt);
  assert.ok(!out.prompt.includes(move), out.prompt);
  // the action line, not a stand-in, opens the shot
  assert.match(out.director.promptZones[0].prompt, /^They stand by the coffee machine/);
});

test("placed takes turn room tone OFF — LTX invents dialogue into open air", () => {
  assert.equal(composeShotSpec(shot(), scene, bible, { takes }).director.inpaintAudio, false);
  // nothing to protect when the shot has no takes at all
  assert.equal(composeShotSpec(shot(), scene, bible, {}).director.inpaintAudio, true);
});

test("cast references come from the bible, and only when the engine has them", () => {
  const off = composeShotSpec(shot(), scene, bible, { takes });
  assert.deepEqual(off.director.refs, []);
  assert.match(off.notes.join(" "), /Cast references are off/);

  const on = composeShotSpec(shot(), scene, bible, { takes, refs: true });
  assert.deepEqual(
    on.director.refs.map((r) => [r.name, r.kind, r.image]),
    [
      ["Sterling", "character", "projects/p/assets/image/sterling-hero.png"],
      ["Bruno", "character", "projects/p/assets/image/bruno-hero.png"],
    ],
  );
  // the sheet carries what must stay true, straight from the bible
  assert.match(on.director.refs[0].description, /a lion.*blue velvet blazer.*amber eyes/);
  // the set is not a cell: the start frame already is the set
  assert.ok(!on.director.refs.some((r) => r.kind === "setting"));
});

test("a character with no reference still is named, not silently dropped", () => {
  const out = composeShotSpec(shot({ characters: ["sterling", "milo"] }), scene, bible, {
    takes,
    refs: true,
  });
  assert.deepEqual(out.director.refs.map((r) => r.name), ["Sterling"]);
  assert.match(out.notes.join(" "), /Milo has no reference still/);
});

test("a line with no take is timed from its word count, and says so", () => {
  const out = composeShotSpec(shot(), scene, bible, { takes: [takes[0]] });
  assert.equal(out.director.audio.length, 1);
  assert.equal(out.director.promptZones.length, 3);
  assert.match(out.notes.join(" "), /1 line has no voice take/);
});

test("an unboarded shot composes, and says what it is missing", () => {
  const out = composeShotSpec(shot({ keyframes: [], selectedKeyframe: null }), scene, bible, {
    takes,
  });
  assert.equal(out.startFrame, null);
  assert.deepEqual(out.director.keyframes, []);
  assert.match(out.notes.join(" "), /no keyframe/);
});

test("a shot longer than its lines is honoured; a shorter one is flagged", () => {
  const long = composeShotSpec(shot(), scene, bible, { takes, durationSec: 12 });
  assert.equal(long.durationSec, 12);
  assert.equal(
    long.director.promptZones.reduce((s, z) => s + z.lengthSec, 0),
    12,
  );
  const short = composeShotSpec(shot(), scene, bible, { takes, durationSec: 3 });
  assert.match(short.notes.join(" "), /the shot is 3s/);
});

test("the negative prompt comes off the style bible", () => {
  assert.equal(composeShotSpec(shot(), scene, bible, {}).director.negativePrompt, "blurry, text");
});
