/* SendToTimeline — the one button that places a library asset on the active
 * project's sequence (Music lab inspector, Asset library inspector). The
 * server-side addClip probes the real duration and routes the asset kind to
 * its track, so this stays a dumb trigger with feedback states. */

import { useEffect, useRef, useState } from "react";
import { Check, Clapperboard, Loader2 } from "lucide-react";
import { useSendToTimeline } from "@/hooks";
import { cx } from "@/components/ui";

const TONE = {
  gold: [
    "bg-gradient-to-b from-gold to-gold-deep text-ink font-semibold hover:brightness-110 active:brightness-95",
    "disabled:opacity-40 disabled:hover:brightness-100",
  ],
  ghost: [
    "border border-cream/10 font-medium text-cream/80 hover:border-gold/40 hover:text-gold",
    "disabled:opacity-40 disabled:hover:border-cream/10 disabled:hover:text-cream/80",
  ],
} as const;

export function SendToTimeline({
  relPath,
  tone,
  className,
}: {
  /** library relPath of a real asset; undefined = sample data / still generating */
  relPath: string | undefined;
  tone: keyof typeof TONE;
  className?: string;
}) {
  const { live, sending, send } = useSendToTimeline();
  const [state, setState] = useState<"idle" | "added" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const settle = (next: "added" | "failed") => {
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2200);
  };

  const disabled = !relPath || !live || sending;
  return (
    <button
      disabled={disabled}
      title={
        !relPath
          ? "Available once the take is a saved asset"
          : !live
            ? "Needs a running studio core"
            : "Place this on the project timeline"
      }
      onClick={() => {
        if (!relPath) return;
        send(relPath).then(
          () => settle("added"),
          () => settle("failed"),
        );
      }}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] transition",
        ...TONE[tone],
        state === "failed" && "text-ember",
        className,
      )}
    >
      {sending ? (
        <Loader2 size={13} className="animate-spin" />
      ) : state === "added" ? (
        <Check size={13} />
      ) : (
        <Clapperboard size={13} />
      )}
      {sending
        ? "Adding…"
        : state === "added"
          ? "On the timeline"
          : state === "failed"
            ? "Failed — try again"
            : "Send to timeline"}
    </button>
  );
}
