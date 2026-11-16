/* shadcn's `cn`: clsx-style joining + tailwind-merge, so a caller's className
 * actually overrides the primitive's defaults instead of racing it in the
 * stylesheet. Used by the shadcn-derived primitives in this folder; the rest
 * of the app keeps the plain `cx`.
 *
 * tailwind-merge must be told about our custom tokens, or it reads
 * `text-2xs` as a colour and silently drops it next to `text-cream`. */

import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["2xs", "display"],
      radius: ["card", "panel", "pill"],
      spacing: ["panel-sm", "panel-md", "panel-lg"],
    },
  },
});

export function cn(...parts: Array<string | false | null | undefined>) {
  return twMerge(parts.filter(Boolean).join(" "));
}
