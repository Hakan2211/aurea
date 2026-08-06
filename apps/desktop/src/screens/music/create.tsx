import { useRef, useState } from "react";
import { AudioWaveform, Check, ChevronDown, Dices, Mic, Music2, Plus, Sparkles, X } from "lucide-react";
import { useMusicLab } from "@/hooks";
import { Chip, GoldButton, SectionLabel, Slider, Toggle, cx } from "@/components/ui";

/* Music lab — the Create rail, built to design-refs/2026-08-06-ui-mockups/
 * music-lab-v1.jpg, on the house SectionLabel step badges the mockup draws as
 * gold numerals.
 *
 * Order is description → **arrangement → lyrics → cloned voice** → style →
 * duration, not the mockup's description → style → duration → arrangement →
 * lyrics. The words are the second-most creative thing on the screen and were
 * buried at ⑤ under two settings rows; but Lyrics can't simply move up on its
 * own, because Arrangement is the switch that *reveals* it — put the field
 * above its own toggle and it appears out of nowhere from a control below it.
 * So Arrangement moves up instead and takes Lyrics with it. That's the same
 * call the Voice lab made with SPEAK|CONVERT (§5): the branch that decides
 * what the other steps even contain belongs at the top, and the sticky
 * settings you set once — style, duration — sink below the thing you retype
 * every run. Cloned voice follows Lyrics because it's the third vocals-only
 * step; all three appear and vanish together. */

const LYRIC_TAGS = ["[verse]", "[chorus]", "[bridge]"];
const DUET_SKELETON = "[verse - male]\n\n[verse - female]\n\n[chorus - both]\n";
/** default: keep ACE-Step's own generated singing — the Seed-VC pass is opt-in */
const NO_CONVERSION = { id: "", label: "No conversion — ACE-Step vocals" };

/** the lengths worth one click, per the mockup's chip row. The slider stays
 * for everything between — presets are the common case, not the only one. */
const DURATION_PRESETS = [30, 60, 90, 180];

export function CreatePanel() {
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
  const vocals = arrangement === "vocals";
  const fmt = (sec: number) =>
    `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
  const num = (s: string) => (s.trim() !== "" && !Number.isNaN(Number(s)) ? Number(s) : undefined);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  /* The numerals count what is actually on screen. Lyrics is vocals-only, and
   * with it hidden the rail used to read 1·2·3·4·6 — a numbered list with a
   * gap in it says a step went missing, not that it doesn't apply. */
  let n = 0;
  const step = () => ++n;

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
        {/* description */}
        <section>
          <SectionLabel step={step()} hint>
            Song description
          </SectionLabel>
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

        {/* arrangement */}
        <section>
          <SectionLabel step={step()} hint>
            Arrangement
          </SectionLabel>
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
          {vocals && (
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

        {/* lyrics (vocals only) */}
        {vocals && (
          <section>
            <SectionLabel step={step()} hint>
              Lyrics
            </SectionLabel>
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

        {/* cloned voice */}
        <section className={cx(!vocals && "opacity-40")}>
          <SectionLabel step={step()} hint>
            Cloned voice (optional)
          </SectionLabel>
          <div className="relative mt-2">
            <button
              onClick={() => vocals && setVoiceOpen((o) => !o)}
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

        {/* style */}
        <section>
          <SectionLabel step={step()} hint>
            Style
          </SectionLabel>
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

        {/* duration */}
        <section>
          <SectionLabel
            step={step()}
            hint
            right={<span className="text-[12px] font-medium tabular-nums text-gold">{fmt(duration)}</span>}
          >
            Duration
          </SectionLabel>
          <div className="mt-2 flex gap-1">
            {DURATION_PRESETS.filter((p) => p >= lab.durationMin && p <= lab.durationMax).map((p) => (
              <button
                key={p}
                onClick={() => setDuration(p)}
                className={cx(
                  "flex-1 rounded-lg border py-1 text-[11px] tabular-nums transition",
                  duration === p
                    ? "border-gold/60 bg-gold/12 text-gold"
                    : "border-cream/10 text-cream/70 hover:border-gold/35",
                )}
              >
                {/* 90 is "90s", not "1.5m" — the presets are how long a
                  * track is, and nobody asks for a one-and-a-half-minute cue */}
                {p % 60 === 0 && p >= 60 ? `${p / 60}m` : `${p}s`}
              </button>
            ))}
          </div>
          <Slider
            className="mt-2.5"
            value={duration}
            onChange={setDuration}
            min={lab.durationMin}
            max={lab.durationMax}
            step={1}
          />
          <div className="flex justify-between text-[10px] tabular-nums text-fog/70">
            <span>{fmt(lab.durationMin)}</span>
            <span>{fmt(lab.durationMax)}</span>
          </div>
        </section>

        {/* advanced */}
        <section>
          <button
            onClick={() => setAdvOpen((o) => !o)}
            className="flex w-full items-center justify-between text-2xs font-semibold uppercase tracking-[0.14em] text-fog transition hover:text-cream"
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
          disabled={!canGenerate}
          title={
            lab.busy
              ? "A track is already rendering"
              : description.trim()
                ? "Compose this track"
                : "Describe the track first"
          }
          onClick={() =>
            canGenerate &&
            lab.generate({
              description,
              styles,
              durationSec: duration,
              arrangement,
              singVoice: vocals && voiceId ? voiceId : undefined,
              lyrics: vocals && lyrics.trim() ? lyrics : undefined,
              duet: vocals && duet,
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
          className="w-full justify-center py-3 text-[13px] uppercase tracking-widest"
        >
          <Sparkles size={14} /> {lab.busy ? "Composing…" : "Compose"}
        </GoldButton>
        <p className="mt-1.5 text-center text-[10px] text-fog/70">{lab.engine.note}</p>
      </div>
    </aside>
  );
}
