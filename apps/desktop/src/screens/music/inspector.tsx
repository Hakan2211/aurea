import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy, Download, Image as ImageIcon, Star } from "lucide-react";
import { fmtStamp, useDownloadTrack, useMusicLab } from "@/hooks";
import type { MusicStem, MusicTrack } from "@/data/sample";
import { Slider, Toggle, Waveform, cx } from "@/components/ui";
import { SendToTimeline } from "@/components/SendToTimeline";
import { useMediaDuration, type AudioPlayer } from "@/components/useAudioPlayer";
import { CoverTile, stemIcons, type Likes } from "./shared";

/* The right rail. music-lab-v1 draws Lyrics / Brief / Stems *stacked* with
 * disclosure chevrons rather than as tabs, and it's the better shape: the
 * lyrics and the brief that produced them are the two things you read
 * together, and tabs made the second one cost a click and a guess. Each
 * section remembers whether it's open. */

const OPEN_KEY = "aurea.musicInspector";

function useOpenSections() {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "null");
      if (raw && typeof raw === "object") return raw as Record<string, boolean>;
    } catch {
      /* fall through to the default */
    }
    return { lyrics: true, brief: true, stems: false, details: false };
  });
  return {
    isOpen: (id: string) => open[id] ?? false,
    toggle: (id: string) =>
      setOpen((prev) => {
        const next = { ...prev, [id]: !(prev[id] ?? false) };
        localStorage.setItem(OPEN_KEY, JSON.stringify(next));
        return next;
      }),
  };
}

function Section({
  id,
  title,
  right,
  sections,
  children,
}: {
  id: string;
  title: string;
  right?: ReactNode;
  sections: ReturnType<typeof useOpenSections>;
  children: ReactNode;
}) {
  const open = sections.isOpen(id);
  return (
    <section className="border-b hairline px-4 py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => sections.toggle(id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <h3 className="font-serif text-[14px] text-cream">{title}</h3>
          <ChevronDown
            size={13}
            className={cx("shrink-0 text-fog transition-transform", open && "rotate-180")}
          />
        </button>
        {open && right}
      </div>
      {open && <div className="mt-2.5">{children}</div>}
    </section>
  );
}

/** ACE-Step section tags — "[verse]", "[chorus]", "[bridge]" — mark structure
 * rather than words, so they read as headings, not as a line to sing. */
const SECTION_TAG = /^\s*\[[^\]]+\]\s*$/;

/** The words the take was sung to, read back off the provenance sidecar. Two
 * different nothings hide behind an empty panel, and conflating them reads as
 * a bug: a take sung wordlessly on purpose, and one made before the studio
 * kept lyrics at all. The sidecar's presence tells them apart. */
function LyricsBody({ track }: { track: MusicTrack }) {
  if (track.arrangement !== "vocals") {
    return (
      <p className="text-[12px] leading-relaxed text-fog">
        Instrumental take — switch the arrangement to Vocals to write lyrics.
      </p>
    );
  }
  if (!track.lyrics?.trim()) {
    return (
      <p className="text-[12px] leading-relaxed text-fog">
        {track.origin
          ? // verified on a real run: ACE-Step's LM returns bpm/key/caption and
            // hands the DiT an empty lyric block — it sings, it doesn't write
            "Sung without words. Left blank, ACE-Step improvises a vocal line rather than writing lyrics — type your own in the Create panel and they'll be kept here with the take."
          : "No lyrics recorded for this take. Tracks made before the studio started keeping them beside the file can't get them back — the words lived in the job, and job history is capped."}
      </p>
    );
  }
  return (
    <div className="space-y-0.5">
      {track.lyrics.split("\n").map((line, i) =>
        SECTION_TAG.test(line) ? (
          <div
            key={i}
            className="pt-2.5 pb-0.5 text-2xs font-semibold uppercase tracking-[0.14em] text-gold/70 first:pt-0"
          >
            {line.trim().replace(/^\[|\]$/g, "")}
          </div>
        ) : line.trim() === "" ? (
          <div key={i} className="h-2" />
        ) : (
          <p key={i} className="text-[12px] leading-relaxed text-cream/85">
            {line}
          </p>
        ),
      )}
    </div>
  );
}

