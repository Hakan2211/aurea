/* Studio — the writers' room panel. The old Writers Room's right rail, now the
 * *unselected* state of the shared right rail: with no shot picked you're
 * talking to the Director about the episode; pick a shot and the inspector
 * takes the slot. The prompts are unchanged — they drive production_* tool
 * calls whose results stream back into both views live. */

import { useState } from "react";
import { useNavigate } from "react-router";
import { Clapperboard, Square } from "lucide-react";
import type { Episode } from "@aurea/shared";
import { GhostButton } from "@/components/ui";
import { useChat } from "@/hooks";
import { sectionLabel } from "./shared";

const outlinePrompt = (episode: Episode, premise: string) =>
  [
    `Writers room — draft the OUTLINE for episode "${episode.title}" (episode id: ${episode.id}).`,
    `Premise: ${premise}`,
    "",
    "Work in the production spine, saving as you go:",
    "1. bible_get + production_get first — the cast, their speech patterns, and what already exists.",
    "2. episode_update: a one-line logline and a tight synopsis paragraph.",
    "3. production_add_scene: 3–5 scenes with proper sluglines, bible location ids, and 1–2 sentence",
    "   summaries that land the A-plot and one runner.",
    "No dialogue yet — this pass is the outline the writer signs off on. End with a one-line pitch.",
  ].join("\n");

const scriptPrompt = (episode: Episode, premise: string) =>
  [
    `Writers room — write the FULL SCRIPT for episode "${episode.title}" (episode id: ${episode.id}).`,
    `Premise: ${premise}`,
    "",
    "1. bible_get + production_get first. If the episode has no scenes yet, outline it first",
    "   (episode_update synopsis, then production_add_scene 3–5 scenes).",
    "2. Scene by scene: break each scene into 2–4 shots (production_add_shot) with camera specs in",
    "   the style bible's language, then write the dialogue with shot_update scriptLines —",
    "   character = bible character id, null = action line, deliveryNotes when the read matters.",
    "3. Keep every character inside their documented speech pattern. Sitcom pacing: short lines,",
    "   interruptions, every scene ends on a joke or a turn.",
    "Save shot by shot — the writer is watching the script fill in live on the Studio screen.",
  ].join("\n");

export function WritersPanel({
  episode,
  production,
}: {
  episode: Episode | null;
  production: { logline: string };
}) {
  const chat = useChat();
  const navigate = useNavigate();
  const [premise, setPremise] = useState("");
  const effective = premise.trim() || episode?.logline || production.logline;

  // the newest Director text while it works — the room's over-the-shoulder view
  const latest = [...chat.messages].reverse().find((m) => m.role !== "user" && m.text?.trim());

  const dispatch = (build: (e: Episode, p: string) => string) => {
    if (!episode || chat.busy || !chat.live) return;
    chat.send(build(episode, effective || "Pick an episode idea worthy of the pilot."));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b hairline px-4 py-3">
        <span className={sectionLabel}>Writers room</span>
        <p className="mt-1 text-[11px] leading-relaxed text-fog">
          Hand the Director a premise. The script fills in here as it writes.
        </p>
      </div>

      <div className="space-y-2.5 px-4 py-3">
        <textarea
          value={premise}
          onChange={(e) => setPremise(e.target.value)}
          placeholder={
            episode?.logline
              ? `Premise — defaults to the episode logline: “${episode.logline}”`
              : "Premise — what is this episode about?"
          }
          className="min-h-[76px] w-full resize-y rounded-lg border border-cream/10 bg-ink/60 px-2.5 py-2 text-[12px] leading-relaxed text-cream outline-none placeholder:text-fog/60 focus:border-gold/40"
        />
        <div className="flex gap-2">
          <button
            onClick={() => dispatch(outlinePrompt)}
            disabled={!episode || chat.busy || !chat.live}
            className="flex-1 rounded-lg border border-gold/40 px-3 py-1.5 text-[12px] font-semibold text-gold transition enabled:hover:bg-gold/10 disabled:opacity-40"
          >
            Draft outline
          </button>
          <button
            onClick={() => dispatch(scriptPrompt)}
            disabled={!episode || chat.busy || !chat.live}
            className="flex-1 rounded-lg bg-gradient-to-b from-gold to-gold-deep px-3 py-1.5 text-[12px] font-semibold text-ink transition enabled:hover:brightness-110 disabled:opacity-40"
          >
            Write script
          </button>
        </div>
        {!chat.live && (
          <p className="text-[10px] leading-relaxed text-fog/80">
            The Director needs a live studio core.
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto border-t hairline px-4 py-3">
        {chat.busy ? (
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />
            <span className="text-[11px] font-medium text-gold">The Director is in the room…</span>
            <button
              title="Stop"
              onClick={chat.stop}
              className="ml-auto rounded p-1 text-fog transition hover:text-[#e07a6b]"
            >
              <Square size={11} fill="currentColor" />
            </button>
          </div>
        ) : (
          <span className={sectionLabel}>Latest from the Director</span>
        )}
        {latest?.text && (
          <p className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-cream/70">
            {latest.text}
          </p>
        )}
      </div>

      <div className="border-t hairline px-4 py-2.5">
        <GhostButton className="w-full justify-center" onClick={() => navigate("/")}>
          <Clapperboard size={12} /> Open Director chat
        </GhostButton>
      </div>
    </div>
  );
}
