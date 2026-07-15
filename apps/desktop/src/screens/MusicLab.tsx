import { useState } from "react";
import {
  AudioWaveform,
  Bookmark,
  Check,
  ChevronDown,
  Clapperboard,
  Drum,
  Guitar,
  HelpCircle,
  ListFilter,
  Mic,
  MoreVertical,
  Music2,
  Pause,
  Play,
  Plus,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { useMusicLab } from "@/hooks";
import type { MusicStem, MusicTrack } from "@/data/sample";
import { Chip, GhostButton, GoldButton, Waveform, cx } from "@/components/ui";
import { useAudioPlayer, type AudioPlayer } from "@/components/useAudioPlayer";

/* Music lab — UI-Design/Music lab.jpg. Create panel (description → style →
 * duration → arrangement → cloned-voice vocals) over ACE-Step local; generated
 * tracks feed the stems inspector (toggle + gain per stem). Data flows through
 * useMusicLab (tRPC seam). */

function PanelLabel({ children, hint }: { children: React.ReactNode; hint?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">{children}</h3>
      {hint && <HelpCircle size={12} className="text-fog/50" />}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={cx(
        "relative h-5 w-9 shrink-0 rounded-full transition",
        on ? "bg-gradient-to-b from-gold to-gold-deep" : "bg-cream/12",
      )}
    >
      <span
        className={cx(
          "absolute top-0.5 h-4 w-4 rounded-full transition-all",
          on ? "left-[18px] bg-ink" : "left-0.5 bg-cream/70",
        )}
      />
    </button>
  );
}

/* ---------- left panel: create ---------- */

function CreatePanel() {
  const lab = useMusicLab();
  const [description, setDescription] = useState(lab.description);
  const [styles, setStyles] = useState(lab.styles);
  const [duration, setDuration] = useState(lab.durationSec);
  const [arrangement, setArrangement] = useState(lab.arrangement);
  const [voiceId, setVoiceId] = useState(lab.singVoices[0]?.id ?? "");
  const [voiceOpen, setVoiceOpen] = useState(false);

  const voice = lab.singVoices.find((v) => v.id === voiceId) ?? lab.singVoices[0];
  const canGenerate = !lab.busy && !!description.trim();
  const fmt = (sec: number) =>
    `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

  return (
    <aside className="flex w-[288px] shrink-0 flex-col border-r hairline bg-[#0e0e10]">
      <div className="flex items-center justify-between p-4 pb-3">
        <h2 className="font-serif text-[16px] font-semibold tracking-wide text-cream">Create</h2>
        <Chip tone="muted" className="text-[9px] uppercase tracking-wider">
          {lab.engine.label}
        </Chip>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
        {/* 1 · description */}
        <section>
          <PanelLabel hint>1 · Song description</PanelLabel>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, lab.descriptionMax))}
            rows={5}
            className="mt-2 w-full resize-none rounded-xl border border-cream/10 bg-surface p-3 text-[12px] leading-relaxed text-cream placeholder:text-fog focus:border-gold/40 focus:outline-none"
            placeholder="Describe the track…"
          />
          <div className="mt-1 text-right text-[10px] tabular-nums text-fog/70">
            {description.length} / {lab.descriptionMax}
          </div>
        </section>

        {/* 2 · style */}
        <section>
          <PanelLabel hint>2 · Style</PanelLabel>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {styles.map((tag) => (
              <Chip key={tag} tone="gold" className="text-[11px]">
                {tag}
                <button
                  onClick={() => setStyles((prev) => prev.filter((t) => t !== tag))}
                  className="text-gold/70 transition hover:text-gold"
                >
                  <X size={10} />
                </button>
              </Chip>
            ))}
            <button
              onClick={() => {
                const next = lab.styleLibrary.find((t) => !styles.includes(t));
                if (next) setStyles((prev) => [...prev, next]);
              }}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-cream/20 px-2 py-0.5 text-[11px] text-fog transition hover:border-gold/50 hover:text-gold"
            >
              <Plus size={10} /> Add style
            </button>
          </div>
        </section>

        {/* 3 · duration */}
        <section>
          <div className="flex items-center justify-between">
            <PanelLabel hint>3 · Duration</PanelLabel>
            <span className="text-[12px] font-medium tabular-nums text-gold">{fmt(duration)}</span>
          </div>
          <input
            type="range"
            min={lab.durationMin}
            max={lab.durationMax}
            step={1}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="mt-2 w-full accent-gold"
          />
          <div className="mt-1 flex justify-between text-[10px] tabular-nums text-fog/70">
            <span>{fmt(lab.durationMin)}</span>
            <span>{fmt(lab.durationMax)}</span>
          </div>
        </section>

        {/* 4 · arrangement */}
        <section>
          <PanelLabel hint>4 · Arrangement</PanelLabel>
          <div className="mt-2 flex overflow-hidden rounded-xl border border-cream/10">
            {(
              [
                { id: "instrumental", label: "Instrumental", icon: Music2 },
                { id: "vocals", label: "Vocals", icon: Mic },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setArrangement(id)}
                className={cx(
                  "flex flex-1 items-center justify-center gap-1.5 py-2 text-[11px] font-medium transition",
                  arrangement === id
                    ? "bg-gold/12 text-gold"
                    : "text-fog hover:bg-cream/5 hover:text-cream",
                )}
              >
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>
        </section>

        {/* 5 · cloned voice */}
        <section className={cx(arrangement !== "vocals" && "opacity-40")}>
          <PanelLabel hint>5 · Sing in cloned voice</PanelLabel>
          <div className="relative mt-2">
            <button
              onClick={() => arrangement === "vocals" && setVoiceOpen((o) => !o)}
              className="flex w-full items-center gap-2 rounded-xl border border-cream/10 bg-surface px-3 py-2 text-[12px] text-cream/85 transition hover:border-gold/35"
            >
              <AudioWaveform size={13} className="text-gold/80" />
              <span className="flex-1 text-left">{voice.label}</span>
              <ChevronDown
                size={12}
                className={cx("text-fog transition-transform", voiceOpen && "rotate-180")}
              />
            </button>
            {voiceOpen && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-cream/12 bg-raised shadow-xl">
                {lab.singVoices.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => {
                      setVoiceId(v.id);
                      setVoiceOpen(false);
                    }}
                    className={cx(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition hover:bg-cream/5",
                      v.id === voiceId ? "text-gold" : "text-cream/85",
                    )}
                  >
                    <span className="w-3.5">{v.id === voiceId && <Check size={12} />}</span>
                    {v.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-fog/70">
            Vocals render neutral, then convert to the character voice.
          </p>
        </section>
      </div>

      <div className="p-4 pt-2">
        <GoldButton
          onClick={() =>
            canGenerate &&
            lab.generate({
              description,
              styles,
              durationSec: duration,
              arrangement,
              singVoice: arrangement === "vocals" ? voiceId : undefined,
            })
          }
          className={cx(
            "w-full justify-center py-3 text-[13px] uppercase tracking-widest",
            !canGenerate && "pointer-events-none opacity-40",
          )}
        >
          <Sparkles size={14} /> {lab.busy ? "Generating…" : "Generate"}
        </GoldButton>
        <p className="mt-1.5 text-center text-[10px] text-fog/70">{lab.engine.note}</p>
      </div>
    </aside>
  );
}

/* ---------- center: generated tracks ---------- */

function TrackCard({
  track,
  active,
  player,
  onSelect,
}: {
  track: MusicTrack;
  active: boolean;
  player: AudioPlayer;
  onSelect: () => void;
}) {
  if (track.generating) {
    return (
      <div className="rounded-xl border hairline bg-surface/50 p-3.5">
        <div className="flex items-center gap-3.5">
          <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-gold/60 text-[11px] font-semibold tabular-nums text-gold">
            {track.generating.progress}%
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium text-cream">{track.title}</span>
              <span className="text-[11px] text-fog">(Generating…)</span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-cream/8">
              <div
                className="h-full animate-pulse rounded-full bg-gradient-to-r from-gold-deep to-gold"
                style={{ width: `${track.generating.progress}%` }}
              />
            </div>
            <p className="mt-1.5 text-[10px] text-fog/80">{track.generating.stage}</p>
          </div>
          <GhostButton className="shrink-0">Cancel</GhostButton>
        </div>
      </div>
    );
  }

  const loaded = !!track.url && player.src === track.url;
  return (
    <button
      onClick={onSelect}
      className={cx(
        "w-full rounded-xl border p-3.5 text-left transition",
        active
          ? "border-gold/50 bg-surface"
          : "border-transparent bg-surface/50 hover:border-cream/15",
      )}
    >
      <div className="flex items-center gap-3.5">
        <span className={cx("h-12 w-12 shrink-0 rounded-lg", track.swatch)} />
        <span
          onClick={(e) => {
            e.stopPropagation();
            player.toggle(track.url);
          }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-gold to-gold-deep text-ink transition hover:brightness-110"
        >
          {loaded && player.playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium text-cream">{track.title}</span>
            {track.starred && <Star size={11} className="shrink-0 text-gold" fill="currentColor" />}
            <Chip tone="muted" className="ml-auto shrink-0 text-[9px] tabular-nums">
              {track.bpm ? `${track.bpm} BPM` : "—"}
            </Chip>
          </div>
          <Waveform
            seed={track.waveSeed}
            bars={72}
            played={loaded ? player.played : 0}
            className="mt-1.5 h-7!"
          />
          <div className="mt-1 text-[10px] tabular-nums text-fog">{track.duration}</div>
        </div>
        <MoreVertical size={14} className="shrink-0 text-fog/60" />
      </div>
    </button>
  );
}

function TracksPanel({
  trackId,
  player,
  onSelect,
}: {
  trackId: string;
  player: AudioPlayer;
  onSelect: (id: string) => void;
}) {
  const lab = useMusicLab();
  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between p-4 pb-3">
        <h2 className="font-serif text-[16px] font-semibold tracking-wide text-cream">
          Generated tracks
        </h2>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 rounded-lg border border-cream/10 px-2.5 py-1.5 text-[11px] text-cream/80 transition hover:border-gold/35">
            Newest <ChevronDown size={11} className="text-fog" />
          </button>
          <button className="flex h-8 w-8 items-center justify-center rounded-lg border border-cream/10 text-fog transition hover:border-gold/35 hover:text-gold">
            <ListFilter size={13} />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-3">
        {lab.tracks.map((t) => (
          <TrackCard
            key={t.id}
            track={t}
            active={t.id === trackId}
            player={player}
            onSelect={() => onSelect(t.id)}
          />
        ))}
      </div>

      <div className="border-t hairline py-2 text-center text-[10px] uppercase tracking-wider text-fog/70">
        {lab.tracks.length} tracks
      </div>
    </section>
  );
}

/* ---------- right rail: stems inspector ---------- */

const stemIcons = { vocals: Mic, drums: Drum, bass: Guitar, other: AudioWaveform } as const;

function StemsInspector({ track, player }: { track: MusicTrack; player: AudioPlayer }) {
  const lab = useMusicLab();
  const [tab, setTab] = useState<"stems" | "lyrics" | "details">("stems");
  const [stems, setStems] = useState<MusicStem[]>(lab.stems);

  const setGain = (id: string, gainDb: number) =>
    setStems((prev) => prev.map((s) => (s.id === id ? { ...s, gainDb } : s)));

  return (
    <aside className="flex w-[312px] shrink-0 flex-col border-l hairline bg-[#0e0e10]">
      {/* track header */}
      <div className="p-4 pb-3">
        <div className="flex items-center gap-3">
          <span className={cx("h-14 w-14 shrink-0 rounded-xl", track.swatch)} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h2 className="truncate font-serif text-[15px] font-semibold text-cream">
                {track.title}
              </h2>
              {track.starred && (
                <Star size={12} className="shrink-0 text-gold" fill="currentColor" />
              )}
            </div>
            <p className="mt-0.5 text-[10px] tabular-nums text-fog">
              {track.duration} · {track.bpm ? `${track.bpm} BPM` : "—"} · {track.key || "—"}
            </p>
          </div>
          <MoreVertical size={14} className="shrink-0 text-fog/60" />
        </div>
        <Waveform
          seed={track.waveSeed}
          bars={88}
          played={track.url && player.src === track.url ? player.played : 0}
          className="mt-3 h-9!"
        />
      </div>

      {/* tabs */}
      <div className="flex gap-1 px-4">
        {(["stems", "lyrics", "details"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cx(
              "flex-1 rounded-lg py-1.5 text-[10px] font-semibold uppercase tracking-wider transition",
              tab === t ? "bg-gold/12 text-gold" : "text-fog hover:bg-cream/5 hover:text-cream",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "stems" && (
          <>
            <PanelLabel>Stems</PanelLabel>
            <p className="mt-1 text-[10px] text-fog/70">Toggle stems to preview in track.</p>
            <div className="mt-3 space-y-2.5">
              {stems.map((stem) => {
                const Icon = stemIcons[stem.id];
                return (
                  <div key={stem.id} className="flex items-center gap-2.5">
                    <Icon size={14} className={stem.on ? "text-gold/80" : "text-fog/50"} />
                    <span
                      className={cx(
                        "flex-1 text-[12px]",
                        stem.on ? "text-cream" : "text-fog line-through decoration-fog/40",
                      )}
                    >
                      {stem.label}
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
                );
              })}
            </div>

            <div className="mt-5">
              <PanelLabel>Gain</PanelLabel>
              <div className="mt-3 space-y-3">
                {stems.map((stem) => (
                  <div key={stem.id} className="flex items-center gap-3">
                    <span className="w-12 text-[11px] text-cream/80">{stem.label}</span>
                    <input
                      type="range"
                      min={-12}
                      max={12}
                      step={0.5}
                      value={stem.gainDb}
                      disabled={!stem.on}
                      onChange={(e) => setGain(stem.id, Number(e.target.value))}
                      className="min-w-0 flex-1 accent-gold disabled:opacity-30"
                    />
                    <span className="w-14 text-right text-[11px] tabular-nums text-cream/85">
                      {stem.gainDb > 0 ? "+" : ""}
                      {stem.gainDb.toFixed(1)} dB
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === "lyrics" &&
          (track.arrangement === "vocals" ? (
            <p className="text-[12px] leading-relaxed text-cream/85">
              Rise before the light does — the grind is a quiet room.
              <br />
              Nobody claps for reps, but the reps are coming soon.
            </p>
          ) : (
            <p className="text-[12px] leading-relaxed text-fog">
              Instrumental take — switch the arrangement to Vocals to write lyrics.
            </p>
          ))}

        {tab === "details" && (
          <div className="space-y-2">
            {(
              [
                ["Engine", "ACE-Step · local"],
                ["Tempo", track.bpm ? `${track.bpm} BPM` : "—"],
                ["Key", track.key || "—"],
                ["Duration", track.duration],
                ["Arrangement", track.arrangement],
                ["Format", "WAV · 48 kHz · stems"],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between text-[11px]">
                <span className="text-fog">{k}</span>
                <span className="text-cream/85 capitalize">{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2 p-4 pt-2">
        <GoldButton className="w-full justify-center py-2.5">
          <Bookmark size={13} /> Save to assets
        </GoldButton>
        <GhostButton className="w-full justify-center py-2.5">
          <Clapperboard size={13} /> Send to timeline
        </GhostButton>
      </div>
    </aside>
  );
}

/* ---------- screen ---------- */

export function MusicLab() {
  const lab = useMusicLab();
  const player = useAudioPlayer();
  const playable = lab.tracks.filter((t) => !t.generating);
  const [trackId, setTrackId] = useState(
    (lab.tracks.find((t) => t.selected) ?? playable[0])?.id ?? "",
  );
  const track: MusicTrack | undefined = playable.find((t) => t.id === trackId) ?? playable[0];

  return (
    <div className="flex h-full">
      <CreatePanel />
      <TracksPanel trackId={track?.id ?? ""} player={player} onSelect={setTrackId} />
      {track && <StemsInspector track={track} player={player} />}
    </div>
  );
}
