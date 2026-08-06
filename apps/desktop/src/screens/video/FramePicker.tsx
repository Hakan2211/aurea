import { useEffect, useRef, useState } from "react";
import {
  Check,
  CornerDownLeft,
  Grid2x2,
  Grid3x3,
  ImageOff,
  Maximize2,
  Search,
  X,
} from "lucide-react";
import { GoldButton, cx } from "@/components/ui";
import type { PickerFrame } from "./shared";

/** Tile widths, in the order the size control steps through them. Even the
 * tightest rung is wider than the old fixed 3-column grid: the picker exists so
 * you can SEE a frame before committing a four-minute render to it. */
const TILE_SIZES = [
  { id: "m", label: "Medium tiles", min: 210, icon: Grid3x3 },
  { id: "l", label: "Large tiles", min: 300, icon: Grid2x2 },
  { id: "xl", label: "Huge tiles", min: 440, icon: Maximize2 },
] as const;
type TileSize = (typeof TILE_SIZES)[number];

const TILE_SIZE_KEY = "aurea.videoLab.frameTileSize";

function storedTileSize(): TileSize {
  try {
    const id = localStorage.getItem(TILE_SIZE_KEY);
    return TILE_SIZES.find((s) => s.id === id) ?? TILE_SIZES[1];
  } catch {
    return TILE_SIZES[1];
  }
}

/** Full-bleed still picker: a resizable grid on the left, the frame under the
 * cursor rendered large and uncropped on the right. Hover or arrow-key onto a
 * tile to inspect it, click or Enter to take it. */
