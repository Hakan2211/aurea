/* Studio — the vocabulary the merged screen's panes share (2026-08-06 route
 * merge). Script view, Board view, the rail, the inspector and the writers'
 * rail all speak in shot codes, status colours and the same quiet field
 * classes; keeping them here stops the merge from growing two dialects. */

import type { Episode, ShotStatus } from "@aurea/shared";

export const STATUS: ShotStatus[] = ["draft", "boarded", "generated", "synced", "approved"];

export const STATUS_TONE: Record<ShotStatus, "muted" | "violet" | "gold" | "ember" | "sage"> = {
  draft: "muted",
  boarded: "violet",
  generated: "gold",
  synced: "ember",
  approved: "sage",
};

export const STATUS_DOT: Record<ShotStatus, string> = {
  draft: "bg-fog",
  boarded: "bg-[#a99bee]",
  generated: "bg-gold",
  synced: "bg-[#e07a6b]",
  approved: "bg-sage",
};

export const pad2 = (n: number) => String(n).padStart(2, "0");

/** S01-02 — scene and shot are both 1-based positions, not ids */
export const shotCode = (sceneIdx: number, shotIdx: number) =>
  `S${pad2(sceneIdx + 1)}-${pad2(shotIdx + 1)}`;

export const lineId = () => `l-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** anchors both views scroll to — the same shot in Script and in Board peek */
export const shotAnchor = (id: string) => `shot-${id}`;
export const sceneAnchor = (id: string) => `scene-${id}`;

export const sectionLabel = "text-[10px] font-semibold uppercase tracking-[0.16em] text-fog";
export const fieldLabel =
  "mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-fog";
export const textInput =
  "w-full rounded-lg border border-cream/10 bg-ink/60 px-2.5 py-1.5 text-[12px] text-cream " +
  "outline-none placeholder:text-fog/60 focus:border-gold/40";
export const textArea = `${textInput} min-h-[52px] resize-y leading-relaxed`;
export const selectInput =
  "w-full rounded-md border border-cream/10 bg-ink px-2 py-1 text-[11px] text-cream outline-none focus:border-gold/40";
/** editable text that reads as typeset script until focused */
export const quiet =
  "w-full rounded-md border border-transparent bg-transparent outline-none transition " +
  "focus:border-cream/10 focus:bg-ink/60 placeholder:text-fog/50";
/** auto-growing textarea — Chromium's field-sizing keeps it exactly text-height */
export const grow = "resize-none [field-sizing:content]";

/** dialogue at ~150 wpm plus a beat for every action line */
export function scriptStats(episode: Episode | null) {
  if (!episode) return { scenes: 0, shots: 0, dialogueLines: 0, approved: 0, runtime: "0:00" };
  const shots = episode.scenes.flatMap((s) => s.shots);
  const lines = shots.flatMap((s) => s.scriptLines);
  const dialogue = lines.filter((l) => l.character);
  const words = dialogue.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);
  const seconds = Math.round(words / 2.5 + (lines.length - dialogue.length) * 2);
  return {
    scenes: episode.scenes.length,
    shots: shots.length,
    dialogueLines: dialogue.length,
    approved: shots.filter((s) => s.status === "approved").length,
    runtime: `${Math.floor(seconds / 60)}:${pad2(seconds % 60)}`,
  };
}

/** the shot the two views agree on, located by walking the episode once */
export interface Located {
  scene: Episode["scenes"][number];
  sceneIdx: number;
  shot: Episode["scenes"][number]["shots"][number];
  shotIdx: number;
}

export function locateShot(episode: Episode | null, shotId: string | null): Located | null {
  if (!episode || !shotId) return null;
  for (const [sceneIdx, scene] of episode.scenes.entries()) {
    const shotIdx = scene.shots.findIndex((s) => s.id === shotId);
    if (shotIdx !== -1) return { scene, sceneIdx, shot: scene.shots[shotIdx], shotIdx };
  }
  return null;
}

/** first sentence of the personality note — the rail's one-line character
 * description (adopted from studio-v2); species is the fallback */
export function characterBlurb(personality: string, species: string) {
  const first = personality.split(/(?<=[.!?])\s/)[0]?.trim();
  return first || species || "—";
}
