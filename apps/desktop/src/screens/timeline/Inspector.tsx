/* The right column. With a clip selected it shows what that clip actually is —
 * its slice of the source, the take it came from, the engine that rendered it,
 * the words it speaks. With nothing selected it shows the sequence itself.
 *
 * Deliberately NOT a compositing inspector: the export is an ffmpeg cuts-first
 * render, so position/scale/rotation controls would be knobs wired to nothing. */

import { Trash2 } from "lucide-react";
import type { Timeline, TimelineClip, TimelineTrack } from "@aurea/shared";
import { Chip, SectionLabel, cx } from "@/components/ui";
import { FPS, KIND, type ResolvedAsset, clipCount, fmtTc, sequenceEnd } from "./shared";

export function Inspector({
  tl,
  clip,
  track,
  asset,
  onPatch,
  onDelete,
  exportState,
}: {
  tl: Timeline;
  clip: TimelineClip | undefined;
  track: TimelineTrack | undefined;
  asset: ResolvedAsset;
  onPatch: (patch: Partial<TimelineClip>) => void;
  onDelete: () => void;
  exportState: { status?: string; progress?: number; error?: string | null };
}) {
  const end = sequenceEnd(tl);
  const hours = end >= 3600;

  return (
    <aside className="flex w-[288px] shrink-0 flex-col overflow-y-auto border-l hairline bg-[#0e0e10]">
      {clip && track ? (
        <ClipInspector
          clip={clip}
          track={track}
          asset={asset}
          hours={hours}
          onPatch={onPatch}
          onDelete={onDelete}
        />
      ) : (
        <div className="p-4">
          <SectionLabel>Sequence</SectionLabel>
          <dl className="mt-3 space-y-px overflow-hidden rounded-lg border border-cream/6">
            <Row label="Duration" value={fmtTc(end, hours)} />
            <Row label="Clips" value={String(clipCount(tl))} />
            <Row label="Tracks" value={String(tl.tracks.length)} />
            <Row label="Frame rate" value={`${FPS} fps`} />
          </dl>

          {exportState.status && (
            <>
              <SectionLabel className="mt-6">Last export</SectionLabel>
              <div className="mt-3 rounded-lg border border-cream/6 p-3">
                <div className="flex items-center justify-between">
                  <Chip
                    tone={
                      exportState.status === "failed"
                        ? "ember"
                        : exportState.status === "completed"
                          ? "sage"
                          : "gold"
                    }
                  >
                    {exportState.status}
                  </Chip>
                  {exportState.status === "running" && (
                    <span className="text-xs tabular-nums text-fog">
                      {Math.round(exportState.progress ?? 0)}%
                    </span>
                  )}
                </div>
                {exportState.error && (
                  <p className="mt-2 text-[10.5px] leading-relaxed text-[#e07a6b]">
                    {exportState.error}
                  </p>
                )}
              </div>
            </>
          )}

          <p className="mt-6 text-[10.5px] leading-relaxed text-fog/70">
            Select a clip to see the take behind it — its slice of the source, the engine that
            rendered it, and the line it speaks.
          </p>
        </div>
      )}
    </aside>
  );
}

