import type { ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import { cx } from "./cx";

/* The one section-label element. Previously defined five times (ImageLab,
 * MusicLab, VideoLab, VoiceLab, AssetLibrary as PanelLabel, plus three more
 * spellings) with three different letter-spacings — this is the canonical one. */
export function SectionLabel({
  children,
  hint,
  right,
  step,
  className,
}: {
  children: ReactNode;
  /** show the little help affordance (hover text goes on the parent) */
  hint?: boolean;
  /** optional right-aligned slot — a count, a link, a clear button */
  right?: ReactNode;
  /** numbered-step rail — renders the circled gold numeral before the label */
  step?: number;
  className?: string;
}) {
  return (
    <div className={cx("flex items-center justify-between", className)}>
      <h3 className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.14em] text-fog">
        {step != null && <span className="step-numeral">{step}</span>}
        {children}
      </h3>
      {right ?? (hint ? <HelpCircle size={12} className="text-fog/50" /> : null)}
    </div>
  );
}
