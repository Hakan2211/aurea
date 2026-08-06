import { cx } from "./cx";

/* A labelled range input in the house skin — gold fill up to the thumb. */
export function Slider({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.05,
  className,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  disabled?: boolean;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cx("aurea-slider w-full", disabled && "opacity-40", className)}
      style={{
        background: `linear-gradient(to right, var(--color-gold) ${pct}%, color-mix(in srgb, var(--color-cream) 12%, transparent) ${pct}%)`,
      }}
    />
  );
}
