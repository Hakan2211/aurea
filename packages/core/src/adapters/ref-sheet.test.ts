/* The sheet and the prose that describes it have to agree cell for cell — that
 * agreement is the whole feature, and nothing downstream can check it, so it's
 * checked here. The last test actually shells ffmpeg: the layout is only true if
 * the pixels land where the labels say they do. */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { composeSheetPrompt, sheetLayout, type DirectorRef } from "@aurea/shared";
import { composeRefSheet } from "./ref-sheet.js";

const ref = (over: Partial<DirectorRef> = {}): DirectorRef => ({
  image: "library/hero.png",
  name: "",
  kind: "character",
  description: "",
  ...over,
});

test("one reference fills the sheet and isn't given a position", () => {
  const layout = sheetLayout(1);
  assert.deepEqual(layout, {
    cols: 1,
    rows: 1,
    cells: [{ index: 0, row: 0, col: 0, label: "Reference" }],
  });
});

test("more than one lays out two to a row, top to bottom", () => {
  assert.deepEqual(
    sheetLayout(5).cells.map((c) => c.label),
    ["Top Row Left", "Top Row Right", "Middle Row Left", "Middle Row Right", "Bottom Row Left"],
  );
  assert.deepEqual(
    sheetLayout(2).cells.map((c) => c.label),
    ["Top Row Left", "Top Row Right"],
  );
  // four rows have no "middle" to speak of
  assert.equal(sheetLayout(6).rows, 3);
});

test("the description block names every cell with its role", () => {
  const prompt = composeSheetPrompt(
    [
      ref({ name: "Sterling", description: "a lion in a cream three-piece suit" }),
      ref({ kind: "prop", name: "Mug", description: "a chipped enamel mug" }),
      ref({ kind: "setting", description: "a fluorescent office breakroom" }),
    ],
    "sterling pours coffee and freezes",
  );
  assert.equal(
    prompt,
    [
      "### Reference Sheet Description",
      "**Top Row Left (Character - Sterling):** a lion in a cream three-piece suit",
      "**Top Row Right (Prop - Mug):** a chipped enamel mug",
      // three refs make two rows, so the third cell is the bottom one
      "**Bottom Row Left (Setting):** a fluorescent office breakroom",
      "### Target Description",
      "sterling pours coffee and freezes",
    ].join("\n"),
  );
});

test("a ref with no prose still gets a line, and no refs changes nothing", () => {
  assert.match(composeSheetPrompt([ref({ name: "Grant" })], "x"), /\(Character - Grant\):\*\* Grant/);
  assert.match(composeSheetPrompt([ref()], "x"), /\(Character\):\*\* Character/);
  assert.equal(composeSheetPrompt([], "just the shot"), "just the shot");
});

test("the sheet is drawn at the shot's aspect, cells in label order", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aurea-sheet-"));
  try {
    /* Three flat colours, so a pixel probe says which cell each one landed in.
     * They're deliberately the wrong shape for their cells (a wide strip into a
     * portrait-ish cell) — the sheet must pad them, never crop. */
    const colours = ["red", "lime", "blue"];
    const images = colours.map((c, i) => {
      const file = path.join(dir, `${i}.png`);
      execFileSync(
        "ffmpeg",
        ["-y", "-f", "lavfi", "-i", `color=c=${c}:s=640x200`, "-frames:v", "1", file],
        { windowsHide: true, stdio: "ignore" },
      );
      return file;
    });

    const sheet = await composeRefSheet({
      images,
      out: path.join(dir, "sheet.png"),
      aspect: 704 / 896, // the house portrait shot
    });

    assert.equal(sheet.cols, 2);
    assert.equal(sheet.rows, 2);
    assert.ok(Math.abs(sheet.width / sheet.height - 704 / 896) < 0.01, "sheet keeps the shot's aspect");

    const at = (xFrac: number, yFrac: number) =>
      execFileSync(
        "ffmpeg",
        [
          "-i",
          sheet.file,
          "-vf",
          `crop=2:2:${Math.round(sheet.width * xFrac)}:${Math.round(sheet.height * yFrac)}`,
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "-",
        ],
        { windowsHide: true, maxBuffer: 1 << 20 },
      ).subarray(0, 3);

    const near = (got: Buffer, want: [number, number, number]) =>
      want.every((v, i) => Math.abs(got[i] - v) < 24);

    assert.ok(near(at(0.25, 0.25), [255, 0, 0]), "top row left is the first ref");
    assert.ok(near(at(0.75, 0.25), [0, 255, 0]), "top row right is the second");
    assert.ok(near(at(0.25, 0.75), [0, 0, 255]), "bottom row left is the third");
    // the fourth cell is unused — white, not black, so it reads as an empty slot
    assert.ok(near(at(0.75, 0.75), [255, 255, 255]), "the empty cell stays white");
    // and the padding above a letterboxed cell is white too, not a crop
    assert.ok(near(at(0.25, 0.03), [255, 255, 255]), "cells are padded, never cropped");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
