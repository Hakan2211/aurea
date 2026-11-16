/* shadcn/ui's Slider, themed to Aurea's tokens.
 * https://ui.shadcn.com/docs/components/slider — Radix underneath (keyboard
 * steps, PageUp/Down, Home/End). Keeps the old house API — a single number
 * in, a single number out — so every caller stays one line.
 *
 * Replaces the native range input, which needed a JS-painted gradient for
 * its fill and fell back to the OS slider wherever someone forgot the class. */

import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "./cn";

export function Slider({
  value,
  onChange,
  onCommit,
  min = 0,
  max = 1,
  step = 0.05,
  className,
  disabled,
  title,
  "aria-label": ariaLabel,
  size = "md",
  accent,
}: {
  value: number;
  onChange: (v: number) => void;
  /** fires once on release — for writes too costly to make on every step */
  onCommit?: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
  /** sm: inline in a dense row (timeline gain, preview volume) */
  size?: "sm" | "md";
  /** a CSS colour for the filled part — a track's own colour, say; gold otherwise */
  accent?: string;
}) {
  return (
    <SliderPrimitive.Root
      value={[value]}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      title={title}
      onValueChange={([v]) => onChange(v)}
      onValueCommit={onCommit ? ([v]) => onCommit(v) : undefined}
      className={cn(
        "group relative flex w-full touch-none select-none items-center",
        size === "sm" ? "h-4" : "h-5",
        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
        className,
      )}
    >
      <SliderPrimitive.Track
        className={cn(
          "relative grow overflow-hidden rounded-full bg-cream/12",
          size === "sm" ? "h-[3px]" : "h-1",
        )}
      >
        <SliderPrimitive.Range
          className="absolute h-full rounded-full bg-gradient-to-r from-gold-deep to-gold"
          style={accent ? { background: accent } : undefined}
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={ariaLabel ?? title}
        className={cn(
          "block rounded-full border-2 border-gold bg-cream shadow-[0_1px_6px_rgba(0,0,0,0.6)] outline-none",
          "transition-[transform,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out-quart)]",
          "hover:scale-110 focus-visible:ring-4 focus-visible:ring-gold/25 active:scale-95",
          size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5",
        )}
        style={accent ? { borderColor: accent } : undefined}
      />
    </SliderPrimitive.Root>
  );
}
