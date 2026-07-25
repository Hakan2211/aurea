import { useEffect, useRef, useState } from "react";
import {
  ArrowRightLeft,
  AudioLines,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CloudUpload,
  HelpCircle,
  ListMusic,
  Maximize2,
  Mic,
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
import { downloadAsset, useVoiceLab } from "@/hooks";
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
  player,
  onSelect,
  onRemove,
}: {
  voice: Voice;
  active: boolean;
  player: AudioPlayer;
  onSelect: () => void;
  /** present only for studio voices — the rest are read-only */
  onRemove?: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [armed, setArmed] = useState(false);
  const playingSample =
    !!voice.sampleUrl && player.src === voice.sampleUrl && player.playing;
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
          <span className="mt-1 flex items-center gap-1">
            <Chip tone={voice.kind === "cloned" ? "gold" : "muted"} className="text-[9px] uppercase tracking-wider">
              {voice.kind}
            </Chip>
            {voice.rvcTrained && (
              <Chip tone="gold" className="text-[9px] uppercase tracking-wider">
                RVC
              </Chip>
            )}
          </span>
        </span>
        {voice.sampleUrl && (
          <span
            title={playingSample ? "Pause sample" : "Play the voice's reference clip"}
            onClick={(e) => {
              e.stopPropagation();
              player.toggle(voice.sampleUrl);
            }}
            className={cx(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition",
              playingSample
                ? "border-gold/60 text-gold"
                : "border-cream/15 text-cream/70 hover:border-gold/50 hover:text-gold",
            )}
          >
            {playingSample ? <Pause size={11} /> : <Play size={11} className="ml-0.5" />}
          </span>
        )}
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
  player,
  onSelect,
  onAdd,
}: {
  voiceId: string;
  player: AudioPlayer;
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
            player={player}
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
  const [source, setSource] = useState<{ rel: string; name: string } | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [vcSing, setVcSing] = useState(false);
  const [vcSteps, setVcSteps] = useState("");
  const [vcShift, setVcShift] = useState("");
  // RVC singing: octave-correct the vocals into the target voice's register —
  // "auto" measures the song against the voice ref, no gender assumptions
  const [vcPitch, setVcPitch] = useState<"auto" | "none" | "octave-down" | "octave-up">("auto");
  const [vcError, setVcError] = useState<string | null>(null);
  // "auto" prefers the voice's trained RVC model (the better path) when it exists
  const [vcEngineSel, setVcEngineSel] = useState<"auto" | "seedvc" | "rvc">("auto");
  // DramaBox-only knobs (its delivery is prompt-driven — pace/emotion don't apply)
  const [dbxSeed, setDbxSeed] = useState("42");
  const [dbxCfg, setDbxCfg] = useState(2.5);
  const [dbxStg, setDbxStg] = useState(1.5);
  const [dbxDurMult, setDbxDurMult] = useState(0.9);
  const [dbxGenDur, setDbxGenDur] = useState("");
  const [dbxWatermark, setDbxWatermark] = useState(false);
  const sourceInput = useRef<HTMLInputElement>(null);

  const engine = lab.engines.find((e) => e.id === engineId) ?? lab.engines[0];
  // player drives the clock/waveform only while the selected take is its clip
  const loaded = !!selectedTake?.url && player.src === selectedTake.url;
  const canGenerate = !lab.busy && !!script.trim();
  const rvcReady = lab.rvcAvailable && !!voice.rvcTrained;
  const vcEngine =
    vcEngineSel !== "auto" ? vcEngineSel : rvcReady ? ("rvc" as const) : ("seedvc" as const);
  const canConvert =
    !lab.busy &&
    !!source &&
    voice.kind === "cloned" &&
    (vcEngine === "rvc" ? rvcReady : lab.convertAvailable);
  const vcStepsDefault = vcSing ? lab.convertStepsDefault.sing : lab.convertStepsDefault.speak;

  const uploadSource = async (file: File) => {
    setVcError(null);
    try {
      // full songs allowed — cap at 5 min to bound the payload
      const sample = await sampleFromBlob(file, 300);
      const rel = await lab.addSource(file.name.replace(/\.[^.]+$/, "") || "source", sample.wavBase64);
      setSource({ rel, name: file.name });
    } catch (err) {
      setVcError(String((err as Error).message ?? err));
    }
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      {/* header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-serif text-[20px] font-semibold text-cream">{voice.name}</h2>
          <Chip tone={voice.kind === "cloned" ? "gold" : "muted"} className="text-[9px] uppercase tracking-wider">
            {voice.kind}
          </Chip>
          {voice.kind === "cloned" && voice.rvcTrained && (
            <Chip tone="gold" className="text-[9px] uppercase tracking-wider">
              RVC ready
            </Chip>
          )}
          {voice.kind === "cloned" && !voice.rvcTrained && voice.rvcTraining && (
            <Chip tone="muted" className="text-[9px] uppercase tracking-wider">
              Training RVC…
            </Chip>
          )}
          {voice.kind === "cloned" && !voice.rvcTrained && !voice.rvcTraining && lab.rvcAvailable && (
            <button
              onClick={() => lab.trainRvc(voice.id)}
              title={`Trains a dedicated RVC v2 model from this voice's reference clip on Replicate (${lab.rvcTrainEstimate}, billed to your Replicate account). Unlocks the higher-quality cloud conversion.`}
              className="rounded-full border border-gold/35 px-2.5 py-1 text-[10px] font-medium text-gold transition hover:bg-gold/10"
            >
              Train RVC voice · {lab.rvcTrainEstimate}
            </button>
          )}
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

      {/* script (speak) / conversion source (convert) */}
      {mode === "speak" ? (
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
      ) : (
        <section>
          <PanelLabel hint>Voice-to-voice conversion (Seed-VC)</PanelLabel>
          <div className="mt-2 space-y-2 rounded-xl border border-cream/10 bg-surface p-3">
            <input
              ref={sourceInput}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadSource(f);
                e.target.value = "";
              }}
            />
            {source ? (
              <div className="flex items-center gap-2 rounded-lg border border-gold/30 bg-gold/6 px-3 py-2">
                <Music4 size={13} className="shrink-0 text-gold/80" />
                <span className="min-w-0 flex-1 truncate text-[12px] text-cream/90">
                  {source.name}
                </span>
                <button
                  title="Clear source"
                  onClick={() => setSource(null)}
                  className="text-fog/60 transition hover:text-red-400"
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => sourceInput.current?.click()}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-dashed border-cream/15 py-2.5 text-[12px] text-cream/80 transition hover:border-gold/50 hover:text-gold"
                >
                  <CloudUpload size={13} />
                  {lab.addingSource ? "Uploading…" : "Upload source audio"}
                </button>
                <div className="relative flex-1">
                  <button
                    onClick={() => setSourceOpen((o) => !o)}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-cream/15 py-2.5 text-[12px] text-cream/80 transition hover:border-gold/50 hover:text-gold"
                  >
                    <ListMusic size={13} /> From library
                    <ChevronDown size={11} className={cx("transition-transform", sourceOpen && "rotate-180")} />
                  </button>
                  {sourceOpen && (
                    <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-52 overflow-y-auto rounded-xl border border-cream/12 bg-raised shadow-xl">
                      {lab.convertSources.length === 0 && (
                        <p className="px-3 py-2 text-[11px] text-fog">No audio in the library yet</p>
                      )}
                      {lab.convertSources.map((a) => (
                        <button
                          key={a.relPath}
                          onClick={() => {
                            setSource({ rel: a.relPath, name: a.name });
                            setSourceOpen(false);
                            if (a.kind === "music") setVcSing(true);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-cream/85 transition hover:bg-cream/5"
                        >
                          <span className="flex-1 truncate">{a.name}</span>
                          <span className="text-[10px] text-fog">{a.kind}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <div className="flex overflow-hidden rounded-lg border border-cream/10">
                {(
                  [
                    { sing: false, label: "Speech" },
                    { sing: true, label: "Singing" },
                  ] as const
                ).map(({ sing, label }) => (
                  <button
                    key={label}
                    onClick={() => setVcSing(sing)}
                    className={cx(
                      "px-3 py-1.5 text-[11px] font-medium transition",
                      vcSing === sing
                        ? "bg-gold/12 text-gold"
                        : "text-fog hover:bg-cream/5 hover:text-cream",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex overflow-hidden rounded-lg border border-cream/10">
                {(
                  [
                    { id: "seedvc", label: "Seed-VC · local", enabled: lab.convertAvailable },
                    { id: "rvc", label: "RVC · cloud", enabled: rvcReady },
                  ] as const
                ).map(({ id, label, enabled }) => (
                  <button
                    key={id}
                    onClick={() => enabled && setVcEngineSel(id)}
                    title={
                      enabled
                        ? id === "rvc"
                          ? `Converts through ${voice.name}'s trained RVC model on Replicate (${lab.rvcConvertEstimate})`
                          : "Zero-shot conversion on your GPU"
                        : id === "rvc"
                          ? lab.rvcAvailable
                            ? "Train this voice's RVC model first"
                            : "Add a Replicate token in Settings → AI Providers"
                          : "Seed-VC engine not installed"
                    }
                    className={cx(
                      "px-3 py-1.5 text-[11px] font-medium transition",
                      vcEngine === id
                        ? "bg-gold/12 text-gold"
                        : enabled
                          ? "text-fog hover:bg-cream/5 hover:text-cream"
                          : "cursor-not-allowed text-fog/40",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {vcEngine === "seedvc" && (
                <label className="flex items-center gap-1.5 text-[11px] text-fog">
                  Steps
                  <input
                    type="number"
                    value={vcSteps}
                    min={4}
                    max={100}
                    placeholder={String(vcStepsDefault)}
                    onChange={(e) => setVcSteps(e.target.value)}
                    className="w-14 rounded-lg border border-cream/10 bg-raised px-2 py-1 text-right text-[11px] tabular-nums text-cream placeholder:text-fog/50 focus:border-gold/40 focus:outline-none"
                  />
                </label>
              )}
              {vcSing && vcEngine === "rvc" && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-fog">Pitch</span>
                  <div className="flex overflow-hidden rounded-lg border border-cream/10">
                    {(
                      [
                        { id: "auto", label: "Auto match", hint: "Measure the song and the voice, shift the vocals by whole octaves into its register" },
                        { id: "none", label: "Keep", hint: "Convert at the song's original pitch" },
                        { id: "octave-down", label: "Oct −", hint: "Force the vocals one octave down" },
                        { id: "octave-up", label: "Oct +", hint: "Force the vocals one octave up" },
                      ] as const
                    ).map(({ id, label, hint }) => (
                      <button
                        key={id}
                        onClick={() => setVcPitch(id)}
                        title={hint}
                        className={cx(
                          "px-2.5 py-1.5 text-[11px] font-medium transition",
                          vcPitch === id
                            ? "bg-gold/12 text-gold"
                            : "text-fog hover:bg-cream/5 hover:text-cream",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {vcSing && (
                <label className="flex items-center gap-1.5 text-[11px] text-fog">
                  Semitones
                  <input
                    type="number"
                    value={vcShift}
                    min={-24}
                    max={24}
                    placeholder="0"
                    onChange={(e) => setVcShift(e.target.value)}
                    className="w-14 rounded-lg border border-cream/10 bg-raised px-2 py-1 text-right text-[11px] tabular-nums text-cream placeholder:text-fog/50 focus:border-gold/40 focus:outline-none"
                  />
                </label>
              )}
            </div>

            {vcError && <p className="text-[10px] text-red-400">{vcError}</p>}
            <p className="text-[10px] leading-relaxed text-fog/70">
              {voice.kind !== "cloned"
                ? "Pick a cloned voice on the left as the conversion target."
                : vcEngine === "rvc"
                  ? rvcReady
                    ? `Converts through ${voice.name}'s trained RVC model on Replicate — the highest-quality path (${lab.rvcConvertEstimate} per run, billed to your Replicate account).`
                    : lab.rvcAvailable
                      ? `Train ${voice.name}'s RVC model first (button next to the voice name, ${lab.rvcTrainEstimate}).`
                      : "Add a Replicate API token in Settings → AI Providers to unlock RVC."
                  : !lab.convertAvailable
                    ? "Seed-VC engine not installed — Settings → Engines → Install."
                    : `Converts into ${voice.name}'s voice. Singing mode keeps melody and timing (full-mix conversion works best on sparse arrangements).`}
            </p>
          </div>
        </section>
      )}

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

      {/* pace + emotion (chatterbox/qwen) — or the DramaBox knob panel */}
      {engineId !== "dramabox" ? (
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
      ) : (
        <section className="space-y-3">
          <div className="flex gap-6">
            <Slider
              label="CFG"
              hint
              value={dbxCfg}
              display={dbxCfg.toFixed(1)}
              min={1}
              max={6}
              step={0.1}
              ticks={["Loose", "Default", "Faithful"]}
              onChange={setDbxCfg}
            />
            <Slider
              label="STG"
              hint
              value={dbxStg}
              display={dbxStg.toFixed(1)}
              min={0}
              max={4}
              step={0.1}
              ticks={["Off", "Default", "Strong"]}
              onChange={setDbxStg}
            />
            <Slider
              label="Speed"
              hint
              value={dbxDurMult}
              display={`${dbxDurMult.toFixed(2)}x`}
              min={0.5}
              max={1.5}
              step={0.05}
              ticks={["Tighter", "Default", "Slower"]}
              onChange={setDbxDurMult}
            />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1.5 text-[11px] text-fog">
              Seed
              <input
                type="number"
                value={dbxSeed}
                min={0}
                placeholder="42"
                onChange={(e) => setDbxSeed(e.target.value)}
                className="w-20 rounded-lg border border-cream/10 bg-raised px-2 py-1 text-right text-[11px] tabular-nums text-cream placeholder:text-fog/50 focus:border-gold/40 focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-fog">
              Duration (s)
              <input
                type="number"
                value={dbxGenDur}
                min={0}
                max={300}
                placeholder="auto"
                onChange={(e) => setDbxGenDur(e.target.value)}
                className="w-20 rounded-lg border border-cream/10 bg-raised px-2 py-1 text-right text-[11px] tabular-nums text-cream placeholder:text-fog/50 focus:border-gold/40 focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-fog">
              <input
                type="checkbox"
                checked={dbxWatermark}
                onChange={(e) => setDbxWatermark(e.target.checked)}
                className="accent-gold"
              />
              Watermark
            </label>
          </div>
          <p className="text-[10px] leading-relaxed text-fog/70">
            Write stage directions in [brackets], (parens) or *stars* — [laughs], (nervously),
            *sighs*. They're performed, not spoken; everything else is read aloud. Keep the seed
            fixed for a consistent timbre.
          </p>
        </section>
      )}

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
                canGenerate &&
                lab.generate({
                  text: script,
                  voice: voice.id,
                  engine: engineId,
                  pace,
                  emotion,
                  ...(engineId === "dramabox"
                    ? {
                        seed: /^\d+$/.test(dbxSeed) ? Number(dbxSeed) : undefined,
                        cfgScale: dbxCfg,
                        stgScale: dbxStg,
                        durationMultiplier: dbxDurMult,
                        genDuration: /^\d+(\.\d+)?$/.test(dbxGenDur)
                          ? Number(dbxGenDur)
                          : undefined,
                        watermark: dbxWatermark || undefined,
                      }
                    : {}),
                })
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
            <GoldButton
              onClick={() =>
                canConvert &&
                source &&
                lab.convert({
                  source: source.rel,
                  voice: voice.id,
                  engine: vcEngine === "rvc" ? ("rvc" as const) : undefined,
                  mode: vcSing ? "sing" : "speak",
                  diffusionSteps: /^\d+$/.test(vcSteps)
                    ? Math.min(100, Math.max(4, Number(vcSteps)))
                    : vcStepsDefault,
                  semitoneShift: /^-?\d+$/.test(vcShift)
                    ? Math.min(24, Math.max(-24, Number(vcShift)))
                    : 0,
                  pitchMode: vcPitch,
                })
              }
              className={cx(
                "mt-2 w-full justify-center py-2.5",
                mode !== "convert" && "opacity-40",
                !canConvert && "pointer-events-none opacity-40",
              )}
            >
              <ArrowRightLeft size={13} />{" "}
              {lab.busy ? "Working…" : `Convert to ${voice.name}`}
            </GoldButton>
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
  onDelete,
}: {
  take: VoiceTake;
  active: boolean;
  player: AudioPlayer;
  onSelect: () => void;
  /** absent while the take is still generating */
  onDelete?: () => void;
}) {
  const playing = player.playing && !!take.url && player.src === take.url;
  const [armed, setArmed] = useState(false);
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
          {onDelete && (
            <button
              title={armed ? "Click again to delete from disk" : "Delete take"}
              onClick={(e) => {
                e.stopPropagation();
                if (!armed) {
                  setArmed(true);
                  window.setTimeout(() => setArmed(false), 2500);
                  return;
                }
                setArmed(false);
                onDelete();
              }}
              className={cx(
                "flex items-center gap-1 text-[10px] transition",
                armed ? "text-[#e07a6b]" : "text-fog/60 hover:text-[#e07a6b]",
              )}
            >
              <Trash2 size={12} />
              {armed && "Sure?"}
            </button>
          )}
        </div>
      </div>

      {active && !take.generating && (
        <div className="mt-2.5 flex gap-1.5">
          <GoldButton
            onClick={() => {
              if (take.url) void downloadAsset(take.url, `${take.label || "take"}.wav`);
            }}
            className={cx("flex-1 justify-center py-2", !take.url && "pointer-events-none opacity-40")}
          >
            <Bookmark size={12} /> Download
          </GoldButton>
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
  // a failed TTS/convert used to vanish silently — surface it above the takes
  const [dismissed, setDismissed] = useState<string[]>([]);
  return (
    <aside className="flex w-[316px] shrink-0 flex-col border-l hairline bg-[#0e0e10]">
      <div className="flex items-center justify-between p-4 pb-3">
        <PanelLabel>Takes history</PanelLabel>
        <button className="text-fog/60 transition hover:text-gold">
          <ListMusic size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3">
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
        {lab.takes.map((t) => (
          <TakeRow
            key={t.id}
            take={t}
            active={t.id === selectedId}
            player={player}
            onSelect={() => onSelect(t.id)}
            onDelete={
              t.relPath
                ? () => {
                    void lab.removeTake(t.relPath!).catch((err) =>
                      console.error("remove take:", err),
                    );
                  }
                : undefined
            }
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
          player={player}
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
