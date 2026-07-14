/* Headless studiod entry — `npm run studiod` from the repo root. The desktop
 * shell forks its own copy via electron/studiod.ts; this one exists so CLI
 * batch runs and external Claude Code sessions can drive the same surface
 * without Electron. Port defaults to 4114 for curl convenience; the token is
 * random per boot (read it from stdout or ~/.aurea/studiod.json). */

import { readPortFile, probeStudiod, PORT_FILE } from "./portfile.js";
import { startStudiod } from "./server.js";

const existing = await readPortFile();
if (existing && (await probeStudiod(existing))) {
  console.log(`studiod already running on 127.0.0.1:${existing.port} (pid ${existing.pid}) — reusing.`);
  console.log(`discovery file: ${PORT_FILE}`);
  process.exit(0);
}

const handle = await startStudiod({
  port: Number(process.env.AUREA_PORT ?? 4114),
  token: process.env.AUREA_TOKEN,
  writePortFile: true,
});

console.log(`studiod listening on http://127.0.0.1:${handle.port}`);
console.log(`token: ${handle.token}`);
console.log(`discovery file: ${PORT_FILE}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void handle.close().then(() => process.exit(0));
  });
}
