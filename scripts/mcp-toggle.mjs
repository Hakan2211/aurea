#!/usr/bin/env node
/* Toggle the aurea MCP server for Claude Code sessions.
 *
 * The server definition lives in .mcp.json (aurea/ and videoproduction/) and
 * costs every Claude Code session ~17 tool schemas of context when loaded.
 * This flips "aurea" between disabledMcpjsonServers and enabledMcpjsonServers
 * in both projects' .claude/settings.json. Takes effect on NEW sessions.
 *
 *   npm run mcp:off     hide the tools from Claude Code sessions (default)
 *   npm run mcp:on      load the tools again
 *   node scripts/mcp-toggle.mjs status
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const aureaRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  path.join(aureaRoot, ".claude", "settings.json"),
  path.join(path.dirname(aureaRoot), ".claude", "settings.json"),
];
const SERVER = "aurea";
const mode = process.argv[2];

if (!["on", "off", "status"].includes(mode)) {
  console.error("usage: mcp-toggle.mjs on|off|status");
  process.exit(2);
}

for (const file of files) {
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* missing or empty — start fresh */
  }
  const enabled = new Set(settings.enabledMcpjsonServers ?? []);
  const disabled = new Set(settings.disabledMcpjsonServers ?? []);

  if (mode === "status") {
    const state = disabled.has(SERVER) ? "OFF" : enabled.has(SERVER) ? "ON" : "unset (Claude Code will ask)";
    console.log(`${state.padEnd(8)} ${file}`);
    continue;
  }

  enabled.delete(SERVER);
  disabled.delete(SERVER);
  (mode === "on" ? enabled : disabled).add(SERVER);
  settings.enabledMcpjsonServers = [...enabled];
  settings.disabledMcpjsonServers = [...disabled];
  if (!settings.enabledMcpjsonServers.length) delete settings.enabledMcpjsonServers;
  if (!settings.disabledMcpjsonServers.length) delete settings.disabledMcpjsonServers;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  console.log(`${mode.toUpperCase().padEnd(8)} ${file}`);
}

if (mode !== "status") {
  console.log("\nApplies to new Claude Code sessions (restart or /clear won't cut it — start a fresh session).");
}
