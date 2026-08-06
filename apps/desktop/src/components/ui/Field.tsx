import type { ReactNode } from "react";
import { cx } from "./cx";
import { SectionLabel } from "./SectionLabel";

/* label + control + quiet hint — the repeated form-row pattern */
export function Field({
  label,
  hint,
  right,
  children,
  className,
}: {
  label: ReactNode;
  /** one line under the control — a constraint, a cost, a consequence */
  hint?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("space-y-1.5", className)}>
      <SectionLabel right={right}>{label}</SectionLabel>
      {children}
      {hint && <p className="text-2xs leading-relaxed text-fog/80">{hint}</p>}
    </div>
  );
}

/** the standard text input skin */
export const inputCls =
  "w-full rounded-card border border-cream/10 bg-ink/40 px-2.5 py-1.5 text-sm text-cream " +
  "placeholder:text-fog/60 transition-[border-color,box-shadow] focus:border-gold/50 focus:outline-none " +
  "focus:shadow-[0_0_0_3px_rgba(201,169,110,0.12),0_0_18px_rgba(201,169,110,0.08)]";
