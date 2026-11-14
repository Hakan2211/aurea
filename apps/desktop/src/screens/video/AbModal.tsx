/* A/B queue — "render this shot N ways and write down what happened".
 *
 * Every speed and quality experiment on the upgrade list has the same shape,
 * and doing it by hand meant retyping a payload, losing track of which take
 * was which, and trusting a stopwatch. Here the base is whatever the panel
 * would have generated, each variant states only what it CHANGES, and the
 * seed is shared — so the difference between the takes is the thing under
 * test and nothing else.
 *
 * The results live on the Desk (A/B tab), not here: an experiment takes
 * minutes per variant, and nobody watches a modal for that long. */

import { useState } from "react";
import { FlaskConical, Plus, Trash2 } from "lucide-react";
import type { VideoAb } from "@aurea/shared";
import { GhostButton, GoldButton, Modal, ModalHeader, Toggle, cx } from "@/components/ui";
import { selectInput } from "./shared";

/** what a variant may move — the payload fields worth an experiment, and the
 * only ones the schema lets an override carry */
interface VariantDraft {
  label: string;
  /** "" = inherit the base, everywhere below */
  engine: string;
  quality: "" | "draft" | "standard" | "final";
  resolution: string;
  durationSec: string;
  fps: "" | "24" | "48";
  enhance: "" | "on" | "off";
}

const blank = (label: string): VariantDraft => ({
  label,
  engine: "",
  quality: "",
  resolution: "",
  durationSec: "",
  fps: "",
  enhance: "",
});

type Overrides = VideoAb["variants"][number]["overrides"];

/** A draft → the payload overrides. Quality is two fields, because the engine
 * families spell it differently: LTX reads `fast`, H3 reads its own three-rung
 * `minimaxTier`. Sending the tier to LTX would be noise, so it only rides when
 * the variant actually renders on H3. */
function toOverrides(draft: VariantDraft, baseEngine: string): Overrides {
  const engine = draft.engine || baseEngine;
  const out: Record<string, unknown> = {};
  if (draft.engine && draft.engine !== baseEngine) out.engine = draft.engine;
  if (draft.quality) {
    out.fast = draft.quality === "draft";
    if (engine === "minimax-h3") out.minimaxTier = draft.quality;
  }
  if (draft.resolution) out.resolution = draft.resolution;
  if (draft.durationSec) out.durationSec = Number(draft.durationSec);
  if (draft.fps) out.fps = Number(draft.fps) as 24 | 48;
  if (draft.enhance) out.enhance = draft.enhance === "on";
  return out as Overrides;
}

/** the line under a variant's label. An override with nothing in it is a
 * legitimate control, but it should say so rather than look like a mistake. */
function summarise(o: Record<string, unknown>): string {
  const parts = Object.entries(o).map(([k, v]) =>
    k === "fast"
      ? v
        ? "draft"
        : "full quality"
      : k === "enhance"
        ? `enhancer ${v ? "on" : "off"}`
        : String(v),
  );
  return parts.length ? parts.join(" · ") : "control — identical to the base";
}