function ClipInspector({
  clip,
  track,
  asset,
  hours,
  onPatch,
  onDelete,
}: {
  clip: TimelineClip;
  track: TimelineTrack;
  asset: ResolvedAsset;
  hours: boolean;
  onPatch: (patch: Partial<TimelineClip>) => void;
  onDelete: () => void;
}) {
  const kind = KIND[track.kind];
  const name = clip.label || asset?.name || clip.asset.split("/").pop();

  return (
    <div className="p-4">
      <SectionLabel
        right={
          <span
            style={{ color: kind.accent, borderColor: `${kind.accent}55`, background: `${kind.accent}12` }}
            className="rounded border px-1.5 py-px text-[9px] font-bold uppercase tracking-wider"
          >
            {kind.label}
          </span>
        }
      >
        Clip
      </SectionLabel>

      <div className="mt-3 overflow-hidden rounded-xl border border-cream/8 bg-black">
        {asset?.url && asset.kind === "image" ? (
          <img src={asset.url} alt="" className="aspect-video w-full object-cover" />
        ) : asset?.url && asset.kind === "video" ? (
          <video
            src={`${asset.url}#t=${(clip.in + clip.duration / 2).toFixed(2)}`}
            preload="metadata"
            muted
            className="aspect-video w-full object-cover"
          />
        ) : (
          <div
            style={{ background: `linear-gradient(135deg, ${kind.accent}22, transparent)` }}
            className="flex aspect-video w-full items-center justify-center text-[10px] uppercase tracking-widest text-fog"
          >
            {asset ? kind.label : "missing file"}
          </div>
        )}
      </div>

      <p className="mt-3 break-words font-serif text-[15px] leading-snug text-cream">{name}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {asset?.meta?.engine && <Chip tone="gold">{asset.meta.engine}</Chip>}
        {asset?.meta?.nativeAudio && <Chip tone="sage">native audio</Chip>}
        {asset?.meta?.voice && <Chip tone="violet">{asset.meta.voice}</Chip>}
      </div>

      <SectionLabel className="mt-6">Timing</SectionLabel>
      <div className="mt-3 space-y-px overflow-hidden rounded-lg border border-cream/6">
        <NumRow
          label="Start"
          value={clip.start}
          onChange={(v) => onPatch({ start: Math.max(0, v) })}
          hint={fmtTc(clip.start, hours)}
        />
        <NumRow
          label="Duration"
          value={clip.duration}
          onChange={(v) => onPatch({ duration: Math.max(1 / FPS, v) })}
          hint={fmtTc(clip.duration, false)}
        />
        <Row label="End" value={fmtTc(clip.start + clip.duration, hours)} />
        <Row label="Source in" value={fmtTc(clip.in, false)} />
      </div>

      <SectionLabel className="mt-6" hint>
        Crossfade
      </SectionLabel>
      <div className="mt-3 flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={Math.min(2, Math.max(0.1, clip.duration - 0.1))}
          step={0.05}
          value={clip.transitionSec}
          onChange={(e) => onPatch({ transitionSec: Number(e.target.value) })}
          className="aurea-slider flex-1"
          title="Dissolve from the previous clip into this one"
          style={{
            background: `linear-gradient(to right, var(--color-gold) ${(clip.transitionSec / Math.min(2, Math.max(0.1, clip.duration - 0.1))) * 100}%, color-mix(in srgb, var(--color-cream) 12%, transparent) ${(clip.transitionSec / Math.min(2, Math.max(0.1, clip.duration - 0.1))) * 100}%)`,
          }}
        />
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-cream/80">
          {clip.transitionSec.toFixed(2)}s
        </span>
      </div>

      {asset?.meta?.text && (
        <>
          <SectionLabel className="mt-6">Line</SectionLabel>
          <p className="mt-2 rounded-lg border border-cream/6 bg-surface/60 p-3 text-[11.5px] italic leading-relaxed text-cream/85">
            “{asset.meta.text}”
          </p>
        </>
      )}
      {!asset?.meta?.text && asset?.meta?.prompt && (
        <>
          <SectionLabel className="mt-6">Prompt</SectionLabel>
          <p className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-cream/6 bg-surface/60 p-3 text-[11px] leading-relaxed text-fog">
            {asset.meta.prompt}
          </p>
        </>
      )}

      <button
        onClick={onDelete}
        className="mt-6 flex w-full items-center justify-center gap-1.5 rounded-lg border border-cream/10 py-2 text-[11.5px] font-medium text-fog transition hover:border-ember/50 hover:text-[#e07a6b]"
      >
        <Trash2 size={12} /> Remove clip
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between bg-surface/50 px-3 py-1.5">
      <span className="text-[11px] text-fog">{label}</span>
      <span className="text-[11.5px] tabular-nums text-cream/90">{value}</span>
    </div>
  );
}

/** a seconds field that also prints the timecode it lands on */
function NumRow({
  label,
  value,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  hint: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between bg-surface/50 px-3 py-1.5">
      <span className="text-[11px] text-fog">{label}</span>
      <span className="flex items-center gap-2">
        <span className="text-[10px] tabular-nums text-fog/60">{hint}</span>
        <input
          type="number"
          step={0.1}
          min={0}
          value={Number(value.toFixed(2))}
          onChange={(e) => Number.isFinite(Number(e.target.value)) && onChange(Number(e.target.value))}
          className={cx(
            "w-16 rounded border border-cream/10 bg-ink px-1.5 py-0.5 text-right text-[11.5px] tabular-nums text-cream/90",
            "transition focus:border-gold/45 focus:outline-none focus:ring-2 focus:ring-gold/15",
          )}
        />
      </span>
    </div>
  );
}
