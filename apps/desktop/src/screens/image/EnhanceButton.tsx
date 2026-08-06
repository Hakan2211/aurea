import { useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { cx } from "@/components/ui";
import { usePromptEnhance } from "./promptHooks";

/* "Enhance" — one-shot local-Claude expansion of the prompt, steered by the
 * project's art direction. Split into a button + a result card because they
 * live in different rows of the params panel (button beside the Prompt
 * label, card under the prompt box); useEnhanceControl owns the shared
 * lifecycle so the two can't drift apart. */

export function useEnhanceControl({
  prompt,
  projectId,
  onAccept,
}: {
  prompt: string;
  projectId: string | undefined;
  /** replace the prompt (and the caller's chips) with the enhanced text */
  onAccept: (enhanced: string) => void;
}) {
  const { enhance, running, reset } = usePromptEnhance();
  /** the before/after pair the card shows — held locally so the card survives
   * the mutation being reset, and vanishes cleanly on accept/undo */
  const [result, setResult] = useState<{ before: string; after: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    const before = prompt.trim();
    if (!before || running) return;
    setError(null);
    setResult(null);
    enhance(before, projectId, "image")
      .then((r) => setResult({ before, after: r.enhanced.trim() }))
      // the throw is usually "local Claude isn't logged in" — actionable, so inline
      .catch((err) => setError(String((err as Error).message ?? err)));
  };

  const dismiss = () => {
    setResult(null);
    setError(null);
    reset();
  };

  const button = (
    <button
      onClick={run}
      disabled={running || !prompt.trim()}
      title="Expand this prompt with the project's art direction (local Claude)"
      className={cx(
        "flex items-center gap-1 rounded-pill border border-gold/40 bg-gold/10 px-2 py-0.5 text-2xs font-semibold text-gold",
        "transition duration-[var(--dur)] hover:bg-gold/20 disabled:opacity-40 disabled:hover:bg-gold/10",
      )}
    >
      {running ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
      {running ? "Enhancing…" : "Enhance"}
    </button>
  );

  const card =
    error !== null ? (
      <div className="anim-fade mt-1.5 flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/8 px-2.5 py-1.5">
        <p className="min-w-0 flex-1 text-2xs leading-relaxed text-red-300">{error}</p>
        <button onClick={dismiss} title="Dismiss" className="text-fog/60 transition hover:text-cream">
          <X size={11} />
        </button>
      </div>
    ) : result !== null ? (
      <div className="anim-scale-in mt-1.5 rounded-xl border border-gold/30 bg-surface p-2.5">
        {/* the old prompt stays visible but quiet — the diff is the point */}
        <p className="text-2xs leading-relaxed text-fog/60 line-through decoration-fog/40">
          {result.before}
        </p>
        <p className="mt-1.5 rounded-lg bg-gold/8 px-2 py-1.5 text-[11px] leading-relaxed text-cream">
          {result.after}
        </p>
        <div className="mt-2 flex gap-1.5">
          <button
            onClick={() => {
              onAccept(result.after);
              dismiss();
            }}
            className="rounded-lg bg-gold/15 px-2.5 py-1 text-[11px] font-semibold text-gold transition hover:bg-gold/25"
          >
            Accept
          </button>
          <button
            onClick={dismiss}
            className="rounded-lg border border-cream/15 px-2.5 py-1 text-[11px] text-cream/80 transition hover:border-cream/30"
          >
            Undo
          </button>
        </div>
      </div>
    ) : null;

  return { button, card, running };
}
