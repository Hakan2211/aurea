/* Aurea MCP server — the studiod surface for agent clients (Claude Code and
 * friends), PRD iron rule: everything the app can do is reachable headlessly.
 * Speaks MCP over stdio (stdout is protocol-only; logs go to stderr). The
 * tools themselves live in tools.ts — one registry shared with the Director —
 * and every call lands on the same tRPC procedures the desktop renderer uses.
 *
 * Boot: reuse a running studiod via ~/.aurea/studiod.json, else start one
 * in-process (the port file is written, so a later app launch reuses ours).
 *
 * Agent workflow: generate_* / create_video enqueue a job and return it —
 * follow with wait_for_job to block until the artifact lands; completed jobs
 * carry an absolute output path the agent can open directly. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PORT_FILE, probeStudiod, readPortFile } from "./portfile.js";
import { startStudiod, type StudiodHandle } from "./server.js";
import { buildTools, createStudiodApi, type ToolExtra } from "./tools.js";

/* ---------- studiod discovery / ownership ---------- */

let owned: StudiodHandle | null = null;

async function connect(): Promise<{ port: number; token: string }> {
  const existing = await readPortFile();
  if (existing && (await probeStudiod(existing))) {
    console.error(`aurea-mcp: reusing studiod on 127.0.0.1:${existing.port} (pid ${existing.pid})`);
    return existing;
  }
  const preferred = Number(process.env.AUREA_PORT ?? 4114);
  try {
    owned = await startStudiod({ port: preferred, writePortFile: true });
  } catch {
    // preferred port taken by something that isn't a healthy studiod
    owned = await startStudiod({ port: 0, writePortFile: true });
  }
  console.error(`aurea-mcp: started studiod on 127.0.0.1:${owned.port} (discovery: ${PORT_FILE})`);
  return owned;
}

const { port, token } = await connect();
const api = createStudiodApi(port, token);

/* ---------- server + tools ---------- */

const server = new McpServer({ name: "aurea", version: "0.1.0" });

for (const t of buildTools(api)) {
  server.registerTool(
    t.name,
    { title: t.title, description: t.description, inputSchema: t.schema },
    (args: Record<string, unknown>, extra) => t.handler(args, extra as ToolExtra),
  );
}

/* ---------- lifecycle ---------- */

async function shutdown(code: number): Promise<never> {
  if (owned) await owned.close().catch(() => undefined);
  process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutdown(0));
}

await server.connect(new StdioServerTransport());
// fires when the client hangs up (stdin closes) — take our studiod down with us
server.server.onclose = () => void shutdown(0);
console.error(`aurea-mcp: ready (${owned ? "owns studiod" : "attached to running studiod"})`);
