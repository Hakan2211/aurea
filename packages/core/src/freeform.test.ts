/* The Freeform composer (VIDEO-LAB-FREEFORM-PLAN.md §2.3, F2).
 *
 * One test per wording rule, because each rule is a render that cost
 * minutes: an i2v prompt that re-describes the plate loses the frame, a
 * motion with no limit escalates, a look stacked twice is noise, an H3 clip
 * with no soundscape line arrives with invented sound, and text asked for in
 * the positive is an automatic retake. */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAMERA_HOLD_CLAUSE,
  CINEMATOGRAPHY_BANK,
  DEFAULT_SOUNDSCAPE,
  FRAME_HOLD_CLAUSE,
  NO_TEXT_NEGATIVE,
  STAYS_SEATED_CLAUSE,
  composeFreeform,
  freeformBank,
  freeformNegative,
  videoEnhanceSystem,
  videoPresetSchema,
  resolveLoraByFile,
  withStyleRefs,
  styleRefClause,
  sketchOverrides,
  sprayVariants,
  SKETCH_TIER,
  SPRAY_COUNT,
  minimaxRefsSchema,
  type VideoPreset,
} from "@aurea/shared";
import { SHIPPED_LOOKS } from "./promptlib.js";

const LOOK_PROSE =
  "Shot on 16mm colour reversal film: visible grain, warm halation, muted greens and amber skin tones";

function look(over: Partial<VideoPreset> = {}): VideoPreset {
  return videoPresetSchema.parse({
    id: "look-test",
    label: "Test look",
    lane: "look",
    payload: { engine: "ltx25", durationSec: 5, enhance: true },
    cine: { move: "handheld" },
    look: LOOK_PROSE,
    negative: "clean digital video, HDR",
    ...over,
  });
}

test("rule 1 · t2v writes the subject verbatim, first", () => {
  const out = composeFreeform({ subject: "A red barn at dusk, smoke rising from the chimney", mode: "t2v", look: look() });
  assert.ok(out.prompt.startsWith("A red barn at dusk, smoke rising from the chimney."), out.prompt);
  assert.equal(out.rules.includes("i2v-motion-only"), false);
});

test("rule 1 · i2v never re-describes the plate — only the motion is written", () => {
  const out = composeFreeform({
    subject: "A red barn at dusk under a violet sky, a rusted tractor in the foreground",
    motion: "smoke rises slowly from the chimney",
    mode: "i2v",
    look: look(),
  });
  assert.ok(out.prompt.startsWith("smoke rises slowly from the chimney"), out.prompt);
  assert.ok(!/red barn|violet sky|tractor/i.test(out.prompt), `the plate was re-described: ${out.prompt}`);
  assert.ok(out.rules.includes("i2v-motion-only"));
  assert.ok(out.notes.some((n) => n.startsWith("i2v: the subject line was not written")));
});

test("rule 1 · i2v with one line reads that line as the motion", () => {
  const out = composeFreeform({ subject: "the leaves stir in a light wind", mode: "i2v", look: look() });
  assert.ok(out.prompt.startsWith("the leaves stir in a light wind."), out.prompt);
});

test("rule 2 · i2v says what stays, once, and the camera holds when no move is set", () => {
  const still = look({ cine: {} });
  const out = composeFreeform({ subject: "her eyes open", mode: "i2v", look: still });
  assert.ok(out.prompt.includes(FRAME_HOLD_CLAUSE), out.prompt);
  assert.ok(out.prompt.includes(CAMERA_HOLD_CLAUSE), out.prompt);
  // the prompt already says what stays → nothing is added
  const said = composeFreeform({
    subject: "her eyes open, everything else holds still, the camera holds",
    mode: "i2v",
    look: still,
  });
  assert.equal(said.prompt.includes(FRAME_HOLD_CLAUSE), false);
  assert.equal((said.prompt.match(/camera holds/g) ?? []).length, 1);
});

test("rule 2 · the craft table runs last: a seat adjustment gets the measured clause", () => {
  const out = composeFreeform({ subject: "he shifts in his chair and sighs", mode: "t2v", look: look() });
  assert.ok(out.prompt.includes(STAYS_SEATED_CLAUSE), out.prompt);
  assert.ok(out.notes.some((n) => n.startsWith("Rule stays-seated changed the prompt")));
});

test("rule 3 · the look's camera ids become bank prose with no bible in sight", () => {
  const out = composeFreeform({ subject: "a cat on a windowsill", mode: "t2v", look: look() });
  assert.ok(out.prompt.includes("handheld camera with subtle shake"), out.prompt);
  assert.ok(!/\bhandheld\.\s/.test(out.prompt), "a bare id leaked through");
  // the user's own pick wins over the look's
  const over = composeFreeform({ subject: "a cat on a windowsill", mode: "t2v", look: look(), cine: { move: "static", shotSize: "" } });
  assert.ok(over.prompt.includes("static camera, locked-off shot"), over.prompt);
  assert.ok(!over.prompt.includes("handheld camera"));
  // an empty project bank falls back to the shipped one; a filled one is used
  assert.equal(freeformBank({ shotSizes: [], angles: [], lenses: [], moves: [], lighting: [], compositions: [] } as never), CINEMATOGRAPHY_BANK);
});

