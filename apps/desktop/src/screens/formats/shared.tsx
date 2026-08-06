import { useState, type ReactNode } from "react";
import {
  BarChart3,
  Box,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Film,
  Layers,
  Loader2,
  PenLine,
  Play,
  Shapes,
  Sigma,
  Sparkles,
  Waves,
} from "lucide-react";
import type { FormatRun, FormatRunResult } from "@/hooks";
import { blendParadigmById, packById, type FormatCard } from "@/data/formats";
import { Modal, ProgressRing, cx } from "@/components/ui";

/* Pieces shared by the gallery and the two create panels. Built to
 * design-refs/2026-08-06-ui-mockups/formats-v2.jpg; verdicts and the
 * intuitiveness plan behind them are in that folder's DECISIONS.md §Formats
 * and the route-merge doc §3. */

/* ---------- poster ---------- */

/** Poster art: a real still from public/formats/<id>.jpg when present,
 * otherwise the format's first style pack paints a palette poster. */
export function Poster({
  format,
  className,
  children,
}: {
  format: FormatCard;
  className?: string;
  /** overlay content — the gallery's peek and run band ride on the art */
  children?: ReactNode;
}) {
  const pack = packById(format.packs[0]);
  const [art, setArt] = useState(true);
  return (
    <div className={cx("relative overflow-hidden", className)} style={{ backgroundColor: pack.bg }}>
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(120% 90% at 20% 110%, ${pack.accent}33 0%, transparent 55%),
            radial-gradient(90% 70% at 85% -10%, ${pack.accentAlt}26 0%, transparent 50%)`,
        }}
      />
      {art && (
        <img
          src={`formats/${format.id}.jpg`}
          alt=""
          onError={() => setArt(false)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {/* the scrim carries the serif title whether or not the art loaded, so
       * a light pack (Therapy Minimal) can't strand cream text on cream */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/5" />
      {children}
    </div>
  );
}

/* ---------- the recipe stack ---------- */

/* The plan's second fix: three layers, each naming its *current value*, joined
 * by a vertical gold line. The old panel scattered the same information across
 * four sections and a paragraph of fine print, and nobody could answer "which
 * setting wins?". Top-down: the format sets the structure, the pack repaints
 * it, the channel speaks it. */

export function RecipeStack({ children }: { children: ReactNode }) {
  return (
    <div className="relative space-y-1.5 pl-5">
      {/* the connecting line — inset so it runs between the dots, not past them */}
      <span className="absolute bottom-4 left-[5px] top-4 w-px bg-gradient-to-b from-gold/50 via-gold/25 to-gold/50" />
      {children}
    </div>
  );
}

export function StackRow({
  icon,
  layer,
  contributes,
  value,
  swatch,
  open,
  onToggle,
  children,
}: {
  icon: ReactNode;
  /** "Format", "Style pack", "Channel preset" */
  layer: string;
  /** what this layer contributes, in plain words */
  contributes: string;
  /** the layer's current value — the whole point of the stack */
  value: ReactNode;
  /** optional palette chip drawn in place of the icon */
  swatch?: string;
  open: boolean;
  onToggle: () => void;
  /** the picker, revealed when the row is open */
  children?: ReactNode;
}) {
  return (
    <div className="relative">
      <span
        className={cx(
          "absolute -left-5 top-[18px] h-[7px] w-[7px] rounded-full transition",
          open ? "bg-gold shadow-[0_0_8px_rgba(201,169,110,0.7)]" : "bg-gold/45",
        )}
      />
      <button
        onClick={onToggle}
        disabled={!children}
        className={cx(
          "flex w-full items-center gap-2.5 rounded-card border px-2.5 py-2 text-left transition duration-[var(--dur-fast)]",
          open ? "border-gold/35 bg-gold/[0.06]" : "border-cream/10 bg-surface",
          children ? "hover:border-gold/30" : "cursor-default",
        )}
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-card border border-cream/10 text-fog"
          style={swatch ? { background: swatch } : undefined}
        >
          {!swatch && icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-2xs text-fog">
            {layer} — {contributes}
          </span>
          <span className="mt-0.5 block truncate text-xs font-medium text-cream">{value}</span>
        </span>
        {children && (
          <ChevronRight
            size={13}
            className={cx("shrink-0 text-fog transition", open && "rotate-90 text-gold")}
          />
        )}
      </button>
      {open && children && <div className="anim-fade mt-1.5 pl-1">{children}</div>}
    </div>
  );
}

/* ---------- how it's built ---------- */

const PARADIGM_ICONS: Record<string, typeof Box> = {
  jsx2d: Shapes,
  svgChoreo: PenLine,
  d3Data: BarChart3,
  p5Canvas: Waves,
  r3f3d: Box,
  parallax25d: Layers,
  manimClip: Sigma,
};

/** A paradigm as a row a person can read: icon, plain name, one line of what
 * it makes. Bare ids (`d3Data`) were the screen's worst jargon. */
export function ParadigmRow({ id }: { id: string }) {
  const p = blendParadigmById(id);
  const Icon = PARADIGM_ICONS[id] ?? Sparkles;
  return (
    <div className="flex items-start gap-2.5 rounded-card border border-cream/8 bg-surface px-2.5 py-2">
      <Icon size={15} className="mt-px shrink-0 text-gold/70" strokeWidth={1.5} />
      <div className="min-w-0">
        <div className="text-xs text-cream/90">{p.label}</div>
        <div className="mt-0.5 text-2xs leading-relaxed text-fog">{p.desc}</div>
      </div>
    </div>
  );
}

/** The collapsed disclosure the plan asks for: informative, not a decision the
 * user usually makes, so it starts shut. */
export function Disclosure({
  label,
  children,
  defaultOpen = false,
}: {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-card border border-cream/8 bg-ink/30">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-cream/80 transition hover:text-gold"
      >
        <span className="flex-1 text-left">{label}</span>
        <ChevronRight size={13} className={cx("text-fog transition", open && "rotate-90")} />
      </button>
      {open && <div className="anim-fade space-y-1.5 px-2.5 pb-2.5">{children}</div>}
    </div>
  );
}

/* ---------- duration ---------- */

/** target-runtime picker — Auto defers to the channel preset (else the
 * writer's natural 25-45s); a number scales word budget + scene count */
const DURATIONS = [30, 45, 60, 90, 180, 300] as const;

/** chips read as minutes once a target passes a minute — "180s" scans slower */
export const durationLabel = (d: number) => (d >= 120 ? `${d / 60}m` : `${d}s`);

export function DurationChips({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {[null, ...DURATIONS].map((d) => (
          <PillButton key={d ?? "auto"} active={value === d} onClick={() => onChange(d)}>
            {d === null ? "Auto" : durationLabel(d)}
          </PillButton>
        ))}
      </div>
      <p className="mt-1.5 text-2xs leading-relaxed text-fog">
        {value === null
          ? "Auto — the channel preset decides, else the writer's natural 25-45s."
          : `Script and scene count scale to ~${durationLabel(value)}; the render lands within ~±15% (narration rules the clock).` +
            (value >= 180 ? " Long-form: expect a proportionally longer write and render." : "")}
      </p>
    </>
  );
}

/** the house selectable pill — chips, arcs, durations, paradigms all wore
 * their own copy of these classes */
export function PillButton({
  active,
  onClick,
  disabled,
  title,
  className,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  /** size override — the gallery's category row runs a step larger */
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cx(
        "rounded-pill border px-2.5 py-1 text-xs transition duration-[var(--dur-fast)]",
        "disabled:cursor-not-allowed disabled:opacity-30",
        active
          ? "border-gold/60 bg-gold/12 text-gold"
          : "border-cream/10 text-cream/70 hover:border-gold/35 hover:text-cream",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ---------- runs ---------- */

/** "Rendering · 62% · 2 min left" — the in-frame treatment DECISIONS picked
 * over a circular overlay for wide cards. */
export function RunLine({ run, className }: { run: FormatRun; className?: string }) {
  return (
    <div className={className}>
      <div className="h-[3px] w-full overflow-hidden rounded-pill bg-cream/15">
        <div
          className="h-full rounded-pill bg-gradient-to-r from-gold-deep to-gold transition-[width] duration-[var(--dur)]"
          style={{ width: `${run.queued ? 0 : Math.max(2, run.progress)}%` }}
        />
      </div>
      <p className="mt-1.5 truncate text-2xs font-medium text-cream/90">
        {run.queued ? (
          "Queued · waiting for the GPU"
        ) : (
          <>
            {run.stage} · <span className="tabular-nums text-gold">{Math.round(run.progress)}%</span>
            {run.eta ? ` · ${etaWords(run.eta)}` : ""}
          </>
        )}
      </p>
    </div>
  );
}

/** "00:02:15" is a stopwatch; "2 min left" is an answer. */
export function etaWords(eta: string): string {
  const parts = eta.split(":").map(Number);
  if (parts.some(Number.isNaN)) return eta;
  const secs = parts.reduce((acc, n) => acc * 60 + n, 0);
  if (secs < 60) return "under a minute left";
  if (secs < 3600) return `${Math.round(secs / 60)} min left`;
  return `${(secs / 3600).toFixed(1)} h left`;
}

/** Finished runs as poster thumbnails — a format becomes a place you come
 * back to rather than a form you fire and forget. */
export function RecentRuns({
  runs,
  onPlay,
}: {
  runs: FormatRunResult[];
  onPlay: (run: FormatRunResult) => void;
}) {
  return (
    <div>
      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-cream/55">
        Recent runs
      </p>
      <div className="mt-1.5 flex gap-1.5">
        {runs.map((r) => (
          <button
            key={r.id}
            title={r.failed ? `${r.title} — ${r.error ?? "failed"}` : r.title}
            onClick={(e) => {
              e.stopPropagation();
              if (r.url) onPlay(r);
            }}
            className={cx(
              "relative h-9 w-7 shrink-0 overflow-hidden rounded-[5px] border transition",
              r.failed
                ? "border-ember/50 bg-ember/10"
                : "border-cream/20 bg-black/40 hover:border-gold/70",
            )}
          >
            {r.url && (
              <video
                src={r.url}
                preload="metadata"
                muted
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            <span className="absolute inset-0 flex items-center justify-center">
              {r.failed ? (
                <CircleAlert size={11} className="text-ember" />
              ) : r.url ? (
                <Play size={10} className="ml-px text-cream/90 drop-shadow" />
              ) : (
                <CheckCircle2 size={11} className="text-cream/60" />
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A finished run, played where you found it. The library is one click away
 * in Assets, but "did that come out any good?" deserves an answer here. */
export function RunPreview({
  run,
  onClose,
}: {
  run: FormatRunResult | null;
  onClose: () => void;
}) {
  return (
    <Modal open={!!run && !!run.url} onClose={onClose} size="md">
      {run?.url && (
        <>
          <div className="flex items-center gap-3 border-b hairline px-4 py-2.5">
            <Film size={13} className="shrink-0 text-gold" />
            <span className="min-w-0 flex-1 truncate font-serif text-sm text-cream">
              {run.title}
            </span>
          </div>
          <video
            src={run.url}
            controls
            autoPlay
            className="max-h-[70vh] w-full bg-black object-contain"
          />
        </>
      )}
    </Modal>
  );
}

/* ---------- panel footer ---------- */

/** The flipped hierarchy: "Create now" is the product, the chat is the escape
 * hatch. It used to be the other way round, so the fast path looked optional. */
export function CreateFooter({
  onCreate,
  onRefine,
  pending,
  disabled,
  disabledReason,
}: {
  onCreate: () => void;
  onRefine: () => void;
  pending: boolean;
  disabled: boolean;
  disabledReason?: string;
}) {
  return (
    <div className="space-y-2 border-t hairline bg-[#0e0e10] p-4">
      <button
        onClick={onCreate}
        disabled={disabled || pending}
        title={disabled ? disabledReason : "Enqueue the full pipeline now"}
        className={cx(
          "flex w-full items-center justify-center gap-2 rounded-card px-3 py-2.5",
          "bg-gradient-to-b from-[#dcc08e] via-gold to-gold-deep text-sm font-semibold text-ink",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_4px_18px_rgba(201,169,110,0.28)]",
          "transition hover:brightness-110 active:brightness-95",
          "disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:brightness-100",
        )}
      >
        {pending ? (
          <>
            <Loader2 size={14} className="animate-spin" /> Queueing…
          </>
        ) : (
          <>
            Create now <Sparkles size={14} />
          </>
        )}
      </button>
      <button
        onClick={onRefine}
        className="flex w-full items-center justify-center gap-2 rounded-card border border-cream/10 px-3 py-2 text-xs font-medium text-cream/75 transition hover:border-gold/40 hover:text-gold"
      >
        Refine with the Director
      </button>
    </div>
  );
}

/** the panel's own queue feedback — the run is on the tile behind it too */
export function QueuedNote({ title }: { title: string }) {
  return (
    <div className="anim-fade flex items-center gap-2.5 rounded-card border border-gold/40 bg-gold/[0.08] p-3">
      <ProgressRing value={0} size={26} stroke={2}>
        <Loader2 size={11} className="animate-spin text-gold" />
      </ProgressRing>
      <div className="min-w-0">
        <p className="truncate text-xs text-cream">“{title}” is rendering.</p>
        <p className="mt-0.5 text-2xs text-fog">
          Watch it on the format tile — it lands in Assets when it's done.
        </p>
      </div>
    </div>
  );
}
