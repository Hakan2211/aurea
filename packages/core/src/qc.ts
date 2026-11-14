/* QC — the measurements that let a crew agent judge its own output (P2).
 *
 * Promoted from the multi-shot pilot scripts (scripts/podcast/03-judge.mts and
 * voice_check.py), which established what is actually measurable about a take:
 *   cuts          ffmpeg scene-change scores — a real hard cut lands ≥0.4, a
 *                 handheld settle sits under 0.1, so count and times are objective
 *   audio         a stream exists, is the right length, is neither silent nor
 *                 clipping (volumedetect)
 *   articulation  motion energy inside each speech window vs the clip's own
 *                 median — a named speaker whose window shows no motion is the
 *                 closed-mouth failure (heuristic: warns, never fails)
 *   voice takes   duration sanity against the line's text, silence/clipping,
 *                 and median-f0 consistency per character across a scene (the
 *                 voice_check.py autocorrelation estimator, ported)
 *
 * What ffmpeg cannot measure — identity drift against the character sheets,
 * burned broadcast text — is a VISION check: qcShotTake emits a contact sheet
 * and cut-straddling frames (plus the cast's reference stills) exactly so the
 * reviewing agent can look. Artifacts land under <dataRoot>/qc/, which the
 * library scanner does not walk, so QC evidence never shows up as an asset. */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  characterRef,
  isMultiShotProse,
  judgeBoardHold,
  type QcSceneVoices,
  type QcShot,
  type Shot,
} from "@aurea/shared";
import { probeMedia } from "./adapters/ffmpeg-export.js";
import { composeShotFromBoard, type ShotComposeDeps } from "./shot-director.js";
import { DIGITAL_SILENCE_DB, DURATION_TOLERANCE } from "./take-verify.js";

/* ---------- ffmpeg plumbing ---------- */

const MAX_BUF = 256 * 1024 * 1024;

function ff(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-hide_banner", "-nostats", ...args],
      { windowsHide: true, maxBuffer: MAX_BUF, encoding: "utf8" },
      (err, stdout, stderr) => {
        // ffmpeg writes analysis output to stderr; -f null runs "fail" with ok output
        if (err && !stdout && !stderr) reject(new Error(`ffmpeg failed: ${String(err.message)}`));
        else resolve(`${stdout}\n${stderr}`);
      },
    );
  });
}

/** "SSIM … All:0.8123 (7.27)" → 0.8123, from ffmpeg's ssim filter summary */
export function parseSsim(text: string): number | null {
  const m = text.match(/All:([\d.]+)/);
  const v = m ? Number(m[1]) : NaN;
  return Number.isFinite(v) ? v : null;
}

/** Board hold (P5's one intent check, cheap enough for every take): SSIM of
 * the take's first frame against the board it was rendered from — BOTH
 * reduced to a 64-px-wide grey thumbnail first. Full-size colour SSIM is
 * dominated by codec noise and the shared background: on the pilot's four
 * Silas-in-the-loft boards the true board scored 0.64 and its siblings
 * 0.55–0.58 (2026-09-02, 320×544 preview). At 64×112 grey the same frame
 * scores 0.81 against its own board and 0.64–0.68 against the siblings —
 * the layout survives, the noise does not. The first frame is decoded once
 * to a lossless still so the comparison is not against the I-frame twice. */
export const BOARD_HOLD_THUMB_W = 64;
async function measureBoardHold(
  takeFile: string,
  boardFile: string,
  size: { width: number; height: number },
  dir: string,
): Promise<number | null> {
  const first = path.join(dir, "first.png");
  await ff(["-y", "-i", takeFile, "-frames:v", "1", first]).catch(() => undefined);
  if (!fs.existsSync(first)) return null;
  const w = BOARD_HOLD_THUMB_W;
  const h = Math.max(2, Math.round((size.height / size.width) * w / 2) * 2);
  const thumb = `scale=${w}:${h}:flags=area,format=gray`;
  const out = await ff([
    "-i", first,
    "-i", boardFile,
    "-filter_complex", `[0:v]${thumb}[a];[1:v]${thumb}[b];[a][b]ssim`,
    "-f", "null", "-",
  ]).catch(() => "");
  return parseSsim(out);
}

