import { useMemo, useState } from "react";
import {
  Box,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clapperboard,
  Film,
  FolderOpen,
  History,
  Image,
  ImagePlus,
  Inbox,
  LayoutGrid,
  List,
  ListFilter,
  Maximize2,
  Mic,
  Music,
  Play,
  Search,
  Star,
} from "lucide-react";
import { useAssetLibrary } from "@/hooks";
import type { LibraryAsset, LibraryKind } from "@/data/sample";
import { Chip, GhostButton, GoldButton, Waveform, cx } from "@/components/ui";

/* Asset library — UI-Design/asset library.jpg. Everything generated in one
 * searchable grid: collections + smart collections on the left, filterable
 * cards in the middle, metadata inspector with send-to-timeline / use-as-
 * reference on the right. Data flows through useAssetLibrary (tRPC seam). */

type Filter = "all" | LibraryKind;

const kindIcons: Record<LibraryKind, typeof Image> = {
  image: Image,
  video: Film,
  audio: Mic,
  music: Music,
  model3d: Box,
};

const collectionIcons: Record<string, typeof Image> = {
  projects: FolderOpen,
  image: Image,
  video: Film,
  audio: Mic,
  music: Music,
  model3d: Box,
};

const smartIcons: Record<string, typeof Image> = {
  favorites: Star,
  recent: History,
  unsorted: Inbox,
  review: CircleAlert,
};

function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">{children}</h3>
  );
}

/* ---------- left panel: collections ---------- */

function CollectionsPanel({
  filter,
  onFilter,
}: {
  filter: Filter;
  onFilter: (f: Filter) => void;
}) {
  const lib = useAssetLibrary();

  const row = (
    id: string,
    label: string,
    count: number,
    Icon: typeof Image,
    active: boolean,
    onClick: () => void,
  ) => (
    <button
      key={id}
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition",
        active ? "bg-gold/10 text-gold" : "text-cream/80 hover:bg-cream/5 hover:text-cream",
      )}
    >
      <Icon size={14} className={active ? "text-gold" : "text-fog"} />
      <span className="flex-1 truncate text-[12px]">{label}</span>
      <span className="text-[11px] tabular-nums text-fog">{count.toLocaleString()}</span>
    </button>
  );

  return (
    <aside className="flex w-[232px] shrink-0 flex-col border-r hairline bg-[#0e0e10]">
      <div className="flex items-center justify-between p-4 pb-2">
        <PanelLabel>Collections</PanelLabel>
        <button className="text-fog/60 transition hover:text-gold">
          <FolderOpen size={13} />
        </button>
      </div>
      <div className="space-y-0.5 px-2.5">
        {lib.collections.map((c) =>
          row(
            c.id,
            c.label,
            c.count,
            collectionIcons[c.id] ?? FolderOpen,
            c.id === filter || (c.id === "projects" && filter === "all"),
            () => onFilter(c.id === "projects" ? "all" : (c.id as Filter)),
          ),
        )}
      </div>

      <div className="p-4 pb-2 pt-5">
        <PanelLabel>Smart collections</PanelLabel>
      </div>
      <div className="space-y-0.5 px-2.5">
        {lib.smart.map((c) =>
          row(c.id, c.label, c.count, smartIcons[c.id] ?? Star, false, () => {}),
        )}
      </div>

      <div className="mt-auto p-3">
        <div className="flex items-center gap-3 rounded-xl border hairline bg-surface/60 p-3">
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-gold/50 text-[10px] font-semibold tabular-nums text-gold">
            {lib.storage.usedPct}%
          </span>
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-cream">Storage used</div>
            <div className="text-[10px] tabular-nums text-fog">{lib.storage.label}</div>
          </div>
          <ChevronRight size={13} className="ml-auto shrink-0 text-fog/60" />
        </div>
      </div>
    </aside>
  );
}

/* ---------- center: grid ---------- */

