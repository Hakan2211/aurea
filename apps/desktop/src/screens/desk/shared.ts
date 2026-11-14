/* Production Desk — the desk's vocabulary. The board and drawer speak in
 * DERIVED stages (shotStage, P0.3), not persisted status: a column answers
 * "how far has this shot actually got", which the data on the shot proves. */

import type { ShotStage } from "@aurea/shared";

export const STAGES: ShotStage[] = ["script", "voiced", "boarded", "rendered", "approved"];

/* voiced borrows the mic-warm ember, boarded/rendered/approved keep the
 * studio board's colour language (violet = stills, gold = pixels, sage = done) */
export const STAGE_DOT: Record<ShotStage, string> = {
  script: "bg-fog",
  voiced: "bg-[#e07a6b]",
  boarded: "bg-[#a99bee]",
  rendered: "bg-gold",
  approved: "bg-sage",
};

export const STAGE_TONE: Record<ShotStage, "muted" | "ember" | "violet" | "gold" | "sage"> = {
  script: "muted",
  voiced: "ember",
  boarded: "violet",
  rendered: "gold",
  approved: "sage",
};

/** minutes per outstanding render — LTX 2.5 draft measured 3:34/4s (2026-09-01) */
export const EST_RENDER_MIN = 3.5;

/** "≈2h 06m" of renders still owed for n unrendered shots; null when none */
export function estRemaining(unrendered: number): string | null {
  if (!unrendered) return null;
  const min = Math.round(unrendered * EST_RENDER_MIN);
  if (min < 60) return `≈${min}m`;
  return `≈${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
}
