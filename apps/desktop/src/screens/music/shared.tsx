import { AudioWaveform, Drum, Guitar, Mic, Music2, Pause, Play } from "lucide-react";
import type { MusicTrack } from "@/data/sample";
import { useLikes } from "@/hooks";
import { cx } from "@/components/ui";

/* Pieces the Music lab's three columns share. */

export type Likes = ReturnType<typeof useLikes>;

export const stemIcons = { vocals: Mic, drums: Drum, bass: Guitar, other: AudioWaveform } as const;

export const fmt = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

/** The track's picture. Cover art is generated after the fact by a chained
 * image job, so every tile has to work in both states: the drawn cover once
 * it lands, and until then the track's own gradient swatch — the same
 * stand-in Formats uses, rather than an empty box that reads as broken.
 *
 * Play lives *on* the tile instead of beside it. Two 40px targets in a row is
 * what the mockups draw, but the picture is already the obvious thing to
 * press, and folding them saves the width the title needs. */
export function CoverTile({
  track,
  size,
  playing,
  onToggle,
  className,
}: {
  track: MusicTrack;
  /** px — rows use 56, the inspector header 64 */
  size: number;
  playing?: boolean;
  /** absent = a decorative tile (the inspector header), not a play target */
  onToggle?: () => void;
  className?: string;
}) {
  const art = track.coverUrl ? (
    <img src={track.coverUrl} alt="" className="h-full w-full object-cover" />
  ) : (
    <span className={cx("block h-full w-full", track.swatch)} />
  );

  if (!onToggle) {
    return (
      <span
        style={{ width: size, height: size }}
        className={cx("shrink-0 overflow-hidden rounded-xl", className)}
      >
        {art}
      </span>
    );
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={playing ? "Pause" : "Play"}
      style={{ width: size, height: size }}
      className={cx(
        "group/cover relative shrink-0 overflow-hidden rounded-xl transition hover:brightness-110",
        className,
      )}
    >
      {art}
      {/* One button, one place — dead centre in every state. The first cut put
       * a small resting glyph in the corner and the gold one in the middle, so
       * the target appeared to jump as the pointer arrived. Only the *weight*
       * changes on hover: a quiet disc at rest, the gold one under the pointer
       * or while it plays. */}
      <span
        className={cx(
          "absolute inset-0 flex items-center justify-center transition duration-[var(--dur-fast)]",
          playing ? "bg-ink/45" : "bg-ink/0 group-hover/cover:bg-ink/45",
        )}
      >
        <span
          className={cx(
            "flex items-center justify-center rounded-full transition duration-[var(--dur-fast)]",
            size >= 64 ? "h-10 w-10" : "h-8 w-8",
            playing
              ? "bg-gradient-to-b from-gold to-gold-deep text-ink"
              : "bg-ink/55 text-cream/90 group-hover/cover:bg-gradient-to-b group-hover/cover:from-gold group-hover/cover:to-gold-deep group-hover/cover:text-ink",
          )}
        >
          {playing ? (
            <Pause size={size >= 64 ? 15 : 13} />
          ) : (
            <Play size={size >= 64 ? 15 : 13} className="ml-0.5" fill="currentColor" />
          )}
        </span>
      </span>
    </button>
  );
}

/** arrangement + the style chips the take was asked for, as one quiet line */
export function TrackTags({ track, max = 3 }: { track: MusicTrack; max?: number }) {
  const styles = (track.styles ?? []).slice(0, max);
  const extra = (track.styles?.length ?? 0) - styles.length;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <span className="inline-flex items-center gap-1 text-[10px] text-fog">
        {track.arrangement === "vocals" ? <Mic size={9} /> : <Music2 size={9} />}
        {track.arrangement}
      </span>
      {styles.map((s) => (
        <span
          key={s}
          className="truncate rounded-full bg-gold/10 px-1.5 py-px text-[10px] text-gold/85"
        >
          {s}
        </span>
      ))}
      {extra > 0 && <span className="text-[10px] text-fog/70">+{extra}</span>}
    </div>
  );
}
