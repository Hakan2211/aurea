/* The shadcn Select behind a native <select>'s API.
 *
 * Thirty-odd screens carried a raw <select>, which opens the operating
 * system's own list — light grey, square, system font — in the middle of a
 * dark gold UI. SelectBox takes the same props and the same <option>
 * children, so swapping one is a rename:
 *
 *   <SelectBox value={v} onChange={(e) => set(e.target.value)} className={selectInput}>
 *     <option value="">— none —</option>
 *     {xs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
 *   </SelectBox>
 *
 * …and renders the themed Radix list (keyboard, typeahead, collision
 * handling) instead. Radix forbids "" as an item value, so the empty
 * option rides a sentinel and is translated back on the way out. */

import * as SelectPrimitive from "@radix-ui/react-select";
import { ChevronDown } from "lucide-react";
import {
  Children,
  Fragment,
  isValidElement,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "./cn";
import { SelectContent, SelectItem } from "./Select";

const EMPTY = "\u0000aurea-empty";

interface OptionSpec {
  value: string;
  label: ReactNode;
  disabled?: boolean;
  /** an <option title> — shown as a second line in the open list */
  description?: string;
}

type OptionProps = { value?: string | number; children?: ReactNode; disabled?: boolean; title?: string };

function collectOptions(children: ReactNode, out: OptionSpec[] = []): OptionSpec[] {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<OptionProps & { children?: ReactNode }>;
    if (el.type === Fragment) {
      collectOptions(el.props.children, out);
    } else if (el.type === "option") {
      const label = el.props.children;
      const raw = el.props.value ?? (typeof label === "string" ? label : "");
      out.push({ value: String(raw), label, disabled: el.props.disabled, description: el.props.title });
    }
  });
  return out;
}

const encode = (v: string) => (v === "" ? EMPTY : v);
const decode = (v: string) => (v === EMPTY ? "" : v);

export function SelectBox({
  value,
  onChange,
  children,
  className,
  contentClassName,
  disabled,
  title,
  style,
  placeholder,
  id,
  "aria-label": ariaLabel,
}: {
  value: string | number;
  onChange: (e: { target: { value: string } }) => void;
  /** <option> elements — arrays, fragments and `cond && <option/>` all work */
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  disabled?: boolean;
  title?: string;
  style?: CSSProperties;
  placeholder?: ReactNode;
  id?: string;
  "aria-label"?: string;
}) {
  const options = collectOptions(children);
  const current = String(value);
  const known = options.some((o) => o.value === current);

  return (
    <SelectPrimitive.Root
      value={known ? encode(current) : undefined}
      onValueChange={(v) => onChange({ target: { value: decode(v) } })}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        id={id}
        title={title}
        aria-label={ariaLabel ?? title}
        style={style}
        className={cn(
          // default skin — the caller's className (a screen's input skin) wins
          "group inline-flex min-w-0 items-center justify-between gap-1.5 rounded-lg border border-cream/10 bg-ink/40 px-2.5 py-1.5",
          "text-left text-sm text-cream outline-none",
          className,
          // behaviour — always on, whatever the skin
          "cursor-pointer transition-[border-color,background,box-shadow] duration-[var(--dur-fast)]",
          "hover:border-cream/25 hover:bg-cream/[0.03] focus-visible:border-gold/50 focus-visible:ring-2 focus-visible:ring-gold/20",
          "data-[state=open]:border-gold/45 data-[placeholder]:text-fog",
          "disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-cream/10",
          "[&>span]:min-w-0 [&>span]:truncate",
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder ?? (known ? undefined : current || "Choose…")} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown
            size={13}
            className="-mr-0.5 shrink-0 text-fog transition-transform duration-[var(--dur)] ease-[var(--ease-out-quart)] group-data-[state=open]:rotate-180 group-hover:text-cream"
          />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectContent className={cn("w-max max-w-[min(440px,92vw)]", contentClassName)}>
        {options.map((o) => (
          <SelectItem
            key={encode(o.value)}
            value={encode(o.value)}
            disabled={o.disabled}
            description={o.description}
          >
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </SelectPrimitive.Root>
  );
}
