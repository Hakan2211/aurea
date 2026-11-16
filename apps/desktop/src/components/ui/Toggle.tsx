/* The one switch — shadcn/ui's Switch (https://ui.shadcn.com/docs/components/switch)
 * on Radix, behind the house API every caller already uses. */

import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "./cn";

export function Toggle({
  on,
  onChange,
  disabled,
  title,
  className,
  "aria-label": ariaLabel,
}: {
  on: boolean;
  onChange: () => void;
  disabled?: boolean;
  /** why it's disabled, or what it does — hover text */
  title?: string;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <SwitchPrimitive.Root
      checked={on}
      onCheckedChange={() => onChange()}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel ?? title}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-pill border border-transparent outline-none",
        "transition-[background,box-shadow] duration-[var(--dur)] ease-[var(--ease-out-quart)]",
        "focus-visible:ring-2 focus-visible:ring-gold/30",
        "data-[state=checked]:bg-gradient-to-b data-[state=checked]:from-gold data-[state=checked]:to-gold-deep",
        "data-[state=checked]:shadow-[0_0_14px_-2px_rgba(201,169,110,0.45)]",
        "data-[state=unchecked]:bg-cream/12 data-[state=unchecked]:hover:bg-cream/18",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.5)]",
          "transition-[transform,background] duration-[var(--dur)] ease-[var(--ease-spring)]",
          "data-[state=checked]:translate-x-[17px] data-[state=checked]:bg-ink",
          "data-[state=unchecked]:translate-x-0.5 data-[state=unchecked]:bg-cream/80",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
