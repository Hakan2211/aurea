import { useMemo, useState } from "react";
import { ArrowRight, Blend, Check, Cpu, FileText, Film, Layers, Search, Sparkles } from "lucide-react";
import type { FormatRunResult, FormatRuns } from "@/hooks";
import {
  CATEGORIES,
  blendParadigmById,
  packById,
  type FormatCard,
  type FormatCategory,
} from "@/data/formats";
import { GhostButton, GoldButton, cx } from "@/components/ui";
import { PillButton, Poster, RecentRuns, RunLine } from "./shared";

/* The gallery — formats-v2's poster wall. Two things it teaches that the old
 * grid didn't: hovering a poster says what the format *does* before you open
 * anything, and a format that is rendering (or has rendered) says so on its
 * own tile instead of sending you to the Job Center. */

/** the three-beat chain in the peek — the pipeline's shape, not its spec */
function Chain() {
  const beats = [
    { icon: FileText, label: "script" },
    { icon: Layers, label: "scenes" },
    { icon: Film, label: "render" },
  ];
  return (
    <div className="flex items-center gap-1.5">
      {beats.map((b, i) => (
        <span key={b.label} className="flex items-center gap-1.5">
          {i > 0 && <ArrowRight size={9} className="text-cream/35" />}
          <span className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-cream/70">
            <b.icon size={10} strokeWidth={1.6} className="text-gold/80" />
            {b.label}
          </span>
        </span>
      ))}
    </div>
  );
}

/** what a format actually draws with, in plain words — the honest version of
 * the duration chip the mockup sketches (every format's Auto target is the
 * same 25-45s, so a duration chip per tile would say nothing) */
function languages(format: FormatCard): string {
  if (format.paradigms?.length) {
    return format.paradigms.slice(0, 3).map((p) => blendParadigmById(p).label).join(" · ");
  }
  return format.generate === "llm" ? "LLM-written scenes" : "Deterministic build";
}

