/* shadcn/ui's Checkbox, themed to Aurea's tokens.
 * https://ui.shadcn.com/docs/components/checkbox — replaces the browser's
 * `accent-gold` native box, which rendered as a bright OS square on dark. */

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "./cn";

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "peer inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border border-cream/25 bg-ink/60 outline-none",
        "transition-[background,border-color,box-shadow] duration-[var(--dur-fast)]",
        "hover:border-gold/60 focus-visible:ring-2 focus-visible:ring-gold/30",
        "data-[state=checked]:border-gold data-[state=checked]:bg-gradient-to-b data-[state=checked]:from-gold data-[state=checked]:to-gold-deep",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-ink">
        <Check size={11} strokeWidth={3.25} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
