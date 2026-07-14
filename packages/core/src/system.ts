/* SystemMonitor — real GPU telemetry via nvidia-smi, polled on an interval.
 * Falls back to seed values when nvidia-smi is unavailable (CI, non-NVIDIA
 * box) so the surface always answers. */

import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import os from "node:os";
import type { Preflight, SystemInfo, Vram } from "@aurea/shared";
import { seedVram, systemFallback } from "./seed.js";

const POLL_MS = 2000;

/* memory.reserved needs a recent driver; drop it from the query if it 400s
 * rather than losing telemetry entirely */
const FIELD_SETS = [
  "name,driver_version,memory.total,memory.used,memory.reserved,temperature.gpu",
  "name,driver_version,memory.total,memory.used,temperature.gpu",
];

function smi(fields: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "nvidia-smi",
      [`--query-gpu=${fields}`, "--format=csv,noheader,nounits"],
      { timeout: 3000, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(stdout.trim())),
    );
  });
}

const gb = (mb: number) => Math.round((mb / 1024) * 10) / 10;

export class SystemMonitor extends EventEmitter {
  private timer: NodeJS.Timeout;
  private live = false;
  private fieldSet = 0;

  vram: Vram = { ...seedVram };
  info: SystemInfo = {
    ...systemFallback,
    ram: `${Math.round(os.totalmem() / 1024 ** 3)} GB`,
    queuePaused: false,
  };

  constructor() {
    super();
    void this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_MS);
    this.timer.unref();
  }

  /** VRAM headroom message for the job center's preflight strip */
  preflight(): Preflight {
    const free = Math.max(0, this.vram.total - this.vram.allocated);
    return {
      message: this.live
        ? `${free.toFixed(1)} GB VRAM free — next job preflight checks against live telemetry.`
        : "nvidia-smi unavailable — showing last known VRAM figures.",
      after: `${this.vram.used.toFixed(1)} / ${this.vram.total} GB`,
    };
  }

  close() {
    clearInterval(this.timer);
    this.removeAllListeners();
  }

  private async poll() {
    try {
      let line: string;
      try {
        line = (await smi(FIELD_SETS[this.fieldSet])).split("\n")[0];
      } catch (err) {
        if (this.fieldSet >= FIELD_SETS.length - 1) throw err;
        this.fieldSet++;
        line = (await smi(FIELD_SETS[this.fieldSet])).split("\n")[0];
      }
      const parts = line.split(",").map((v) => v.trim());
      const hasReserved = this.fieldSet === 0;
      const [name, driver, total, used] = parts;
      const reserved = hasReserved ? parts[4] : "0";
      const temp = hasReserved ? parts[5] : parts[4];
      const totalGb = gb(Number(total));
      const usedGb = gb(Number(used));
      const reservedGb = Number.isFinite(Number(reserved)) ? gb(Number(reserved)) : 0;
      this.vram = {
        used: usedGb,
        allocated: Math.min(totalGb, Math.round((usedGb + reservedGb) * 10) / 10),
        total: Math.round(totalGb),
      };
      this.info = {
        ...this.info,
        gpu: name,
        driver,
        vram: `${Math.round(totalGb)} GB`,
        tempC: Number(temp) || this.info.tempC,
      };
      this.live = true;
      this.emit("vram", this.vram);
    } catch {
      // keep the last (or seeded) values; surface staleness via preflight()
      this.live = false;
    }
  }
}
