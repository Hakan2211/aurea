import { useRef, useState } from "react";
import { AudioWaveform, Check, ChevronDown, Dices, Mic, Music2, Plus, Sparkles, X } from "lucide-react";
import { useMusicLab } from "@/hooks";
import {
  AdvancedButton,
  ChoiceChips,
  Chip,
  ComposerBar,
  DrawerField,
  DrawerSection,
  GenerateButton,
  LabDrawer,
  Segmented,
  Slider,
  Toggle,
  customsSummary,
  cx,
  drawerInput,
} from "@/components/ui";

/* Music lab — the composer and its Advanced drawer (UI simplify plan,
 * Stage 3). The composer holds what changes every track: engine,
 * instrumental or vocals, the description (and lyrics when singing), style
 * tags, length, Compose. The drawer holds the duet switch, the cloned voice,
 * an exact length, tempo, seed, language, key, time signature and the
 * sampler. Both read useMusicParams, whose state and payload are the old
 * Create rail's, moved verbatim. */

const LYRIC_TAGS = ["[verse]", "[chorus]", "[bridge]"];
const DUET_SKELETON = "[verse - male]\n\n[verse - female]\n\n[chorus - both]\n";
/** default: keep ACE-Step's own generated singing — the Seed-VC pass is opt-in */
const NO_CONVERSION = { id: "", label: "No conversion — ACE-Step vocals" };

/** the lengths worth one click, per the mockup's chip row. The slider stays
 * for everything between — presets are the common case, not the only one. */
const DURATION_PRESETS = [30, 60, 90, 180];

export function useMusicParams() {
  const lab = useMusicLab();
  const [engineId, setEngineId] = useState<"acestep" | "minimax-music3">("acestep");
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
  const engine = lab.engines.find((e) => e.id === engineId) ?? lab.engines[0];
  /* Music3 takes prompt + lyrics + duration + seed; tempo/key fold into the
   * prompt server-side, and language/timesig/steps/shift are ACE-Step-only */
  const m3 = engineId === "minimax-music3";
  const durationMax = m3 ? Math.min(lab.durationMax, lab.music3DurationMax) : lab.durationMax;
  const canGenerate = !lab.busy && !!description.trim() && !!engine?.available;
  const vocals = arrangement === "vocals";
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


  /** what a plain run would not send — the composer's "N custom" chip */
  const customs: string[] = [];
  if (vocals && duet) customs.push("Duet");
  if (vocals && voiceId) customs.push(`Voice: ${voice.label}`);
  if (num(bpm) !== undefined) customs.push(`BPM ${bpm}`);
  if (/^\d+$/.test(seed)) customs.push(`Seed ${seed}`);
  if (!m3 && language !== "unknown") customs.push(`Language: ${language}`);
  if (keyscale.trim()) customs.push(`Key: ${keyscale.trim()}`);
  if (!m3 && timesig) customs.push(`${timesig}/4`);
  if (!m3 && num(steps) !== undefined) customs.push(`Steps ${steps}`);
  if (!m3 && num(shiftVal) !== undefined) customs.push(`Shift ${shiftVal}`);

  const generate = () =>
    canGenerate &&
    lab.generate({
      engine: engineId,
      description,
      styles,
      durationSec: Math.min(duration, durationMax),
      arrangement,
      singVoice: vocals && voiceId ? voiceId : undefined,
      lyrics: vocals && lyrics.trim() ? lyrics : undefined,
      duet: vocals && duet,
      bpm:
        num(bpm) !== undefined
          ? clamp(Math.round(num(bpm)!), lab.bpmRange[0], lab.bpmRange[1])
          : undefined,
      seed: /^\d+$/.test(seed) ? Number(seed) : undefined,
      // ACE-Step-only knobs — Music3 steers tempo/key through the prompt
      language: m3 ? "unknown" : language,
      keyscale: keyscale.trim() || undefined,
      timesignature: m3
        ? undefined
        : ((timesig || undefined) as "2" | "3" | "4" | "6" | undefined),
      steps:
        !m3 && num(steps) !== undefined
          ? clamp(Math.round(num(steps)!), 1, 100)
          : undefined,
      shift:
        !m3 && num(shiftVal) !== undefined ? clamp(num(shiftVal)!, 0.5, 10) : undefined,
    });

  return {
    lab, engineId, setEngineId, description, setDescription, styles, setStyles,
    styleOpen, setStyleOpen, customStyle, setCustomStyle, duration, setDuration,
    arrangement, setArrangement, voiceId, setVoiceId, voiceOpen, setVoiceOpen,
    lyrics, setLyrics, duet, setDuet, bpm, setBpm, seed, setSeed, language, setLanguage,
    keyscale, setKeyscale, timesig, setTimesig, steps, setSteps, shiftVal, setShiftVal,
    lyricsRef, voice, engine, m3, durationMax, canGenerate, vocals, fmt, insertTag,
    customs, generate,
  };
}

