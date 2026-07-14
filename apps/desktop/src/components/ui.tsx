import type { ReactNode } from "react";

/* Minimal primitives in the design-system-sheet style. Replaced by shadcn/ui
 * when the tRPC-backed app lands (PRD P0); kept dependency-light for the skeleton. */

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type ChipTone = "gold" | "muted" | "ember" | "sage" | "violet";

const chipTones: Record<ChipTone, string> = {
  gold: "bg-gold/15 text-gold",
  muted: "bg-cream/8 text-fog",
  ember: "bg-ember/20 text-[#e07a6b]",
  sage: "bg-sage/15 text-sage",
  violet: "bg-[#8b7bd8]/15 text-[#a99bee]",
};

export function Chip({
  tone = "muted",
  children,
  className,
}: {
  tone?: ChipTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide",
        chipTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Progress({
  value,
  className,
}: {
  value: number; // 0..100
  className?: string;
}) {
  return (
    <div className={cx("h-1 w-full overflow-hidden rounded-full bg-cream/8", className)}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-gold-deep to-gold transition-[width]"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export function GoldButton({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-gold to-gold-deep px-3 py-1.5",
        "text-[12px] font-semibold text-ink transition hover:brightness-110 active:brightness-95",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-lg border border-cream/10 px-3 py-1.5",
        "text-[12px] font-medium text-cream/80 transition hover:border-gold/40 hover:text-gold",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* Deterministic fake waveform (no Math.random — stable renders) */
export function Waveform({
  seed = 7,
  bars = 48,
  className,
  played = 0, // 0..1 — fraction rendered in gold
}: {
  seed?: number;
  bars?: number;
  className?: string;
  played?: number;
}) {
  const heights: number[] = [];
  let x = seed;
  for (let i = 0; i < bars; i++) {
    x = (x * 9301 + 49297) % 233280;
    const t = x / 233280;
    heights.push(0.25 + 0.75 * Math.abs(Math.sin(i * 0.35) * 0.6 + t * 0.4));
  }
  return (
    <div className={cx("flex h-8 items-center gap-[2px]", className)}>
      {heights.map((h, i) => (
        <div
          key={i}
          className={cx(
            "w-[2px] rounded-full",
            i / bars < played ? "bg-gold" : "bg-cream/25",
          )}
          style={{ height: `${h * 100}%` }}
        />
      ))}
    </div>
  );
}