test("rule 4 · the look prose goes on last and exactly once", () => {
  const out = composeFreeform({ subject: "a cat on a windowsill", mode: "t2v", look: look() });
  assert.ok(out.prompt.trimEnd().endsWith(`${LOOK_PROSE}.`), out.prompt);
  assert.equal(out.prompt.split(LOOK_PROSE).length - 1, 1);
  // a prompt the user already wrote the look into is left alone
  const again = composeFreeform({ subject: `a cat on a windowsill. ${LOOK_PROSE}`, mode: "t2v", look: look() });
  assert.equal(again.prompt.split(LOOK_PROSE).length - 1, 1);
});

test("rule 5 · H3 gets the block form with a soundscape line; LTX 2.5 is flagged silent", () => {
  const h3 = look({ payload: { engine: "minimax-h3", durationSec: 6 }, sound: "" });
  const out = composeFreeform({ subject: "a kettle comes to the boil", mode: "t2v", look: h3 });
  assert.ok(out.prompt.startsWith("Summary: a kettle comes to the boil"), out.prompt);
  assert.ok(out.prompt.includes("[0s-6s]"), out.prompt);
  assert.ok(out.prompt.includes(`Overall soundscape: ${DEFAULT_SOUNDSCAPE}`), out.prompt);
  assert.ok(out.prompt.includes("Non-diegetic music: N/A"));
  assert.equal(out.rules.includes("silent"), false);

  const named = composeFreeform({
    subject: "a kettle comes to the boil",
    mode: "t2v",
    look: look({ payload: { engine: "minimax-h3" }, sound: "a kettle ticking then roaring, no music" }),
  });
  assert.ok(named.prompt.includes("Overall soundscape: a kettle ticking then roaring, no music"));

  const ltx = composeFreeform({ subject: "a kettle comes to the boil", mode: "t2v", look: look() });
  assert.ok(ltx.rules.includes("silent"), ltx.rules.join());
  assert.ok(!ltx.prompt.includes("Overall soundscape"));
  // an audio bed silences the flag
  const bed = composeFreeform({ subject: "a kettle comes to the boil", mode: "t2v", look: look(), hasAudio: true });
  assert.equal(bed.rules.includes("silent"), false);
  // so does a sound cue in the user's own line — 2.5 renders named ambience
  // (the kettle landed at mean −23 dB, 2026-09-02); the look's prose does not
  // count, only what the user wrote
  const cued = composeFreeform({ subject: "a kettle comes to the boil, its hiss rising to a whistle", mode: "t2v", look: look() });
  assert.equal(cued.rules.includes("silent"), false, cued.notes.join("\n"));
  const lookOnly = composeFreeform({ subject: "a kettle comes to the boil", mode: "t2v", look: look({ look: "a hum of tape hiss" }) });
  assert.ok(lookOnly.rules.includes("silent"), "sound words in the look prose are not a cue");
});

test("rule 6 · text is always in the negative and never asked for in the positive", () => {
  const out = composeFreeform({ subject: "a cat on a windowsill", mode: "t2v", look: look() });
  for (const term of NO_TEXT_NEGATIVE.split(", ")) assert.ok(out.negative.includes(term), term);
  assert.ok(out.negative.startsWith("clean digital video, HDR"), "the look's own negative goes first");
  assert.equal(out.rules.includes("text-in-positive"), false);
  // duplicates collapse
  assert.equal(freeformNegative("text, HDR, Text").split(", ").filter((t) => t.toLowerCase() === "text").length, 1);
  // a request for lettering is flagged, not rewritten — the user's words stay
  const ask = composeFreeform({ subject: "a news anchor with a caption reading BREAKING", mode: "t2v", look: look() });
  assert.ok(ask.rules.includes("text-in-positive"));
  assert.ok(ask.prompt.includes("caption reading BREAKING"));
});

test("engine and enhancer state come off the look and stay explicit", () => {
  const out = composeFreeform({ subject: "x", mode: "t2v", look: look() });
  assert.equal(out.engine, "ltx25");
  assert.equal(out.durationSec, 5);
  assert.equal(out.enhance, true);
  const h3 = composeFreeform({ subject: "x", mode: "t2v", look: look({ payload: { engine: "minimax-h3" } }) });
  assert.equal(h3.enhance, undefined);
});

test("every shipped look composes cleanly in both modes, and the H3 looks name their sound", () => {
  for (const l of SHIPPED_LOOKS) {
    for (const mode of ["i2v", "t2v"] as const) {
      const out = composeFreeform({ subject: "a woman looks up from her desk", mode, look: l });
      assert.ok(out.prompt.length > 40, l.id);
      assert.ok(out.negative.includes("watermark"), l.id);
      // no bank id leaked as a bare word
      for (const id of Object.values(l.cine)) {
        if (typeof id === "string" && !id.includes("."))
          assert.ok(!new RegExp(`(^|[.,] )${id}([.,]|$)`).test(out.prompt), `${l.id}: bare id "${id}" in ${out.prompt}`);
      }
    }
    if (l.payload.engine === "minimax-h3") assert.ok(l.sound.trim(), `${l.id} has no sound line`);
  }
});

