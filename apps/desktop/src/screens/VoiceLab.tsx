import { useEffect, useRef, useState } from "react";
import {
  ArrowRightLeft,
  AudioLines,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CloudUpload,
  Download,
  Eye,
  EyeOff,
  ListMusic,
  Mic,
  MoreVertical,
  Music4,
  Pause,
  Pencil,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  Sparkles,
  Square,
  Star,
  Store,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { downloadAsset, useLikes, useVoiceLab } from "@/hooks";
import type { Voice, VoiceTake } from "@/data/sample";
import {
  Chip,
  GoldButton,
  ScrubBar,
  SectionLabel,
  Segmented,
  Slider,
  Waveform,
  cx,
} from "@/components/ui";
import {
  PLAYBACK_RATES,
  useAudioPlayer,
  useMediaDuration,
  type AudioPlayer,
} from "@/components/useAudioPlayer";
import { sampleFromBlob, useMicRecorder, type VoiceSample } from "@/components/voiceSample";

/* Voice lab — built to design-refs/2026-08-06-ui-mockups/voice-lab-v1.jpg
 * (verdicts in that folder's DECISIONS.md): voices rail with mini-waveforms
 * and a gold "Clone a voice" footer, a hero take player, the numbered
 * ① Script ② Engine ③ Delivery flow under a SPEAK|CONVERT segment, a takes
 * rail that pages, and a persistent player bar with the 1.0× speed control
 * grafted from v2. Speak (script → TTS) and Convert (voice-to-voice) run over
 * the real engine roster (Chatterbox default for cloned character voices,
 * Fish S2-Pro, VibeVoice, Kokoro, DramaBox); voices + takes flow through
 * useVoiceLab (tRPC seam). */

/** stable per-voice waveform glyph — the rail's rows need to look distinct
 * without the file ever being read */
function hashSeed(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 100000;
  return h + 1;
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
  onRename,
  onHide,
  onRemove,
}: {
  voice: Voice;
  active: boolean;
  player: AudioPlayer;
  onSelect: () => void;
  onRename: (name: string) => void;
  onHide: () => void;
  /** present only for studio voices — the rest can only be hidden */
  onRemove?: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [armed, setArmed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(voice.name);
  const playingSample =
    !!voice.sampleUrl && player.src === voice.sampleUrl && player.playing;
  // The roster runs well past a screenful and the selected voice is often deep
  // in it — bring it into view when this row becomes the selected one. Rows are
  // keyed by voice id, so the catalog arriving remounts them and re-runs this;
  // "nearest" is a no-op for a row that's already visible, which is what makes
  // it safe to leave in (clicking a row never yanks the list).
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== voice.name) onRename(next);
    else setDraft(voice.name);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-gold/50 bg-surface p-2.5">
        <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", voice.swatch)}>
          <AudioLines size={14} className="text-cream/80" />
        </span>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, 40))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(voice.name);
              setEditing(false);
            }
          }}
          className="min-w-0 flex-1 rounded-lg border border-cream/10 bg-raised px-2 py-1 text-[12px] text-cream focus:border-gold/40 focus:outline-none"
        />
        <span title="Save" className="shrink-0 text-fog/60">
          <Check size={13} />
        </span>
      </div>
    );
  }

  return (
    <div ref={rowRef} className="relative">
      <button
        onClick={onSelect}
        onDoubleClick={() => {
          setDraft(voice.name);
          setEditing(true);
        }}
        className={cx(
          "group flex w-full items-center gap-2.5 rounded-xl border p-2.5 text-left transition",
          active
            ? "border-gold/50 bg-surface"
            : "border-transparent hover:border-cream/15 hover:bg-surface/60",
        )}
      >
        {voice.sampleUrl ? (
          <span
            title={playingSample ? "Pause sample" : "Play the voice's reference clip"}
            onClick={(e) => {
              e.stopPropagation();
              player.toggle(voice.sampleUrl);
            }}
            className={cx(
              "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition",
              voice.swatch,
            )}
          >
            <span
              className={cx(
                "flex h-full w-full items-center justify-center rounded-full transition",
                playingSample
                  ? "bg-ink/60 text-gold"
                  : "text-cream/80 group-hover:bg-ink/55 group-hover:text-gold",
              )}
            >
              {playingSample ? (
                <Pause size={12} />
              ) : (
                <>
                  <AudioLines size={14} className="group-hover:hidden" />
                  <Play size={12} className="ml-0.5 hidden group-hover:block" />
                </>
              )}
            </span>
          </span>
        ) : (
          <span
            className={cx(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              voice.swatch,
            )}
          >
            <AudioLines size={14} className="text-cream/80" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[12.5px] font-medium text-cream">{voice.name}</span>
            {active && <i className="h-1.5 w-1.5 shrink-0 rounded-full bg-sage" />}
          </span>
          {/* the glyph is a per-voice signature, not this clip's waveform */}
          <Waveform
            seed={hashSeed(voice.id)}
            bars={30}
            played={playingSample ? player.played : 0}
            className="mt-1 h-3!"
          />
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <Chip
            tone={voice.kind === "cloned" ? "gold" : "muted"}
            className="px-1.5 text-[8.5px] uppercase tracking-wider"
          >
            {voice.kind}
          </Chip>
          {voice.rvcTrained && (
            <Chip tone="gold" className="px-1.5 text-[8.5px] uppercase tracking-wider">
              RVC
            </Chip>
          )}
        </span>
        <span
          title="Rename, hide or delete"
          onClick={(e) => {
            e.stopPropagation();
            setMenu((m) => !m);
            setArmed(false);
          }}
          className="shrink-0 text-fog/50 transition hover:text-cream"
        >
          <MoreVertical size={14} />
        </span>
      </button>
      {menu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
          <div className="absolute right-1 top-10 z-20 w-56 rounded-xl border border-cream/12 bg-raised p-1 shadow-xl">
            <button
              onClick={() => {
                setMenu(false);
                setDraft(voice.name);
                setEditing(true);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-cream/85 transition hover:bg-cream/5"
            >
              <Pencil size={12} /> Rename
            </button>
            <button
              onClick={() => {
                setMenu(false);
                onHide();
              }}
              title="Takes it off every voice picker. Nothing is deleted — restore it from “Hidden” at the bottom of this list."
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-cream/85 transition hover:bg-cream/5"
            >
              <EyeOff size={12} /> Hide from list
            </button>
            {onRemove ? (
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
                <Trash2 size={12} /> {armed ? "Click again to confirm" : "Delete permanently"}
              </button>
            ) : (
              <p className="px-2.5 py-2 text-[10px] leading-relaxed text-fog/70">
                {voice.kind === "preset"
                  ? "Built-in preset — it can be hidden, not deleted."
                  : "Lives in videofast’s char_refs, not the studio folder — hide it here, delete the .wav there."}
              </p>
            )}
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
  /** open the clone modal — preloaded when a file was dropped on the button */
  onAdd: (file?: File) => void;
}) {
  const lab = useVoiceLab();
  const [showHidden, setShowHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const guard = (p: Promise<unknown>) => {
    setError(null);
    void p.catch((err: unknown) => setError(String((err as Error).message ?? err)));
  };
  return (
    <aside className="flex w-[292px] shrink-0 flex-col border-r hairline bg-[#0e0e10]">
      <div className="p-4 pb-3">
        <SectionLabel
          right={
            <button
              title="Clone a new voice from a sample"
              onClick={() => onAdd()}
              className="flex h-6 w-6 items-center justify-center rounded-lg border border-cream/10 text-cream/70 transition hover:border-gold/40 hover:text-gold"
            >
              <Plus size={13} />
            </button>
          }
        >
          Your voices · {lab.voices.length}
        </SectionLabel>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3">
        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/6 px-2.5 py-2 text-[10px] leading-relaxed text-red-300">
            {error}
          </p>
        )}
        {lab.voices.map((v) => (
          <VoiceRow
            key={v.id}
            voice={v}
            active={v.id === voiceId}
            player={player}
            onSelect={() => onSelect(v.id)}
            onRename={(name) => guard(lab.renameVoice(v.id, name))}
            onHide={() => guard(lab.hideVoice(v.id, true))}
            // only studio clips are ours to delete — the rest hide instead
            onRemove={v.source === "studio" ? () => guard(lab.removeVoice(v.id)) : undefined}
          />
        ))}

        {lab.hiddenVoices.length > 0 && (
          <div className="pt-2">
            <button
              onClick={() => setShowHidden((s) => !s)}
              className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-fog transition hover:text-cream"
            >
              <ChevronRight
                size={11}
                className={cx("transition-transform", showHidden && "rotate-90")}
              />
              Hidden · {lab.hiddenVoices.length}
            </button>
            {showHidden &&
              lab.hiddenVoices.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center gap-2 rounded-xl px-2 py-1.5 opacity-60 transition hover:opacity-100"
                >
                  <span className="min-w-0 flex-1 truncate text-[11px] text-cream/85">{v.name}</span>
                  <button
                    onClick={() => guard(lab.hideVoice(v.id, false))}
                    className="flex shrink-0 items-center gap-1 rounded-lg border border-cream/10 px-2 py-1 text-[10px] text-cream/80 transition hover:border-gold/40 hover:text-gold"
                  >
                    <Eye size={11} /> Restore
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="space-y-2 p-3">
        {/* the clone entry point lives here, not mid-canvas — dropping a file
         * on it opens the modal already loaded with that sample */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDropping(false);
            onAdd(e.dataTransfer.files[0] ?? undefined);
          }}
        >
          <GoldButton
            onClick={() => onAdd()}
            title="Clone a voice from 10 seconds of clean speech — upload, drop a file here, or record from the mic"
            className={cx(
              "w-full justify-center py-2.5",
              dropping && "ring-2 ring-gold/60 ring-offset-2 ring-offset-[#0e0e10]",
            )}
          >
            <Sparkles size={13} /> {dropping ? "Drop to clone" : "Clone a voice"}
          </GoldButton>
        </div>
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

/** A labelled delivery knob — the house Slider with its value and end ticks. */
function SliderRow({
  label,
  title,
  value,
  display,
  min,
  max,
  step,
  ticks,
  onChange,
}: {
  label: string;
  title?: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  ticks: [string, string, string];
  onChange: (v: number) => void;
}) {
  return (
    <div className="min-w-0 flex-1" title={title}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-cream/85">{label}</span>
        <span className="text-[11px] tabular-nums text-gold/90">{display}</span>
      </div>
      <Slider className="mt-2" min={min} max={max} step={step} value={value} onChange={onChange} />
      <div className="mt-1 flex justify-between text-[10px] text-fog/70">
        {ticks.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </div>
  );
}

/** One engine in the ② Engine chip row — the whole roster stays visible
 * (the v2 mockup's single dropdown hid it, which the review rejected). */
function EngineChip({
  label,
  note,
  active,
  onClick,
}: {
  label: string;
  note?: string;
  active: boolean;
  onClick: () => void;
}) {
  const missing = note === "not installed";
  return (
    <button
      onClick={onClick}
      title={missing ? `${label} — not installed (Settings → Engines)` : note}
      className={cx(
        "flex min-w-0 flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left transition",
        active
          ? "border-gold/55 bg-gold/8"
          : "border-cream/10 hover:border-gold/35 hover:bg-cream/4",
        missing && !active && "opacity-45",
      )}
    >
      <span className="flex w-full items-center gap-1.5">
        <i
          className={cx(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            active ? "bg-gold" : missing ? "bg-cream/20" : "bg-cream/30",
          )}
        />
        <span className={cx("truncate text-[12px] font-medium", active ? "text-gold" : "text-cream/85")}>
          {label}
        </span>
      </span>
      {note && <span className="w-full truncate pl-3 text-[10px] text-fog/80">{note}</span>}
    </button>
  );
}

function CenterStage({
  voice,
  selectedTake,
  player,
}: {
  voice: Voice;
  selectedTake: VoiceTake | undefined;
  player: AudioPlayer;
}) {
  const lab = useVoiceLab();
  const [script, setScript] = useState(lab.script);
  const [pace, setPace] = useState(lab.pace);
  const [emotion, setEmotion] = useState(lab.emotion);
  const [mode, setMode] = useState<"speak" | "convert">("speak");
  const [engineId, setEngineId] = useState(lab.engines[0].id);
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
  // the id being renamed, not a boolean: picking another voice mid-edit used to
  // blur-commit the draft onto whichever voice was selected by then
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState(voice.name);
  const sourceInput = useRef<HTMLInputElement>(null);
  const renaming = renamingId === voice.id;

  const startRename = () => {
    setNameDraft(voice.name);
    setRenamingId(voice.id);
  };

  const commitRename = () => {
    const id = renamingId;
    const next = nameDraft.trim();
    setRenamingId(null);
    const target = lab.voices.find((v) => v.id === id);
    if (!id || !target || !next || next === target.name) return;
    lab.renameVoice(id, next).catch((err: unknown) =>
      setVcError(String((err as Error).message ?? err)),
    );
  };

  const engine = lab.engines.find((e) => e.id === engineId) ?? lab.engines[0];
  // player drives the clock/waveform only while the selected take is its clip
  const loaded = !!selectedTake?.url && player.src === selectedTake.url;
  // …until then the hero still names the take's length, probed off the file
  const probed = useMediaDuration(selectedTake?.generating ? undefined : selectedTake?.url);
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

  const generate = () =>
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
            genDuration: /^\d+(\.\d+)?$/.test(dbxGenDur) ? Number(dbxGenDur) : undefined,
            watermark: dbxWatermark || undefined,
          }
        : {}),
    });

  const convert = () => {
    if (!source) return;
    lab.convert({
      source: source.rel,
      voice: voice.id,
      engine: vcEngine === "rvc" ? ("rvc" as const) : undefined,
      mode: vcSing ? "sing" : "speak",
      diffusionSteps: /^\d+$/.test(vcSteps)
        ? Math.min(100, Math.max(4, Number(vcSteps)))
        : vcStepsDefault,
      semitoneShift: /^-?\d+$/.test(vcShift) ? Math.min(24, Math.max(-24, Number(vcShift))) : 0,
      pitchMode: vcPitch,
    });
  };

  /* the numbered flow reads top-to-bottom in both modes: what to say, who
   * says it, how it's delivered — then one primary action. */
  const speakSteps = mode === "speak";

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
      {/* header */}
      {/* wraps rather than crushing the name when the column gets narrow */}
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-[220px] items-center gap-2.5">
          {renaming ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value.slice(0, 40))}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setRenamingId(null);
              }}
              className="w-64 rounded-lg border border-gold/40 bg-surface px-2 py-1 font-serif text-[26px] font-semibold text-cream focus:outline-none"
            />
          ) : (
            <h2
              onDoubleClick={startRename}
              title="Double-click to rename"
              className="truncate font-serif text-[28px] font-semibold leading-tight text-cream"
            >
              {voice.name}
            </h2>
          )}
          <button
            title="Rename this voice"
            onClick={startRename}
            className="shrink-0 text-fog/50 transition hover:text-gold"
          >
            <Pencil size={14} />
          </button>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 pt-1.5">
          <Chip
            tone={voice.kind === "cloned" ? "gold" : "muted"}
            className="text-[9px] uppercase tracking-wider"
          >
            {voice.kind}
          </Chip>
          {voice.kind === "cloned" && voice.rvcTrained && (
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-sage/15 px-2.5 py-1 text-[10px] font-medium text-sage">
              <i className="h-1.5 w-1.5 rounded-full bg-sage" /> RVC ready
            </span>
          )}
          {voice.kind === "cloned" && !voice.rvcTrained && voice.rvcTraining && (
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-cream/8 px-2.5 py-1 text-[10px] font-medium text-fog">
              <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" /> Training RVC…
            </span>
          )}
          {voice.kind === "cloned" && !voice.rvcTrained && !voice.rvcTraining && lab.rvcAvailable && (
            <button
              onClick={() => lab.trainRvc(voice.id)}
              title={`Trains a dedicated RVC v2 model from this voice's reference clip on Replicate (${lab.rvcTrainEstimate}, billed to your Replicate account). Unlocks the higher-quality cloud conversion.`}
              className="rounded-pill border border-gold/35 px-2.5 py-1 text-[10px] font-medium text-gold transition hover:bg-gold/10"
            >
              Train RVC voice · {lab.rvcTrainEstimate}
            </button>
          )}
        </div>
      </header>

      {/* mode */}
      <Segmented
        className="self-center"
        value={mode}
        onChange={setMode}
        options={[
          {
            value: "speak" as const,
            label: (
              <span className="flex items-center gap-1.5 px-2 uppercase tracking-wider">
                <AudioLines size={12} /> Speak
              </span>
            ),
            title: "Turn a script into speech in this voice",
          },
          {
            value: "convert" as const,
            label: (
              <span className="flex items-center gap-1.5 px-2 uppercase tracking-wider">
                <ArrowRightLeft size={12} /> Convert
              </span>
            ),
            title: "Re-voice an existing recording as this voice",
          },
        ]}
      />


      {speakSteps ? (
        <>
          {/* ① script */}
          <section>
            <SectionLabel step={1}>Script</SectionLabel>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value.slice(0, lab.scriptMax))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canGenerate) generate();
              }}
              rows={5}
              className="mt-2.5 w-full resize-none rounded-xl border border-cream/10 bg-surface p-3.5 text-[13px] leading-relaxed text-cream placeholder:text-fog focus:border-gold/40 focus:outline-none"
              placeholder="Enter or paste your script here…"
            />
            <div className="mt-1.5 flex items-center justify-between text-[10px] text-fog/70">
              <span className="tabular-nums">
                {script.length} / {lab.scriptMax} characters
              </span>
              <span>⌘/Ctrl + ↵ to generate</span>
            </div>
            {/* DramaBox changes how you *write*, so its rule belongs next to the
             * box, not down in ③ where it used to hide */}
            {engineId === "dramabox" && (
              <p className="mt-2 text-[10px] leading-relaxed text-fog/70">
                <span className="text-gold/80">DramaBox:</span> write stage directions in
                [brackets], (parens) or *stars* — [laughs], (nervously), *sighs*. They're
                performed, not spoken; everything else is read aloud.
              </p>
            )}
          </section>

          {/* ② engine */}
          <section>
            <SectionLabel step={2} right={<span className="text-[10px] text-fog/70">{engine.note}</span>}>
              Engine
            </SectionLabel>
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              {lab.engines.map((e) => (
                <EngineChip
                  key={e.id}
                  label={e.label}
                  note={e.note}
                  active={e.id === engineId}
                  onClick={() => setEngineId(e.id)}
                />
              ))}
            </div>
          </section>

          {/* ③ delivery — pace/emotion, or DramaBox's prompt-driven knobs */}
          <section>
            <SectionLabel
              step={3}
              right={
                engineId === "dramabox" ? (
                  <span className="text-[10px] text-fog/70">prompt-driven</span>
                ) : undefined
              }
            >
              Delivery
            </SectionLabel>
            {engineId !== "dramabox" ? (
              <div className="mt-3 flex gap-8">
                <SliderRow
                  label="Pace"
                  title="Speaking rate — 1.00x is the engine's natural tempo"
                  value={pace}
                  display={`${pace.toFixed(2)}x`}
                  min={0.5}
                  max={1.5}
                  step={0.05}
                  ticks={["Slower", "Normal", "Faster"]}
                  onChange={setPace}
                />
                <SliderRow
                  label="Emotion"
                  title="How much the delivery leans on the reference clip's expressiveness"
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
              <div className="mt-3 space-y-3">
                <div className="flex gap-8">
                  <SliderRow
                    label="CFG"
                    title="How faithfully the model follows the script and stage directions"
                    value={dbxCfg}
                    display={dbxCfg.toFixed(1)}
                    min={1}
                    max={6}
                    step={0.1}
                    ticks={["Loose", "Default", "Faithful"]}
                    onChange={setDbxCfg}
                  />
                  <SliderRow
                    label="STG"
                    title="Spatio-temporal guidance — higher is steadier, lower is livelier"
                    value={dbxStg}
                    display={dbxStg.toFixed(1)}
                    min={0}
                    max={4}
                    step={0.1}
                    ticks={["Off", "Default", "Strong"]}
                    onChange={setDbxStg}
                  />
                  <SliderRow
                    label="Speed"
                    title="Duration multiplier applied to the generated line"
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
                  Keep the seed fixed for a consistent timbre. The stage-direction syntax is
                  noted under the script.
                </p>
              </div>
            )}
          </section>

        </>
      ) : (
        <>
          {/* ① source audio */}
          <section>
            <SectionLabel step={1}>Source audio</SectionLabel>
            <div className="mt-2.5">
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
                <div className="flex items-center gap-2.5 rounded-xl border border-gold/30 bg-gold/6 px-3.5 py-3">
                  <Music4 size={14} className="shrink-0 text-gold/80" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-cream/90">
                    {source.name}
                  </span>
                  <button
                    title="Clear source"
                    onClick={() => setSource(null)}
                    className="text-fog/60 transition hover:text-[#e07a6b]"
                  >
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => sourceInput.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = e.dataTransfer.files[0];
                      if (f) void uploadSource(f);
                    }}
                    className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-cream/15 px-3 py-5 transition hover:border-gold/50 hover:bg-gold/4"
                  >
                    <CloudUpload size={18} strokeWidth={1.5} className="text-gold/80" />
                    <span className="text-[12px] font-medium text-cream/90">
                      {lab.addingSource ? "Uploading…" : "Drop audio file here"}
                    </span>
                    <span className="text-[10px] text-fog/60">or click to browse · WAV, MP3, FLAC</span>
                  </button>
                  <div className="relative">
                    <button
                      onClick={() => setSourceOpen((o) => !o)}
                      className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-cream/15 px-3 py-5 transition hover:border-gold/50 hover:bg-gold/4"
                    >
                      <ListMusic size={18} strokeWidth={1.5} className="text-gold/80" />
                      <span className="flex items-center gap-1 text-[12px] font-medium text-cream/90">
                        From library
                        <ChevronDown
                          size={11}
                          className={cx("transition-transform", sourceOpen && "rotate-180")}
                        />
                      </span>
                      <span className="text-[10px] text-fog/60">
                        {lab.convertSources.length} recent clips
                      </span>
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
            </div>
          </section>

          {/* ② conversion engine */}
          <section>
            <SectionLabel step={2}>Engine</SectionLabel>
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              {(
                [
                  {
                    id: "seedvc" as const,
                    label: "Seed-VC · local",
                    note: lab.convertAvailable ? "runs on your machine" : "not installed",
                    enabled: lab.convertAvailable,
                    why: "Zero-shot conversion on your GPU",
                  },
                  {
                    id: "rvc" as const,
                    label: "RVC · cloud",
                    note: rvcReady ? `highest quality · ${lab.rvcConvertEstimate}` : "needs a trained model",
                    enabled: rvcReady,
                    why: rvcReady
                      ? `Converts through ${voice.name}'s trained RVC model on Replicate (${lab.rvcConvertEstimate})`
                      : lab.rvcAvailable
                        ? "Train this voice's RVC model first"
                        : "Add a Replicate token in Settings → AI Providers",
                  },
                ] as const
              ).map((e) => (
                <button
                  key={e.id}
                  onClick={() => e.enabled && setVcEngineSel(e.id)}
                  title={e.why}
                  className={cx(
                    "flex flex-col items-start gap-0.5 rounded-xl border px-3.5 py-3 text-left transition",
                    vcEngine === e.id
                      ? "border-gold/55 bg-gold/8"
                      : e.enabled
                        ? "border-cream/10 hover:border-gold/35 hover:bg-cream/4"
                        : "cursor-not-allowed border-cream/10 opacity-45",
                  )}
                >
                  <span
                    className={cx(
                      "text-[12.5px] font-medium",
                      vcEngine === e.id ? "text-gold" : "text-cream/85",
                    )}
                  >
                    {e.label}
                  </span>
                  <span className="text-[10px] text-fog/80">{e.note}</span>
                </button>
              ))}
            </div>
          </section>

          {/* ③ delivery */}
          <section>
            <SectionLabel step={3}>Delivery</SectionLabel>
            <div className="mt-2.5 flex flex-wrap items-center gap-3">
              <Segmented
                value={vcSing ? "sing" : "speak"}
                onChange={(v) => setVcSing(v === "sing")}
                options={[
                  { value: "speak", label: "Speech" },
                  { value: "sing", label: "Singing", title: "Keeps melody and timing" },
                ]}
              />
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
            {vcSing && vcEngine === "rvc" && (
              <div className="mt-2.5 flex items-center gap-2">
                <span className="text-[11px] text-fog">Pitch</span>
                <Segmented
                  value={vcPitch}
                  onChange={setVcPitch}
                  options={[
                    {
                      value: "auto" as const,
                      label: "Auto match",
                      title:
                        "Measure the song and the voice, shift the vocals by whole octaves into its register",
                    },
                    { value: "none" as const, label: "Keep", title: "Convert at the song's original pitch" },
                    {
                      value: "octave-down" as const,
                      label: "Oct −",
                      title: "Force the vocals one octave down",
                    },
                    {
                      value: "octave-up" as const,
                      label: "Oct +",
                      title: "Force the vocals one octave up",
                    },
                  ]}
                />
              </div>
            )}
            {vcError && <p className="mt-2 text-[10px] text-[#e07a6b]">{vcError}</p>}
            <p className="mt-2.5 text-[10px] leading-relaxed text-fog/70">
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
          </section>

        </>
      )}

      {/* Result + action. The take player sits here, not above the steps, so the
       * column reads write → configure → generate → hear; it's also what keeps
       * this screen's two players honest — this one is "the take you just made",
       * the bar at the bottom of the window is "whatever is playing". */}
      <div className="space-y-3 pt-1">
        <div className="rounded-panel border border-gold/20 bg-raised p-4 shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
          <div className="flex items-center gap-4">
            <button
              onClick={() => player.toggle(selectedTake?.url)}
              title={selectedTake?.url ? "Play the selected take" : "No take selected yet"}
              className={cx(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-gold to-gold-deep text-ink transition hover:brightness-110",
                !selectedTake?.url && "opacity-40",
              )}
            >
              {loaded && player.playing ? (
                <Pause size={18} />
              ) : (
                <Play size={18} className="ml-0.5" />
              )}
            </button>
            <div
              className="min-w-0 flex-1 cursor-pointer"
              title={loaded ? "Click to scrub" : undefined}
              onClick={(e) => {
                if (!loaded) return;
                const r = e.currentTarget.getBoundingClientRect();
                player.seekFraction(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
              }}
            >
              <Waveform
                seed={selectedTake?.waveSeed ?? 1}
                bars={130}
                played={loaded ? player.played : 0}
                className="h-16!"
              />
            </div>
            <button
              title="Download this take"
              onClick={() => {
                if (selectedTake?.url)
                  void downloadAsset(selectedTake.url, `${selectedTake.label || "take"}.wav`);
              }}
              className={cx(
                "shrink-0 text-fog/50 transition hover:text-gold",
                !selectedTake?.url && "pointer-events-none opacity-30",
              )}
            >
              <Download size={15} />
            </button>
          </div>
          <div className="mt-2.5 flex items-baseline justify-between text-[11px] tabular-nums text-fog">
            <span>
              {loaded ? player.position : "0:00"}
              <span className="text-fog/50"> / {loaded ? player.total : probed || "—"}</span>
            </span>
            <span className="truncate pl-3 text-[11px] text-fog/80">
              {selectedTake ? selectedTake.label : "No takes yet — the first one lands here"}
            </span>
          </div>
        </div>

        {speakSteps ? (
          <GoldButton
            onClick={() => canGenerate && generate()}
            disabled={!canGenerate}
            title={
              lab.busy
                ? "A take is already generating"
                : !script.trim()
                  ? "Write a script first"
                  : `Speak this script as ${voice.name} with ${engine.label}`
            }
            className="w-full justify-center py-3 text-[13px]"
          >
            <AudioLines size={14} /> {lab.busy ? "Generating…" : "Generate speech"}
          </GoldButton>
        ) : (
          <GoldButton
            onClick={() => canConvert && convert()}
            disabled={!canConvert}
            title={
              voice.kind !== "cloned"
                ? "Only cloned voices can be conversion targets"
                : !source
                  ? "Pick a source recording first"
                  : `Re-voice ${source.name} as ${voice.name}`
            }
            className="w-full justify-center py-3 text-[13px]"
          >
            <ArrowRightLeft size={14} /> {lab.busy ? "Working…" : `Convert to ${voice.name}`}
          </GoldButton>
        )}
      </div>
    </section>
  );
}

