/* The labs' model / engine picker, built on the shadcn Select.
 *
 * Replaces a native <select> whose options were "label — note" run together
 * on one line. Here each model gets a name, its note on a second line, a
 * where-it-runs icon, and a badge when it can't run yet. Groups split "on your
 * GPU" from "cloud", so the price of a pick is visible before it is made.
 * Unavailable models stay pickable on purpose: the lab explains what's
 * missing (and the Generate button says how to fix it). */

import { Cloud, Cpu } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cx";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./Select";

export interface ModelOption {
  id: string;
  label: string;
  note?: string;
  /** false: listed, but needs an install or a key before it can render */
  available?: boolean;
}

/** "Krea 2 · local" → "Krea 2": the group header already says where it runs */
const shortName = (label: string) => label.replace(/\s*·\s*(local|cloud)\s*$/i, "");
const isCloudLabel = (label: string) => /·\s*cloud\s*$/i.test(label);

export function ModelSelect({
  value,
  onChange,
  models,
  cloudIds,
  missingLabel,
  placeholder = "Pick a model",
  className,
  contentClassName,
  warn,
  disableUnavailable,
}: {
  value: string;
  onChange: (id: string) => void;
  models: ModelOption[];
  /** which ids bill per run (labels ending "· cloud" count too) */
  cloudIds?: string[];
  /** badge text for an unavailable model, per where it runs */
  missingLabel?: (m: ModelOption, cloud: boolean) => ReactNode;
  placeholder?: string;
  className?: string;
  contentClassName?: string;
  /** amber edge on the trigger: the picked model can't run yet */
  warn?: boolean;
  /** grey out (rather than badge) models that can't run — for labs that have
   * no "picked but missing" state to explain it */
  disableUnavailable?: boolean;
}) {
  const cloud = (m: ModelOption) => !!cloudIds?.includes(m.id) || isCloudLabel(m.label);
  const local = models.filter((m) => !cloud(m));
  const remote = models.filter(cloud);
  const picked = models.find((m) => m.id === value);

  const item = (m: ModelOption) => {
    const isCloud = cloud(m);
    const missing = m.available === false;
    return (
      <SelectItem
        key={m.id}
        value={m.id}
        disabled={disableUnavailable && missing}
        description={m.note}
        aside={
          missing && (
            <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-2xs font-medium text-amber-300/90">
              {missingLabel?.(m, isCloud) ?? (isCloud ? "Needs key" : "Not installed")}
            </span>
          )
        }
      >
        {shortName(m.label)}
      </SelectItem>
    );
  };

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        title={picked?.note}
        className={cx("max-w-[260px]", warn && "border-amber-500/40", className)}
      >
        {picked &&
          (cloud(picked) ? (
            <Cloud size={13} className="shrink-0 text-gold/80" />
          ) : (
            <Cpu size={13} className="shrink-0 text-gold/80" />
          ))}
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className={cx("w-[340px]", contentClassName)}>
        {local.length > 0 && (
          <SelectGroup>
            <SelectLabel className="flex items-center gap-1.5">
              <Cpu size={11} /> On your GPU · free
            </SelectLabel>
            {local.map(item)}
          </SelectGroup>
        )}
        {local.length > 0 && remote.length > 0 && <SelectSeparator />}
        {remote.length > 0 && (
          <SelectGroup>
            <SelectLabel className="flex items-center gap-1.5">
              <Cloud size={11} /> Cloud · paid per run
            </SelectLabel>
            {remote.map(item)}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
