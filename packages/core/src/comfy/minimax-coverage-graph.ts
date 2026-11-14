/* The coverage pass as a graph.
 *
 * There is deliberately very little here. A coverage pass is not a new
 * pipeline — it is H3's ref2va head, run at a fixed length against a fixed
 * prompt shape, with the frames kept instead of the video. Everything that
 * makes an H3 render work (the loaders, the distill, the camera weight, the
 * encoder eviction, SageAttention) already lives in `minimaxH3RefGraph`, and
 * a second copy of it would rot the moment one of them was fixed.
 *
 * So this module's whole job is to say what a coverage pass IS in the terms
 * that builder already speaks — and to swap the tail of the graph, because
 * the one real difference is the output: a coverage pass wants eight stills
 * lifted out of the batch, not an mp4 with a soundtrack. */

import { COVERAGE_ANGLES, COVERAGE_FRAMES, coverageFileName, coveragePrompt } from "@aurea/shared";
import type { ComfyGraph } from "./client.js";
import {
  MINIMAX_NODES,
  minimaxH3RefGraph,
  type MinimaxRefGraphSpec,
  type MinimaxRefModelNames,
  type MinimaxTurbo,
} from "./minimax-graphs.js";

/** The seconds that land on COVERAGE_FRAMES exactly — `frameLength` snaps UP
 * onto the 17k+5 grid and 5s is already on it. Asserted in the tests rather
 * than assumed here. */
export const COVERAGE_SECONDS = 5;

/** Where the frames are written, under ComfyUI's output root. */
export const COVERAGE_PREFIX = "aurea/h3-coverage";

/** The coverage tail's own node ids. High enough to clear both the base graph
 * (1-19, plus 60 and 61) and the reference loaders (20-57). */
export const COVERAGE_NODES = {
  pick: (i: number) => String(70 + i), // 70..77 — one frame out of the batch
  save: (i: number) => String(80 + i), // 80..87 — that frame, named by angle
} as const;

export interface CoverageGraphSpec {
  /** the caller's one-line coverage target, quoted into the prompt */
  subject: string;
  /** the plate, already staged as a ComfyUI input name — it becomes
   * `<Picture 1>`, which is what the prompt is written against */
  plateInputName: string;
  width: number;
  height: number;
  seed: number;
  models: MinimaxRefModelNames;
  turbo?: MinimaxTurbo;
  sage?: boolean;
  evictEncoder?: boolean;
}

/** ref2va → one room from eight bearings, as eight stills.
 *
 * 124 frames are sampled either way — the orbit is what holds the room
 * together, and it is one continuous take. Only eight of them are decoded to
 * disk. */
export function minimaxCoverageGraph(spec: CoverageGraphSpec): ComfyGraph {
  const base: MinimaxRefGraphSpec = {
    prompt: coveragePrompt(spec.subject),
    refImageNames: [spec.plateInputName],
    refVideos: [],
    refAudioNames: [],
    /* "max" gives the plate a 2048px short edge and is several times slower to
     * encode. It is the right bargain exactly here: every angle in the sheet
     * inherits its identity from this one still, and an identity error made
     * now is made eight times. */
    refImageSize: "max",
    durationSec: COVERAGE_SECONDS,
    width: spec.width,
    height: spec.height,
    seed: spec.seed,
    turbo: spec.turbo,
    sage: spec.sage,
    evictEncoder: spec.evictEncoder,
    models: spec.models,
    filenamePrefix: COVERAGE_PREFIX,
  };

  const graph = minimaxH3RefGraph(base);

  /* Swap the video tail for a still tail. The decoded frames are already on
   * MINIMAX_NODES.decodeVideo; the mux and the save node downstream of it are
   * what turn them into a file with a soundtrack, and neither is wanted.
   *
   * The audio VAE loader is left in place and simply becomes unreachable —
   * ComfyUI walks back from the output nodes, so a node nothing consumes is
   * never executed. Deleting it would mean reaching into another module's
   * numbering for no gain. */
  delete graph[MINIMAX_NODES.createVideo];
  delete graph[MINIMAX_NODES.save];
  delete graph[MINIMAX_NODES.decodeAudio];

  /* Eight stills, not 124. Selecting inside the graph rather than decoding
   * everything and throwing 116 frames away is the difference between eight
   * PNGs and a directory: the batch is already in memory here, and every
   * frame that leaves ComfyUI has to be written, read and transferred. Each
   * save carries its angle in the prefix, which is how the adapter tells the
   * files apart without trusting the order they come back in. */
  COVERAGE_ANGLES.forEach((angle, i) => {
    graph[COVERAGE_NODES.pick(i)] = {
      class_type: "ImageFromBatch",
      inputs: { image: [MINIMAX_NODES.decodeVideo, 0], batch_index: angle.frame, length: 1 },
    };
    graph[COVERAGE_NODES.save(i)] = {
      class_type: "SaveImage",
      inputs: {
        images: [COVERAGE_NODES.pick(i), 0],
        filename_prefix: `${COVERAGE_PREFIX}/${coverageFileName(angle, i)}`,
      },
    };
  });

  return graph;
}

/** Frames the graph will produce, for the caller's own arithmetic. Constant,
 * and constant on purpose — see `coverage.ts` in @aurea/shared. */
export const coverageFrames = () => COVERAGE_FRAMES;
