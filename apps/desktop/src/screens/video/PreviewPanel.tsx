import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ListPlus,
  Maximize2,
  Minimize2,
  MoreVertical,
  Pause,
  Play,
  Scissors,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { downloadAsset, useLikes, useRemoveAssets, useSendToTimeline, useVideoLab } from "@/hooks";
import { cx } from "@/components/ui";
import { useVideoPlayer, type VideoPlayer } from "@/components/useVideoPlayer";
import { TakeCard } from "./TakeCard";
import { MIN_RETAKE_SEC, fmtTime, type RetakeDraft } from "./shared";

/** the frame shape as a cutting room names it — nearest common ratio, or the
 * reduced fraction when the take is some other shape entirely */
function aspectName(w: number, h: number): string {
  const known: Array<[string, number]> = [
    ["16:9", 16 / 9],
    ["9:16", 9 / 16],
    ["1:1", 1],
    ["4:3", 4 / 3],
    ["3:4", 3 / 4],
    ["21:9", 21 / 9],
  ];
  const r = w / h;
  const hit = known.find(([, v]) => Math.abs(v - r) < 0.02);
  if (hit) return hit[0];
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(w, h) || 1;
  return `${w / g}:${h / g}`;
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

/** The takes rail. Cards keep a real size instead of dividing whatever width is
 * left between them, so the strip scrolls — and the arrows only appear when
 * there is somewhere to scroll to. */
function TakeStrip({ children }: { children: React.ReactNode }) {
  const railRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const next = {
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    };
    // a fresh object every render would loop the layout effect below
    setEdges((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
  }, []);

  // children change with the library, so re-measure on every render pass
  useLayoutEffect(measure);
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const page = (dir: -1 | 1) => {
    const el = railRef.current;
    if (el) el.scrollBy({ left: dir * Math.max(200, el.clientWidth * 0.8), behavior: "smooth" });
  };

  const arrow =
    "absolute top-1/2 z-[2] flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-cream/15 bg-ink/85 text-cream/80 backdrop-blur transition hover:border-gold/45 hover:text-gold";

  return (
    <div className="relative">
      {edges.left && (
        <button onClick={() => page(-1)} title="Earlier takes" className={cx(arrow, "-left-1")}>
          <ChevronLeft size={14} />
        </button>
      )}
      <div
        ref={railRef}
        onScroll={measure}
        className="scrollbar-none flex gap-3 overflow-x-auto pb-1"
      >
        {children}
      </div>
      {edges.right && (
        <button onClick={() => page(1)} title="Later takes" className={cx(arrow, "-right-1")}>
          <ChevronRight size={14} />
        </button>
      )}
    </div>
  );
}

export function PreviewPanel({
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

  /* The slate's trailing fields. Duration and frame shape are measured off the
   * loaded video; the engine comes off the asset's sidecar. A field the file
   * can't answer is left out rather than guessed — a wrong "4K" on the slate
   * is worse than no resolution at all. */
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => setDims(null), [take?.url]);
  useEffect(() => {
    const el = player.ref.current;
    if (!el) return;
    const read = () =>
      el.videoWidth > 0 && setDims({ w: el.videoWidth, h: el.videoHeight });
    read();
    el.addEventListener("loadedmetadata", read);
    return () => el.removeEventListener("loadedmetadata", read);
  }, [player.ref, take?.url]);

  const slate = [
    take?.engine,
    player.durationSec > 0 ? `${player.durationSec.toFixed(1)}s` : undefined,
    dims ? aspectName(dims.w, dims.h) : undefined,
    dims ? `${dims.h}p` : undefined,
  ].filter((s): s is string => !!s);

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
      {/* the slate line — what is on screen, in the order a cutting room says
          it: which take, off which engine, how long, at what shape. Every
          field is dropped rather than faked when the file doesn't know it. */}
      <header className="flex items-center justify-between pb-3">
        <h2 className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 truncate text-2xs font-semibold uppercase tracking-[0.16em] text-cream">
            {take?.label ?? "No take"}
          </span>
          {slate.length > 0 && (
            <span className="min-w-0 truncate text-2xs tabular-nums text-fog">
              · {slate.join(" · ")}
            </span>
          )}
        </h2>
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
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-cream/85 transition hover:bg-cream/5 disabled:opacity-40"
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
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-cream/85 transition hover:bg-cream/5 disabled:opacity-40"
                >
                  <Scissors size={12} /> Fix this bit
                </button>
                <button
                  onClick={() => {
                    setMenu(false);
                    if (take?.url) void downloadAsset(take.url, `${take.label || "take"}.mp4`);
                  }}
                  disabled={!take?.url}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-cream/85 transition hover:bg-cream/5 disabled:opacity-40"
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
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-[#e07a6b] transition hover:bg-cream/5 disabled:opacity-40"
                >
                  <Trash2 size={12} /> {armed ? "Click again to confirm" : "Delete from disk"}
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* player — the frame is a rounded card and the transport sits UNDER it on
          its own surface, so nothing is ever drawn over the picture */}
      <div
        ref={stageRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="group/player flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border hairline bg-[#0b0b0c] outline-none focus-visible:border-gold/40"
      >
        <div className="relative min-h-0 flex-1 bg-black">
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

          {/* Chromium blocked unmuted autoplay — one click gets the sound back */}
          {player.autoplayBlocked && (
            <button
              onClick={player.toggleMute}
              className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-gold/40 bg-ink/80 px-3 py-1.5 text-xs text-gold backdrop-blur transition hover:bg-ink"
            >
              <VolumeX size={11} className="mr-1 inline" /> Muted — click for sound
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t hairline bg-[#141416] px-4 py-3">
          <button
            onClick={player.toggle}
            title={player.playing ? "Pause (Space)" : "Play (Space)"}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#dcc08e] via-gold to-gold-deep text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] transition hover:brightness-110"
          >
            {player.playing ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
          </button>
          <span className="shrink-0 text-xs tabular-nums text-cream/90">
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
          <span className="shrink-0 text-xs tabular-nums text-gold">
            {fmtTime(marking.atSec)} → {fmtTime(marking.atSec + marking.lengthSec)}
          </span>
          <button
            onClick={() => markEdge("in")}
            title="Start the window at the playhead"
            className="shrink-0 rounded-full border border-cream/15 px-2 py-0.5 text-2xs text-cream/80 transition hover:border-gold/50 hover:text-gold"
          >
            Set in
          </button>
          <button
            onClick={() => markEdge("out")}
            title="End the window at the playhead"
            className="shrink-0 rounded-full border border-cream/15 px-2 py-0.5 text-2xs text-cream/80 transition hover:border-gold/50 hover:text-gold"
          >
            Set out
          </button>
          <button
            onClick={() => player.seekFraction(marking.atSec / Math.max(player.durationSec, 0.1))}
            title="Jump to the start of the window"
            className="shrink-0 text-2xs text-fog transition hover:text-gold"
          >
            Review
          </button>
          <span className="min-w-0 flex-1 truncate text-right text-2xs text-fog/70">
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
          <h3 className="text-2xs font-semibold uppercase tracking-[0.16em] text-cream">
            Takes <span className="tabular-nums text-fog">({lab.takes.length})</span>
          </h3>
          <button
            onClick={() => navigate("/assets")}
            className="inline-flex items-center gap-0.5 text-2xs text-fog transition hover:text-gold"
          >
            View all takes <ChevronRight size={11} />
          </button>
        </div>
        <TakeStrip>
          {lab.takes.map((t, i) => (
            <TakeCard
              key={t.id}
              take={t}
              index={i}
              active={t.id === takeId}
              starred={t.relPath ? isLiked(t.relPath) : !!t.starred}
              onSelect={() => onSelect(t.id)}
              onStar={() => toggleLike(t.relPath)}
            />
          ))}
        </TakeStrip>
      </div>
    </section>
  );
}
