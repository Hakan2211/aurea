/* The fal.ai image contract: what a render costs, and what output sizes the
 * endpoint will actually accept.
 *
 * This lives in shared rather than beside the adapter because two places need
 * the identical answer: the adapter (which reports cost on the job card as the
 * money is about to be spent, and rejects a bad size before uploading
 * anything) and the Image Lab params panel (which has to show both *before*
 * you press Generate). A second copy would eventually disagree with the first,
 * and the one on the button is the one users make decisions on. */

/** Indicative fal pricing for gpt-image-2 edits, USD per image at ~1 MP.
 *
 * OpenAI bills image tokens, so the true figure also moves with prompt length
 * and reference count — which is why every surface prints it with a "≈".
 * Anchored on fal's published 1024x1024 numbers ($0.015 low, $0.219 high).
 * "auto" is priced as high so the estimate never flatters the bill. */
export const GPT_IMAGE_2_RATE_1MP: Record<string, number> = {
  low: 0.015,
  medium: 0.06,
  high: 0.219,
  auto: 0.219,
};

/** cost scales with output pixels, normalised against 1024x1024 */
function megapixelFactor(width?: number, height?: number): number {
  if (!width || !height) return 1;
  return Math.max(0.5, (width * height) / (1024 * 1024));
}

export function falImageEstimate(
  quality: string | undefined,
  count: number,
  width?: number,
  height?: number,
): string {
  const rate = GPT_IMAGE_2_RATE_1MP[quality ?? "high"] ?? GPT_IMAGE_2_RATE_1MP.high;
  const total = rate * megapixelFactor(width, height) * Math.max(1, count);
  // Two decimals is wrong at the cheap end: a low-quality image really costs
  // $0.015, and rounding that to "$0.01" under-reports the bill by a third.
  // Small totals get three decimals, with a trailing zero trimmed so $0.060
  // still reads as $0.06.
  const shown =
    total < 0.1 ? total.toFixed(3).replace(/0$/, "") : total.toFixed(2);
  return `≈ $${shown}`;
}

/* ---- fal's documented limits on an explicit {width, height} ----
 * Straight off the gpt-image-2 schema. Worth enforcing before the request: a
 * violation otherwise comes back as an opaque HTTP 422 after every reference
 * has been uploaded, and the numbers are non-obvious — a 512x512 request is
 * rejected for being too *small*. */
export const FAL_SIZE_RULES = {
  step: 16,
  maxEdge: 3840,
  minPixels: 655_360,
  maxPixels: 8_294_400,
  maxAspect: 3,
} as const;

/** null when the size is acceptable, otherwise the reason it isn't */
export function falSizeError(width: number, height: number): string | null {
  const { step, maxEdge, minPixels, maxPixels, maxAspect } = FAL_SIZE_RULES;
  if (width % step !== 0 || height % step !== 0) {
    return `width and height must be multiples of ${step} (got ${width}×${height})`;
  }
  if (width > maxEdge || height > maxEdge) {
    return `no edge may exceed ${maxEdge}px (got ${width}×${height})`;
  }
  const pixels = width * height;
  if (pixels < minPixels) {
    return `${width}×${height} is too small — needs at least ${minPixels.toLocaleString()} total pixels (about 1024×640)`;
  }
  if (pixels > maxPixels) {
    return `${width}×${height} is too large — at most ${maxPixels.toLocaleString()} total pixels (about 3840×2160)`;
  }
  const aspect = Math.max(width / height, height / width);
  if (aspect > maxAspect) {
    return `aspect ratio must be ${maxAspect}:1 or squarer (got ${aspect.toFixed(1)}:1)`;
  }
  return null;
}
