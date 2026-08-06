import { useMemo, useState } from "react";
import {
  Aperture,
  BookOpen,
  ChevronRight,
  Layers,
  Lightbulb,
  Palette,
  Search,
  Star,
  User,
  Wind,
  X,
} from "lucide-react";
import type { PromptCategory, PromptPreset, StylePack } from "@aurea/shared";
import { cx } from "@/components/ui";
import { CATEGORY_ORDER } from "./PromptBuilder";
import { usePromptLibrary } from "./promptHooks";

/* The docked prompt library — Image Lab.jpg's second column. The modal
 * (PromptLibraryPanel) is still the place to *manage* the library; this rail
 * is the place to *compose* from it: always visible next to the composer,
 * grouped, searchable, starrable, one click to append.
 *
 * Stars are local state. A preset file is shared with the packs and the
 * server's seed logic; "the fragments I reach for" is a per-machine habit, so
 * it lives in localStorage rather than mutating library files. */

const STAR_KEY = "aurea:promptlib:starred";

function loadStars(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STAR_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** category → glyph + tint. The mockup shows thumbnails here; we have no
 * image for a text fragment, and a fake one would be a lie — so each row
 * carries its category as a tinted glyph instead. */
const CATEGORY_FACE: Record<PromptCategory, { icon: typeof Palette; tint: string; label: string }> = {
  style: { icon: Palette, tint: "border-gold/35 bg-gold/10 text-gold", label: "Style" },
  subject: { icon: User, tint: "border-cream/25 bg-cream/8 text-cream/90", label: "Subject" },
  lighting: { icon: Lightbulb, tint: "border-sage/40 bg-sage/10 text-sage", label: "Lighting" },
  camera: {
    icon: Aperture,
    tint: "border-[#a99bee]/40 bg-[#8b7bd8]/12 text-[#a99bee]",
    label: "Camera",
  },
  mood: { icon: Wind, tint: "border-ember/45 bg-ember/12 text-[#e07a6b]", label: "Mood" },
  negative: {
    icon: X,
    tint: "border-dashed border-fog/40 bg-transparent text-fog",
    label: "Negative",
  },
};

function PresetRow({
  preset,
  starred,
  onStar,
  onPick,
}: {
  preset: PromptPreset;
  starred: boolean;
  onStar: () => void;
  onPick: () => void;
}) {
  const face = CATEGORY_FACE[preset.category];
  return (
    <div className="group/row relative">
      <button
        onClick={onPick}
        title={preset.text}
        className={cx(
          "flex w-full items-center gap-2.5 rounded-card border border-transparent px-2 py-1.5 text-left",
          "transition duration-[var(--dur)] ease-[var(--ease-out-quart)]",
          "hover:border-gold/25 hover:bg-cream/4",
        )}
      >
        <span
          className={cx(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-card border",
            face.tint,
          )}
        >
          <face.icon size={14} />
        </span>
        <span className="min-w-0 flex-1 pr-4">
          <span className="block truncate text-xs font-medium text-cream/90">{preset.title}</span>
          <span className="block truncate text-2xs leading-snug text-fog">{preset.text}</span>
        </span>
      </button>
      <button
        onClick={onStar}
        title={starred ? "Unstar" : "Star — keeps it at the top"}
        className={cx(
          "absolute right-2 top-1/2 -translate-y-1/2 transition duration-[var(--dur)]",
          starred
            ? "text-gold opacity-100"
            : "text-fog/60 opacity-0 hover:text-gold group-hover/row:opacity-100",
        )}
      >
        <Star size={12} fill={starred ? "currentColor" : "none"} />
      </button>
    </div>
  );
}

function Group({
  title,
  count,
  children,
  defaultOpen = true,
  accent,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
  accent?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-1 py-1.5 text-left transition hover:text-cream"
      >
        <ChevronRight
          size={11}
          className={cx(
            "shrink-0 text-fog transition-transform duration-[var(--dur)]",
            open && "rotate-90",
          )}
        />
        <span
          className={cx(
            "min-w-0 flex-1 truncate text-2xs font-semibold uppercase tracking-[0.14em]",
            accent ? "text-gold/85" : "text-fog",
          )}
        >
          {title}
        </span>
        <span className="shrink-0 text-2xs tabular-nums text-fog/60">{count}</span>
      </button>
      {open && <div className="mt-0.5 space-y-0.5">{children}</div>}
    </section>
  );
}

export function PromptLibraryRail({
  onPick,
  onClose,
  onManage,
}: {
  onPick: (preset: PromptPreset) => void;
  onClose: () => void;
  /** open the full library modal — where presets are saved and deleted */
  onManage: () => void;
}) {
  const lib = usePromptLibrary();
  const [search, setSearch] = useState("");
  const [starred, setStarred] = useState<string[]>(loadStars);

  const toggleStar = (id: string) =>
    setStarred((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      localStorage.setItem(STAR_KEY, JSON.stringify(next));
      return next;
    });

  const q = search.trim().toLowerCase();
  const matches = (p: PromptPreset) =>
    !q ||
    p.title.toLowerCase().includes(q) ||
    p.text.toLowerCase().includes(q) ||
    p.tags.some((t) => t.toLowerCase().includes(q));

  const filtered = useMemo(
    () => lib.presets.filter(matches),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lib.presets, q],
  );

  const starredPresets = filtered.filter((p) => starred.includes(p.id));
  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    presets: filtered.filter((p) => p.category === cat && !starred.includes(p.id)),
  })).filter((g) => g.presets.length > 0);

  /** a pack shows whole or not at all — it's a curated unit, and half a pack
   * is worse than none. Under search it survives if anything in it matches. */
  const packs: StylePack[] = lib.packs.filter((pk) => !q || pk.presets.some(matches));

  const total = filtered.length + packs.reduce((n, p) => n + p.presets.length, 0);

  return (
    <aside className="flex w-[268px] shrink-0 flex-col border-r hairline bg-[#0e0e10]">
      <div className="flex shrink-0 items-center gap-2 border-b hairline px-3 py-2.5">
        <BookOpen size={13} className="shrink-0 text-gold/80" />
        <h2 className="min-w-0 flex-1 truncate text-2xs font-semibold uppercase tracking-[0.14em] text-fog">
          Prompt library
        </h2>
        <button
          onClick={onClose}
          title="Hide the library"
          className="text-fog/60 transition hover:text-cream"
        >
          <X size={13} />
        </button>
      </div>

      <div className="relative shrink-0 px-3 py-2.5">
        <Search
          size={12}
          className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-fog/60"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search fragments…"
          className={cx(
            "w-full rounded-pill border border-cream/10 bg-ink/50 py-1.5 pl-7 pr-2.5 text-xs text-cream",
            "placeholder:text-fog/60 transition-[border-color,box-shadow] focus:border-gold/50 focus:outline-none",
            "focus:shadow-[0_0_0_3px_rgba(201,169,110,0.12)]",
          )}
        />
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-3">
        {starredPresets.length > 0 && (
          <Group title="Starred" count={starredPresets.length} accent>
            {starredPresets.map((p) => (
              <PresetRow
                key={p.id}
                preset={p}
                starred
                onStar={() => toggleStar(p.id)}
                onPick={() => onPick(p)}
              />
            ))}
          </Group>
        )}

        {packs.map((pk) => (
          <Group
            key={pk.id}
            title={pk.title}
            count={pk.presets.length}
            defaultOpen={!!q || pk.fromBible}
          >
            {pk.fromBible && (
              <p className="flex items-center gap-1 px-2 pb-1 text-2xs text-gold/70">
                <Layers size={10} /> from this project's bible
              </p>
            )}
            {pk.presets.map((p) => (
              <PresetRow
                key={p.id}
                preset={p}
                starred={starred.includes(p.id)}
                onStar={() => toggleStar(p.id)}
                onPick={() => onPick(p)}
              />
            ))}
          </Group>
        ))}

        {byCategory.map(({ cat, presets }) => (
          <Group key={cat} title={CATEGORY_FACE[cat].label} count={presets.length} defaultOpen={!!q}>
            {presets.map((p) => (
              <PresetRow
                key={p.id}
                preset={p}
                starred={false}
                onStar={() => toggleStar(p.id)}
                onPick={() => onPick(p)}
              />
            ))}
          </Group>
        ))}

        {total === 0 && (
          <div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
            <BookOpen size={18} className="text-gold/50" />
            <p className="text-xs text-cream/80">{lib.loading ? "Loading…" : "Nothing matches"}</p>
            {!lib.loading && (
              <p className="text-2xs leading-relaxed text-fog">
                Clear the search, or save the prompt you're working on from the full library.
              </p>
            )}
          </div>
        )}
      </div>

      <button
        onClick={onManage}
        className="flex shrink-0 items-center justify-center gap-1.5 border-t hairline py-2.5 text-2xs font-medium text-fog transition hover:bg-cream/4 hover:text-gold"
      >
        <BookOpen size={11} /> Manage library…
      </button>
    </aside>
  );
}
