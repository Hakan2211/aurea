/* studiod on a fixed port/token for verifying screens in a plain browser tab
 * (`vite --port 5188` then `#/<route>?studiod=4199:uiverify`). Deliberately
 * does NOT write the port file — the desktop app owns that, and clobbering it
 * would repoint a running app at this process. Dev-only.
 * Run: npx tsx scripts/ui-studiod.mts */

const { startStudiod } = await import("../packages/core/src/server.js");

const handle = await startStudiod({ port: 4199, token: "uiverify", writePortFile: false });
console.log(`ready http://127.0.0.1:${handle.port} token=${handle.token}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void handle.close().then(() => process.exit(0)));
}
