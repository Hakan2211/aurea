import type { ReactNode } from "react";
import { cx } from "./cx";

/* The one card surface. The app's ~4 ad-hoc variants (surface/raised ×
 * radius-lg/xl × border 10/12) collapse into three named looks. */
const variants = {
  flat: "border border-cream/10 bg-surface",
  raised: "border border-cream/10 bg-raised",
  /* the focus tier — hero cards, the selected thing, the active render */
  elevated:
    "border border-gold/20 bg-raised shadow-[0_12px_40px_rgba(0,0,0,0.45),0_0_24px_rgba(201,169,110,0.06)]",
  glass: "glass",
} as const;

export function Card({
  variant = "flat",
  className,
  children,
  onClick,
}: {
  variant?: keyof typeof variants;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cx("rounded-card", variants[variant], onClick && "cursor-pointer", className)}
    >
      {children}
    </div>
  );
}

/** a screen column — the larger radius, usually width panel-sm/md/lg */
export function Panel({
  variant = "flat",
  className,
  children,
}: {
  variant?: keyof typeof variants;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cx("rounded-panel", variants[variant], className)}>{children}</div>;
}