export type MusicParams = ReturnType<typeof useMusicParams>;

const selectCls =
  "rounded-xl border border-cream/10 bg-surface px-2.5 py-1.5 text-xs text-cream transition hover:border-gold/35 focus:border-gold/40 focus:outline-none";

/** The style tags: chips plus an "Add style" popover with the library. */
function StyleTags({ p }: { p: MusicParams }) {
  const { lab, styles, setStyles, styleOpen, setStyleOpen, customStyle, setCustomStyle } = p;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {styles.map((tag) => (
        <Chip key={tag} tone="gold" className="text-xs">
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
          title="Styles also work written straight into the description"
          className={cx(
            "inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-xs transition",
            styleOpen
              ? "border-gold/60 text-gold"
              : "border-cream/20 text-fog hover:border-gold/50 hover:text-gold",
          )}
        >
          <Plus size={10} /> Style
        </button>
        {styleOpen && (
          <div className="absolute bottom-full left-0 z-30 mb-1 w-64 rounded-xl border border-cream/12 bg-raised p-2 shadow-xl">
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
              className="w-full rounded-lg border border-cream/10 bg-surface px-2 py-1.5 text-xs text-cream placeholder:text-fog focus:border-gold/40 focus:outline-none"
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
                    className="rounded-full border border-cream/12 px-2 py-0.5 text-2xs text-cream/80 transition hover:border-gold/50 hover:text-gold"
                  >
                    {t}
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function MusicComposer({
  p,
  advancedOpen,
  onToggleAdvanced,
}: {
  p: MusicParams;
  advancedOpen: boolean;
  onToggleAdvanced: () => void;
}) {
  const {
    lab, engineId, setEngineId, description, setDescription, duration, setDuration,
    arrangement, setArrangement, lyrics, setLyrics, lyricsRef, engine, durationMax,
    canGenerate, vocals, fmt, insertTag, customs, generate,
  } = p;
  const presets = DURATION_PRESETS.filter((d) => d >= lab.durationMin && d <= durationMax);

  return (
    <ComposerBar>
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <Segmented
          value={arrangement}
          onChange={setArrangement}
          options={[
            {
              value: "instrumental" as const,
              label: (
                <span className="flex items-center gap-1.5 px-1">
                  <Music2 size={12} /> Instrumental
                </span>
              ),
            },
            {
              value: "vocals" as const,
              label: (
                <span className="flex items-center gap-1.5 px-1">
                  <Mic size={12} /> Vocals
                </span>
              ),
            },
          ]}
        />
        <span className="flex-1" />
        <select
          value={engineId}
          onChange={(e) => {
            const id = e.target.value as "acestep" | "minimax-music3";
            setEngineId(id);
            if (id === "minimax-music3") setDuration((d) => Math.min(d, lab.music3DurationMax));
          }}
          title={engine?.note ?? "Engine"}
          style={{ colorScheme: "dark" }}
          className={cx(selectCls, "max-w-[240px]")}
        >
          {lab.engines.map((e) => (
            <option key={e.id} value={e.id} disabled={!e.available}>
              {e.label}
              {e.available ? "" : " — not installed"}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, lab.descriptionMax))}
            rows={vocals ? 4 : 3}
            className="h-full w-full resize-none rounded-xl border border-cream/10 bg-surface p-3 pb-6 text-sm leading-relaxed text-cream transition-[border-color,box-shadow] placeholder:text-fog focus:border-gold/45 focus:shadow-[0_0_0_3px_rgba(201,169,110,0.1)] focus:outline-none"
            placeholder="Describe the track — mood, instruments, tempo…"
          />
          <span className="pointer-events-none absolute bottom-2 right-3 text-2xs tabular-nums text-fog">
            {description.length} / {lab.descriptionMax}
          </span>
        </div>
        {vocals && (
          <div className="relative min-w-0 flex-1">
            <textarea
              ref={lyricsRef}
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value.slice(0, lab.lyricsMax))}
              rows={4}
              className="h-full w-full resize-none rounded-xl border border-cream/10 bg-surface p-3 pb-7 font-mono text-xs leading-relaxed text-cream placeholder:font-sans placeholder:text-fog focus:border-gold/40 focus:outline-none"
              placeholder="Lyrics — leave blank for wordless vocals…"
            />
            <div className="absolute inset-x-2 bottom-1.5 flex items-center gap-1">
              {LYRIC_TAGS.map((t) => (
                <button
                  key={t}
                  onClick={() => insertTag(t)}
                  className="rounded-md border border-cream/10 bg-surface px-1.5 py-px font-mono text-xs text-fog transition hover:border-gold/40 hover:text-gold"
                >
                  {t}
                </button>
              ))}
              <span className="ml-auto text-2xs tabular-nums text-fog">
                {lyrics.length} / {lab.lyricsMax}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <StyleTags p={p} />
        <div className="flex items-center gap-1.5">
          <ChoiceChips
            value={presets.includes(duration) ? duration : null}
            onChange={setDuration}
            options={presets.map((d) => ({
              value: d,
              // 90 is "90s", not "1.5m" — nobody asks for a one-and-a-half-minute cue
              label: d % 60 === 0 && d >= 60 ? `${d / 60}m` : `${d}s`,
            }))}
          />
          {!presets.includes(duration) && (
            <span className="text-xs tabular-nums text-gold" title="Exact length — set under Advanced">
              {fmt(Math.min(duration, durationMax))}
            </span>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <AdvancedButton
            open={advancedOpen}
            onClick={onToggleAdvanced}
            customs={customs}
            hint="Duet, cloned voice, exact length, BPM, seed, language, key, time signature, steps"
          />
          <GenerateButton
            onClick={generate}
            disabled={!canGenerate}
            title={
              lab.busy
                ? "A track is already rendering"
                : description.trim()
                  ? "Compose this track"
                  : "Describe the track first"
            }
          >
            <Sparkles size={14} /> {lab.busy ? "Composing…" : description.trim() ? "Compose" : "Describe it"}
          </GenerateButton>
        </div>
      </div>
      {engine?.note && <p className="mt-1.5 text-2xs text-fog">{engine.note}</p>}
    </ComposerBar>
  );
}

export function MusicAdvanced({ p, onClose }: { p: MusicParams; onClose: () => void }) {
  const {
    lab, duration, setDuration, voiceId, setVoiceId, voiceOpen, setVoiceOpen, lyrics, setLyrics,
    duet, setDuet, bpm, setBpm, seed, setSeed, language, setLanguage, keyscale, setKeyscale,
    timesig, setTimesig, steps, setSteps, shiftVal, setShiftVal, voice, m3, durationMax, vocals,
    fmt, customs,
  } = p;
  return (
    <LabDrawer title="Advanced" summary={customsSummary(customs)} onClose={onClose} width={340}>
      <DrawerSection
        title="Vocals"
        note={
          !vocals
            ? "Switch the composer to Vocals to use these."
            : voiceId
              ? "Vocals render neutral, then convert to the character voice (Seed-VC pass)."
              : `${m3 ? "MiniMax-Music3" : "ACE-Step"} sings with its own generated voice — no conversion pass.`
        }
      >
        <div className={cx("space-y-2", !vocals && "pointer-events-none opacity-40")}>
          <div className="flex items-center justify-between">
            <span className="text-xs text-cream/85">Duet (two singers)</span>
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
          <div className="relative">
            <button
              onClick={() => vocals && setVoiceOpen((o) => !o)}
              className="flex w-full items-center gap-2 rounded-xl border border-cream/10 bg-surface px-3 py-2 text-xs text-cream/85 transition hover:border-gold/35"
            >
              <AudioWaveform size={13} className="text-gold/80" />
              <span className="flex-1 truncate text-left">{voice.label}</span>
              <ChevronDown size={12} className={cx("text-fog transition-transform", voiceOpen && "rotate-180")} />
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
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-cream/5",
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
        </div>
      </DrawerSection>

      <DrawerSection
        title="Exact length"
        right={<span className="text-xs font-medium tabular-nums text-gold">{fmt(Math.min(duration, durationMax))}</span>}
      >
        <Slider
          value={Math.min(duration, durationMax)}
          onChange={setDuration}
          min={lab.durationMin}
          max={durationMax}
          step={1}
        />
        <div className="mt-1 flex justify-between text-2xs tabular-nums text-fog">
          <span>{fmt(lab.durationMin)}</span>
          <span>{fmt(durationMax)}</span>
        </div>
      </DrawerSection>

      <DrawerSection
        title="Music"
        note={
          m3
            ? "MiniMax-Music3 folds tempo and key into the prompt."
            : lab.metadataManagedOnly
              ? "Language, key and time signature apply in managed engine mode only."
              : undefined
        }
      >
        <DrawerField label="BPM">
          <input
            type="number"
            value={bpm}
            min={lab.bpmRange[0]}
            max={lab.bpmRange[1]}
            placeholder="auto"
            onChange={(e) => setBpm(e.target.value)}
            className={drawerInput}
          />
        </DrawerField>
        <DrawerField label="Seed">
          <span className="flex items-center gap-1.5">
            <input
              value={seed}
              placeholder="random"
              onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))}
              className={drawerInput}
            />
            <button
              title="Random seed"
              onClick={(e) => {
                e.preventDefault();
                setSeed(String(Math.floor(Math.random() * 1_000_000_000)));
              }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-cream/10 text-cream/70 transition hover:border-gold/40 hover:text-gold"
            >
              <Dices size={12} />
            </button>
          </span>
        </DrawerField>
        {!m3 && (
          <DrawerField label="Language">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              style={{ colorScheme: "dark" }}
              className={cx(drawerInput, "text-left")}
            >
              {lab.languages.map((l) => (
                <option key={l} value={l}>
                  {l === "unknown" ? "auto" : l}
                </option>
              ))}
            </select>
          </DrawerField>
        )}
        <DrawerField label="Key / scale">
          <input
            value={keyscale}
            placeholder="auto — e.g. C Major"
            onChange={(e) => setKeyscale(e.target.value.slice(0, 20))}
            className={cx(drawerInput, "w-36")}
          />
        </DrawerField>
        {!m3 && (
          <div className="flex items-center justify-between gap-2 py-1 text-xs">
            <span className="text-fog">Time signature</span>
            <ChoiceChips
              value={timesig}
              onChange={setTimesig}
              options={["", ...lab.timesignatures].map((t) => ({
                value: t,
                label: t ? `${t}/4` : "auto",
              }))}
            />
          </div>
        )}
      </DrawerSection>

      {!m3 && (
        <DrawerSection title="Sampler">
          <DrawerField label="Steps">
            <input
              type="number"
              value={steps}
              min={1}
              max={100}
              placeholder={String(lab.stepsDefault)}
              onChange={(e) => setSteps(e.target.value)}
              className={drawerInput}
            />
          </DrawerField>
          <DrawerField label="Shift">
            <input
              type="number"
              value={shiftVal}
              min={0.5}
              max={10}
              step={0.5}
              placeholder={String(lab.shiftDefault)}
              onChange={(e) => setShiftVal(e.target.value)}
              className={drawerInput}
            />
          </DrawerField>
        </DrawerSection>
      )}
    </LabDrawer>
  );
}
