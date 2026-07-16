/* GpuScheduler + JobEngine E2E with fake adapters — deterministic proof of
 * the scheduler contract without touching the GPU:
 *   1. gpu lane is exclusive (FIFO), cpu lane runs concurrently beside it
 *   2. the legacy .gpu.lock is held as aurea:<jobId> while an exclusive job
 *      runs and released when it finishes (or is canceled)
 *   3. a live foreign .gpu.lock parks the gpu lane with a visible stage;
 *      the cpu lane is unaffected; a dead holder is treated as stale
 *   4. VRAM preflight: insufficient free VRAM evicts idle warm engines,
 *      then waits with a visible stage until telemetry shows room
 *   5. a job whose own engine is already warm skips the preflight
 *   6. videofast-payload jobs never pre-acquire the lock (the spawned
 *      run-batch.ts takes it itself)
 *   7. the cpu lane is capped at cpuSlots
 *
 * Run: npx tsx scripts/test-scheduler.mts */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Job } from "../packages/shared/src/index.js";

const { JobEngine } = await import("../packages/core/src/jobs.js");
const { GpuScheduler } = await import("../packages/core/src/scheduler.js");
const { GpuLock } = await import("../packages/core/src/gpulock.js");
import type { EngineAdapter, AdapterRun } from "../packages/core/src/adapters/types.js";
import type { JobResources, ResourceClass } from "../packages/core/src/scheduler.js";

/* ---------- harness ---------- */

let passed = 0;
function check(name: string, cond: boolean) {
  if (!cond) throw new Error(`FAIL: ${name}`);
  passed += 1;
  console.log(`  ok ${passed}. ${name}`);
}

async function until(desc: string, cond: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`TIMEOUT waiting for: ${desc}`);
}

class FakeAdapter implements EngineAdapter {
  running = new Set<string>();
  private settle = new Map<string, { resolve: (o: { output?: string }) => void; reject: (e: Error) => void }>();

  constructor(
    public id: string,
    private klass: ResourceClass,
    private vramGb?: number,
    private engineId?: string,
  ) {}

  canRun(job: Job): boolean {
    return job.engine === this.id;
  }

  resources(): JobResources {
    return { klass: this.klass, vramGb: this.vramGb, engineId: this.engineId };
  }

  start(job: Job): AdapterRun {
    this.running.add(job.id);
    const done = new Promise<{ output?: string }>((resolve, reject) => {
      this.settle.set(job.id, { resolve, reject });
    });
    return {
      done,
      cancel: () => {
        this.running.delete(job.id);
        this.settle.get(job.id)?.reject(new Error("killed"));
      },
    };
  }

  finish(id: string) {
    this.running.delete(id);
    this.settle.get(id)?.resolve({});
  }
}

/* ---------- world ---------- */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aurea-sched-"));
const lockFile = path.join(dir, ".gpu.lock");
const readLock = () =>
  fs.existsSync(lockFile) ? (JSON.parse(fs.readFileSync(lockFile, "utf8")) as { pid: number; batchId: string }) : null;

let freeVram: number | null = 24;
let comfyWarm = false;
let comfyEvictions = 0;

const gpu = new FakeAdapter("fake-gpu", "gpu");
const cpu = new FakeAdapter("fake-cpu", "cpu");
const heavy = new FakeAdapter("fake-heavy", "gpu", 10);
const onComfy = new FakeAdapter("fake-on-comfy", "gpu", 14, "comfy");
const vf = new FakeAdapter("fake-vf", "gpu");

const scheduler = new GpuScheduler({
  lock: new GpuLock(() => lockFile),
  vram: { freeGb: () => freeVram },
  engines: [
    {
      id: "comfy",
      warm: () => comfyWarm,
      canEvict: () => comfyWarm,
      evict: () => {
        comfyWarm = false;
        comfyEvictions += 1;
      },
    },
  ],
  cpuSlots: 2,
});

const engine = new JobEngine({ adapters: [gpu, cpu, heavy, onComfy, vf], scheduler });

const enqueue = (adapterId: string, payload?: Job["payload"]) =>
  engine.enqueue({
    title: adapterId,
    kind: "image",
    engine: adapterId,
    priority: "batch",
    payload,
  } as never);
const job = (id: string) => engine.snapshot().find((j) => j.id === id)!;

