import { useRef, useState } from "react";
import { Play, Star } from "lucide-react";
import { cx } from "@/components/ui";
import type { VideoTake } from "@/data/sample";

/** m:ss off the loaded clip — the strip only ever shows a length it measured */
function fmtDur(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function TakeCard({
  take,
  active,
  starred,
  index,
  onSelect,
  onStar,
}: {
  take: VideoTake;
  active: boolean;
  starred: boolean;
  /** position in the strip — the zero-padded slate number */
  index?: number;
  onSelect: () => void;
  onStar: () => void;
}) {
  const hoverRef = useRef<HTMLVideoElement>(null);
  /* nothing on disk records a take's length, so the strip reads it off the
   * metadata it already loads for the hover scrub */
  const [dur, setDur] = useState<number | null>(null);

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
        "group relative w-[184px] shrink-0 cursor-pointer overflow-hidden rounded-xl border transition",
        active
          ? "border-gold/60 shadow-[0_0_18px_rgba(201,169,110,0.18)]"
          : "border-cream/10 hover:border-cream/25",
      )}
    >
      {/* frame */}
      <div className="relative aspect-video w-full">
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
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d) && d > 0) setDur(d);
            }}
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
            starred
              ? "bg-ink/60 text-gold backdrop-blur-sm"
              : "text-cream/60 opacity-0 group-hover:opacity-100 hover:text-gold",
          )}
        >
          <Star size={13} fill={starred ? "currentColor" : "none"} />
        </button>
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink/60 text-cream backdrop-blur">
            <Play size={14} className="ml-0.5" />
          </span>
        </span>
      </div>

      {/* slate strip — the take's own line, on its own surface, so the numeral
        * and length read against a solid background instead of whatever the
        * frame happens to be */}
      <div
        className={cx(
          "flex items-center gap-1.5 border-t px-2 py-1.5 transition",
          active ? "border-gold/30 bg-gold/12" : "border-cream/8 bg-[#17171a]",
        )}
      >
        {index != null && (
          <span
            className={cx(
              "shrink-0 rounded px-1.5 py-px text-[10px] font-semibold tabular-nums",
              active ? "bg-gold text-ink" : "bg-cream/12 text-cream/80",
            )}
          >
            {String(index + 1).padStart(2, "0")}
          </span>
        )}
        <span
          className={cx(
            "min-w-0 flex-1 truncate text-[11px] font-medium",
            active ? "text-gold" : "text-cream/80",
          )}
        >
          {take.label}
        </span>
        <span
          className={cx(
            "shrink-0 text-[10px] tabular-nums",
            active ? "text-gold/80" : "text-fog",
          )}
        >
          {dur != null ? fmtDur(dur) : "--:--"}
        </span>
      </div>
    </div>
  );
}
