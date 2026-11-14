/* Preview (P5) — the pure transform, the derived stage, and the store's two
 * new rules: a preview is under review but never "rendered", and approving
 * one carries its seed instead of landing on the sequence. */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  judgeBoardHold,
  previewCanvas,
  previewFields,
  productionSchema,
  shotSchema,
  shotStage,
} from "@aurea/shared";
import { expectationOf } from "./take-delivery.js";
import { parseSsim } from "./qc.js";
import { StudioStore } from "./studio.js";
import type { SettingsStore } from "./settings.js";
import type { ProjectStore } from "./projects.js";

/* ---------- the transform ---------- */

test("previewCanvas keeps the lane's orientation at 480p-class", () => {
  assert.equal(previewCanvas("768 × 1344 (9:16 · native)"), "640 × 1120 (preview)");
  assert.equal(previewCanvas("1280 × 704 (16:9)"), "1120 × 640 (preview)");
  assert.equal(previewCanvas("1024 × 1024"), "832 × 832 (preview)");
  assert.equal(previewCanvas(undefined), "1120 × 640 (preview)");
});

test("previewFields: 2s (4s on H3), draft tier, enhancer off, audio and timeline dropped", () => {
  const ltx = previewFields({ engine: "ltx25", resolution: "1280 × 704 (16:9)" });
  assert.equal(ltx.durationSec, 2);
  assert.equal(ltx.fast, true);
  assert.equal(ltx.enhance, false);
  assert.equal(ltx.audio, undefined);
  assert.equal(ltx.director, undefined);
  assert.deepEqual(ltx.keyframes, []);
  const h3 = previewFields({ engine: "minimax-h3", resolution: "768 × 1344 (9:16 · native)" });
  assert.equal(h3.durationSec, 4);
  assert.equal(h3.minimaxTier, "draft");
  assert.equal(h3.resolution, "640 × 1120 (preview)");
});

test("the preview's canvas sits inside the 1MP draft guard", () => {
  for (const r of ["640 × 1120 (preview)", "1120 × 640 (preview)", "832 × 832 (preview)"]) {
    const [w, h] = r.match(/(\d+)/g)!.map(Number);
    assert.ok((w * h) / 1_000_000 < 0.9, r);
    assert.equal(w % 32, 0);
    assert.equal(h % 32, 0);
  }
});

test("board hold: SSIM lines and the ffmpeg summary parser", () => {
  assert.equal(judgeBoardHold(0.81).status, "pass", "the measured own-board score");
  assert.equal(judgeBoardHold(0.66).status, "warn", "a sibling board's score");
  assert.equal(judgeBoardHold(0.4).status, "fail");
  assert.equal(judgeBoardHold(null).status, "warn");
  assert.equal(parseSsim("[Parsed_ssim_0 @ 0x1] SSIM Y:0.912 (10.5) U:0.95 V:0.96 All:0.9213 (12.71)"), 0.9213);
  assert.equal(parseSsim("nothing here"), null);
});

test("expectationOf reads the preview flag off the board payload", () => {
  assert.equal(expectationOf({ durationSec: 2, board: { preview: true } }).preview, true);
  assert.equal(expectationOf({ durationSec: 5 }).preview, false);
});

/* ---------- the derived stage ---------- */

const render = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  asset: `projects/p/assets/video/${id}.mp4`,
  engine: "ltx25",
  label: "",
  ...extra,
});

test("a shot with only a preview is still 'boarded' — a preview is not a render", () => {
  const shot = shotSchema.parse({
    id: "s",
    keyframes: [{ id: "k", asset: "projects/p/assets/image/k.png" }],
    videoTakes: [render("pre", { preview: true, seed: 7 })],
  });
  assert.equal(shotStage(shot), "boarded");
  const withRender = { ...shot, videoTakes: [...shot.videoTakes, render("t1")] };
  assert.equal(shotStage(withRender), "rendered");
});

/* ---------- the store ---------- */

