/* Pitch analysis for singing voice conversion — RVC copies the source
 * melody's f0 verbatim and only swaps timbre, so a song sung in a register
 * far from the target voice comes out squeaky (or growly) instead of
 * sounding like the voice. "Auto" pitch matching measures the median f0 of
 * the source vocals and of the target voice's reference clip, then picks the
 * octave correction that lands the melody in that voice's natural range —
 * direction-agnostic, so it works for any chosen voice, male or female.
 *
 * The estimator is a plain YIN (difference function + cumulative-mean
 * normalization) over ffmpeg-decoded mono PCM. Full-mix analysis is
 * heuristic — a band-pass biases toward the vocal band, voiced-frame gating
 * drops percussion — and the decision is octave-granular with a wide
 * deadband, so a noisy estimate degrades to "no-change" (today's behavior),
 * never to a wrong semitone. */

import { spawn } from "node:child_process";

const SAMPLE_RATE = 16000;
const FRAME = 1024; // integration window (64 ms)
const HOP = 1024;
const F0_MIN = 65; // Hz — below male vocal range, above most bass energy post-filter
const F0_MAX = 800;
const CMND_THRESHOLD = 0.15; // voiced-frame gate; strict, favors clear periodicity
const SILENCE_RMS = 0.01;

/** singing sits a few semitones above the same person's speech — bias the
 * spoken reference upward before comparing registers */
const SING_BIAS_SEMITONES = 3;

export type PitchCorrection = "no-change" | "male-to-female" | "female-to-male";

/** decode audio to mono 16 kHz f32 PCM through ffmpeg (PATH), band-passed to
 * the vocal range; maxSec caps analysis cost on long tracks */
export function decodePcm(
  file: string,
  opts: { maxSec: number; highpassHz: number; lowpassHz: number },
): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const args = [
      "-v", "error",
      "-i", file,
      "-ac", "1",
      "-ar", String(SAMPLE_RATE),
      "-af", `highpass=f=${opts.highpassHz},lowpass=f=${opts.lowpassHz}`,
      "-t", String(opts.maxSec),
      "-f", "f32le",
      "pipe:1",
    ];
    const proc = spawn("ffmpeg", args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let err = "";
    proc.stdout.on("data", (c: Buffer) => chunks.push(c));
    proc.stderr.on("data", (c: Buffer) => (err += c.toString()));
    proc.on("error", (e) => reject(new Error(`ffmpeg not runnable: ${e.message}`)));
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg decode failed: ${err.trim() || code}`));
      const buf = Buffer.concat(chunks);
      const aligned = buf.length - (buf.length % 4);
      resolve(new Float32Array(buf.buffer, buf.byteOffset, aligned / 4));
    });
  });
}

/** YIN on one frame; null = unvoiced */
function yinFrame(x: Float32Array, start: number, minLag: number, maxLag: number): number | null {
  const d = new Float64Array(maxLag + 1);
  for (let tau = 1; tau <= maxLag; tau++) {
    let s = 0;
    for (let i = 0; i < FRAME; i++) {
      const diff = x[start + i] - x[start + i + tau];
      s += diff * diff;
    }
    d[tau] = s;
  }
  const cmnd = new Float64Array(maxLag + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }
  for (let tau = minLag; tau <= maxLag; tau++) {
    if (cmnd[tau] < CMND_THRESHOLD) {
      while (tau + 1 <= maxLag && cmnd[tau + 1] < cmnd[tau]) tau++;
      // parabolic interpolation around the dip for sub-sample lag
      let refined = tau;
      if (tau > 1 && tau < maxLag) {
        const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1];
        const denom = a - 2 * b + c;
        if (denom !== 0) refined = tau + (a - c) / (2 * denom);
      }
      return SAMPLE_RATE / refined;
    }
  }
  return null;
}

/** median f0 in Hz across voiced frames; null when nothing voiced was found */
export function medianF0(pcm: Float32Array): number | null {
  const minLag = Math.floor(SAMPLE_RATE / F0_MAX);
  const maxLag = Math.ceil(SAMPLE_RATE / F0_MIN);
  const voiced: number[] = [];
  for (let start = 0; start + FRAME + maxLag < pcm.length; start += HOP) {
    let energy = 0;
    for (let i = 0; i < FRAME; i++) energy += pcm[start + i] * pcm[start + i];
    if (Math.sqrt(energy / FRAME) < SILENCE_RMS) continue;
    const f0 = yinFrame(pcm, start, minLag, maxLag);
    if (f0 !== null) voiced.push(f0);
  }
  if (voiced.length < 10) return null;
  voiced.sort((a, b) => a - b);
  return voiced[Math.floor(voiced.length / 2)];
}

/** pick the vocals-only octave correction that brings the source melody into
 * the target voice's register; falls back to "no-change" when either side
 * can't be measured — matching today's behavior, never a wrong shift */
export async function autoPitchCorrection(
  sourceAudio: string,
  voiceRef: string,
): Promise<{ correction: PitchCorrection; detail: string }> {
  try {
    const [song, ref] = await Promise.all([
      // full mix: tighter band to favor the lead vocal over bass and cymbals
      decodePcm(sourceAudio, { maxSec: 120, highpassHz: 120, lowpassHz: 1200 }),
      // reference clip is clean speech — wider band is fine
      decodePcm(voiceRef, { maxSec: 60, highpassHz: 60, lowpassHz: 1500 }),
    ]);
    const srcF0 = medianF0(song);
    const refF0 = medianF0(ref);
    if (!srcF0 || !refF0) {
      return { correction: "no-change", detail: "pitch unmeasurable — no shift applied" };
    }
    // expected singing register = spoken ref raised by the sing bias
    const target = refF0 * Math.pow(2, SING_BIAS_SEMITONES / 12);
    const semitones = 12 * Math.log2(srcF0 / target);
    const octaves = Math.round(semitones / 12);
    const detail = `vocals ${Math.round(srcF0)} Hz vs voice ${Math.round(refF0)} Hz`;
    if (octaves >= 1) return { correction: "female-to-male", detail: `${detail} — octave down` };
    if (octaves <= -1) return { correction: "male-to-female", detail: `${detail} — octave up` };
    return { correction: "no-change", detail: `${detail} — already in register` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { correction: "no-change", detail: `pitch match skipped (${msg})` };
  }
}
