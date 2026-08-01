import { useRef, useState } from "react";
import {
  AudioWaveform,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  Dices,
  Download,
  Drum,
  Guitar,
  HelpCircle,
  ListFilter,
  ListPlus,
  Mic,
  MoreVertical,
  Music2,
  Pause,
  Play,
  Plus,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { downloadAsset, useMusicLab, useSendToTimeline } from "@/hooks";
import type { MusicStem, MusicTrack } from "@/data/sample";
import { Chip, GhostButton, GoldButton, Waveform, cx } from "@/components/ui";
import { SendToTimeline } from "@/components/SendToTimeline";
import { useAudioPlayer, useMediaDuration, type AudioPlayer } from "@/components/useAudioPlayer";

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

const LYRIC_TAGS = ["[verse]", "[chorus]", "[bridge]"];
const DUET_SKELETON = "[verse - male]\n\n[verse - female]\n\n[chorus - both]\n";
/** default: keep ACE-Step's own generated singing — the Seed-VC pass is opt-in */
const NO_CONVERSION = { id: "", label: "No conversion — ACE-Step vocals" };

function CreatePanel() {
  const lab = useMusicLab();
  const [description, setDescription] = useState(lab.description);
  const [styles, setStyles] = useState(lab.styles);
  const [styleOpen, setStyleOpen] = useState(false);
  const [customStyle, setCustomStyle] = useState("");
  const [duration, setDuration] = useState(lab.durationSec);
  const [arrangement, setArrangement] = useState(lab.arrangement);
  const [voiceId, setVoiceId] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [lyrics, setLyrics] = useState("");
  const [duet, setDuet] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const [bpm, setBpm] = useState("");
  const [seed, setSeed] = useState("");
  const [language, setLanguage] = useState("unknown");
  const [keyscale, setKeyscale] = useState("");
  const [timesig, setTimesig] = useState("");
  const [steps, setSteps] = useState("");
  const [shiftVal, setShiftVal] = useState("");
  const lyricsRef = useRef<HTMLTextAreaElement>(null);

  const voice =
    (voiceId ? lab.singVoices.find((v) => v.id === voiceId) : undefined) ?? NO_CONVERSION;
  const canGenerate = !lab.busy && !!description.trim();
  const fmt = (sec: number) =>
    `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
  const num = (s: string) => (s.trim() !== "" && !Number.isNaN(Number(s)) ? Number(s) : undefined);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  const insertTag = (tag: string) => {
    const el = lyricsRef.current;
    const pos = el?.selectionStart ?? lyrics.length;
    const next = `${lyrics.slice(0, pos)}${tag}\n${lyrics.slice(pos)}`.slice(0, lab.lyricsMax);
    setLyrics(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos + tag.length + 1, pos + tag.length + 1);
    });
  };

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
            <div className="relative">
              <button
                onClick={() => setStyleOpen((o) => !o)}
                className={cx(
                  "inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[11px] transition",
                  styleOpen
                    ? "border-gold/60 text-gold"
                    : "border-cream/20 text-fog hover:border-gold/50 hover:text-gold",
                )}
              >
                <Plus size={10} /> Add style
              </button>
              {styleOpen && (
                <div className="absolute left-0 top-full z-10 mt-1 w-60 rounded-xl border border-cream/12 bg-raised p-2 shadow-xl">
                  <input
                    autoFocus
                    value={customStyle}
                    onChange={(e) => setCustomStyle(e.target.value.slice(0, 40))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const tag = customStyle.trim();
                        if (tag && !styles.includes(tag)) setStyles((prev) => [...prev, tag]);
                        setCustomStyle("");
                        setStyleOpen(false);
                      }
                      if (e.key === "Escape") setStyleOpen(false);
                    }}
                    placeholder="Type any style + Enter…"
                    className="w-full rounded-lg border border-cream/10 bg-surface px-2 py-1.5 text-[11px] text-cream placeholder:text-fog/60 focus:border-gold/40 focus:outline-none"
                  />
                  <div className="mt-2 flex flex-wrap gap-1">
                    {lab.styleLibrary
                      .filter((t) => !styles.includes(t))
                      .map((t) => (
                        <button
                          key={t}
                          onClick={() => {
                            setStyles((prev) => [...prev, t]);
                            setStyleOpen(false);
                          }}
                          className="rounded-full border border-cream/12 px-2 py-0.5 text-[10px] text-cream/80 transition hover:border-gold/50 hover:text-gold"
                        >
                          {t}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <p className="mt-1.5 text-[10px] text-fog/70">
            Styles also work written straight into the description.
          </p>
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
          {arrangement === "vocals" && (
            <div className="mt-2 flex items-center justify-between rounded-xl border border-cream/10 bg-surface px-3 py-2">
              <span className="text-[11px] text-cream/85">Duet (two singers)</span>
              <Toggle
                on={duet}
                onChange={() => {
                  setDuet((d) => {
                    if (!d && !lyrics.trim()) setLyrics(DUET_SKELETON);
                    return !d;
                  });
                }}
              />
            </div>
          )}
        </section>

        {/* 5 · lyrics (vocals only) */}
        {arrangement === "vocals" && (
          <section>
            <PanelLabel hint>5 · Lyrics</PanelLabel>
            <textarea
              ref={lyricsRef}
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value.slice(0, lab.lyricsMax))}
              rows={7}
              className="mt-2 w-full resize-none rounded-xl border border-cream/10 bg-surface p-3 font-mono text-[11px] leading-relaxed text-cream placeholder:font-sans placeholder:text-fog focus:border-gold/40 focus:outline-none"
              placeholder="Leave blank for wordless vocals…"
            />
            <div className="mt-1 flex items-center justify-between">
              <div className="flex gap-1">
                {LYRIC_TAGS.map((t) => (
                  <button
                    key={t}
                    onClick={() => insertTag(t)}
                    className="rounded-md border border-cream/10 px-1.5 py-0.5 font-mono text-[10px] text-fog transition hover:border-gold/40 hover:text-gold"
                  >
                    {t}
                  </button>
                ))}
              </div>
              <span className="text-[10px] tabular-nums text-fog/70">
                {lyrics.length} / {lab.lyricsMax}
              </span>
            </div>
          </section>
        )}

        {/* 6 · cloned voice */}
        <section className={cx(arrangement !== "vocals" && "opacity-40")}>
          <PanelLabel hint>6 · Cloned voice (optional)</PanelLabel>
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
                {[NO_CONVERSION, ...lab.singVoices].map((v) => (
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
            {voiceId
              ? "Vocals render neutral, then convert to the character voice (Seed-VC pass)."
              : "ACE-Step sings with its own generated voice — no conversion pass."}
          </p>
        </section>

        {/* advanced */}
        <section>
          <button
            onClick={() => setAdvOpen((o) => !o)}
            className="flex w-full items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-fog transition hover:text-cream"
          >
            Advanced settings
            <ChevronDown size={13} className={cx("transition-transform", advOpen && "rotate-180")} />
          </button>
          {advOpen && (
            <div className="mt-2.5 space-y-2.5 rounded-xl bg-surface p-3">
              <label className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-fog">BPM</span>
                <input
                  type="number"
                  value={bpm}
                  min={lab.bpmRange[0]}
                  max={lab.bpmRange[1]}
                  placeholder="auto"
                  onChange={(e) => setBpm(e.target.value)}
                  className="w-20 rounded-lg border border-cream/10 bg-raised px-2 py-1.5 text-right text-[11px] tabular-nums text-cream placeholder:text-fog/50 focus:border-gold/40 focus:outline-none"
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-fog">Seed</span>
                <span className="flex items-center gap-1.5">
                  <input
                    value={seed}
                    placeholder="random"
                    onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))}
                    className="w-24 rounded-lg border border-cream/10 bg-raised px-2 py-1.5 text-right text-[11px] tabular-nums text-cream placeholder:text-fog/50 focus:border-gold/40 focus:outline-none"
                  />
                  <button
                    title="Random seed"
                    onClick={() => setSeed(String(Math.floor(Math.random() * 1_000_000_000)))}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-cream/10 text-cream/70 transition hover:border-gold/40 hover:text-gold"
                  >
                    <Dices size={12} />
                  </button>
                </span>
              </label>
              <label className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-fog">Language</span>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-24 rounded-lg border border-cream/10 bg-raised px-2 py-1.5 text-[11px] text-cream focus:border-gold/40 focus:outline-none"
                >
                  {lab.languages.map((l) => (
                    <option key={l} value={l}>
                      {l === "unknown" ? "auto" : l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-fog">Key / scale</span>
                <input
                  value={keyscale}
                  placeholder={'auto — e.g. "C Major"'}
                  onChange={(e) => setKeyscale(e.target.value.slice(0, 20))}
                  className="w-32 rounded-lg border border-cream/10 bg-raised px-2 py-1.5 text-right text-[11px] text-cream placeholder:text-fog/50 focus:border-gold/40 focus:outline-none"
                />
              </label>
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-fog">Time signature</span>
                <div className="flex gap-1">
                  {["", ...lab.timesignatures].map((t) => (
                    <button
                      key={t || "auto"}
                      onClick={() => setTimesig(t)}
                      className={cx(
                        "rounded-md border px-2 py-1 text-[10px] tabular-nums transition",
                        timesig === t
                          ? "border-gold/60 bg-gold/12 text-gold"
                          : "border-cream/10 text-cream/70 hover:border-gold/35",
                      )}
                    >
                      {t ? `${t}/4` : "auto"}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-fog">Steps</span>
                <input
                  type="number"
                  value={steps}
                  min={1}
                  max={100}
                  placeholder={String(lab.stepsDefault)}
                  onChange={(e) => setSteps(e.target.value)}
                  className="w-20 rounded-lg border border-cream/10 bg-raised px-2 py-1.5 text-right text-[11px] tabular-nums text-cream placeholder:text-fog/50 focus:border-gold/40 focus:outline-none"
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-fog">Shift</span>
                <input
                  type="number"
                  value={shiftVal}
                  min={0.5}
                  max={10}
                  step={0.5}
                  placeholder={String(lab.shiftDefault)}
                  onChange={(e) => setShiftVal(e.target.value)}
                  className="w-20 rounded-lg border border-cream/10 bg-raised px-2 py-1.5 text-right text-[11px] tabular-nums text-cream placeholder:text-fog/50 focus:border-gold/40 focus:outline-none"
                />
              </label>
              {lab.metadataManagedOnly && (
                <p className="pt-1 text-[10px] leading-relaxed text-fog/70">
                  Language, key and time signature apply in managed engine mode only.
                </p>
              )}
            </div>
          )}
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
              singVoice: arrangement === "vocals" && voiceId ? voiceId : undefined,
              lyrics: arrangement === "vocals" && lyrics.trim() ? lyrics : undefined,
              duet: arrangement === "vocals" && duet,
              bpm:
                num(bpm) !== undefined
                  ? clamp(Math.round(num(bpm)!), lab.bpmRange[0], lab.bpmRange[1])
                  : undefined,
              seed: /^\d+$/.test(seed) ? Number(seed) : undefined,
              language,
              keyscale: keyscale.trim() || undefined,
              timesignature: (timesig || undefined) as "2" | "3" | "4" | "6" | undefined,
              steps:
                num(steps) !== undefined ? clamp(Math.round(num(steps)!), 1, 100) : undefined,
              shift: num(shiftVal) !== undefined ? clamp(num(shiftVal)!, 0.5, 10) : undefined,
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
  onCancel,
  onDelete,
  onSend,
  sending,
}: {
  track: MusicTrack;
  active: boolean;
  player: AudioPlayer;
  onSelect: () => void;
  /** stop the job behind a generating card */
  onCancel: () => void;
  onDelete: () => void;
  onSend: () => void;
  sending: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const [armed, setArmed] = useState(false);
  const probed = useMediaDuration(track.generating ? undefined : track.url);

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
          <GhostButton onClick={onCancel} className="shrink-0">
            Cancel
          </GhostButton>
        </div>
      </div>
    );
  }

  const loaded = !!track.url && player.src === track.url;
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
      <div className="flex items-center gap-3.5">
        <span className={cx("h-12 w-12 shrink-0 rounded-lg", track.swatch)} />
        <button
          onClick={(e) => {
            e.stopPropagation();
            player.toggle(track.url);
          }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-gold to-gold-deep text-ink transition hover:brightness-110"
        >
          {loaded && player.playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium text-cream">{track.title}</span>
            {track.starred && <Star size={11} className="shrink-0 text-gold" fill="currentColor" />}
            <Chip tone="muted" className="ml-auto shrink-0 text-[9px] tabular-nums">
              {track.duration || probed || "…"}
            </Chip>
          </div>
          <Waveform
            seed={track.waveSeed}
            bars={72}
            played={loaded ? player.played : 0}
            className="mt-1.5 h-7!"
          />
          <div className="mt-1 text-[10px] tabular-nums text-fog">
            {(track.duration || probed) && `${track.duration || probed} · `}
            {track.arrangement}
          </div>
        </div>
        <button
          title="Track options"
          onClick={(e) => {
            e.stopPropagation();
            setMenu((m) => !m);
            setArmed(false);
          }}
          className="shrink-0 text-fog/60 transition hover:text-cream"
        >
          <MoreVertical size={14} />
        </button>
      </div>

      {menu && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={(e) => {
              e.stopPropagation();
              setMenu(false);
            }}
          />
          <div className="absolute right-2 top-12 z-20 w-52 rounded-xl border border-cream/12 bg-raised p-1 shadow-xl">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenu(false);
                onSend();
              }}
              disabled={sending || !track.relPath}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-cream/85 transition hover:bg-cream/5 disabled:opacity-40"
            >
              <ListPlus size={12} /> {sending ? "Sending…" : "Send to timeline"}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenu(false);
                if (track.url) void downloadAsset(track.url, `${track.title || "track"}.wav`);
              }}
              disabled={!track.url}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-cream/85 transition hover:bg-cream/5 disabled:opacity-40"
            >
              <Download size={12} /> Download
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (!armed) {
                  setArmed(true);
                  return;
                }
                setMenu(false);
                setArmed(false);
                onDelete();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-[#e07a6b] transition hover:bg-cream/5"
            >
              <Trash2 size={12} /> {armed ? "Click again to confirm" : "Delete from disk"}
            </button>
          </div>
        </>
      )}
    </div>
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
  const timeline = useSendToTimeline();
  const [newestFirst, setNewestFirst] = useState(true);
  const [filter, setFilter] = useState<"all" | "instrumental" | "vocals">("all");
  const [dismissed, setDismissed] = useState<string[]>([]);

  const generating = lab.tracks.filter((t) => t.generating);
  let finished = lab.tracks.filter((t) => !t.generating);
  if (filter !== "all") finished = finished.filter((t) => t.arrangement === filter);
  if (!newestFirst) finished = [...finished].reverse();
  const shown = [...generating, ...finished];

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between p-4 pb-3">
        <h2 className="font-serif text-[16px] font-semibold tracking-wide text-cream">
          Generated tracks
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setNewestFirst((n) => !n)}
            title="Toggle sort order"
            className="flex items-center gap-1.5 rounded-lg border border-cream/10 px-2.5 py-1.5 text-[11px] text-cream/80 transition hover:border-gold/35"
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
              "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] transition",
              filter === "all"
                ? "border-cream/10 text-fog hover:border-gold/35 hover:text-gold"
                : "border-gold/40 text-gold",
            )}
          >
            <ListFilter size={13} />
            {filter !== "all" && filter}
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
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-cream">
                  {f.title}
                </span>
                <button
                  onClick={() => lab.retry(f.id)}
                  className="shrink-0 rounded-lg border border-cream/15 px-2 py-1 text-[10px] text-cream/85 transition hover:border-gold/45 hover:text-gold"
                >
                  Retry
                </button>
                <button
                  onClick={() => setDismissed((prev) => [...prev, f.id])}
                  title="Dismiss"
                  className="shrink-0 text-fog/60 transition hover:text-cream"
                >
                  <X size={13} />
                </button>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-red-300">{f.error}</p>
            </div>
          ))}
        {shown.map((t) => (
          <TrackCard
            key={t.id}
            track={t}
            active={t.id === trackId}
            player={player}
            onSelect={() => onSelect(t.id)}
            onCancel={() => lab.cancel(t.id)}
            onDelete={() => {
              if (t.relPath) void lab.remove(t.relPath);
            }}
            onSend={() => {
              if (t.relPath) void timeline.send(t.relPath);
            }}
            sending={timeline.sending}
          />
        ))}
      </div>

      <div className="border-t hairline py-2 text-center text-[10px] uppercase tracking-wider text-fog/70">
        {shown.length} tracks
      </div>
    </section>
  );
}

/* ---------- right rail: stems inspector ---------- */

const stemIcons = { vocals: Mic, drums: Drum, bass: Guitar, other: AudioWaveform } as const;

/** ACE-Step section tags — "[verse]", "[chorus]", "[bridge]" — mark structure
 * rather than words, so they read as headings, not as a line to sing. */
const SECTION_TAG = /^\s*\[[^\]]+\]\s*$/;

/** The words the take was sung to, read back off the provenance sidecar. Two
 * different nothings hide behind an empty tab, and conflating them reads as a
 * bug: a take sung wordlessly on purpose, and one made before the studio kept
 * lyrics at all. The sidecar's presence tells them apart. */
function LyricsPanel({ track }: { track: MusicTrack }) {
  const [copied, setCopied] = useState(false);

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

  const copy = () => {
    void navigator.clipboard.writeText(track.lyrics!);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <PanelLabel>Lyrics</PanelLabel>
        <button
          onClick={copy}
          title="Copy lyrics"
          className="flex items-center gap-1 text-[10px] text-fog transition hover:text-gold"
        >
          {copied ? <Check size={11} className="text-gold" /> : <Copy size={11} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="mt-2.5 space-y-0.5">
        {track.lyrics.split("\n").map((line, i) =>
          SECTION_TAG.test(line) ? (
            <div
              key={i}
              className="pt-2.5 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gold/70 first:pt-0"
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
      {track.prompt && (
        <div className="mt-5 border-t hairline pt-3">
          <PanelLabel>Brief</PanelLabel>
          <p className="mt-1.5 text-[11px] leading-relaxed text-fog">{track.prompt}</p>
        </div>
      )}
    </>
  );
}

function StemsInspector({ track, player }: { track: MusicTrack; player: AudioPlayer }) {
  const lab = useMusicLab();
  const [tab, setTab] = useState<"stems" | "lyrics" | "details">("stems");
  const [stems, setStems] = useState<MusicStem[]>(lab.stems);
  const probed = useMediaDuration(track.url);
  const duration = track.duration || probed || "—";

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
              {duration} · {track.bpm ? `${track.bpm} BPM` : "—"} · {track.key || "—"}
            </p>
          </div>
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
            <p className="mt-1 text-[10px] leading-relaxed text-fog/70">
              Stem separation isn't wired to the engine yet — these controls are a
              preview of the coming mixer and don't change the file.
            </p>
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

        {tab === "lyrics" && <LyricsPanel track={track} />}

        {tab === "details" && (
          <div className="space-y-2">
            {(
              [
                ["Engine", "ACE-Step · local"],
                ["Tempo", track.bpm ? `${track.bpm} BPM` : "—"],
                ["Key", track.key || "—"],
                ["Duration", duration],
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
        <GoldButton
          onClick={() => {
            if (track.url) void downloadAsset(track.url, `${track.title || "track"}.wav`);
          }}
          disabled={!track.url}
          className="w-full justify-center py-2.5"
        >
          <Download size={13} /> Download WAV
        </GoldButton>
        <SendToTimeline
          relPath={track.generating ? undefined : track.relPath}
          tone="ghost"
          className="w-full justify-center py-2.5"
        />
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
