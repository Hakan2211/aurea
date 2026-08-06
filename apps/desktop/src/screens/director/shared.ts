/* Director — bits the chat pane, the board pane and the slide-over inspector
 * all need. Kept tiny on purpose: this is the merged screen's vocabulary
 * (shot codes, status colours), not a second design system. */

import type { ShotStatus } from "@aurea/shared";

export const STATUS_TONE: Record<ShotStatus, "muted" | "violet" | "gold" | "ember" | "sage"> = {
  draft: "muted",
  boarded: "violet",
  generated: "gold",
  synced: "ember",
  approved: "sage",
};

export const pad2 = (n: number) => String(n).padStart(2, "0");

/** S01-02 — scene and shot are both 1-based positions, not ids */
export const shotCode = (sceneIdx: number, shotIdx: number) =>
  `S${pad2(sceneIdx + 1)}-${pad2(shotIdx + 1)}`;

/** which shot the chat is acting on — the chip above the composer */
export interface ShotContext {
  shotId: string;
  code: string;
  /** slugline of the scene the shot sits in, for the chip's second half */
  scene: string;
  title: string;
}

export const fieldLabel =
  "mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-fog";
export const textInput =
  "w-full rounded-lg border border-cream/10 bg-ink/60 px-2.5 py-1.5 text-[12px] text-cream " +
  "outline-none placeholder:text-fog/60 focus:border-gold/40";
export const selectInput =
  "w-full rounded-md border border-cream/10 bg-ink px-2 py-1 text-[11px] text-cream outline-none focus:border-gold/40";
