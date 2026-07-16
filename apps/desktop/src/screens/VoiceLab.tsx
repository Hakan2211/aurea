import { useEffect, useRef, useState } from "react";
import {
  ArrowRightLeft,
  AudioLines,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  CloudUpload,
  HelpCircle,
  ListMusic,
  Maximize2,
  Mic,
  MoreHorizontal,
  MoreVertical,
  Music4,
  Pause,
  Pencil,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  Square,
  Star,
  Store,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { useVoiceLab } from "@/hooks";
import type { Voice, VoiceTake } from "@/data/sample";
import { Chip, GoldButton, Waveform, cx } from "@/components/ui";
import { useAudioPlayer, type AudioPlayer } from "@/components/useAudioPlayer";
import { sampleFromBlob, useMicRecorder, type VoiceSample } from "@/components/voiceSample";

/* Voice lab — UI-Design/voice lab (TTS,cloning,voice-conversion).jpg.
 * Speak (script → TTS) and Convert (voice-to-voice) over the real engine
 * roster (Chatterbox default for cloned character voices, Fish S2-Pro,
 * VibeVoice, Kokoro); voices + takes flow through useVoiceLab (tRPC seam). */

function PanelLabel({ children, hint }: { children: React.ReactNode; hint?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">{children}</h3>
      {hint && <HelpCircle size={12} className="text-fog/50" />}
    </div>
  );
}

/* ---------- clone-a-voice modal ---------- */

function AddVoiceModal({
  initialFile,
  onClose,
  onAdded,
}: {
  /** a file dragged onto the center-stage dropzone arrives preloaded */
  initialFile: File | null;
  onClose: () => void;
  onAdded: (id: string) => void;
}) {
  const lab = useVoiceLab();
  const mic = useMicRecorder();
  const player = useAudioPlayer();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [sample, setSample] = useState<VoiceSample | null>(null);
  const [sampleLabel, setSampleLabel] = useState("");
  const [decoding, setDecoding] = useState(false);
  const [error, setError] = useState("");

  const loadBlob = async (blob: Blob, label: string) => {
    setError("");
    setDecoding(true);
    try {
      const next = await sampleFromBlob(blob);
      setSample((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return next;
      });
      setSampleLabel(label);
    } catch (err) {
      setError((err as Error).message || "could not decode that audio");
    } finally {
      setDecoding(false);
    }
  };

  useEffect(() => {
    if (initialFile) void loadBlob(initialFile, initialFile.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const toggleRecord = async () => {
    setError("");
    if (mic.seconds === null) {
      try {
        await mic.start();
      } catch {
        setError("microphone unavailable");
      }
    } else {
      try {
        await loadBlob(await mic.stop(), "Mic recording");
      } catch (err) {
        setError((err as Error).message);
      }
    }
  };

  const canSave = !!sample && !!name.trim() && !lab.adding;
  const save = async () => {
    if (!canSave || !sample) return;
    setError("");
    try {
      const voice = await lab.addVoice(name, sample.wavBase64);
      onAdded(voice.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[460px] rounded-2xl border border-cream/12 bg-raised p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-[18px] font-semibold text-cream">Clone a voice</h3>
          <button onClick={onClose} className="text-fog/60 transition hover:text-cream">
            <X size={16} />
          </button>
        </div>
        <p className="mt-1 text-[11px] text-fog">
          10 seconds of clean speech is enough — Chatterbox speaks as this voice from then on.
        </p>

        <label className="mt-4 block">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">
            Voice name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 40))}
            placeholder="e.g. Studio narrator"
            className="mt-1.5 w-full rounded-xl border border-cream/10 bg-surface px-3 py-2 text-[12px] text-cream placeholder:text-fog focus:border-gold/40 focus:outline-none"
          />
        </label>

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <button
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) void loadBlob(f, f.name);
            }}
            className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-cream/15 px-3 py-4 transition hover:border-gold/50 hover:bg-gold/4"
          >
            <CloudUpload size={18} strokeWidth={1.5} className="text-gold/80" />
            <span className="text-[11px] font-medium text-cream/90">Upload a file</span>
            <span className="text-[9px] text-fog/60">WAV, MP3, M4A — drop it here</span>
          </button>
          <button
            onClick={() => void toggleRecord()}
            disabled={!mic.supported}
            className={cx(
              "flex flex-col items-center gap-1 rounded-xl border px-3 py-4 transition",
              mic.seconds !== null
                ? "border-gold/60 bg-gold/8"
                : "border-dashed border-cream/15 hover:border-gold/50 hover:bg-gold/4",
              !mic.supported && "opacity-40",
            )}
          >
            {mic.seconds !== null ? (
              <Square size={18} className="text-gold" />
            ) : (
              <Mic size={18} strokeWidth={1.5} className="text-gold/80" />
            )}
            <span className="text-[11px] font-medium text-cream/90">
              {mic.seconds !== null ? `Recording ${mic.seconds.toFixed(0)}s — stop` : "Record from mic"}
            </span>
            <span className="text-[9px] text-fog/60">
              {mic.seconds !== null ? "click to finish" : "speak naturally for ~15s"}
            </span>
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadBlob(f, f.name);
            e.target.value = "";
          }}
        />

        {(sample || decoding) && (
          <div className="mt-3 flex items-center gap-2.5 rounded-xl border hairline bg-surface/60 p-2.5">
            <button
              onClick={() => sample && player.toggle(sample.url)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cream/15 text-cream/80 transition hover:border-gold/50 hover:text-gold"
            >
              {sample && player.src === sample.url && player.playing ? (
                <Pause size={12} />
              ) : (
                <Play size={12} className="ml-0.5" />
              )}
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] text-cream">
                {decoding ? "Decoding…" : sampleLabel}
              </div>
              <div className="text-[10px] text-fog">
                {sample ? `${sample.seconds.toFixed(1)}s · mono WAV` : ""}
              </div>
            </div>
            {sample && !decoding && <Check size={14} className="shrink-0 text-sage" />}
          </div>
        )}

        {error && <p className="mt-3 text-[11px] text-[#e07a6b]">{error}</p>}

        <GoldButton
          onClick={() => void save()}
          className={cx("mt-4 w-full justify-center py-2.5", !canSave && "pointer-events-none opacity-40")}
        >
          <AudioLines size={13} /> {lab.adding ? "Saving…" : "Save voice"}
        </GoldButton>
      </div>
    </div>
  );
}

