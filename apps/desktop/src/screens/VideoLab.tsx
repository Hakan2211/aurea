import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  HelpCircle,
  Lightbulb,
  Maximize2,
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
  Volume2,
  Wand2,
} from "lucide-react";
import { useJobs, useVideoLab } from "@/hooks";
import type { VideoStage, VideoTake } from "@/data/sample";
import { Chip, GoldButton, Progress, cx } from "@/components/ui";

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
  // the dead-core fallback shape predates the live fields — narrow before use
  const canGenerate = "canGenerate" in lab ? lab.canGenerate : false;
  const startFrameUrl = "url" in lab.startFrame ? lab.startFrame.url : undefined;
  const [prompt, setPrompt] = useState(lab.prompt);
  const [engineId, setEngineId] = useState(lab.engines[0].id);
  const [duration, setDuration] = useState(lab.duration);
  const [resolution, setResolution] = useState(lab.resolution);
  const [motion, setMotion] = useState(lab.motionStrength);

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
            <button className="inline-flex items-center gap-1 text-[10px] text-fog transition hover:text-gold">
              <Replace size={10} /> Replace
            </button>
          </div>
          <div className="relative mt-2 h-28 overflow-hidden rounded-xl border border-cream/10">
            <div className={cx("absolute inset-0", lab.startFrame.swatch)} />
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
              <div className="truncate text-[11px] text-cream/90">{lab.startFrame.name}</div>
              <div className="text-[10px] text-fog">{lab.startFrame.meta}</div>
            </div>
          </div>
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
        <section className="grid grid-cols-2 gap-1.5">
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

      <div className="p-4 pt-2">
        <GoldButton
          onClick={() =>
            lab.generate({
              prompt,
              durationSec: parseInt(duration) || 5,
              resolution,
              motionStrength: motion,
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
      </div>
    </aside>
  );
}

/* ---------- center: preview + takes ---------- */

function TakeCard({ take, active, onSelect }: { take: VideoTake; active: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={cx(
        "group relative aspect-video min-w-0 flex-1 overflow-hidden rounded-xl border transition",
        active ? "border-gold/60" : "border-cream/10 hover:border-cream/25",
      )}
    >
      <div className={cx("absolute inset-0", take.swatch)} />
      {take.url ? (
        <video
          src={take.url}
          muted
          preload="metadata"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_30%,rgba(237,234,228,0.07),transparent_60%)]" />
      )}
      {take.starred && (
        <Star size={12} className="absolute right-2 top-2 text-gold" fill="currentColor" />
      )}
      <span className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink/60 text-cream backdrop-blur">
          <Play size={13} className="ml-0.5" />
        </span>
      </span>
      <span
        className={cx(
          "absolute bottom-2 left-2.5 text-[11px] font-medium",
          active ? "text-gold" : "text-cream/85",
        )}
      >
        {take.label}
      </span>
    </button>
  );
}

function PreviewPanel({ takeId, onSelect }: { takeId: string; onSelect: (id: string) => void }) {
  const lab = useVideoLab();
  const [playing, setPlaying] = useState(true);
  const take = lab.takes.find((t) => t.id === takeId) ?? lab.takes[0];
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (playing) void el.play().catch(() => {});
    else el.pause();
  }, [playing, take.url]);

  return (
    <section className="flex min-w-0 flex-1 flex-col p-4">
      <header className="flex items-center justify-between pb-3">
        <h2 className="font-serif text-[16px] font-semibold tracking-wide text-cream">Preview</h2>
        <div className="flex items-center gap-1">
          <button className="flex h-8 w-8 items-center justify-center rounded-lg border border-cream/10 text-fog transition hover:border-gold/35 hover:text-gold">
            <Maximize2 size={13} />
          </button>
          <button className="flex h-8 w-8 items-center justify-center rounded-lg border border-cream/10 text-fog transition hover:border-gold/35 hover:text-gold">
            <MoreVertical size={13} />
          </button>
        </div>
      </header>

      {/* player */}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border hairline">
        <div className={cx("absolute inset-0", take.swatch)} />
        {take.url ? (
          <video
            ref={videoRef}
            src={take.url}
            muted
            loop
            playsInline
            autoPlay
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          /* stand-in composition until real frames flow through the seam */
          <div className="absolute inset-0 bg-[radial-gradient(90%_70%_at_50%_35%,rgba(237,234,228,0.09),transparent_65%)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-transparent to-ink/20" />

        <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 px-4 pb-3">
          <button
            onClick={() => setPlaying((p) => !p)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-gold to-gold-deep text-ink transition hover:brightness-110"
          >
            {playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
          </button>
          <span className="shrink-0 text-[11px] tabular-nums text-cream/90">
            {lab.playback.position} <span className="text-fog">/ {lab.playback.total}</span>
          </span>
          <div className="relative h-1 min-w-0 flex-1 rounded-full bg-cream/15">
            <div
              className="h-full rounded-full bg-gradient-to-r from-gold-deep to-gold"
              style={{ width: `${lab.playback.played * 100}%` }}
            />
            <span
              className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-gold shadow"
              style={{ left: `calc(${lab.playback.played * 100}% - 6px)` }}
            />
          </div>
          <button className="shrink-0 text-cream/70 transition hover:text-gold">
            <Volume2 size={15} />
          </button>
          <button className="shrink-0 text-cream/70 transition hover:text-gold">
            <Maximize2 size={14} />
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
          <button className="inline-flex items-center gap-0.5 text-[11px] text-gold hover:underline">
            View all <ChevronRight size={11} />
          </button>
        </div>
        <div className="flex gap-2.5">
          {lab.takes.map((t) => (
            <TakeCard key={t.id} take={t} active={t.id === takeId} onSelect={() => onSelect(t.id)} />
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
