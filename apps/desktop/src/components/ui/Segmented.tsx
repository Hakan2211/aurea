import type { ReactNode } from "react";
import { cx } from "./cx";

/* A segmented control — mutually exclusive options in one pill row. The
 * selected segment carries the gold; everything else stays quiet. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: ReactNode; title?: string; disabled?: boolean }>;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div
      className={cx(
        "inline-flex items-center gap-0.5 rounded-pill border border-cream/10 bg-ink/40 p-0.5",
        disabled && "opacity-40",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          disabled={disabled || o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-pill px-2.5 py-1 text-xs font-medium transition duration-[var(--dur-fast)]",
            o.value === value
              ? "bg-gradient-to-b from-gold to-gold-deep text-ink"
              : "text-fog hover:text-cream",
            o.disabled && "cursor-not-allowed opacity-40",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