test("the enhance steer carries the six rules and flips to motion-only for i2v", () => {
  const t2v = videoEnhanceSystem({ look: LOOK_PROSE, mode: "t2v" });
  assert.ok(t2v.includes("Lead with the subject"));
  assert.ok(t2v.includes("what moves AND what stays"));
  assert.ok(t2v.includes("ONE continuous shot"));
  assert.ok(t2v.includes("Do not restate the look"));
  assert.ok(t2v.includes("ambient sound"));
  assert.ok(t2v.includes("Never ask for text"));
  assert.ok(t2v.includes(LOOK_PROSE));
  const i2v = videoEnhanceSystem({ mode: "i2v" });
  assert.ok(i2v.includes("write ONLY what changes"));
  assert.ok(!i2v.includes("Lead with the subject"));
  const proj = videoEnhanceSystem({ art: "Pixar-grade stylised 3D", negative: "photoreal" });
  assert.ok(proj.includes("locked art direction"));
  assert.ok(proj.includes("Never include: photoreal"));
});

/* ---------- F3 · style ---------- */

test("a look's LoRA is named by file and resolved against the install's own list", () => {
  const options = [
    "ltx-style-anime\\loras\\Fantasy_Anime.safetensors",
    "ltx-camera-loras\\loras\\ltx-2-19b-lora-camera-control-static.safetensors",
    "midj-z-1.safetensors",
  ];
  assert.equal(resolveLoraByFile(options, "Fantasy_Anime.safetensors"), options[0]);
  assert.equal(resolveLoraByFile(options, "fantasy_anime.SAFETENSORS"), options[0], "case is the filesystem's, not ours");
  assert.equal(resolveLoraByFile(options, "midj-z-1.safetensors"), "midj-z-1.safetensors", "an exact option passes through");
  assert.equal(resolveLoraByFile(options, "Claymation.safetensors"), undefined, "not installed = undefined, never a guess");
  // the same file in two places is an ambiguity, not a match
  assert.equal(resolveLoraByFile([...options, "other/Fantasy_Anime.safetensors"], "Fantasy_Anime.safetensors"), undefined);
});

test("an H3 style still is tagged as reference footage, once, and never when the director already wrote it", () => {
  const refs = minimaxRefsSchema.parse({
    images: ["a.png", "b.png", "c.png"],
    imageRoles: ["subject", "style"],
  });
  const out = withStyleRefs("<Picture 1> walks through the market. The camera holds.", refs);
  assert.ok(out.startsWith("<Picture 1> walks through the market. The camera holds. "), "the user's prose comes first");
  assert.ok(out.includes(styleRefClause("<Picture 2>")), "the style still gets the footage wording");
  assert.ok(!out.includes("<Picture 3>"), "a still with no role is a subject and is left to the user");
  assert.ok(!out.includes("Match the visual style of <Picture 1>"));
  // the director already addressed the tag — keep their wording
  const own = "Grade it like <Picture 2>. <Picture 1> waits.";
  assert.equal(withStyleRefs(own, refs), own);
  // no refs, no change
  assert.equal(withStyleRefs("x", null), "x");
  assert.equal(withStyleRefs("x", minimaxRefsSchema.parse({})), "x");
});

/* ---------- F4 · sketch tier + seed spray ---------- */

test("the sketch tier is the LTX floor at draft, H3 gets its native canvas, and a look may override it", () => {
  const ltx = sketchOverrides(null, "ltx25");
  assert.equal(ltx.durationSec, SKETCH_TIER.durationSec);
  assert.equal(ltx.resolution, SKETCH_TIER.resolution);
  assert.equal(ltx.fast, true);
  assert.equal(ltx.minimaxTier, undefined);
  const h3 = sketchOverrides(null, "minimax-h3");
  assert.match(String(h3.resolution), /1344 × 768/);
  assert.equal(h3.minimaxTier, "draft");
  const own = sketchOverrides({ sketch: { durationSec: 2, resolution: "576 × 1024 (9:16 vertical)" } }, "ltx25");
  assert.equal(own.durationSec, 2);
  assert.equal(own.resolution, "576 × 1024 (9:16 vertical)");
  assert.equal(own.fast, true, "a look's sketch is still a draft");
});

test("a spray files N distinct seeds, each at the sketch tier, and prints them", () => {
  const vs = sprayVariants(null, "ltx25");
  assert.equal(vs.length, SPRAY_COUNT);
  const seeds = vs.map((v) => v.overrides.seed as number);
  assert.equal(new Set(seeds).size, seeds.length, "four seeds must be four seeds");
  for (const v of vs) {
    assert.ok(Number.isInteger(v.overrides.seed));
    assert.equal(v.overrides.durationSec, SKETCH_TIER.durationSec);
    assert.equal(v.overrides.fast, true);
    assert.ok(v.label.includes(String(v.overrides.seed)), "the label carries the seed");
  }
});
