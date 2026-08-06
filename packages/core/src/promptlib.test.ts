import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bibleSchema } from "@aurea/shared";
import { PromptLibrary, deriveStylePack } from "./promptlib.js";
import type { SettingsStore } from "./settings.js";

function freshLib(): { lib: PromptLibrary; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aurea-promptlib-"));
  const settings = { get: () => ({ storage: { dataRoot: root } }) } as unknown as SettingsStore;
  return { lib: new PromptLibrary(settings), root };
}

test("first read seeds the builtins and the shipped packs, once", () => {
  const { lib, root } = freshLib();
  const presets = lib.presets();
  assert.ok(presets.length >= 20, `seeded only ${presets.length}`);
  // the legacy seven survive by title — old jobs' preset strings still resolve
  for (const title of ["Cinematic", "Photographic", "Concept Art", "Minimal", "Moody", "Vintage", "Fantasy"]) {
    assert.ok(presets.some((p) => p.title === title && p.builtin), `missing legacy "${title}"`);
  }
  const packs = lib.packs();
  assert.deepEqual(packs.map((p) => p.id).sort(), ["animal-sitcom", "zoo-logic"]);

  // a deleted builtin STAYS deleted — the seed marker keeps reseeds away
  const gone = presets.find((p) => p.title === "Vintage")!;
  lib.removePreset(gone.id);
  assert.ok(!lib.presets().some((p) => p.id === gone.id), "delete did not stick");
  fs.rmSync(root, { recursive: true, force: true });
});

test("preset CRUD round-trips through disk", () => {
  const { lib, root } = freshLib();
  const saved = lib.savePreset({
    title: "Fever dream",
    category: "mood",
    text: "hallucinatory saturated color, impossible geometry",
    tags: ["weird"],
  });
  const back = lib.presets().find((p) => p.id === saved.id);
  assert.equal(back?.text, "hallucinatory saturated color, impossible geometry");
  assert.equal(back?.builtin, false);

  const renamed = lib.savePreset({ ...saved, title: "Fever dream v2" });
  assert.equal(renamed.id, saved.id);
  assert.equal(lib.presets().find((p) => p.id === saved.id)?.title, "Fever dream v2");
  fs.rmSync(root, { recursive: true, force: true });
});

test("project-scoped presets only show for their project", () => {
  const { lib, root } = freshLib();
  lib.savePreset({ title: "Zoo only", category: "style", text: "x", projectId: "zoo" });
  assert.ok(lib.presets("zoo").some((p) => p.title === "Zoo only"));
  assert.ok(!lib.presets("other").some((p) => p.title === "Zoo only"));
  assert.ok(!lib.presets().some((p) => p.title === "Zoo only"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("decks persist and list newest-first", () => {
  const { lib, root } = freshLib();
  const a = lib.saveDeck({ title: "Batch A", prompts: ["one", "two"], model: "krea2" });
  lib.saveDeck({ title: "Batch B", prompts: ["three"], model: "z-image" });
  const decks = lib.decks();
  assert.equal(decks.length, 2);
  assert.equal(decks.some((d) => d.id === a.id && d.prompts.length === 2), true);
  lib.removeDeck(a.id);
  assert.equal(lib.decks().length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test("the bible-derived pack is computed, not stored", () => {
  const bible = bibleSchema.parse({
    style: { artDirection: "stylized 3D, warm practicals", negativePrompt: "text, watermark" },
  });
  const pack = deriveStylePack(bible, "zoo")!;
  assert.equal(pack.fromBible, true);
  assert.equal(pack.presets[0].text, "stylized 3D, warm practicals");
  assert.equal(pack.negative, "text, watermark");
  // an empty bible derives nothing rather than an empty pack
  assert.equal(deriveStylePack(bibleSchema.parse({}), "zoo"), null);

  const { lib, root } = freshLib();
  const packs = lib.packs("zoo", bible);
  assert.equal(packs[0].fromBible, true);
  assert.equal(packs.length, 3);
  fs.rmSync(root, { recursive: true, force: true });
});
