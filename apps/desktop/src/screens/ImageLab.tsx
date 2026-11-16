import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Copy,
  Download,
  Expand,
  Heart,
  Layers,
  Loader2,
  Maximize2,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { downloadAsset, useImageLab, useLikes } from "@/hooks";
import type { ImageHistoryEntry, ImageTile } from "@/data/sample";
import {
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  LabDrawer,
  StatusBar,
  cx,
  useLabDrawer,
} from "@/components/ui";
import { PromptLibraryPanel } from "@/screens/image/PromptLibraryPanel";
import { PromptLibraryRail } from "@/screens/image/PromptLibraryRail";
import { LabHeader, type RollScope, type RollView } from "@/screens/image/LabHeader";
import { usePromptState } from "@/screens/image/promptState";
import { useDraft } from "@/useDraft";
import { ImageComposer } from "@/screens/image/ImageComposer";
import { ImageAdvanced } from "@/screens/image/ImageAdvanced";
import { useImageParams, type LabMode, type RefImage } from "@/screens/image/useImageParams";

/* Image lab — simple by default (UI simplify plan, Stage 3). The results
 * fill the screen; the composer under them holds mode, prompt, references
 * (Edit), model, shape and count; one drawer on the right holds Advanced, the
 * prompt library or the day-by-day history. All render state is
 * useImageParams, so the layout cannot change what a run sends. Engine roster:
 * Krea 2 default, z-image-turbo drafts, Qwen-Edit / GPT Image 2 edits. */

/** stills the canvas renders before the "Show older" button takes over — the
 * roll can be hundreds deep, and mounting all of them costs a visible beat */
const ROLL_PAGE = 60;

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "Today" / "Yesterday" / "Mon, 21 Jul" — the roll's date separators. Days
 * come in as local ISO (YYYY-MM-DD), so compare them as strings, not as
 * Dates: parsing "2026-07-27" gives UTC midnight and shifts the label. */
