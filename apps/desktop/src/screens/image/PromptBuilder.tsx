import { useRef, useState } from "react";
import { X } from "lucide-react";
import type { PromptCategory } from "@aurea/shared";
import { cx } from "@/components/ui";

/* Chip composer for the Image lab prompt (Track B3). The prompt is modelled
 * as ordered chips — library presets keep their category colour, typed
 * tokens are free text — and the final prompt is simply the chips joined
 * with ", ". A raw toggle drops back to the plain textarea; re-entering chip
 * mode re-parses on comma boundaries, so neither mode can strand text. */

export interface PromptChip {
  /** stable render key — chips have no natural id once edited/reordered */
  key: string;
  /** set when the chip came from a library preset (delete-safe: only a ref) */
  presetId?: string;
  category?: PromptCategory;
  text: string;
}

let chipSeq = 0;
export function makeChip(text: string, category?: PromptCategory, presetId?: string): PromptChip {
  return { key: `chip-${++chipSeq}`, text, category, presetId };
}

/** raw prompt → free-text chips. Comma is the only safe boundary — prompts
 * are comma-phrased by convention, and anything smarter guesses wrong. */
export function parseChips(prompt: string): PromptChip[] {
  return prompt
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((t) => makeChip(t));
}

/** chips → the prompt string. Negative chips are held out on purpose: the
 * image payload (imagePayloadSchema) has no negative field, so appending
 * their text would silently pollute the positive prompt. */
export function joinChips(chips: PromptChip[]): string {
  return chips
    .filter((c) => c.category !== "negative")
    .map((c) => c.text)
    .join(", ");
}

/** category → colour, per the house palette: style=gold, subject=cream,
 * lighting=sage, camera=violet, mood=ember, negative=fog (dashed — it never
 * reaches the prompt, and the border says so before the note does). */
export const CATEGORY_CHIP: Record<PromptCategory | "free", string> = {
  style: "border-gold/45 bg-gold/10 text-gold",
  subject: "border-cream/30 bg-cream/8 text-cream",
  lighting: "border-sage/45 bg-sage/10 text-sage",
  camera: "border-[#a99bee]/45 bg-[#8b7bd8]/12 text-[#a99bee]",
  mood: "border-ember/50 bg-ember/15 text-[#e07a6b]",
  negative: "border-dashed border-fog/45 bg-transparent text-fog",
  free: "border-cream/12 bg-surface text-cream/85",
};

export const CATEGORY_ORDER: PromptCategory[] = [
  "style",
  "subject",
  "lighting",
  "camera",
  "mood",
  "negative",
];

export function PromptBuilder({
  chips,
  onChips,
  disabled,
}: {
  chips: PromptChip[];
  /** every mutation goes through the parent — it owns the prompt string too */
  onChips: (next: PromptChip[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  /** index being dragged — HTML5 drag is enough for a 264px-wide row */
  const dragFrom = useRef<number | null>(null);

  const commitDraft = () => {
    const text = draft.trim();
    if (!text) return;
    // a comma-ful paste becomes several chips, same rule as the raw parser
    onChips([...chips, ...parseChips(text)]);
    setDraft("");
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= chips.length) return;
    const next = [...chips];
    [next[i], next[j]] = [next[j], next[i]];
    onChips(next);
  };

  const hasNegative = chips.some((c) => c.category === "negative");

  return (
    <div
      className={cx(
        "rounded-xl border border-cream/10 bg-surface p-2 transition focus-within:border-gold/40",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((chip, i) => (
          <span
            key={chip.key}
            tabIndex={0}
            title={`${chip.text} — drag or ←/→ to reorder`}
            draggable
            onDragStart={() => (dragFrom.current = i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const from = dragFrom.current;
              dragFrom.current = null;
              if (from === null || from === i) return;
              const next = [...chips];
              const [moved] = next.splice(from, 1);
              next.splice(i, 0, moved);
              onChips(next);
            }}
            onKeyDown={(e) => {
              // keyboard reorder — drag alone would make order mouse-only
              if (e.key === "ArrowLeft") move(i, -1);
              else if (e.key === "ArrowRight") move(i, 1);
              else if (e.key === "Backspace" || e.key === "Delete")
                onChips(chips.filter((_, j) => j !== i));
            }}
            className={cx(
              "group/chip inline-flex max-w-full cursor-grab items-center gap-1 rounded-pill border px-2 py-0.5 text-2xs font-medium",
              "transition duration-[var(--dur)] ease-[var(--ease-out-quart)] focus:outline-none focus:ring-1 focus:ring-gold/50",
              CATEGORY_CHIP[chip.category ?? "free"],
            )}
          >
            <span className="max-w-[160px] truncate">{chip.text}</span>
            <button
              title="Remove"
              tabIndex={-1}
              onClick={() => onChips(chips.filter((_, j) => j !== i))}
              className="opacity-50 transition hover:opacity-100"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commitDraft();
            } else if (e.key === "Backspace" && draft === "" && chips.length) {
              // empty-input backspace eats the last chip — the text-editing reflex
              onChips(chips.slice(0, -1));
            }
          }}
          onBlur={commitDraft}
          placeholder={chips.length ? "add…" : "Type a phrase, Enter to chip it…"}
          className="min-w-[72px] flex-1 bg-transparent py-0.5 text-[11px] text-cream placeholder:text-fog/50 focus:outline-none"
        />
      </div>
      {hasNegative && (
        <p className="mt-1.5 border-t border-cream/8 pt-1.5 text-2xs leading-relaxed text-fog/80">
          Dashed chips are negatives — this model has no negative-prompt input, so they're kept
          out of the prompt. Negatives apply via style packs on video / bible flows.
        </p>
      )}
    </div>
  );
}
