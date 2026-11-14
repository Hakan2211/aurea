/* Render lanes and the project look line (upgrade plan §2).
 *
 * Two things are worth holding forever here. The lanes must keep the SHAPES
 * that were measured safe — an H3 lane that quietly grew to 2K or a 2.5
 * coverage lane that turned the Gemma enhancer back on would cost an hour of
 * GPU before anyone noticed. And the look line must go on exactly once: it is
 * appended by the composer, and the art direction it is derived from is
 * already inside a keyframe-composed prompt. */

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  bibleSchema,
  composeShotSpec,
  projectLook,
  sceneSchema,
  shotSchema,
  withLook,
} from "@aurea/shared";
import { PromptLibrary } from "./promptlib.js";
import type { SettingsStore } from "./settings.js";

function freshLib(): { lib: PromptLibrary; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aurea-videopreset-"));
  const settings = { get: () => ({ storage: { dataRoot: root } }) } as unknown as SettingsStore;
  return { lib: new PromptLibrary(settings), root };
}

test("the four Zoo Logic lanes ship, at the shapes that were measured safe", () => {
  const { lib, root } = freshLib();
  // the looks ship beside the lanes (below) — this test is about the four
  const lanes = lib.videoPresets().filter((l) => l.lane !== "look");
  assert.deepEqual(
    lanes.map((l) => l.id).sort(),
    ["zoo-broll-insert", "zoo-field-note", "zoo-interview-single", "zoo-room-coverage"],
  );

  const interview = lanes.find((l) => l.id === "zoo-interview-single")!;
  assert.equal(interview.payload.engine, "ltx25");
  assert.equal(
    interview.payload.enhance,
    false,
    "the Gemma enhancer rewrites away named-beat wording — an interview lane must ship with it off",
  );

  const coverage = lanes.find((l) => l.id === "zoo-room-coverage")!;
  assert.equal(coverage.rules.multiShot, true);
  assert.equal(coverage.payload.enhance, false, "multi-shot prose does not survive the enhancer");

  // H3 stays inside the shape that doesn't starve the DiT: native canvas,
  // 4-6s, draft tier (memory: aurea-minimax-h3-engine)
  for (const id of ["zoo-broll-insert", "zoo-field-note"]) {
    const lane = lanes.find((l) => l.id === id)!;
    assert.equal(lane.payload.engine, "minimax-h3");
    assert.equal(lane.payload.minimaxTier, "draft");
    assert.ok(
      (lane.payload.durationSec ?? 0) <= 6,
      `${id} is past H3's safe length on this card`,
    );
    assert.match(lane.payload.resolution ?? "", /native/);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test("a lane round-trips through disk, and a deleted lane stays deleted", () => {
  const { lib, root } = freshLib();
  const saved = lib.saveVideoPreset({
    label: "Night exterior",
    description: "hue shift, not exposure drop",
    lane: "broll",
    payload: { engine: "ltx25", durationSec: 6 },
    cine: { lighting: "sitcom.warm-home" },
    look: "cool moonlit key, saturated night palette",
    rules: {},
  });
  assert.equal(saved.builtin, false);
  assert.equal(lib.videoPresets().find((p) => p.id === saved.id)?.look, "cool moonlit key, saturated night palette");

  lib.removeVideoPreset(saved.id);
  assert.ok(!lib.videoPresets().some((p) => p.id === saved.id));
  // and the seed doesn't resurrect it on the next read
  assert.ok(!lib.videoPresets().some((p) => p.id === saved.id));
  fs.rmSync(root, { recursive: true, force: true });
});

/* ---------- the look line ---------- */

const bible = (style: Record<string, string>) =>
  bibleSchema.parse({
    characters: [
      {
        id: "sterling",
        name: "Sterling",
        species: "lion",
        wardrobe: "a blue velvet blazer",
      },
    ],
    style,
  });

const shot = (over: Record<string, unknown> = {}) =>
  shotSchema.parse({
    id: "s1",
    title: "Sterling behind the desk",
    characters: ["sterling"],
    scriptLines: [{ id: "l1", character: "sterling", text: "The fund is fine." }],
    ...over,
  });

const scene = sceneSchema.parse({ id: "sc1", slugline: "INT. LOUNGE — DAY", shots: [] });

test("an explicit look line beats the derived one, and lands once", () => {
  const b = bible({
    artDirection: "Stylized 3D animation. Shallow depth of field throughout.",
    lookLine: "warm tungsten grade, soft contrast",
  });
  assert.equal(projectLook(b), "warm tungsten grade, soft contrast");

  const composed = composeShotSpec(shot(), scene, b);
  const hits = composed.prompt.toLowerCase().split("warm tungsten grade").length - 1;
  assert.equal(hits, 1, `look line appears ${hits} times:\n${composed.prompt}`);
  assert.equal(composed.director.globalPrompt, composed.prompt);
});

test("with no look line the first sentence of the art direction IS the look — and never doubles", () => {
  const b = bible({
    artDirection: "Stylized 3D animation, Pixar-quality. Shallow depth of field throughout.",
  });
  assert.equal(projectLook(b), "Stylized 3D animation, Pixar-quality");

  // composeKeyframePrompt already ends with the whole art direction, so the
  // derived look is ALREADY in the prompt — appending it again is the bug
  // this guard exists for
  const composed = composeShotSpec(shot(), scene, b);
  const hits = composed.prompt.split("Stylized 3D animation, Pixar-quality").length - 1;
  assert.equal(hits, 1, `derived look stacked ${hits} times:\n${composed.prompt}`);
});

test("a lane may carry its own look, and null means none at all", () => {
  const b = bible({ artDirection: "Stylized 3D animation.", lookLine: "warm tungsten grade" });
  const lane = composeShotSpec(shot(), scene, b, { look: "cool moonlit key" });
  assert.match(lane.prompt, /cool moonlit key/);
  assert.doesNotMatch(lane.prompt, /warm tungsten grade/);

  const bare = composeShotSpec(shot(), scene, b, { look: null });
  assert.doesNotMatch(bare.prompt, /warm tungsten grade/);
});

test("withLook never stacks a look the prompt already carries", () => {
  assert.equal(withLook("A lion at a desk", "warm grade"), "A lion at a desk. warm grade.");
  assert.equal(withLook("A lion at a desk. warm grade.", "warm grade"), "A lion at a desk. warm grade.");
  assert.equal(withLook("A lion at a desk", ""), "A lion at a desk");
});

test("a lane's camera ids fill the gaps the board left, and never overwrite it", () => {
  const b = bible({ artDirection: "Stylized 3D animation." });
  const boarded = shot({ camera: { shotSize: "ws", angle: "", move: "", lens: "", lighting: "", notes: "" } });
  const composed = composeShotSpec(boarded, scene, b, {
    camera: { shotSize: "mcu", angle: "eye", move: "push-in" },
  });
  /* This bible has no cinematography bank imported, so ids pass through as
   * themselves — which is exactly the case worth asserting: the merge happens
   * on the spec, before any clause expansion. The board said "ws"; the lane's
   * "mcu" must not win. */
  assert.match(composed.prompt, /\bws\b/);
  assert.doesNotMatch(composed.prompt, /\bmcu\b/);
  // …but the angle and move the board never specified do land
  assert.match(composed.prompt, /\beye\b/);
  assert.match(
    composed.director.promptZones[0].prompt,
    /push-in/,
    composed.director.promptZones[0].prompt,
  );
});

/* ---------- looks: the bible-free lane (VIDEO-LAB-FREEFORM-PLAN.md §2.2) ---------- */

import { CINEMATOGRAPHY_BANK, composeCineClause } from "@aurea/shared";
import { SHIPPED_LOOKS } from "./promptlib.js";
import { VIDEO_RESOLUTIONS_BY_ENGINE } from "./labs.js";

test("the looks ship global, bible-free, and inside the measured engine shapes", () => {
  const { lib, root } = freshLib();
  const looks = lib.videoPresets().filter((p) => p.lane === "look");
  assert.equal(looks.length, SHIPPED_LOOKS.length);
  assert.ok(looks.length >= 14, "the plan ships about fourteen looks");

  for (const look of looks) {
    assert.equal(look.projectId, undefined, `${look.id} must not belong to a project`);
    assert.ok(look.builtin, `${look.id} is a shipped look`);
    assert.ok(look.look && look.look.length > 40, `${look.id} needs real look prose`);
    // the models cannot letter — every look refuses text in its negative
    assert.match(look.negative, /\btext\b/, `${look.id} must refuse text`);
    assert.equal(look.rules.multiShot, false, "a look is a single take");

    const engine = look.payload.engine;
    assert.ok(engine === "ltx25" || engine === "minimax-h3", `${look.id}: ${engine}`);
    // the canvas has to be one the engine's own picker offers, or the panel
    // silently snaps to its first entry and the look lies about its shape
    assert.ok(
      VIDEO_RESOLUTIONS_BY_ENGINE[engine].includes(look.payload.resolution ?? ""),
      `${look.id}: "${look.payload.resolution}" is not a ${engine} canvas`,
    );
    if (engine === "ltx25") {
      assert.equal(typeof look.payload.enhance, "boolean", `${look.id}: enhance must be explicit`);
    } else {
      // H3 stays inside the shape that doesn't starve the DiT
      assert.equal(look.payload.minimaxTier, "draft");
      assert.ok((look.payload.durationSec ?? 0) <= 6, `${look.id} is past H3's safe length`);
      assert.match(look.payload.resolution ?? "", /native/);
    }
    // every cine id must be a real bank id — an unknown one composes to nothing
    const clause = composeCineClause(look.cine, CINEMATOGRAPHY_BANK);
    for (const [key, id] of Object.entries(look.cine)) {
      if (!id || key === "notes") continue;
      assert.ok(clause.length > 0, `${look.id}: cine.${key}="${id}" composed to nothing`);
    }
    assert.ok(
      composeCineClause({ lighting: look.cine.lighting }, CINEMATOGRAPHY_BANK).length > 0,
      `${look.id}: lighting "${look.cine.lighting}" does not resolve`,
    );
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test("a look changed upstream refreshes an untouched copy and never an edited one", async () => {
  const { lib, root } = freshLib();
  lib.videoPresets(); // seed
  const dir = path.join(root, "promptlib", "video-presets");
  const anime = SHIPPED_LOOKS.find((l) => l.payload.loras?.length)!;
  const other = SHIPPED_LOOKS.find((l) => l.id !== anime.id && l.lane === "look")!;
  // simulate an older shipped copy of both: same id, no LoRA, older prose
  const stale = (l: (typeof SHIPPED_LOOKS)[number]) => ({ ...l, payload: { ...l.payload, loras: undefined }, description: "old" });
  fs.writeFileSync(path.join(dir, `${anime.id}.json`), JSON.stringify(stale(anime), null, 2));
  fs.writeFileSync(path.join(dir, `${other.id}.json`), JSON.stringify(stale(other), null, 2));
  // …and record those bytes as what WE wrote, for one of them only
  const marker = path.join(dir, ".seeded-looks.json");
  const raw = JSON.parse(fs.readFileSync(marker, "utf8")) as { hashes: Record<string, string> };
  const crypto = await import("node:crypto");
  const digest = (b: string) => crypto.createHash("sha256").update(b).digest("hex").slice(0, 16);
  raw.hashes[anime.id] = digest(JSON.stringify(stale(anime), null, 2));
  // the other one keeps its ORIGINAL hash — i.e. the file on disk was edited
  fs.writeFileSync(marker, JSON.stringify(raw));

  const looks = lib.videoPresets();
  const refreshed = looks.find((l) => l.id === anime.id)!;
  assert.ok(refreshed.payload.loras?.length, "an untouched shipped look picks up its new LoRA");
  assert.notEqual(refreshed.description, "old");
  const edited = looks.find((l) => l.id === other.id)!;
  assert.equal(edited.description, "old", "a look the user edited is theirs — never overwritten");
  fs.rmSync(root, { recursive: true, force: true });
});

test("a look added in a later wave still seeds, and a deleted look stays deleted", () => {
  const { lib, root } = freshLib();
  const dir = path.join(root, "promptlib", "video-presets");
  fs.mkdirSync(dir, { recursive: true });
  // a first-wave install: the marker only counted, and it counted fifteen
  const firstWave = SHIPPED_LOOKS.slice(0, 15);
  for (const l of firstWave) fs.writeFileSync(path.join(dir, `${l.id}.json`), JSON.stringify(l));
  fs.unlinkSync(path.join(dir, `${firstWave[3].id}.json`)); // the user deleted one
  fs.writeFileSync(path.join(dir, ".seeded-looks.json"), JSON.stringify({ seededAt: "2026-09-02", looks: 15 }));
  const looks = lib.videoPresets().filter((p) => p.lane === "look");
  const ids = new Set(looks.map((l) => l.id));
  for (const l of SHIPPED_LOOKS.slice(15)) assert.ok(ids.has(l.id), `${l.id} must arrive on an old install`);
  assert.ok(!ids.has(firstWave[3].id), "a deleted first-wave look must not come back");
  const marker = JSON.parse(fs.readFileSync(path.join(dir, ".seeded-looks.json"), "utf8")) as { ids: string[] };
  assert.equal(marker.ids.length, SHIPPED_LOOKS.length);
  fs.rmSync(root, { recursive: true, force: true });
});

test("the LoRA-backed looks name their adapter by file and stay renderable without it", () => {
  const withLora = SHIPPED_LOOKS.filter((l) => l.payload.loras?.length);
  /* Only the adapters that beat prose at one seed ride a look (measured
   * 2026-09-02): anime and painterly. An adapter added here without that
   * record is the thing this test exists to catch. */
  assert.deepEqual(
    withLora.map((l) => l.id).sort(),
    ["look-anime-cel", "look-oil-paint"],
    "a look carries a style LoRA only once an A/B shows it beating the prose",
  );
  for (const l of withLora) {
    for (const lora of l.payload.loras ?? []) {
      assert.ok(!/[\\/]/.test(lora.name), `${l.id}: a look names its LoRA by file, never by path (${lora.name})`);
      assert.ok(lora.strength > 0 && lora.strength <= 1.2, `${l.id}: ${lora.strength}`);
    }
    assert.ok(l.payload.engine === "ltx25" || l.payload.engine === "ltx2", `${l.id}: style LoRAs are LTX-only`);
    assert.ok((l.look?.length ?? 0) > 40, `${l.id}: the prose must carry the look on its own`);
  }
});

test("looks seed into an install that already carries the lanes marker", () => {
  const { lib, root } = freshLib();
  // the lanes shipped first — simulate a dataRoot that has them and no looks
  const dir = path.join(root, "promptlib", "video-presets");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".seeded.json"), JSON.stringify({ seededAt: "2026-09-02", lanes: 4 }));
  const looks = lib.videoPresets().filter((p) => p.lane === "look");
  assert.equal(looks.length, SHIPPED_LOOKS.length, "the looks marker is its own");
  // and a deleted look stays deleted
  lib.removeVideoPreset(looks[0].id);
  assert.equal(
    lib.videoPresets().filter((p) => p.lane === "look").length,
    SHIPPED_LOOKS.length - 1,
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("a sample rendered on this install is not an edit, and survives an upstream refresh", async () => {
  const { lib, root } = freshLib();
  lib.videoPresets(); // seed
  const dir = path.join(root, "promptlib", "video-presets");
  const target = SHIPPED_LOOKS.find((l) => l.lane === "look")!;
  // the F5 contact sheet files a still and sets it as the look's sample —
  // through the same save path the panel uses
  const { builtin: _b, ...save } = target;
  lib.saveVideoPreset({ ...save, sample: "projects/playground/assets/image/look-sample.png" });
  // …then upstream changes the look's prose
  const marker = path.join(dir, ".seeded-looks.json");
  const raw = JSON.parse(fs.readFileSync(marker, "utf8")) as { hashes: Record<string, string> };
  const crypto = await import("node:crypto");
  const digest = (b: string) => crypto.createHash("sha256").update(b).digest("hex").slice(0, 16);
  const older = { ...target, description: "the description before upstream changed it" };
  raw.hashes[target.id] = digest(JSON.stringify(older, null, 2));
  fs.writeFileSync(marker, JSON.stringify(raw));
  fs.writeFileSync(
    path.join(dir, `${target.id}.json`),
    JSON.stringify({ ...older, sample: "projects/playground/assets/image/look-sample.png" }, null, 2),
  );

  const after = lib.videoPresets().find((l) => l.id === target.id)!;
  assert.equal(after.description, target.description, "the prose refreshes — a sample is not an edit");
  assert.equal(after.sample, "projects/playground/assets/image/look-sample.png", "the sample rides through");
  assert.equal(after.builtin, true, "a shipped look stays shipped through the save");

  // and a look whose PROSE the user changed still keeps its own copy
  const edited = SHIPPED_LOOKS.find((l) => l.lane === "look" && l.id !== target.id)!;
  fs.writeFileSync(path.join(dir, `${edited.id}.json`), JSON.stringify({ ...edited, look: "my own look line", sample: "x.png" }, null, 2));
  raw.hashes[edited.id] = digest(JSON.stringify({ ...edited, description: "older" }, null, 2));
  fs.writeFileSync(marker, JSON.stringify(raw));
  const kept = lib.videoPresets().find((l) => l.id === edited.id)!;
  assert.equal(kept.look, "my own look line");
  fs.rmSync(root, { recursive: true, force: true });
});
