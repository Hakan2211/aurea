import { useRef } from "react";
import { cx } from "./cx";

/* A draggable 0..1 track — a transport's scrubber and its volume slider.
 * Distinct from Slider: that one is an <input type=range> for a *value* you
 * set, this is a thin progress line you drag through a *position*, with the
 * thumb only appearing under the pointer. Built for the Voice-lab player bar;
 * shared the moment Music lab grew a transport of its own. */
export function ScrubBar({
  value,
  onSeek,
  className,
  tone = "gold",
  title,
}: {
  value: number;
  onSeek: (fraction: number) => void;
  className?: string;
  tone?: "gold" | "quiet";
  title?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pct = Math.min(100, Math.max(0, value * 100));
  const pick = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (clientX - r.left) / r.width)));
  };
  return (
    <div
      ref={ref}
      title={title}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        pick(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e.clientX);
      }}
      className={cx("group relative cursor-pointer touch-none py-2", className)}
    >
      <div className="h-1 w-full overflow-hidden rounded-full bg-cream/8">
        <div
          className={cx(
            "h-full rounded-full",
            tone === "gold" ? "bg-gradient-to-r from-gold-deep to-gold" : "bg-gold/70",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-gold opacity-0 shadow transition group-hover:opacity-100"
        style={{ left: `calc(${pct}% - 5px)` }}
      />
    </div>
  );
}
