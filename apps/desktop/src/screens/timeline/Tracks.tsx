/* The bottom half: lane headers on the left, ruler + lanes + playhead on the
 * right. Everything here is geometry off `pxPerSec`, so zoom is the only thing
 * that changes when the sequence gets long. */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Lock, Magnet, Plus, Scissors, Trash2, Volume2, VolumeX, ZoomIn, ZoomOut } from "lucide-react";
import type { Timeline, TimelineClip, TimelineTrack } from "@aurea/shared";
import { cx } from "@/components/ui";
import { Clip } from "./Clip";
import {
  HEADER_W,
  KIND,
  RULER_H,
  TRACK_H,
  ZOOM_MAX,
  ZOOM_MIN,
  clampZoom,
  type ResolvedAsset,
  snap,
  tickPlan,
  trackCode,
} from "./shared";

const pad2 = (n: number) => String(n).padStart(2, "0");
const rulerLabel = (t: number) => `${Math.floor(t / 60)}:${pad2(Math.round(t % 60))}`;
/** the zoom slider's fill, as a percentage of its range */
const zoomPct = (px: number) => ((px - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100;

export function Tracks({
  tl,
  pxPerSec,
  setPxPerSec,
  playhead,
  setPlayhead,
  playing,
  selected,
  onSelect,
  resolve,
  onPatchClip,
  onMoveClip,
  onApply,
  onRazor,
  onDelete,
  registerFit,
}: {
  tl: Timeline;
  pxPerSec: number;
  setPxPerSec: (fn: (z: number) => number) => void;
  playhead: number;
  setPlayhead: (t: number) => void;
  playing: boolean;
  selected: { track: string; clip: string } | null;
  onSelect: (sel: { track: string; clip: string } | null) => void;
  resolve: (relPath: string) => ResolvedAsset;
  onPatchClip: (trackId: string, clipId: string, patch: Partial<TimelineClip>) => void;
  onMoveClip: (trackId: string, clipId: string, laneOffset: number) => void;
  onApply: (next: Timeline) => void;
  onRazor: () => void;
  onDelete: () => void;
  /** hand "fit the cut on screen" up to the screen, which owns the F key */
  registerFit: (fn: () => void) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [magnetic, setMagnetic] = useState(true);
  const [guide, setGuide] = useState<number | null>(null);

  const end = tl.tracks.reduce(
    (m, t) => Math.max(m, t.clips.reduce((n, c) => Math.max(n, c.start + c.duration), 0)),
    0,
  );
  const width = Math.max(960, (end + 8) * pxPerSec);
  const stackH = tl.tracks.length * TRACK_H;
  const { major, minor } = tickPlan(pxPerSec);

  const fit = () => {
    const w = scroller.current?.clientWidth ?? 900;
    setPxPerSec(() => clampZoom((w - 40) / Math.max(1, end)));
    scroller.current?.scrollTo({ left: 0 });
  };
  registerFit(fit);

  /** every clip edge except the dragged one, plus the playhead and the head */
  const snapTargets = (skipClip: string) =>
    magnetic
      ? [
          0,
          playhead,
          ...tl.tracks.flatMap((t) =>
            t.clips.flatMap((c) => (c.id === skipClip ? [] : [c.start, c.start + c.duration])),
          ),
        ]
      : [];

  /* keep the playhead on screen while the transport runs — the cut scrolls
   * under a still playhead once it reaches 60% of the viewport */
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    const x = playhead * pxPerSec;
    if (x < el.scrollLeft + 40 || x > el.scrollLeft + el.clientWidth - 120)
      el.scrollTo({ left: Math.max(0, x - el.clientWidth * 0.6) });
  }, [playhead, playing, pxPerSec]);

  /* ---- navigation: pan and zoom ----
   * Zooming from the slider alone means the cut jumps around under you. Every
   * zoom keeps a point in TIME pinned: the cursor when you zoom with the wheel,
   * the middle of the view otherwise. */
  const pxRef = useRef(pxPerSec);
  const prevPx = useRef(pxPerSec);
  /** what the next zoom should hold still: this time, at this offset into the view */
  const anchor = useRef<{ time: number; offsetPx: number } | null>(null);
  pxRef.current = pxPerSec;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || prevPx.current === pxPerSec) return;
    const hold = anchor.current ?? {
      time: (el.scrollLeft + el.clientWidth / 2) / prevPx.current,
      offsetPx: el.clientWidth / 2,
    };
    el.scrollLeft = Math.max(0, hold.time * pxPerSec - hold.offsetPx);
    anchor.current = null;
    prevPx.current = pxPerSec;
  }, [pxPerSec]);

  // native listener: React's onWheel is passive, and panning must preventDefault
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        // pinch / modifier-scroll zooms around the pointer
        e.preventDefault();
        const offsetPx = e.clientX - el.getBoundingClientRect().left;
        anchor.current = { time: (el.scrollLeft + offsetPx) / pxRef.current, offsetPx };
        const factor = Math.exp(-e.deltaY * 0.002);
        setPxPerSec((z) => clampZoom(z * factor));
        return;
      }
      // the lanes scroll sideways; a plain wheel is the natural way to travel
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!dx) return;
      e.preventDefault();
      el.scrollLeft += dx;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setPxPerSec]);

  /** drag the lanes themselves to travel — left-drag on empty lane space, or
   * the middle button anywhere. A drag that never moved is a click: deselect. */
  const pan = useRef<{ x: number; scroll: number; moved: boolean } | null>(null);
  const panHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      const el = scroller.current;
      if (!el || (e.button !== 0 && e.button !== 1)) return;
      pan.current = { x: e.clientX, scroll: el.scrollLeft, moved: false };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const p = pan.current;
      const el = scroller.current;
      if (!p || !el) return;
      const dx = e.clientX - p.x;
      if (Math.abs(dx) > 3) p.moved = true;
      el.scrollLeft = p.scroll - dx;
    },
    onPointerUp: () => {
      const p = pan.current;
      pan.current = null;
      if (p && !p.moved) onSelect(null);
    },
  };

  /* ---- scrubbing: the ruler, the playhead puck and empty lane space all
   * drive the same seek, with pointer capture so the drag survives leaving
   * the element ---- */
  const seek = (clientX: number) => {
    const rect = content.current?.getBoundingClientRect();
    if (!rect) return;
    setPlayhead(snap(Math.max(0, (clientX - rect.left) / pxPerSec)));
  };
  const scrubHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      seek(e.clientX);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (e.buttons === 1) seek(e.clientX);
    },
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#0b0b0d]">
      {/* ---- lane toolbar ---- */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b hairline px-3">
        <ToolButton icon={Scissors} label="Split at playhead (S)" onClick={onRazor} disabled={!selected} />
        <ToolButton icon={Trash2} label="Delete clip (⌫)" onClick={onDelete} disabled={!selected} danger />
        <span className="mx-1 h-4 w-px bg-cream/10" />
        <ToolButton
          icon={Magnet}
          label={magnetic ? "Snapping on — clips stick to edges and the playhead" : "Snapping off"}
          onClick={() => setMagnetic((m) => !m)}
          active={magnetic}
        />
        <span className="ml-3 hidden text-2xs text-fog/45 lg:inline">
          drag the lanes to travel · scroll to pan · ⌘/⌥-scroll to zoom
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <span className="mr-1 text-2xs tabular-nums text-fog/70">{Math.round(pxPerSec)} px/s</span>
          <ToolButton icon={ZoomOut} label="Zoom out (−)" onClick={() => setPxPerSec((z) => clampZoom(z / 1.5))} />
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={1}
            value={Math.round(pxPerSec)}
            onChange={(e) => {
              const v = Number(e.target.value);
              setPxPerSec(() => v);
            }}
            title="Zoom"
            className="aurea-slider w-28"
            style={{
              background: `linear-gradient(to right, var(--color-gold) ${zoomPct(pxPerSec)}%, color-mix(in srgb, var(--color-cream) 12%, transparent) ${zoomPct(pxPerSec)}%)`,
            }}
          />
          <ToolButton icon={ZoomIn} label="Zoom in (+)" onClick={() => setPxPerSec((z) => clampZoom(z * 1.5))} />
          <button
            onClick={fit}
            title="Fit the whole cut on screen (F)"
            className="rounded-md border border-cream/10 px-2 py-1 text-2xs font-medium text-fog transition hover:border-gold/40 hover:text-gold"
          >
            Fit
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* ---- lane headers ---- */}
        <div
          style={{ width: HEADER_W }}
          className="shrink-0 overflow-hidden border-r hairline bg-[#0e0e10]"
        >
          <div style={{ height: RULER_H }} className="border-b border-cream/8" />
          {tl.tracks.map((track, ti) => {
            const kind = KIND[track.kind];
            const extra = tl.tracks.findIndex((t) => t.kind === track.kind) !== ti;
            const active = selected?.track === track.id;
            return (
              <div
                key={track.id}
                style={{ height: TRACK_H }}
                className={cx(
                  "group relative flex flex-col justify-center gap-1.5 border-b border-cream/5 px-3 transition-colors duration-150",
                  active ? "bg-cream/[0.04]" : "hover:bg-cream/[0.02]",
                )}
              >
                <span
                  style={{ background: kind.accent, opacity: active ? 0.9 : 0.35 }}
                  className="absolute inset-y-2 left-0 w-[2px] rounded-full transition-opacity"
                />
                <div className="flex items-center gap-1.5">
                  <span
                    style={{
                      color: kind.accent,
                      borderColor: `${kind.accent}66`,
                      background: `${kind.accent}14`,
                    }}
                    className="shrink-0 rounded border px-1 py-px text-[8.5px] font-bold tabular-nums tracking-wide"
                  >
                    {trackCode(tl, ti)}
                  </span>
                  <span
                    title={
                      extra && track.kind === "video"
                        ? "Clips here appear over the tracks above"
                        : track.name
                    }
                    className="min-w-0 flex-1 truncate text-[11px] font-medium capitalize text-cream/85"
                  >
                    {track.name}
                  </span>
                  {extra && track.kind === "video" && (
                    <Lock size={9} className="shrink-0 text-fog/40" aria-hidden />
                  )}
                  {extra && track.clips.length === 0 && (
                    <button
                      onClick={() =>
                        onApply({ ...tl, tracks: tl.tracks.filter((t) => t.id !== track.id) })
                      }
                      title="Remove empty track"
                      className="shrink-0 text-fog/0 transition group-hover:text-fog hover:text-ember!"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                  <button
                    onClick={() =>
                      onApply({
                        ...tl,
                        tracks: tl.tracks.map((t) =>
                          t.id === track.id ? { ...t, muted: !t.muted } : t,
                        ),
                      })
                    }
                    title={track.muted ? "Unmute" : "Mute"}
                    className={cx(
                      "shrink-0 transition",
                      track.muted ? "text-ember" : "text-fog/70 hover:text-cream",
                    )}
                  >
                    {track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={track.gain ?? 1}
                    disabled={track.muted}
                    title={`Volume ${Math.round((track.gain ?? 1) * 100)}% — preview and export`}
                    onChange={(e) =>
                      onApply({
                        ...tl,
                        tracks: tl.tracks.map((t) =>
                          t.id === track.id ? { ...t, gain: Number(e.target.value) } : t,
                        ),
                      })
                    }
                    className="aurea-slider h-[3px] flex-1 disabled:opacity-30"
                    style={{
                      background: `linear-gradient(to right, ${kind.accent} ${((track.gain ?? 1) / 2) * 100}%, color-mix(in srgb, var(--color-cream) 10%, transparent) ${((track.gain ?? 1) / 2) * 100}%)`,
                    }}
                  />
                  <span className="w-7 shrink-0 text-right text-[9px] tabular-nums text-fog/0 transition group-hover:text-fog/70">
                    {Math.round((track.gain ?? 1) * 100)}%
                  </span>
                </div>
              </div>
            );
          })}

          {/* one compact row — three stacked buttons would cost the preview
              50px of height for something clicked once a project */}
          <div className="flex h-[28px] items-center gap-1.5 px-3 text-[10px] font-medium">
            <Plus size={10} className="shrink-0 text-fog/50" />
            {(
              [
                ["video", "Video", "Add a video track — its clips composite over the tracks above (inserts, cutaways)"],
                ["voice", "Voice", "Add a voice track — dialogue and VO, mixed under the takes"],
                ["music", "Music", "Add a music track — score and stings, mixed under the takes"],
              ] as const
            ).map(([kind, label, title]) => (
              <button
                key={kind}
                onClick={() => onApply(withTrack(tl, kind, label))}
                title={title}
                className="text-fog/80 transition hover:text-gold"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ---- ruler + lanes ---- */}
        <div ref={scroller} className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div ref={content} style={{ width }} className="relative">
            {/* ruler */}
            <div
              style={{ height: RULER_H }}
              className="sticky top-0 z-20 cursor-ew-resize border-b border-cream/10 bg-[#0b0b0d]"
              {...scrubHandlers}
            >
              {Array.from({ length: Math.ceil(width / pxPerSec / minor) + 1 }, (_, i) => {
                const t = i * minor;
                const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
                return (
                  <span
                    key={i}
                    style={{ left: t * pxPerSec }}
                    className={cx(
                      "absolute bottom-0 w-px",
                      isMajor ? "h-2.5 bg-cream/25" : "h-1.5 bg-cream/10",
                    )}
                  >
                    {isMajor && (
                      <span className="absolute -top-[15px] left-1 whitespace-nowrap text-[9px] font-medium tabular-nums tracking-wide text-fog/80">
                        {rulerLabel(t)}
                      </span>
                    )}
                  </span>
                );
              })}
            </div>

            {/* lanes — clips stop the pointer, so a drag that starts on empty
                lane space pans the cut instead of selecting anything */}
            <div className="relative cursor-grab active:cursor-grabbing" {...panHandlers}>
              {tl.tracks.map((track, ti) => (
                <div
                  key={track.id}
                  style={{
                    height: TRACK_H,
                    backgroundImage: `repeating-linear-gradient(to right, rgba(237,234,228,0.045) 0 1px, transparent 1px ${major * pxPerSec}px)`,
                  }}
                  className={cx(
                    "relative border-b border-cream/5",
                    ti % 2 ? "bg-cream/[0.012]" : "bg-transparent",
                  )}
                >
                  {track.clips.map((clip) => (
                    <Clip
                      key={clip.id}
                      clip={clip}
                      pxPerSec={pxPerSec}
                      kind={track.kind}
                      asset={resolve(clip.asset)}
                      selected={selected?.track === track.id && selected.clip === clip.id}
                      muted={track.muted}
                      snapTargets={snapTargets(clip.id)}
                      onSelect={() => onSelect({ track: track.id, clip: clip.id })}
                      onPatch={(patch) => onPatchClip(track.id, clip.id, patch)}
                      onMoveVertical={(laneOffset) => onMoveClip(track.id, clip.id, laneOffset)}
                      onGuide={setGuide}
                    />
                  ))}
                </div>
              ))}
            </div>

            {/* magnetic guide */}
            {guide != null && (
              <div
                style={{ left: guide * pxPerSec, height: RULER_H + stackH }}
                className="pointer-events-none absolute top-0 z-20 w-px bg-cream/70 shadow-[0_0_8px_rgba(237,234,228,.6)]"
              />
            )}

            {/* playhead */}
            <div
              style={{ left: playhead * pxPerSec, height: RULER_H + stackH }}
              className="pointer-events-none absolute top-0 z-30 w-px bg-gold shadow-[0_0_10px_rgba(201,169,110,.55)]"
            >
              <div
                {...scrubHandlers}
                title="Drag to scrub"
                className="pointer-events-auto absolute -left-[7px] -top-px h-3.5 w-3.5 cursor-ew-resize rounded-[3px] bg-gold shadow-[0_1px_6px_rgba(0,0,0,.7)]"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** append a lane of `kind`, kept grouped with the others of its kind — among
 * video tracks array order still means "later composites on top" */
function withTrack(tl: Timeline, kind: TimelineTrack["kind"], label: string): Timeline {
  const count = tl.tracks.filter((t) => t.kind === kind).length;
  const at = tl.tracks.reduce((m, t, i) => (t.kind === kind ? i : m), -1);
  const tracks = [...tl.tracks];
  tracks.splice(at === -1 ? tracks.length : at + 1, 0, {
    id: Math.random().toString(36).slice(2, 10),
    kind,
    name: count === 0 ? label : `${label} ${count + 1}`,
    muted: false,
    gain: 1,
    clips: [],
  });
  return { ...tl, tracks };
}

function ToolButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
  danger,
}: {
  icon: typeof Scissors;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cx(
        "flex h-7 w-7 items-center justify-center rounded-md transition duration-150",
        active ? "bg-gold/15 text-gold" : "text-fog hover:bg-cream/5 hover:text-cream",
        danger && "hover:text-ember",
        "disabled:pointer-events-none disabled:opacity-25",
      )}
    >
      <Icon size={13} />
    </button>
  );
}
