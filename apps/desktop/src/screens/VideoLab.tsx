import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  AudioLines,
  Check,
  Film,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  CornerDownLeft,
  Download,
  FileText,
  Grid2x2,
  Grid3x3,
  HelpCircle,
  ImageOff,
  LayoutPanelTop,
  Lightbulb,
  ListPlus,
  Maximize2,
  Minimize2,
  Monitor,
  MoreVertical,
  Pause,
  Play,
  RefreshCw,
  Replace,
  Scissors,
  Search,
  Settings2,
  Sparkles,
  Star,
  Timer,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
  Wand2,
  Waypoints,
  X,
} from "lucide-react";
import {
  composeZonePrompt,
  sheetLayout,
  type DirectorRef,
  type DirectorSpec,
} from "@aurea/shared";
import { downloadAsset, useJobs, useLikes, useRemoveAssets, useSendToTimeline, useVideoLab } from "@/hooks";
import type { VideoStage, VideoTake } from "@/data/sample";
import { Chip, GoldButton, Progress, cx } from "@/components/ui";
import { useVideoPlayer, type VideoPlayer } from "@/components/useVideoPlayer";

/* Video gen — UI-Design/videogen lab.jpg. Keyframe-driven i2v: prompt + start
 * frame + engine choice (LTX-2 local free / Seedance API with a cost estimate
 * up front) on the left, preview + takes in the center, staged job progress on
 * the right. Data flows through useVideoLab (tRPC seam). */

function PanelLabel({ children, hint }: { children: React.ReactNode; hint?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">{children}</h3>
      {hint && <HelpCircle size={12} className="text-fog/50" />}
    </div>
  );
}

