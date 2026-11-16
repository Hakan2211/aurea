import { useState } from "react";
import {
  ChevronDown,
  CircleAlert,
  Download,
  Image as ImageIcon,
  ListFilter,
  ListPlus,
  MoreVertical,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { fmtStamp, useDownloadTrack, useMusicLab, useSendToTimeline } from "@/hooks";
import type { MusicTrack } from "@/data/sample";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  SectionLabel,
  Waveform,
  cx,
} from "@/components/ui";
import { useMediaDuration, type AudioPlayer } from "@/components/useAudioPlayer";
import { CoverTile, TrackTags, type Likes } from "./shared";

/* The centre column — "Generated tracks" as the mockups draw it: a cover per
 * row, a serif title, the style chips the take was asked for, a scrubable
 * waveform and the date *and* time it landed (v2's metadata graft). */

/** rows shown before "Load more" — the roll runs to 120 in the hook */
const TRACK_PAGE = 15;

function GeneratingCard({ track, onCancel }: { track: MusicTrack; onCancel: () => void }) {
  const g = track.generating!;
  return (
    <div className="rounded-xl border hairline bg-surface/50 p-3.5">
      <div className="flex items-start gap-3.5">
        <span
          className={cx(
            "h-[76px] w-[76px] shrink-0 animate-pulse rounded-xl",
            track.swatch || "bg-cream/8",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-serif text-[15px] text-cream">
              {track.title}
            </span>
            <span className="shrink-0 rounded-full bg-gold/15 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wider text-gold">
              Generating
            </span>
            <span className="shrink-0 text-sm font-medium tabular-nums text-gold">
              {g.progress}%
            </span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-cream/8">
            <div
              className="h-full animate-pulse rounded-full bg-gradient-to-r from-gold-deep to-gold"
              style={{ width: `${g.progress}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            {/* v2's status line: the stage is engine vocabulary ("Loading DiT"),
              * so it needs a sentence in front of it saying what's happening */}
            <p className="min-w-0 truncate text-2xs text-fog">
              Generating your track… {g.stage}
            </p>
            <button
              onClick={onCancel}
              className="shrink-0 rounded-lg border border-cream/10 px-2 py-1 text-2xs text-cream/80 transition hover:border-gold/40 hover:text-gold"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackCard({
  track,
  active,
  player,
  likes,
  onSelect,
  onDelete,
  onSend,
  onRecover,
  sending,
}: {
  track: MusicTrack;
  active: boolean;
  player: AudioPlayer;
  likes: Likes;
  onSelect: () => void;
  onDelete: () => void;
  onSend: () => void;
  /** draw this track's cover art again */
  onRecover: () => void;
  sending: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const [armed, setArmed] = useState(false);
  const downloads = useDownloadTrack();
  const probed = useMediaDuration(track.url);
  const loaded = !!track.url && player.src === track.url;
  const playing = loaded && player.playing;
  const starred = likes.isLiked(track.relPath);

  return (
    <div
      onClick={onSelect}
      className={cx(
        "relative w-full cursor-pointer rounded-xl border p-3.5 text-left transition",
        active
          ? "border-gold/50 bg-surface"
          : "border-transparent bg-surface/50 hover:border-cream/15",
      )}
    >
      <div className="flex items-start gap-3.5">
        <CoverTile
          track={track}
          size={76}
          playing={playing}
          onToggle={() => {
            onSelect();
            player.toggle(track.url);
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-serif text-[15px] text-cream">
              {track.title}
            </span>
            <span className="shrink-0 text-sm tabular-nums text-cream/80">
              {track.duration || probed || "—"}
            </span>
            {track.relPath && (
              <button
                title={starred ? "Unstar this track" : "Star this track — keeps it in Favourites"}
                onClick={(e) => {
                  e.stopPropagation();
                  likes.toggleLike(track.relPath);
                }}
                className={cx(
                  "shrink-0 transition",
                  starred ? "text-gold" : "text-cream/25 hover:text-gold/70",
                )}
              >
                <Star size={12} fill={starred ? "currentColor" : "none"} />
              </button>
            )}
            <DropdownMenu
              open={menu}
              onOpenChange={(o) => {
                setMenu(o);
                setArmed(false);
              }}
            >
              <DropdownMenuTrigger asChild>
                <button
                  title="Track options"
                  // the card itself selects on click — keep the kebab from doing so
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 text-fog transition hover:text-cream"
                >
                  <MoreVertical size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-52 min-w-0"
                // React events bubble through the portal — don't let a menu
                // click reach the card's onSelect
                onClick={(e) => e.stopPropagation()}
              >
                <DropdownMenuItem
                  onSelect={onSend}
                  disabled={sending || !track.relPath}
                  className="text-xs text-cream/85"
                >
                  <ListPlus size={12} /> {sending ? "Sending…" : "Send to timeline"}
                </DropdownMenuItem>
                {/* the wav is what the engine rendered; the mp3 is what you send
                  * someone — a third the size, and the only one a phone will open
                  * without argument */}
                <DropdownMenuItem
                  onSelect={() => void downloads.download(track, "wav")}
                  disabled={!track.url}
                  className="text-xs text-cream/85"
                >
                  <Download size={12} /> Download WAV
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => void downloads.download(track, "mp3")}
                  disabled={!track.relPath || !!downloads.busy}
                  className="text-xs text-cream/85"
                >
                  <Download size={12} /> {downloads.busy === "mp3" ? "Converting…" : "Download MP3"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={onRecover}
                  disabled={!track.relPath}
                  title="Draw new cover art for this track"
                  className="text-xs text-cream/85"
                >
                  <ImageIcon size={12} /> {track.coverUrl ? "New cover art" : "Make cover art"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="danger"
                  onSelect={(e) => {
                    // first click arms; keep the menu open for the confirm
                    if (!armed) {
                      e.preventDefault();
                      setArmed(true);
                      return;
                    }
                    onDelete();
                  }}
                  className="text-xs"
                >
                  <Trash2 size={12} /> {armed ? "Click again to confirm" : "Delete from disk"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="mt-1">
            <TrackTags track={track} />
          </div>

          {/* click the waveform to scrub, the way the Voice-lab player does */}
          <div
            onClick={(e) => {
              if (!loaded) return;
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              player.seekFraction(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
            }}
            title={loaded ? "Scrub" : undefined}
            className={cx("mt-1.5", loaded && "cursor-pointer")}
          >
            <Waveform
              seed={track.waveSeed}
              bars={140}
              played={loaded ? player.played : 0}
              className="h-8!"
            />
          </div>

          {track.createdAt && (
            <div className="mt-1 text-2xs tabular-nums text-fog">
              {fmtStamp(track.createdAt)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function TracksPanel({
  trackId,
  player,
  likes,
  onSelect,
}: {
  trackId: string;
  player: AudioPlayer;
  likes: Likes;
  onSelect: (id: string) => void;
}) {
  const lab = useMusicLab();
  const timeline = useSendToTimeline();
  const [newestFirst, setNewestFirst] = useState(true);
  const [filter, setFilter] = useState<"all" | "instrumental" | "vocals">("all");
  const [starredOnly, setStarredOnly] = useState(false);
  const [limit, setLimit] = useState(TRACK_PAGE);
  const [dismissed, setDismissed] = useState<string[]>([]);

  const generating = lab.tracks.filter((t) => t.generating);
  let finished = lab.tracks.filter((t) => !t.generating);
  if (filter !== "all") finished = finished.filter((t) => t.arrangement === filter);
  if (starredOnly) finished = finished.filter((t) => likes.isLiked(t.relPath));
  if (!newestFirst) finished = [...finished].reverse();
  const shown = finished.slice(0, limit);
  const rest = finished.length - shown.length;

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-2 p-4 pb-3">
        <h2 className="font-serif text-[16px] font-semibold tracking-wide text-cream">
          Generated tracks
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setNewestFirst((n) => !n)}
            title="Toggle sort order"
            className="flex h-8 items-center gap-1.5 rounded-lg border border-cream/10 px-2.5 text-xs text-cream/80 transition hover:border-gold/35"
          >
            {newestFirst ? "Newest" : "Oldest"}
            <ChevronDown
              size={11}
              className={cx("text-fog transition-transform", !newestFirst && "rotate-180")}
            />
          </button>
          <button
            onClick={() =>
              setFilter((f) =>
                f === "all" ? "instrumental" : f === "instrumental" ? "vocals" : "all",
              )
            }
            title={`Filter: ${filter} — click to cycle`}
            className={cx(
              "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition",
              filter === "all"
                ? "border-cream/10 text-fog hover:border-gold/35 hover:text-gold"
                : "border-gold/40 text-gold",
            )}
          >
            <ListFilter size={13} />
            {filter !== "all" && filter}
          </button>
          <button
            onClick={() => setStarredOnly((s) => !s)}
            title={starredOnly ? "Show every track" : "Show starred tracks only"}
            className={cx(
              "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition",
              starredOnly
                ? "border-gold/45 text-gold"
                : "border-cream/10 text-cream/70 hover:border-gold/40 hover:text-gold",
            )}
          >
            <Star size={11} fill={starredOnly ? "currentColor" : "none"} />
            Starred
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-3">
        {lab.failures
          .filter((f) => !dismissed.includes(f.id))
          .map((f) => (
            <div key={f.id} className="rounded-xl border border-red-500/30 bg-red-500/6 p-3">
              <div className="flex items-center gap-2">
                <CircleAlert size={14} className="shrink-0 text-red-400" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-cream">
                  {f.title}
                </span>
                <button
                  onClick={() => lab.retry(f.id)}
                  className="shrink-0 rounded-lg border border-cream/15 px-2 py-1 text-2xs text-cream/85 transition hover:border-gold/45 hover:text-gold"
                >
                  Retry
                </button>
                <button
                  onClick={() => setDismissed((prev) => [...prev, f.id])}
                  title="Dismiss"
                  className="shrink-0 text-fog transition hover:text-cream"
                >
                  <X size={13} />
                </button>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-red-300">{f.error}</p>
            </div>
          ))}

        {generating.map((t) => (
          <GeneratingCard key={t.id} track={t} onCancel={() => lab.cancel(t.id)} />
        ))}

        {shown.length === 0 && generating.length === 0 && (
          <p className="px-1 py-8 text-center text-xs leading-relaxed text-fog">
            {starredOnly || filter !== "all"
              ? "Nothing matches that filter."
              : "No tracks yet. Describe one below and hit Compose."}
          </p>
        )}

        {shown.map((t) => (
          <TrackCard
            key={t.id}
            track={t}
            active={t.id === trackId}
            player={player}
            likes={likes}
            onSelect={() => onSelect(t.id)}
            onDelete={() => {
              if (t.relPath) void lab.remove(t.relPath);
            }}
            onSend={() => {
              if (t.relPath) void timeline.send(t.relPath);
            }}
            onRecover={() => {
              if (t.relPath) lab.recover(t.relPath);
            }}
            sending={timeline.sending}
          />
        ))}

        {rest > 0 && (
          <button
            onClick={() => setLimit((l) => l + TRACK_PAGE)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-cream/10 py-2 text-sm text-cream/80 transition hover:border-gold/40 hover:text-gold"
          >
            <ChevronDown size={13} /> Load more tracks · {rest}
          </button>
        )}
      </div>

      <div className="border-t hairline px-4 py-2">
        <SectionLabel>
          {finished.length} track{finished.length === 1 ? "" : "s"}
          {generating.length > 0 && ` · ${generating.length} rendering`}
        </SectionLabel>
      </div>
    </section>
  );
}
