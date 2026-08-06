import type { ReactNode } from "react";
import { cx } from "./cx";

/* The standard screen header — the "where am I" bar four screens never had
 * and the other ten each built differently. Title in the editorial serif,
 * optional status line, actions right-aligned. */
export function ScreenHeader({
  title,
  sub,
  children,
  className,
}: {
  title: ReactNode;
  /** one quiet line under the title — a count, a state, a hint */
  sub?: ReactNode;
  /** right-aligned actions */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cx(
        "flex shrink-0 items-center gap-4 border-b hairline px-5 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="font-serif text-lg font-semibold leading-tight text-cream">{title}</h1>
        {sub && <p className="mt-0.5 truncate text-xs text-fog">{sub}</p>}
      </div>
      {children && <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>}
    </header>
  );
}