function Select({
  icon: Icon,
  value,
  options,
  onChange,
}: {
  icon: typeof Timer;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-xl border border-cream/10 bg-surface px-3 py-2 text-[11px] text-cream/85 transition hover:border-gold/35"
      >
        <Icon size={12} className="shrink-0 text-gold/80" />
        <span className="flex-1 truncate text-left tabular-nums">{value}</span>
        <ChevronDown
          size={11}
          className={cx("shrink-0 text-fog transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-cream/12 bg-raised shadow-xl">
          {options.map((o) => (
            <button
              key={o}
              onClick={() => {
                onChange(o);
                setOpen(false);
              }}
              className={cx(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] tabular-nums transition hover:bg-cream/5",
                o === value ? "text-gold" : "text-cream/85",
              )}
            >
              <span className="w-3">{o === value && <Check size={11} />}</span>
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A Director keyframe beyond the start frame: a library still pinned to a
 * time, with how hard LTX is asked to hold it. */
interface DirectorKeyframe {
  image: string;
  atSec: number;
  strength: number;
}

/** A prompt beat: what changes at this point in the take, optionally shot with
 * a camera the bank already has language for. The camera ids stay separate
 * from the typed line until submit, so the pickers survive an edit. */
interface DirectorBeat {
  text: string;
  lengthSec: number;
  shot: string;
  move: string;
}

/** A voice take on the audio lane: a library clip locked to a timecode, which
 * is what LTX lip-syncs to. `trimStartSec` skips a lead-in the take doesn't
 * need — the line starts when the character starts speaking, not when the file
 * does. */
interface DirectorTake {
  take: string;
  atSec: number;
  trimStartSec: number;
}

/** A motion reference: an existing clip whose movement drives this shot through
 * an IC-LoRA. `atSec`/`lengthSec` are where its motion applies inside the shot,
 * `trimStartSec` which part of the reference is used. */
interface DirectorMotion {
  video: string;
  atSec: number;
  lengthSec: number;
  trimStartSec: number;
  icLora: "union" | "motionTrack";
  strength: number;
  useItsAudio: boolean;
}

/** A retake in progress: a finished take with a window marked for re-render.
 * Lives on the screen rather than the params panel because it's marked out on
 * the preview player's scrub bar and rendered from the left panel. */
interface RetakeDraft {
  source: string;
  label: string;
  atSec: number;
  lengthSec: number;
  prompt: string;
  strength: number;
  regenerateAudio: boolean;
}

/** A shot arriving from the Storyboard's "Send to Director": the composed spec
 * (studio.board.shotSpec), plus what the panel needs to say where it came from
 * and where the finished take goes back to. `sentAt` is what makes a second
 * send of the same shot re-seed the panel. */
export interface ShotPrefill {
  shotId: string;
  title: string;
  sentAt: number;
  prompt: string;
  startFrame: string | null;
  durationSec: number;
  director: DirectorSpec;
  notes: string[];
}

/** Shortest retake worth queuing. Under a latent frame (stride 8, so a third of
 * a second at 24fps) the freed window rounds away to nothing and the render
 * comes back as the original. */
const MIN_RETAKE_SEC = 8 / 24;

/** The catalog offers a fixed ladder of lengths, so a composed shot lands on
 * the shortest one that still holds it (never shorter — a cut-off last line is
 * worse than a second of air). */
function snapDuration(sec: number, ladder: string[], fallback: string): string {
  const fits = ladder.filter((d) => parseInt(d) >= sec);
  return fits[0] ?? ladder[ladder.length - 1] ?? fallback;
}

const fmtTime = (sec: number) => `${sec.toFixed(1)}s`;
const clampSec = (sec: number, max: number) =>
  Math.min(max, Math.max(0, Number.isFinite(sec) ? sec : 0));

/** The relay quantises beats to latent frames (stride 8), so a beat under 8
 * pixel frames can't get one of its own — at 24fps that's a third of a second. */
const MIN_BEAT_SEC = 8 / 24;

/** How much open air on the audio lane before LTX starts improvising into it.
 * Measured 2026-07-25 on the breakroom two-shot: 0.7s holes came back silent,
 * a 2.7s hole came back as invented speech with matching mouth movement. */
const IMPROV_GAP_SEC = 1.5;

/** Two of these sit side by side in a 280px panel, so a shot size shows as the
 * bank's abbreviation ("WS — wide / full shot" → "WS") — which is what the
 * clause is called on set anyway. Moves have no abbreviation and read fine as
 * written. The full description rides along as the option's tooltip. */
const shortName = (name: string) =>
  name.includes("—") ? name.split("—")[0].trim() : name.trim();

/* pr-4 keeps a long entry name from running under the native chevron;
 * truncate ellipses whatever still overflows */
/* no width here on purpose — each caller sets its own, and a `w-full` left in
 * the shared string would fight the narrow shot-size picker */
const selectInput =
  "truncate rounded-md border border-cream/10 bg-ink py-1 pl-1.5 pr-4 text-[10px] " +
  "text-cream outline-none focus:border-gold/40";

/** A cinematography-bank picker. Values are bank ids ("ws", "push-in"); empty
 * means the beat says nothing about the camera and LTX keeps the last one. */
function BankSelect({
  value,
  placeholder,
  entries,
  onChange,
  className,
}: {
  value: string;
  placeholder: string;
  entries: { id: string; name: string; use: string }[];
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ colorScheme: "dark" }}
      title={entries.find((e) => e.id === value)?.use ?? placeholder}
      className={cx(selectInput, className ?? "min-w-0 flex-1", !value && "text-fog/70")}
    >
      <option value="">{placeholder}</option>
      {entries.map((e) => (
        <option key={e.id} value={e.id} title={e.use}>
          {shortName(e.name)}
        </option>
      ))}
    </select>
  );
}

/** How long each take runs. Nothing on disk records it — the library scans
 * files, it doesn't ffprobe them — and the lane can't lay a take out without
 * it, so the browser loads the metadata (not the audio) and we remember what
 * it said. A take that fails to load is remembered as 0 so it's asked once,
 * and shows on the lane as a marker rather than a block. */
function useTakeDurations(sources: { relPath: string; url?: string }[]) {
  const [known, setKnown] = useState<Record<string, number>>({});
  const asked = useRef(new Set<string>());
  useEffect(() => {
    for (const s of sources) {
      if (!s.url || asked.current.has(s.relPath)) continue;
      asked.current.add(s.relPath);
      const el = new Audio();
      el.preload = "metadata";
      const record = (sec: number) => setKnown((k) => ({ ...k, [s.relPath]: sec }));
      el.addEventListener("loadedmetadata", () =>
        record(Number.isFinite(el.duration) ? el.duration : 0),
      );
      el.addEventListener("error", () => record(0));
      el.src = s.url;
    }
  }, [sources]);
  return known;
}

/** The audio lane — the cast's real voices at exact timecodes.
 *
 * Each take is locked where it's placed (LTX lip-syncs to it and cannot
 * overwrite it); everything between takes is left free for the model to score.
 * Overlapping takes are mixed together rather than one replacing the other,
 * which is how two characters end up talking over each other on purpose.
 *
 * What the model does with the free air was measured on the 07-25 breakroom
 * runs and is not what "room tone" suggests: sub-second holes came back
 * silent, and a 2.7s hole came back as *invented dialogue* — audio and moving
 * mouth both. Hence the warning below rather than a promise of ambience. */
function AudioLane({
  sources,
  lane,
  setLane,
  durationSec,
  roomTone,
  setRoomTone,
}: {
  sources: { relPath: string; name: string; url?: string }[];
  lane: DirectorTake[];
  setLane: (fn: (l: DirectorTake[]) => DirectorTake[]) => void;
  durationSec: number;
  roomTone: boolean;
  setRoomTone: (v: boolean) => void;
}) {
  const [picking, setPicking] = useState(false);
  const durations = useTakeDurations(sources);
  const nameOf = (rel: string) => sources.find((s) => s.relPath === rel)?.name ?? rel.split("/").pop();

  /* where each take actually lands, mirroring fitAudio() in the builder: a
   * take is cut off at the end of the shot, and one placed past the end never
   * plays at all */
  const blocks = lane.map((t) => {
    const full = durations[t.take];
    const heard = full === undefined ? undefined : Math.max(0, full - t.trimStartSec);
    const room = Math.max(0, durationSec - t.atSec);
    return {
      start: t.atSec,
      length: heard === undefined ? undefined : Math.min(heard, room),
      clipped: heard !== undefined && heard > room + 0.05,
      lost: t.atSec >= durationSec,
      unknown: heard === undefined || heard === 0,
    };
  });
  const overlapping = blocks.some((b, i) =>
    blocks.some(
      (o, j) =>
        j !== i &&
        b.length !== undefined &&
        o.length !== undefined &&
        b.start < o.start + o.length &&
        o.start < b.start + b.length,
    ),
  );
  /* What LTX is left to score. Measured off the union of the takes, not their
   * sum, so a deliberate talk-over doesn't read as double the dialogue — and
   * the LONGEST single hole matters on its own, because that's the one the
   * model improvises into (see the warning below). */
  const { gap, longestGap } = (() => {
    const taken = blocks
      .filter((b) => !b.lost && b.length)
      .map((b) => ({ from: b.start, to: b.start + b.length! }))
      .sort((a, b) => a.from - b.from);
    let covered = 0;
    let end = 0;
    let longest = 0;
    for (const r of taken) {
      if (r.from > end) longest = Math.max(longest, r.from - end);
      covered += Math.max(0, r.to - Math.max(end, r.from));
      end = Math.max(end, r.to);
    }
    longest = Math.max(longest, durationSec - end);
    return { gap: Math.max(0, durationSec - covered), longestGap: longest };
  })();

  return (
    <div className="relative mt-3 border-t hairline pt-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">
          Audio lane
        </h4>
        <button
          onClick={() => setPicking((p) => !p)}
          className="inline-flex items-center gap-1 text-[10px] text-fog transition hover:text-gold"
        >
          <AudioLines size={10} /> Add take
        </button>
      </div>

      {lane.length === 0 && !picking ? (
        <p className="mt-1.5 text-[10px] leading-relaxed text-fog/70">
          The shot scores itself. Add voice takes to lock dialogue to exact timecodes — each
          character lip-syncs their own line, in one continuous render.
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {/* the shot ruler: gold where a take is locked, dark where LTX is free */}
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-cream/8">
            {blocks.map((b, i) =>
              b.lost ? null : (
                <div
                  key={i}
                  title={nameOf(lane[i].take)}
                  style={{
                    left: `${(b.start / Math.max(durationSec, 0.1)) * 100}%`,
                    width: b.length ? `${(b.length / Math.max(durationSec, 0.1)) * 100}%` : "2px",
                  }}
                  className={cx(
                    "absolute inset-y-0 rounded-full",
                    b.unknown ? "bg-gold/50" : i % 2 ? "bg-gold/60" : "bg-gold/90",
                  )}
                />
              ),
            )}
          </div>

          {lane.map((t, i) => (
            <div
              key={`${t.take}-${i}`}
              className={cx(
                "flex items-center gap-2 rounded-xl border bg-surface px-2.5 py-1.5",
                blocks[i].lost ? "border-red-500/30" : "border-cream/10",
              )}
            >
              <input
                type="number"
                min={0}
                max={durationSec}
                step={0.1}
                value={t.atSec}
                title="When this line starts"
                onChange={(e) =>
                  setLane((l) =>
                    l.map((x, j) =>
                      j === i ? { ...x, atSec: clampSec(Number(e.target.value), durationSec) } : x,
                    ),
                  )
                }
                className="w-10 shrink-0 bg-transparent text-[10px] tabular-nums text-gold focus:outline-none"
              />
              <span className="min-w-0 flex-1 truncate text-[11px] text-cream/85">
                {nameOf(t.take)}
              </span>
              <span className="shrink-0 text-[9px] tabular-nums text-fog/60">
                {blocks[i].length !== undefined ? fmtTime(blocks[i].length!) : "…"}
              </span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={t.trimStartSec}
                title="Skip this far into the take before it plays"
                onChange={(e) =>
                  setLane((l) =>
                    l.map((x, j) =>
                      j === i
                        ? { ...x, trimStartSec: Math.max(0, Number(e.target.value) || 0) }
                        : x,
                    ),
                  )
                }
                // the spinner arrows eat half of a control this narrow
                className="w-9 shrink-0 rounded-md border border-cream/10 bg-ink px-1 py-0.5 text-[10px] tabular-nums text-cream/70 outline-none [appearance:textfield] focus:border-gold/40 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <button
                onClick={() => setLane((l) => l.filter((_, j) => j !== i))}
                className="shrink-0 text-fog/60 transition hover:text-red-400"
              >
                <X size={12} />
              </button>
            </div>
          ))}

          {/* room tone — what happens in the silence between the lines */}
          <label className="flex cursor-pointer items-center gap-2 pt-0.5">
            <input
              type="checkbox"
              checked={roomTone}
              onChange={(e) => setRoomTone(e.target.checked)}
              className="accent-gold"
            />
            <span className="text-[10px] text-fog">Score the gaps ({fmtTime(gap)})</span>
          </label>

          {blocks.some((b) => b.lost) ? (
            <p className="text-[10px] leading-relaxed text-red-300">
              A take starts after the shot ends — it never plays. Move it earlier or make the clip
              longer.
            </p>
          ) : blocks.some((b) => b.clipped) ? (
            <p className="text-[10px] leading-relaxed text-gold/75">
              A take runs past the end of the shot and gets cut off mid-line. Lengthen the clip, or
              trim the take's lead-in.
            </p>
          ) : overlapping ? (
            <p className="text-[10px] leading-relaxed text-gold/75">
              Two takes overlap — they'll be heard together. Fine for a talk-over, otherwise move
              one along.
            </p>
          ) : roomTone && longestGap > IMPROV_GAP_SEC ? (
            // measured 07-25: a 2.7s hole came back as invented speech with the
            // mouth movement to match, while sub-second holes stayed silent
            <p className="text-[10px] leading-relaxed text-gold/75">
              {fmtTime(longestGap)} of open air with scoring on — LTX tends to improvise dialogue
              into a gap this long, lip-sync and all. Turn scoring off and lay room tone on the
              Timeline instead.
            </p>
          ) : (
            <p className="text-[10px] leading-relaxed text-fog/70">
              {roomTone
                ? "Locked lines drive lip-sync. Short gaps between them come back near-silent, which is usually what a scene wants."
                : "Gaps stay silent — nothing is generated between the lines."}
            </p>
          )}
        </div>
      )}

      {picking && (
        <div className="absolute inset-x-0 top-7 z-10 max-h-44 overflow-y-auto rounded-xl border border-cream/12 bg-raised shadow-xl">
          {sources.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-fog">
              No voice takes yet — generate one in the Voice lab.
            </p>
          )}
          {sources.map((a) => (
            <button
              key={a.relPath}
              onClick={() => {
                // land it after whatever's already down, so takes queue up as
                // dialogue rather than stacking on top of each other at zero
                const after = lane.reduce(
                  (end, t) =>
                    Math.max(end, t.atSec + Math.max(0, (durations[t.take] ?? 1) - t.trimStartSec)),
                  0,
                );
                setLane((l) => [
                  ...l,
                  { take: a.relPath, atSec: clampSec(after, durationSec), trimStartSec: 0 },
                ]);
                setPicking(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-cream/85 transition hover:bg-cream/5"
            >
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              {durations[a.relPath] ? (
                <span className="shrink-0 text-[9px] tabular-nums text-fog/60">
                  {fmtTime(durations[a.relPath])}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The motion lane — an existing clip's movement, transferred onto this shot.
 *
 * LTX reads the reference through an IC-LoRA rather than as a keyframe: the
 * shot keeps its own cast and set (the keyframes above), and takes the
 * reference's movement. Two weights are on disk and they behave differently —
 * motion-track follows the reference's movement closely (a dance, a specific
 * gesture), union-control takes its staging more loosely. */
function MotionLane({
  sources,
  motion,
  setMotion,
  durationSec,
  available,
  note,
}: {
  sources: { relPath: string; name: string }[];
  motion: DirectorMotion | null;
  setMotion: (m: DirectorMotion | null) => void;
  durationSec: number;
  available: boolean;
  note?: string;
}) {
  const [picking, setPicking] = useState(false);
  const nameOf = (rel: string) =>
    sources.find((s) => s.relPath === rel)?.name ?? rel.split("/").pop();
  const patch = (p: Partial<DirectorMotion>) => motion && setMotion({ ...motion, ...p });

  return (
    <div className="relative mt-3 border-t hairline pt-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">
          Motion reference
        </h4>
        {available && (
          <button
            onClick={() => (motion ? setMotion(null) : setPicking((p) => !p))}
            className="inline-flex items-center gap-1 text-[10px] text-fog transition hover:text-gold"
          >
            {motion ? (
              <>
                <X size={10} /> Remove
              </>
            ) : (
              <>
                <Waypoints size={10} /> Add reference
              </>
            )}
          </button>
        )}
      </div>

      {!available ? (
        <p className="mt-1.5 text-[10px] leading-relaxed text-fog/70">
          {note ??
            "Motion transfer needs an LTX IC-LoRA in your ComfyUI's loras folder — " +
              "ltx-2.3-22b-ic-lora-motion-track-control or -union-control."}
        </p>
      ) : !motion ? (
        <p className="mt-1.5 text-[10px] leading-relaxed text-fog/70">
          Point at a clip and this shot borrows its movement — a dance, a gesture, a camera
          push — while keeping its own cast and set.
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2 rounded-xl border border-cream/10 bg-surface px-2.5 py-1.5">
            <button
              onClick={() => setPicking((p) => !p)}
              title="Choose a different reference"
              className="min-w-0 flex-1 truncate text-left text-[11px] text-cream/85 transition hover:text-gold"
            >
              {nameOf(motion.video)}
            </button>
            <span className="shrink-0 text-[9px] uppercase tracking-wider text-fog/60">ref</span>
          </div>

          <select
            value={motion.icLora}
            onChange={(e) => patch({ icLora: e.target.value as DirectorMotion["icLora"] })}
            style={{ colorScheme: "dark" }}
            className={cx(selectInput, "w-full")}
          >
            <option value="motionTrack">Track its movement (close)</option>
            <option value="union">Follow its staging (loose)</option>
          </select>

          <div className="flex items-center gap-1.5">
            {(
              [
                ["at", "atSec", "When its motion starts in the shot"],
                ["len", "lengthSec", "How long it drives"],
                ["skip", "trimStartSec", "Skip this far into the reference"],
              ] as const
            ).map(([label, key, title]) => (
              <div
                key={key}
                title={title}
                className="flex min-w-0 flex-1 items-center gap-1 rounded-md border border-cream/10 bg-ink px-1.5 py-1"
              >
                <span className="shrink-0 text-[9px] uppercase tracking-wider text-fog/60">
                  {label}
                </span>
                <input
                  type="number"
                  min={0}
                  max={key === "trimStartSec" ? undefined : durationSec}
                  step={0.5}
                  value={motion[key]}
                  onChange={(e) =>
                    patch({
                      [key]:
                        key === "trimStartSec"
                          ? Math.max(0, Number(e.target.value) || 0)
                          : clampSec(Number(e.target.value), durationSec),
                    } as Partial<DirectorMotion>)
                  }
                  className="w-full min-w-0 bg-transparent text-[10px] tabular-nums text-gold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[10px] text-fog">Strength</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={motion.strength}
              onChange={(e) => patch({ strength: Number(e.target.value) })}
              className="min-w-0 flex-1 accent-gold"
            />
            <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-gold">
              {motion.strength.toFixed(2)}
            </span>
          </div>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={motion.useItsAudio}
              onChange={(e) => patch({ useItsAudio: e.target.checked })}
              className="accent-gold"
            />
            <span className="text-[10px] text-fog">Take its audio too</span>
          </label>
          {motion.useItsAudio && (
            <p className="text-[10px] leading-relaxed text-gold/75">
              The reference's soundtrack replaces the audio lane for this shot.
            </p>
          )}
        </div>
      )}

      {picking && available && (
        <div className="absolute inset-x-0 top-7 z-10 max-h-44 overflow-y-auto rounded-xl border border-cream/12 bg-raised shadow-xl">
          {sources.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-fog">
              No video in the library yet — render a take first.
            </p>
          )}
          {sources.map((s) => (
            <button
              key={s.relPath}
              onClick={() => {
                // swapping the reference keeps the timings already dialled in
                setMotion({
                  atSec: 0,
                  lengthSec: durationSec,
                  trimStartSec: 0,
                  icLora: "motionTrack",
                  strength: 1,
                  useItsAudio: false,
                  ...(motion ?? {}),
                  video: s.relPath,
                });
                setPicking(false);
              }}
              className="flex w-full items-center px-3 py-2 text-left text-[11px] text-cream/85 transition hover:bg-cream/5"
            >
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The cast lane — who this shot is about, whether or not they're in the start
 * frame.
 *
 * LTX takes references as one reference SHEET plus prose naming each cell, so
 * what's authored here is a list and what's rendered is a grid: the label beside
 * each row ("Top Row Left") is the cell it lands in, and the same words go into
 * the prompt. A character picked from the Bible brings its own description —
 * species, wardrobe, identity anchors — so the sheet says what the character
 * sheets already say.
 *
 * Gated twice over, because it needs a pack update AND a gated download: with
 * either missing the section explains itself and stays closed rather than
 * queuing a render that dies in ComfyUI. */
function CastLane({
  refs,
  setRefs,
  cast,
  sets,
  frames,
  strength,
  setStrength,
  available,
  note,
  blocked,
}: {
  refs: DirectorRef[];
  setRefs: (fn: (r: DirectorRef[]) => DirectorRef[]) => void;
  cast: { id: string; name: string; ref: DirectorRef }[];
  sets: { id: string; name: string; ref: DirectorRef }[];
  frames: { relPath: string; name: string; url?: string }[];
  strength: number;
  setStrength: (v: number) => void;
  available: boolean;
  note?: string;
  /** set when a motion reference already owns the IC-LoRA slot */
  blocked?: string;
}) {
  const [picking, setPicking] = useState(false);
  const layout = sheetLayout(refs.length);
  const full = refs.length >= 6;
  const add = (ref: DirectorRef) => {
    setRefs((r) => (r.length >= 6 ? r : [...r, ref]));
    setPicking(false);
  };
  const patch = (i: number, p: Partial<DirectorRef>) =>
    setRefs((r) => r.map((ref, j) => (j === i ? { ...ref, ...p } : ref)));
  const thumb = (rel: string) => frames.find((f) => f.relPath === rel)?.url;

  return (
    <div className="relative mt-3 border-t hairline pt-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">
          Cast references
        </h4>
        {available && !blocked && !full && (
          <button
            onClick={() => setPicking((p) => !p)}
            className="inline-flex items-center gap-1 text-[10px] text-fog transition hover:text-gold"
          >
            <ListPlus size={10} /> Add
          </button>
        )}
      </div>

      {!available ? (
        <p className="mt-1.5 text-[10px] leading-relaxed text-fog/70">
          {note ??
            "Cast references need WhatDreamsCost-ComfyUI v2.0.4+ and the LTX Ingredients " +
              "IC-LoRA (ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors, a gated download " +
              "from huggingface.co/Lightricks) in your ComfyUI's loras folder."}
        </p>
      ) : blocked ? (
        <p className="mt-1.5 text-[10px] leading-relaxed text-fog/70">{blocked}</p>
      ) : refs.length === 0 ? (
        <p className="mt-1.5 text-[10px] leading-relaxed text-fog/70">
          Name the cast and LTX holds them on-model through the whole take — including
          characters who never appear in the start frame.
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {refs.map((ref, i) => (
            <div
              key={`${ref.image}-${i}`}
              className="space-y-1.5 rounded-xl border border-cream/10 bg-surface p-2"
            >
              <div className="flex items-center gap-2">
                {thumb(ref.image) ? (
                  <img
                    src={thumb(ref.image)}
                    alt=""
                    draggable={false}
                    className="h-7 w-7 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <div className="h-7 w-7 shrink-0 rounded-md bg-cream/5" />
                )}
                <input
                  value={ref.name}
                  onChange={(e) => patch(i, { name: e.target.value })}
                  placeholder="Name"
                  className="min-w-0 flex-1 bg-transparent text-[11px] text-cream/85 outline-none placeholder:text-fog/60"
                />
                <select
                  value={ref.kind}
                  onChange={(e) => patch(i, { kind: e.target.value as DirectorRef["kind"] })}
                  style={{ colorScheme: "dark" }}
                  className={cx(selectInput, "w-[74px]")}
                >
                  <option value="character">Character</option>
                  <option value="prop">Prop</option>
                  <option value="setting">Setting</option>
                </select>
                <button
                  onClick={() => setRefs((r) => r.filter((_, j) => j !== i))}
                  title="Remove"
                  className="shrink-0 text-fog transition hover:text-red-300"
                >
                  <X size={11} />
                </button>
              </div>
              <textarea
                value={ref.description}
                onChange={(e) => patch(i, { description: e.target.value })}
                rows={2}
                placeholder="What must stay true — build, wardrobe, markings"
                className="w-full resize-none rounded-md border border-cream/10 bg-ink p-1.5 text-[10px] leading-relaxed text-cream/85 outline-none placeholder:text-fog/60 focus:border-gold/40"
              />
              <div className="text-[9px] uppercase tracking-wider text-fog/60">
                {layout.cells[i]?.label}
              </div>
            </div>
          ))}

          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[10px] text-fog">Hold</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={strength}
              onChange={(e) => setStrength(Number(e.target.value))}
              className="min-w-0 flex-1 accent-gold"
            />
            <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-gold">
              {strength.toFixed(2)}
            </span>
          </div>
          <p className="text-[10px] leading-relaxed text-fog/70">
            {refs.length} on a {layout.cols === 1 ? "single-cell" : `${layout.cols}×${layout.rows}`}{" "}
            sheet — the descriptions go in front of the shot prompt, so keep each to a line or two.
          </p>
        </div>
      )}

      {picking && available && !blocked && (
        <div className="absolute inset-x-0 top-7 z-10 max-h-52 overflow-y-auto rounded-xl border border-cream/12 bg-raised shadow-xl">
          {cast.length > 0 && <PickerHeading>From the Bible</PickerHeading>}
          {cast.map((c) => (
            <button
              key={c.id}
              onClick={() => add(c.ref)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-cream/85 transition hover:bg-cream/5"
            >
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="shrink-0 text-[9px] uppercase tracking-wider text-fog/60">cast</span>
            </button>
          ))}
          {sets.map((s) => (
            <button
              key={s.id}
              onClick={() => add(s.ref)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-cream/85 transition hover:bg-cream/5"
            >
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="shrink-0 text-[9px] uppercase tracking-wider text-fog/60">set</span>
            </button>
          ))}
          <PickerHeading>From the library</PickerHeading>
          {frames.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-fog">No stills in the library yet.</p>
          )}
          {frames.slice(0, 30).map((f) => (
            <button
              key={f.relPath}
              onClick={() =>
                add({ image: f.relPath, name: "", kind: "character", description: "" })
              }
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-cream/85 transition hover:bg-cream/5"
            >
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PickerHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky top-0 bg-raised px-3 py-1 text-[9px] uppercase tracking-wider text-fog/60">
      {children}
    </div>
  );
}

/* ---------- left panel: params ---------- */

function ParamsPanel({
  prefill,
  retake,
  setRetake,
}: {
  /** a shot sent over from the Storyboard; the panel is keyed on it, so every
   * piece of state below can seed from it in its initializer */
  prefill: ShotPrefill | null;
  retake: RetakeDraft | null;
  setRetake: (r: RetakeDraft | null) => void;
}) {
  const lab = useVideoLab();
  const [prompt, setPrompt] = useState(prefill?.prompt ?? lab.prompt);
  const [engineId, setEngineId] = useState(lab.engines[0].id);
  const [duration, setDuration] = useState(() =>
    prefill ? snapDuration(prefill.durationSec, lab.durations, lab.duration) : lab.duration,
  );
  const [resolution, setResolution] = useState(lab.resolution);
  const [motion, setMotion] = useState(lab.motionStrength);
  /** null = the default (newest library still); set by the Replace picker */
  const [frameRel, setFrameRel] = useState<string | null>(prefill?.startFrame ?? null);
  /** null = closed. "start" retargets the start frame; a number retargets that
   * Director keyframe — one picker, two jobs. */
  const [picking, setPicking] = useState<"start" | number | null>(null);
  const pickerOpen = picking !== null;
  /** Shot Director: extra keyframes beyond the start frame, in seconds */
  const [directorOn, setDirectorOn] = useState(!!prefill);
  const [keyframes, setKeyframes] = useState<DirectorKeyframe[]>(
    // keyframe 0 IS the start frame here, and the panel puts it back at submit
    prefill ? prefill.director.keyframes.filter((k) => k.atSec > 0) : [],
  );
  /** prompt beats — the shot's phrasing over time; empty = one prompt throughout */
  const [beats, setBeats] = useState<DirectorBeat[]>(
    // a composed beat arrives already expanded (the storyboard resolved the
    // camera ids), so its pickers stay empty rather than expanding it twice
    prefill
      ? prefill.director.promptZones.map((z) => ({
          text: z.prompt,
          lengthSec: z.lengthSec,
          shot: z.shot,
          move: z.move,
        }))
      : [],
  );
  /** how hard a beat boundary lands: 0.001 a cut, 0.5 a dissolve */
  const [blend, setBlend] = useState(prefill?.director.epsilon ?? 0.001);
  /** optional dialogue take — switches the render to ia2v lip-sync */
  const [audioRel, setAudioRel] = useState<string | null>(null);
  const [audioOpen, setAudioOpen] = useState(false);
  /** Director audio lane: voice takes locked to timecodes. The simple path's
   * single take is the one-segment case of this, so turning the Director on
   * carries it onto the lane rather than dropping it. */
  const [lane, setLane] = useState<DirectorTake[]>(prefill?.director.audio ?? []);
  /** generate sound in the gaps between takes rather than leaving them silent */
  const [roomTone, setRoomTone] = useState(prefill?.director.inpaintAudio ?? true);
  /** an existing clip's movement, transferred onto this shot */
  const [motionRef, setMotionRef] = useState<DirectorMotion | null>(null);
  /** the cast this shot must stay on-model for — composed into one reference
   * sheet at render time */
  const [castRefs, setCastRefs] = useState<DirectorRef[]>(prefill?.director.refs ?? []);
  const [refStrength, setRefStrength] = useState(prefill?.director.refStrength ?? 1);

  // the dead-core fallback shape predates the live fields — narrow before use
  const chosen = frameRel ? lab.frames.find((f) => f.relPath === frameRel) : undefined;
  const defaultRel = "relPath" in lab.startFrame ? lab.startFrame.relPath : undefined;
  /* A named frame is the frame, whether or not the panel's roll (the newest 60
   * stills) happens to hold it — a shot sent over from the board can point at a
   * keyframe boarded weeks ago. Falling back to `chosen` here would silently
   * render the newest image in the library instead of the one that was asked
   * for, so only the thumbnail degrades, never the render. */
  const effectiveRel = frameRel ?? defaultRel;
  const frameName = chosen?.name ?? (frameRel ? (frameRel.split("/").pop() ?? frameRel) : lab.startFrame.name);
  const frameMeta = chosen?.meta ?? (frameRel ? "start frame" : lab.startFrame.meta);
  const frameSwatch = chosen?.swatch ?? lab.startFrame.swatch;
  const startFrameUrl =
    chosen?.url ??
    lab.stillUrl(frameRel) ??
    (frameRel ? undefined : "url" in lab.startFrame ? lab.startFrame.url : undefined);
  const canGenerate = "canGenerate" in lab ? !!effectiveRel : false;
  const audioName = audioRel
    ? (lab.audioSources.find((a) => a.relPath === audioRel)?.name ?? audioRel)
    : null;
  const durationSec = parseInt(duration) || 5;
  // Seedance renders from a single frame — the timeline is an LTX feature.
  // While the probe is still in flight (null) we leave it enabled rather than
  // flickering the control off and back on.
  const directorBlocked =
    engineId !== "ltx2" || (lab.capabilities !== null && !lab.capabilities.director);
  /** a new beat takes the time the existing ones leave over, or an even third
   * of the shot when they already fill it */
  const addBeat = () => {
    setBeats((bs) => {
      const left = durationSec - bs.reduce((s, b) => s + b.lengthSec, 0);
      const lengthSec = Math.max(MIN_BEAT_SEC, left > 0.2 ? left : durationSec / 3);
      return [...bs, { text: "", lengthSec: Math.round(lengthSec * 10) / 10, shot: "", move: "" }];
    });
  };
  /** default a new keyframe to the newest still the user hasn't used yet */
  const addKeyframe = (atSec: number) => {
    const used = new Set([effectiveRel, ...keyframes.map((k) => k.image)]);
    const next = lab.frames.find((f) => !used.has(f.relPath)) ?? lab.frames[0];
    if (!next) return;
    setKeyframes((ks) =>
      [...ks, { image: next.relPath, atSec: clampSec(atSec, durationSec), strength: 1 }].sort(
        (a, b) => a.atSec - b.atSec,
      ),
    );
  };
  /** Where each beat actually lands, mirroring fitZones() in the builder: beats
   * tile in order, one that starts past the end never arrives, and the last
   * surviving beat stretches to the boundary so the take is fully covered. */
  const tiling = (() => {
    let cursor = 0;
    const rows = beats.map((b) => {
      const start = cursor;
      const length = Math.max(0, Math.min(b.lengthSec, durationSec - cursor));
      cursor += length;
      return { start, length, dead: length <= 0 };
    });
    const live = rows.filter((r) => !r.dead);
    if (live.length && cursor < durationSec) live[live.length - 1].length += durationSec - cursor;
    return {
      rows,
      dead: rows.length - live.length,
      asked: beats.reduce((s, b) => s + b.lengthSec, 0),
      short: live.length > 0 && cursor < durationSec,
      flicker: live.some((r) => r.length < MIN_BEAT_SEC),
    };
  })();

  /** the typed line plus whatever the camera pickers say, expanded through the
   * bank here — the render path takes these prompts verbatim */
  const promptZones = beats
    .map((b) => ({
      // a beat left blank still owns its slice of the take, falling back to the
      // shot prompt — dropping it would slide every later beat earlier than
      // the bar above says it lands
      prompt:
        composeZonePrompt({ prompt: b.text, shot: b.shot, move: b.move }, lab.cinematography) ||
        prompt.trim(),
      lengthSec: Math.max(0.1, b.lengthSec),
      shot: b.shot,
      move: b.move,
    }))
    .filter((z) => z.prompt.length > 0);

  /* A retake is its own kind of render: the source take is the picture
   * everywhere outside the marked window, so keyframes, beats and the audio
   * lane don't apply, and the shot's length, rate and size come off the source
   * rather than the controls above. It doesn't need the Director toggle either
   * — marking a window IS the request. */
  const retakeReady =
    retake !== null && !directorBlocked && retake.prompt.trim().length > 0
      ? retake
      : null;

  const director = retakeReady
    ? {
        globalPrompt: prompt,
        negativePrompt: prefill?.director.negativePrompt,
        fps: 24,
        keyframes: [],
        promptZones: [],
        audio: [],
        retake: {
          source: retakeReady.source,
          atSec: retakeReady.atSec,
          lengthSec: Math.max(MIN_RETAKE_SEC, retakeReady.lengthSec),
          prompt: retakeReady.prompt.trim(),
          strength: retakeReady.strength,
          regenerateAudio: retakeReady.regenerateAudio,
        },
        inpaintAudio: retakeReady.regenerateAudio,
        epsilon: blend,
      }
    : directorOn && !directorBlocked && effectiveRel
      ? {
          globalPrompt: prompt,
          // a shot from the storyboard carries the show's own negative prompt
          negativePrompt: prefill?.director.negativePrompt,
          fps: 24,
          // the start frame is always keyframe 0; the rest ride on top
          keyframes: [
            { image: effectiveRel, atSec: 0, strength: 1 },
            ...keyframes.filter((k) => k.image !== effectiveRel || k.atSec > 0),
          ],
          promptZones,
          audio: lane,
          // one IC-LoRA slot, so the cast sheet and a motion reference are
          // mutually exclusive — the lanes disable each other above, and this
          // drops the cast rather than sending a pair the core would reject
          motion: motionRef ?? undefined,
          refs: motionRef ? [] : castRefs,
          refStrength,
          inpaintAudio: roomTone,
          epsilon: blend,
        }
      : undefined;

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r hairline bg-[#0e0e10]">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {/* a shot sent over from the board — what was composed for you, and
            what the composer couldn't do on its own */}
        {prefill && (
          <section className="rounded-xl border border-gold/25 bg-gold/5 px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-gold">
              <LayoutPanelTop size={11} /> From the storyboard
            </div>
            <p className="mt-1 text-[11px] leading-snug text-cream/90">
              {prefill.title || prefill.shotId}
            </p>
            <p className="mt-0.5 text-[9px] leading-relaxed text-fog/80">
              Beats, cast and the audio lane are composed below — edit anything. The finished take
              lands back on the shot.
            </p>
            {prefill.notes.map((n) => (
              <p key={n} className="mt-1.5 text-[9px] leading-relaxed text-gold/75">
                {n}
              </p>
            ))}
          </section>
        )}

        {/* 1 · prompt */}
        <section>
          <div className="flex items-center justify-between">
            <PanelLabel>1 · Prompt</PanelLabel>
            <button className="inline-flex items-center gap-1 rounded-full bg-gold/12 px-2 py-0.5 text-[10px] font-medium text-gold transition hover:bg-gold/20">
              <Wand2 size={10} /> Magic prompt
            </button>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value.slice(0, lab.promptMax))}
            rows={5}
            className="mt-2 w-full resize-none rounded-xl border border-cream/10 bg-surface p-3 text-[12px] leading-relaxed text-cream placeholder:text-fog focus:border-gold/40 focus:outline-none"
            placeholder="Describe the shot…"
          />
          <div className="mt-1 text-right text-[10px] tabular-nums text-fog/70">
            {prompt.length} / {lab.promptMax}
          </div>
        </section>

        {/* 2 · start frame */}
        <section>
          <div className="flex items-center justify-between">
            <PanelLabel>2 · Start frame (keyframe)</PanelLabel>
            <button
              onClick={() => setPicking("start")}
              className="inline-flex items-center gap-1 text-[10px] text-fog transition hover:text-gold"
            >
              <Replace size={10} /> Replace
            </button>
          </div>
          <button
            onClick={() => setPicking("start")}
            title="Choose a different start frame"
            className="group relative mt-2 block aspect-video w-full overflow-hidden rounded-xl border border-cream/10 text-left transition hover:border-gold/40"
          >
            <div className={cx("absolute inset-0", frameSwatch)} />
            {startFrameUrl ? (
              <img
                src={startFrameUrl}
                alt=""
                draggable={false}
                className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
              />
            ) : (
              <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_30%,rgba(237,234,228,0.07),transparent_60%)]" />
            )}
            {/* the thumbnail is small by necessity — say where the big view is */}
            <div className="absolute inset-0 flex items-center justify-center bg-ink/45 opacity-0 backdrop-blur-[1px] transition group-hover:opacity-100">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-cream/95 px-3 py-1 text-[10px] font-medium text-ink">
                <Maximize2 size={10} /> Browse stills
              </span>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/85 to-transparent px-2.5 pb-2 pt-5">
              <div className="truncate text-[11px] text-cream/90">{frameName}</div>
              <div className="text-[10px] text-fog">
                {frameMeta}
                {!frameRel && " · newest still (default)"}
              </div>
            </div>
          </button>
        </section>

        {/* 2b · dialogue audio (optional — ia2v lip-sync) */}
        <section>
          <PanelLabel hint>2b · Dialogue audio (optional)</PanelLabel>
          {retake ? (
            <p className="mt-1.5 text-[10px] leading-relaxed text-fog/70">
              A retake keeps the sound of the take it's fixing — nothing to attach here.
            </p>
          ) : directorOn ? (
            <p className="mt-1.5 text-[10px] leading-relaxed text-fog/70">
              Dialogue is on the Director's audio lane below — where a line can sit at any
              timecode, and two characters can each have their own.
            </p>
          ) : (
          <>
          <div className="relative mt-2">
            {audioRel ? (
              <div className="flex items-center gap-2 rounded-xl border border-gold/30 bg-gold/6 px-3 py-2">
                <AudioLines size={13} className="shrink-0 text-gold/80" />
                <span className="min-w-0 flex-1 truncate text-[11px] text-cream/90">
                  {audioName}
                </span>
                <button
                  title="Remove audio — back to plain i2v"
                  onClick={() => setAudioRel(null)}
                  className="shrink-0 text-fog/60 transition hover:text-red-400"
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAudioOpen((o) => !o)}
                className="flex w-full items-center gap-2 rounded-xl border border-dashed border-cream/15 px-3 py-2 text-[11px] text-cream/80 transition hover:border-gold/50 hover:text-gold"
              >
                <AudioLines size={13} />
                <span className="flex-1 text-left">Attach a voice take…</span>
                <ChevronDown
                  size={11}
                  className={cx("text-fog transition-transform", audioOpen && "rotate-180")}
                />
              </button>
            )}
            {audioOpen && !audioRel && (
              <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-44 overflow-y-auto rounded-xl border border-cream/12 bg-raised shadow-xl">
                {lab.audioSources.length === 0 && (
                  <p className="px-3 py-2 text-[11px] text-fog">
                    No voice takes yet — generate one in the Voice lab.
                  </p>
                )}
                {lab.audioSources.map((a) => (
                  <button
                    key={a.relPath}
                    onClick={() => {
                      setAudioRel(a.relPath);
                      setAudioOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-cream/85 transition hover:bg-cream/5"
                  >
                    <span className="flex-1 truncate">{a.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-fog/70">
            {audioRel
              ? "Renders with LTX ia2v — the named speaker lip-syncs this audio."
              : "Attach a Voice-lab take to switch from i2v to ia2v lip-sync."}
          </p>
          </>
          )}
        </section>

        {/* 2c · Shot Director — keyframes beyond the start frame */}
        <section>
          <div className="flex items-center justify-between">
            <PanelLabel hint>2c · Shot Director</PanelLabel>
            {retake ? (
              /* the toggle would be a lie mid-retake — nothing on the timeline
               * reaches this render either way */
              <span className="inline-flex items-center gap-1 rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-medium text-gold">
                <Scissors size={10} /> Retake
              </span>
            ) : (
              <button
                onClick={() => {
                  // the take attached above is dialogue at 0s — the lane's
                  // one-segment case, so carry it over instead of losing it
                  if (!directorOn && audioRel && lane.length === 0) {
                    setLane([{ take: audioRel, atSec: 0, trimStartSec: 0 }]);
                  }
                  setDirectorOn((o) => !o);
                }}
                disabled={directorBlocked}
                className={cx(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition",
                  directorBlocked
                    ? "cursor-not-allowed bg-cream/5 text-fog/50"
                    : directorOn
                      ? "bg-gold/20 text-gold"
                      : "bg-gold/12 text-gold hover:bg-gold/20",
                )}
              >
                <Film size={10} /> {directorOn ? "On" : "Off"}
              </button>
            )}
          </div>
          {directorBlocked ? (
            <p className="mt-1.5 text-[10px] leading-relaxed text-fog/70">
              {lab.capabilities?.note ??
                "Needs a ComfyUI with the Director node pack — check Settings → Engines."}
            </p>
          ) : retake ? (
            /* a marked window takes the whole section over: nothing else on the
             * timeline reaches a retake render */
            <div className="mt-2 space-y-2">
              <div className="rounded-xl border border-gold/30 bg-gold/6 px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <Scissors size={11} className="shrink-0 text-gold/80" />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-cream/90">
                    {retake.label}
                  </span>
                  <button
                    title="Cancel the retake"
                    onClick={() => setRetake(null)}
                    className="shrink-0 text-fog/60 transition hover:text-red-400"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="mt-1 text-[10px] tabular-nums text-gold">
                  {fmtTime(retake.atSec)} → {fmtTime(retake.atSec + retake.lengthSec)} ·{" "}
                  {fmtTime(retake.lengthSec)} re-rendered
                </div>
              </div>

              <textarea
                value={retake.prompt}
                onChange={(e) => setRetake({ ...retake, prompt: e.target.value })}
                rows={3}
                placeholder="What should happen in that window instead…"
                className="w-full resize-none rounded-xl border border-cream/10 bg-surface p-2.5 text-[11px] leading-relaxed text-cream placeholder:text-fog/60 focus:border-gold/40 focus:outline-none"
              />

              <div className="flex items-center gap-2">
                <span className="shrink-0 text-[10px] text-fog">Freedom</span>
                <input
                  type="range"
                  min={0.3}
                  max={1}
                  step={0.05}
                  value={retake.strength}
                  title={`How far from the original the window may go (${retake.strength.toFixed(2)})`}
                  onChange={(e) => setRetake({ ...retake, strength: Number(e.target.value) })}
                  className="min-w-0 flex-1 accent-gold"
                />
                <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-gold">
                  {retake.strength.toFixed(2)}
                </span>
              </div>

              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={retake.regenerateAudio}
                  onChange={(e) => setRetake({ ...retake, regenerateAudio: e.target.checked })}
                  className="accent-gold"
                />
                <span className="text-[10px] text-fog">Re-render the sound too</span>
              </label>

              <p className="text-[10px] leading-relaxed text-fog/70">
                {retake.lengthSec < MIN_RETAKE_SEC
                  ? "Mark at least a third of a second — a shorter window rounds away and the take comes back unchanged."
                  : retake.regenerateAudio
                    ? "LTX rewrites the window's audio as well — expect invented speech if the original had a line there."
                    : "The original audio, length and framing are kept; only the picture inside the window is re-rendered."}
              </p>
            </div>
          ) : !directorOn ? (
            <p className="mt-1.5 text-[10px] leading-relaxed text-fog/70">
              Turn on to pin an end frame and mid-shot keyframes — LTX renders the move between
              them as one continuous take instead of a cut.
            </p>
          ) : (
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center gap-2 rounded-xl border border-cream/10 bg-surface px-2.5 py-1.5">
                <span className="w-10 shrink-0 text-[10px] tabular-nums text-gold">0.0s</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-cream/85">
                  {frameName}
                </span>
                <span className="shrink-0 text-[9px] uppercase tracking-wider text-fog/60">
                  start
                </span>
              </div>

              {keyframes.map((k, i) => {
                const still = lab.frames.find((f) => f.relPath === k.image);
                return (
                  <div
                    key={`${k.image}-${i}`}
                    className="flex items-center gap-2 rounded-xl border border-cream/10 bg-surface px-2.5 py-1.5"
                  >
                    <input
                      type="number"
                      min={0}
                      max={durationSec}
                      step={0.1}
                      value={k.atSec}
                      onChange={(e) =>
                        setKeyframes((ks) =>
                          ks.map((x, j) =>
                            j === i
                              ? { ...x, atSec: clampSec(Number(e.target.value), durationSec) }
                              : x,
                          ),
                        )
                      }
                      className="w-10 shrink-0 bg-transparent text-[10px] tabular-nums text-gold focus:outline-none"
                    />
                    <button
                      onClick={() => setPicking(i)}
                      title="Choose a different still"
                      className="min-w-0 flex-1 truncate text-left text-[11px] text-cream/85 transition hover:text-gold"
                    >
                      {still?.name ?? k.image.split("/").pop()}
                    </button>
                    <input
                      type="range"
                      min={0.3}
                      max={1}
                      step={0.05}
                      value={k.strength}
                      title={`Hold strength ${k.strength.toFixed(2)}`}
                      onChange={(e) =>
                        setKeyframes((ks) =>
                          ks.map((x, j) => (j === i ? { ...x, strength: Number(e.target.value) } : x)),
                        )
                      }
                      className="w-12 shrink-0 accent-gold"
                    />
                    <button
                      onClick={() => setKeyframes((ks) => ks.filter((_, j) => j !== i))}
                      className="shrink-0 text-fog/60 transition hover:text-red-400"
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}

              <div className="flex gap-1.5">
                <button
                  onClick={() => addKeyframe(durationSec)}
                  className="flex-1 rounded-xl border border-dashed border-cream/15 px-2 py-1.5 text-[10px] text-cream/80 transition hover:border-gold/50 hover:text-gold"
                >
                  + End frame
                </button>
                <button
                  onClick={() => addKeyframe(durationSec / 2)}
                  className="flex-1 rounded-xl border border-dashed border-cream/15 px-2 py-1.5 text-[10px] text-cream/80 transition hover:border-gold/50 hover:text-gold"
                >
                  + Keyframe
                </button>
              </div>
              <p className="text-[10px] leading-relaxed text-fog/70">
                {keyframes.length === 0
                  ? "Add an end frame and LTX interpolates the whole transformation."
                  : `${keyframes.length + 1} keyframes over ${fmtTime(durationSec)} — the slider is how hard each is held.`}
              </p>

              {/* prompt beats — the shot's phrasing changing inside one take */}
              <div className="mt-3 border-t hairline pt-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">
                    Prompt beats
                  </h4>
                  <button
                    onClick={addBeat}
                    className="inline-flex items-center gap-1 text-[10px] text-fog transition hover:text-gold"
                  >
                    <ListPlus size={10} /> Add beat
                  </button>
                </div>

                {beats.length === 0 ? (
                  <p className="mt-1.5 text-[10px] leading-relaxed text-fog/70">
                    One prompt runs the whole take. Add beats to change what LTX is describing
                    partway through — a wide that pushes in and lands on a reaction, in one
                    continuous render.
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {/* how the beats tile the shot */}
                    <div className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-cream/8">
                      {tiling.rows.map((r, i) =>
                        r.dead ? null : (
                          <div
                            key={i}
                            style={{ width: `${(r.length / Math.max(durationSec, 0.1)) * 100}%` }}
                            className={cx("h-full", i % 2 ? "bg-gold/45" : "bg-gold/80")}
                          />
                        ),
                      )}
                    </div>

                    {beats.map((b, i) => (
                      <div
                        key={i}
                        className={cx(
                          "space-y-1.5 rounded-xl border bg-surface p-2",
                          tiling.rows[i]?.dead ? "border-red-500/30" : "border-cream/10",
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="w-9 shrink-0 text-[10px] tabular-nums text-gold">
                            {fmtTime(tiling.rows[i]?.start ?? 0)}
                          </span>
                          <input
                            value={b.text}
                            onChange={(e) =>
                              setBeats((bs) =>
                                bs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)),
                              )
                            }
                            placeholder={`Beat ${i + 1} — what changes`}
                            className="min-w-0 flex-1 rounded-md border border-cream/10 bg-ink px-2 py-1 text-[11px] text-cream outline-none placeholder:text-fog/60 focus:border-gold/40"
                          />
                          <button
                            onClick={() => setBeats((bs) => bs.filter((_, j) => j !== i))}
                            className="shrink-0 text-fog/60 transition hover:text-red-400"
                          >
                            <X size={12} />
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <BankSelect
                            value={b.shot}
                            placeholder="Shot"
                            // abbreviations are short — give the room to the move
                            className="w-[68px] shrink-0"
                            entries={lab.cinematography.shotSizes}
                            onChange={(v) =>
                              setBeats((bs) => bs.map((x, j) => (j === i ? { ...x, shot: v } : x)))
                            }
                          />
                          <BankSelect
                            value={b.move}
                            placeholder="Camera move"
                            entries={lab.cinematography.moves}
                            onChange={(v) =>
                              setBeats((bs) => bs.map((x, j) => (j === i ? { ...x, move: v } : x)))
                            }
                          />
                          <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-cream/10 bg-ink px-1.5 py-1">
                            <input
                              type="number"
                              min={MIN_BEAT_SEC}
                              max={durationSec}
                              step={0.5}
                              value={b.lengthSec}
                              onChange={(e) =>
                                setBeats((bs) =>
                                  bs.map((x, j) =>
                                    j === i
                                      ? {
                                          ...x,
                                          lengthSec: clampSec(Number(e.target.value), durationSec),
                                        }
                                      : x,
                                  ),
                                )
                              }
                              className="w-7 bg-transparent text-[10px] tabular-nums text-gold outline-none"
                            />
                            <span className="text-[10px] text-fog/70">s</span>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* beat blend — how hard a boundary lands */}
                    <div className="flex items-center gap-2 pt-0.5">
                      <span className="shrink-0 text-[10px] text-fog">Blend</span>
                      <input
                        type="range"
                        min={0.001}
                        max={0.5}
                        step={0.001}
                        value={blend}
                        onChange={(e) => setBlend(Number(e.target.value))}
                        className="min-w-0 flex-1 accent-gold"
                      />
                      <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-gold">
                        {blend <= 0.01 ? "cut" : blend >= 0.25 ? "dissolve" : blend.toFixed(2)}
                      </span>
                    </div>

                    {lab.cinematography.shotSizes.length === 0 && (
                      <p className="text-[10px] leading-relaxed text-fog/70">
                        Import the cinematography bank on this project's Bible screen and the
                        pickers fill with the show's shot grammar.
                      </p>
                    )}
                    {tiling.dead > 0 ? (
                      <p className="text-[10px] leading-relaxed text-red-300">
                        The beats ask for {fmtTime(tiling.asked)} of a {fmtTime(durationSec)} take —
                        the last {tiling.dead} never arrive{tiling.dead === 1 ? "s" : ""}. Shorten
                        them or make the clip longer.
                      </p>
                    ) : tiling.flicker ? (
                      <p className="text-[10px] leading-relaxed text-gold/75">
                        A beat under {MIN_BEAT_SEC.toFixed(1)}s is shorter than one latent frame —
                        it will read as a flicker rather than a beat.
                      </p>
                    ) : (
                      <p className="text-[10px] leading-relaxed text-fog/70">
                        {beats.length} beat{beats.length === 1 ? "" : "s"} across{" "}
                        {fmtTime(durationSec)}
                        {tiling.short ? " — the last one holds to the end." : "."}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <AudioLane
                sources={lab.audioSources}
                lane={lane}
                setLane={setLane}
                durationSec={durationSec}
                roomTone={roomTone}
                setRoomTone={setRoomTone}
              />

              <CastLane
                refs={castRefs}
                setRefs={setCastRefs}
                cast={lab.cast}
                sets={lab.sets}
                frames={lab.frames}
                strength={refStrength}
                setStrength={setRefStrength}
                // null = the probe hasn't answered yet; don't call it missing
                available={lab.capabilities?.multiRef !== false}
                note={lab.capabilities?.note}
                blocked={
                  motionRef
                    ? "This shot is driven by a motion reference, which uses the same IC-LoRA " +
                      "slot. Remove it to reference the cast instead."
                    : undefined
                }
              />

              <MotionLane
                sources={lab.videoSources}
                motion={motionRef}
                setMotion={setMotionRef}
                durationSec={durationSec}
                // null = the probe hasn't answered yet; don't call it missing.
                // A cast sheet closes this lane too: both ride the one IC-LoRA.
                available={lab.capabilities?.icLora !== false && castRefs.length === 0}
                note={
                  castRefs.length > 0
                    ? "The cast sheet above holds the IC-LoRA slot. Clear it to transfer motion " +
                      "onto this shot instead."
                    : undefined
                }
              />
            </div>
          )}
        </section>

        {/* 3 · engine */}
        <section>
          <PanelLabel hint>3 · Engine</PanelLabel>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {lab.engines.map((e) => (
              <button
                key={e.id}
                onClick={() => setEngineId(e.id)}
                className={cx(
                  "rounded-xl border p-2.5 text-left transition",
                  engineId === e.id
                    ? "border-gold/60 bg-gold/8"
                    : "border-cream/10 hover:border-cream/20",
                )}
              >
                <div
                  className={cx(
                    "text-[12px] font-medium",
                    engineId === e.id ? "text-gold" : "text-cream/90",
                  )}
                >
                  {e.label}
                </div>
                <div className="mt-0.5 text-[10px] text-fog">{e.sub}</div>
                <div className="mt-1 text-[9px] leading-snug text-fog/70">{e.note}</div>
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-fog/70">{lab.engineNotes[engineId]}</p>
        </section>

        {/* 4/5 · duration + resolution */}
        <section>
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <PanelLabel>4 · Duration</PanelLabel>
              <div className="mt-2">
                <Select icon={Timer} value={duration} options={lab.durations} onChange={setDuration} />
              </div>
            </div>
            <div>
              <PanelLabel>5 · Resolution</PanelLabel>
              <div className="mt-2">
                <Select
                  icon={Monitor}
                  value={resolution}
                  options={lab.resolutions}
                  onChange={setResolution}
                />
              </div>
            </div>
          </div>
          {retake && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-gold/75">
              A retake follows the take it fixes — {retake.label} sets the length, frame rate and
              size, so these two don't apply.
            </p>
          )}
          {engineId === "seedance" && durationSec > 7 && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-fog/70">
              Seedance only renders 5s or 10s — this queues as a 10-second clip.
            </p>
          )}
          {engineId !== "seedance" && durationSec > 10 && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-gold/75">
              Long clips scale VRAM and render time roughly linearly — drop the
              resolution if a {durationSec}s take runs out of memory.
            </p>
          )}
        </section>

        {/* 6 · motion strength */}
        <section>
          <div className="flex items-center justify-between">
            <PanelLabel hint>6 · Motion strength</PanelLabel>
            <span className="text-[12px] font-medium tabular-nums text-gold">
              {motion.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={motion}
            onChange={(e) => setMotion(Number(e.target.value))}
            className="mt-2 w-full accent-gold"
          />
        </section>
      </div>

      <div className="space-y-2 p-4 pt-2">
        <GoldButton
          onClick={() =>
            lab.generate({
              prompt,
              engine: engineId,
              durationSec,
              resolution,
              motionStrength: motion,
              startFrame: effectiveRel,
              // the lane owns dialogue once the Director is on: leaving the
              // simple field set would put a take back at 0s that the user may
              // have just taken off the lane
              audio: director ? undefined : (audioRel ?? undefined),
              director,
              // a shot sent over from the board delivers its take back to the
              // board; a retake is a fix for a clip, not a new take of a shot
              board: prefill && !retake ? { shotId: prefill.shotId } : undefined,
            })
          }
          className={cx(
            "w-full justify-center py-3 text-[13px] uppercase tracking-widest",
            (lab.busy ||
              !prompt.trim() ||
              (retake ? !retakeReady || retake.lengthSec < MIN_RETAKE_SEC : !canGenerate)) &&
              "pointer-events-none opacity-50",
          )}
        >
          {retake ? <Scissors size={14} /> : <Sparkles size={14} />}{" "}
          {lab.busy
            ? "Generating…"
            : retake
              ? retake.prompt.trim()
                ? `Re-render ${fmtTime(retake.lengthSec)}`
                : "Describe the fix"
              : canGenerate
                ? "Generate"
                : "Needs a start frame"}
        </GoldButton>
        {lab.error && (
          <p className="rounded-lg border border-red-500/25 bg-red-500/8 px-2.5 py-1.5 text-[10px] leading-relaxed text-red-300">
            {lab.error}
          </p>
        )}
        {lab.failures.slice(0, 1).map((f) => (
          <div
            key={f.id}
            className="rounded-lg border border-red-500/25 bg-red-500/8 px-2.5 py-1.5"
          >
            <div className="flex items-center gap-1.5">
              <CircleAlert size={11} className="shrink-0 text-red-400" />
              <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-cream/90">
                {f.title} · {f.engine}
              </span>
              <button
                onClick={() => lab.retry(f.id)}
                className="shrink-0 text-[10px] text-gold hover:underline"
              >
                Retry
              </button>
            </div>
            {/* ComfyUI's rejection message lists every model file it knows —
              * hundreds of lines. Unclamped it pushes the whole panel off
              * screen, so it scrolls inside the card instead. */}
            <p className="mt-1 max-h-20 overflow-y-auto text-[10px] leading-relaxed text-red-300">
              {f.error}
            </p>
          </div>
        ))}
      </div>

      {pickerOpen && (
        <FramePicker
          frames={lab.frames}
          mode={picking}
          selectedRel={
            picking === "start"
              ? effectiveRel
              : typeof picking === "number"
                ? keyframes[picking]?.image
                : undefined
          }
          onPick={(rel) => {
            if (picking === "start") setFrameRel(rel);
            else if (typeof picking === "number") {
              setKeyframes((ks) => ks.map((k, j) => (j === picking ? { ...k, image: rel } : k)));
            }
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </aside>
  );
}

/* ---------- start frame / keyframe picker ---------- */

/** One library still as the picker sees it — the shape `useVideoLab().frames`
 * hands over. */
interface PickerFrame {
  relPath: string;
  name: string;
  meta: string;
  swatch: string;
  url?: string;
}

/** Tile widths, in the order the size control steps through them. Even the
 * tightest rung is wider than the old fixed 3-column grid: the picker exists so
 * you can SEE a frame before committing a four-minute render to it. */
const TILE_SIZES = [
  { id: "m", label: "Medium tiles", min: 210, icon: Grid3x3 },
  { id: "l", label: "Large tiles", min: 300, icon: Grid2x2 },
  { id: "xl", label: "Huge tiles", min: 440, icon: Maximize2 },
] as const;
type TileSize = (typeof TILE_SIZES)[number];

const TILE_SIZE_KEY = "aurea.videoLab.frameTileSize";

function storedTileSize(): TileSize {
  try {
    const id = localStorage.getItem(TILE_SIZE_KEY);
    return TILE_SIZES.find((s) => s.id === id) ?? TILE_SIZES[1];
  } catch {
    return TILE_SIZES[1];
  }
}

/** Full-bleed still picker: a resizable grid on the left, the frame under the
 * cursor rendered large and uncropped on the right. Hover or arrow-key onto a
 * tile to inspect it, click or Enter to take it. */
function FramePicker({
  frames,
  mode,
  selectedRel,
  onPick,
  onClose,
}: {
  frames: PickerFrame[];
  /** "start" retargets the start frame; a number retargets that Director
   * keyframe — one picker, two jobs, so the copy has to say which */
  mode: "start" | number;
  selectedRel?: string;
  onPick: (relPath: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [size, setSize] = useState<TileSize>(storedTileSize);
  /** the tile the pointer is over — it wins over the keyboard cursor while the
   * mouse is inside the grid, so the preview always shows what you're aiming at */
  const [hover, setHover] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const q = query.trim().toLowerCase();
  const shown = q ? frames.filter((f) => f.name.toLowerCase().includes(q)) : frames;

  // open on whatever is already chosen, so the first thing you see is the frame
  // you'd be replacing
  const [cursor, setCursor] = useState(() => {
    const i = frames.findIndex((f) => f.relPath === selectedRel);
    return i > 0 ? i : 0;
  });
  const at = Math.min(cursor, Math.max(0, shown.length - 1));
  const preview = shown[hover ?? at];

  /* A new filter re-numbers the roll, so the cursor goes back to the top — but
   * not on mount, where it is deliberately parked on the current frame. */
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setCursor(0);
  }, [q]);

  const chooseSize = (s: TileSize) => {
    setSize(s);
    try {
      localStorage.setItem(TILE_SIZE_KEY, s.id);
    } catch {
      /* private mode — the preference just doesn't persist */
    }
  };

  /* A row is however many tiles the auto-fill grid actually laid out, which
   * only the resolved style knows — the column count changes with both the
   * size rung and the window. */
  const columns = () => {
    const el = gridRef.current;
    if (!el) return 1;
    return getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Enter") {
        const f = shown[Math.min(cursor, Math.max(0, shown.length - 1))];
        if (f) {
          e.preventDefault();
          onPick(f.relPath);
        }
        return;
      }
      const step =
        e.key === "ArrowRight" ? 1
        : e.key === "ArrowLeft" ? -1
        : e.key === "ArrowDown" ? columns()
        : e.key === "ArrowUp" ? -columns()
        : 0;
      if (step) {
        // inside the search box the caret owns left/right; up/down still browse
        if (typing && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
        e.preventDefault();
        setHover(null);
        setCursor((c) => {
          const from = Math.min(c, Math.max(0, shown.length - 1));
          return Math.max(0, Math.min(shown.length - 1, from + step));
        });
        return;
      }
      // type-to-filter: a printable key jumps into the search box mid-keystroke
      if (!typing && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setQuery((v) => v + e.key);
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, cursor, onClose, onPick]);

  // keep the keyboard cursor on screen as it walks the roll
  useEffect(() => {
    if (hover === null) tileRefs.current[at]?.scrollIntoView({ block: "nearest" });
  }, [at, hover, size]);

  const title = mode === "start" ? "Choose a start frame" : "Choose a keyframe still";
  const cta = mode === "start" ? "Use as start frame" : "Use as keyframe";

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/85 p-6 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[min(92vh,1000px)] w-[min(1520px,96vw)] flex-col overflow-hidden rounded-3xl border border-cream/10 bg-raised shadow-2xl"
      >
        <header className="flex shrink-0 items-center gap-4 border-b hairline px-5 py-3.5">
          <div className="min-w-0">
            <h3 className="font-serif text-[17px] font-semibold leading-tight text-cream">
              {title}
            </h3>
            <p className="mt-0.5 text-[11px] text-fog">
              {q ? `${shown.length} of ${frames.length}` : `${frames.length}`} stills · newest first
              · generate more in the Image lab
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fog" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by name…"
                className="w-52 rounded-full border border-cream/10 bg-surface py-1.5 pl-7 pr-7 text-[11px] text-cream placeholder:text-fog/70 focus:border-gold/40 focus:outline-none"
              />
              {query && (
                <button
                  onClick={() => {
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-fog/70 transition hover:text-cream"
                >
                  <X size={11} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-0.5 rounded-full border border-cream/10 bg-surface p-0.5">
              {TILE_SIZES.map((s) => (
                <button
                  key={s.id}
                  title={s.label}
                  onClick={() => chooseSize(s)}
                  className={cx(
                    "rounded-full p-1.5 transition",
                    s.id === size.id
                      ? "bg-gold/18 text-gold"
                      : "text-fog hover:bg-cream/5 hover:text-cream",
                  )}
                >
                  <s.icon size={13} />
                </button>
              ))}
            </div>

            <button
              onClick={onClose}
              title="Close (Esc)"
              className="rounded-full p-1.5 text-fog/70 transition hover:bg-cream/5 hover:text-cream"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <div
            ref={gridRef}
            onMouseLeave={() => setHover(null)}
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size.min}px, 1fr))` }}
            className="grid min-h-0 flex-1 auto-rows-min content-start gap-3 overflow-y-auto p-5"
          >
            {shown.map((f, i) => {
              const chosen = f.relPath === selectedRel;
              const lit = hover === null ? i === at : i === hover;
              return (
                <button
                  key={f.relPath}
                  ref={(el) => {
                    tileRefs.current[i] = el;
                  }}
                  onMouseEnter={() => setHover(i)}
                  onClick={() => onPick(f.relPath)}
                  className={cx(
                    "group relative aspect-video overflow-hidden rounded-xl border text-left transition duration-200 focus:outline-none",
                    chosen
                      ? "border-gold/70 ring-2 ring-gold/35"
                      : lit
                        ? "border-cream/40 ring-2 ring-cream/15"
                        : "border-cream/8",
                  )}
                >
                  <div className={cx("absolute inset-0", f.swatch)} />
                  {f.url && (
                    <img
                      src={f.url}
                      alt=""
                      draggable={false}
                      loading="lazy"
                      className={cx(
                        "absolute inset-0 h-full w-full object-cover transition duration-500",
                        lit && "scale-[1.03]",
                      )}
                    />
                  )}
                  {chosen && (
                    <span className="absolute right-2 top-2 rounded-full bg-gold p-1 text-ink shadow-lg">
                      <Check size={11} strokeWidth={3} />
                    </span>
                  )}
                  <div
                    className={cx(
                      "absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/90 via-ink/45 to-transparent px-3 pb-2 pt-8 transition",
                      lit ? "opacity-100" : "opacity-0",
                    )}
                  >
                    <div className="truncate text-[11px] text-cream/95">{f.name}</div>
                    <div className="truncate text-[10px] text-fog">{f.meta}</div>
                  </div>
                </button>
              );
            })}

            {shown.length === 0 && (
              <p className="col-span-full py-16 text-center text-[12px] text-fog">
                {frames.length === 0
                  ? "No stills in the library yet — generate one in the Image lab."
                  : `Nothing matches “${query.trim()}”.`}
              </p>
            )}
          </div>

          {/* the whole point: the frame under the cursor, big and uncropped */}
          <aside className="hidden w-[min(46%,640px)] min-w-[380px] shrink-0 flex-col border-l hairline bg-[#0e0e10] p-5 xl:flex">
            {preview ? (
              <>
                {/* takes every pixel the rail's chrome doesn't need — a start
                  * frame decides the whole render, so it earns the space */}
                <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl border border-cream/8 bg-ink">
                  <div className={cx("absolute inset-0 opacity-40 blur-2xl", preview.swatch)} />
                  {preview.url ? (
                    <img
                      src={preview.url}
                      alt=""
                      draggable={false}
                      className="relative h-full w-full object-contain"
                    />
                  ) : (
                    <ImageOff size={22} className="relative text-fog/60" />
                  )}
                </div>
                <h4 className="mt-4 break-words text-[13px] leading-snug text-cream/95">
                  {preview.name}
                </h4>
                <p className="mt-1 text-[11px] text-fog">{preview.meta}</p>
                {preview.relPath === selectedRel && (
                  <p className="mt-2 inline-flex items-center gap-1 self-start rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-medium text-gold">
                    <Check size={10} /> Currently chosen
                  </p>
                )}

                <GoldButton
                  onClick={() => onPick(preview.relPath)}
                  className="mt-4 w-full shrink-0 justify-center py-2.5 text-[12px] uppercase tracking-widest"
                >
                  {cta}
                </GoldButton>
                <p className="mt-2 shrink-0 text-center text-[10px] leading-relaxed text-fog/70">
                  Arrow keys browse · <CornerDownLeft size={9} className="inline" /> chooses · type
                  to filter · Esc closes
                </p>
              </>
            ) : (
              <p className="m-auto text-center text-[11px] text-fog">Nothing to preview.</p>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

/* ---------- center: preview + takes ---------- */

function TakeCard({
  take,
  active,
  starred,
  onSelect,
  onStar,
}: {
  take: VideoTake;
  active: boolean;
  starred: boolean;
  onSelect: () => void;
  onStar: () => void;
}) {
  const hoverRef = useRef<HTMLVideoElement>(null);
  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => {
        const el = hoverRef.current;
        if (el) void el.play().catch(() => {});
      }}
      onMouseLeave={() => {
        const el = hoverRef.current;
        if (!el) return;
        el.pause();
        el.currentTime = 0;
      }}
      className={cx(
        "group relative aspect-video min-w-0 flex-1 cursor-pointer overflow-hidden rounded-xl border transition",
        active ? "border-gold/60" : "border-cream/10 hover:border-cream/25",
      )}
    >
      <div className={cx("absolute inset-0", take.swatch)} />
      {take.url ? (
        /* hover scrubs the take silently — the preview player owns the sound */
        <video
          ref={hoverRef}
          src={take.url}
          muted
          loop
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_30%,rgba(237,234,228,0.07),transparent_60%)]" />
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onStar();
        }}
        title={starred ? "Unstar this take" : "Star this take"}
        className={cx(
          "absolute right-1.5 top-1.5 z-[1] rounded-full p-1 transition",
          starred ? "text-gold" : "text-cream/50 opacity-0 group-hover:opacity-100 hover:text-gold",
        )}
      >
        <Star size={12} fill={starred ? "currentColor" : "none"} />
      </button>
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink/60 text-cream backdrop-blur">
          <Play size={13} className="ml-0.5" />
        </span>
      </span>
      <span
        className={cx(
          "pointer-events-none absolute bottom-2 left-2.5 text-[11px] font-medium",
          active ? "text-gold" : "text-cream/85",
        )}
      >
        {take.label}
      </span>
    </div>
  );
}

/* ---------- transport controls ---------- */

/** Click-and-drag scrub bar. Pointer capture keeps the drag alive when the
 * cursor leaves the 1px track, which is most of the time. `mark` shades a
 * region of the clip — the window a retake will re-render. */
function Scrubber({ player, mark }: { player: VideoPlayer; mark?: { from: number; to: number } }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  const fractionAt = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  const seekable = player.durationSec > 0;
  const shown = dragging && hover != null ? hover : player.played;

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shown * 100)}
      onPointerDown={(e) => {
        if (!seekable) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        const f = fractionAt(e.clientX);
        setHover(f);
        player.seekFraction(f);
      }}
      onPointerMove={(e) => {
        const f = fractionAt(e.clientX);
        if (dragging) {
          setHover(f);
          player.seekFraction(f);
        } else if (seekable) {
          setHover(f);
        }
      }}
      onPointerUp={(e) => {
        if (!dragging) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        setDragging(false);
      }}
      onPointerLeave={() => !dragging && setHover(null)}
      className={cx(
        "group/scrub relative -my-2 min-w-0 flex-1 py-2",
        seekable ? "cursor-pointer" : "cursor-default",
      )}
    >
      <div className="relative h-1 rounded-full bg-cream/15">
        {/* the retake window, drawn taller than the track so it reads as a
          * region of the clip rather than as progress through it */}
        {mark && mark.to > mark.from && (
          <div
            className="absolute -inset-y-1 rounded-sm border-x border-gold/70 bg-gold/25"
            style={{
              left: `${mark.from * 100}%`,
              width: `${Math.max(0.5, (mark.to - mark.from) * 100)}%`,
            }}
          />
        )}
        {/* hover ghost — where a click would land */}
        {hover != null && !dragging && (
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-cream/20"
            style={{ width: `${hover * 100}%` }}
          />
        )}
        <div
          className="h-full rounded-full bg-gradient-to-r from-gold-deep to-gold"
          style={{ width: `${shown * 100}%` }}
        />
        <span
          className={cx(
            "absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-gold shadow transition-transform",
            dragging && "scale-125",
          )}
          style={{ left: `calc(${shown * 100}% - 6px)` }}
        />
      </div>
    </div>
  );
}

function VolumeControl({ player }: { player: VideoPlayer }) {
  const Icon = player.muted || player.volume === 0 ? VolumeX : player.volume < 0.5 ? Volume1 : Volume2;
  return (
    <div className="group/vol relative flex shrink-0 items-center">
      <button
        onClick={player.toggleMute}
        title={player.muted ? "Unmute (M)" : "Mute (M)"}
        className={cx(
          "transition hover:text-gold",
          player.muted ? "text-fog" : "text-cream/70",
          player.autoplayBlocked && "animate-pulse text-gold",
        )}
      >
        <Icon size={15} />
      </button>
      {/* slider expands on hover — no space stolen from the scrub bar */}
      <div className="w-0 overflow-hidden opacity-0 transition-all duration-150 group-hover/vol:ml-2 group-hover/vol:w-20 group-hover/vol:opacity-100">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={player.muted ? 0 : player.volume}
          onChange={(e) => player.setVolume(Number(e.target.value))}
          className="w-20 accent-gold"
        />
      </div>
    </div>
  );
}

function PreviewPanel({
  takeId,
  onSelect,
  retake,
  setRetake,
}: {
  takeId: string;
  onSelect: (id: string) => void;
  retake: RetakeDraft | null;
  setRetake: (r: RetakeDraft | null) => void;
}) {
  const lab = useVideoLab();
  const navigate = useNavigate();
  const { isLiked, toggleLike } = useLikes();
  const timeline = useSendToTimeline();
  const { remove } = useRemoveAssets();
  const take = lab.takes.find((t) => t.id === takeId) ?? lab.takes[0];
  const player = useVideoPlayer(take?.url);
  const stageRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen().catch(() => {});
  }, []);

  /* ---- retake marking ----
   * The window is marked against THIS take, so the controls only appear while
   * its source is the one on screen. Times come off the player rather than a
   * number field: the point of marking on the scrub bar is that you find the
   * bad two seconds by watching them. */
  const marking = retake && take?.relPath === retake.source ? retake : null;
  const canRetake = lab.capabilities?.director !== false;
  const startRetake = () => {
    if (!take?.relPath) return;
    player.pause();
    const from = player.positionSec;
    const room = Math.max(0, (player.durationSec || 0) - from);
    setRetake({
      source: take.relPath,
      label: take.label,
      atSec: Number(from.toFixed(2)),
      // two seconds is the usual "that bit's wrong", clipped to what's left
      lengthSec: Number(Math.min(2, room || 2).toFixed(2)),
      prompt: "",
      strength: 1,
      regenerateAudio: false,
    });
  };
  /** the playhead becomes the in or out point, keeping in < out */
  const markEdge = (edge: "in" | "out") => {
    if (!marking) return;
    const t = Number(player.positionSec.toFixed(2));
    if (edge === "in") {
      const end = marking.atSec + marking.lengthSec;
      const atSec = Math.min(t, Math.max(0, end - MIN_RETAKE_SEC));
      setRetake({ ...marking, atSec, lengthSec: Number((end - atSec).toFixed(2)) });
    } else {
      const lengthSec = Math.max(MIN_RETAKE_SEC, t - marking.atSec);
      setRetake({ ...marking, lengthSec: Number(lengthSec.toFixed(2)) });
    }
  };

  /* transport shortcuts, scoped to the focused player so they never eat
   * keystrokes meant for the prompt box */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (key === " " || key === "k") {
      e.preventDefault();
      player.toggle();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      player.nudge(-2);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      player.nudge(2);
    } else if (key === "m") {
      player.toggleMute();
    } else if (key === "f") {
      toggleFullscreen();
    }
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col p-4">
      <header className="flex items-center justify-between pb-3">
        <h2 className="font-serif text-[16px] font-semibold tracking-wide text-cream">Preview</h2>
        <div className="relative flex items-center gap-1">
          <button
            onClick={toggleFullscreen}
            title="Fullscreen (F)"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-cream/10 text-fog transition hover:border-gold/35 hover:text-gold"
          >
            <Maximize2 size={13} />
          </button>
          <button
            onClick={() => {
              setMenu((m) => !m);
              setArmed(false);
            }}
            title="Take actions"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-cream/10 text-fog transition hover:border-gold/35 hover:text-gold"
          >
            <MoreVertical size={13} />
          </button>
          {menu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
              <div className="absolute right-0 top-9 z-20 w-52 rounded-xl border border-cream/12 bg-raised p-1 shadow-xl">
                <button
                  onClick={() => {
                    setMenu(false);
                    if (take?.relPath) void timeline.send(take.relPath);
                  }}
                  disabled={!take?.relPath || timeline.sending || !timeline.live}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-cream/85 transition hover:bg-cream/5 disabled:opacity-40"
                >
                  <ListPlus size={12} /> {timeline.sending ? "Sending…" : "Send to timeline"}
                </button>
                <button
                  onClick={() => {
                    setMenu(false);
                    startRetake();
                  }}
                  disabled={!take?.relPath || !canRetake}
                  title={
                    canRetake
                      ? "Mark a window and re-render just that bit"
                      : (lab.capabilities?.note ?? "Needs a ComfyUI with the Director node pack")
                  }
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-cream/85 transition hover:bg-cream/5 disabled:opacity-40"
                >
                  <Scissors size={12} /> Fix this bit
                </button>
                <button
                  onClick={() => {
                    setMenu(false);
                    if (take?.url) void downloadAsset(take.url, `${take.label || "take"}.mp4`);
                  }}
                  disabled={!take?.url}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-cream/85 transition hover:bg-cream/5 disabled:opacity-40"
                >
                  <Download size={12} /> Download
                </button>
                <button
                  onClick={() => {
                    if (!armed) {
                      setArmed(true);
                      return;
                    }
                    setMenu(false);
                    setArmed(false);
                    if (take?.relPath) void remove(take.relPath);
                  }}
                  disabled={!take?.relPath}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-[#e07a6b] transition hover:bg-cream/5 disabled:opacity-40"
                >
                  <Trash2 size={12} /> {armed ? "Click again to confirm" : "Delete from disk"}
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* player */}
      <div
        ref={stageRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="group/player relative min-h-0 flex-1 overflow-hidden rounded-2xl border hairline bg-black outline-none focus-visible:border-gold/40"
      >
        {!take?.url && <div className={cx("absolute inset-0", take?.swatch)} />}
        {take?.url ? (
          <video
            ref={player.ref}
            src={take.url}
            loop
            playsInline
            onClick={player.toggle}
            className="absolute inset-0 h-full w-full cursor-pointer object-contain"
          />
        ) : (
          /* stand-in composition until real frames flow through the seam */
          <div className="absolute inset-0 bg-[radial-gradient(90%_70%_at_50%_35%,rgba(237,234,228,0.09),transparent_65%)]" />
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-ink/80 to-transparent" />

        {/* Chromium blocked unmuted autoplay — one click gets the sound back */}
        {player.autoplayBlocked && (
          <button
            onClick={player.toggleMute}
            className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-gold/40 bg-ink/80 px-3 py-1.5 text-[11px] text-gold backdrop-blur transition hover:bg-ink"
          >
            <VolumeX size={11} className="mr-1 inline" /> Muted — click for sound
          </button>
        )}

        <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 px-4 pb-3">
          <button
            onClick={player.toggle}
            title={player.playing ? "Pause (Space)" : "Play (Space)"}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-gold to-gold-deep text-ink transition hover:brightness-110"
          >
            {player.playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
          </button>
          <span className="shrink-0 text-[11px] tabular-nums text-cream/90">
            {player.position} <span className="text-fog">/ {player.total}</span>
          </span>
          <Scrubber
            player={player}
            mark={
              marking && player.durationSec > 0
                ? {
                    from: marking.atSec / player.durationSec,
                    to: Math.min(1, (marking.atSec + marking.lengthSec) / player.durationSec),
                  }
                : undefined
            }
          />
          <VolumeControl player={player} />
          <button
            onClick={toggleFullscreen}
            title="Fullscreen (F)"
            className="shrink-0 text-cream/70 transition hover:text-gold"
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* retake range — marked here, rendered from the left panel */}
      {marking && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-gold/30 bg-gold/6 px-3 py-2">
          <Scissors size={12} className="shrink-0 text-gold/80" />
          <span className="shrink-0 text-[11px] tabular-nums text-gold">
            {fmtTime(marking.atSec)} → {fmtTime(marking.atSec + marking.lengthSec)}
          </span>
          <button
            onClick={() => markEdge("in")}
            title="Start the window at the playhead"
            className="shrink-0 rounded-full border border-cream/15 px-2 py-0.5 text-[10px] text-cream/80 transition hover:border-gold/50 hover:text-gold"
          >
            Set in
          </button>
          <button
            onClick={() => markEdge("out")}
            title="End the window at the playhead"
            className="shrink-0 rounded-full border border-cream/15 px-2 py-0.5 text-[10px] text-cream/80 transition hover:border-gold/50 hover:text-gold"
          >
            Set out
          </button>
          <button
            onClick={() => player.seekFraction(marking.atSec / Math.max(player.durationSec, 0.1))}
            title="Jump to the start of the window"
            className="shrink-0 text-[10px] text-fog transition hover:text-gold"
          >
            Review
          </button>
          <span className="min-w-0 flex-1 truncate text-right text-[10px] text-fog/70">
            {marking.prompt.trim() ? "Describe it and re-render on the left." : "Describe the fix on the left."}
          </span>
          <button
            onClick={() => setRetake(null)}
            title="Cancel the retake"
            className="shrink-0 text-fog/60 transition hover:text-red-400"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* takes */}
      <div className="pt-4">
        <div className="flex items-center justify-between pb-2.5">
          <div className="flex items-center gap-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">Takes</h3>
            <Chip tone="muted" className="text-[9px] tabular-nums">
              {lab.takes.length}
            </Chip>
          </div>
          <button
            onClick={() => navigate("/assets")}
            className="inline-flex items-center gap-0.5 text-[11px] text-gold hover:underline"
          >
            View all <ChevronRight size={11} />
          </button>
        </div>
        <div className="flex gap-2.5">
          {lab.takes.map((t) => (
            <TakeCard
              key={t.id}
              take={t}
              active={t.id === takeId}
              starred={t.relPath ? isLiked(t.relPath) : !!t.starred}
              onSelect={() => onSelect(t.id)}
              onStar={() => toggleLike(t.relPath)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- right rail: job progress + system ---------- */

function StageRow({ stage, index, last }: { stage: VideoStage; index: number; last: boolean }) {
  const done = stage.status === "completed";
  const running = stage.status === "running";
  return (
    <div className="relative flex gap-3 pb-5 last:pb-0">
      {!last && <span className="absolute bottom-0 left-[11px] top-6 w-px bg-gold/25" />}
      <span
        className={cx(
          "z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums",
          done
            ? "border-gold bg-gradient-to-b from-gold to-gold-deep text-ink"
            : running
              ? "border-gold/70 bg-[#0e0e10] text-gold"
              : "border-cream/15 bg-[#0e0e10] text-fog",
        )}
      >
        {done ? <Check size={12} /> : index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cx("text-[12px] font-medium", stage.status === "pending" ? "text-fog" : "text-cream")}>
            {stage.label}
          </span>
          <span
            className={cx(
              "shrink-0 text-[10px]",
              done ? "text-fog" : running ? "text-gold" : "text-fog/60",
            )}
          >
            {done ? "Completed" : running ? "In progress" : "Pending"}
          </span>
        </div>
        <div className="mt-0.5 flex items-baseline justify-between gap-2 text-[10px] text-fog">
          <span className="truncate">{stage.detail}</span>
          <span className="shrink-0 tabular-nums">{stage.time ?? "--:--:--"}</span>
        </div>
        {running && stage.progress != null && (
          <div className="mt-2 flex items-center gap-2">
            <Progress value={stage.progress} className="flex-1" />
            <span className="text-[10px] tabular-nums text-cream/80">{stage.progress}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

function JobRail() {
  const lab = useVideoLab();
  const { vram } = useJobs();
  const pct = Math.min(100, (vram.used / vram.total) * 100);

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l hairline bg-[#0e0e10]">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {/* job progress */}
        <section>
          <div className="flex items-center justify-between pb-2.5">
            <h2 className="font-serif text-[15px] font-semibold tracking-wide text-cream">
              Job progress
            </h2>
            <span className="flex items-center gap-1 text-[10px] tabular-nums text-fog">
              {lab.job.id}
              <button className="text-fog/60 transition hover:text-gold">
                <Copy size={10} />
              </button>
            </span>
          </div>

          <div className="divide-y divide-cream/6 rounded-xl bg-surface/60 px-3">
            <div className="flex items-center justify-between py-2.5 text-[11px]">
              <span className="text-fog">Status</span>
              <span className="flex items-center gap-1.5 font-medium text-gold">
                {lab.job.status} <RefreshCw size={11} className="animate-spin [animation-duration:2.5s]" />
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5 text-[11px]">
              <span className="text-fog">Elapsed</span>
              <span className="tabular-nums text-cream/90">{lab.job.elapsed}</span>
            </div>
          </div>

          <div className="mt-4 px-1">
            {lab.job.stages.map((st, i) => (
              <StageRow key={st.id} stage={st} index={i} last={i === lab.job.stages.length - 1} />
            ))}
          </div>
        </section>

        {/* system */}
        <section>
          <h2 className="pb-2 font-serif text-[15px] font-semibold tracking-wide text-cream">
            System
          </h2>
          <div className="rounded-xl bg-surface/60 p-3">
            <div className="flex items-baseline justify-between text-[11px]">
              <span className="text-fog">VRAM</span>
              <span className="tabular-nums text-cream/90">
                {vram.allocated} / {vram.total} GB
              </span>
            </div>
            <Progress value={pct} className="mt-2" />
            <p className="mt-1.5 text-[10px] text-gold/80">
              {Math.round((vram.allocated / vram.total) * 100)}% · high usage
            </p>
          </div>
        </section>

        {/* tip */}
        <section className="rounded-xl border border-gold/15 bg-gold/4 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-gold">
            <Lightbulb size={12} /> Tip
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-fog">{lab.tip}</p>
        </section>
      </div>

      <div className="flex items-center justify-between border-t hairline px-4 py-2.5">
        {(
          [
            { icon: Settings2, label: "Settings" },
            { icon: FileText, label: "Logs" },
            { icon: HelpCircle, label: "Help" },
          ] as const
        ).map(({ icon: Icon, label }) => (
          <button
            key={label}
            className="inline-flex items-center gap-1.5 text-[11px] text-fog transition hover:text-gold"
          >
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>
    </aside>
  );
}

/* ---------- screen ---------- */

export function VideoLab() {
  const lab = useVideoLab();
  const [takeId, setTakeId] = useState((lab.takes.find((t) => t.selected) ?? lab.takes[0]).id);
  /** a retake is marked on the preview player and rendered from the params
   * panel, so the draft lives here, above both */
  const [retake, setRetake] = useState<RetakeDraft | null>(null);
  /* "Send to Director" navigates here with the composed shot. Keying the panel
   * on it re-seeds every control from the spec — including a second send of the
   * same shot, once its voice takes exist and the timing is no longer a guess. */
  const prefill = (useLocation().state as { shot?: ShotPrefill } | null)?.shot ?? null;

  return (
    <div className="flex h-full">
      <ParamsPanel
        key={prefill ? `${prefill.shotId}:${prefill.sentAt}` : "free"}
        prefill={prefill}
        retake={retake}
        setRetake={setRetake}
      />
      <PreviewPanel
        takeId={takeId}
        onSelect={setTakeId}
        retake={retake}
        setRetake={setRetake}
      />
      <JobRail />
    </div>
  );
}