export function AbModal({
  open,
  onClose,
  engineId,
  engines,
  resolutionsByEngine,
  durations,
  disabled,
  queueing,
  error,
  onQueue,
}: {
  open: boolean;
  onClose: () => void;
  engineId: string;
  engines: { id: string; label: string }[];
  resolutionsByEngine: Record<string, string[]>;
  durations: string[];
  /** the panel can't produce a renderable payload right now (no start frame) */
  disabled: boolean;
  queueing: boolean;
  error: string | null;
  onQueue: (input: {
    title: string;
    notes?: string;
    seed?: number;
    variants: VideoAb["variants"];
  }) => void;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [seed, setSeed] = useState("");
  const [variants, setVariants] = useState<VariantDraft[]>([
    blank("A — as configured"),
    blank("B"),
  ]);

  const patch = (i: number, next: Partial<VariantDraft>) =>
    setVariants((vs) => vs.map((v, j) => (j === i ? { ...v, ...next } : v)));

  const ready = title.trim().length > 0 && variants.every((v) => v.label.trim()) && !disabled;

  const queue = () => {
    onQueue({
      title: title.trim(),
      notes: notes.trim() || undefined,
      seed: seed.trim() ? Number(seed) : undefined,
      variants: variants.map((v) => ({
        label: v.label.trim(),
        overrides: toOverrides(v, engineId),
      })),
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <ModalHeader
        title="A/B render"
        sub="One shot, several recipes, one shared seed — queued at batch priority so it never jumps ahead of work you asked for. Results land on the Production Desk."
        onClose={onClose}
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <label className="block">
          <span className="text-2xs uppercase tracking-wider text-fog">What is this testing?</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="H3 Standard — Acc 8-step vs LightX2V 8-step"
            className="mt-1 w-full rounded-lg border border-cream/10 bg-ink px-3 py-2 text-xs text-cream outline-none focus:border-gold/40"
          />
        </label>

        <div className="flex gap-3">
          <label className="min-w-0 flex-1">
            <span className="text-2xs uppercase tracking-wider text-fog">Notes (optional)</span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="what to look for in the takes"
              className="mt-1 w-full rounded-lg border border-cream/10 bg-ink px-3 py-2 text-xs text-cream outline-none focus:border-gold/40"
            />
          </label>
          <label className="w-[140px] shrink-0">
            <span className="text-2xs uppercase tracking-wider text-fog">Shared seed</span>
            <input
              value={seed}
              onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="auto"
              className="mt-1 w-full rounded-lg border border-cream/10 bg-ink px-3 py-2 text-xs tabular-nums text-cream outline-none focus:border-gold/40"
            />
          </label>
        </div>

        <div className="space-y-2">
          {variants.map((v, i) => {
            const engine = v.engine || engineId;
            const resolutions = resolutionsByEngine[engine] ?? [];
            return (
              <div key={i} className="rounded-panel border border-cream/10 bg-ink/60 p-3">
                <div className="flex items-center gap-2">
                  <span className="font-serif text-sm text-gold">
                    {String.fromCharCode(65 + i)}
                  </span>
                  <input
                    value={v.label}
                    onChange={(e) => patch(i, { label: e.target.value })}
                    placeholder="what makes this one different"
                    className="min-w-0 flex-1 rounded-md border border-cream/10 bg-ink px-2 py-1 text-xs text-cream outline-none focus:border-gold/40"
                  />
                  {variants.length > 2 && (
                    <button
                      onClick={() => setVariants((vs) => vs.filter((_, j) => j !== i))}
                      title="Drop this variant"
                      className="rounded-md p-1 text-fog transition hover:text-red-300"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <select
                    value={v.engine}
                    onChange={(e) => patch(i, { engine: e.target.value, resolution: "" })}
                    style={{ colorScheme: "dark" }}
                    className={cx(selectInput, "w-[124px]", !v.engine && "text-fog")}
                  >
                    <option value="">engine · base</option>
                    {engines.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={v.quality}
                    onChange={(e) =>
                      patch(i, { quality: e.target.value as VariantDraft["quality"] })
                    }
                    style={{ colorScheme: "dark" }}
                    className={cx(selectInput, "w-[112px]", !v.quality && "text-fog")}
                  >
                    <option value="">quality · base</option>
                    <option value="draft">draft</option>
                    <option value="standard">standard</option>
                    <option value="final">final</option>
                  </select>
                  <select
                    value={v.resolution}
                    onChange={(e) => patch(i, { resolution: e.target.value })}
                    style={{ colorScheme: "dark" }}
                    className={cx(selectInput, "w-[172px]", !v.resolution && "text-fog")}
                  >
                    <option value="">size · base</option>
                    {resolutions.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <select
                    value={v.durationSec}
                    onChange={(e) => patch(i, { durationSec: e.target.value })}
                    style={{ colorScheme: "dark" }}
                    className={cx(selectInput, "w-[112px]", !v.durationSec && "text-fog")}
                  >
                    <option value="">length · base</option>
                    {durations.map((d) => (
                      <option key={d} value={String(parseInt(d) || 5)}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <select
                    value={v.fps}
                    onChange={(e) => patch(i, { fps: e.target.value as VariantDraft["fps"] })}
                    style={{ colorScheme: "dark" }}
                    className={cx(selectInput, "w-[96px]", !v.fps && "text-fog")}
                  >
                    <option value="">fps · base</option>
                    <option value="24">24 fps</option>
                    <option value="48">48 fps</option>
                  </select>
                  {engine === "ltx25" && (
                    <span className="flex items-center gap-1.5 rounded-md border border-cream/10 px-2 py-1 text-2xs text-fog">
                      enhancer
                      <Toggle
                        on={v.enhance !== "off"}
                        onChange={() => patch(i, { enhance: v.enhance === "off" ? "on" : "off" })}
                        title="LTX 2.5's Gemma prompt enhancer — off is what multi-shot prose needs"
                      />
                    </span>
                  )}
                </div>

                <p className="mt-2 text-2xs leading-relaxed text-fog">
                  {summarise(toOverrides(v, engineId) as Record<string, unknown>)}
                </p>
              </div>
            );
          })}
          {variants.length < 6 && (
            <GhostButton
              onClick={() => setVariants((vs) => [...vs, blank(String.fromCharCode(65 + vs.length))])}
              className="w-full justify-center gap-1.5 text-2xs"
            >
              <Plus size={12} /> Add a variant
            </GhostButton>
          )}
        </div>

        {disabled && (
          <p className="rounded-lg border border-cream/10 bg-ink/60 px-3 py-2 text-2xs leading-relaxed text-fog">
            The panel has nothing renderable yet — pick a start frame (or a frameless mode) first.
            An A/B run renders the shot the panel is configured for.
          </p>
        )}
        {error && (
          <p className="rounded-lg border border-red-500/25 bg-red-500/8 px-3 py-2 text-2xs leading-relaxed text-red-300">
            {error}
          </p>
        )}
      </div>
      <footer className="flex shrink-0 items-center gap-3 border-t hairline px-5 py-3">
        <p className="min-w-0 flex-1 text-2xs leading-relaxed text-fog">
          {variants.length} takes at batch priority, one after another. Nothing here moves the
          prompt or the start frame — a variant that did would be a different shot, not a test.
        </p>
        <GoldButton
          onClick={queue}
          className={cx("gap-2", (!ready || queueing) && "pointer-events-none opacity-50")}
        >
          <FlaskConical size={13} /> {queueing ? "Queueing…" : `Queue ${variants.length} takes`}
        </GoldButton>
      </footer>
    </Modal>
  );
}
