/* Draw the reference sheet the Ingredients IC-LoRA reads.
 *
 * The layout — how many columns, which cell is "Top Row Left" — belongs to
 * shared/refSheet.ts, because the prompt has to name the same cells. This module
 * only paints it: each ref scaled to fit its cell on a white ground, composited
 * in cell order with one ffmpeg pass (already a hard dependency for probes and
 * export, so no new one).
 *
 * Two choices worth knowing about:
 *
 * · The canvas is built at the SHOT's aspect ratio. The guide encoder resizes
 *   the sheet to the shot's own latent geometry with the Director's resize
 *   method, and that method is "crop" for keyframes — a 3:2 sheet dropped into a
 *   portrait shot would lose its outer cells before the model ever saw them.
 *   Matching the aspect up front makes the crop a no-op.
 *
 * · Cells are padded, never cropped. A cropped reference teaches LTX a character
 *   with no legs. White is the ground because that's what the IC-LoRA's own
 *   reference sheets look like. */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { sheetLayout } from "@aurea/shared";

/** long edge of the finished sheet, in pixels. The guide is re-encoded far
 * smaller than this (latent size ÷ the LoRA's reference downscale factor), so
 * the only job here is to leave each cell enough detail to survive that. */
const SHEET_LONG_EDGE = 1024;

export interface RefSheet {
  /** absolute path of the written png */
  file: string;
  cols: number;
  rows: number;
  width: number;
  height: number;
}

/** even, and at least 2 — encoders and filters both dislike odd geometry */
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export async function composeRefSheet(opts: {
  /** absolute paths of the ref stills, in cell order */
  images: string[];
  /** absolute path to write the sheet to */
  out: string;
  /** the shot's width ÷ height */
  aspect: number;
}): Promise<RefSheet> {
  const { images, out } = opts;
  if (images.length === 0) throw new Error("A reference sheet needs at least one image");
  const aspect = Number.isFinite(opts.aspect) && opts.aspect > 0 ? opts.aspect : 1;
  const { cols, rows } = sheetLayout(images.length);

  const landscape = aspect >= 1;
  const width = even(landscape ? SHEET_LONG_EDGE : SHEET_LONG_EDGE * aspect);
  const height = even(landscape ? SHEET_LONG_EDGE / aspect : SHEET_LONG_EDGE);
  const cellW = even(width / cols);
  const cellH = even(height / rows);

  /* One white ground (input 0) plus the refs, each fitted into its cell and
   * overlaid in turn. A grid that isn't full — five refs in six cells — leaves
   * the last cell white, which reads as an empty slot rather than a black hole
   * the model has to explain to itself. */
  const args: string[] = ["-y", "-f", "lavfi", "-i", `color=c=white:s=${width}x${height}`];
  for (const image of images) args.push("-i", image);

  const steps: string[] = [];
  let base = "0:v";
  images.forEach((_, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    steps.push(
      `[${i + 1}:v]scale=${cellW}:${cellH}:force_original_aspect_ratio=decrease,` +
        `pad=${cellW}:${cellH}:(ow-iw)/2:(oh-ih)/2:color=white[c${i}]`,
    );
    const label = i === images.length - 1 ? "sheet" : `o${i}`;
    steps.push(`[${base}][c${i}]overlay=x=${col * cellW}:y=${row * cellH}[${label}]`);
    base = label;
  });

  args.push(
    "-filter_complex",
    steps.join(";"),
    "-map",
    "[sheet]",
    "-frames:v",
    "1",
    "-update",
    "1",
    out,
  );

  fs.mkdirSync(path.dirname(out), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    execFile("ffmpeg", args, { windowsHide: true, maxBuffer: 8 << 20 }, (err, _stdout, stderr) => {
      if (err) {
        const tail = String(stderr).trim().split(/\r?\n/).slice(-3).join(" ");
        reject(
          new Error(
            `Could not build the reference sheet with ffmpeg — is it installed and on PATH? ${tail}`,
          ),
        );
        return;
      }
      resolve();
    });
  });
  if (!fs.existsSync(out)) throw new Error("ffmpeg reported success but wrote no reference sheet");

  return { file: out, cols, rows, width, height };
}
