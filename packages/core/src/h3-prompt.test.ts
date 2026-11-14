/* The two new prompt composers (upgrade plan §3.3).
 *
 * Both encode measured facts rather than taste, so the tests are about those
 * facts: H3's block form with its <d> dialogue tags and interval stamps, and
 * multi-shot prose with its named transitions, verbatim repetition and line
 * budgets. A regression in either is silent at compose time and costs a render
 * to discover, which is exactly what a unit test is for. */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AIRLOCK_SEC,
  bibleSchema,
  composeH3Prompt,
  composeH3Shot,
  composeMultiShotProse,
  isMultiShotProse,
  lineBudget,
  sceneSchema,
  shotSchema,
} from "@aurea/shared";

const bible = bibleSchema.parse({
  characters: [
    {
      id: "sterling",
      name: "Sterling",
      species: "lion",
      wardrobe: "a blue velvet blazer",
      signatureFeature: "a chipped left canine",
      anchors: { face: "heavy golden mane, amber eyes" },
    },
    {
      id: "milo",
      name: "Milo",
      species: "meerkat",
      wardrobe: "a knitted vest",
      anchors: { face: "narrow muzzle, dark eye stripes" },
    },
  ],
  locations: [
    {
      id: "lounge",
      name: "the Lounge",
      description: "a warm members' lounge with green leather chairs",
      stylePrompt: "a warm members' lounge, green leather, brass lamps",
    },
  ],
  style: { artDirection: "Stylized 3D animation, Pixar-quality." },
});

const scene = sceneSchema.parse({
  id: "sc1",
  slugline: "INT. THE LOUNGE — DAY",
  location: "lounge",
  shots: [],
});

const twoHander = shotSchema.parse({
  id: "s1",
  title: "Sterling defends the fund",
  characters: ["sterling", "milo"],
  location: "lounge",
  camera: { shotSize: "ws", angle: "eye", move: "", lens: "", lighting: "", notes: "" },
  scriptLines: [
    { id: "l1", character: null, text: "Sterling settles behind the desk." },
    { id: "l2", character: "sterling", text: "The fund is fine." },
    { id: "l3", character: "milo", text: "That is not what the ledger says." },
  ],
});

/* ---------- H3 block prompt ---------- */

