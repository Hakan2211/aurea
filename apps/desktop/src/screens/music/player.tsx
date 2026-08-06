import { useState } from "react";
import {
  Check,
  ChevronDown,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Star,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { MusicTrack } from "@/data/sample";
import { ScrubBar, cx } from "@/components/ui";
import { PLAYBACK_RATES, useMediaDuration, type AudioPlayer } from "@/components/useAudioPlayer";
import { CoverTile, type Likes } from "./shared";

/* The transport, pinned under all three columns — the same bar the Voice lab
 * grew, and needed more here: a voice take is four seconds, a track is three
 * minutes, and a row you can only start and stop is not a way to listen to
 * one. Volume, mute and speed persist through useAudioPlayer's prefs, so the
 * two labs agree without either owning the setting. */

export function PlayerBar({
  track,
  player,
  likes,
  onStep,
}: {
  track: MusicTrack | undefined;
  player: AudioPlayer;
  likes: Likes;
  /** move the selection through the track list (−1 previous, +1 next) */
  onStep: (delta: number) => void;
}) {
  const [rateOpen, setRateOpen] = useState(false);
  const loaded = !!track?.url && player.src === track.url;
  const playing = loaded && player.playing;
  const starred = likes.isLiked(track?.relPath);
  const probed = useMediaDuration(track?.url);

  return (
    <footer className="flex items-center gap-4 border-t hairline px-4 py-2.5">
      <div className="flex w-[232px] items-center gap-2.5">
        {track ? (
          <CoverTile track={track} size={36} />
        ) : (
          <span className="h-9 w-9 shrink-0 rounded-lg bg-cream/8" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] text-cream">{track?.title ?? "No track"}</div>
          <div className="truncate text-[10px] text-fog">
            {track ? track.arrangement : "Nothing selected"}
          </div>
        </div>
        {track?.relPath && (
          <button
            title={starred ? "Unstar this track" : "Star this track"}
            onClick={() => likes.toggleLike(track.relPath)}
            className={cx(
              "shrink-0 transition",
              starred ? "text-gold" : "text-cream/25 hover:text-gold/70",
            )}
          >
            <Star size={13} fill={starred ? "currentColor" : "none"} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          title="Previous track"
          onClick={() => onStep(-1)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-cream/70 transition hover:text-gold"
        >
          <SkipBack size={14} />
        </button>
        <button
          onClick={() => player.toggle(track?.url)}
          title={playing ? "Pause" : "Play"}
          className={cx(
            "flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-b from-gold to-gold-deep text-ink transition hover:brightness-110",
            !track?.url && "opacity-40",
          )}
        >
          {playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
        </button>
        <button
          title="Next track"
          onClick={() => onStep(1)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-cream/70 transition hover:text-gold"
        >
          <SkipForward size={14} />
        </button>
      </div>

      <span className="text-[10px] tabular-nums text-fog">{loaded ? player.position : "0:00"}</span>
      <ScrubBar
        className="min-w-0 flex-1"
        value={loaded ? player.played : 0}
        onSeek={player.seekFraction}
        title={loaded ? "Scrub" : "Play a track to scrub it"}
      />
      <span className="text-[10px] tabular-nums text-fog">
        {loaded ? player.total : probed || "0:00"}
      </span>

      <div className="flex w-28 items-center gap-2">
        <button
          title={player.muted ? "Unmute" : "Mute"}
          onClick={player.toggleMute}
          className="shrink-0 text-fog transition hover:text-gold"
        >
          {player.muted || player.volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
        <ScrubBar
          className="min-w-0 flex-1"
          tone="quiet"
          value={player.muted ? 0 : player.volume}
          onSeek={player.setVolume}
          title="Volume"
        />
      </div>

      <div className="relative">
        <button
          onClick={() => setRateOpen((o) => !o)}
          title="Playback speed"
          className={cx(
            "flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] tabular-nums transition",
            player.rate === 1
              ? "border-cream/10 text-cream/80 hover:border-gold/40 hover:text-gold"
              : "border-gold/45 text-gold",
          )}
        >
          {player.rate.toFixed(2).replace(/0$/, "")}×
          <ChevronDown size={11} className={cx("transition-transform", rateOpen && "rotate-180")} />
        </button>
        {rateOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setRateOpen(false)} />
            <div className="absolute bottom-full right-0 z-20 mb-1.5 w-24 overflow-hidden rounded-xl border border-cream/12 bg-raised p-1 shadow-xl">
              {PLAYBACK_RATES.map((r) => (
                <button
                  key={r}
                  onClick={() => {
                    player.setRate(r);
                    setRateOpen(false);
                  }}
                  className={cx(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] tabular-nums transition hover:bg-cream/5",
                    r === player.rate ? "text-gold" : "text-cream/85",
                  )}
                >
                  <span className="w-3">{r === player.rate && <Check size={11} />}</span>
                  {r.toFixed(2).replace(/0$/, "")}×
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </footer>
  );
}