function ffRaw(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-hide_banner", "-nostats", ...args],
      { windowsHide: true, maxBuffer: MAX_BUF, encoding: "buffer" },
      (err, stdout) => {
        if (err && !(stdout as Buffer)?.length) {
          reject(new Error(`ffmpeg failed: ${String(err.message)}`));
        } else resolve(stdout as Buffer);
      },
    );
  });
}

/* ---------- pure parsers & estimators (unit-tested) ---------- */

export interface FrameScore {
  t: number;
  score: number;
}

/** parse `metadata=print` output: a pts_time line followed by a scene_score line */
export function parseSceneScores(text: string): FrameScore[] {
  const out: FrameScore[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = /pts_time:([\d.]+)/.exec(line);
    const s = /scene_score=([\d.]+)/.exec(lines[i + 1] ?? "");
    if (m && s) out.push({ t: Number(m[1]), score: Number(s[1]) });
  });
  return out;
}

export interface VolumeStats {
  meanDb: number | null;
  peakDb: number | null;
}

export function parseVolume(text: string): VolumeStats {
  const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(text)?.[1];
  const peak = /max_volume:\s*(-?[\d.]+) dB/.exec(text)?.[1];
  return { meanDb: mean ? Number(mean) : null, peakDb: peak ? Number(peak) : null };
}

/** a frame's score at or past this is a hard cut (pilot, measured) */
export const CUT_THRESHOLD = 0.4;

export interface VoiceMeasurement {
  /** median f0 over voiced frames, Hz; null when nothing voiced */
  f0Hz: number | null;
  /** share of frames that were voiced (0..1) */
  voicedRatio: number;
  rmsDb: number;
  peakDb: number;
}

/** The voice_check.py estimator, ported: autocorrelation on 40 ms frames,
 * 70–500 Hz, voiced = clarity over 0.4 and rms over 0.01. Mono float PCM. */
export function measureVoice(x: Float32Array, rate: number): VoiceMeasurement {
  const win = Math.round(0.04 * rate);
  const hop = Math.round(0.02 * rate);
  const lo = Math.floor(rate / 500);
  const hi = Math.ceil(rate / 70);
  const f0s: number[] = [];
  let frames = 0;
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]);
    sumSq += x[i] * x[i];
    if (v > peak) peak = v;
  }
  for (let start = 0; start + win <= x.length; start += hop) {
    frames++;
    let mean = 0;
    let energy = 0;
    for (let i = start; i < start + win; i++) mean += x[i];
    mean /= win;
    for (let i = start; i < start + win; i++) {
      const d = x[i] - mean;
      energy += d * d;
    }
    const rms = Math.sqrt(energy / win);
    if (rms < 0.01 || energy <= 0) continue;
    let bestLag = -1;
    let best = 0;
    for (let lag = lo; lag <= Math.min(hi, win - 1); lag++) {
      let ac = 0;
      for (let i = start; i < start + win - lag; i++) {
        ac += (x[i] - mean) * (x[i + lag] - mean);
      }
      const clarity = ac / energy;
      if (clarity > best) {
        best = clarity;
        bestLag = lag;
      }
    }
    if (bestLag !== -1 && best >= 0.4) f0s.push(rate / bestLag);
  }
  f0s.sort((a, b) => a - b);
  const rmsAll = Math.sqrt(sumSq / Math.max(1, x.length));
  return {
    f0Hz: f0s.length ? f0s[Math.floor(f0s.length / 2)] : null,
    voicedRatio: frames ? f0s.length / frames : 0,
    rmsDb: 20 * Math.log10(rmsAll + 1e-9),
    peakDb: 20 * Math.log10(peak + 1e-9),
  };
}

export interface SpeechWindow {
  atSec: number;
  endSec: number;
  label: string;
}

export interface ArticulationResult {
  label: string;
  meanMotion: number;
  /** window motion relative to the clip's median frame motion */
  vsClipMedian: number | null;
  suspect: boolean;
}

/** Motion energy inside each speech window vs the clip's own median motion —
 * self-normalizing, so a locked-off single and a busy two-shot judge against
 * themselves. A window under 40% of the clip median (or near-frozen outright)
 * is a closed-mouth suspect. Heuristic: the caller warns, never fails, on it. */
