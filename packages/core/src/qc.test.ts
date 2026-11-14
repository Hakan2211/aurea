/* QC (P2) — the pure half. The ffmpeg parsers get real-shaped output, the f0
 * estimator gets synthesized tones (a 220 Hz "lion" must not read as a 440 Hz
 * "meerkat"), and the verdict logic gets hand-built measurements. The ffmpeg
 * calls themselves are exercised by scripts/test-qc.mts against a live take. */

import test from "node:test";
import assert from "node:assert/strict";
import {
  assessArticulation,
  f0ConsistencyFlags,
  measureVoice,
  parseSceneScores,
  parseVolume,
  speechRateFlag,
} from "./qc.js";

test("parseSceneScores pairs pts_time with the following scene_score line", () => {
  const text = [
    "frame:1    pts:1024   pts_time:0.0416667",
    "lavfi.scene_score=0.001234",
    "frame:2    pts:2048   pts_time:0.0833333",
    "lavfi.scene_score=0.452000",
    "junk line",
  ].join("\n");
  const scores = parseSceneScores(text);
  assert.equal(scores.length, 2);
  assert.ok(Math.abs(scores[0].t - 0.0417) < 0.001);
  assert.ok(Math.abs(scores[1].score - 0.452) < 0.001);
});

test("parseVolume reads volumedetect output", () => {
  const text = [
    "[Parsed_volumedetect_0 @ 0x1] mean_volume: -23.4 dB",
    "[Parsed_volumedetect_0 @ 0x1] max_volume: -1.2 dB",
  ].join("\n");
  const vol = parseVolume(text);
  assert.equal(vol.meanDb, -23.4);
  assert.equal(vol.peakDb, -1.2);
  assert.deepEqual(parseVolume("no volume here"), { meanDb: null, peakDb: null });
});

function tone(hz: number, sec: number, rate: number, amp = 0.3): Float32Array {
  const x = new Float32Array(Math.round(sec * rate));
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate);
  return x;
}

test("measureVoice finds the fundamental of a synthesized tone", () => {
  const rate = 16000;
  const m = measureVoice(tone(220, 1, rate), rate);
  assert.ok(m.f0Hz !== null && Math.abs(m.f0Hz - 220) < 8, `expected ~220 Hz, got ${m.f0Hz}`);
  assert.ok(m.voicedRatio > 0.8);
  const high = measureVoice(tone(440, 1, rate), rate);
  assert.ok(high.f0Hz !== null && Math.abs(high.f0Hz - 440) < 15, `expected ~440 Hz, got ${high.f0Hz}`);
});

test("measureVoice reports silence as unvoiced", () => {
  const m = measureVoice(new Float32Array(16000), 16000);
  assert.equal(m.f0Hz, null);
  assert.equal(m.voicedRatio, 0);
  assert.ok(m.rmsDb < -80);
});

test("assessArticulation flags a frozen speech window against a moving clip", () => {
  // steady motion everywhere except 2–3s, where the frame freezes
  const series = Array.from({ length: 120 }, (_, i) => ({
    t: i / 24,
    score: i / 24 >= 2 && i / 24 < 3 ? 0.0001 : 0.01,
  }));
  const out = assessArticulation(series, [
    { atSec: 0.5, endSec: 1.5, label: "line 1" },
    { atSec: 2, endSec: 3, label: "line 2" },
  ]);
  assert.equal(out[0].suspect, false);
  assert.equal(out[1].suspect, true);
});

test("assessArticulation stays quiet on a uniformly still single", () => {
  // a locked-off interview: low motion everywhere — nothing is relatively frozen
  const series = Array.from({ length: 120 }, (_, i) => ({ t: i / 24, score: 0.002 }));
  const out = assessArticulation(series, [{ atSec: 1, endSec: 3, label: "line 1" }]);
  assert.equal(out[0].suspect, false);
});

test("speechRateFlag catches truncated and dragging takes, passes normal speech", () => {
  assert.equal(speechRateFlag(70, 5), null); // 14 chars/s — normal
  assert.ok(speechRateFlag(120, 2)); // 60 chars/s — truncated audio
  assert.ok(speechRateFlag(20, 10)); // 2 chars/s — trailing garbage
  assert.ok(speechRateFlag(50, 0.1)); // sub-0.2s take
});

test("f0ConsistencyFlags flags the take that doesn't sound like the character", () => {
  const flags = f0ConsistencyFlags([
    {
      character: "sterling",
      takes: [
        { id: "l1", f0Hz: 120 },
        { id: "l2", f0Hz: 124 },
        { id: "l3", f0Hz: 118 },
        { id: "l4", f0Hz: 190 }, // 58% off — wrong voice
      ],
    },
    { character: "milo", takes: [{ id: "l5", f0Hz: 300 }] }, // single take: nothing to compare
  ]);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].takeId, "l4");
  assert.equal(flags[0].character, "sterling");
});