/* ---------- right rail: takes history ---------- */

type Likes = ReturnType<typeof useLikes>;

function TakeRow({
  take,
  active,
  player,
  likes,
  onSelect,
  onDelete,
}: {
  take: VoiceTake;
  active: boolean;
  player: AudioPlayer;
  likes: Likes;
  onSelect: () => void;
  /** absent while the take is still generating */
  onDelete?: () => void;
}) {
  const playing = player.playing && !!take.url && player.src === take.url;
  const loaded = !!take.url && player.src === take.url;
  const [menu, setMenu] = useState(false);
  const [armed, setArmed] = useState(false);
  // the library scan has no duration — probe the file, the way Music lab does
  const probed = useMediaDuration(take.generating ? undefined : take.url);
  const starred = likes.isLiked(take.relPath);

  return (
    <div
      onClick={onSelect}
      className={cx(
        "relative cursor-pointer rounded-xl border p-2.5 transition",
        take.generating && "opacity-70",
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
          className={cx(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition",
            playing
              ? "border-gold/60 bg-gold/10 text-gold"
              : "border-cream/15 text-cream/80 hover:border-gold/50 hover:text-gold",
          )}
        >
          {playing ? <Pause size={12} /> : <Play size={12} className="ml-0.5" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12px] font-medium text-cream">{take.label}</span>
            {take.generating && <span className="shrink-0 text-[10px] text-fog">generating…</span>}
          </div>
          <Waveform
            seed={take.waveSeed}
            bars={54}
            played={loaded ? player.played : 0}
            className="mt-1 h-4!"
          />
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className="text-[11px] tabular-nums text-cream/80"
            title={take.sizeLabel ? `${take.sizeLabel} on disk` : undefined}
          >
            {/* while generating, duration carries the job's stage text */}
            {take.generating ? take.duration : probed || take.duration || "—"}
          </span>
          <div className="flex items-center gap-0.5">
            {!take.generating && take.relPath && (
              <button
                title={starred ? "Unstar this take" : "Star this take — keeps it in Favorites"}
                onClick={(e) => {
                  e.stopPropagation();
                  likes.toggleLike(take.relPath);
                }}
                className={cx(
                  "transition",
                  starred ? "text-gold" : "text-cream/25 hover:text-gold/70",
                )}
              >
                <Star size={12} fill={starred ? "currentColor" : "none"} />
              </button>
            )}
            {!take.generating && (
              <button
                title="Take options"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu((m) => !m);
                  setArmed(false);
                }}
                className="text-fog/50 transition hover:text-cream"
              >
                <MoreVertical size={13} />
              </button>
            )}
          </div>
        </div>
      </div>

      {menu && (
        <>
          <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setMenu(false); }} />
          <div className="absolute right-2 top-11 z-20 w-48 rounded-xl border border-cream/12 bg-raised p-1 shadow-xl">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenu(false);
                if (take.url) void downloadAsset(take.url, `${take.label || "take"}.wav`);
              }}
              className={cx(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-cream/85 transition hover:bg-cream/5",
                !take.url && "pointer-events-none opacity-40",
              )}
            >
              <Download size={12} /> Download .wav
            </button>
            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (!armed) {
                    setArmed(true);
                    return;
                  }
                  setMenu(false);
                  onDelete();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-[#e07a6b] transition hover:bg-cream/5"
              >
                <Trash2 size={12} /> {armed ? "Click again to confirm" : "Delete from disk"}
              </button>
            )}
            {take.sizeLabel && (
              <p className="px-2.5 py-1.5 text-[10px] text-fog/60">{take.sizeLabel} on disk</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** How many takes the rail shows before "Load more" — the history can run to
 * hundreds of files, and nobody scrolls that far looking for yesterday's read. */
const TAKE_PAGE = 12;

function TakesRail({
  selectedId,
  player,
  likes,
  onSelect,
}: {
  selectedId: string | undefined;
  player: AudioPlayer;
  likes: Likes;
  onSelect: (id: string) => void;
}) {
  const lab = useVoiceLab();
  // a failed TTS/convert used to vanish silently — surface it above the takes
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [starredOnly, setStarredOnly] = useState(false);
  const [limit, setLimit] = useState(TAKE_PAGE);

  const filtered = lab.takes.filter(
    (t) => !starredOnly || t.generating || likes.isLiked(t.relPath),
  );
  const shown = filtered.slice(0, limit);
  const rest = filtered.length - shown.length;

  return (
    <aside className="flex w-[316px] shrink-0 flex-col border-l hairline bg-[#0e0e10]">
      <div className="p-4 pb-3">
        <SectionLabel
          right={
            <button
              title={starredOnly ? "Show every take" : "Show starred takes only"}
              onClick={() => setStarredOnly((s) => !s)}
              className={cx(
                "flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] transition",
                starredOnly
                  ? "border-gold/45 text-gold"
                  : "border-cream/10 text-cream/70 hover:border-gold/40 hover:text-gold",
              )}
            >
              <Star size={11} fill={starredOnly ? "currentColor" : "none"} />
              Starred
            </button>
          }
        >
          Takes · {filtered.length}
        </SectionLabel>
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

        {shown.length === 0 && (
          <p className="px-1 py-6 text-center text-[11px] leading-relaxed text-fog/70">
            {starredOnly
              ? "No starred takes yet — star the ones worth keeping."
              : "No takes yet. Write a script and hit Generate speech."}
          </p>
        )}

        {shown.map((t) => (
          <TakeRow
            key={t.id}
            take={t}
            active={t.id === selectedId}
            player={player}
            likes={likes}
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

      {rest > 0 && (
        <div className="p-3">
          <button
            onClick={() => setLimit((l) => l + TAKE_PAGE)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-cream/10 py-2 text-[12px] text-cream/80 transition hover:border-gold/40 hover:text-gold"
          >
            <ChevronDown size={13} /> Load more takes · {rest}
          </button>
        </div>
      )}
    </aside>
  );
}

/* ---------- bottom player bar ---------- */

function PlayerBar({
  voice,
  selectedTake,
  player,
  likes,
  onStep,
}: {
  voice: Voice;
  selectedTake: VoiceTake | undefined;
  player: AudioPlayer;
  likes: Likes;
  /** move the selection through the takes rail (−1 previous, +1 next) */
  onStep: (delta: number) => void;
}) {
  const [rateOpen, setRateOpen] = useState(false);
  const loaded = !!selectedTake?.url && player.src === selectedTake.url;
  const played = loaded ? player.played : 0;
  const starred = likes.isLiked(selectedTake?.relPath);
  const probed = useMediaDuration(selectedTake?.generating ? undefined : selectedTake?.url);

  return (
    <footer className="flex items-center gap-4 border-t hairline px-4 py-2.5">
      <div className="flex w-[224px] items-center gap-2.5">
        <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", voice.swatch)}>
          <AudioLines size={13} className="text-cream/80" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] text-cream">{voice.name}</div>
          <div className="truncate text-[10px] text-fog">{selectedTake?.label ?? "No take"}</div>
        </div>
        {selectedTake?.relPath && (
          <button
            title={starred ? "Unstar this take" : "Star this take"}
            onClick={() => likes.toggleLike(selectedTake.relPath)}
            className={cx("shrink-0 transition", starred ? "text-gold" : "text-cream/25 hover:text-gold/70")}
          >
            <Star size={13} fill={starred ? "currentColor" : "none"} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          title="Previous take"
          onClick={() => onStep(-1)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-cream/70 transition hover:text-gold"
        >
          <SkipBack size={14} />
        </button>
        <button
          onClick={() => player.toggle(selectedTake?.url)}
          title={player.playing ? "Pause" : "Play"}
          className={cx(
            "flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-b from-gold to-gold-deep text-ink transition hover:brightness-110",
            !selectedTake?.url && "opacity-40",
          )}
        >
          {loaded && player.playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
        </button>
        <button
          title="Next take"
          onClick={() => onStep(1)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-cream/70 transition hover:text-gold"
        >
          <SkipForward size={14} />
        </button>
      </div>

      <span className="text-[10px] tabular-nums text-fog">
        {loaded ? player.position : "0:00"}
      </span>
      <ScrubBar
        className="min-w-0 flex-1"
        value={played}
        onSeek={player.seekFraction}
        title={loaded ? "Scrub" : "Play a take to scrub it"}
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

      {/* playback speed — the one graft the review took from the v2 mockup */}
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

/* ---------- screen ---------- */

export function VoiceLab() {
  const lab = useVoiceLab();
  const player = useAudioPlayer();
  const likes = useLikes();
  const [voiceId, setVoiceId] = useState(lab.voices[0]?.id ?? "");
  const [takeId, setTakeId] = useState<string | null>(null);
  const [clone, setClone] = useState<{ open: boolean; file: File | null }>({
    open: false,
    file: null,
  });
  const voice = lab.voices.find((v) => v.id === voiceId) ?? lab.voices[0];
  const selectedTake: VoiceTake | undefined =
    lab.takes.find((t) => t.id === takeId) ?? lab.takes.find((t) => t.selected) ?? lab.takes[0];

  /** transport skip — walks the takes rail in the order it's listed */
  const step = (delta: number) => {
    if (!selectedTake) return;
    const i = lab.takes.findIndex((t) => t.id === selectedTake.id);
    const next = lab.takes[i + delta];
    if (!next) return;
    setTakeId(next.id);
    if (player.playing && next.url) player.toggle(next.url);
  };

  if (!voice) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <VoicesPanel
          voiceId={voice.id}
          player={player}
          onSelect={setVoiceId}
          onAdd={(file) => setClone({ open: true, file: file ?? null })}
        />
        <CenterStage voice={voice} selectedTake={selectedTake} player={player} />
        <TakesRail
          selectedId={selectedTake?.id}
          player={player}
          likes={likes}
          onSelect={setTakeId}
        />
      </div>
      <PlayerBar
        voice={voice}
        selectedTake={selectedTake}
        player={player}
        likes={likes}
        onStep={step}
      />
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