export function assessArticulation(
  series: FrameScore[],
  windows: SpeechWindow[],
): ArticulationResult[] {
  const sorted = series.map((f) => f.score).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  return windows.map((w) => {
    const inside = series.filter((f) => f.t >= w.atSec && f.t < w.endSec);
    const mean = inside.length
      ? inside.reduce((s, f) => s + f.score, 0) / inside.length
      : 0;
    const rel = median && median > 0 ? mean / median : null;
    return {
      label: w.label,
      meanMotion: mean,
      vsClipMedian: rel === null ? null : Math.round(rel * 100) / 100,
      suspect: inside.length > 0 && ((rel !== null && rel < 0.4) || mean < 0.0005),
    };
  });
}

/** chars/sec sanity for a TTS take: normal speech reads ~10–20 chars/s.
 * Way under = trailing garbage or a stretched take, way over = truncated. */
export function speechRateFlag(textChars: number, durationSec: number): string | null {
  if (durationSec <= 0.2) return "take is under 0.2s — almost certainly broken";
  const rate = textChars / durationSec;
  if (rate < 5) return `only ${rate.toFixed(1)} chars/s — take runs long for its line (trailing noise?)`;
  if (rate > 28) return `${rate.toFixed(1)} chars/s — take too short for its line (truncated?)`;
  return null;
}

export interface CharacterF0 {
  character: string;
  takes: Array<{ id: string; f0Hz: number }>;
}

/** Same speaker across a scene lands within a few Hz of themselves (pilot);
 * a take drifting past ±20% of the character's own scene median is flagged. */
export function f0ConsistencyFlags(groups: CharacterF0[]): Array<{ character: string; takeId: string; detail: string }> {
  const flags: Array<{ character: string; takeId: string; detail: string }> = [];
  for (const g of groups) {
    if (g.takes.length < 2) continue;
    const sorted = [...g.takes].sort((a, b) => a.f0Hz - b.f0Hz);
    const median = sorted[Math.floor(sorted.length / 2)].f0Hz;
    for (const t of g.takes) {
      const dev = Math.abs(t.f0Hz - median) / median;
      if (dev > 0.2) {
        flags.push({
          character: g.character,
          takeId: t.id,
          detail: `median f0 ${t.f0Hz.toFixed(0)} Hz vs the character's scene median ${median.toFixed(0)} Hz (${(dev * 100).toFixed(0)}% off) — different-sounding voice, retake it`,
        });
      }
    }
  }
  return flags;
}

/* ---------- report shapes ---------- */

