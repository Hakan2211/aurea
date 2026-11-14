import assert from "node:assert/strict";
import { test } from "node:test";
import { SETTINGS_VERSION, settingsSchema } from "@aurea/shared";
import { migrateSettings } from "./settings.js";

/** the sub-objects the schema has no default for */
const blank = () => ({
  storage: { dataRoot: "C:/Aurea" },
  paths: {},
  providers: {},
  general: {},
  advanced: {},
});

/** a settings object as an OLD file parses — version 1, sage off */
const v1 = () =>
  settingsSchema.parse({
    ...blank(),
    version: 1,
    engines: {
      videoTuning: { sageAttention: false },
      minimaxTuning: { sageAttention: false },
    },
  });

test("a v1 file lifts H3's sage toggle, and says it moved", () => {
  const s = v1();
  assert.equal(migrateSettings(s), true);
  assert.equal(s.engines.minimaxTuning.sageAttention, true);
  assert.equal(s.version, SETTINGS_VERSION);
});

test("LTX's identical toggle is left alone — that one is a picture change", () => {
  const s = v1();
  migrateSettings(s);
  assert.equal(s.engines.videoTuning.sageAttention, false);
});

test("migrating twice is a no-op — a deliberate OFF survives the next boot", () => {
  const s = v1();
  migrateSettings(s);
  s.engines.minimaxTuning.sageAttention = false; // the user turns it back off
  assert.equal(migrateSettings(s), false);
  assert.equal(s.engines.minimaxTuning.sageAttention, false);
});

test("a fresh file is already current — sage defaults on for H3", () => {
  const s = settingsSchema.parse(blank());
  assert.equal(s.version, SETTINGS_VERSION);
  assert.equal(s.engines.minimaxTuning.sageAttention, true);
  assert.equal(migrateSettings(s), false);
});
