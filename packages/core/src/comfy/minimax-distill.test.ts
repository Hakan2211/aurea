import assert from "node:assert/strict";
import { test } from "node:test";
import { MINIMAX_DISTILL_IDS } from "@aurea/shared";
import { resolveDistill } from "../adapters/minimax-video.js";
import { MODEL_REGISTRY } from "../models/registry.js";
import {
  HYPERFLOW_SIGMAS,
  MINIMAX_ALT_DISTILL,
  MINIMAX_CUSTOM_SIGMAS_NODE,
  MINIMAX_H3_MANAGED,
  MINIMAX_TURBO,
  minimaxH3Graph,
  shiftSigmas,
  type MinimaxTurbo,
  type MinimaxTurboSpec,
} from "./minimax-graphs.js";

/** every head recipe of every candidate, with the candidate's id */
const allSpecs = (): [string, MinimaxTurboSpec][] =>
  Object.entries(MINIMAX_ALT_DISTILL).flatMap(([id, c]) =>
    [c.fl2v, c.ref2v].filter((s): s is MinimaxTurboSpec => !!s).map((s) => [id, s] as [string, MinimaxTurboSpec]),
  );

const graphWith = (turbo: MinimaxTurbo | undefined) =>
  minimaxH3Graph({
    prompt: "a shot",
    durationSec: 4,
    width: 1344,
    height: 768,
    seed: 1,
    steps: turbo?.steps ?? 25,
    turbo,
    models: MINIMAX_H3_MANAGED,
  });

const resolve = (spec: (typeof MINIMAX_TURBO)["standard"]["fl2v"]): MinimaxTurbo => {
  const { file: _file, ...rest } = spec;
  return { ...rest, lora: "x.safetensors" };
};

/* The default path must not move. Everything below adds a way for a distill to
 * bring its own ladder, and the weight we actually ship was distilled against
 * the uniform one. */
test("the shipped distill still samples res_multistep on BasicScheduler", () => {
  const g = graphWith(resolve(MINIMAX_TURBO.standard.fl2v));
  const sampler = Object.values(g).find((n) => n.class_type === "KSamplerSelect");
  assert.equal(sampler?.inputs.sampler_name, "res_multistep");
  const sched = Object.values(g).find((n) => n.class_type === "BasicScheduler");
  assert.equal(sched?.inputs.steps, 8);
  assert.ok(!Object.values(g).some((n) => n.class_type === MINIMAX_CUSTOM_SIGMAS_NODE));
});

test("Final has no distill and no shift node at all", () => {
  const g = graphWith(undefined);
  assert.ok(!Object.values(g).some((n) => n.class_type === "MiniMaxH3SigmaShift"));
  assert.ok(!Object.values(g).some((n) => n.class_type === "LoraLoaderModelOnly"));
});

/* Tutu's contract, which is the whole reason the fields exist: euler, its own
 * nine sigmas, and NOT a uniform ramp. Its card is explicit that substituting
 * one is wrong, so this guards against a refactor quietly doing it. */
test("a distill with a published contract is sampled under it", () => {
  const spec = MINIMAX_ALT_DISTILL["tutu-8step"].fl2v!;
  const g = graphWith(resolve(spec));
  const sampler = Object.values(g).find((n) => n.class_type === "KSamplerSelect");
  assert.equal(sampler?.inputs.sampler_name, "euler");
  assert.ok(!Object.values(g).some((n) => n.class_type === "BasicScheduler"));
  const sigmas = Object.values(g).find((n) => n.class_type === MINIMAX_CUSTOM_SIGMAS_NODE);
  assert.ok(sigmas, "no custom sigmas node");
  // KJNodes splits on ", " exactly and interpolates unless the list is
  // already interpolate_to_steps + 1 long — both are load-bearing
  assert.equal(sigmas.inputs.interpolate_to_steps, spec.sigmas!.length - 1);
  assert.equal(String(sigmas.inputs.sigmas_string).split(", ").length, spec.sigmas!.length);
  assert.equal(String(sigmas.inputs.sigmas_string).split(", ")[0], "1");
});