function AssetCard({
  asset,
  active,
  onSelect,
}: {
  asset: LibraryAsset;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = kindIcons[asset.kind];
  const audio = asset.kind === "audio" || asset.kind === "music";

  return (
    <button
      onClick={onSelect}
      className={cx(
        "group overflow-hidden rounded-xl border text-left transition",
        active
          ? "border-gold/60 bg-surface"
          : "border-transparent bg-surface/50 hover:border-cream/15",
      )}
    >
      <div className={cx("relative aspect-[4/3]", asset.swatch)}>
        {asset.url && asset.kind === "image" && (
          <img src={asset.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
        {asset.url && asset.kind === "video" && (
          <video src={asset.url} preload="metadata" muted className="absolute inset-0 h-full w-full object-cover" />
        )}
        <span className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-md bg-ink/55 text-cream/85 backdrop-blur-sm">
          <Icon size={12} />
        </span>
        {asset.checked && (
          <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-b from-gold to-gold-deep text-ink">
            <Check size={11} strokeWidth={3} />
          </span>
        )}
        {asset.favorite && !asset.checked && (
          <Star
            size={12}
            className="absolute right-2 top-2 text-gold"
            fill="currentColor"
          />
        )}
        {audio && asset.waveSeed !== undefined && (
          <div className="absolute inset-0 flex items-center gap-3 px-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink/55 text-cream/90 backdrop-blur-sm transition group-hover:bg-gold group-hover:text-ink">
              <Play size={12} className="ml-0.5" />
            </span>
            <Waveform seed={asset.waveSeed} bars={40} className="h-8! min-w-0 flex-1" />
          </div>
        )}
        {asset.duration && (
          <span className="absolute bottom-2 right-2 rounded-md bg-ink/65 px-1.5 py-0.5 text-[10px] tabular-nums text-cream/90 backdrop-blur-sm">
            {asset.duration}
          </span>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-2 px-2.5 py-2">
        <span className="truncate text-[11px] text-cream/90">{asset.name}</span>
        <span className="shrink-0 text-[10px] tabular-nums text-fog">{asset.meta}</span>
      </div>
    </button>
  );
}

function GridPanel({
  filter,
  onFilter,
  assetId,
  onSelect,
}: {
  filter: Filter;
  onFilter: (f: Filter) => void;
  assetId: string;
  onSelect: (id: string) => void;
}) {
  const lib = useAssetLibrary();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "image", label: "Image" },
    { id: "video", label: "Video" },
    { id: "audio", label: "Voice" },
    { id: "music", label: "Music" },
    { id: "model3d", label: "3D" },
  ];

  const shown = useMemo(
    () =>
      lib.assets.filter(
        (a) =>
          (filter === "all" || a.kind === filter) &&
          (!query || a.name.toLowerCase().includes(query.toLowerCase())),
      ),
    [lib.assets, filter, query],
  );

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      {/* search + filters */}
      <div className="space-y-3 p-4 pb-3">
        <div className="flex items-center gap-2 rounded-xl border border-cream/10 bg-surface px-3 py-2 focus-within:border-gold/40">
          <Search size={14} className="shrink-0 text-fog" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search assets, tags, or collections…"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-cream placeholder:text-fog focus:outline-none"
          />
          <kbd className="rounded border border-cream/12 px-1.5 py-0.5 text-[9px] text-fog">
            Ctrl K
          </kbd>
        </div>

        <div className="flex items-center gap-1.5">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => onFilter(f.id)}
              className={cx(
                "rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition",
                filter === f.id
                  ? "bg-gold/12 text-gold"
                  : "border border-cream/10 text-cream/75 hover:border-gold/35 hover:text-cream",
              )}
            >
              {f.label}
            </button>
          ))}
          <button className="flex items-center gap-1.5 rounded-lg border border-cream/10 px-2.5 py-1.5 text-[11px] text-cream/75 transition hover:border-gold/35">
            <ListFilter size={11} /> Filters
            <Chip tone="gold" className="px-1.5 text-[9px]">
              2
            </Chip>
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <button className="flex items-center gap-1.5 rounded-lg border border-cream/10 px-2.5 py-1.5 text-[11px] text-cream/75 transition hover:border-gold/35">
              Date added <ChevronDown size={11} className="text-fog" />
            </button>
            <div className="flex overflow-hidden rounded-lg border border-cream/10">
              {(
                [
                  { id: "grid", icon: LayoutGrid },
                  { id: "list", icon: List },
                ] as const
              ).map(({ id, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setView(id)}
                  className={cx(
                    "flex h-8 w-8 items-center justify-center transition",
                    view === id ? "bg-gold/12 text-gold" : "text-fog hover:text-cream",
                  )}
                >
                  <Icon size={13} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* grid */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        <div className="grid grid-cols-3 gap-3 2xl:grid-cols-4">
          {shown.map((a) => (
            <AssetCard key={a.id} asset={a} active={a.id === assetId} onSelect={() => onSelect(a.id)} />
          ))}
        </div>
        {shown.length === 0 && (
          <p className="py-16 text-center text-[12px] text-fog">
            {lib.assets.length === 0
              ? "The library is empty — everything you generate lands here automatically."
              : `Nothing matches “${query}” — try a different search or filter.`}
          </p>
        )}
      </div>

      {/* pagination */}
      <div className="flex items-center justify-between border-t hairline px-4 py-2.5">
        <span className="text-[11px] tabular-nums text-fog">
          1–{shown.length} of {lib.total.toLocaleString()} assets
        </span>
        <div className="flex items-center gap-1">
          <button className="flex h-7 w-7 items-center justify-center rounded-lg text-fog transition hover:text-cream">
            <ChevronLeft size={13} />
          </button>
          {["1", "2", "3", "…", "19"].map((p, i) => (
            <button
              key={i}
              className={cx(
                "flex h-7 w-7 items-center justify-center rounded-lg text-[11px] tabular-nums transition",
                p === "1" ? "bg-gold/12 text-gold" : "text-fog hover:text-cream",
              )}
            >
              {p}
            </button>
          ))}
          <button className="flex h-7 w-7 items-center justify-center rounded-lg text-fog transition hover:text-cream">
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
    </section>
  );
}

/* ---------- right rail: inspector ---------- */

function Inspector({ asset }: { asset: LibraryAsset }) {
  const [tab, setTab] = useState<"details" | "comments">("details");
  const audio = asset.kind === "audio" || asset.kind === "music";

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l hairline bg-[#0e0e10]">
      {/* preview */}
      <div className="p-4 pb-3">
        <div className={cx("relative aspect-video overflow-hidden rounded-xl", asset.swatch)}>
          {asset.url && asset.kind === "image" && (
            <img src={asset.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
          {asset.url && asset.kind === "video" && (
            <video src={asset.url} controls preload="metadata" className="absolute inset-0 h-full w-full object-cover" />
          )}
          {asset.url && audio && (
            <audio src={asset.url} controls className="absolute inset-x-2 bottom-2 h-8 w-[calc(100%-16px)]" />
          )}
          {audio && !asset.url && asset.waveSeed !== undefined ? (
            <div className="absolute inset-0 flex items-center px-4">
              <Waveform seed={asset.waveSeed} bars={64} played={0.2} className="h-10! w-full" />
            </div>
          ) : null}
          <button className="absolute bottom-2 right-2 flex h-6 w-6 items-center justify-center rounded-md bg-ink/55 text-cream/85 backdrop-blur-sm transition hover:text-gold">
            <Maximize2 size={11} />
          </button>
        </div>
        {(asset.kind === "video" || audio) && !asset.url && (
          <div className="mt-2.5 flex items-center gap-2.5">
            <button className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-gold to-gold-deep text-ink transition hover:brightness-110">
              <Play size={11} className="ml-0.5" />
            </button>
            <div className="relative h-1 min-w-0 flex-1 rounded-full bg-cream/8">
              <span className="absolute inset-y-0 left-0 w-1/5 rounded-full bg-gradient-to-r from-gold-deep to-gold" />
            </div>
            <span className="shrink-0 text-[10px] tabular-nums text-fog">
              0:01 / {asset.duration}
            </span>
          </div>
        )}
        <div className="mt-3 flex items-center gap-1.5">
          <h2 className="min-w-0 truncate font-serif text-[14px] font-semibold text-cream">
            {asset.name}
          </h2>
          <Star
            size={12}
            className={cx("shrink-0", asset.favorite ? "text-gold" : "text-cream/25")}
            fill={asset.favorite ? "currentColor" : "none"}
          />
        </div>
      </div>

      {/* tabs */}
      <div className="flex border-b hairline px-4">
        {(
          [
            { id: "details", label: "Details" },
            { id: "comments", label: "Comments · 0" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              "border-b-2 px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider transition",
              tab === t.id
                ? "border-gold text-gold"
                : "border-transparent text-fog hover:text-cream",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "details" ? (
          <>
            <div className="space-y-2">
              {asset.info.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 text-[11px]">
                  <span className="shrink-0 text-fog">{k}</span>
                  <span className="truncate text-right text-cream/85">{v}</span>
                </div>
              ))}
            </div>
            <div className="mt-5">
              <PanelLabel>Tags</PanelLabel>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {asset.tags.map((t) => (
                  <Chip key={t} tone="muted" className="text-[10px]">
                    {t}
                  </Chip>
                ))}
                <Chip tone="muted" className="text-[10px] text-fog/60">
                  …
                </Chip>
              </div>
            </div>
          </>
        ) : (
          <p className="text-[12px] leading-relaxed text-fog">
            No comments yet — notes land here when the Director references this asset.
          </p>
        )}
      </div>

      <div className="space-y-2 p-4 pt-2">
        <GoldButton className="w-full justify-center py-2.5">
          <Clapperboard size={13} /> Send to timeline
        </GoldButton>
        <GhostButton className="w-full justify-center py-2.5">
          <ImagePlus size={13} /> Use as reference
        </GhostButton>
      </div>
    </aside>
  );
}

/* ---------- screen ---------- */

export function AssetLibrary() {
  const lib = useAssetLibrary();
  const [filter, setFilter] = useState<Filter>("all");
  const [assetId, setAssetId] = useState(lib.assets[0]?.id ?? "");
  const asset = lib.assets.find((a) => a.id === assetId) ?? lib.assets[0];

  return (
    <div className="flex h-full">
      <CollectionsPanel filter={filter} onFilter={setFilter} />
      <GridPanel
        filter={filter}
        onFilter={setFilter}
        assetId={asset?.id ?? ""}
        onSelect={setAssetId}
      />
      {asset && <Inspector asset={asset} />}
    </div>
  );
}
