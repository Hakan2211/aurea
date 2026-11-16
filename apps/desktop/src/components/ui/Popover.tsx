/* shadcn/ui's Popover, themed to Aurea's tokens.
 * https://ui.shadcn.com/docs/components/popover — Radix underneath, so
 * outside-click, Escape, focus return and collision flipping come for free
 * (the queue pill used to hand-roll all four). */

import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ComponentProps } from "react";
import { cn } from "./cn";
import { floatingSurface } from "./DropdownMenu";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({
  className,
  align = "center",
  sideOffset = 8,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          floatingSurface,
          "w-72 origin-[var(--radix-popover-content-transform-origin)] rounded-panel p-4 outline-none",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
