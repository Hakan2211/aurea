import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  AudioLines,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  Download,
  FileText,
  HelpCircle,
  Lightbulb,
  ListPlus,
  Maximize2,
  Minimize2,
  Monitor,
  MoreVertical,
  Pause,
  Play,
  RefreshCw,
  Replace,
  Settings2,
  Sparkles,
  Star,
  Timer,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
  Wand2,
  X,
} from "lucide-react";
import { downloadAsset, useJobs, useLikes, useRemoveAssets, useSendToTimeline, useVideoLab } from "@/hooks";
import type { VideoStage, VideoTake } from "@/data/sample";
import { Chip, GoldButton, Progress, cx } from "@/components/ui";
import { useVideoPlayer, type VideoPlayer } from "@/components/useVideoPlayer";

/* Video gen — UI-Design/videogen lab.jpg. Keyframe-driven i2v: prompt + start
 * frame + engine choice (LTX-2 local free / Seedance API with a cost estimate
 * up front) on the left, preview + takes in the center, staged job progress on
 * the right. Data flows through useVideoLab (tRPC seam). */

function PanelLabel({ children, hint }: { children: React.ReactNode; hint?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">{children}</h3>
      {hint && <HelpCircle size={12} className="text-fog/50" />}
    </div>
  );
}

function Select({
  icon: Icon,
  value,
  options,
  onChange,
}: {
  icon: typeof Timer;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-xl border border-cream/10 bg-surface px-3 py-2 text-[11px] text-cream/85 transition hover:border-gold/35"
      >
        <Icon size={12} className="shrink-0 text-gold/80" />
        <span className="flex-1 truncate text-left tabular-nums">{value}</span>
        <ChevronDown
          size={11}
          className={cx("shrink-0 text-fog transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-cream/12 bg-raised shadow-xl">
          {options.map((o) => (
            <button
              key={o}
              onClick={() => {
                onChange(o);
                setOpen(false);
              }}
              className={cx(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] tabular-nums transition hover:bg-cream/5",
                o === value ? "text-gold" : "text-cream/85",
              )}
            >
              <span className="w-3">{o === value && <Check size={11} />}</span>
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- left panel: params ---------- */

function ParamsPanel() {
  const lab = useVideoLab();
  const [prompt, setPrompt] = useState(lab.prompt);
  const [engineId, setEngineId] = useState(lab.engines[0].id);
  const [duration, setDuration] = useState(lab.duration);
  const [resolution, setResolution] = useState(lab.resolution);
  const [motion, setMotion] = useState(lab.motionStrength);
  /** null = the default (newest library still); set by the Replace picker */
  const [frameRel, setFrameRel] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** optional dialogue take — switches the render to ia2v lip-sync */
  const [audioRel, setAudioRel] = useState<string | null>(null);
  const [audioOpen, setAudioOpen] = useState(false);

  // the dead-core fallback shape predates the live fields — narrow before use
  const chosen = frameRel ? lab.frames.find((f) => f.relPath === frameRel) : undefined;
  const defaultRel = "relPath" in lab.startFrame ? lab.startFrame.relPath : undefined;
  const frameName = chosen?.name ?? lab.startFrame.name;
  const frameMeta = chosen?.meta ?? lab.startFrame.meta;
  const frameSwatch = chosen?.swatch ?? lab.startFrame.swatch;
  const startFrameUrl = chosen?.url ?? ("url" in lab.startFrame ? lab.startFrame.url : undefined);
  const effectiveRel = chosen?.relPath ?? defaultRel;
  const canGenerate = "canGenerate" in lab ? !!effectiveRel : false;
  const audioName = audioRel
    ? (lab.audioSources.find((a) => a.relPath === audioRel)?.name ?? audioRel)
    : null;
  const durationSec = parseInt(duration) || 5;

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r hairline bg-[#0e0e10]">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {/* 1 · prompt */}
        <section>
          <div className="flex items-center justify-between">
            <PanelLabel>1 · Prompt</PanelLabel>
            <button className="inline-flex items-center gap-1 rounded-full bg-gold/12 px-2 py-0.5 text-[10px] font-medium text-gold transition hover:bg-gold/20">
              <Wand2 size={10} /> Magic prompt
            </button>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value.slice(0, lab.promptMax))}
            rows={5}
            className="mt-2 w-full resize-none rounded-xl border border-cream/10 bg-surface p-3 text-[12px] leading-relaxed text-cream placeholder:text-fog focus:border-gold/40 focus:outline-none"
            placeholder="Describe the shot…"
          />
          <div className="mt-1 text-right text-[10px] tabular-nums text-fog/70">
            {prompt.length} / {lab.promptMax}
          </div>
        </section>

        {/* 2 · start frame */}
        <section>
          <div className="flex items-center justify-between">
            <PanelLabel>2 · Start frame (keyframe)</PanelLabel>
            <button
              onClick={() => setPickerOpen(true)}
              className="inline-flex items-center gap-1 text-[10px] text-fog transition hover:text-gold"
            >
              <Replace size={10} /> Replace
            </button>
          </div>
          <button
            onClick={() => setPickerOpen(true)}
            title="Choose a different start frame"
            className="relative mt-2 block h-28 w-full overflow-hidden rounded-xl border border-cream/10 text-left transition hover:border-gold/40"
          >
            <div className={cx("absolute inset-0", frameSwatch)} />
            {startFrameUrl ? (
              <img
                src={startFrameUrl}
                alt=""
                draggable={false}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_30%,rgba(237,234,228,0.07),transparent_60%)]" />
            )}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/80 to-transparent px-2.5 pb-2 pt-5">
              <div className="truncate text-[11px] text-cream/90">{frameName}</div>
              <div className="text-[10px] text-fog">
                {frameMeta}
                {!frameRel && " · newest still (default)"}
              </div>
            </div>
          </button>
        </section>

        {/* 2b · dialogue audio (optional — ia2v lip-sync) */}
        <section>
          <PanelLabel hint>2b · Dialogue audio (optional)</PanelLabel>
          <div className="relative mt-2">
            {audioRel ? (
              <div className="flex items-center gap-2 rounded-xl border border-gold/30 bg-gold/6 px-3 py-2">
                <AudioLines size={13} className="shrink-0 text-gold/80" />
                <span className="min-w-0 flex-1 truncate text-[11px] text-cream/90">
                  {audioName}
                </span>
                <button
                  title="Remove audio — back to plain i2v"
                  onClick={() => setAudioRel(null)}
                  className="shrink-0 text-fog/60 transition hover:text-red-400"
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAudioOpen((o) => !o)}
                className="flex w-full items-center gap-2 rounded-xl border border-dashed border-cream/15 px-3 py-2 text-[11px] text-cream/80 transition hover:border-gold/50 hover:text-gold"
              >
                <AudioLines size={13} />
                <span className="flex-1 text-left">Attach a voice take…</span>
                <ChevronDown
                  size={11}
                  className={cx("text-fog transition-transform", audioOpen && "rotate-180")}
                />
              </button>
            )}
            {audioOpen && !audioRel && (
              <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-44 overflow-y-auto rounded-xl border border-cream/12 bg-raised shadow-xl">
                {lab.audioSources.length === 0 && (
                  <p className="px-3 py-2 text-[11px] text-fog">
                    No voice takes yet — generate one in the Voice lab.
                  </p>
                )}
                {lab.audioSources.map((a) => (
                  <button
                    key={a.relPath}
                    onClick={() => {
                      setAudioRel(a.relPath);
                      setAudioOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-cream/85 transition hover:bg-cream/5"
                  >
                    <span className="flex-1 truncate">{a.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-fog/70">
            {audioRel
              ? "Renders with LTX ia2v — the named speaker lip-syncs this audio."
              : "Attach a Voice-lab take to switch from i2v to ia2v lip-sync."}
          </p>
        </section>

        {/* 3 · engine */}
        <section>
          <PanelLabel hint>3 · Engine</PanelLabel>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {lab.engines.map((e) => (
              <button
                key={e.id}
                onClick={() => setEngineId(e.id)}
                className={cx(
                  "rounded-xl border p-2.5 text-left transition",
                  engineId === e.id
                    ? "border-gold/60 bg-gold/8"
                    : "border-cream/10 hover:border-cream/20",
                )}
              >
                <div
                  className={cx(
                    "text-[12px] font-medium",
                    engineId === e.id ? "text-gold" : "text-cream/90",
                  )}
                >
                  {e.label}
                </div>
                <div className="mt-0.5 text-[10px] text-fog">{e.sub}</div>
                <div className="mt-1 text-[9px] leading-snug text-fog/70">{e.note}</div>
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-fog/70">{lab.engineNotes[engineId]}</p>
        </section>

        {/* 4/5 · duration + resolution */}
        <section>
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <PanelLabel>4 · Duration</PanelLabel>
              <div className="mt-2">
                <Select icon={Timer} value={duration} options={lab.durations} onChange={setDuration} />
              </div>
            </div>
            <div>
              <PanelLabel>5 · Resolution</PanelLabel>
              <div className="mt-2">
                <Select
                  icon={Monitor}
                  value={resolution}
                  options={lab.resolutions}
                  onChange={setResolution}
                />
              </div>
            </div>
          </div>
          {engineId === "seedance" && durationSec > 7 && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-fog/70">
              Seedance only renders 5s or 10s — this queues as a 10-second clip.
            </p>
          )}
          {engineId !== "seedance" && durationSec > 10 && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-gold/75">
              Long clips scale VRAM and render time roughly linearly — drop the
              resolution if a {durationSec}s take runs out of memory.
            </p>
          )}
        </section>

        {/* 6 · motion strength */}
        <section>
          <div className="flex items-center justify-between">
            <PanelLabel hint>6 · Motion strength</PanelLabel>
            <span className="text-[12px] font-medium tabular-nums text-gold">
              {motion.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={motion}
            onChange={(e) => setMotion(Number(e.target.value))}
            className="mt-2 w-full accent-gold"
          />
        </section>
      </div>

      <div className="space-y-2 p-4 pt-2">
        <GoldButton
          onClick={() =>
            lab.generate({
              prompt,
              engine: engineId,
              durationSec,
              resolution,
              motionStrength: motion,
              startFrame: effectiveRel,
              audio: audioRel ?? undefined,
            })
          }
          className={cx(
            "w-full justify-center py-3 text-[13px] uppercase tracking-widest",
            (lab.busy || !canGenerate || !prompt.trim()) && "pointer-events-none opacity-50",
          )}
        >
          <Sparkles size={14} />{" "}
          {lab.busy ? "Generating…" : canGenerate ? "Generate" : "Needs a start frame"}
        </GoldButton>
        {lab.error && (
          <p className="rounded-lg border border-red-500/25 bg-red-500/8 px-2.5 py-1.5 text-[10px] leading-relaxed text-red-300">
            {lab.error}
          </p>
        )}
        {lab.failures.slice(0, 1).map((f) => (
          <div
            key={f.id}
            className="rounded-lg border border-red-500/25 bg-red-500/8 px-2.5 py-1.5"
          >
            <div className="flex items-center gap-1.5">
              <CircleAlert size={11} className="shrink-0 text-red-400" />
              <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-cream/90">
                {f.title} · {f.engine}
              </span>
              <button
                onClick={() => lab.retry(f.id)}
                className="shrink-0 text-[10px] text-gold hover:underline"
              >
                Retry
              </button>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-red-300">{f.error}</p>
          </div>
        ))}
      </div>

      {pickerOpen && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-ink/85 backdrop-blur-sm"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="flex max-h-[70vh] w-[560px] flex-col rounded-2xl border border-cream/12 bg-raised p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-[18px] font-semibold text-cream">
                Choose a start frame
              </h3>
              <button
                onClick={() => setPickerOpen(false)}
                className="text-fog/60 transition hover:text-cream"
              >
                <X size={16} />
              </button>
            </div>
            <p className="mt-1 text-[11px] text-fog">
              Any library still works — generate new ones in the Image lab.
            </p>
            <div className="mt-4 grid min-h-0 flex-1 auto-rows-min grid-cols-3 gap-2 overflow-y-auto">
              {lab.frames.map((f) => (
                <button
                  key={f.relPath}
                  onClick={() => {
                    setFrameRel(f.relPath);
                    setPickerOpen(false);
                  }}
                  className={cx(
                    "group relative aspect-video overflow-hidden rounded-lg border transition",
                    f.relPath === effectiveRel
                      ? "border-gold/60"
                      : "border-cream/8 hover:border-gold/40",
                  )}
                >
                  <div className={cx("absolute inset-0", f.swatch)} />
                  {f.url && (
                    <img
                      src={f.url}
                      alt=""
                      draggable={false}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  )}
                  <span className="absolute inset-x-1 bottom-1 truncate text-left text-[9px] text-cream/80">
                    {f.name}
                  </span>
                </button>
              ))}
              {lab.frames.length === 0 && (
                <p className="col-span-3 py-6 text-center text-[11px] text-fog">
                  No stills in the library yet.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

/* ---------- center: preview + takes ---------- */

function TakeCard({
  take,
  active,
  starred,
  onSelect,
  onStar,
}: {
  take: VideoTake;
  active: boolean;
  starred: boolean;
  onSelect: () => void;
  onStar: () => void;
}) {
  const hoverRef = useRef<HTMLVideoElement>(null);
  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => {
        const el = hoverRef.current;
        if (el) void el.play().catch(() => {});
      }}
      onMouseLeave={() => {
        const el = hoverRef.current;
        if (!el) return;
        el.pause();
        el.currentTime = 0;
      }}
      className={cx(
        "group relative aspect-video min-w-0 flex-1 cursor-pointer overflow-hidden rounded-xl border transition",
        active ? "border-gold/60" : "border-cream/10 hover:border-cream/25",
      )}
    >
      <div className={cx("absolute inset-0", take.swatch)} />
      {take.url ? (
        /* hover scrubs the take silently — the preview player owns the sound */
        <video
          ref={hoverRef}
          src={take.url}
          muted
          loop
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_30%,rgba(237,234,228,0.07),transparent_60%)]" />
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onStar();
        }}
        title={starred ? "Unstar this take" : "Star this take"}
        className={cx(
          "absolute right-1.5 top-1.5 z-[1] rounded-full p-1 transition",
          starred ? "text-gold" : "text-cream/50 opacity-0 group-hover:opacity-100 hover:text-gold",
        )}
      >
        <Star size={12} fill={starred ? "currentColor" : "none"} />
      </button>
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink/60 text-cream backdrop-blur">
          <Play size={13} className="ml-0.5" />
        </span>
      </span>
      <span
        className={cx(
          "pointer-events-none absolute bottom-2 left-2.5 text-[11px] font-medium",
          active ? "text-gold" : "text-cream/85",
        )}
      >
        {take.label}
      </span>
    </div>
  );
}

/* ---------- transport controls ---------- */

/** Click-and-drag scrub bar. Pointer capture keeps the drag alive when the
 * cursor leaves the 1px track, which is most of the time. */
function Scrubber({ player }: { player: VideoPlayer }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  const fractionAt = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  const seekable = player.durationSec > 0;
  const shown = dragging && hover != null ? hover : player.played;

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shown * 100)}
      onPointerDown={(e) => {
        if (!seekable) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        const f = fractionAt(e.clientX);
        setHover(f);
        player.seekFraction(f);
      }}
      onPointerMove={(e) => {
        const f = fractionAt(e.clientX);
        if (dragging) {
          setHover(f);
          player.seekFraction(f);
        } else if (seekable) {
          setHover(f);
        }
      }}
      onPointerUp={(e) => {
        if (!dragging) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        setDragging(false);
      }}
      onPointerLeave={() => !dragging && setHover(null)}
      className={cx(
        "group/scrub relative -my-2 min-w-0 flex-1 py-2",
        seekable ? "cursor-pointer" : "cursor-default",
      )}
    >
      <div className="relative h-1 rounded-full bg-cream/15">
        {/* hover ghost — where a click would land */}
        {hover != null && !dragging && (
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-cream/20"
            style={{ width: `${hover * 100}%` }}
          />
        )}
        <div
          className="h-full rounded-full bg-gradient-to-r from-gold-deep to-gold"
          style={{ width: `${shown * 100}%` }}
        />
        <span
          className={cx(
            "absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-gold shadow transition-transform",
            dragging && "scale-125",
          )}
          style={{ left: `calc(${shown * 100}% - 6px)` }}
        />
      </div>
    </div>
  );
}

function VolumeControl({ player }: { player: VideoPlayer }) {
  const Icon = player.muted || player.volume === 0 ? VolumeX : player.volume < 0.5 ? Volume1 : Volume2;
  return (
    <div className="group/vol relative flex shrink-0 items-center">
      <button
        onClick={player.toggleMute}
        title={player.muted ? "Unmute (M)" : "Mute (M)"}
        className={cx(
          "transition hover:text-gold",
          player.muted ? "text-fog" : "text-cream/70",
          player.autoplayBlocked && "animate-pulse text-gold",
        )}
      >
        <Icon size={15} />
      </button>
      {/* slider expands on hover — no space stolen from the scrub bar */}
      <div className="w-0 overflow-hidden opacity-0 transition-all duration-150 group-hover/vol:ml-2 group-hover/vol:w-20 group-hover/vol:opacity-100">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={player.muted ? 0 : player.volume}
          onChange={(e) => player.setVolume(Number(e.target.value))}
          className="w-20 accent-gold"
        />
      </div>
    </div>
  );
}

function PreviewPanel({ takeId, onSelect }: { takeId: string; onSelect: (id: string) => void }) {
  const lab = useVideoLab();
  const navigate = useNavigate();
  const { isLiked, toggleLike } = useLikes();
  const timeline = useSendToTimeline();
  const { remove } = useRemoveAssets();
  const take = lab.takes.find((t) => t.id === takeId) ?? lab.takes[0];
  const player = useVideoPlayer(take?.url);
  const stageRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen().catch(() => {});
  }, []);

  /* transport shortcuts, scoped to the focused player so they never eat
   * keystrokes meant for the prompt box */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (key === " " || key === "k") {
      e.preventDefault();
      player.toggle();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      player.nudge(-2);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      player.nudge(2);
    } else if (key === "m") {
      player.toggleMute();
    } else if (key === "f") {
      toggleFullscreen();
    }
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col p-4">
      <header className="flex items-center justify-between pb-3">
        <h2 className="font-serif text-[16px] font-semibold tracking-wide text-cream">Preview</h2>
        <div className="relative flex items-center gap-1">
          <button
            onClick={toggleFullscreen}
            title="Fullscreen (F)"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-cream/10 text-fog transition hover:border-gold/35 hover:text-gold"
          >
            <Maximize2 size={13} />
          </button>
          <button
            onClick={() => {
              setMenu((m) => !m);
              setArmed(false);
            }}
            title="Take actions"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-cream/10 text-fog transition hover:border-gold/35 hover:text-gold"
          >
            <MoreVertical size={13} />
          </button>
          {menu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
              <div className="absolute right-0 top-9 z-20 w-52 rounded-xl border border-cream/12 bg-raised p-1 shadow-xl">
                <button
                  onClick={() => {
                    setMenu(false);
                    if (take?.relPath) void timeline.send(take.relPath);
                  }}
                  disabled={!take?.relPath || timeline.sending || !timeline.live}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-cream/85 transition hover:bg-cream/5 disabled:opacity-40"
                >
                  <ListPlus size={12} /> {timeline.sending ? "Sending…" : "Send to timeline"}
                </button>
                <button
                  onClick={() => {
                    setMenu(false);
                    if (take?.url) void downloadAsset(take.url, `${take.label || "take"}.mp4`);
                  }}
                  disabled={!take?.url}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-cream/85 transition hover:bg-cream/5 disabled:opacity-40"
                >
                  <Download size={12} /> Download
                </button>
                <button
                  onClick={() => {
                    if (!armed) {
                      setArmed(true);
                      return;
                    }
                    setMenu(false);
                    setArmed(false);
                    if (take?.relPath) void remove(take.relPath);
                  }}
                  disabled={!take?.relPath}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-[#e07a6b] transition hover:bg-cream/5 disabled:opacity-40"
                >
                  <Trash2 size={12} /> {armed ? "Click again to confirm" : "Delete from disk"}
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* player */}
      <div
        ref={stageRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="group/player relative min-h-0 flex-1 overflow-hidden rounded-2xl border hairline bg-black outline-none focus-visible:border-gold/40"
      >
        {!take?.url && <div className={cx("absolute inset-0", take?.swatch)} />}
        {take?.url ? (
          <video
            ref={player.ref}
            src={take.url}
            loop
            playsInline
            onClick={player.toggle}
            className="absolute inset-0 h-full w-full cursor-pointer object-contain"
          />
        ) : (
          /* stand-in composition until real frames flow through the seam */
          <div className="absolute inset-0 bg-[radial-gradient(90%_70%_at_50%_35%,rgba(237,234,228,0.09),transparent_65%)]" />
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-ink/80 to-transparent" />

        {/* Chromium blocked unmuted autoplay — one click gets the sound back */}
        {player.autoplayBlocked && (
          <button
            onClick={player.toggleMute}
            className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-gold/40 bg-ink/80 px-3 py-1.5 text-[11px] text-gold backdrop-blur transition hover:bg-ink"
          >
            <VolumeX size={11} className="mr-1 inline" /> Muted — click for sound
          </button>
        )}

        <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 px-4 pb-3">
          <button
            onClick={player.toggle}
            title={player.playing ? "Pause (Space)" : "Play (Space)"}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-gold to-gold-deep text-ink transition hover:brightness-110"
          >
            {player.playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
          </button>
          <span className="shrink-0 text-[11px] tabular-nums text-cream/90">
            {player.position} <span className="text-fog">/ {player.total}</span>
          </span>
          <Scrubber player={player} />
          <VolumeControl player={player} />
          <button
            onClick={toggleFullscreen}
            title="Fullscreen (F)"
            className="shrink-0 text-cream/70 transition hover:text-gold"
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* takes */}
      <div className="pt-4">
        <div className="flex items-center justify-between pb-2.5">
          <div className="flex items-center gap-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">Takes</h3>
            <Chip tone="muted" className="text-[9px] tabular-nums">
              {lab.takes.length}
            </Chip>
          </div>
          <button
            onClick={() => navigate("/assets")}
            className="inline-flex items-center gap-0.5 text-[11px] text-gold hover:underline"
          >
            View all <ChevronRight size={11} />
          </button>
        </div>
        <div className="flex gap-2.5">
          {lab.takes.map((t) => (
            <TakeCard
              key={t.id}
              take={t}
              active={t.id === takeId}
              starred={t.relPath ? isLiked(t.relPath) : !!t.starred}
              onSelect={() => onSelect(t.id)}
              onStar={() => toggleLike(t.relPath)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- right rail: job progress + system ---------- */

function StageRow({ stage, index, last }: { stage: VideoStage; index: number; last: boolean }) {
  const done = stage.status === "completed";
  const running = stage.status === "running";
  return (
    <div className="relative flex gap-3 pb-5 last:pb-0">
      {!last && <span className="absolute bottom-0 left-[11px] top-6 w-px bg-gold/25" />}
      <span
        className={cx(
          "z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums",
          done
            ? "border-gold bg-gradient-to-b from-gold to-gold-deep text-ink"
            : running
              ? "border-gold/70 bg-[#0e0e10] text-gold"
              : "border-cream/15 bg-[#0e0e10] text-fog",
        )}
      >
        {done ? <Check size={12} /> : index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cx("text-[12px] font-medium", stage.status === "pending" ? "text-fog" : "text-cream")}>
            {stage.label}
          </span>
          <span
            className={cx(
              "shrink-0 text-[10px]",
              done ? "text-fog" : running ? "text-gold" : "text-fog/60",
            )}
          >
            {done ? "Completed" : running ? "In progress" : "Pending"}
          </span>
        </div>
        <div className="mt-0.5 flex items-baseline justify-between gap-2 text-[10px] text-fog">
          <span className="truncate">{stage.detail}</span>
          <span className="shrink-0 tabular-nums">{stage.time ?? "--:--:--"}</span>
        </div>
        {running && stage.progress != null && (
          <div className="mt-2 flex items-center gap-2">
            <Progress value={stage.progress} className="flex-1" />
            <span className="text-[10px] tabular-nums text-cream/80">{stage.progress}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

function JobRail() {
  const lab = useVideoLab();
  const { vram } = useJobs();
  const pct = Math.min(100, (vram.used / vram.total) * 100);

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l hairline bg-[#0e0e10]">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {/* job progress */}
        <section>
          <div className="flex items-center justify-between pb-2.5">
            <h2 className="font-serif text-[15px] font-semibold tracking-wide text-cream">
              Job progress
            </h2>
            <span className="flex items-center gap-1 text-[10px] tabular-nums text-fog">
              {lab.job.id}
              <button className="text-fog/60 transition hover:text-gold">
                <Copy size={10} />
              </button>
            </span>
          </div>

          <div className="divide-y divide-cream/6 rounded-xl bg-surface/60 px-3">
            <div className="flex items-center justify-between py-2.5 text-[11px]">
              <span className="text-fog">Status</span>
              <span className="flex items-center gap-1.5 font-medium text-gold">
                {lab.job.status} <RefreshCw size={11} className="animate-spin [animation-duration:2.5s]" />
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5 text-[11px]">
              <span className="text-fog">Elapsed</span>
              <span className="tabular-nums text-cream/90">{lab.job.elapsed}</span>
            </div>
          </div>

          <div className="mt-4 px-1">
            {lab.job.stages.map((st, i) => (
              <StageRow key={st.id} stage={st} index={i} last={i === lab.job.stages.length - 1} />
            ))}
          </div>
        </section>

        {/* system */}
        <section>
          <h2 className="pb-2 font-serif text-[15px] font-semibold tracking-wide text-cream">
            System
          </h2>
          <div className="rounded-xl bg-surface/60 p-3">
            <div className="flex items-baseline justify-between text-[11px]">
              <span className="text-fog">VRAM</span>
              <span className="tabular-nums text-cream/90">
                {vram.allocated} / {vram.total} GB
              </span>
            </div>
            <Progress value={pct} className="mt-2" />
            <p className="mt-1.5 text-[10px] text-gold/80">
              {Math.round((vram.allocated / vram.total) * 100)}% · high usage
            </p>
          </div>
        </section>

        {/* tip */}
        <section className="rounded-xl border border-gold/15 bg-gold/4 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-gold">
            <Lightbulb size={12} /> Tip
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-fog">{lab.tip}</p>
        </section>
      </div>

      <div className="flex items-center justify-between border-t hairline px-4 py-2.5">
        {(
          [
            { icon: Settings2, label: "Settings" },
            { icon: FileText, label: "Logs" },
            { icon: HelpCircle, label: "Help" },
          ] as const
        ).map(({ icon: Icon, label }) => (
          <button
            key={label}
            className="inline-flex items-center gap-1.5 text-[11px] text-fog transition hover:text-gold"
          >
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>
    </aside>
  );
}

/* ---------- screen ---------- */

export function VideoLab() {
  const lab = useVideoLab();
  const [takeId, setTakeId] = useState((lab.takes.find((t) => t.selected) ?? lab.takes[0]).id);

  return (
    <div className="flex h-full">
      <ParamsPanel />
      <PreviewPanel takeId={takeId} onSelect={setTakeId} />
      <JobRail />
    </div>
  );
}
