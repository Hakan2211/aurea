import type { ReactNode } from "react";

/* The design system's barrel. The core primitives (Chip, Progress, the two
 * buttons, Waveform) live here; the structural set added in the 2026-08
 * overhaul (Modal, SectionLabel, Toggle, Panel/Card, ScreenHeader, Field,
 * Segmented, ScrubBar, Slider, StatusBar) lives one folder down in ui/ and re-exports
 * through this file, so every screen keeps its single import path. */

export { cx } from "./ui/cx";
export { Modal, ModalHeader } from "./ui/Modal";
export { SectionLabel } from "./ui/SectionLabel";
export { Toggle } from "./ui/Toggle";
export { Card, Panel } from "./ui/Panel";
export { ScreenHeader } from "./ui/ScreenHeader";
export { Field, inputCls } from "./ui/Field";
export { Segmented } from "./ui/Segmented";
export { ScrubBar } from "./ui/ScrubBar";
export { Slider } from "./ui/Slider";
export { StatusBar } from "./ui/StatusBar";

import { cx } from "./ui/cx";

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
  onClick,
  active,
  title,
}: {
  tone?: ChipTone;
  children: ReactNode;
  className?: string;
  /** makes the chip a button */
  onClick?: () => void;
  /** selected state — gold ring + gold text, whatever the tone */
  active?: boolean;
  title?: string;
}) {
  const cls = cx(
    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide",
    chipTones[tone],
    active && "bg-gold/15 text-gold ring-1 ring-gold/50",
    onClick &&
      "cursor-pointer transition hover:ring-1 hover:ring-gold/30 " +
        (active ? "" : "hover:text-cream"),
    className,
  );
  if (onClick) {
    return (
      <button onClick={onClick} title={title} className={cls}>
        {children}
      </button>
    );
  }
  return (
    <span title={title} className={cls}>
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

/** Circular progress — the render queue's per-job ring. */
export function ProgressRing({
  value, // 0..100
  size = 34,
  stroke = 3,
  className,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  className?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      className={cx("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(237,234,228,0.1)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-gold)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped / 100)}
          className="transition-[stroke-dashoffset]"
        />
      </svg>
      <span
        className={cx(
          "absolute font-semibold tabular-nums text-cream/90",
          // the label has to grow with the ring or a big ring reads as empty
          size >= 40 ? "text-[11px]" : "text-[9px]",
        )}
      >
        {children ?? `${Math.round(clamped)}%`}
      </span>
    </div>
  );
}

export function GoldButton({
  children,
  className,
  onClick,
  disabled,
  title,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** what the button does, or why it's disabled — hover text */
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-[#dcc08e] via-gold to-gold-deep px-3 py-1.5",
        "text-[12px] font-semibold text-ink transition hover:brightness-110 active:brightness-95",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_10px_rgba(201,169,110,0.18)]",
        "hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_4px_18px_rgba(201,169,110,0.35)]",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:brightness-100",
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
  disabled,
  title,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** why the button is disabled, or what it does — hover text */
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-lg border border-cream/10 px-3 py-1.5",
        "text-[12px] font-medium text-cream/80 transition hover:border-gold/40 hover:text-gold",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-cream/10 disabled:hover:text-cream/80",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* Deterministic fake waveform (no Math.random — stable renders).
 *
 * The shape is doing real work: it's the only thing on a track row that looks
 * like *this* track. The first version was one sine plus per-bar noise on a
 * 0.25 floor, which gave a repeating comb of near-equal bars — no quiet
 * passages, no peaks, a visible period every ~18 bars, and at low heights the
 * rounded caps turned into a row of dots. What reads as music instead is a
 * fade-in/out envelope × two incommensurate slow waves (phrase and beat, so
 * nothing lines up twice) × fine grit, on a floor low enough that quiet parts
 * are hairlines. Accents every few bars give it punctuation. */
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
  // three phases pulled off the seed so two tracks never draw the same curve
  const phrasePhase = (seed % 97) / 97 * Math.PI * 2;
  const beatPhase = (seed % 61) / 61 * Math.PI * 2;
  const accentEvery = 5 + (seed % 4);
  for (let i = 0; i < bars; i++) {
    x = (x * 9301 + 49297) % 233280;
    const grit = 0.72 + 0.28 * (x / 233280);
    const p = bars > 1 ? i / (bars - 1) : 0;
    // just enough taper to top and tail the shape. Gentler ramps (14 / 7) read
    // as the track ending early: at 140 bars a 14% fade-out is 20 flat bars of
    // apparent silence hanging off the end of every row.
    const fade = Math.min(1, p * 20) * Math.min(1, (1 - p) * 16);
    // a shallow-ish phrase swell: any deeper and a trough that happens to land
    // near the end reads as the track stopping rather than getting quieter
    const phrase = 0.68 + 0.32 * Math.sin(p * Math.PI * 2 * 1.7 + phrasePhase);
    const beat = 0.74 + 0.26 * Math.sin(p * Math.PI * 2 * 11.3 + beatPhase);
    const accent = i % accentEvery === 0 ? 1.3 : 1;
    heights.push(Math.max(0.05, Math.min(1, fade * phrase * beat * grit * accent)));
  }
  // dense waveforms want hairline bars and near-zero gutters; the sparse ones
  // (a voice row's 54) keep the chunkier rhythm they were designed at
  const dense = bars > 80;
  return (
    /* bars must not be flex-shrunk to nothing — in a container narrower than
     * bars × width they used to vanish instead of clipping */
    <div
      className={cx(
        "flex h-8 items-center overflow-hidden",
        dense ? "gap-px" : "gap-[2px]",
        className,
      )}
    >
      {heights.map((h, i) => (
        <div
          key={i}
          className={cx(
            // grow to fill the container, never thinner than a hairline bar.
            // Square-ish caps, not rounded-full: a 2px bar at 6% height drawn
            // with a full radius is a dot, and a row of dots is not a waveform.
            "flex-1 rounded-[1px]",
            dense ? "min-w-px" : "min-w-[2px]",
            i / bars < played ? "bg-gold" : "bg-cream/22",
          )}
          style={{ height: `${h * 100}%` }}
        />
      ))}
    </div>
  );
}