test("every published ladder is steps + 1 long and lands on zero", () => {
  for (const [id, spec] of allSpecs()) {
    if (!spec.sigmas) continue;
    assert.equal(spec.sigmas.length, spec.steps + 1, `${id}: ladder is not steps + 1`);
    assert.equal(spec.sigmas[0], 1, `${id}: ladder must start at 1`);
    assert.equal(spec.sigmas[spec.sigmas.length - 1], 0, `${id}: ladder must end at 0`);
    const sorted = [...spec.sigmas].sort((a, b) => b - a);
    assert.deepEqual([...spec.sigmas], sorted, `${id}: ladder must decrease`);
  }
});

test("an alternate distill names the model entry its weights ship in", () => {
  for (const [id, spec] of allSpecs()) {
    assert.ok(spec.modelId, `${id}: an alternate distill without a modelId cannot be preflighted`);
  }
});

/* A modelId that names no registry entry, or an entry that doesn't ship the
 * file, would pass the "installed?" preflight vacuously or never — either way
 * the bake-off can't run. */
test("every candidate's weight is a file its registry entry actually ships", () => {
  for (const [id, spec] of allSpecs()) {
    const entry = MODEL_REGISTRY.find((m) => m.id === spec.modelId);
    assert.ok(entry, `${id}: no registry entry "${spec.modelId}"`);
    assert.ok(
      entry.files.some((f) => f.name.split("/").pop() === spec.file),
      `${id}: ${spec.modelId} does not ship ${spec.file}`,
    );
  }
});

test("the schema's distill ids and the recipe table are the same set", () => {
  assert.deepEqual(Object.keys(MINIMAX_ALT_DISTILL).sort(), [...MINIMAX_DISTILL_IDS].sort());
  for (const [id, c] of Object.entries(MINIMAX_ALT_DISTILL)) {
    assert.ok(c.fl2v || c.ref2v, `${id}: a candidate with no head at all`);
  }
});

/* Both publisher-stated pairs of (unshifted, shifted) values. If the map is
 * wrong, every ladder built from a base grid samples the wrong noise levels. */
test("shiftSigmas reproduces the publishers' own shifted ladders", () => {
  // LightX2V spec note: shift 12, q = [1, .75, .5, .25] -> [1, .9730, .9231, .8000]
  const lx = shiftSigmas([1, 0.75, 0.5, 0.25, 0], 12);
  [1, 0.973, 0.9231, 0.8, 0].forEach((v, i) => assert.ok(Math.abs(lx[i]! - v) < 1e-4, `q${i}`));
  // drbaph's HyperFlow card, the ComfyUI form of the grid in HyperFlow's header
  const drbaph = [1.0, 0.9939097854, 0.9842874953, 0.9660637197, 0.9230769231, 0.8349423898, 0.6968520491, 0.4687533149, 0.0];
  drbaph.forEach((v, i) => assert.ok(Math.abs(HYPERFLOW_SIGMAS[i]! - v) < 1e-6, `hyperflow σ${i}`));
});

test("a candidate's scheduler reaches BasicScheduler", () => {
  const g = graphWith(resolve(MINIMAX_ALT_DISTILL["drbaph-v4-6step"].fl2v!));
  const sched = Object.values(g).find((n) => n.class_type === "BasicScheduler");
  assert.equal(sched?.inputs.scheduler, "beta");
  assert.equal(sched?.inputs.steps, 6);
  const shift = Object.values(g).find((n) => n.class_type === "MiniMaxH3SigmaShift");
  assert.deepEqual([shift?.inputs.shift_video, shift?.inputs.shift_audio], [12, 5]);
});

test("resolveDistill: default, per-head pick, and the two refusals", () => {
  assert.equal(resolveDistill({}, "standard", true), MINIMAX_TURBO.standard.ref2v);
  assert.equal(
    resolveDistill({ minimaxDistill: "lightx2v-8step-v1.1" }, "standard", true),
    MINIMAX_ALT_DISTILL["lightx2v-8step-v1.1"].ref2v,
  );
  assert.equal(
    resolveDistill({ minimaxDistill: "lightx2v-4step-v1.2" }, "draft", false),
    MINIMAX_ALT_DISTILL["lightx2v-4step-v1.2"].fl2v,
  );
  // a Draft candidate on a Standard render
  assert.throws(() => resolveDistill({ minimaxDistill: "lightx2v-4step-v1.2" }, "standard", false), /Draft-tier/);
  // an fl2va-only candidate on the reference head
  assert.throws(() => resolveDistill({ minimaxDistill: "tutu-8step" }, "standard", true), /no weight/);
});
