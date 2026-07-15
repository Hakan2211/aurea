/* Shared child-process plumbing for engine adapters: spawn with a per-job
 * scratch dir under ~/.aurea/runs/<jobId>/, tee output to run.log, hand each
 * stdout/stderr line to the adapter's parser, and kill the whole tree on
 * cancel (Windows child processes don't die with their parent). */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { AUREA_DIR } from "../portfile.js";

export interface ProcHandle {
  /** resolves with the exit code (0 = success), rejects on spawn error */
  exited: Promise<number>;
  kill: () => void;
}

export function jobRunDir(jobId: string): string {
  const dir = path.join(AUREA_DIR, "runs", jobId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function runProcess(opts: {
  exe: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** appended to <runDir>/run.log */
  logFile?: string;
  onLine?: (line: string) => void;
}): ProcHandle {
  let child: ChildProcess;
  let killed = false;

  const exited = new Promise<number>((resolve, reject) => {
    child = spawn(opts.exe, opts.args, {
      cwd: opts.cwd,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", ...opts.env },
      shell: false,
      windowsHide: true,
    });
    child.on("error", reject);

    const log = opts.logFile ? fs.createWriteStream(opts.logFile, { flags: "a" }) : undefined;
    let buffer = "";
    const onData = (chunk: Buffer) => {
      log?.write(chunk);
      if (!opts.onLine) return;
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) opts.onLine(line);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    child.on("close", (code) => {
      if (buffer && opts.onLine) opts.onLine(buffer);
      log?.end();
      resolve(killed ? 130 : (code ?? 1));
    });
  });

  return {
    exited,
    kill: () => {
      killed = true;
      if (!child?.pid) return;
      if (process.platform === "win32") {
        execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
      } else {
        child.kill("SIGTERM");
      }
    },
  };
}

/** last error-looking line an adapter saw, for failure messages */
export class LastError {
  private value: string | undefined;
  note(line: string): void {
    if (/error|failed|traceback|exception/i.test(line) && line.trim()) this.value = line.trim();
  }
  message(fallback: string): string {
    return this.value ?? fallback;
  }
}
