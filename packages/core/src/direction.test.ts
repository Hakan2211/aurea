/* Retake direction is instruction, never diagnosis (pilot defect #8). */

import test from "node:test";
import assert from "node:assert/strict";
import {
  directionPhrases,
  lintDirectionNote,
  productionRetakeShotSchema,
  FIX_VOCABULARY,
} from "@aurea/shared";

test("the lint refuses a diagnosis and accepts an instruction", () => {
  assert.match(lintDirectionNote("he stood up and the set vanished") ?? "", /reads as a diagnosis/);
  assert.match(lintDirectionNote("the take drifted wide") ?? "", /reads as a diagnosis/);
  assert.match(lintDirectionNote("camera pulled back instead of holding") ?? "", /reads as a diagnosis/);
  assert.match(lintDirectionNote("didn't hold the framing") ?? "", /reads as a diagnosis/);
  assert.equal(lintDirectionNote("stay seated, hold the framing"), null);
  assert.equal(lintDirectionNote("static camera, no pull-back"), null);
  assert.equal(lintDirectionNote("tighter framing; let the pause land"), null);
  assert.equal(lintDirectionNote(""), null);
});

test("fixes become their measured phrasing, first, then the free note", () => {
  assert.deepEqual(directionPhrases(["stay-seated", "hold-framing"], "let the pause land"), [
    FIX_VOCABULARY["stay-seated"],
    FIX_VOCABULARY["hold-framing"],
    "let the pause land",
  ]);
  assert.deepEqual(directionPhrases(["static", "static"], "  "), [FIX_VOCABULARY.static]);
  assert.deepEqual(directionPhrases(undefined, "tighter"), ["tighter"]);
});

test("the retake schema takes a note, a fix list, or both; unknown fixes are rejected", () => {
  const ok = productionRetakeShotSchema.parse({ project: "p", shotId: "s", fix: ["stay-seated"] });
  assert.equal(ok.note, "");
  assert.deepEqual(ok.fix, ["stay-seated"]);
  assert.equal(ok.allowDiagnosis, false);
  assert.throws(() => productionRetakeShotSchema.parse({ project: "p", shotId: "s", fix: ["dance"] }));
});
