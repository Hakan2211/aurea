/* The automatic infrastructure retry (see startAdapter's catch): a job whose
 * adapter dies with an InfrastructureError goes back in line ONCE; a second
 * engine failure, or any ordinary error, is terminal. Timing rides the real
 * TICK_MS admission loop, so these tests wait on conditions, not on counts. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { InfrastructureError, type AdapterRun, type EngineAdapter } from "./adapters/types.js";
import { JobEngine } from "./jobs.js";

const until = async (cond: () => boolean, what: string, ms = 10_000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

/** an adapter that plays a scripted sequence of outcomes, one per start() */
function fakeAdapter(outcomes: Array<"infra" | "boring" | "ok">) {
  let runs = 0;
  const adapter: EngineAdapter = {
    id: "fake",
    canRun: (job) => job.engine === "fake",
    start: (): AdapterRun => {
      const outcome = outcomes[Math.min(runs, outcomes.length - 1)];
      runs += 1;
      const done =
        outcome === "ok"
          ? Promise.resolve({})
          : Promise.reject(
              outcome === "infra"
                ? new InfrastructureError("engine gone")
                : new Error("bad graph"),
            );
      return { done, cancel: () => {} };
    },
  };
  return { adapter, runs: () => runs };
}

const input = {
  title: "take",
  kind: "video",
  engine: "fake",
  priority: "batch",
} as const;

test("one engine failure is requeued and the second run completes", async () => {
  const { adapter, runs } = fakeAdapter(["infra", "ok"]);
  const engine = new JobEngine({ adapters: [adapter] });
  try {
    const job = engine.enqueue(input);
    await until(
      () => engine.snapshot().find((j) => j.id === job.id)?.status === "completed",
      "the retried job to complete",
    );
    assert.equal(runs(), 2);
    assert.equal(engine.snapshot().find((j) => j.id === job.id)?.error, undefined);
  } finally {
    engine.close();
  }
});

test("a second engine failure is terminal and says a retry happened", async () => {
  const { adapter, runs } = fakeAdapter(["infra", "infra"]);
  const engine = new JobEngine({ adapters: [adapter] });
  try {
    const job = engine.enqueue(input);
    await until(
      () => engine.snapshot().find((j) => j.id === job.id)?.status === "failed",
      "the double failure to land",
    );
    assert.equal(runs(), 2);
    const failed = engine.snapshot().find((j) => j.id === job.id)!;
    assert.match(failed.error ?? "", /already retried once/);
  } finally {
    engine.close();
  }
});

test("an ordinary error never retries", async () => {
  const { adapter, runs } = fakeAdapter(["boring"]);
  const engine = new JobEngine({ adapters: [adapter] });
  try {
    const job = engine.enqueue(input);
    await until(
      () => engine.snapshot().find((j) => j.id === job.id)?.status === "failed",
      "the validation failure to land",
    );
    assert.equal(runs(), 1);
    assert.equal(engine.snapshot().find((j) => j.id === job.id)?.error, "bad graph");
  } finally {
    engine.close();
  }
});

test("a deliberate retry earns a fresh automatic allowance", async () => {
  const { adapter, runs } = fakeAdapter(["infra", "infra", "infra", "ok"]);
  const engine = new JobEngine({ adapters: [adapter] });
  try {
    const job = engine.enqueue(input);
    await until(
      () => engine.snapshot().find((j) => j.id === job.id)?.status === "failed",
      "the first pair of failures",
    );
    assert.equal(runs(), 2);
    engine.retry(job.id);
    await until(
      () => engine.snapshot().find((j) => j.id === job.id)?.status === "completed",
      "the manual retry to auto-retry and complete",
    );
    assert.equal(runs(), 4);
  } finally {
    engine.close();
  }
});
