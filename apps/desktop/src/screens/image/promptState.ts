import { useCallback, useState } from "react";
import type { PromptPreset } from "@aurea/shared";
import { joinChips, makeChip, parseChips, type PromptChip } from "./PromptBuilder";

/* The Image lab's prompt, lifted out of the params panel.
 *
 * It used to live inside ParamsPanel, which was fine while the prompt library
 * was a modal that talked to it through a callback. The docked library rail is
 * a SIBLING column, so the prompt has to live above both — this hook is that
 * shared owner. The string stays the source of truth for the payload; chips are
 * its structured editor, re-synced on every mutation. */

export const PROMPT_MAX = 1000;

export interface PromptState {
  prompt: string;
  setPrompt: (next: string) => void;
  chips: PromptChip[];
  /** the only chip mutator — keeps the prompt string in lockstep */
  commitChips: (next: PromptChip[]) => void;
  /** free-text textarea instead of the chip builder */
  rawMode: boolean;
  toggleRaw: () => void;
  /** append a library preset, folding raw text back into chips first */
  pickPreset: (preset: PromptPreset) => void;
  /** accept an enhanced prompt — text wins, chips re-derive from it */
  acceptText: (next: string) => void;
  clear: () => void;
}

export function usePromptState(initial: string): PromptState {
  const [prompt, setPromptRaw] = useState(initial);
  const [chips, setChips] = useState<PromptChip[]>(() => parseChips(initial));
  /** Plain text is the default: it's how prompts are written and pasted. The
   * chip builder is the structured view you opt into. */
  const [rawMode, setRawMode] = useState(true);

  const setPrompt = useCallback((next: string) => setPromptRaw(next.slice(0, PROMPT_MAX)), []);

  const commitChips = useCallback((next: PromptChip[]) => {
    setChips(next);
    setPromptRaw(joinChips(next).slice(0, PROMPT_MAX));
  }, []);

  const acceptText = useCallback((next: string) => {
    const text = next.slice(0, PROMPT_MAX);
    setPromptRaw(text);
    setChips(parseChips(text));
  }, []);

  return {
    prompt,
    setPrompt,
    chips,
    commitChips,
    rawMode,
    toggleRaw: () =>
      setRawMode((raw) => {
        // chips → raw keeps the string; raw → chips re-parses on commas, so
        // free-typed structure survives the round trip either way
        if (raw) setChips(parseChips(prompt));
        return !raw;
      }),
    pickPreset: (preset) => {
      // in text mode a library pick appends to the text and STAYS in text
      // mode — being thrown into the chip editor mid-sentence is a jolt
      if (rawMode) {
        const base = prompt.trim();
        const next = base ? `${base}, ${preset.text}` : preset.text;
        acceptText(next);
        return;
      }
      commitChips([...chips, makeChip(preset.text, preset.category, preset.id)]);
    },
    acceptText,
    clear: () => {
      setPromptRaw("");
      setChips([]);
    },
  };
}