/* ---------- left panel: your voices ---------- */

function VoiceRow({
  voice,
  active,
  onSelect,
  onRemove,
}: {
  voice: Voice;
  active: boolean;
  onSelect: () => void;
  /** present only for studio voices — the rest are read-only */
  onRemove?: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [armed, setArmed] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={onSelect}
        className={cx(
          "flex w-full items-center gap-2.5 rounded-xl border p-2 text-left transition",
          active
            ? "border-gold/50 bg-surface"
            : "border-transparent hover:border-cream/15 hover:bg-surface/60",
        )}
      >
        <span
          className={cx(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            voice.swatch,
          )}
        >
          <AudioLines size={14} className="text-cream/80" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[12px] font-medium text-cream">{voice.name}</span>
            {active && <i className="h-1.5 w-1.5 rounded-full bg-sage" />}
          </span>
          <Chip tone={voice.kind === "cloned" ? "gold" : "muted"} className="mt-1 text-[9px] uppercase tracking-wider">
            {voice.kind}
          </Chip>
        </span>
        <span
          onClick={(e) => {
            if (!onRemove) return;
            e.stopPropagation();
            setMenu((m) => !m);
            setArmed(false);
          }}
          className={cx("shrink-0 text-fog/60", onRemove && "transition hover:text-cream")}
        >
          <MoreVertical size={14} />
        </span>
      </button>
      {menu && onRemove && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
          <div className="absolute right-1 top-10 z-20 w-48 rounded-xl border border-cream/12 bg-raised p-1 shadow-xl">
            <button
              onClick={() => {
                if (!armed) {
                  setArmed(true);
                  return;
                }
                setMenu(false);
                onRemove();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-[#e07a6b] transition hover:bg-cream/5"
            >
              <Trash2 size={12} /> {armed ? "Click again to confirm" : "Remove voice"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function VoicesPanel({
  voiceId,
  onSelect,
  onAdd,
}: {
  voiceId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  const lab = useVoiceLab();
  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-r hairline bg-[#0e0e10]">
      <div className="flex items-center justify-between p-4 pb-3">
        <PanelLabel>Your voices</PanelLabel>
        <button
          onClick={onAdd}
          className="flex items-center gap-1 rounded-lg border border-cream/10 px-2 py-1 text-[11px] text-cream/80 transition hover:border-gold/40 hover:text-gold"
        >
          <Plus size={12} /> Add voice
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3">
        {lab.voices.map((v) => (
          <VoiceRow
            key={v.id}
            voice={v}
            active={v.id === voiceId}
            onSelect={() => onSelect(v.id)}
            onRemove={
              v.source === "studio"
                ? () => lab.removeVoice(v.id).catch((err) => console.error("remove voice:", err))
                : undefined
            }
          />
        ))}
      </div>

      <div className="p-3">
        <button className="flex w-full items-center gap-2 rounded-xl border border-cream/10 px-3 py-2.5 text-[12px] text-cream/80 transition hover:border-gold/40 hover:text-gold">
          <Store size={14} />
          <span className="flex-1 text-left">Voice marketplace</span>
          <ChevronRight size={13} className="text-fog" />
        </button>
      </div>
    </aside>
  );
}

/* ---------- center stage ---------- */

function Slider({
  label,
  hint,
  value,
  display,
  min,
  max,
  step,
  ticks,
  onChange,
}: {
  label: string;
  hint?: boolean;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  ticks: [string, string, string];
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex-1">
      <div className="flex items-center justify-between">
        <PanelLabel hint={hint}>{label}</PanelLabel>
        <span className="text-[11px] tabular-nums text-cream/85">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-gold"
      />
      <div className="mt-1 flex justify-between text-[10px] text-fog/70">
        {ticks.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </div>
  );
}

function CenterStage({
  voice,
  selectedTake,
  player,
  onClone,
}: {
  voice: Voice;
  selectedTake: VoiceTake | undefined;
  player: AudioPlayer;
  /** open the clone modal, optionally preloaded with a dropped file */
  onClone: (file?: File) => void;
}) {
  const lab = useVoiceLab();
  const [script, setScript] = useState(lab.script);
  const [pace, setPace] = useState(lab.pace);
  const [emotion, setEmotion] = useState(lab.emotion);
  const [mode, setMode] = useState<"speak" | "convert">("speak");
  const [engineId, setEngineId] = useState(lab.engines[0].id);
  const [engineOpen, setEngineOpen] = useState(false);

  const engine = lab.engines.find((e) => e.id === engineId) ?? lab.engines[0];
  // player drives the clock/waveform only while the selected take is its clip
  const loaded = !!selectedTake?.url && player.src === selectedTake.url;
  const canGenerate = !lab.busy && !!script.trim();

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      {/* header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-serif text-[20px] font-semibold text-cream">{voice.name}</h2>
          <Chip tone={voice.kind === "cloned" ? "gold" : "muted"} className="text-[9px] uppercase tracking-wider">
            {voice.kind}
          </Chip>
          <button className="text-fog/60 transition hover:text-gold">
            <Pencil size={13} />
          </button>
        </div>
        <div className="relative">
          <button
            onClick={() => setEngineOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg border border-cream/10 px-3 py-1.5 text-[12px] text-cream/85 transition hover:border-gold/35"
          >
            <Mic size={12} className="text-gold/80" />
            {engine.label}
            <ChevronDown size={12} className={cx("text-fog transition-transform", engineOpen && "rotate-180")} />
          </button>
          {engineOpen && (
            <div className="absolute right-0 top-full z-10 mt-1 w-64 overflow-hidden rounded-xl border border-cream/12 bg-raised shadow-xl">
              {lab.engines.map((e) => (
                <button
                  key={e.id}
                  onClick={() => {
                    setEngineId(e.id);
                    setEngineOpen(false);
                  }}
                  className={cx(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition hover:bg-cream/5",
                    e.id === engineId ? "text-gold" : "text-cream/85",
                  )}
                >
                  <span className="w-3.5">{e.id === engineId && <Check size={12} />}</span>
                  <span className="flex-1">{e.label}</span>
                  <span className="text-[10px] text-fog">{e.note}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* take player */}
      <div className="rounded-xl border hairline bg-surface/50 p-4">
        <div className="flex items-baseline justify-between text-[10px] tabular-nums text-fog">
          <span>{loaded ? player.position : lab.playback.position}</span>
          <span>{loaded ? player.total : lab.playback.total}</span>
        </div>
        <Waveform
          seed={selectedTake?.waveSeed ?? 1}
          bars={120}
          played={loaded ? player.played : lab.playback.played}
          className="h-16! mt-2"
        />
        <div className="mt-3 flex items-center justify-between">
          <button
            onClick={() => player.toggle(selectedTake?.url)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-b from-gold to-gold-deep text-ink transition hover:brightness-110"
          >
            {loaded && player.playing ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
          </button>
          <span className="text-[11px] text-fog">
            {selectedTake ? `${selectedTake.label} · seed ${selectedTake.waveSeed}` : "No takes yet"}
          </span>
          <button className="text-fog/60 transition hover:text-gold">
            <Maximize2 size={14} />
          </button>
        </div>
      </div>

      {/* script */}
      <section>
        <PanelLabel>Script</PanelLabel>
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value.slice(0, lab.scriptMax))}
          rows={3}
          className="mt-2 w-full resize-none rounded-xl border border-cream/10 bg-surface p-3 text-[12px] leading-relaxed text-cream placeholder:text-fog focus:border-gold/40 focus:outline-none"
          placeholder="Type the line to speak…"
        />
        <div className="mt-1 text-right text-[10px] tabular-nums text-fog/70">
          {script.length} / {lab.scriptMax}
        </div>
      </section>

      {/* clone from sample */}
      <section>
        <PanelLabel hint>Clone a new voice (optional)</PanelLabel>
        <button
          onClick={() => onClone()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onClone(e.dataTransfer.files[0] ?? undefined);
          }}
          className="mt-2 flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-cream/15 px-4 py-5 transition hover:border-gold/50 hover:bg-gold/4"
        >
          <CloudUpload size={20} strokeWidth={1.5} className="text-gold/80" />
          <span className="text-[12px] font-medium text-cream/90">
            Drop an audio file here, upload, or record from the mic
          </span>
          <span className="text-[10px] text-fog/60">WAV, MP3, M4A up to 30 MB · 10s is enough</span>
        </button>
      </section>

      {/* pace + emotion */}
      <div className="flex gap-6">
        <Slider
          label="Pace"
          hint
          value={pace}
          display={`${pace.toFixed(2)}x`}
          min={0.5}
          max={1.5}
          step={0.05}
          ticks={["Slower", "Normal", "Faster"]}
          onChange={setPace}
        />
        <Slider
          label="Emotion"
          hint
          value={emotion}
          display={emotion.toFixed(2)}
          min={0}
          max={1}
          step={0.05}
          ticks={["Calm", "Neutral", "Expressive"]}
          onChange={setEmotion}
        />
      </div>

      {/* speak / convert */}
      <section className="mt-auto">
        <div className="flex overflow-hidden rounded-xl border border-cream/10">
          {(
            [
              { id: "speak", label: "Speak", icon: AudioLines },
              { id: "convert", label: "Convert", icon: ArrowRightLeft },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={cx(
                "flex flex-1 items-center justify-center gap-2 py-2.5 text-[12px] font-medium uppercase tracking-wider transition",
                mode === id ? "bg-gold/12 text-gold" : "text-fog hover:bg-cream/5 hover:text-cream",
              )}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] text-fog">Generate speech from script</p>
            <GoldButton
              onClick={() =>
                canGenerate && lab.generate({ text: script, voice: voice.id, engine: engineId, pace, emotion })
              }
              className={cx(
                "mt-2 w-full justify-center py-2.5",
                mode !== "speak" && "opacity-40",
                !canGenerate && "pointer-events-none opacity-40",
              )}
            >
              <AudioLines size={13} /> {lab.busy ? "Generating…" : "Generate speech"}
            </GoldButton>
          </div>
          <div>
            <p className="flex items-center gap-1 text-[11px] text-fog">
              Voice-to-voice conversion <HelpCircle size={11} className="text-fog/50" />
            </p>
            <button
              className={cx(
                "mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-cream/15 py-2.5 text-[12px] text-cream/80 transition hover:border-gold/50 hover:text-gold",
                mode !== "convert" && "opacity-40",
              )}
            >
              <Music4 size={13} /> Upload source audio
            </button>
          </div>
        </div>
      </section>
    </section>
  );
}

/* ---------- right rail: takes history ---------- */

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          size={10}
          className={i < rating ? "text-gold" : "text-cream/20"}
          fill={i < rating ? "currentColor" : "none"}
        />
      ))}
    </span>
  );
}

function TakeRow({
  take,
  active,
  player,
  onSelect,
}: {
  take: VoiceTake;
  active: boolean;
  player: AudioPlayer;
  onSelect: () => void;
}) {
  const playing = player.playing && !!take.url && player.src === take.url;
  return (
    <div
      onClick={onSelect}
      className={cx(
        "cursor-pointer rounded-xl border p-2.5 transition",
        take.generating && "opacity-60",
        active
          ? "border-gold/50 bg-surface"
          : "border-transparent bg-surface/60 hover:border-cream/15",
      )}
    >
      <div className="flex items-center gap-2.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
            if (!take.generating) player.toggle(take.url);
          }}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cream/15 text-cream/80 transition hover:border-gold/50 hover:text-gold"
        >
          {playing ? <Pause size={12} /> : <Play size={12} className="ml-0.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-medium text-cream">{take.label}</span>
            {active && (
              <Chip tone="gold" className="text-[8px] uppercase tracking-wider">
                Selected
              </Chip>
            )}
          </div>
          <Stars rating={take.rating} />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {/* while generating, duration holds the job's stage text */}
          <span className="text-[11px] tabular-nums text-cream/80">{take.duration}</span>
          <MoreHorizontal size={13} className="text-fog/60" />
        </div>
      </div>

      {active && (
        <div className="mt-2.5 flex gap-1.5">
          <GoldButton className="flex-1 justify-center py-2">
            <Bookmark size={12} /> Save to assets
          </GoldButton>
          <button className="flex w-9 items-center justify-center rounded-lg border border-cream/10 text-cream/70 transition hover:border-gold/40 hover:text-gold">
            <Bookmark size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

function TakesRail({
  selectedId,
  player,
  onSelect,
}: {
  selectedId: string | undefined;
  player: AudioPlayer;
  onSelect: (id: string) => void;
}) {
  const lab = useVoiceLab();
  return (
    <aside className="flex w-[316px] shrink-0 flex-col border-l hairline bg-[#0e0e10]">
      <div className="flex items-center justify-between p-4 pb-3">
        <PanelLabel>Takes history</PanelLabel>
        <button className="text-fog/60 transition hover:text-gold">
          <ListMusic size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3">
        {lab.takes.map((t) => (
          <TakeRow
            key={t.id}
            take={t}
            active={t.id === selectedId}
            player={player}
            onSelect={() => onSelect(t.id)}
          />
        ))}
      </div>
      <div className="p-3">
        <button className="w-full rounded-xl border border-cream/10 py-2 text-[12px] text-cream/80 transition hover:border-gold/40 hover:text-gold">
          View all takes
        </button>
      </div>
    </aside>
  );
}

/* ---------- bottom player bar ---------- */

function PlayerBar({
  voice,
  selectedTake,
  player,
}: {
  voice: Voice;
  selectedTake: VoiceTake | undefined;
  player: AudioPlayer;
}) {
  const lab = useVoiceLab();
  const loaded = !!selectedTake?.url && player.src === selectedTake.url;
  const pct = (loaded ? player.played : lab.playback.played) * 100;

  return (
    <footer className="flex items-center gap-4 border-t hairline px-4 py-2.5">
      <div className="flex w-[224px] items-center gap-2.5">
        <span className={cx("flex h-8 w-8 items-center justify-center rounded-full", voice.swatch)}>
          <AudioLines size={13} className="text-cream/80" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[12px] text-cream">{voice.name}</div>
          <div className="text-[10px] text-fog">{selectedTake?.label ?? "No take"}</div>
        </div>
      </div>

      <span className="text-[10px] tabular-nums text-fog">
        {loaded ? player.position : lab.playback.position}
      </span>
      <div className="relative h-1 min-w-0 flex-1 rounded-full bg-cream/8">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-gold-deep to-gold"
          style={{ width: `${pct}%` }}
        />
        <span
          className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-gold"
          style={{ left: `calc(${pct}% - 5px)` }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-fog">
        {loaded ? player.total : lab.playback.total}
      </span>

      <div className="flex items-center gap-1">
        <button className="flex h-8 w-8 items-center justify-center rounded-full text-cream/70 transition hover:text-gold">
          <SkipBack size={14} />
        </button>
        <button
          onClick={() => player.toggle(selectedTake?.url)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-b from-gold to-gold-deep text-ink transition hover:brightness-110"
        >
          {loaded && player.playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
        </button>
        <button className="flex h-8 w-8 items-center justify-center rounded-full text-cream/70 transition hover:text-gold">
          <SkipForward size={14} />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <Volume2 size={14} className="text-fog" />
        <div className="relative h-1 w-20 rounded-full bg-cream/8">
          <span className="absolute inset-y-0 left-0 w-[70%] rounded-full bg-gold/70" />
        </div>
      </div>
    </footer>
  );
}

/* ---------- screen ---------- */

export function VoiceLab() {
  const lab = useVoiceLab();
  const player = useAudioPlayer();
  const [voiceId, setVoiceId] = useState(lab.voices[0]?.id ?? "");
  const [takeId, setTakeId] = useState<string | null>(null);
  const [clone, setClone] = useState<{ open: boolean; file: File | null }>({
    open: false,
    file: null,
  });
  const voice = lab.voices.find((v) => v.id === voiceId) ?? lab.voices[0];
  const selectedTake: VoiceTake | undefined =
    lab.takes.find((t) => t.id === takeId) ?? lab.takes.find((t) => t.selected) ?? lab.takes[0];
  if (!voice) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <VoicesPanel
          voiceId={voice.id}
          onSelect={setVoiceId}
          onAdd={() => setClone({ open: true, file: null })}
        />
        <CenterStage
          voice={voice}
          selectedTake={selectedTake}
          player={player}
          onClone={(file) => setClone({ open: true, file: file ?? null })}
        />
        <TakesRail selectedId={selectedTake?.id} player={player} onSelect={setTakeId} />
      </div>
      <PlayerBar voice={voice} selectedTake={selectedTake} player={player} />
      {clone.open && (
        <AddVoiceModal
          initialFile={clone.file}
          onClose={() => setClone({ open: false, file: null })}
          onAdded={(id) => {
            setClone({ open: false, file: null });
            setVoiceId(id);
          }}
        />
      )}
    </div>
  );
}
