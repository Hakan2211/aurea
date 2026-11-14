import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { MUSIC3_MAX_DURATION } from "./minimax-music.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), "utf8");

/* The cliff, measured on job j-ca28c365 (2026-08-30): the AR loop held
 * 0.07 s/frame for 3482 frames and then collapsed to 3.1 and on to 12.2 as
 * the KV cache pushed the 17.6 GiB pipeline off a 24 GB card and WDDM began
 * paging. 3482 frames at 25 frames per audio second is ~139s of song. */
const MEASURED_CLIFF_SECONDS = 139;

test("the Music3 ceiling stays under this card's paging cliff", () => {
  /* 300 was the model card's five minutes taken on trust; it is not
   * reachable here and the failure is silent — no OOM, just a progress bar
   * moving 173x too slowly. If a bigger card ever holds the weights, raise
   * this deliberately with a new measurement, not back to the spec sheet. */
  assert.ok(
    MUSIC3_MAX_DURATION <= MEASURED_CLIFF_SECONDS,
    `MUSIC3_MAX_DURATION is ${MUSIC3_MAX_DURATION}s, past the ${MEASURED_CLIFF_SECONDS}s cliff`,
  );
});

test("the desktop fallback ceilings match the adapter's constant", () => {
  /* hooks.ts repeats the number twice for the offline/stale-catalog path, so
   * the ceiling lives in three literals and only one of them is typechecked
   * against the others. Drift there ships a slider that promises minutes the
   * card cannot render. */
  const hooks = read("apps/desktop/src/hooks.ts");
  const literals = [...hooks.matchAll(/music3DurationMax(?::|\s*=\s*catalog\.music3DurationMax\s*\?\?)\s*(\d+)/g)];
  assert.equal(literals.length, 2, "expected two music3DurationMax fallbacks in hooks.ts");
  for (const m of literals) {
    assert.equal(Number(m[1]), MUSIC3_MAX_DURATION, `fallback ${m[1]} != ${MUSIC3_MAX_DURATION}`);
  }
});

test("the ceiling is Music3's alone — ACE-Step keeps the long slider", () => {
  /* ACE-Step writes long songs fine; it is a different pipeline on a
   * different memory curve. The cap must stay behind the engine check in
   * create.tsx, and the shared durationMax must stay well clear of it. */
  const create = read("apps/desktop/src/screens/music/create.tsx");
  assert.match(
    create,
    /m3\s*\?\s*Math\.min\(lab\.durationMax,\s*lab\.music3DurationMax\)\s*:\s*lab\.durationMax/,
    "the Music3 cap is no longer gated on the selected engine",
  );

  const shared = read("packages/core/src/labs.ts").match(/durationMax:\s*(\d+)/);
  assert.ok(shared, "no shared durationMax found in labs.ts");
  assert.ok(
    Number(shared[1]) > MUSIC3_MAX_DURATION,
    `shared durationMax ${shared[1]} was dragged down to Music3's ceiling`,
  );
});
