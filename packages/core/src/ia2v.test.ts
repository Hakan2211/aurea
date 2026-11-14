/* The ia2v single — the documentary spine.
 *
 * Two pilot findings are pinned here because both cost a render to learn and
 * neither is visible in the output of a passing build:
 *   • the prompt must describe MOTION ONLY. A composed anchor (set + wardrobe +
 *     lens) beat the start frame and the take abandoned its board inside half a
 *     second;
 *   • past ~7s the set needs one background-hold clause or it dissolves.
 * The third fact is structural: 2.5 refuses a Director timeline and a camera
 * LoRA, so `zoo-interview-single` never reached the GPU at all. */

import test from "node:test";
import assert from "node:assert/strict";
import {
  bibleSchema,
  composeIa2vShot,
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
      id: "silas",
      name: "Silas",
      species: "tiger",
      wardrobe: "a grey henley, worn at the cuffs",
      signatureFeature: "a notched left ear",
    },
    { id: "bruno", name: "Bruno", species: "gorilla", wardrobe: "a mint hoodie" },
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

const scene: Scene = sceneSchema.parse({
  id: "sc1",
  slugline: "INT. THE LOFT — DUSK",
  location: "loft",
});

const shot = (patch: Partial<Shot> = {}): Shot =>
  shotSchema.parse({
    id: "sh1",
    title: "Silas, to camera",
    characters: ["silas"],
    location: "loft",
    camera: { shotSize: "mcu", move: "static", lens: "shallow" },
    keyframes: [{ id: "k1", asset: "projects/p/assets/image/silas-single.png", approved: true }],
    selectedKeyframe: "k1",
    scriptLines: [
      { id: "l1", character: "silas", text: "Let the mud settle.", deliveryNotes: "quiet" },
    ],
    ...patch,
  });

const takes = [
  { take: "projects/p/assets/audio/silas.wav", character: "silas", durationSec: 2 },
];

test("the prompt is motion only — no set, no wardrobe block, no lens, no look", () => {
  const out = composeIa2vShot(shot(), scene, bible, { takes, durationSec: 6 });
  // the things the start frame already decided
  assert.doesNotMatch(out.prompt, /dusk light|deep focus|bokeh|warm sitcom/i);
  assert.doesNotMatch(out.prompt, /worn at the cuffs|notched left ear/i);
  assert.doesNotMatch(out.prompt, /medium close-up|shallow depth/i);
  // …and the one thing it is for
  assert.match(out.prompt, /Silas the tiger in a grey henley talks, mouth moving while speaking/);
});

test("under 7s no background-hold clause; past it, exactly one", () => {
  const short = composeIa2vShot(shot(), scene, bible, { takes, durationSec: 6 });
  assert.doesNotMatch(short.prompt, /stay exactly as they are/);
  const long = composeIa2vShot(shot(), scene, bible, { takes, durationSec: 8 });
  assert.match(long.prompt, /stay exactly as they are in the first frame/);
  assert.equal(long.prompt.match(/stay exactly as they are/g)?.length, 1);
  assert.ok(long.notes.some((n) => /dissolve/.test(n)));
});

test("the camera move is the one framing fact allowed, and reads as a sentence", () => {
  const still = composeIa2vShot(shot(), scene, bible, { takes });
  assert.match(still.prompt, /Static camera, locked-off shot, no camera movement\./);
  const moving = composeIa2vShot(
    shot({ camera: { shotSize: "mcu", move: "push-in", angle: "", lens: "", lighting: "", notes: "" } }),
    scene,
    bible,
    { takes },
  );
  assert.match(moving.prompt, /Slow smooth push-in toward the subject\./);
});

test("desk direction rides the prompt — it is instruction, which is motion", () => {
  const out = composeIa2vShot(
    shot({ takeNotes: ["hold the framing, do not stand up"] }),
    scene,
    bible,
    { takes },
  );
  assert.match(out.prompt, /Direction: hold the framing, do not stand up\./);
});

test("the placed lines come back on the clock, so the caller can lay the bed", () => {
  const out = composeIa2vShot(shot(), scene, bible, { takes, leadInSec: 1 });
  assert.equal(out.planned.length, 1);
  assert.equal(out.planned[0].atSec, 1);
  assert.equal(out.startFrame, "projects/p/assets/image/silas-single.png");
});

test("an unboarded shot says so — ia2v is motion over a still, not a plate", () => {
  const out = composeIa2vShot(shot({ keyframes: [], selectedKeyframe: null }), scene, bible, {
    takes,
  });
  assert.equal(out.startFrame, null);
  assert.ok(out.notes.some((n) => /board it first/.test(n)));
});

test("a second character in the frame is told to keep their mouth closed", () => {
  const out = composeIa2vShot(shot({ characters: ["silas", "bruno"] }), scene, bible, { takes });
  assert.match(out.prompt, /Bruno the gorilla in a mint hoodie listens in silence, mouth closed/);
});

test("the lead-in names the cast — it does not repeat the wardrobe at the frame", () => {
  const out = composeIa2vShot(shot(), scene, bible, { takes, leadInSec: 1 });
  assert.match(out.prompt, /^Silas holds still for a beat before speaking\./);
  // …while the BEAT still carries the identity anchor lip-sync localises on
  assert.match(out.prompt, /Silas the tiger in a grey henley talks/);
  const pair = composeIa2vShot(shot({ characters: ["silas", "bruno"] }), scene, bible, {
    takes,
    leadInSec: 1,
  });
  assert.match(pair.prompt, /^Silas and Bruno hold still for a beat before speaking\./);
});

test("a direction note that already ends in a full stop doesn't get a second", () => {
  const out = composeIa2vShot(shot({ takeNotes: ["hold the framing."] }), scene, bible, { takes });
  assert.match(out.prompt, /Direction: hold the framing\.$/);
});
