/* The program monitor — what the export would show at the playhead, with the
 * transport under it. The picture comes from the topmost video clip; the voice
 * and music lanes play alongside it through hidden <audio> elements, so the
 * preview mix matches the render. */

import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Film, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { Timeline, TimelineClip, TimelineTrack } from "@aurea/shared";
import { cx } from "@/components/ui";
import { FPS, type ResolvedAsset, fmtTc } from "./shared";

export function Monitor({
  tl,
  resolve,
  playhead,
  setPlayhead,
  playing,
  setPlaying,
  end,
  onStepCut,
}: {
  tl: Timeline;
  resolve: (relPath: string) => ResolvedAsset;
  playhead: number;
  setPlayhead: (t: number) => void;
  playing: boolean;
  setPlaying: (p: boolean | ((p: boolean) => boolean)) => void;
  end: number;
  /** jump to the previous / next cut point in the sequence */
  onStepCut: (dir: -1 | 1) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hours = end >= 3600;

  /* the TOPMOST video clip under the playhead — later video tracks composite
   * on top (Video 2 = inserts over the base), so search tracks last-to-first,
   * matching the export's overlay order */
  const active = (() => {
    for (const track of [...tl.tracks].reverse()) {
      if (track.kind !== "video") continue;
      const clip = track.clips.find((c) => playhead >= c.start && playhead < c.start + c.duration);
      if (clip) return { clip, track };
    }
    return undefined;
  })() as { clip: TimelineClip; track: TimelineTrack } | undefined;
  const asset = active ? resolve(active.clip.asset) : undefined;

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !active) return;
    // the take's own sound honours its track's mute + volume, like the export
    el.volume = Math.min(1, Math.max(0, active.track.muted ? 0 : (active.track.gain ?? 1)));
    const target = playhead - active.clip.start + active.clip.in;
    if (Math.abs(el.currentTime - target) > 0.35) el.currentTime = target;
    if (playing && el.paused) void el.play().catch(() => {});
    if (!playing && !el.paused) el.pause();
  }, [active, playing, playhead]);

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-ink">
      <div className="relative mx-5 mt-5 flex min-h-0 flex-1 items-center justify-center">
        <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl border hairline bg-black shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)]">
          {asset?.url ? (
            asset.kind === "image" ? (
              <img src={asset.url} alt="" className="max-h-full max-w-full object-contain" />
            ) : (
              <video
                ref={videoRef}
                src={asset.url}
                muted={false}
                preload="auto"
                /* a fresh <video> sits at 0 with nothing decoded, so a clip
                 * that starts under the playhead would show black until the
                 * first seek — nudge it as soon as metadata lands */
                onLoadedMetadata={(e) => {
                  e.currentTarget.currentTime = Math.max(
                    0.001,
                    playhead - (active?.clip.start ?? 0) + (active?.clip.in ?? 0),
                  );
                }}
                className="max-h-full max-w-full object-contain"
              />
            )
          ) : (
            <div className="flex flex-col items-center gap-3 text-fog">
              <Film size={24} className="text-gold/40" />
              <span className="text-xs">
                {tl.tracks.some((t) => t.clips.length)
                  ? "No picture under the playhead"
                  : "Add takes from the left rail to start the cut."}
              </span>
            </div>
          )}

          {/* in-frame HUD — timecode left, format right, the way a monitor
              overlays them rather than a caption bar stealing height */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
            <span className="rounded-lg bg-black/45 px-2.5 py-1 font-medium tabular-nums tracking-[0.06em] text-gold backdrop-blur-md text-[13px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]">
              {fmtTc(playhead, hours)}
            </span>
            <span className="rounded-lg bg-black/45 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-cream/70 backdrop-blur-md shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]">
              {FPS} fps
            </span>
          </div>
          {active && (
            <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-4 pb-2.5 pt-8 text-[11px] text-cream/70">
              {active.clip.label || asset?.name}
            </span>
          )}
        </div>
      </div>

      {/* voice/music playback under the playhead — preview matches export */}
      {tl.tracks
        .filter((t) => t.kind !== "video")
        .map((t) => {
          const clip = t.clips.find((c) => playhead >= c.start && playhead < c.start + c.duration);
          const a = clip ? resolve(clip.asset) : undefined;
          return (
            <AudioClipPlayer
              key={t.id}
              url={a?.url}
              offset={clip ? playhead - clip.start + clip.in : 0}
              playing={playing && !!clip}
              muted={t.muted}
              gain={t.gain ?? 1}
            />
          );
        })}

      {/* ---- transport ---- */}
      <div className="relative flex h-16 shrink-0 items-center justify-center px-5">
        <span className="absolute left-5 flex items-baseline gap-2">
          <span className="font-medium tabular-nums tracking-[0.04em] text-cream text-[19px]">
            {fmtTc(playhead, hours)}
          </span>
          <span className="text-xs tabular-nums text-fog/70">/ {fmtTc(end, hours)}</span>
        </span>

        <div className="flex items-center gap-1 rounded-full border hairline bg-surface/70 px-1.5 py-1 backdrop-blur">
          <TransportButton
            icon={SkipBack}
            label="Back to start (Home)"
            onClick={() => {
              setPlaying(false);
              setPlayhead(0);
            }}
          />
          <TransportButton icon={ChevronLeft} label="Previous cut (↑)" onClick={() => onStepCut(-1)} />
          <button
            onClick={() => setPlaying((p) => !p)}
            title={playing ? "Pause (Space)" : "Play (Space)"}
            className={cx(
              "mx-0.5 flex h-9 w-9 items-center justify-center rounded-full text-ink transition duration-150",
              "bg-gradient-to-b from-[#dcc08e] via-gold to-gold-deep",
              "shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_2px_12px_rgba(201,169,110,0.25)]",
              "hover:brightness-110 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_4px_18px_rgba(201,169,110,0.4)]",
              "active:scale-95",
            )}
          >
            {playing ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
          </button>
          <TransportButton icon={ChevronRight} label="Next cut (↓)" onClick={() => onStepCut(1)} />
          <TransportButton
            icon={SkipForward}
            label="To the end (End)"
            onClick={() => {
              setPlaying(false);
              setPlayhead(end);
            }}
          />
        </div>

        <span className="absolute right-5 text-2xs text-fog/60">
          ← → step a frame · ⇧ a second
        </span>
      </div>
    </section>
  );
}

function TransportButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Play;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-full text-fog transition duration-150 hover:bg-cream/6 hover:text-cream active:scale-95"
    >
      <Icon size={14} />
    </button>
  );
}

/** Hidden <audio> element for one voice/music track — kept in lockstep with
 * the transport clock the same way the preview <video> is. Unmounts (and so
 * stops) the moment no clip of its track sits under the playhead. */
function AudioClipPlayer({
  url,
  offset,
  playing,
  muted,
  gain,
}: {
  url: string | undefined;
  offset: number;
  playing: boolean;
  muted: boolean;
  gain: number;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.volume = Math.min(1, Math.max(0, muted ? 0 : gain));
    if (Math.abs(el.currentTime - offset) > 0.35) el.currentTime = Math.max(0, offset);
    if (playing && el.paused) void el.play().catch(() => {});
    if (!playing && !el.paused) el.pause();
  });
  if (!url) return null;
  return <audio ref={ref} src={url} preload="auto" />;
}
