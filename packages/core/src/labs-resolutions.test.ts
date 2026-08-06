import assert from "node:assert/strict";
import { test } from "node:test";
import { VIDEO_RESOLUTIONS, VIDEO_RESOLUTIONS_BY_ENGINE } from "./labs.js";

const parse = (preset: string) => {
  const m = preset.match(/(\d+)\s*×\s*(\d+)/);
  assert.ok(m, `unparseable preset: ${preset}`);
  return [Number(m[1]), Number(m[2])] as const;
};

/* ComfyUI silently floors an off-grid side and the take comes back a size
 * nobody chose (measured 2026-08-02: 608 × 1088 rendered 576 × 1088). The
 * grid is 64 for LTX (the ×2 upscaler halves the base pass) and 32 for H3. */
test("every LTX preset sits on the 64 grid", () => {
  for (const preset of [...VIDEO_RESOLUTIONS, ...VIDEO_RESOLUTIONS_BY_ENGINE.ltx2]) {
    for (const side of parse(preset)) {
      assert.equal(side % 64, 0, `${preset}: ${side} is not a multiple of 64`);
    }
  }
});

test("every MiniMax preset sits on the 32 grid", () => {
  for (const preset of VIDEO_RESOLUTIONS_BY_ENGINE["minimax-h3"]) {
    for (const side of parse(preset)) {
      assert.equal(side % 32, 0, `${preset}: ${side} is not a multiple of 32`);
    }
  }
});

test("seedance presets name the tiers its adapter matches on", () => {
  const all = VIDEO_RESOLUTIONS_BY_ENGINE.seedance.join(" ");
  assert.ok(all.includes("720"));
  assert.ok(all.includes("1080"));
});