export function FormatTile({
  format,
  selected,
  runs,
  onSelect,
  onPlay,
}: {
  format: FormatCard;
  selected: boolean;
  runs?: FormatRuns;
  onSelect: () => void;
  onPlay: (run: FormatRunResult) => void;
}) {
  const pack = packById(format.packs[0]);
  const active = runs?.active[0];
  const recent = runs?.recent ?? [];
  return (
    <button
      onClick={onSelect}
      className={cx(
        "group relative overflow-hidden rounded-panel border text-left transition duration-[var(--dur)]",
        "hover:-translate-y-0.5 hover:shadow-[0_18px_44px_rgba(0,0,0,0.55)]",
        selected
          ? "border-gold/70 shadow-[0_0_0_1px_rgba(201,169,110,0.4),0_18px_44px_rgba(0,0,0,0.5)]"
          : "border-cream/8 hover:border-gold/40",
      )}
    >
      <Poster format={format} className="aspect-[2/3]">
        <span className="absolute left-3 top-3 rounded-pill bg-black/45 px-2 py-0.5 text-[9px] font-medium tracking-wide text-cream/80 backdrop-blur-sm">
          {pack.label}
        </span>
        {/* v1's graft: the selected tile carries a checkmark, not just a ring */}
        {selected ? (
          <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-pill bg-gradient-to-b from-gold to-gold-deep text-ink">
            <Check size={13} strokeWidth={3} />
          </span>
        ) : (
          format.featured && (
            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-pill bg-gold px-2 py-0.5 text-[9px] font-semibold text-ink">
              <Sparkles size={9} /> Meta
            </span>
          )
        )}

        {/* the peek needs its own darkness: the poster scrim alone is fine
         * behind one serif title, but a paragraph of 11px over a light pack's
         * art (Sketchbook, Therapy Minimal) is unreadable */}
        <div
          className={cx(
            "absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-black via-black/80 to-transparent",
            "transition-opacity duration-[var(--dur)]",
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        />

        {/* everything stacks up from the bottom edge, so the peek and the run
         * band slide the title down rather than covering it */}
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2.5 p-3.5">
          <div
            className={cx(
              "space-y-2 overflow-hidden transition-all duration-[var(--dur)] ease-[var(--ease-out-quart)]",
              selected ? "max-h-40 opacity-100" : "max-h-0 opacity-0 group-hover:max-h-40 group-hover:opacity-100",
            )}
          >
            {/* a real exit-video title from this format — what it produces,
             * said in the format's own voice */}
            <p className="truncate font-serif text-xs italic text-cream/55">{format.poster}</p>
            <p className="text-xs leading-relaxed text-cream/85">{format.tagline}</p>
            <Chain />
            <span className="inline-flex items-center gap-1 rounded-pill border border-cream/20 bg-black/35 px-2 py-0.5 text-[9px] text-cream/75">
              <Cpu size={9} className="text-gold/70" /> {languages(format)}
            </span>
          </div>

          {(active || recent.length > 0) && (
            <div className="space-y-2 rounded-card border border-cream/12 bg-black/55 p-2 backdrop-blur-[2px]">
              {active && <RunLine run={active} />}
              {recent.length > 0 && <RecentRuns runs={recent} onPlay={onPlay} />}
            </div>
          )}

          <div>
            <div className="mb-1.5 h-px w-7 bg-gold" />
            <h3 className="font-serif text-[25px] leading-tight text-[#f6f2ea]">{format.name}</h3>
          </div>
        </div>
      </Poster>
    </button>
  );
}

export function Gallery({
  formats,
  selectedId,
  runs,
  onSelect,
  onBlend,
  onCreateWithAi,
  onPlay,
}: {
  formats: FormatCard[];
  selectedId: string | null;
  runs: Map<string, FormatRuns>;
  onSelect: (id: string) => void;
  onBlend: () => void;
  onCreateWithAi: () => void;
  onPlay: (run: FormatRunResult) => void;
}) {
  const [category, setCategory] = useState<FormatCategory | "all">("all");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return formats.filter(
      (f) =>
        (category === "all" || f.category === category) &&
        (!q ||
          f.name.toLowerCase().includes(q) ||
          f.tagline.toLowerCase().includes(q) ||
          f.recipe.toLowerCase().includes(q) ||
          (f.paradigms ?? []).some((p) => p.toLowerCase().includes(q))),
    );
  }, [formats, category, query]);

  const rendering = useMemo(
    () => [...runs.values()].reduce((n, r) => n + r.active.length, 0),
    [runs],
  );

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      {/* Not the standard ScreenHeader: this screen is a catalog cover, and
       * the mockup's whole first impression is the display-serif title over a
       * wall of posters. Bible and the Job Center run the same 26–32px
       * register — the 17px ScreenHeader title made the page read like a
       * settings panel. */}
      <header className="flex shrink-0 items-center gap-4 px-6 pb-3 pt-5">
        <div className="min-w-0">
          <h1 className="font-serif text-[32px] font-semibold leading-none tracking-wide text-cream">
            Formats
          </h1>
          <p className="mt-1.5 truncate text-xs text-fog">
            {rendering > 0
              ? `${formats.length} recipes · 12 style packs · ${rendering} rendering`
              : `${formats.length} recipes · 12 style packs`}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <label className="flex items-center gap-2 rounded-card border border-cream/10 bg-ink/40 px-3 py-2 transition focus-within:border-gold/40">
            <Search size={14} className="text-fog" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search formats…"
              className="w-44 bg-transparent text-sm text-cream placeholder:text-fog focus:outline-none"
            />
          </label>
          {/* the blend used to be a tile that vanished the moment you filtered —
           * it is a header action now, always reachable */}
          <GhostButton onClick={onBlend} title="Mix two formats inside one video" className="py-2">
            <Blend size={13} /> Blend formats
          </GhostButton>
          <GoldButton onClick={onCreateWithAi} className="py-2">
            <Sparkles size={13} /> Create with AI
          </GoldButton>
        </div>
      </header>

      <div className="flex items-center gap-2 px-6 py-3">
        {CATEGORIES.map((c) => (
          <PillButton
            key={c.id}
            active={category === c.id}
            onClick={() => setCategory(c.id)}
            className="px-3.5 py-1.5 text-sm"
          >
            {c.label}
          </PillButton>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {visible.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-cream/70">No formats match “{query}”.</p>
            <p className="text-xs text-fog">Try a paradigm — “manim”, “parallax”, “chart”.</p>
          </div>
        ) : (
          /* 260 lands on four columns at the window's usual width, which is
           * what the mockup draws — five columns of ten formats leaves a bald
           * band under two short rows */
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-5">
            {visible.map((f) => (
              <FormatTile
                key={f.id}
                format={f}
                selected={f.id === selectedId}
                runs={runs.get(f.id)}
                onSelect={() => onSelect(f.id)}
                onPlay={onPlay}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
