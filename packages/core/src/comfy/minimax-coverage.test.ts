import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COVERAGE_ANGLES,
  COVERAGE_FRAMES,
  COVERAGE_SHEET_COLUMNS,
  coverageFileName,
  coveragePrompt,
} from "@aurea/shared";
import { MINIMAX_H3_MANAGED, MINIMAX_H3_REF_MANAGED, frameLength } from "./minimax-graphs.js";
import {
  COVERAGE_NODES,
  COVERAGE_SECONDS,
  minimaxCoverageGraph,
} from "./minimax-coverage-graph.js";

const models = { ...MINIMAX_H3_MANAGED, refUnet: MINIMAX_H3_REF_MANAGED };

const build = () =>
  minimaxCoverageGraph({
    subject: "the lion at the desk; keep this exact lion",
    plateInputName: "plate.png",
    width: 1344,
    height: 768,
    seed: 7,
    models,
  });

/* The two numbers the whole technique rests on. COVERAGE_SECONDS has to land
 * on COVERAGE_FRAMES exactly — frameLength snaps UP onto the 17k+5 grid, so a
 * seconds value that missed would silently render a longer take and put every
 * offset on the wrong angle. */
test("five seconds is exactly the 124-frame block the offsets are measured against", () => {
  assert.equal(frameLength(COVERAGE_SECONDS), COVERAGE_FRAMES);
});

test("every angle's frame is inside the take, and they are strictly in orbit order", () => {
  assert.equal(COVERAGE_ANGLES.length, 8);
  for (const a of COVERAGE_ANGLES) {
    assert.ok(a.frame >= 0 && a.frame < COVERAGE_FRAMES, `${a.id} at ${a.frame}`);
  }
  const frames = COVERAGE_ANGLES.map((a) => a.frame);
  assert.deepEqual([...frames].sort((x, y) => x - y), frames);
  const degs = COVERAGE_ANGLES.map((a) => a.deg);
  assert.deepEqual(degs, [0, 45, 90, 135, 180, 225, 270, 315]);
});

/* The offsets are the MIDDLE of each dwell, not its edges — a naive
 * length/8 slice lands on the swing between two bearings, which is the
 * motion-blurred frame. Guard the property rather than the literals: each
 * offset must sit clear of both boundaries of its own eighth. */
test("no angle is sampled on a dwell boundary", () => {
  const slice = COVERAGE_FRAMES / COVERAGE_ANGLES.length;
  COVERAGE_ANGLES.forEach((angle, i) => {
    const start = i * slice;
    const end = (i + 1) * slice;
    assert.ok(
      angle.frame > start - slice / 2 && angle.frame < end,
      `${angle.id} at ${angle.frame} is not inside its own dwell (${start}-${end})`,
    );
  });
});

test("file names sort into orbit order, not alphabetical order", () => {
  const names = COVERAGE_ANGLES.map((a, i) => coverageFileName(a, i));
  assert.deepEqual([...names].sort(), names);
  assert.equal(names[0], "01-front");
  assert.equal(names[7], "08-front-left");
});

test("the prompt opens on the plate's tag and repeats the caller's subject verbatim", () => {
  const prompt = coveragePrompt("  the lion   at the desk  ");
  assert.match(prompt, /^Camera coverage pass of <Picture 1>: the lion at the desk/);
  // every bearing is named, or the model is being asked to invent the orbit
  for (const a of COVERAGE_ANGLES) assert.ok(prompt.includes(`${a.deg}°`), `${a.deg}° missing`);
});

test("the graph saves eight stills and no video", () => {
  const graph = build();
  const classes = Object.values(graph).map((n) => n.class_type);
  assert.equal(classes.filter((c) => c === "SaveImage").length, 8);
  assert.equal(classes.filter((c) => c === "ImageFromBatch").length, 8);
  assert.ok(!classes.includes("CreateVideo"));
  assert.ok(!classes.includes("SaveVideo"));
  // the audio branch is what makes it a take rather than a reference sheet
  assert.ok(!classes.includes("VAEDecodeAudio"));
});

test("each save is fed the frame its own angle names, and carries that angle's name", () => {
  const graph = build();
  COVERAGE_ANGLES.forEach((angle, i) => {
    const pick = graph[COVERAGE_NODES.pick(i)];
    assert.equal(pick.inputs.batch_index, angle.frame);
    assert.equal(pick.inputs.length, 1);
    const save = graph[COVERAGE_NODES.save(i)];
    assert.deepEqual(save.inputs.images, [COVERAGE_NODES.pick(i), 0]);
    assert.match(String(save.inputs.filename_prefix), new RegExp(`${coverageFileName(angle, i)}$`));
  });
});

/* The coverage tail's node ids have to clear both the base graph and the
 * reference loaders. A collision here does not fail — it silently overwrites
 * a loader, which is how <Picture 1> would go missing. */
test("the coverage nodes collide with nothing the reference graph already placed", () => {
  const graph = build();
  const tail = new Set([
    ...COVERAGE_ANGLES.map((_, i) => COVERAGE_NODES.pick(i)),
    ...COVERAGE_ANGLES.map((_, i) => COVERAGE_NODES.save(i)),
  ]);
  for (const id of tail) {
    const node = graph[id];
    assert.ok(
      node.class_type === "ImageFromBatch" || node.class_type === "SaveImage",
      `node ${id} was overwritten by ${node.class_type}`,
    );
  }
});

test("the plate is the only reference, and it is encoded at full strength", () => {
  const graph = build();
  const loads = Object.values(graph).filter((n) => n.class_type === "LoadImage");
  assert.equal(loads.length, 1);
  assert.equal(loads[0].inputs.image, "plate.png");
});

test("the sheet is four across, which is two rows of the eight angles", () => {
  assert.equal(COVERAGE_ANGLES.length % COVERAGE_SHEET_COLUMNS, 0);
  assert.equal(COVERAGE_ANGLES.length / COVERAGE_SHEET_COLUMNS, 2);
});
