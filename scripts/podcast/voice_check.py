"""Per-shot audio measurement for the multi-shot pilot.

Two things need proving about the soundtrack of a take that cuts:
  1. every shot actually has speech in it (not just the first one), and
  2. the voice in shot 2 is the SAME voice as the one that started the line in
     shot 1 — the continuity claim — while the reply in shot 3 is a different
     one.

Neither is answerable by ear from here, so this measures pitch. Median f0 over
the voiced frames of a segment separates a lion from a meerkat by a wide
margin, and it is stable enough that "same speaker across a cut" shows up as
two segments landing within a few Hz of each other.

Estimator: autocorrelation on 40 ms frames, 70-500 Hz, voiced frames only
(clarity over 0.4). numpy only — this runs on the ComfyUI venv python.

  python voice_check.py <take.wav> <cut_sec> [<cut_sec> ...]
"""

import sys
import wave

import numpy as np


def load(path):
    with wave.open(path, "rb") as w:
        rate = w.getframerate()
        n = w.getnframes()
        raw = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768.0
        if w.getnchannels() == 2:
            raw = raw.reshape(-1, 2).mean(axis=1)
    return raw, rate


def f0_frames(x, rate, fmin=70.0, fmax=500.0, win=0.04, hop=0.01):
    n = int(win * rate)
    h = int(hop * rate)
    lo, hi = int(rate / fmax), int(rate / fmin)
    out = []
    for start in range(0, max(0, len(x) - n), h):
        frame = x[start : start + n]
        rms = float(np.sqrt(np.mean(frame**2)))
        if rms < 0.01:
            continue
        frame = frame - frame.mean()
        ac = np.correlate(frame, frame, mode="full")[n - 1 :]
        if ac[0] <= 0:
            continue
        ac = ac / ac[0]
        seg = ac[lo:hi]
        if len(seg) == 0:
            continue
        k = int(np.argmax(seg))
        clarity = float(seg[k])
        if clarity < 0.4:
            continue
        out.append((start / rate, rate / (lo + k), clarity, rms))
    return out


def main():
    path = sys.argv[1]
    cuts = [float(c) for c in sys.argv[2:]]
    x, rate = load(path)
    dur = len(x) / rate
    bounds = [0.0] + cuts + [dur]

    print(f"{path}  {dur:.2f}s @ {rate} Hz")
    for i in range(len(bounds) - 1):
        a, b = bounds[i], bounds[i + 1]
        seg = x[int(a * rate) : int(b * rate)]
        frames = f0_frames(seg, rate)
        rms = float(np.sqrt(np.mean(seg**2)))
        peak = float(np.max(np.abs(seg)))
        label = f"shot {i + 1}  {a:5.2f}-{b:5.2f}s"
        if frames:
            f0 = np.array([f for _, f, _, _ in frames])
            print(
                f"{label}  voiced {len(frames):4d} frames ({len(frames) * 0.01 / (b - a) * 100:4.0f}% of shot)"
                f"  median f0 {np.median(f0):6.1f} Hz  (p25 {np.percentile(f0, 25):.0f} / "
                f"p75 {np.percentile(f0, 75):.0f})  rms {20 * np.log10(rms + 1e-9):6.1f} dB  "
                f"peak {20 * np.log10(peak + 1e-9):5.1f} dB"
            )
        else:
            print(f"{label}  NO voiced frames  rms {20 * np.log10(rms + 1e-9):6.1f} dB")


if __name__ == "__main__":
    main()
