import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Timer } from "lucide-react";
import type { DirectorSpec } from "@aurea/shared";
import { cx } from "@/components/ui";

/* The Video lab's shared grammar: the small types every panel speaks
 * (keyframes, beats, takes, the retake draft, the storyboard hand-off), the
 * measured constants (latent stride, the improv gap), and the two pickers
 * several lanes reuse. Everything here is deliberately free of lab state —
 * the seams stay in VideoLab.tsx and ParamsPanel.tsx. */

/** A Director keyframe beyond the start frame: a library still pinned to a
 * time, with how hard LTX is asked to hold it. The simple path's guide
 * frames (payload.keyframes) share the exact same shape on purpose. */
export interface DirectorKeyframe {
  image: string;
  atSec: number;
  strength: number;
}

/** A prompt beat: what changes at this point in the take, optionally shot with
 * a camera the bank already has language for. The camera ids stay separate
 * from the typed line until submit, so the pickers survive an edit. */
export interface DirectorBeat {
  text: string;
  lengthSec: number;
  shot: string;
  move: string;
}

/** A voice take on the audio lane: a library clip locked to a timecode, which
 * is what LTX lip-syncs to. `trimStartSec` skips a lead-in the take doesn't
 * need — the line starts when the character starts speaking, not when the file
 * does. */
export interface DirectorTake {
  take: string;
  atSec: number;
  trimStartSec: number;
}

/** A motion reference: an existing clip whose movement drives this shot through
 * an IC-LoRA. `atSec`/`lengthSec` are where its motion applies inside the shot,
 * `trimStartSec` which part of the reference is used. */
export interface DirectorMotion {
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
export interface RetakeDraft {
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

/** One library still as the pickers see it — the shape `useVideoLab().frames`
 * hands over. */
export interface PickerFrame {
  relPath: string;
  name: string;
  meta: string;
  swatch: string;
  url?: string;
}

/** Shortest retake worth queuing. Under a latent frame (stride 8, so a third of
 * a second at 24fps) the freed window rounds away to nothing and the render
 * comes back as the original. */
export const MIN_RETAKE_SEC = 8 / 24;

/** The relay quantises beats to latent frames (stride 8), so a beat under 8
 * pixel frames can't get one of its own — at 24fps that's a third of a second. */
export const MIN_BEAT_SEC = 8 / 24;

/** How much open air on the audio lane before LTX starts improvising into it.
 * Measured 2026-07-25 on the breakroom two-shot: 0.7s holes came back silent,
 * a 2.7s hole came back as invented speech with matching mouth movement. */
export const IMPROV_GAP_SEC = 1.5;

/** The catalog offers a fixed ladder of lengths, so a composed shot lands on
 * the shortest one that still holds it (never shorter — a cut-off last line is
 * worse than a second of air). */
export function snapDuration(sec: number, ladder: string[], fallback: string): string {
  const fits = ladder.filter((d) => parseInt(d) >= sec);
  return fits[0] ?? ladder[ladder.length - 1] ?? fallback;
}

export const fmtTime = (sec: number) => `${sec.toFixed(1)}s`;
export const clampSec = (sec: number, max: number) =>
  Math.min(max, Math.max(0, Number.isFinite(sec) ? sec : 0));

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
export const selectInput =
  "truncate rounded-md border border-cream/10 bg-ink py-1 pl-1.5 pr-4 text-2xs " +
  "text-cream outline-none focus:border-gold/40";

export function Select({
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
        className="flex w-full items-center gap-2 rounded-xl border border-cream/10 bg-surface px-3 py-2 text-xs text-cream/85 transition hover:border-gold/35"
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
                "flex w-full items-center gap-2 px-3 py-2 text-left text-xs tabular-nums transition hover:bg-cream/5",
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

/** A cinematography-bank picker. Values are bank ids ("ws", "push-in"); empty
 * means the beat says nothing about the camera and LTX keeps the last one. */
export function BankSelect({
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

export function PickerHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky top-0 bg-raised px-3 py-1 text-[9px] uppercase tracking-wider text-fog/60">
      {children}
    </div>
  );
}

/** How long each take runs. Nothing on disk records it — the library scans
 * files, it doesn't ffprobe them — and the lane can't lay a take out without
 * it, so the browser loads the metadata (not the audio) and we remember what
 * it said. A take that fails to load is remembered as 0 so it's asked once,
 * and shows on the lane as a marker rather than a block. */
export function useTakeDurations(sources: { relPath: string; url?: string }[]) {
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