try {
  /* 1+2 — exclusive gpu lane, concurrent cpu lane, lock lifecycle */
  console.log("— lanes + lock lifecycle");
  const g1 = enqueue("fake-gpu");
  const g2 = enqueue("fake-gpu");
  const c1 = enqueue("fake-cpu");
  await until("g1 + c1 running", () => gpu.running.has(g1.id) && cpu.running.has(c1.id));
  check("gpu lane exclusive: second gpu job stays queued", !gpu.running.has(g2.id) && job(g2.id).status === "queued");
  check("cpu job runs beside the exclusive gpu job", job(c1.id).status === "running");
  check(`lock held as aurea:${g1.id} by this pid`, readLock()?.batchId === `aurea:${g1.id}` && readLock()?.pid === process.pid);
  gpu.finish(g1.id);
  await until("g2 running after g1 finished", () => gpu.running.has(g2.id));
  check("FIFO within the gpu lane", job(g1.id).status === "completed");
  check("lock rolled to the next exclusive job", readLock()?.batchId === `aurea:${g2.id}`);
  gpu.finish(g2.id);
  cpu.finish(c1.id);
  await until("all settled", () => engine.snapshot().every((j) => j.status === "completed"));
  check("lock released once the gpu lane is empty", readLock() === null);

  /* 7 — cpu lane cap */
  console.log("— cpu lane cap");
  const cs = [enqueue("fake-cpu"), enqueue("fake-cpu"), enqueue("fake-cpu")];
  await until("two cpu jobs running", () => cpu.running.size === 2);
  await new Promise((r) => setTimeout(r, 1_000));
  check("third cpu job waits for a slot", cpu.running.size === 2 && job(cs[2].id).status === "queued");
  cpu.finish(cs[0].id);
  await until("third cpu job takes the freed slot", () => cpu.running.has(cs[2].id));
  check("cpu slot handoff works", true);
  cpu.finish(cs[1].id);
  cpu.finish(cs[2].id);
  await until("cpu lane drained", () => cpu.running.size === 0);

  /* 3 — foreign lock parks the gpu lane, not the cpu lane */
  console.log("— foreign .gpu.lock interop");
  const foreign = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 30000)"], { stdio: "ignore" });
  fs.writeFileSync(lockFile, JSON.stringify({ pid: foreign.pid, batchId: "vf-manual", startedAt: "now" }));
  const g3 = enqueue("fake-gpu");
  const c2 = enqueue("fake-cpu");
  await until("cpu job runs despite the foreign lock", () => cpu.running.has(c2.id));
  await until(
    "gpu job parked with the external-batch stage",
    () => job(g3.id).status === "queued" && (job(g3.id).stage ?? "").includes("external batch vf-manual"),
  );
  check("foreign live lock parks the gpu lane with a visible stage", true);
  foreign.kill();
  await until("dead holder treated as stale — g3 starts", () => gpu.running.has(g3.id));
  check("stale foreign lock is overwritten, not honored", readLock()?.batchId === `aurea:${g3.id}`);
  cpu.finish(c2.id);

  /* cancel releases the lock */
  engine.cancel(g3.id);
  await until("canceled job releases the lock", () => readLock() === null);
  check("cancel of the running exclusive job releases the lock", job(g3.id).status === "failed");

  /* 4 — VRAM preflight: evict, then wait, then start */
  console.log("— VRAM preflight + eviction");
  freeVram = 2;
  comfyWarm = true;
  const h1 = enqueue("fake-heavy");
  await until("idle warm engine evicted", () => comfyEvictions === 1 && !comfyWarm);
  await until(
    "then waits on VRAM with a visible stage",
    () => (job(h1.id).stage ?? "").includes("Waiting for VRAM — needs ~10 GB"),
  );
  check("preflight evicted the idle engine and surfaced the wait", job(h1.id).status === "queued");
  freeVram = 20;
  await until("job starts once telemetry shows room", () => heavy.running.has(h1.id));
  check("VRAM wait clears when free VRAM rises", job(h1.id).stage === undefined);
  heavy.finish(h1.id);
  await until("heavy job settled", () => job(h1.id).status === "completed");

  /* 5 — warm self-engine skips preflight */
  console.log("— warm self-engine skip");
  freeVram = 2; // would fail preflight…
  comfyWarm = true; // …but the job's own engine is resident
  const o1 = enqueue("fake-on-comfy");
  await until("comfy-backed job starts despite low free VRAM", () => onComfy.running.has(o1.id));
  check("resident own engine skips the VRAM preflight", comfyEvictions === 1);
  onComfy.finish(o1.id);
  await until("comfy job settled", () => job(o1.id).status === "completed");
  freeVram = 24;

  /* 6 — videofast payload never pre-acquires the lock */
  console.log("— videofast lock exception");
  const v1 = enqueue("fake-vf", { type: "videofast" } as unknown as Job["payload"]);
  await until("videofast job running", () => vf.running.has(v1.id));
  await new Promise((r) => setTimeout(r, 500));
  check("no aurea lock while a videofast job runs", readLock() === null);
  vf.finish(v1.id);
  await until("videofast job settled", () => job(v1.id).status === "completed");

  console.log(`\nALL PASS — ${passed} checks`);
} finally {
  engine.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
