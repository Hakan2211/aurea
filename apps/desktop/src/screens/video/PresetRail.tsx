/* Render lanes — the row of chips at the top of the params panel.
 *
 * A Zoo Logic shot is one of four things (interview single, room coverage,
 * B-roll insert, Field Note), and each one is a fixed answer to eight
 * questions the panel used to ask separately every single time. Clicking a
 * lane answers all eight; touching any of them afterwards detaches the lane
 * and says so, because a chip that stays lit while the settings underneath it
 * have moved is a lie about what is going to render.
 *
 * The same rail draws the LOOKS — the bible-free lane (lane: "look"), where
 * the eight answers are aesthetics rather than a show's shape. A look with a
 * sample still shows it as a thumbnail; one without is a word. */

import { Layers } from "lucide-react";
import type { VideoPreset } from "@aurea/shared";
import { SectionLabel, cx } from "@/components/ui";

const LANE_TONE: Record<string, string> = {
  interview: "border-gold/40 bg-gold/10 text-gold",
  coverage: "border-sky-400/40 bg-sky-400/10 text-sky-200",
  broll: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  fieldnote: "border-violet-400/40 bg-violet-400/10 text-violet-200",
  look: "border-rose-300/40 bg-rose-300/10 text-rose-100",
  custom: "border-cream/25 bg-cream/5 text-cream/85",
};

/** the one line a chip shows on hover — the whole reason to trust it */
function shape(preset: VideoPreset): string {
  const p = preset.payload;
  return [
    p.engine,
    p.resolution?.split(" (")[0],
    p.durationSec !== undefined ? `${p.durationSec}s` : "",
    p.minimaxTier ?? (p.fast ? "draft" : ""),
    p.enhance === false ? "enhancer off" : p.enhance === true ? "enhancer on" : "",
    preset.rules.multiShot ? "multi-shot prose" : "",
    preset.look ? "look prose" : "",
    preset.negative ? "negative" : "",
    p.loras?.length ? `${p.loras.length} LoRA` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function PresetRail({
  presets,
  activeId,
  customised,
  onApply,
  onClear,
  title = "Lane",
  hint,
  sampleUrl,
}: {
  presets: VideoPreset[];
  activeId: string | null;
  /** the lane is applied but the settings under it have been edited */
  customised: boolean;
  onApply: (preset: VideoPreset) => void;
  onClear: () => void;
  /** the section label — "Lane" for a show's shapes, "Look" for aesthetics */
  title?: string;
  /** one muted line under the label, when the rail needs explaining */
  hint?: string;
  /** resolve a preset's sample still to a preview url; absent = word chips */
  sampleUrl?: (rel: string) => string | undefined;
}) {
  if (presets.length === 0) return null;
  const active = presets.find((p) => p.id === activeId) ?? null;

  return (
    <section>
      <SectionLabel
        right={
          active && (
            <button onClick={onClear} className="text-2xs text-fog transition hover:text-gold">
              clear
            </button>
          )
        }
      >
        {title}
      </SectionLabel>
      {hint && !active && <p className="mt-1 text-2xs leading-relaxed text-fog">{hint}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {presets.map((preset) => {
          const on = preset.id === activeId;
          const thumb = preset.sample && sampleUrl ? sampleUrl(preset.sample) : undefined;
          return (
            <button
              key={preset.id}
              onClick={() => onApply(preset)}
              title={`${preset.description}\n\n${shape(preset)}`}
              className={cx(
                "inline-flex items-center gap-1.5 rounded-pill border py-1 text-2xs transition",
                thumb ? "pl-1 pr-2.5" : "px-2.5",
                on
                  ? (LANE_TONE[preset.lane] ?? LANE_TONE.custom)
                  : "border-cream/10 text-cream/70 hover:border-cream/30 hover:text-cream",
              )}
            >
              {thumb && (
                <img
                  src={thumb}
                  alt=""
                  draggable={false}
                  className="h-4 w-6 shrink-0 rounded-sm object-cover"
                />
              )}
              {preset.label}
            </button>
          );
        })}
      </div>
      {active && (
        <p className="mt-1.5 flex items-start gap-1.5 text-2xs leading-relaxed text-fog">
          <Layers size={10} className="mt-px shrink-0" />
          <span>
            {shape(active)}
            {customised && (
              <span className="ml-1.5 rounded-pill border border-cream/20 px-1.5 py-px text-cream/70">
                customised
              </span>
            )}
          </span>
        </p>
      )}
    </section>
  );
}
