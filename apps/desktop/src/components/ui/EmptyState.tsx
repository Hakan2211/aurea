import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";

/* The one shape every "nothing here yet" screen takes (UI-SIMPLIFY Stage 4):
 * what this screen is for, why it is empty, and one button that starts it.
 * A blank pane with a grey sentence is a dead end; this is a door. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  secondary,
  className,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  /** one or two sentences: what the screen is for and how it fills */
  children?: ReactNode;
  /** the primary button (a GoldButton) */
  action?: ReactNode;
  /** a quieter second way in (a GhostButton or a link) */
  secondary?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center",
        className,
      )}
    >
      {Icon && <Icon size={28} strokeWidth={1.5} className="text-gold/70" />}
      <h2 className="font-serif text-xl text-cream">{title}</h2>
      {children && <div className="max-w-[440px] text-sm leading-relaxed text-fog">{children}</div>}
      {(action || secondary) && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondary}
        </div>
      )}
    </div>
  );
}