test("the H3 prompt carries every block the model was trained to read", () => {
  const composed = composeH3Shot(twoHander, scene, bible, {
    takes: [
      { take: "a.wav", character: "sterling", durationSec: 1.8 },
      { take: "b.wav", character: "milo", durationSec: 2.4 },
    ],
  });
  const p = composed.prompt;
  for (const label of [
    "Subject definitions:",
    "Summary:",
    "Detailed description:",
    "Overall soundscape:",
    "Non-diegetic music:",
  ]) {
    assert.ok(p.includes(label), `missing block "${label}":\n${p}`);
  }
  // the identity anchors ride the subject definitions verbatim
  assert.match(p, /Sterling: a lion character, wearing a blue velvet blazer/);
  assert.match(p, /chipped left canine/);
  // dialogue is tagged, attributed and quoted verbatim
  assert.ok(p.includes('<d>Sterling: "The fund is fine."</d>'), p);
  assert.ok(p.includes('<d>Milo: "That is not what the ledger says."</d>'), p);
  // …inside an interval-stamped beat
  assert.match(p, /\[0s-\d/);
  // and the beat still names the speaker and silences the other — the
  // measured lip-sync wording, which H3 needs for the same reason LTX does
  assert.match(p, /Milo the meerkat[^\n]*listens in silence, mouth closed/);
  assert.equal(composed.input.music, null);
  assert.match(p, /Non-diegetic music: N\/A/);
});

test("H3 shots stay inside the model's own 15s window", () => {
  const long = shotSchema.parse({
    id: "s2",
    characters: ["sterling"],
    scriptLines: Array.from({ length: 8 }, (_, i) => ({
      id: `l${i}`,
      character: "sterling",
      text: "This is a long speech that keeps going and going and going.",
    })),
  });
  const composed = composeH3Shot(long, scene, bible);
  assert.ok(composed.durationSec <= 15, `${composed.durationSec}s is past H3's window`);
  assert.ok(
    composed.notes.some((n) => n.includes("window")),
    "an over-long shot must say so rather than being silently truncated",
  );
});

test("composeH3Prompt is a pure formatter — no shot required", () => {
  const p = composeH3Prompt({
    subjects: [{ name: "Alli", description: "a penguin in a courier jacket" }],
    summary: "Alli waits at the counter",
    beats: [{ fromSec: 0, toSec: 3, action: "Alli stands very still", lines: [] }],
    soundscape: "fluorescent hum",
    music: null,
  });
  assert.match(p, /Alli: a penguin in a courier jacket\./);
  assert.match(p, /\[0s-3s\] Alli stands very still/);
});

/* ---------- multi-shot prose ---------- */

test("multi-shot prose names every transition and repeats the cast verbatim", () => {
  const composed = composeMultiShotProse(twoHander, scene, bible, {
    takes: [
      { take: "a.wav", character: "sterling", durationSec: 3 },
      { take: "b.wav", character: "milo", durationSec: 3 },
    ],
  });
  const p = composed.prompt;

  // the signature the renderer detects — and the flag it forces off
  assert.ok(isMultiShotProse(p), `not detected as multi-shot prose:\n${p}`);
  assert.ok(composed.notes.some((n) => n.includes("enhancer OFF")));

  // one paragraph, never a shot list
  assert.doesNotMatch(p, /^\s*(SHOT|INT\.|EXT\.)/im);
  assert.doesNotMatch(p, /\n/);

  // the room is restated at every cut, in the same words
  const roomMentions = p.split("the Lounge").length - 1;
  assert.equal(roomMentions, composed.segments.length, `room stated ${roomMentions} times`);

  // one stable tag per character, and the lines quoted verbatim
  assert.ok(p.includes('"The fund is fine."'), p);
  assert.ok(p.includes('"That is not what the ledger says."'), p);
  assert.match(p, /Sterling the lion in a blue velvet blazer/);

  // and it lands settled
  assert.match(p, /lands settled/);
});

test("a line that cannot fit its shot is flagged, not silently clipped", () => {
  const tight = shotSchema.parse({
    id: "s3",
    characters: ["sterling"],
    location: "lounge",
    scriptLines: [
      {
        id: "l1",
        character: "sterling",
        text: "The fund is fine and the ledger is fine and everybody in this building is fine, thank you very much for asking me about it again.",
      },
    ],
  });
  const composed = composeMultiShotProse(tight, scene, bible, {
    takes: [{ take: "a.wav", character: "sterling", durationSec: 2 }],
  });
  assert.ok(
    composed.warnings.some((w) => w.includes("clipped") || w.includes("airlock")),
    `no budget warning raised: ${JSON.stringify(composed.warnings)}`,
  );
});

test("the line budget is the measured one: a 5s shot cannot hold a line plus its airlock", () => {
  // joeygambino's numbers: 10s ≈ 15 words, 15s ≈ 27 words
  assert.equal(lineBudget(10), Math.floor((10 - AIRLOCK_SEC) * 1.8));
  assert.ok(lineBudget(10) >= 14 && lineBudget(10) <= 16, `${lineBudget(10)} words at 10s`);
  assert.ok(lineBudget(15) >= 23 && lineBudget(15) <= 27, `${lineBudget(15)} words at 15s`);
  assert.equal(lineBudget(2), 0, "a 2s shot is all airlock");
});

test("more than four framings in one generation is called out", () => {
  const busy = shotSchema.parse({
    id: "s4",
    characters: ["sterling", "milo"],
    location: "lounge",
    scriptLines: Array.from({ length: 5 }, (_, i) => ({
      id: `l${i}`,
      character: i % 2 ? "milo" : "sterling",
      text: "A short line.",
    })),
  });
  const composed = composeMultiShotProse(busy, scene, bible);
  assert.ok(composed.segments.length > 4);
  assert.ok(composed.warnings.some((w) => w.includes("drifting")), JSON.stringify(composed.warnings));
});
