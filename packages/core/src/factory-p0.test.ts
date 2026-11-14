/* Episode-factory P0 plumbing: the derived shot stage and the multi-shot
 * prose detector. Both are pure, and both guard measured facts — the pilot's
 * finding that the Gemma enhancer destroys multi-shot structure, and the rule
 * that a stage must never disagree with the data on the shot. */

import test from "node:test";
import assert from "node:assert/strict";
import type { z } from "zod";
import { isMultiShotProse, shotSchema, shotStage, type Shot } from "@aurea/shared";

// patches are schema INPUT (defaults still absent), not the parsed output type
const shot = (patch: Partial<z.input<typeof shotSchema>> = {}): Shot =>
  shotSchema.parse({ id: "s1", ...patch });

test("shotStage derives the furthest milestone from what is on the shot", () => {
  assert.equal(shotStage(shot()), "script");
  assert.equal(
    shotStage(shot({ voTakes: [{ id: "t1", asset: "a.wav", lineId: "l1" }] })),
    "voiced",
  );
  assert.equal(
    shotStage(
      shot({
        voTakes: [{ id: "t1", asset: "a.wav" }],
        keyframes: [{ id: "k1", asset: "k.png" }],
      }),
    ),
    "boarded",
  );
  assert.equal(
    shotStage(
      shot({
        keyframes: [{ id: "k1", asset: "k.png" }],
        videoTakes: [{ id: "v1", asset: "v.mp4", engine: "ltx25" }],
      }),
    ),
    "rendered",
  );
  // the one human verdict is persisted status, and it wins over everything
  assert.equal(shotStage(shot({ status: "approved" })), "approved");
});

test("old production.json shots parse unchanged and land at stage script", () => {
  // takeNotes and lineId did not exist before P0 — absent fields must default
  const s = shotSchema.parse({ id: "legacy" });
  assert.deepEqual(s.takeNotes, []);
  assert.equal(shotStage(s), "script");
});

test("isMultiShotProse spots the pilot's named-transition grammar", () => {
  // the exact phrasing the pilot's winning prompt used
  assert.ok(
    isMultiShotProse(
      "A wide two-shot across the table. A hard cut transitions to a tight single of Sterling.",
    ),
  );
  assert.ok(isMultiShotProse("The camera holds, then a cut to Milo's single."));
  assert.ok(isMultiShotProse("A match cut transitions to the lounge at night."));
});

test("isMultiShotProse leaves single-take prompts alone", () => {
  assert.ok(!isMultiShotProse("Sterling leans forward and speaks, the camera slowly dollying in."));
  // "haircut" and other embeddings must not read as a transition
  assert.ok(!isMultiShotProse("Milo admires his fresh haircut together with Sterling."));
  assert.ok(!isMultiShotProse(""));
});