function dayLabel(day: string): string {
  const now = new Date();
  if (day === isoDay(now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day === isoDay(yesterday)) return "Yesterday";
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(y === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** the roll in render order, split into dated sections. Renders in flight have
 * no file yet and so no day — they belong at the top, under today. */
function groupByDay(tiles: ImageTile[]): { day: string; tiles: ImageTile[] }[] {
  const today = isoDay(new Date());
  const out: { day: string; tiles: ImageTile[] }[] = [];
  for (const tile of tiles) {
    const day = tile.day ?? today;
    const last = out[out.length - 1];
    if (last?.day === day) last.tiles.push(tile);
    else out.push({ day, tiles: [tile] });
  }
  return out;
}

/* ---------- canvas ---------- */

/** every verb a finished still supports; the tile bar and the lightbox render
 * the same set so an action is never available in only one of them */
interface TileActions {
  liked: (tile: ImageTile) => boolean;
  /** this still has an upscale run in flight — badge it, don't queue another */
  upscaling: (tile: ImageTile) => boolean;
  onLike: (tile: ImageTile) => void;
  onOpen: (tile: ImageTile) => void;
  onEdit: (tile: ImageTile) => void;
  onDownload: (tile: ImageTile) => void;
  onDelete: (tile: ImageTile) => void;
  onUpscale: (tile: ImageTile, mode: "fast" | "refine") => void;
}

/** The two upscale rungs, described the way they actually differ — one
 * interpolates, the other invents. Shown wherever Upscale is offered. */
const UPSCALE_MODES = [
  {
    id: "fast" as const,
    label: "Fast · 4×",
    note: "Real-ESRGAN. Seconds, faithful, no new detail.",
  },
  {
    id: "refine" as const,
    label: "Refine · 2K",
    note: "Qwen-Edit + Upscale2K LoRA. Minutes, sharper, invents detail.",
  },
];

/** a deck job in flight — a 40-prompt run is one long render, so it gets a
 * progress card of its own instead of 40 phantom tiles */
function DeckCard({ deck }: { deck: { id: string; name: string; total: number; done: number; progress: number; stage: string; queued: boolean } }) {
  return (
    <div className="rounded-xl border border-gold/35 bg-surface/70 p-3">
      <div className="flex items-center gap-2">
        <Layers size={14} className="shrink-0 text-gold" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-cream">
          {deck.name}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-fog">
          {deck.queued ? `${deck.total} prompts` : `${deck.done} / ${deck.total}`}
        </span>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-gold">
          {Math.round(deck.progress)}%
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-cream/8">
        <div
          className="h-full rounded-full bg-gradient-to-r from-gold-deep to-gold transition-[width] duration-500"
          style={{ width: `${Math.max(2, deck.progress)}%` }}
        />
      </div>
      <p className="mt-1.5 text-2xs text-fog">
        {deck.stage} · finished images appear below as they land
      </p>
    </div>
  );
}

/** A job that died on the engine. The message is almost always actionable
 * ("weights are not installed — Settings → Models → …"), so it belongs in
 * front of whoever pressed Generate, not buried in the Job Center. */
function FailureCard({
  failure,
  onRetry,
  onDismiss,
}: {
  failure: { id: string; title: string; engine: string; error: string };
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/6 p-3">
      <div className="flex items-center gap-2">
        <CircleAlert size={14} className="shrink-0 text-red-400" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-cream">
          {failure.title}
        </span>
        <span className="shrink-0 text-2xs text-fog">{failure.engine}</span>
        <button
          onClick={onRetry}
          className="shrink-0 rounded-lg border border-cream/15 px-2 py-1 text-2xs text-cream/85 transition hover:border-gold/45 hover:text-gold"
        >
          Retry
        </button>
        <button
          onClick={onDismiss}
          title="Dismiss"
          className="shrink-0 text-fog transition hover:text-cream"
        >
          <X size={13} />
        </button>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-red-300">{failure.error}</p>
    </div>
  );
}

function ResultTile({
  tile,
  actions,
  view,
  index,
}: {
  tile: ImageTile;
  actions: TileActions;
  /** masonry keeps the true aspect; grid crops to a uniform contact sheet */
  view: "masonry" | "grid";
  /** position in the roll — drives the entrance stagger */
  index: number;
}) {
  /** the tile's own modal layer: delete needs a confirm, upscale needs a
   * choice, and neither fits in the hover bar */
  const [overlay, setOverlay] = useState<null | "delete" | "upscale">(null);
  const masonry = view === "masonry";
  /** the wave: tiles land one after another instead of all at once. Capped so
   * a 60-image roll doesn't spend two seconds assembling itself. */
  const stagger = { animationDelay: `${Math.min(index, 14) * 26}ms` };

  if (tile.generating)
    return (
      <div
        style={stagger}
        className={cx(
          "anim-rise relative flex aspect-[3/2] items-center justify-center overflow-hidden rounded-panel border border-gold/40",
          masonry && "mb-3 break-inside-avoid",
        )}
      >
        <div className={cx("absolute inset-0", tile.swatch, "opacity-60")} />
        {/* a sweep, not a blink — the pulse read as a broken image */}
        <div className="absolute inset-0 animate-[aurea-sweep_1.8s_var(--ease-out-quart)_infinite] bg-[linear-gradient(105deg,transparent_35%,rgba(201,169,110,0.16)_50%,transparent_65%)]" />
        <div className="relative flex flex-col items-center gap-1.5 px-3 text-center">
          <Sparkles size={18} className="animate-pulse text-gold" />
          <span className="max-w-full truncate text-sm text-cream/90">
            {tile.generating.label ?? (tile.generating.queued ? "Queued" : "Generating…")}
          </span>
          <span className="font-serif text-lg font-semibold tabular-nums text-gold">
            {Math.round(tile.generating.progress)}%
          </span>
          {tile.generating.prompt && (
            <span
              title={tile.generating.prompt}
              className="line-clamp-3 max-w-[90%] text-2xs leading-snug text-cream/60"
            >
              {tile.generating.prompt}
            </span>
          )}
          {tile.generating.label && (
            <span className="text-2xs text-fog">appears at the top of the roll when done</span>
          )}
        </div>
      </div>
    );

  const liked = actions.liked(tile);
  const upscaling = actions.upscaling(tile);

  return (
    <div
      style={stagger}
      className={cx(
        "anim-rise group relative overflow-hidden rounded-panel ring-1 ring-cream/6",
        "transition-[box-shadow,transform,--tw-ring-color] duration-[var(--dur-slow)] ease-[var(--ease-out-quart)]",
        "hover:z-10 hover:-translate-y-0.5 hover:shadow-[0_20px_50px_-12px_rgba(0,0,0,0.75)] hover:ring-gold/45",
        masonry ? "mb-3 break-inside-avoid" : "aspect-[4/3]",
        masonry && !tile.url && "aspect-[3/2]",
      )}
    >
      <div className={cx("absolute inset-0", tile.swatch)} />
      {tile.url ? (
        /* in-flow image at its natural aspect — this is what makes the masonry.
           In grid view it fills a uniform cell instead. */
        <button
          onClick={() => actions.onOpen(tile)}
          title="Open full size"
          /* `relative` is load-bearing: the swatch behind is absolutely
             positioned, so a static button would let the placeholder paint
             OVER the loaded still */
          className={cx("relative block cursor-zoom-in", masonry ? "w-full" : "h-full w-full")}
        >
          <img
            src={tile.url}
            alt={tile.name ?? ""}
            draggable={false}
            className={cx(
              "block transition-transform duration-[900ms] ease-[var(--ease-out-quart)] group-hover:scale-[1.04]",
              masonry ? "h-auto w-full" : "h-full w-full object-cover",
            )}
          />
        </button>
      ) : (
        /* stand-in composition lines until real thumbnails flow through the seam */
        <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_30%,rgba(237,234,228,0.07),transparent_60%)]" />
      )}

      {/* the scrim that makes overlaid chrome legible on a bright still */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-ink/85 via-ink/25 to-transparent opacity-0 transition-opacity duration-[var(--dur-slow)] group-hover:opacity-100" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-ink/70 to-transparent opacity-0 transition-opacity duration-[var(--dur-slow)] group-hover:opacity-100" />

      {upscaling && (
        <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-pill bg-ink/70 px-2.5 py-1 text-2xs font-medium text-gold backdrop-blur">
          <Loader2 size={11} className="animate-spin" /> Upscaling…
        </span>
      )}

      {tile.upscaled && !upscaling && (
        <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-pill bg-ink/70 px-2.5 py-1 text-2xs font-medium text-gold backdrop-blur">
          <Maximize2 size={11} /> Upscaled
        </span>
      )}

      <button
        title={liked ? "Unlike" : "Like"}
        onClick={() => actions.onLike(tile)}
        className={cx(
          "absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-ink/50 backdrop-blur",
          "transition duration-[var(--dur)] ease-[var(--ease-spring)] hover:scale-110",
          liked ? "text-gold" : "text-cream/70 opacity-0 hover:text-cream group-hover:opacity-100",
        )}
      >
        <Heart size={14} fill={liked ? "currentColor" : "none"} />
      </button>

      {overlay === "delete" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-ink/80 backdrop-blur-sm">
          <p className="px-4 text-center text-xs leading-relaxed text-cream/90">
            Delete <span className="text-cream">{tile.name}</span> from disk?
            <br />
            <span className="text-fog">This cannot be undone.</span>
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                setOverlay(null);
                actions.onDelete(tile);
              }}
              className="rounded-lg bg-red-500/85 px-3 py-1.5 text-xs font-semibold text-cream transition hover:bg-red-500"
            >
              Delete
            </button>
            <button
              onClick={() => setOverlay(null)}
              className="rounded-lg border border-cream/15 px-3 py-1.5 text-xs text-cream/85 transition hover:border-cream/30"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {overlay === "upscale" && (
        <div className="absolute inset-0 flex flex-col justify-center gap-1.5 bg-ink/85 p-4 backdrop-blur-sm">
          {UPSCALE_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setOverlay(null);
                actions.onUpscale(tile, m.id);
              }}
              className="rounded-lg border border-cream/12 px-3 py-2 text-left transition hover:border-gold/50 hover:bg-gold/6"
            >
              <div className="text-xs font-semibold text-cream">{m.label}</div>
              <div className="text-2xs leading-snug text-fog">{m.note}</div>
            </button>
          ))}
          <button
            onClick={() => setOverlay(null)}
            className="mt-0.5 text-2xs text-fog transition hover:text-cream"
          >
            Cancel
          </button>
        </div>
      )}

      {overlay === null && (
        <div
          className={cx(
            "pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-1.5 px-3 pb-3",
            "translate-y-1.5 opacity-0 transition duration-[var(--dur-slow)] ease-[var(--ease-out-quart)]",
            "group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100",
          )}
        >
          {tile.name && (
            <span className="max-w-full truncate text-2xs text-cream/90 drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]">
              {tile.name}
            </span>
          )}
          {/* icon-only: five labelled buttons were wider than a masonry column
              and got clipped by the tile's own overflow */}
          <div className="glass flex max-w-full overflow-hidden rounded-pill shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
            {[
              { icon: Expand, label: "Open full size", run: () => actions.onOpen(tile) },
              { icon: Maximize2, label: "Upscale", run: () => setOverlay("upscale") },
              { icon: Pencil, label: "Use as reference", run: () => actions.onEdit(tile) },
              { icon: Download, label: "Download", run: () => actions.onDownload(tile) },
              { icon: Trash2, label: "Delete", run: () => setOverlay("delete"), danger: true },
            ].map(({ icon: Icon, label, run, danger }) => (
              <button
                key={label}
                title={label}
                onClick={run}
                className={cx(
                  "flex h-9 w-9 shrink-0 items-center justify-center text-cream/85",
                  "transition duration-[var(--dur-fast)] hover:bg-cream/10",
                  danger ? "hover:text-red-400" : "hover:text-gold",
                )}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** List view — the roll as a table of stills. Same verbs as the tile bar, laid
 * out for scanning names and dates rather than looking at pictures. */
function ResultRow({
  tile,
  actions,
  index,
}: {
  tile: ImageTile;
  actions: TileActions;
  index: number;
}) {
  const [armed, setArmed] = useState(false);
  const liked = actions.liked(tile);
  const upscaling = actions.upscaling(tile);

  return (
    <div
      style={{ animationDelay: `${Math.min(index, 14) * 18}ms` }}
      className={cx(
        "anim-rise group flex items-center gap-3 rounded-card border border-cream/8 bg-surface/40 p-2",
        "transition duration-[var(--dur)] hover:border-gold/30 hover:bg-surface/70",
      )}
    >
      <button
        onClick={() => actions.onOpen(tile)}
        title="Open full size"
        className="relative h-11 w-16 shrink-0 cursor-zoom-in overflow-hidden rounded-md"
      >
        <span className={cx("absolute inset-0", tile.swatch)} />
        {tile.url && (
          <img src={tile.url} alt="" className="relative h-full w-full object-cover" />
        )}
        {tile.generating && (
          <span className="absolute inset-0 flex items-center justify-center bg-ink/60 text-2xs font-semibold tabular-nums text-gold">
            {Math.round(tile.generating.progress)}%
          </span>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-cream/90">
          {tile.name ?? tile.generating?.label ?? tile.generating?.prompt ?? "Rendering…"}
        </div>
        <div className="flex items-center gap-2 text-2xs text-fog">
          <span>{tile.day ? dayLabel(tile.day) : "in flight"}</span>
          {tile.upscaled && !upscaling && <span className="text-gold/80">· upscaled</span>}
          {upscaling && <span className="text-gold/80">· upscaling…</span>}
        </div>
      </div>

      {!tile.generating && (
        <div className="flex shrink-0 items-center gap-0.5 text-fog">
          {[
            {
              icon: Heart,
              label: liked ? "Unlike" : "Like",
              run: () => actions.onLike(tile),
              on: liked,
            },
            { icon: Pencil, label: "Edit", run: () => actions.onEdit(tile) },
            { icon: Download, label: "Download", run: () => actions.onDownload(tile) },
          ].map(({ icon: Icon, label, run, on }) => (
            <button
              key={label}
              title={label}
              onClick={run}
              className={cx(
                "rounded-md p-1.5 transition duration-[var(--dur-fast)] hover:bg-cream/8 hover:text-gold",
                on && "text-gold",
              )}
            >
              <Icon size={13} fill={on ? "currentColor" : "none"} />
            </button>
          ))}
          <button
            title={armed ? "Click again to delete" : "Delete"}
            onClick={() => {
              if (!armed) {
                setArmed(true);
                return;
              }
              setArmed(false);
              actions.onDelete(tile);
            }}
            onBlur={() => setArmed(false)}
            className={cx(
              "rounded-md p-1.5 transition duration-[var(--dur-fast)] hover:bg-cream/8 hover:text-red-400",
              armed && "bg-red-500/15 text-red-400",
            )}
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- lightbox ---------- */

/** Full-view overlay: the whole image uncropped, arrow-key paging through the
 * roll, and the same action set as the tile bar. */
function Lightbox({
  tiles,
  index,
  setIndex,
  onClose,
  actions,
}: {
  tiles: ImageTile[];
  index: number;
  setIndex: (i: number) => void;
  onClose: () => void;
  actions: TileActions;
}) {
  const tile = tiles[index];
  /** delete is two-click here — there is no room for the tile's confirm panel */
  const [armed, setArmed] = useState(false);
  const [upscaleOpen, setUpscaleOpen] = useState(false);
  const step = useCallback(
    (dir: -1 | 1) => {
      setArmed(false);
      setUpscaleOpen(false);
      setIndex((index + dir + tiles.length) % tiles.length);
    },
    [index, tiles.length, setIndex],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, onClose]);

  if (!tile) return null;
  const liked = actions.liked(tile);

  return (
    /* Under Electron the overlay starts BELOW the 36px frameless title strip.
       Full-bleed put our Close pill directly under the OS window buttons,
       where it was invisible and unclickable — and it swallowed the drag
       region while open. */
    <div
      className={cx(
        "fixed inset-x-0 bottom-0 z-[var(--z-modal)] flex flex-col bg-ink/92 backdrop-blur-sm",
        window.aurea?.isElectron ? "top-9" : "top-0",
      )}
      onClick={onClose}
    >
      <header className="flex shrink-0 items-center gap-3 px-5 py-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title="Close (Esc)"
          className={cx(
            "flex h-9 shrink-0 items-center gap-1.5 rounded-pill border border-cream/15 bg-raised px-3.5",
            "text-xs font-medium text-cream/90 shadow-[0_6px_20px_rgba(0,0,0,0.5)]",
            "transition duration-[var(--dur)] hover:border-gold/50 hover:text-gold",
          )}
        >
          <X size={15} />
          Close
        </button>
        <span className="min-w-0 truncate text-sm text-cream/90">{tile.name}</span>
        <span className="shrink-0 text-xs tabular-nums text-fog">
          {index + 1} / {tiles.length}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 items-center gap-2 px-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            step(-1);
          }}
          title="Previous (←)"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cream/6 text-cream/80 transition hover:bg-cream/12 hover:text-gold"
        >
          <ChevronLeft size={18} />
        </button>
        {/* the img sizes to its own picture (max-w/max-h, no flex-1) so the
            radius hugs the image instead of a letterboxed element box */}
        {/* self-stretch, not the row's items-center default: an auto-height
            wrapper gives `max-h-full` nothing to resolve against and the
            picture spills past the header and action bar */}
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center self-stretch">
          {tile.url && (
            <img
              src={tile.url}
              alt={tile.name ?? ""}
              onClick={(e) => e.stopPropagation()}
              className="max-h-full max-w-full cursor-default rounded-panel object-contain shadow-[0_30px_80px_rgba(0,0,0,0.6)]"
            />
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            step(1);
          }}
          title="Next (→)"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cream/6 text-cream/80 transition hover:bg-cream/12 hover:text-gold"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <footer
        className="flex shrink-0 flex-col items-center gap-2 py-4"
        onClick={(e) => e.stopPropagation()}
      >
        {upscaleOpen && (
          <div className="glass flex gap-1 rounded-xl p-1">
            {UPSCALE_MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setUpscaleOpen(false);
                  actions.onUpscale(tile, m.id);
                }}
                className="max-w-[220px] rounded-lg px-3 py-1.5 text-left transition hover:bg-cream/8"
              >
                <div className="text-xs font-semibold text-cream">{m.label}</div>
                <div className="text-2xs leading-snug text-fog">{m.note}</div>
              </button>
            ))}
          </div>
        )}
        <div className="glass flex overflow-hidden rounded-xl">
          {[
            {
              icon: Heart,
              label: liked ? "Liked" : "Like",
              run: () => actions.onLike(tile),
              on: liked,
            },
            {
              icon: Maximize2,
              label: actions.upscaling(tile) ? "Upscaling…" : "Upscale",
              run: () => setUpscaleOpen((o) => !o),
              on: upscaleOpen || actions.upscaling(tile),
            },
            {
              icon: Pencil,
              label: "Edit",
              run: () => {
                actions.onEdit(tile);
                onClose();
              },
            },
            { icon: Download, label: "Download", run: () => actions.onDownload(tile) },
            {
              icon: Trash2,
              label: armed ? "Sure? Delete" : "Delete",
              run: () => {
                if (!armed) {
                  setArmed(true);
                  return;
                }
                setArmed(false);
                actions.onDelete(tile);
                // the roll shrinks under us — step back so the view stays valid
                if (tiles.length <= 1) onClose();
                else setIndex(Math.min(index, tiles.length - 2));
              },
              danger: true,
              on: armed,
            },
          ].map(({ icon: Icon, label, run, danger, on }) => (
            <button
              key={label}
              onClick={run}
              className={cx(
                "flex flex-col items-center gap-1 px-5 py-2.5 text-2xs transition hover:bg-cream/8",
                danger
                  ? cx(on ? "text-red-400" : "text-cream/85", "hover:text-red-400")
                  : cx(on ? "text-gold" : "text-cream/85", "hover:text-gold"),
              )}
            >
              <Icon size={15} fill={on && !danger ? "currentColor" : "none"} />
              {label}
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
}

/* ---------- history drawer ---------- */

function HistoryRow({ entry, active, onToggle }: {
  entry: ImageHistoryEntry;
  active: boolean;
  onToggle: () => void;
}) {
  const lab = useImageLab();
  const [menu, setMenu] = useState(false);
  /** deleting a whole day is two clicks — the row is small and the act is final */
  const [armed, setArmed] = useState(false);
  const rels = entry.relPaths ?? [];

  const onMenuOpenChange = (open: boolean) => {
    setMenu(open);
    if (!open) setArmed(false);
  };

  return (
    <div
      className={cx(
        "relative rounded-xl border transition",
        active
          ? "border-gold/50 bg-surface"
          : "border-transparent bg-surface/60 hover:border-cream/15",
      )}
    >
      <button
        onClick={onToggle}
        title={active ? "Show the whole roll again" : `Show only ${dayLabel(entry.id)}`}
        className="flex w-full items-center gap-2.5 p-2 text-left"
      >
        <div className="flex gap-1">
          {entry.swatches.map((sw, i) =>
            entry.urls?.[i] ? (
              <img key={i} src={entry.urls[i]} alt="" className="h-10 w-10 rounded-md object-cover" />
            ) : (
              <span key={i} className={cx("h-10 w-10 rounded-md", sw)} />
            ),
          )}
        </div>
        {/* pr-5 keeps the text clear of the absolutely-placed kebab above it */}
        <div className="min-w-0 flex-1 pr-5">
          <div className="truncate text-xs text-cream/85">{dayLabel(entry.id)}</div>
          <div className="truncate text-2xs text-fog">
            {entry.count} image{entry.count === 1 ? "" : "s"} · {entry.when}
          </div>
          {active && (
            <Chip tone="gold" className="mt-1">
              Filtering
            </Chip>
          )}
        </div>
      </button>

      <DropdownMenu open={menu} onOpenChange={onMenuOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            title="Actions for this day"
            className="absolute right-1.5 top-2 p-1 text-fog transition hover:text-gold"
          >
            <MoreHorizontal size={14} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[188px] min-w-0">
          <DropdownMenuItem onSelect={onToggle} className="text-xs">
            {active ? "Clear day filter" : "Show only this day"}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant={armed ? "danger" : "default"}
            onSelect={(e) => {
              // first click arms; keep the menu open for the confirm
              if (!armed) {
                e.preventDefault();
                setArmed(true);
                return;
              }
              if (rels.length) void lab.remove(rels);
            }}
            disabled={!rels.length || lab.removing}
            className="text-xs"
          >
            {armed ? `Sure? Delete ${rels.length}` : `Delete all ${rels.length}`}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** history days shown before "View all" opens the rest — the drawer is a
 * shortcut into the roll, not a second copy of it */
const HISTORY_DAYS = 8;

function HistoryList({ dayFilter, setDayFilter }: {
  dayFilter: string | null;
  setDayFilter: (day: string | null) => void;
}) {
  const lab = useImageLab();
  const [all, setAll] = useState(false);
  const shown = all ? lab.history : lab.history.slice(0, HISTORY_DAYS);
  return (
    <div className="space-y-1.5 p-3">
      <p className="px-1 pb-1 text-2xs leading-relaxed text-fog">
        Click a day to show only its stills.
      </p>
      {shown.length === 0 ? (
        <p className="px-1 text-xs leading-relaxed text-fog">
          No stills yet — finished renders group here by day.
        </p>
      ) : (
        shown.map((h) => (
          <HistoryRow
            key={h.id}
            entry={h}
            active={dayFilter === h.id}
            onToggle={() => setDayFilter(dayFilter === h.id ? null : h.id)}
          />
        ))
      )}
      {lab.history.length > HISTORY_DAYS && (
        <button
          onClick={() => setAll((v) => !v)}
          className="w-full py-1.5 text-xs text-gold hover:underline"
        >
          {all ? "Show less" : `View all ${lab.history.length} days`}
        </button>
      )}
    </div>
  );
}

/* ---------- status bar ---------- */

function LabStatusBar() {
  const lab = useImageLab();
  // GPU and VRAM live in the top bar's queue pill (UI-SIMPLIFY Stage 4); this strip
  // keeps only what is about this lab's render
  const [copied, setCopied] = useState(false);

  return (
    <StatusBar
      left={
        <>
          <span className="flex items-center gap-1.5">
            <i className="h-1.5 w-1.5 rounded-full bg-sage shadow-[0_0_6px_1px_rgba(111,160,124,0.6)]" />
            <span className="text-cream/80">{lab.models[0].label}</span>
            <span className="text-sage">Ready</span>
          </span>
          <span className="tabular-nums">{lab.resolution}</span>
          <span className="tabular-nums">
            {lab.batch.length} image{lab.batch.length === 1 ? "" : "s"}
          </span>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(String(lab.seed));
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            }}
            title="Copy the seed"
            className="flex items-center gap-1 tabular-nums transition hover:text-gold"
          >
            Seed: {lab.seed}
            {copied ? <Check size={11} className="text-sage" /> : <Copy size={11} />}
          </button>
        </>
      }
    />
  );
}

/* ---------- screen ---------- */

/** The roll's layout is muscle memory — it survives the screen. (railOpen
 * and libraryDocked from before Stage 3 are ignored: the drawer has its own
 * persisted state now.) */
const PREF_KEY = "aurea:imagelab:prefs";
interface LabPrefs {
  view: RollView;
}
const PREF_DEFAULTS: LabPrefs = { view: "masonry" };

function loadPrefs(): LabPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}");
    const view = raw && typeof raw === "object" ? (raw as Partial<LabPrefs>).view : undefined;
    return { view: view ?? PREF_DEFAULTS.view };
  } catch {
    return PREF_DEFAULTS;
  }
}

const DRAWERS = ["advanced", "library", "history"] as const;

export function ImageLab() {
  const lab = useImageLab();
  const likes = useLikes();
  /** the prompt is shared by the composer and the library drawer */
  const ps = usePromptState("image", lab.prompt);
  // what you are composing is a draft: it survives leaving the lab while a
  // render runs, so you can queue, wander off, and come back to the same sheet
  const [mode, setMode] = useDraft<LabMode>("image:mode", "generate");
  const [refs, setRefs] = useDraft<RefImage[]>("image:refs", []);
  /** which edit model is selected. It lives here because the composer picks
   * it but a tile's Edit action also enforces its reference ceiling. */
  const [editorId, setEditorId] = useDraft("image:editor", "qwen-edit");
  const refsMax = lab.refsMaxByModel[editorId] ?? lab.refsMax;
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  /** a day picked in the history drawer — the roll narrows to it until cleared */
  const [dayFilter, setDayFilter] = useState<string | null>(null);
  const [visible, setVisible] = useState(ROLL_PAGE);

  /* ---- the roll's own chrome: scope, search, layout (all sticky) ---- */
  const [prefs, setPrefs] = useState<LabPrefs>(loadPrefs);
  const setPref = <K extends keyof LabPrefs>(key: K, value: LabPrefs[K]) =>
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      localStorage.setItem(PREF_KEY, JSON.stringify(next));
      return next;
    });
  const { drawer, setDrawer, toggle: toggleDrawer } = useLabDrawer("image", DRAWERS);
  const [scope, setScope] = useState<RollScope>("all");
  const [scopeOpen, setScopeOpen] = useState(false);
  const [search, setSearch] = useState("");
  /** the full library modal — managing presets, not composing with them */
  const [libraryOpen, setLibraryOpen] = useState(false);
  /** the canvas scroller — "New generation" returns you to the top of the roll */
  const canvasRef = useRef<HTMLElement>(null);

  const q = search.trim().toLowerCase();
  const filtering = !!dayFilter || scope !== "all" || !!q;

  // Work in flight is never filtered out — pressing Generate with a past day
  // pinned (or a search typed) otherwise looks like nothing happened.
  const roll = lab.batch.filter((t) => {
    if (t.generating) return true;
    if (dayFilter && t.day !== dayFilter) return false;
    if (scope === "favorites" && !likes.isLiked(t.relPath)) return false;
    if (scope === "upscaled" && !t.upscaled) return false;
    if (q && !(t.name ?? "").toLowerCase().includes(q)) return false;
    return true;
  });

  // a narrower roll must start from the top again, or "show older" state from
  // the full roll leaves a filtered day looking longer than it is
  useEffect(() => setVisible(ROLL_PAGE), [dayFilter, scope, q]);

  // dropping from the cloud model's 16 refs back to qwen-edit's 3 has to trim
  // the list here — otherwise the extras stay on screen and the run dies in
  // the adapter with a limit the panel was still showing as fine
  useEffect(() => {
    setRefs((prev) => (prev.length > refsMax ? prev.slice(0, refsMax) : prev));
  }, [refsMax]);

  const p = useImageParams({ mode, refs, editorId, setEditorId, refsMax, ps });

  /** only finished stills are openable/actionable — generating tiles have no file */
  const openable = roll.filter((t) => t.url && t.relPath);

  const actions: TileActions = {
    liked: (t) => likes.isLiked(t.relPath),
    upscaling: (t) => !!t.relPath && lab.upscaling.includes(t.relPath),
    onLike: (t) => likes.toggleLike(t.relPath),
    onOpen: (t) => {
      const i = openable.findIndex((o) => o.id === t.id);
      if (i >= 0) setLightbox(i);
    },
    onEdit: (t) => {
      if (!t.relPath || !t.url) return;
      setMode("edit");
      setRefs((prev) =>
        prev.some((r) => r.rel === t.relPath) || prev.length >= refsMax
          ? prev
          : [...prev, { rel: t.relPath!, url: t.url!, name: t.name ?? "reference" }],
      );
    },
    onDownload: (t) => {
      if (t.url) void downloadAsset(t.url, t.name ?? "image.png");
    },
    onDelete: (t) => {
      if (!t.relPath) return;
      // a deleted asset must not linger as a stale reference
      setRefs((prev) => prev.filter((r) => r.rel !== t.relPath));
      void lab.remove(t.relPath);
    },
    onUpscale: (t, mode) => {
      if (t.relPath) lab.upscale(t.relPath, mode);
    },
  };

  const finished = roll.filter((t) => !t.generating).length;
  const rendering = roll.length - finished;
  const subtitle =
    `${finished} generation${finished === 1 ? "" : "s"}` +
    (rendering ? ` · ${rendering} rendering` : "") +
    (filtering ? " · filtered" : "");

  const clearFilters = () => {
    setDayFilter(null);
    setScope("all");
    setSearch("");
  };

  return (
    <div className="flex h-full flex-col">
      <LabHeader
        scope={scope}
        setScope={setScope}
        scopeOpen={scopeOpen}
        setScopeOpen={setScopeOpen}
        search={search}
        setSearch={setSearch}
        view={prefs.view}
        setView={(v) => setPref("view", v)}
        historyOpen={drawer === "history"}
        onToggleHistory={() => toggleDrawer("history")}
        subtitle={subtitle}
        onNewGeneration={() => {
          // a fresh sheet: empty composer, unfiltered roll, back at the top
          ps.clear();
          setMode("generate");
          clearFilters();
          canvasRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
        <section ref={canvasRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {lab.failures
            .filter((f) => !dismissed.includes(f.id))
            .map((f) => (
              <FailureCard
                key={f.id}
                failure={f}
                onRetry={() => lab.retry(f.id)}
                onDismiss={() => setDismissed((prev) => [...prev, f.id])}
              />
            ))}

          {lab.decks.map((deck) => (
            <DeckCard key={deck.id} deck={deck} />
          ))}

          {/* what is currently narrowing the roll, and one click off each */}
          {filtering && roll.length > 0 && (
            <div className="anim-fade flex flex-wrap items-center gap-1.5">
              {dayFilter && (
                <Chip tone="gold" onClick={() => setDayFilter(null)} title="Clear the day filter">
                  {dayLabel(dayFilter)} <X size={10} />
                </Chip>
              )}
              {scope !== "all" && (
                <Chip tone="gold" onClick={() => setScope("all")} title="Clear the scope filter">
                  {scope === "favorites" ? "Favorites" : "Upscaled"} <X size={10} />
                </Chip>
              )}
              {q && (
                <Chip tone="gold" onClick={() => setSearch("")} title="Clear the search">
                  “{search.trim()}” <X size={10} />
                </Chip>
              )}
              <button
                onClick={clearFilters}
                className="text-2xs text-fog transition hover:text-gold"
              >
                Clear all
              </button>
            </div>
          )}

          {roll.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2.5 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full border border-gold/25 bg-gold/6">
                <Sparkles size={22} className="text-gold/70" />
              </span>
              <p className="font-serif text-lg text-cream/90">
                {filtering ? "Nothing matches" : "Nothing rendered yet"}
              </p>
              <p className="max-w-[300px] text-xs leading-relaxed text-fog">
                {filtering
                  ? "No still on the roll matches those filters — widen them, or clear them to see everything."
                  : "Describe an image below and hit Generate — every take lands here and in the asset library."}
              </p>
              {filtering && (
                <button
                  onClick={clearFilters}
                  className="mt-1 rounded-pill border border-cream/12 px-3 py-1.5 text-xs text-cream/80 transition hover:border-gold/50 hover:text-gold"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <>
              {groupByDay(roll.slice(0, visible)).map((section, si) => (
                <div key={section.day} className="first:-mt-2">
                  {/* the roll used to run together as one undated wall — the
                      separator is what makes "a day's work" legible, so it
                      gets real weight, a rule, and air above it */}
                  <div className="sticky top-0 z-20 -mx-4 mb-3 mt-5 bg-ink/85 px-4 pb-2 pt-2 backdrop-blur-md">
                    <div className="flex items-center gap-2.5 border-b border-cream/12 pb-2">
                      <span className="h-3.5 w-[3px] shrink-0 rounded-full bg-gold/70 shadow-[0_0_8px_rgba(201,169,110,0.5)]" />
                      <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-cream">
                        {dayLabel(section.day)}
                      </h3>
                      <span className="rounded-pill bg-cream/8 px-2 py-0.5 text-2xs font-semibold tabular-nums text-fog">
                        {section.tiles.length}
                      </span>
                    </div>
                  </div>
                  {prefs.view === "list" ? (
                    <div className="space-y-1.5">
                      {section.tiles.map((tile, i) => (
                        <ResultRow key={tile.id} tile={tile} actions={actions} index={i} />
                      ))}
                    </div>
                  ) : (
                    <div
                      className={
                        prefs.view === "masonry"
                          ? /* tiles keep their real aspect and pack tight */
                            "columns-2 gap-3 lg:columns-3 2xl:columns-4"
                          : /* contact sheet — uniform cells, easier to scan */
                            "grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-4"
                      }
                    >
                      {section.tiles.map((tile, i) => (
                        <ResultTile
                          key={tile.id}
                          tile={tile}
                          actions={actions}
                          view={prefs.view === "grid" ? "grid" : "masonry"}
                          // only the first screenful earns the entrance wave
                          index={si === 0 ? i : 99}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {visible < roll.length && (
                <button
                  onClick={() => setVisible((v) => v + ROLL_PAGE)}
                  className="mx-auto rounded-pill border border-cream/12 px-4 py-2 text-xs text-cream/80 transition hover:border-gold/50 hover:text-gold"
                >
                  Show older — {roll.length - visible} more
                </button>
              )}
            </>
          )}
        </section>

        <ImageComposer
          p={p}
          setMode={setMode}
          setRefs={setRefs}
          drawer={drawer}
          toggleDrawer={toggleDrawer}
        />
        </div>

        {drawer === "advanced" && <ImageAdvanced p={p} onClose={() => setDrawer(null)} />}
        {drawer === "library" && (
          <LabDrawer title="Prompt library" summary="click to append" onClose={() => setDrawer(null)} width={300}>
            <PromptLibraryRail onPick={ps.pickPreset} onManage={() => setLibraryOpen(true)} />
          </LabDrawer>
        )}
        {drawer === "history" && (
          <LabDrawer
            title="History"
            summary={dayFilter ? `showing ${dayLabel(dayFilter)}` : `${lab.history.length} days`}
            onClose={() => setDrawer(null)}
            width={316}
          >
            <HistoryList dayFilter={dayFilter} setDayFilter={setDayFilter} />
          </LabDrawer>
        )}
      </div>
      <LabStatusBar />

      <PromptLibraryPanel
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        prompt={ps.prompt}
        onPick={ps.pickPreset}
      />

      {lightbox !== null && openable.length > 0 && (
        <Lightbox
          tiles={openable}
          index={Math.min(lightbox, Math.max(0, openable.length - 1))}
          setIndex={setLightbox}
          onClose={() => setLightbox(null)}
          actions={actions}
        />
      )}
    </div>
  );
}
