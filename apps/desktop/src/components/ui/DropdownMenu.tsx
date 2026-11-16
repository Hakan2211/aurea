/* shadcn/ui's DropdownMenu, themed to Aurea's tokens.
 *
 * Same structure and API as https://ui.shadcn.com/docs/components/dropdown-menu
 * (Radix underneath: keyboard nav, typeahead, focus return, portal, collision
 * handling). Shares its floating surface with Select and Popover so every
 * menu in the app looks like one family. */

import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

/** the floating surface every menu, select and popover sits on */
export const floatingSurface =
  "z-[var(--z-modal)] overflow-hidden rounded-xl border border-cream/10 bg-raised/95 text-cream backdrop-blur-xl " +
  "shadow-[0_24px_60px_-16px_rgba(0,0,0,0.85),0_0_0_1px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(237,234,228,0.04)] " +
  "data-[state=open]:animate-[aurea-pop-in_var(--dur)_var(--ease-out-quart)] " +
  "data-[state=closed]:animate-[aurea-pop-out_var(--dur-fast)_ease-in] " +
  "[-webkit-app-region:no-drag]";

/** one row in any of those surfaces */
export const floatingItem =
  "relative flex cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-cream outline-none " +
  "transition-colors duration-[var(--dur-fast)] data-[highlighted]:bg-cream/[0.06] " +
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-45 [&_svg]:shrink-0";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;
export const DropdownMenuSub = Menu.Sub;
export const DropdownMenuRadioGroup = Menu.RadioGroup;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        sideOffset={sideOffset}
        className={cn(
          floatingSurface,
          "min-w-[12rem] origin-[var(--radix-dropdown-menu-content-transform-origin)] p-1",
          "max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto",
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  );
}

export function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  hint,
  children,
  ...props
}: ComponentProps<typeof Menu.Item> & {
  inset?: boolean;
  variant?: "default" | "danger";
  /** a muted second line. Use it for why an item is disabled: a disabled
   * Radix item takes no pointer events, so a `title` there never shows. */
  hint?: ReactNode;
}) {
  return (
    <Menu.Item
      className={cn(
        floatingItem,
        inset && "pl-8",
        variant === "danger" && "text-[#f0a89d] data-[highlighted]:bg-ember/15",
        hint != null && "group items-start data-[disabled]:opacity-100",
        className,
      )}
      {...props}
    >
      {hint != null ? (
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2.5 group-data-[disabled]:opacity-45">{children}</span>
          <span className="text-2xs leading-snug text-fog">{hint}</span>
        </span>
      ) : (
        children
      )}
    </Menu.Item>
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof Menu.CheckboxItem>) {
  return (
    <Menu.CheckboxItem className={cn(floatingItem, "pl-8", className)} {...props}>
      <span className="absolute left-2.5 flex h-4 w-4 items-center justify-center">
        <Menu.ItemIndicator>
          <Check size={14} className="text-gold" />
        </Menu.ItemIndicator>
      </span>
      {children}
    </Menu.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof Menu.RadioItem>) {
  return (
    <Menu.RadioItem className={cn(floatingItem, "pl-8", className)} {...props}>
      <span className="absolute left-2.5 flex h-4 w-4 items-center justify-center">
        <Menu.ItemIndicator>
          <span className="block h-1.5 w-1.5 rounded-full bg-gold" />
        </Menu.ItemIndicator>
      </span>
      {children}
    </Menu.RadioItem>
  );
}

export function DropdownMenuLabel({
  className,
  inset,
  ...props
}: ComponentProps<typeof Menu.Label> & { inset?: boolean }) {
  return (
    <Menu.Label
      className={cn(
        "px-2.5 pb-1 pt-2 text-2xs font-semibold uppercase tracking-[0.14em] text-fog",
        inset && "pl-8",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn("-mx-1 my-1 h-px bg-cream/[0.07]", className)} {...props} />;
}

export function DropdownMenuShortcut({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("ml-auto text-2xs tracking-wide text-fog", className)} {...props} />;
}

export function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof Menu.SubTrigger>) {
  return (
    <Menu.SubTrigger
      className={cn(floatingItem, "data-[state=open]:bg-cream/[0.06]", className)}
      {...props}
    >
      {children}
      <ChevronRight size={14} className="ml-auto text-fog" />
    </Menu.SubTrigger>
  );
}

export function DropdownMenuSubContent({ className, ...props }: ComponentProps<typeof Menu.SubContent>) {
  return (
    <Menu.Portal>
      <Menu.SubContent
        className={cn(
          floatingSurface,
          "min-w-[10rem] origin-[var(--radix-dropdown-menu-content-transform-origin)] p-1",
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  );
}