export interface QcCheck {
  id: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

const verdictOf = (checks: QcCheck[]): "pass" | "review" | "fail" =>
  checks.some((c) => c.status === "fail")
    ? "fail"
    : checks.some((c) => c.status === "warn")
      ? "review"
      : "pass";

/* ---------- qc.shot ---------- */

export interface QcShotReport {
  shotId: string;
  takeId: string;
  asset: string;
  verdict: "pass" | "review" | "fail";
  checks: QcCheck[];
  cuts: FrameScore[];
  articulation: ArticulationResult[];
  /** evidence for the vision pass — ABSOLUTE paths, openable directly */
  artifacts: {
    dir: string;
    contactSheet: string | null;
    /** one before/after pair per detected cut */
    cutFrames: string[];
    /** the cast's bible reference stills, for identity comparison */
    castRefs: Array<{ character: string; image: string }>;
    keyframe: string | null;
  };
  notes: string[];
}

function pickTake(shot: Shot, takeId?: string) {
  const take = takeId
    ? shot.videoTakes.find((t) => t.id === takeId)
    : (shot.videoTakes.find((t) => t.id === shot.selectedTake) ?? shot.videoTakes.at(-1));
  if (!take) {
    throw new Error(
      takeId
        ? `unknown take "${takeId}" on shot "${shot.id}"`
        : `shot "${shot.id}" has no rendered takes to check — render it first`,
    );
  }
  return take;
}

export async function qcShotTake(deps: ShotComposeDeps, input: QcShot): Promise<QcShotReport> {
  const { shot } = deps.studio.getShotContext(input.project, input.shotId);
  const bible = deps.studio.getBible(input.project);
  const take = pickTake(shot, input.takeId);
  const dataRoot = deps.settings.get().storage.dataRoot;
  const file = path.join(dataRoot, take.asset);
  if (!fs.existsSync(file)) throw new Error(`take file missing on disk: ${take.asset}`);

  const checks: QcCheck[] = [];
  const notes: string[] = [];

  /* intent — the shot as it would compose today. Best effort: the take may
   * predate an edit, but it is the only statement of intent that exists. */
  const composed = await composeShotFromBoard(deps, {
    project: input.project,
    shotId: input.shotId,
  }).catch((err) => {
    notes.push(`could not compose the shot's intent (${String((err as Error).message)}) — intent checks skipped`);
    return null;
  });

  /* delivery-time hard verification (P3.1) — the badge's own verdict, so the
   * report and the red pill never disagree */
  if (take.verify?.status === "broken") {
    checks.push({ id: "verify", status: "fail", detail: `failed hard verification at delivery: ${take.verify.reasons.join("; ")}` });
  } else if (take.verify?.status === "pending") {
    notes.push("hard verification is still pending on this take — verify_take re-runs it");
  } else if (!take.verify) {
    notes.push("this take predates delivery verification — verify_take measures it");
  }
  if (take.verify?.roomTone) notes.push(`room-tone bed under this take: ${take.verify.roomTone}`);

  const probe = await probeMedia(file);
  if (!probe.hasVideo) {
    checks.push({ id: "container", status: "fail", detail: "no video stream in the take" });
  } else {
    checks.push({
      id: "container",
      status: "pass",
      detail: `${probe.width}×${probe.height} @ ${probe.fps?.toFixed(2) ?? "?"} fps, ${probe.duration?.toFixed(2) ?? "?"}s`,
    });
  }
  /* Judged against the length the render was ASKED for, recorded on the take
   * at delivery. Only a take from before that record falls back to the
   * recomposed default — which is what warned on every correct take of the
   * pilot (defect #7). */
  const asked = take.durationSec ?? composed?.durationSec ?? null;
  const askedLabel = take.durationSec ? "requested" : "recomposed default";
  if (asked && probe.duration) {
    if (!take.durationSec) {
      notes.push("this take predates the requested-length record — its duration is compared against a recomposed default");
    }
    const drift = Math.abs(probe.duration - asked) / asked;
    if (drift > DURATION_TOLERANCE) {
      /* a hard fail against the requested length (P3.1); only the
       * recomposed-default fallback stays a warning, since that number is a
       * guess about intent rather than the render's own order */
      checks.push({
        id: "duration",
        status: take.durationSec ? "fail" : "warn",
        detail: `take runs ${probe.duration.toFixed(2)}s vs the ${askedLabel} ${asked}s (${(drift * 100).toFixed(0)}% off)`,
      });
    } else {
      checks.push({ id: "duration", status: "pass", detail: `${probe.duration.toFixed(2)}s ≈ ${askedLabel} ${asked}s` });
    }
  }

  /* evidence dir — made here because the board-hold check writes into it */
  const dir = path.join(dataRoot, "qc", input.project, shot.id, take.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  /* board hold: did the start frame survive? First frame vs the selected
   * keyframe. The preview's (P5) one intent check; on a full take it is the
   * same measurement for free. */
  const selectedKeyframe =
    shot.keyframes.find((k) => k.id === shot.selectedKeyframe) ?? shot.keyframes.at(-1);
  const boardFile = selectedKeyframe ? path.join(dataRoot, selectedKeyframe.asset) : null;
  if (boardFile && fs.existsSync(boardFile) && probe.hasVideo && probe.width && probe.height) {
    const ssim = await measureBoardHold(file, boardFile, { width: probe.width, height: probe.height }, dir);
    checks.push({ id: "board-hold", ...judgeBoardHold(ssim) });
  } else if (!boardFile) {
    notes.push("no keyframe on the shot — board hold not measured");
  }

  /* A PREVIEW (P5) answers two questions only — does it decode, does the
   * board hold — so the checks stop here: no cut count (2s is too short to
   * mean anything), no audio (previews carry none by design), no
   * articulation (no lines are placed). */
  if (take.preview) {
    const sheet = path.join(dir, "sheet.jpg");
    const dur = probe.duration ?? 2;
    await ff([
      "-y", "-i", file,
      "-vf", `fps=${(6 / dur).toFixed(4)},scale=480:-1,tile=3x2`,
      "-frames:v", "1", sheet,
    ]).catch(() => notes.push("contact sheet failed to render"));
    notes.push("preview take: cut, audio and articulation checks are not run — approve it to carry its seed into the full render");
    return {
      shotId: shot.id,
      takeId: take.id,
      asset: take.asset,
      verdict: verdictOf(checks),
      checks,
      cuts: [],
      articulation: [],
      artifacts: {
        dir,
        contactSheet: fs.existsSync(sheet) ? sheet : null,
        cutFrames: [],
        castRefs: [],
        keyframe: boardFile,
      },
      notes,
    };
  }

  /* motion: every frame's scene score in one pass — cuts and articulation
   * both read from it */
  const series = parseSceneScores(
    await ff([
      "-i", file,
      "-filter_complex", "select='gte(scene,0)',metadata=print:file=-",
      "-an", "-f", "null", "-",
    ]),
  );
  const cuts = series.filter((f) => f.score >= CUT_THRESHOLD);

  const multiShot = composed ? isMultiShotProse(composed.prompt) : null;
  if (multiShot === true) {
    checks.push(
      cuts.length > 0
        ? { id: "cuts", status: "pass", detail: `multi-shot prose and ${cuts.length} measured cut${cuts.length === 1 ? "" : "s"}: ${cuts.map((c) => `${c.t.toFixed(2)}s`).join(", ")}` }
        : { id: "cuts", status: "fail", detail: "prompt is multi-shot prose but the take never cuts — was the Gemma enhancer left on (enhance:false)?" },
    );
  } else if (multiShot === false) {
    checks.push(
      cuts.length === 0
        ? { id: "cuts", status: "pass", detail: "single take, no cuts — as intended" }
        : { id: "cuts", status: "fail", detail: `single-take shot but the take cuts at ${cuts.map((c) => `${c.t.toFixed(2)}s (${c.score.toFixed(2)})`).join(", ")}` },
    );
  } else if (cuts.length) {
    checks.push({ id: "cuts", status: "warn", detail: `${cuts.length} cut(s) detected; intent unknown` });
  }

  /* audio: existence, level, clipping */
  const expectAudio = !composed || composed.director.audio.length > 0 || composed.director.inpaintAudio;
  if (!probe.hasAudio) {
    checks.push({
      id: "audio",
      status: expectAudio ? "fail" : "warn",
      detail: "no audio stream in the take",
    });
  } else {
    const vol = parseVolume(await ff(["-i", file, "-af", "volumedetect", "-f", "null", "-"]));
    if (vol.meanDb === null) {
      checks.push({ id: "audio", status: "warn", detail: "could not measure audio level" });
    } else if (vol.meanDb < DIGITAL_SILENCE_DB) {
      /* digital silence, not a quiet room: LTX 2.5's no-dialogue output.
       * Under placed lines it is a hard fail (P3.1); otherwise a room-tone
       * bed is the fix (P3.2) and the take says whether it got one */
      checks.push({
        id: "audio",
        status: expectAudio ? "fail" : "warn",
        detail: `digital silence (mean ${vol.meanDb.toFixed(1)} dB)${take.verify?.roomTone ? " — a room-tone bed was laid, re-check the bedded file" : expectAudio ? " under placed lines" : " — no room-tone bed laid (seed one for the location in the Bible)"}`,
      });
    } else if (vol.meanDb < -50) {
      checks.push({
        id: "audio",
        status: expectAudio ? "fail" : "warn",
        detail: `audio is effectively silent (mean ${vol.meanDb.toFixed(1)} dB)`,
      });
    } else {
      checks.push({ id: "audio", status: "pass", detail: `mean ${vol.meanDb.toFixed(1)} dB · peak ${vol.peakDb?.toFixed(1)} dB` });
      if (vol.peakDb !== null && vol.peakDb > -0.1) {
        checks.push({ id: "clipping", status: "warn", detail: `peak at ${vol.peakDb.toFixed(1)} dB — likely clipping` });
      }
    }
  }

  /* articulation: motion inside each laid speech window vs the clip median */
  let articulation: ArticulationResult[] = [];
  if (composed && composed.director.audio.length) {
    const windows: SpeechWindow[] = [];
    for (const [i, a] of composed.director.audio.entries()) {
      const p = await probeMedia(path.join(dataRoot, a.take)).catch(() => null);
      if (p?.duration) windows.push({ atSec: a.atSec, endSec: a.atSec + p.duration, label: `line ${i + 1} @ ${a.atSec}s` });
    }
    articulation = assessArticulation(series, windows);
    for (const a of articulation) {
      if (a.suspect) {
        checks.push({
          id: "articulation",
          status: "warn",
          detail: `${a.label}: motion ${a.vsClipMedian === null ? "near zero" : `${a.vsClipMedian}× the clip median`} during the line — possible closed mouth (heuristic; confirm on the contact sheet). Named-beat wording, not a pronoun, is what articulates.`,
        });
      }
    }
    if (articulation.length && !articulation.some((a) => a.suspect)) {
      checks.push({ id: "articulation", status: "pass", detail: `motion present in all ${articulation.length} speech window(s)` });
    }
  }

  /* A failure the composer already warned about at compose time is a known
   * rule still breaking, not a new finding — say which. */
  const fired = composed?.rulesFired ?? [];
  if (fired.length) {
    const failing = checks.filter((c) => c.status !== "pass").map((c) => c.id);
    const known: string[] = [];
    if (fired.includes("silence-25") && failing.includes("audio")) known.push("silence-25 → audio");
    if (fired.includes("motion-only-i2v") && failing.includes("cuts")) known.push("motion-only-i2v → cuts");
    if (fired.includes("named-beat-lipsync") && failing.includes("articulation")) known.push("named-beat-lipsync → articulation");
    notes.push(
      known.length
        ? `known rule, still broke: ${known.join("; ")} — the composer flagged this at compose time (rulesFired: ${fired.join(", ")})`
        : `craft rules that fired at compose time: ${fired.join(", ")}`,
    );
  }

  /* evidence for the vision pass */
  const dur = probe.duration ?? 5;
  const contactSheet = path.join(dir, "sheet.jpg");
  await ff([
    "-y", "-i", file,
    "-vf", `fps=${(12 / dur).toFixed(4)},scale=480:-1,tile=4x3`,
    "-frames:v", "1", contactSheet,
  ]).catch(() => notes.push("contact sheet failed to render"));
  const cutFrames: string[] = [];
  for (const [i, c] of cuts.entries()) {
    for (const [j, t] of [Math.max(0, c.t - 0.09), c.t + 0.09].entries()) {
      const out = path.join(dir, `cut${i}${j ? "b" : "a"}.jpg`);
      await ff(["-y", "-ss", t.toFixed(3), "-i", file, "-frames:v", "1", "-vf", "scale=640:-1", out]).catch(() => undefined);
      if (fs.existsSync(out)) cutFrames.push(out);
    }
  }
  const castRefs = shot.characters
    .map((id) => bible.characters.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => ({ character: c.name, image: characterRef(c) }))
    .filter((r): r is { character: string; image: string } => !!r.image)
    .map((r) => ({ ...r, image: path.join(dataRoot, r.image) }));

  notes.push(
    "Vision checks are yours: open the contact sheet and cut frames and compare against castRefs and the keyframe — identity drift and any legible burned-in text are automatic retakes.",
  );

  return {
    shotId: shot.id,
    takeId: take.id,
    asset: take.asset,
    verdict: verdictOf(checks),
    checks,
    cuts,
    articulation,
    artifacts: {
      dir,
      contactSheet: fs.existsSync(contactSheet) ? contactSheet : null,
      cutFrames,
      castRefs,
      keyframe: boardFile,
    },
    notes,
  };
}

/* ---------- qc.sceneVoices ---------- */

export interface QcVoiceLine {
  shotId: string;
  lineId: string;
  character: string | null;
  text: string;
  takeId: string | null;
  asset: string | null;
  durationSec: number | null;
  f0Hz: number | null;
  voicedRatio: number | null;
  rmsDb: number | null;
  peakDb: number | null;
  flags: string[];
}

export interface QcSceneVoicesReport {
  sceneId: string;
  verdict: "pass" | "review" | "fail";
  lines: QcVoiceLine[];
  characters: Array<{ character: string; medianF0Hz: number | null; takes: number }>;
  /** feed straight back into table_read({lineIds}) to retake the failures */
  retakeLineIds: string[];
  notes: string[];
}

async function decodeMono16k(file: string): Promise<Float32Array> {
  const buf = await ffRaw(["-i", file, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"]);
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

export async function qcSceneVoices(
  deps: Pick<ShotComposeDeps, "studio" | "settings">,
  input: QcSceneVoices,
): Promise<QcSceneVoicesReport> {
  const scene = deps.studio.getScene(input.project, input.sceneId);
  const bible = deps.studio.getBible(input.project);
  const dataRoot = deps.settings.get().storage.dataRoot;
  const lines: QcVoiceLine[] = [];
  const notes: string[] = [];
  const byCharacter = new Map<string, Array<{ id: string; f0Hz: number }>>();

  for (const shot of scene.shots) {
    for (const line of shot.scriptLines) {
      if (!line.character || !line.text.trim()) continue;
      // newest take per line wins — exactly what shot composition lays down
      const take = [...shot.voTakes].reverse().find((t) => t.lineId === line.id);
      const character = bible.characters.find((c) => c.id === line.character)?.name ?? line.character;
      const entry: QcVoiceLine = {
        shotId: shot.id,
        lineId: line.id,
        character,
        text: line.text.trim(),
        takeId: take?.id ?? null,
        asset: take?.asset ?? null,
        durationSec: null,
        f0Hz: null,
        voicedRatio: null,
        rmsDb: null,
        peakDb: null,
        flags: [],
      };
      lines.push(entry);
      if (!take) {
        entry.flags.push("no voice take yet — run table_read");
        continue;
      }
      const file = path.join(dataRoot, take.asset);
      if (!fs.existsSync(file)) {
        entry.flags.push(`take file missing on disk: ${take.asset}`);
        continue;
      }
      const probe = await probeMedia(file).catch(() => null);
      entry.durationSec = probe?.duration ?? null;
      if (!entry.durationSec) {
        entry.flags.push("could not measure the take — unreadable file");
        continue;
      }
      const rate = speechRateFlag(entry.text.length, entry.durationSec);
      if (rate) entry.flags.push(rate);
      const pcm = await decodeMono16k(file).catch(() => null);
      if (!pcm) {
        entry.flags.push("could not decode audio for analysis");
        continue;
      }
      const m = measureVoice(pcm, 16000);
      entry.f0Hz = m.f0Hz === null ? null : Math.round(m.f0Hz * 10) / 10;
      entry.voicedRatio = Math.round(m.voicedRatio * 100) / 100;
      entry.rmsDb = Math.round(m.rmsDb * 10) / 10;
      entry.peakDb = Math.round(m.peakDb * 10) / 10;
      if (m.voicedRatio < 0.05 || m.rmsDb < -45) {
        entry.flags.push(`effectively silent (rms ${m.rmsDb.toFixed(1)} dB, ${(m.voicedRatio * 100).toFixed(0)}% voiced)`);
      } else if (m.peakDb > -0.3) {
        entry.flags.push(`peaks at ${m.peakDb.toFixed(1)} dB — clipping`);
      }
      if (m.f0Hz !== null && line.character) {
        const list = byCharacter.get(line.character) ?? [];
        list.push({ id: line.id, f0Hz: m.f0Hz });
        byCharacter.set(line.character, list);
      }
    }
  }

  const f0Flags = f0ConsistencyFlags(
    [...byCharacter.entries()].map(([character, takes]) => ({ character, takes })),
  );
  for (const f of f0Flags) {
    const line = lines.find((l) => l.lineId === f.takeId);
    if (line) line.flags.push(f.detail);
  }

  const characters = [...byCharacter.entries()].map(([id, takes]) => {
    const sorted = takes.map((t) => t.f0Hz).sort((a, b) => a - b);
    return {
      character: bible.characters.find((c) => c.id === id)?.name ?? id,
      medianF0Hz: sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)]) : null,
      takes: takes.length,
    };
  });

  const retakeLineIds = lines
    .filter((l) => l.takeId && l.flags.length > 0)
    .map((l) => l.lineId);
  const unvoiced = lines.filter((l) => !l.takeId).length;
  if (unvoiced) notes.push(`${unvoiced} line(s) have no take yet — table_read the scene first.`);

  const verdict: QcSceneVoicesReport["verdict"] =
    retakeLineIds.length || unvoiced ? (lines.some((l) => l.takeId && l.flags.length) ? "fail" : "review") : "pass";

  return { sceneId: scene.id, verdict, lines, characters, retakeLineIds, notes };
}