function makeStore(shotPatch: Record<string, unknown>) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aurea-preview-"));
  const settings = { get: () => ({ storage: { dataRoot: tmp } }) } as unknown as SettingsStore;
  const projects = { list: () => [{ id: "p", name: "P" }] } as unknown as ProjectStore;
  const store = new StudioStore(settings, projects);
  store.updateProduction(
    "p",
    productionSchema.parse({
      title: "P",
      seasons: [
        {
          id: "s1",
          number: 1,
          episodes: [
            {
              id: "e1",
              number: 1,
              title: "E1",
              scenes: [{ id: "sc1", slugline: "INT.", shots: [shotSchema.parse({ id: "sh1", ...shotPatch })] }],
            },
          ],
        },
      ],
    }),
  );
  return store;
}

test("attachTake with preview flags the take, records the seed, and leaves the status alone", () => {
  const store = makeStore({ status: "boarded", keyframes: [{ id: "k", asset: "projects/p/assets/image/k.png" }] });
  const { shot } = store.attachTake("p", "sh1", ["projects/p/assets/video/pre.mp4"], "ltx25", {
    durationSec: 2,
    preview: true,
    seed: 4242,
  });
  assert.equal(shot.videoTakes[0].preview, true);
  assert.equal(shot.videoTakes[0].seed, 4242);
  assert.equal(shot.status, "boarded");
  assert.equal(shot.selectedTake, shot.videoTakes[0].id, "the preview is what you review next");
  assert.equal(shotStage(shot), "boarded");
});

test("approving a preview by id carries its seed and touches neither status nor pick", () => {
  const store = makeStore({
    status: "generated",
    videoTakes: [render("t1"), render("pre", { preview: true, seed: 99 })],
    selectedTake: "pre",
  });
  const { shot, take } = store.approveShot("p", "sh1", "pre");
  assert.equal(take.preview, true);
  assert.deepEqual({ takeId: shot.approvedPreview?.takeId, seed: shot.approvedPreview?.seed }, { takeId: "pre", seed: 99 });
  assert.equal(shot.status, "generated");
  assert.equal(shot.selectedTake, "pre");
  // persisted
  assert.equal(store.getProduction("p").seasons[0].episodes[0].scenes[0].shots[0].approvedPreview?.seed, 99);
});

test("an unnamed approval skips previews and locks the newest render", () => {
  const store = makeStore({
    status: "generated",
    videoTakes: [render("t1"), render("pre", { preview: true, seed: 1 })],
    selectedTake: "pre",
  });
  const { shot, take } = store.approveShot("p", "sh1");
  assert.equal(take.id, "t1");
  assert.equal(shot.status, "approved");
  assert.equal(shot.selectedTake, "t1");
});

test("a shot with only previews cannot be approved unnamed, and a seedless preview cannot be approved at all", () => {
  assert.throws(
    () => makeStore({ videoTakes: [render("pre", { preview: true, seed: 1 })] }).approveShot("p", "sh1"),
    /only previews/,
  );
  assert.throws(
    () => makeStore({ videoTakes: [render("pre", { preview: true })] }).approveShot("p", "sh1", "pre"),
    /carries no seed/,
  );
});

test("approvedTakeAssets never lists a preview, even when it is the selected take of an approved shot", () => {
  const store = makeStore({
    status: "approved",
    videoTakes: [render("t1"), render("pre", { preview: true, seed: 1 })],
    selectedTake: "pre",
  });
  assert.deepEqual(store.approvedTakeAssets("p"), []);
  assert.deepEqual(store.approvedTakes("p"), []);
});

test("a broken preview falls back to the newest ok preview, not to a render", () => {
  const store = makeStore({
    status: "generated",
    videoTakes: [
      render("t1", { verify: { status: "ok", reasons: [] } }),
      render("pre1", { preview: true, seed: 1, verify: { status: "ok", reasons: [] } }),
      render("pre2", { preview: true, seed: 2 }),
    ],
    selectedTake: "pre2",
  });
  const { shot } = store.recordTakeVerify("p", "sh1", "pre2", { status: "broken", reasons: ["zero decodable frames"] });
  assert.equal(shot.selectedTake, "pre1");
});
