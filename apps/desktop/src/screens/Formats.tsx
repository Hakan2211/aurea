import { useMemo, useState } from "react";
import {
  ArrowRight,
  Bot,
  Cpu,
  Play,
  Search,
  SlidersHorizontal,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { useFormats } from "@/hooks";
import {
  CATEGORIES,
  STAGE_LABELS,
  packById,
  type FormatCard,
} from "@/data/formats";
import { Chip, GhostButton, GoldButton, cx } from "@/components/ui";

/* Formats gallery — UI-Design/formats gallery (videofast recipes).jpg.
 * Cards mirror the REAL videofast registry (10 formats, 12 style packs);
 * "Use format" will hand the recipe to the Director / batch runner via tRPC. */

/* ---------- poster ---------- */

/** Poster art stands in for a real preview still: the format's first style
 * pack paints it with its actual palette (bg, accent glow, mode-aware text). */
function Poster({ format, className }: { format: FormatCard; className?: string }) {
  const pack = packById(format.packs[0]);
  const dark = pack.mode === "dark";
  return (
    <div
      className={cx("relative overflow-hidden", className)}
      style={{ backgroundColor: pack.bg }}
    >
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(120% 90% at 20% 110%, ${pack.accent}33 0%, transparent 55%),
            radial-gradient(90% 70% at 85% -10%, ${pack.accentAlt}26 0%, transparent 50%)`,
        }}
      />
      <div className="absolute inset-0 flex flex-col justify-end p-4">
        <div className="mb-2 h-px w-8" style={{ backgroundColor: pack.accent }} />
        <p
          className="font-serif text-[19px] leading-snug"
          style={{ color: dark ? "#f3efe7" : "#1c1914" }}
        >
          {format.poster}
        </p>
      </div>
      <span
        className="absolute left-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide"
        style={{
          backgroundColor: dark ? "#00000055" : "#ffffff88",
          color: dark ? "#f3efe7cc" : "#1c1914cc",
        }}
      >
        {pack.label}
      </span>
    </div>
  );
}

/* ---------- card ---------- */

function FormatTile({
  format,
  selected,
  onSelect,
}: {
  format: FormatCard;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cx(
        "group flex flex-col overflow-hidden rounded-2xl border text-left transition",
        selected
          ? "border-gold/70 shadow-[0_0_0_1px_rgba(201,169,110,0.35)]"
          : "border-cream/8 hover:border-gold/35",
      )}
    >
      <div className="relative">
        <Poster format={format} className="aspect-[4/5]" />
        <div
          className={cx(
            "absolute inset-x-0 bottom-0 flex justify-center pb-4 transition",
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-gold to-gold-deep px-3 py-1.5 text-[12px] font-semibold text-ink">
            Use format
          </span>
        </div>
        {format.featured && (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-gold px-2 py-0.5 text-[10px] font-semibold text-ink">
            <Sparkles size={10} /> Meta
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 bg-surface px-3.5 py-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-cream">{format.name}</div>
          <div className="mt-0.5 truncate text-[11px] text-fog">{format.tagline}</div>
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cream/12 text-cream/70 transition group-hover:border-gold/50 group-hover:text-gold">
          <Play size={12} className="ml-0.5" />
        </span>
      </div>
    </button>
  );
}

/* ---------- detail panel ---------- */

function DetailPanel({ format, onClose }: { format: FormatCard; onClose: () => void }) {
  return (
    <aside className="flex w-[340px] shrink-0 flex-col overflow-y-auto border-l hairline bg-[#0e0e10]">
      <div className="relative">
        <Poster format={format} className="aspect-[16/10]" />
        <button
          onClick={onClose}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-ink/60 text-cream/80 backdrop-blur transition hover:text-cream"
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex-1 space-y-5 p-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-serif text-[20px] text-cream">{format.name}</h2>
            <Chip tone={format.generate === "llm" ? "violet" : "sage"}>
              {format.generate === "llm" ? (
                <>
                  <Bot size={10} /> LLM-written
                </>
              ) : (
                <>
                  <Cpu size={10} /> Deterministic
                </>
              )}
            </Chip>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-cream/75">{format.recipe}</p>
        </div>

        {format.paradigms && (
          <section>
            <SectionLabel>Paradigms</SectionLabel>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {format.paradigms.map((p) => (
                <Chip key={p} tone="muted">
                  {p}
                </Chip>
              ))}
            </div>
          </section>
        )}

        <section>
          <SectionLabel>Pipeline</SectionLabel>
          <div className="mt-2 flex flex-wrap items-center gap-y-1.5">
            {format.stages.map((s, i) => (
              <span key={s} className="flex items-center">
                {i > 0 && <ArrowRight size={9} className="mx-1 text-fog/50" />}
                <span
                  className={cx(
                    "rounded px-1.5 py-0.5 text-[10px]",
                    s === "assets" ? "bg-gold/15 text-gold" : "bg-cream/6 text-cream/70",
                  )}
                >
                  {STAGE_LABELS[s] ?? s}
                </span>
              </span>
            ))}
          </div>
          {format.stages.includes("assets") && (
            <p className="mt-1.5 text-[10px] text-fog">
              Assets stage generates media locally on your GPU before render.
            </p>
          )}
        </section>

        <section>
          <SectionLabel>Built for these packs</SectionLabel>
          <div className="mt-2 space-y-1.5">
            {format.packs.map((id) => {
              const pack = packById(id);
              return (
                <div key={id} className="flex items-center gap-2.5 rounded-lg bg-surface px-2.5 py-2">
                  <span
                    className="h-5 w-5 shrink-0 rounded-md border border-cream/10"
                    style={{
                      background: `linear-gradient(135deg, ${pack.bg} 55%, ${pack.accent})`,
                    }}
                  />
                  <span className="flex-1 text-[12px] text-cream/85">{pack.label}</span>
                  <span className="text-[10px] text-fog">{pack.mode}</span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <div className="flex gap-2 border-t hairline p-4">
        <GoldButton className="flex-1 justify-center">
          <Wand2 size={12} /> Use format
        </GoldButton>
        <GhostButton>
          <Play size={12} /> Preview
        </GhostButton>
      </div>
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">{children}</h3>
  );
}

/* ---------- screen ---------- */

export function Formats() {
  const { formats } = useFormats();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]["id"]>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return formats.filter(
      (f) =>
        (category === "all" || f.category === category) &&
        (!q ||
          f.name.toLowerCase().includes(q) ||
          f.tagline.toLowerCase().includes(q) ||
          f.recipe.toLowerCase().includes(q)),
    );
  }, [formats, category, query]);

  const selected = formats.find((f) => f.id === selectedId) ?? null;

  return (
    <div className="flex h-full">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b hairline px-6 py-4">
          <h1 className="font-serif text-[26px] text-cream">Formats</h1>
          <span className="text-[11px] text-fog">
            {formats.length} recipes · 12 style packs
          </span>

          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-2 rounded-lg border border-cream/10 bg-surface px-3 py-1.5 transition focus-within:border-gold/40">
              <Search size={13} className="text-fog" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search formats…"
                className="w-44 bg-transparent text-[12px] text-cream placeholder:text-fog focus:outline-none"
              />
            </label>
            <GhostButton>
              <SlidersHorizontal size={12} /> Filters
            </GhostButton>
            <GoldButton>
              <Sparkles size={12} /> Create with AI
            </GoldButton>
          </div>
        </header>

        <div className="flex items-center gap-2 px-6 py-3">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={cx(
                "rounded-full border px-3 py-1 text-[12px] transition",
                category === c.id
                  ? "border-gold/60 bg-gold/12 text-gold"
                  : "border-cream/10 text-cream/70 hover:border-gold/35 hover:text-cream",
              )}
            >
              {c.label}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-fog">
            Sort by: <span className="text-cream/80">Popular</span>
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {visible.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <p className="text-[13px] text-cream/70">No formats match “{query}”.</p>
              <p className="text-[11px] text-fog">Try a paradigm — “manim”, “parallax”, “chart”.</p>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
              {visible.map((f) => (
                <FormatTile
                  key={f.id}
                  format={f}
                  selected={f.id === selectedId}
                  onSelect={() => setSelectedId(f.id === selectedId ? null : f.id)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {selected && <DetailPanel format={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
