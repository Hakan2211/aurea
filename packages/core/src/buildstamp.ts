/* "Is the backend you are talking to older than the code on disk?"
 *
 * Electron loads dist-electron/studiod.js ONCE, at startup. Rebuild it while
 * the app is open and nothing happens: the app keeps serving the old backend,
 * looks completely healthy, and silently runs superseded code. That cost a
 * whole round of "the fix doesn't work" on a fix that was never loaded — the
 * app was still spawning an adapter script that had been deleted from source.
 *
 * There is no way to hot-swap it, so the least this can do is SAY so. The
 * check is deliberately dumb: stat the file this module was loaded from and
 * compare it to when the process booted. Bundled, that file is studiod.js
 * itself; under tsx it is this source file, which is just as true a signal —
 * either way, something the running backend was built from has changed since
 * it started. */

import fs from "node:fs";
import { fileURLToPath } from "node:url";

const BOOTED_AT = Date.now();

let self: string | null = null;
try {
  self = fileURLToPath(import.meta.url);
} catch {
  // not a file: URL (unlikely) — degrade to "never stale" rather than lying
}

/** The running backend was built before the code currently on disk. The only
 * cure is a restart, which is why this is worth putting in front of someone. */
export function buildIsStale(): boolean {
  if (!self) return false;
  try {
    // a second of slack: the bundler writes the file, then the app starts
    return fs.statSync(self).mtimeMs > BOOTED_AT + 1000;
  } catch {
    return false;
  }
}
