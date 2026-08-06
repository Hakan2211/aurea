import type { ReactNode } from "react";
import { cx } from "./cx";

/* The bottom status strip several screens invented separately — quiet
 * key·value facts left, live state right. */
export function StatusBar({
  left,
  right,
  className,
}: {
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <footer
      className={cx(
        "flex h-8 shrink-0 items-center gap-4 border-t hairline px-4 text-2xs text-fog",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-4">{left}</div>
      <div className="ml-auto flex shrink-0 items-center gap-4">{right}</div>
    </footer>
  );
}