export function FramePicker({
  frames,
  mode,
  selectedRel,
  onPick,
  onClose,
}: {
  frames: PickerFrame[];
  /** one picker, three jobs — the copy has to say which frame it's choosing */
  mode: "start" | "end" | "keyframe";
  selectedRel?: string;
  onPick: (relPath: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [size, setSize] = useState<TileSize>(storedTileSize);
  /** the tile the pointer is over — it wins over the keyboard cursor while the
   * mouse is inside the grid, so the preview always shows what you're aiming at */
  const [hover, setHover] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const q = query.trim().toLowerCase();
  const shown = q ? frames.filter((f) => f.name.toLowerCase().includes(q)) : frames;

  // open on whatever is already chosen, so the first thing you see is the frame
  // you'd be replacing
  const [cursor, setCursor] = useState(() => {
    const i = frames.findIndex((f) => f.relPath === selectedRel);
    return i > 0 ? i : 0;
  });
  const at = Math.min(cursor, Math.max(0, shown.length - 1));
  const preview = shown[hover ?? at];

  /* A new filter re-numbers the roll, so the cursor goes back to the top — but
   * not on mount, where it is deliberately parked on the current frame. */
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setCursor(0);
  }, [q]);

  const chooseSize = (s: TileSize) => {
    setSize(s);
    try {
      localStorage.setItem(TILE_SIZE_KEY, s.id);
    } catch {
      /* private mode — the preference just doesn't persist */
    }
  };

  /* A row is however many tiles the auto-fill grid actually laid out, which
   * only the resolved style knows — the column count changes with both the
   * size rung and the window. */
  const columns = () => {
    const el = gridRef.current;
    if (!el) return 1;
    return getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Enter") {
        const f = shown[Math.min(cursor, Math.max(0, shown.length - 1))];
        if (f) {
          e.preventDefault();
          onPick(f.relPath);
        }
        return;
      }
      const step =
        e.key === "ArrowRight" ? 1
        : e.key === "ArrowLeft" ? -1
        : e.key === "ArrowDown" ? columns()
        : e.key === "ArrowUp" ? -columns()
        : 0;
      if (step) {
        // inside the search box the caret owns left/right; up/down still browse
        if (typing && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
        e.preventDefault();
        setHover(null);
        setCursor((c) => {
          const from = Math.min(c, Math.max(0, shown.length - 1));
          return Math.max(0, Math.min(shown.length - 1, from + step));
        });
        return;
      }
      // type-to-filter: a printable key jumps into the search box mid-keystroke
      if (!typing && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setQuery((v) => v + e.key);
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, cursor, onClose, onPick]);

  // keep the keyboard cursor on screen as it walks the roll
  useEffect(() => {
    if (hover === null) tileRefs.current[at]?.scrollIntoView({ block: "nearest" });
  }, [at, hover, size]);

  const title =
    mode === "start"
      ? "Choose a start frame"
      : mode === "end"
        ? "Choose a frame to land on"
        : "Choose a keyframe still";
  const cta =
    mode === "start"
      ? "Use as start frame"
      : mode === "end"
        ? "Use as end frame"
        : "Use as keyframe";

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-ink/85 p-6 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[min(92vh,1000px)] w-[min(1520px,96vw)] flex-col overflow-hidden rounded-3xl border border-cream/10 bg-raised shadow-2xl"
      >
        <header className="flex shrink-0 items-center gap-4 border-b hairline px-5 py-3.5">
          <div className="min-w-0">
            <h3 className="font-serif text-lg font-semibold leading-tight text-cream">
              {title}
            </h3>
            <p className="mt-0.5 text-xs text-fog">
              {q ? `${shown.length} of ${frames.length}` : `${frames.length}`} stills · newest first
              · generate more in the Image lab
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fog" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by name…"
                className="w-52 rounded-full border border-cream/10 bg-surface py-1.5 pl-7 pr-7 text-xs text-cream placeholder:text-fog/70 focus:border-gold/40 focus:outline-none"
              />
              {query && (
                <button
                  onClick={() => {
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-fog/70 transition hover:text-cream"
                >
                  <X size={11} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-0.5 rounded-full border border-cream/10 bg-surface p-0.5">
              {TILE_SIZES.map((s) => (
                <button
                  key={s.id}
                  title={s.label}
                  onClick={() => chooseSize(s)}
                  className={cx(
                    "rounded-full p-1.5 transition",
                    s.id === size.id
                      ? "bg-gold/18 text-gold"
                      : "text-fog hover:bg-cream/5 hover:text-cream",
                  )}
                >
                  <s.icon size={13} />
                </button>
              ))}
            </div>

            <button
              onClick={onClose}
              title="Close (Esc)"
              className="rounded-full p-1.5 text-fog/70 transition hover:bg-cream/5 hover:text-cream"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <div
            ref={gridRef}
            onMouseLeave={() => setHover(null)}
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size.min}px, 1fr))` }}
            className="grid min-h-0 flex-1 auto-rows-min content-start gap-3 overflow-y-auto p-5"
          >
            {shown.map((f, i) => {
              const chosen = f.relPath === selectedRel;
              const lit = hover === null ? i === at : i === hover;
              return (
                <button
                  key={f.relPath}
                  ref={(el) => {
                    tileRefs.current[i] = el;
                  }}
                  onMouseEnter={() => setHover(i)}
                  onClick={() => onPick(f.relPath)}
                  className={cx(
                    "group relative aspect-video overflow-hidden rounded-xl border text-left transition duration-200 focus:outline-none",
                    chosen
                      ? "border-gold/70 ring-2 ring-gold/35"
                      : lit
                        ? "border-cream/40 ring-2 ring-cream/15"
                        : "border-cream/8",
                  )}
                >
                  <div className={cx("absolute inset-0", f.swatch)} />
                  {f.url && (
                    <img
                      src={f.url}
                      alt=""
                      draggable={false}
                      loading="lazy"
                      className={cx(
                        "absolute inset-0 h-full w-full object-cover transition duration-500",
                        lit && "scale-[1.03]",
                      )}
                    />
                  )}
                  {chosen && (
                    <span className="absolute right-2 top-2 rounded-full bg-gold p-1 text-ink shadow-lg">
                      <Check size={11} strokeWidth={3} />
                    </span>
                  )}
                  <div
                    className={cx(
                      "absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/90 via-ink/45 to-transparent px-3 pb-2 pt-8 transition",
                      lit ? "opacity-100" : "opacity-0",
                    )}
                  >
                    <div className="truncate text-xs text-cream/95">{f.name}</div>
                    <div className="truncate text-2xs text-fog">{f.meta}</div>
                  </div>
                </button>
              );
            })}

            {shown.length === 0 && (
              <p className="col-span-full py-16 text-center text-sm text-fog">
                {frames.length === 0
                  ? "No stills in the library yet — generate one in the Image lab."
                  : `Nothing matches “${query.trim()}”.`}
              </p>
            )}
          </div>

          {/* the whole point: the frame under the cursor, big and uncropped */}
          <aside className="hidden w-[min(46%,640px)] min-w-[380px] shrink-0 flex-col border-l hairline bg-[#0e0e10] p-5 xl:flex">
            {preview ? (
              <>
                {/* takes every pixel the rail's chrome doesn't need — a start
                  * frame decides the whole render, so it earns the space */}
                <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl border border-cream/8 bg-ink">
                  <div className={cx("absolute inset-0 opacity-40 blur-2xl", preview.swatch)} />
                  {preview.url ? (
                    <img
                      src={preview.url}
                      alt=""
                      draggable={false}
                      className="relative h-full w-full object-contain"
                    />
                  ) : (
                    <ImageOff size={22} className="relative text-fog/60" />
                  )}
                </div>
                <h4 className="mt-4 break-words text-sm leading-snug text-cream/95">
                  {preview.name}
                </h4>
                <p className="mt-1 text-xs text-fog">{preview.meta}</p>
                {preview.relPath === selectedRel && (
                  <p className="mt-2 inline-flex items-center gap-1 self-start rounded-full bg-gold/15 px-2 py-0.5 text-2xs font-medium text-gold">
                    <Check size={10} /> Currently chosen
                  </p>
                )}

                <GoldButton
                  onClick={() => onPick(preview.relPath)}
                  className="mt-4 w-full shrink-0 justify-center py-2.5 text-sm uppercase tracking-widest"
                >
                  {cta}
                </GoldButton>
                <p className="mt-2 shrink-0 text-center text-2xs leading-relaxed text-fog/70">
                  Arrow keys browse · <CornerDownLeft size={9} className="inline" /> chooses · type
                  to filter · Esc closes
                </p>
              </>
            ) : (
              <p className="m-auto text-center text-xs text-fog">Nothing to preview.</p>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
