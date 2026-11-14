/* The A/B queue: one seed across every variant, batch priority, and a record
 * that survives the queue. The last point is the one worth a test — job
 * history is capped, so a run whose numbers were only ever derived on read
 * would go blank a hundred renders later. */

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AbStore } from "./ab.js";
import { JobEngine } from "./jobs.js";
import type { SettingsStore } from "./settings.js";
import type { AdapterRun, EngineAdapter } from "./adapters/types.js";
import type { VideoAb } from "@aurea/shared";

const until = async (cond: () => boolean, what: string, ms = 10_000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 40));
  }
};

/** every video job completes immediately, delivering a per-job output path */
const fakeVideo: EngineAdapter = {
  id: "fake-video",
  canRun: (job) => job.kind === "video",
  start: (job): AdapterRun => ({
    done: Promise.resolve({ output: `takes/${job.id}.mp4` }),
    cancel: () => {},
  }),
};

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aurea-ab-"));
  const settings = { get: () => ({ storage: { dataRoot: root } }) } as unknown as SettingsStore;
  const engine = new JobEngine({ adapters: [fakeVideo] });
  return { root, engine, ab: new AbStore(settings, engine) };
}

const run = (over: Partial<VideoAb> = {}): VideoAb => ({
  project: "zoo-logic",
  title: "H3 Standard: Acc 8-step vs LightX2V",
  base: {
    prompt: "Sterling the lion behind the desk, talking",
    engine: "minimax-h3",
    durationSec: 4,
    resolution: "1344 × 768 (16:9 · native)",
  },
  variants: [
    { label: "LightX2V 8-step", overrides: { minimaxTier: "standard" } },
    { label: "Acc 8-step", overrides: { minimaxTier: "standard", fast: true } },
  ],
  ...over,
});

test("a seed spray gives every variant its OWN seed and records it", () => {
  const { root, engine, ab } = fixture();
  try {
    const created = ab.create(
      run({
        seedPolicy: "spray",
        variants: [
          { label: "Seed 11", overrides: { seed: 11, durationSec: 3, fast: true } },
          { label: "Seed 22", overrides: { seed: 22, durationSec: 3, fast: true } },
          { label: "fresh", overrides: { durationSec: 3, fast: true } },
        ],
      }),
    );
    assert.equal(created.seedPolicy, "spray");
    assert.deepEqual(created.variants.slice(0, 2).map((v) => v.seed), [11, 22]);
    assert.ok(Number.isInteger(created.variants[2].seed), "a variant with no seed draws one");
    const jobs = engine.snapshot();
    for (const v of created.variants) {
      const job = jobs.find((j) => j.id === v.jobId);
      assert.equal(job?.payload?.type === "video" ? job.payload.seed : undefined, v.seed);
      assert.match(job?.title ?? "", /^Sketch /);
    }
    // the run itself still carries one seed for the record, and reads back
    const back = ab.get(created.id);
    assert.equal(back?.variants[1].seed, 22);
    assert.equal(back?.seedPolicy, "spray");
  } finally {
    engine.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("every variant queues at batch priority on ONE shared seed", () => {
  const { root, engine, ab } = fixture();
  try {
    const created = ab.create(run());
    assert.equal(created.variants.length, 2);
    assert.ok(Number.isInteger(created.seed));
    const jobs = engine.snapshot().filter((j) => created.variants.some((v) => v.jobId === j.id));
    assert.equal(jobs.length, 2);
    for (const job of jobs) {
      assert.equal(job.priority, "batch", "an experiment must not jump the queue");
      assert.equal(
        job.payload?.type === "video" ? job.payload.seed : undefined,
        created.seed,
        "a variant may not move the seed — that is the control",
      );
    }
    // …and the override actually reached its own job
    const tiers = jobs.map((j) => (j.payload?.type === "video" ? j.payload.fast : null)).sort();
    assert.deepEqual(tiers, [false, true]);
  } finally {
    engine.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the record collects outputs and timings as the queue moves, and settles", async () => {
  const { root, engine, ab } = fixture();
  try {
    const created = ab.create(run());
    await until(
      () => (ab.get(created.id)?.variants ?? []).every((v) => v.status === "completed"),
      "both variants to complete",
    );
    const settled = ab.get(created.id)!;
    for (const variant of settled.variants) {
      assert.match(variant.output ?? "", /^takes\//, `variant "${variant.label}" kept no output`);
      assert.ok(variant.finishedAt, "no finish time recorded");
    }
    // the numbers live on disk, not in the queue: clearing history keeps them
    engine.clearFinished();
    const afterClear = ab.get(created.id)!;
    assert.deepEqual(
      afterClear.variants.map((v) => v.status),
      ["completed", "completed"],
      "a settled run was re-synced against a queue that no longer holds it",
    );
    assert.ok(afterClear.variants.every((v) => v.output));
  } finally {
    engine.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runs list newest first and filter by project", () => {
  const { root, engine, ab } = fixture();
  try {
    const a = ab.create(run({ title: "first" }));
    const b = ab.create(run({ title: "second", project: "other" }));
    assert.deepEqual(
      ab.list("zoo-logic").map((r) => r.id),
      [a.id],
    );
    assert.equal(ab.list().length, 2);
    assert.ok(ab.remove(b.id));
    assert.equal(ab.list().length, 1);
  } finally {
    engine.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