export function TrackInspector({
  track,
  player,
  likes,
}: {
  track: MusicTrack;
  player: AudioPlayer;
  likes: Likes;
}) {
  const lab = useMusicLab();
  const sections = useOpenSections();
  const [stems, setStems] = useState<MusicStem[]>(lab.stems);
  const [copied, setCopied] = useState(false);
  const [dlOpen, setDlOpen] = useState(false);
  const downloads = useDownloadTrack();
  const probed = useMediaDuration(track.url);
  const duration = track.duration || probed || "—";
  const starred = likes.isLiked(track.relPath);

  const setGain = (id: string, gainDb: number) =>
    setStems((prev) => prev.map((s) => (s.id === id ? { ...s, gainDb } : s)));

  const copyLyrics = () => {
    if (!track.lyrics) return;
    void navigator.clipboard.writeText(track.lyrics);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <aside className="flex w-[312px] shrink-0 flex-col border-l hairline bg-[#0e0e10]">
      {/* track header */}
      <div className="p-4 pb-3">
        <div className="flex items-start gap-3">
          {/* plays too, like the rows — the tile is the same affordance
            * wherever it appears, and it saves the header a third control */}
          <CoverTile
            track={track}
            size={72}
            playing={!!track.url && player.src === track.url && player.playing}
            onToggle={() => player.toggle(track.url)}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-1.5">
              <h2 className="min-w-0 flex-1 font-serif text-[15px] font-semibold leading-snug text-cream">
                {track.title}
              </h2>
              {track.relPath && (
                <button
                  title={starred ? "Unstar this track" : "Star this track"}
                  onClick={() => likes.toggleLike(track.relPath)}
                  className={cx(
                    "mt-0.5 shrink-0 transition",
                    starred ? "text-gold" : "text-cream/25 hover:text-gold/70",
                  )}
                >
                  <Star size={13} fill={starred ? "currentColor" : "none"} />
                </button>
              )}
            </div>
            <p className="mt-1 text-[10px] tabular-nums text-fog">
              {duration} · {track.bpm ? `${track.bpm} BPM` : "—"} · {track.key || "—"}
            </p>
          </div>
        </div>
        <Waveform
          seed={track.waveSeed}
          bars={150}
          played={track.url && player.src === track.url ? player.played : 0}
          className="mt-3 h-11!"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto border-t hairline">
        <Section
          id="lyrics"
          title="Lyrics"
          sections={sections}
          right={
            track.lyrics?.trim() ? (
              <button
                onClick={copyLyrics}
                title="Copy lyrics"
                className="flex shrink-0 items-center gap-1 text-2xs text-fog transition hover:text-gold"
              >
                {copied ? <Check size={11} className="text-gold" /> : <Copy size={11} />}
                {copied ? "Copied" : "Copy"}
              </button>
            ) : null
          }
        >
          <LyricsBody track={track} />
        </Section>

        <Section id="brief" title="Brief" sections={sections}>
          {track.prompt ? (
            <p className="text-[11px] leading-relaxed text-fog">{track.prompt}</p>
          ) : (
            <p className="text-[11px] leading-relaxed text-fog/70">
              No brief kept with this take — it predates the provenance sidecar.
            </p>
          )}
          {!!track.styles?.length && (
            <div className="mt-2 flex flex-wrap gap-1">
              {track.styles.map((s) => (
                <span
                  key={s}
                  className="rounded-full bg-gold/10 px-2 py-0.5 text-[10px] text-gold/85"
                >
                  {s}
                </span>
              ))}
            </div>
          )}
        </Section>

        <Section id="stems" title="Stems" sections={sections}>
          <p className="text-2xs leading-relaxed text-fog/70">
            Stem separation isn't wired to the engine yet — these controls are a preview of the
            coming mixer and don't change the file.
          </p>
          <div className="mt-3 space-y-3">
            {stems.map((stem) => {
              const Icon = stemIcons[stem.id];
              return (
                <div key={stem.id}>
                  <div className="flex items-center gap-2.5">
                    <Icon size={14} className={stem.on ? "text-gold/80" : "text-fog/50"} />
                    <span
                      className={cx(
                        "flex-1 text-[12px]",
                        stem.on ? "text-cream" : "text-fog line-through decoration-fog/40",
                      )}
                    >
                      {stem.label}
                    </span>
                    <span className="w-14 text-right text-[11px] tabular-nums text-cream/85">
                      {stem.gainDb > 0 ? "+" : ""}
                      {stem.gainDb.toFixed(1)} dB
                    </span>
                    <Toggle
                      on={stem.on}
                      onChange={() =>
                        setStems((prev) =>
                          prev.map((s) => (s.id === stem.id ? { ...s, on: !s.on } : s)),
                        )
                      }
                    />
                  </div>
                  <Slider
                    className="mt-1"
                    value={stem.gainDb}
                    onChange={(v) => setGain(stem.id, v)}
                    min={-12}
                    max={12}
                    step={0.5}
                    disabled={!stem.on}
                  />
                </div>
              );
            })}
          </div>
        </Section>

        <Section id="details" title="Details" sections={sections}>
          <div className="space-y-2">
            {(
              [
                ["Engine", "ACE-Step · local"],
                ["Tempo", track.bpm ? `${track.bpm} BPM` : "—"],
                ["Key", track.key || "—"],
                ["Duration", duration],
                ["Arrangement", track.arrangement],
                ["Created", track.createdAt ? fmtStamp(track.createdAt) : "—"],
                ["Format", "WAV · 48 kHz"],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 text-[11px]">
                <span className="shrink-0 text-fog">{k}</span>
                <span className="truncate text-right text-cream/85">{v}</span>
              </div>
            ))}
          </div>
          {/* the cover is drawn automatically when a track finishes, so the
            * control that matters is "draw another" — and it belongs down here
            * with the facts about the file, not competing with the title */}
          <div className="mt-3 flex items-center justify-between gap-2 border-t hairline pt-3">
            <span className="text-[11px] text-fog">Cover art</span>
            <button
              onClick={() => track.relPath && lab.recover(track.relPath)}
              disabled={!track.relPath || lab.recovering}
              title="Draw new cover art for this track"
              className="inline-flex items-center gap-1.5 rounded-lg border border-cream/10 px-2 py-1 text-[10px] text-cream/80 transition hover:border-gold/40 hover:text-gold disabled:opacity-40"
            >
              <ImageIcon size={11} />
              {lab.recovering ? "Queued…" : track.coverUrl ? "Draw another" : "Draw one"}
            </button>
          </div>
        </Section>
      </div>

      {/* The mockup's hierarchy, and the right one: placing the track on the
       * sequence is the reason you made it, and downloading a wav is the
       * escape hatch — so Send takes the gold and Download shrinks to a glyph. */}
      <div className="flex items-center gap-2 p-4 pt-3">
        <SendToTimeline
          relPath={track.generating ? undefined : track.relPath}
          tone="gold"
          className="min-w-0 flex-1 justify-center py-2.5"
        />
        <div className="relative shrink-0">
          <button
            onClick={() => setDlOpen((o) => !o)}
            disabled={!track.url}
            title="Download this track"
            className={cx(
              "flex h-[38px] w-[38px] items-center justify-center rounded-lg border transition disabled:opacity-40",
              dlOpen
                ? "border-gold/45 text-gold"
                : "border-cream/10 text-cream/80 hover:border-gold/40 hover:text-gold",
            )}
          >
            <Download size={14} />
          </button>
          {dlOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setDlOpen(false)} />
              <div className="absolute bottom-full right-0 z-20 mb-1.5 w-44 overflow-hidden rounded-xl border border-cream/12 bg-raised p-1 shadow-xl">
                {(
                  [
                    ["wav", "WAV · as rendered"],
                    ["mp3", "MP3 · smaller, shareable"],
                  ] as const
                ).map(([format, label]) => (
                  <button
                    key={format}
                    onClick={() => {
                      setDlOpen(false);
                      void downloads.download(track, format);
                    }}
                    disabled={format === "mp3" ? !track.relPath || !!downloads.busy : !track.url}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-cream/85 transition hover:bg-cream/5 disabled:opacity-40"
                  >
                    <Download size={11} />
                    {downloads.busy === format ? "Converting…" : label}
                  </button>
                ))}
                {downloads.error && (
                  <p className="px-2.5 py-1.5 text-[10px] leading-relaxed text-[#e07a6b]">
                    {downloads.error}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
