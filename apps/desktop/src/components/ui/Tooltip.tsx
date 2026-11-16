/* shadcn/ui's Tooltip, themed to Aurea's tokens.
 * https://ui.shadcn.com/docs/components/tooltip — plus `Tip`, a one-liner
 * for the common case ("label this icon button"). Prefer it over `title=` on
 * chrome: the native title waits ~1s, renders in the OS's light theme and
 * can't show a shortcut. One TooltipProvider sits at the app root. */

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { cn } from "./cn";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-[var(--z-tooltip)] max-w-[280px] rounded-lg border border-cream/10 bg-[#232327] px-2.5 py-1.5",
          "text-xs leading-snug text-cream shadow-[0_10px_30px_-8px_rgba(0,0,0,0.8)]",
          "origin-[var(--radix-tooltip-content-transform-origin)]",
          "data-[state=delayed-open]:animate-[aurea-pop-in_var(--dur-fast)_var(--ease-out-quart)]",
          "data-[state=instant-open]:animate-[aurea-pop-in_var(--dur-fast)_var(--ease-out-quart)]",
          "data-[state=closed]:animate-[aurea-pop-out_var(--dur-fast)_ease-in]",
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

/** Wrap one focusable element: `<Tip content="Collapse" shortcut="Ctrl B"><button/></Tip>` */
export function Tip({
  content,
  shortcut,
  side = "top",
  align,
  disabled,
  children,
}: {
  content: ReactNode;
  shortcut?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** render the child bare (e.g. the label is already visible) */
  disabled?: boolean;
  children: ReactElement;
}) {
  if (disabled || !content) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align}>
        <span className="flex items-center gap-2.5">
          <span>{content}</span>
          {shortcut && (
            <kbd className="rounded border border-cream/15 bg-ink/50 px-1 font-sans text-2xs text-fog">
              {shortcut}
            </kbd>
          )}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
