/* shadcn/ui's Select, themed to Aurea's tokens.
 *
 * Same structure and API as https://ui.shadcn.com/docs/components/select
 * (Radix Select underneath: keyboard nav, typeahead, focus management,
 * portal, collision handling), but in our palette: raised surface, hairline
 * borders, gold for the selected row, and our motion tokens. `cx` stands in
 * for shadcn's `cn`. Prefer this over a native <select> for anything with
 * more to say per option than one line of text. */

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";
import { cn } from "./cn";
import { floatingSurface } from "./DropdownMenu";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cx(
        "group inline-flex h-8 min-w-0 items-center justify-between gap-2 rounded-lg border border-cream/10 bg-surface px-2.5",
        "text-sm text-cream outline-none transition-colors duration-[var(--dur-fast)]",
        "hover:border-cream/20 focus-visible:border-gold/50 focus-visible:ring-2 focus-visible:ring-gold/20",
        "data-[state=open]:border-gold/40 data-[placeholder]:text-fog",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "[&>span]:min-w-0 [&>span]:truncate",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown
          size={14}
          className="shrink-0 text-fog transition-transform duration-[var(--dur-fast)] group-data-[state=open]:rotate-180"
        />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  sideOffset = 6,
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={sideOffset}
        className={cn(
          floatingSurface,
          "relative max-h-[min(var(--radix-select-content-available-height),480px)] min-w-[var(--radix-select-trigger-width)]",
          "origin-[var(--radix-select-content-transform-origin)]",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-fog">
          <ChevronUp size={14} />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-fog">
          <ChevronDown size={14} />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectLabel({ className, ...props }: ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cx(
        "px-2.5 pb-1 pt-2 text-2xs font-semibold uppercase tracking-[0.14em] text-fog",
        className,
      )}
      {...props}
    />
  );
}

/** One row. `children` is what the trigger shows once picked (ItemText);
 * `description` and `aside` only appear in the open list. */
export function SelectItem({
  className,
  children,
  description,
  aside,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item> & {
  description?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <SelectPrimitive.Item
      className={cx(
        "relative flex w-full cursor-default select-none items-start gap-2.5 rounded-lg py-2 pl-2.5 pr-8 outline-none",
        "text-sm text-cream transition-colors duration-[var(--dur-fast)]",
        "data-[highlighted]:bg-cream/[0.06] data-[state=checked]:bg-gold/[0.09]",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
        className,
      )}
      {...props}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium data-[state=checked]:text-gold">
            <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
          </span>
          {aside}
        </div>
        {description && <div className="mt-0.5 text-xs leading-snug text-fog">{description}</div>}
      </div>
      <span className="absolute right-2.5 top-2.5 flex items-center">
        <SelectPrimitive.ItemIndicator>
          <Check size={14} className="text-gold" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}

export function SelectSeparator({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator className={cx("mx-1 my-1 h-px bg-cream/[0.07]", className)} {...props} />;
}
