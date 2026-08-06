/* The shot rail — every take the project has made, grouped by kind. Click a
 * card and it lands at the end of its lane.
 *
 * Deliberately ONE list, not "footage" beside "used in the cut": the same file
 * living in two panels means searching twice and neither panel being the truth.
 * Being in the sequence is state on the card (check + count) and a filter, so
 * "what haven't I cut yet?" is one click and the list never forks. */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  FileAudio,
  FileImage,
  FileMusic,
  FileVideo,
  LayoutGrid,
  List,
  Plus,
  Search,
} from "lucide-react";
import { cx } from "@/components/ui";
import { mediaDuration, poster } from "./frames";
import { fmtDur } from "./shared";

export type PoolItem = { relPath: string; name: string; kind: string; url?: string };

const kindIcon = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  music: FileMusic,
} as const;

/** split by media kind so voices/music don't bury the takes */
const GROUPS: Array<{ label: string; kind: keyof typeof kindIcon }> = [
  { label: "Video takes", kind: "video" },
  { label: "Images", kind: "image" },
  { label: "Voices", kind: "audio" },
  { label: "Music", kind: "music" },
];

const FILTERS = [
  { id: "all", label: "All" },
  { id: "unused", label: "Unused" },
  { id: "used", label: "In cut" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

const RAIL_MIN = 220;
const RAIL_MAX = 520;

/** smallest tile a kind is allowed — video takes read as pictures, the rest
 * are really just labelled rows, so they may pack tighter */
const MIN_TILE: Record<string, number> = { video: 148, image: 118, audio: 110, music: 110 };

/** how many cards fit across the rail's content box at this width */
function columns(railWidth: number, kind: string): number {
  const inner = railWidth - 24; // px-3 either side
  return Math.max(1, Math.floor((inner + 8) / ((MIN_TILE[kind] ?? 118) + 8)));
}
const WIDTH_KEY = "aurea.timeline.railWidth";
const VIEW_KEY = "aurea.timeline.railView";

/* Durations come off the media itself — a <video>/<audio> with preload
 * "metadata" reports one for free, so nothing extra is fetched and the answer
 * is cached for the session. */
const durCache = new Map<string, number>();

export function MediaRail({
  pool,
  usedCounts,
  onAdd,
}: {
  pool: PoolItem[];
  /** relPath → how many clips in the sequence point at it */
  usedCounts: Record<string, number>;
  onAdd: (item: PoolItem) => void;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<"grid" | "list">(
    () => (localStorage.getItem(VIEW_KEY) as "grid" | "list") || "grid",
  );
  const [width, setWidth] = useState(() => Number(localStorage.getItem(WIDTH_KEY)) || 340);
  useEffect(() => localStorage.setItem(VIEW_KEY, view), [view]);
  useEffect(() => localStorage.setItem(WIDTH_KEY, String(width)), [width]);

  const needle = q.trim().toLowerCase();
  const matches = useMemo(
    () =>
      pool.filter((a) => {
        if (needle && !a.name.toLowerCase().includes(needle)) return false;
        const used = (usedCounts[a.relPath] ?? 0) > 0;
        return filter === "all" || (filter === "used" ? used : !used);
      }),
    [pool, needle, filter, usedCounts],
  );
  const inCut = pool.filter((a) => usedCounts[a.relPath]).length;

  const onResize = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const w0 = width;
    const move = (ev: PointerEvent) =>
      setWidth(Math.max(RAIL_MIN, Math.min(RAIL_MAX, w0 + (ev.clientX - x0))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <aside
      style={{ width }}
      className="relative flex shrink-0 flex-col border-r hairline bg-[#0e0e10]"
    >
      <div className="px-4 pb-3 pt-4">
        <div className="flex items-baseline gap-2">
          <h2 className="font-serif text-[15px] font-semibold leading-none text-cream">
            Shots &amp; takes
          </h2>
          <span className="ml-auto text-[10px] tabular-nums text-fog/70">
            {inCut}/{pool.length} in cut
          </span>
        </div>

        <div className="relative mt-3">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fog/60" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter takes"
            className="w-full rounded-lg border border-cream/8 bg-surface py-1.5 pl-7 pr-2 text-[11px] text-cream/90 placeholder:text-fog/60 transition focus:border-gold/40 focus:outline-none focus:ring-2 focus:ring-gold/15"
          />
        </div>

        <div className="mt-2.5 flex items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cx(
                "rounded-full px-2 py-0.5 text-[10px] font-medium transition duration-150",
                filter === f.id
                  ? "bg-gold/15 text-gold ring-1 ring-gold/40"
                  : "text-fog hover:bg-cream/5 hover:text-cream",
              )}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-0.5 rounded-md border border-cream/8 p-0.5">
            {(
              [
                ["grid", LayoutGrid, "Grid"],
                ["list", List, "List"],
              ] as const
            ).map(([id, Icon, label]) => (
              <button
                key={id}
                onClick={() => setView(id)}
                title={`${label} view`}
                className={cx(
                  "flex h-5 w-5 items-center justify-center rounded transition duration-150",
                  view === id ? "bg-cream/10 text-cream" : "text-fog/70 hover:text-cream",
                )}
              >
                <Icon size={11} />
              </button>
            ))}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {GROUPS.map(({ label, kind }) => {
          const items = matches.filter((a) => a.kind === kind);
          if (items.length === 0) return null;
          const Kind = kindIcon[kind];
          return (
            <div key={kind} className="pb-1">
              {/* the group headers carry the rail's whole structure — they stay
                  pinned so a long scroll never loses its place */}
              <div className="sticky top-0 z-10 -mx-3 mb-2 mt-3 bg-[#0e0e10]/95 px-3 pb-1.5 pt-1 backdrop-blur-sm first:mt-0">
                <div className="flex items-center gap-1.5 border-b border-cream/10 pb-1.5">
                  <Kind size={11} className="shrink-0 text-gold/80" />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cream/85">
                    {label}
                  </span>
                  <span className="ml-auto rounded-full bg-cream/8 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-fog">
                    {items.length}
                  </span>
                </div>
              </div>
              {view === "grid" ? (
                <div
                  className="grid gap-2"
                  style={{
                    // cards grow with the rail rather than staying skinny, and
                    // video takes get the bigger tile — they're what you cut with
                    gridTemplateColumns: `repeat(${columns(width, kind)}, minmax(0, 1fr))`,
                  }}
                >
                  {items.map((a) => (
                    <GridCard
                      key={a.relPath}
                      item={a}
                      used={usedCounts[a.relPath] ?? 0}
                      onAdd={() => onAdd(a)}
                    />
                  ))}
                </div>
              ) : (
                <div className="space-y-px">
                  {items.map((a) => (
                    <ListRow
                      key={a.relPath}
                      item={a}
                      used={usedCounts[a.relPath] ?? 0}
                      onAdd={() => onAdd(a)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {matches.length === 0 && (
          <p className="px-1 pt-3 text-[11px] leading-relaxed text-fog">
            {pool.length === 0
              ? "Generate takes in the labs — they land here."
              : filter === "used"
                ? "Nothing from the library is in the cut yet."
                : filter === "unused"
                  ? "Every take is already in the cut."
                  : `Nothing matches “${q}”.`}
          </p>
        )}
      </div>

      {/* drag the rail wider when the takes deserve the room */}
      <div
        onPointerDown={onResize}
        title="Drag to resize"
        className="group absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize"
      >
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gold/0 transition-colors duration-150 group-hover:bg-gold/60" />
      </div>
    </aside>
  );
}

/* A project can hold hundreds of takes, and Chrome will only run ~6 requests
 * to studiod at a time — mounting every card's media at once means the rail
 * sits black while the far end of the list hogs the queue. Cards mount their
 * media the first time they come near the viewport and keep it after. */
function useNearViewport<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return { ref, seen };
}

/** poster frame + duration for one card, off the shared decoder pool — never
 * a media element per card, so a 300-take rail doesn't stall the app */
function usePreview(item: PoolItem, mounted: boolean) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [dur, setDur] = useState<number | undefined>(() => durCache.get(item.relPath));

  useEffect(() => {
    if (!mounted || !item.url) return;
    let alive = true;
    const remember = (d: number) => {
      if (!Number.isFinite(d) || d <= 0) return;
      durCache.set(item.relPath, d);
      if (alive) setDur(d);
    };
    if (item.kind === "video") {
      poster(item.url).then(({ frame, duration }) => {
        remember(duration);
        const el = canvas.current;
        if (!alive || !el) return;
        el.width = frame.width;
        el.height = frame.height;
        el.getContext("2d")?.drawImage(frame, 0, 0);
      }, noop);
    } else if (item.kind === "audio" || item.kind === "music") {
      mediaDuration(item.url).then(remember, noop);
    }
    return () => {
      alive = false;
    };
  }, [mounted, item.url, item.kind, item.relPath]);

  return { canvas, dur };
}

const noop = () => {};

function UsedBadge({ used, className }: { used: number; className?: string }) {
  if (!used) return null;
  return (
    <span
      title={`Already in the cut${used > 1 ? ` — ${used} clips` : ""}`}
      className={cx(
        "flex items-center gap-0.5 rounded-full bg-gold px-1 py-px text-[8px] font-bold text-ink",
        className,
      )}
    >
      <Check size={7} strokeWidth={3.5} />
      {used > 1 && used}
    </span>
  );
}

function GridCard({
  item,
  used,
  onAdd,
}: {
  item: PoolItem;
  used: number;
  onAdd: () => void;
}) {
  const { ref, seen } = useNearViewport<HTMLButtonElement>();
  const { canvas, dur } = usePreview(item, seen);
  return (
    <button
      ref={ref}
      title={`Add ${item.name} to the timeline`}
      onClick={onAdd}
      className={cx(
        "group relative aspect-video overflow-hidden rounded-lg border bg-surface",
        "transition duration-200 ease-[cubic-bezier(0.25,1,0.5,1)]",
        "hover:-translate-y-0.5 hover:border-gold/45 hover:shadow-[0_8px_20px_-10px_rgba(201,169,110,0.6)]",
        used ? "border-gold/30" : "border-cream/6",
      )}
    >
      {seen && item.url && item.kind === "image" && (
        <img
          src={item.url}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {item.kind === "video" && (
        <canvas ref={canvas} className="absolute inset-0 h-full w-full object-cover" />
      )}
      {(item.kind === "audio" || item.kind === "music") && (
        <span className="absolute inset-0 bg-gradient-to-br from-cream/[0.07] to-transparent" />
      )}
      <span className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/20 to-transparent" />

      <span className="absolute left-1.5 right-1.5 top-1.5 flex items-start gap-1">
        <UsedBadge used={used} className="ml-auto" />
      </span>
      <span className="absolute inset-x-1.5 bottom-1 flex items-end gap-1">
        <span className="min-w-0 flex-1 truncate text-left text-[9px] text-cream/85">
          {item.name}
        </span>
        {dur != null && (
          <span className="shrink-0 rounded bg-ink/70 px-1 text-[8.5px] font-medium tabular-nums text-cream/70">
            {fmtDur(dur)}
          </span>
        )}
      </span>

      <span className="absolute inset-0 flex items-center justify-center bg-ink/55 opacity-0 backdrop-blur-[1px] transition-opacity duration-200 group-hover:opacity-100">
        <span className="flex items-center gap-1 rounded-full bg-gold px-2 py-0.5 text-[9px] font-semibold text-ink">
          <Plus size={9} /> Add
        </span>
      </span>
    </button>
  );
}

function ListRow({ item, used, onAdd }: { item: PoolItem; used: number; onAdd: () => void }) {
  const { ref, seen } = useNearViewport<HTMLButtonElement>();
  const { canvas, dur } = usePreview(item, seen);
  const Icon = kindIcon[item.kind as keyof typeof kindIcon] ?? FileVideo;
  return (
    <button
      ref={ref}
      title={`Add ${item.name} to the timeline`}
      onClick={onAdd}
      className="group flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition duration-150 hover:bg-cream/[0.05]"
    >
      <span className="relative h-7 w-12 shrink-0 overflow-hidden rounded border border-cream/8 bg-surface">
        {seen && item.url && item.kind === "image" && (
          <img src={item.url} alt="" loading="lazy" className="h-full w-full object-cover" />
        )}
        {item.kind === "video" && (
          <canvas ref={canvas} className="h-full w-full object-cover" />
        )}
        {(item.kind === "audio" || item.kind === "music") && (
          <Icon size={11} className="absolute inset-0 m-auto text-fog" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-[10.5px] text-cream/85">{item.name}</span>
      <UsedBadge used={used} />
      {dur != null && (
        <span className="shrink-0 text-[9.5px] tabular-nums text-fog/70">{fmtDur(dur)}</span>
      )}
      <Plus
        size={11}
        className="shrink-0 text-fog/0 transition group-hover:text-gold"
        aria-hidden
      />
    </button>
  );
}
