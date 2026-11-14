/* The stale-build detector exists because of a real afternoon lost to it: a
 * Music3 fix was shipped, verified end to end, and appeared to do nothing —
 * the desktop app had loaded dist-electron/studiod.js at startup and was
 * still serving the pre-fix backend, spawning an adapter script that had been
 * deleted from source. A warning that never fires would be worse than none,
 * so this holds it to both halves: quiet on a fresh boot, loud once the file
 * the process was loaded from changes underneath it. */

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildIsStale } from "./buildstamp.js";

const self = fileURLToPath(new URL("./buildstamp.ts", import.meta.url));

test("a freshly booted backend is not stale", () => {
  assert.equal(buildIsStale(), false);
});

test("a rebuild under a running backend is reported as stale", () => {
  const before = fs.statSync(self);
  try {
    // what a rebuild does to the file this module was loaded from, without
    // touching its contents
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(self, future, future);
    assert.equal(buildIsStale(), true);
  } finally {
    fs.utimesSync(self, before.atime, before.mtime);
  }
  assert.equal(buildIsStale(), false, "restoring the mtime clears the warning");
});
