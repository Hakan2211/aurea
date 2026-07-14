/* ~/.aurea/studiod.json — how shells, CLIs, and MCP clients discover a running
 * core (single GPU owner: check here before spawning a second studiod). */

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { portFileSchema, type PortFile } from "@aurea/shared";

export const AUREA_DIR = process.env.AUREA_DATA_DIR ?? path.join(homedir(), ".aurea");
export const PORT_FILE = path.join(AUREA_DIR, "studiod.json");

export async function writePortFile(entry: PortFile): Promise<void> {
  await fs.mkdir(AUREA_DIR, { recursive: true });
  await fs.writeFile(PORT_FILE, JSON.stringify(entry, null, 2), "utf8");
}

export async function readPortFile(): Promise<PortFile | null> {
  try {
    return portFileSchema.parse(JSON.parse(await fs.readFile(PORT_FILE, "utf8")));
  } catch {
    return null;
  }
}

/** remove the file only if it still points at us */
export async function clearPortFile(pid: number): Promise<void> {
  const current = await readPortFile();
  if (current?.pid === pid) await fs.rm(PORT_FILE, { force: true });
}

/** is the studiod recorded in the port file actually alive? */
export async function probeStudiod(entry: PortFile, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${entry.port}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { service?: string };
    return body.service === "studiod";
  } catch {
    return false;
  }
}
