/* Preview (production experience plan P5) — time to first frame.
 *
 * A draft render is 2–4 minutes, and the pilot's retakes were blocking
 * checks (did the board hold? did he stand up?), not finish checks. A
 * preview is the same composition — same lane, same prompt, same start
 * frame — cut down to the smallest render that answers those questions:
 * two seconds (H3's floor is four), a 480p-class canvas that sits inside the
 * 1MP draft guard, the draft tier, and the enhancer off. The seed is fixed
 * up front so approving the preview hands the full render the same dice.
 *
 * Pure: takes the composed video input, returns the preview's. The router
 * applies it; qc.shot reads `take.preview` to run only the checks a preview
 * can answer. */

export const PREVIEW_SEC = 2;
/** MiniMax-H3 refuses anything under four seconds */
export const PREVIEW_SEC_H3 = 4;
/** vertical / landscape 480p-class canvases — 0.72 MPx, the draft guard's own
 * target, and on the /32 grid every engine snaps to */
export const PREVIEW_CANVAS = {
  portrait: "640 × 1120 (preview)",
  landscape: "1120 × 640 (preview)",
  square: "832 × 832 (preview)",
} as const;

export function parseCanvas(resolution: string | undefined): { width: number; height: number } | null {
  const m = resolution?.match(/(\d+)\s*[×x]\s*(\d+)/);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

/** the preview canvas for a lane's canvas: orientation is what survives */
export function previewCanvas(resolution: string | undefined): string {
  const c = parseCanvas(resolution);
  if (!c) return PREVIEW_CANVAS.landscape;
  const ratio = c.width / c.height;
  if (ratio < 0.9) return PREVIEW_CANVAS.portrait;
  if (ratio > 1.1) return PREVIEW_CANVAS.landscape;
  return PREVIEW_CANVAS.square;
}

export function previewDurationSec(engine: string | undefined): number {
  return engine === "minimax-h3" ? PREVIEW_SEC_H3 : PREVIEW_SEC;
}

/** The fields a preview overrides on a composed video input. Everything
 * else (prompt, start frame, cine, board) is the lane's own. Audio is
 * DROPPED: a two-second window under an eight-second voice bed would make
 * the engine trim or refuse, and a preview asks whether the board holds and
 * the blocking reads — not whether the line lands. The Director timeline
 * goes the same way (its beats are cut to the takes). */
export function previewFields(input: {
  engine?: string;
  resolution?: string;
}): {
  durationSec: number;
  resolution: string;
  fast: true;
  enhance: false;
  minimaxTier: "draft";
  audio: undefined;
  director: undefined;
  keyframes: [];
  endFrame: undefined;
} {
  return {
    durationSec: previewDurationSec(input.engine),
    resolution: previewCanvas(input.resolution),
    fast: true,
    enhance: false,
    minimaxTier: "draft",
    audio: undefined,
    director: undefined,
    keyframes: [],
    endFrame: undefined,
  };
}

/** a fresh seed, the range the adapters draw from themselves */
export function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/* ---------- board hold (the preview's one intent check) ---------- */

/** SSIM of the take's first frame against the board it was rendered from,
 * both as 64-px grey thumbnails (qc.ts measureBoardHold says why). Measured
 * 2026-09-02 on a 320×544 LTX 2.5 preview of FN15-2: 0.81 against its own
 * board, 0.64–0.68 against the other three Field Note boards (same tiger,
 * same loft, a different pose) — so the warn band is "a sibling framing" and
 * fail is "not this board at all" (a reference sheet, another room). */
export const BOARD_HOLD_PASS = 0.76;
export const BOARD_HOLD_FAIL = 0.6;

export function judgeBoardHold(ssim: number | null): {
  status: "pass" | "warn" | "fail";
  detail: string;
} {
  if (ssim === null) return { status: "warn", detail: "could not compare the first frame with the board" };
  const pct = `${(ssim * 100).toFixed(0)}%`;
  if (ssim >= BOARD_HOLD_PASS) return { status: "pass", detail: `first frame matches the board (SSIM ${pct})` };
  if (ssim >= BOARD_HOLD_FAIL) return { status: "warn", detail: `first frame drifts from the board (SSIM ${pct}) — check the framing before the full render` };
  return { status: "fail", detail: `first frame is not the board (SSIM ${pct}) — the start frame did not hold; re-board or retake` };
}
