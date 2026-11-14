/* Run one Aurea tool from a shell — the same registry mcp.ts serves to MCP
 * clients and director.ts serves to the Director chat, minus the stdio
 * protocol. Exists because the MCP server is toggled off for most Claude Code
 * sessions (scripts/mcp-toggle.mjs) and a crew run shouldn't need a session
 * restart to reach the surface.
 *
 *   npx tsx scripts/tool.mts --list
 *   npx tsx scripts/tool.mts production_get '{"project":"zoo-logic"}'
 *   echo '{"project":"zoo-logic"}' | npx tsx scripts/tool.mts production_get -
 *
 * Reuses a running studiod via ~/.aurea/studiod.json; starts one in-process
 * only if none is healthy (single GPU owner — never spawn a second by hand).
 * Prints the tool's text content verbatim; exit 1 on tool error. */

import { PORT_FILE, probeStudiod, readPortFile } from "../packages/core/src/portfile.js";
import { startStudiod, type StudiodHandle } from "../packages/core/src/server.js";
import { buildTools, createStudiodApi } from "../packages/core/src/tools.js";

let owned: StudiodHandle | null = null;

async function connect(): Promise<{ port: number; token: string }> {
  const existing = await readPortFile();
  if (existing && (await probeStudiod(existing))) return existing;
  try {
    owned = await startStudiod({ port: Number(process.env.AUREA_PORT ?? 4114), writePortFile: true });
  } catch {
    owned = await startStudiod({ port: 0, writePortFile: true });
  }
  console.error(`aurea-tool: started studiod on 127.0.0.1:${owned.port} (discovery: ${PORT_FILE})`);
  return owned;
}

const [name, argSource] = process.argv.slice(2);
const { port, token } = await connect();
const tools = buildTools(createStudiodApi(port, token));

async function finish(code: number): Promise<never> {
  if (owned) await owned.close().catch(() => undefined);
  process.exit(code);
}

if (!name || name === "--list") {
  for (const t of tools) console.log(`${t.name.padEnd(26)} ${t.title}`);
  await finish(0);
}

const tool = tools.find((t) => t.name === name);
if (!tool) {
  console.error(`unknown tool "${name}" — run --list`);
  await finish(2);
}

const raw =
  argSource === "-"
    ? await new Promise<string>((resolve) => {
        let buf = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (c) => (buf += c));
        process.stdin.on("end", () => resolve(buf));
      })
    : (argSource ?? "{}");

try {
  const result = await tool!.handler(JSON.parse(raw || "{}"));
  for (const part of result.content) console.log(part.text);
  await finish(result.isError ? 1 : 0);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  await finish(1);
}
