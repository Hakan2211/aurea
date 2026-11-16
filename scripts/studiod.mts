/* Standalone studiod — the studio service on its own, independent of the
 * desktop app or any MCP client. Clients discover it via ~/.aurea/studiod.json.
 * AUREA_PORT (default 4114) and AUREA_TOKEN (pin the bearer token so clients
 * that already hold it keep working across a restart) are optional.
 * usage: node --import tsx scripts/studiod.mts */
import { startStudiod } from "../packages/core/src/server.ts";

const handle = await startStudiod({
  port: Number(process.env.AUREA_PORT ?? 4114),
  ...(process.env.AUREA_TOKEN ? { token: process.env.AUREA_TOKEN } : {}),
  writePortFile: true,
});
console.error(`studiod: listening on 127.0.0.1:${handle.port} (pid ${process.pid})`);
const stop = async () => { await handle.close().catch(() => undefined); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
