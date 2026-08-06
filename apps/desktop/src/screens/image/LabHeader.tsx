import { useEffect, useRef } from "react";
import {
  Check,
  ChevronDown,
  Heart,
  LayoutGrid,
  Maximize2,
  PanelRightClose,
  PanelRightOpen,
  Rows3,
  Search,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { GoldButton, cx } from "@/components/ui";

/* The Image lab's top bar — Image Lab.jpg's toolbar row. Scope on the left
 * ("My Generations ⌄"), search + view + rail toggle in the middle, the gold
 * primary on the right. Everything here filters the roll; nothing here queues
 * work except New generation, which resets the composer. */

export type RollScope = "all" | "favorites" | "upscaled";
export type RollView = "masonry" | "grid" | "list";

const SCOPES: { id: RollScope; label: string; icon: typeof Sparkles; note: string }[] = [
  { id: "all", label: "All generations", icon: Sparkles, note: "everything on the roll" },
  { id: "favorites", label: "Favorites", icon: Heart, note: "stills you hearted" },
  { id: "upscaled", label: "Upscaled", icon: Maximize2, note: "4× and 2K renders" },
];

const VIEWS: { id: RollView; label: string; icon: typeof LayoutGrid }[] = [
  { id: "masonry", label: "Masonry — true aspect ratios", icon: LayoutGrid },
  { id: "grid", label: "Grid — uniform tiles", icon: Square },
  { id: "list", label: "List — one row per still", icon: Rows3 },
];

function ScopeMenu({
  scope,
  setScope,
  open,
  setOpen,
}: {
  scope: RollScope;
  setScope: (s: RollScope) => void;
  open: boolean;
  setOpen: (o: boolean) => void;
}) {
  const active = SCOPES.find((s) => s.id === scope) ?? SCOPES[0];
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cx(
          "flex items-center gap-2 rounded-pill border px-3 py-1.5 transition duration-[var(--dur)]",
          open
            ? "border-gold/45 bg-gold/10 text-gold"
            : "border-cream/10 text-cream/85 hover:border-gold/35 hover:text-gold",
        )}
      >
        <active.icon size={13} />
        <span className="text-xs font-medium">{active.label}</span>
        <ChevronDown size={12} className={cx("transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[var(--z-scrim)]" onClick={() => setOpen(false)} />
          {/* opaque, not .glass — a translucent menu over the params panel let
              the controls behind it read straight through the labels */}
          <div className="anim-scale-in absolute left-0 top-full z-[var(--z-modal)] mt-1.5 w-[236px] origin-top-left overflow-hidden rounded-panel border border-cream/12 bg-raised py-1 shadow-[0_20px_50px_rgba(0,0,0,0.7)]">
            {SCOPES.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setScope(s.id);
                  setOpen(false);
                }}
                className={cx(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left transition duration-[var(--dur-fast)] hover:bg-cream/6",
                  s.id === scope ? "text-gold" : "text-cream/85",
                )}
              >
                <s.icon size={13} className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{s.label}</span>
                  <span className="block truncate text-2xs text-fog">{s.note}</span>
                </span>
                {s.id === scope && <Check size={12} className="shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function LabHeader({
  scope,
  setScope,
  scopeOpen,
  setScopeOpen,
  search,
  setSearch,
  view,
  setView,
  railOpen,
  setRailOpen,
  onNewGeneration,
  subtitle,
}: {
  scope: RollScope;
  setScope: (s: RollScope) => void;
  /** menu open state lives in the screen so the ⌘K-ish shortcuts can close it */
  scopeOpen: boolean;
  setScopeOpen: (o: boolean) => void;
  search: string;
  setSearch: (s: string) => void;
  view: RollView;
  setView: (v: RollView) => void;
  railOpen: boolean;
  setRailOpen: (o: boolean) => void;
  onNewGeneration: () => void;
  /** the live count line — "36 generations · 4 rendering" */
  subtitle: string;
}) {
  const searchRef = useRef<HTMLInputElement>(null);

  // ⌘/Ctrl-F focuses the roll search — the reflex every gallery app trains
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    /* Solid, and `relative z-30`. The stack, low to high: canvas sticky day
       rules (20) < this header and its menu (30) < the app rail when it
       unfurls over the screen (z-scrim 40) < modals (z-modal 50). A
       backdrop-blur here would also make the header its own stacking context
       AND the containing block for the menu's click-away scrim, which left
       the menu painted under the columns and closable only from inside the
       bar — nothing scrolls under this header, so the blur bought nothing. */
    <header className="relative z-30 flex h-[58px] shrink-0 items-center gap-3 border-b hairline bg-[#0c0c0d] px-4">
      <div className="min-w-0">
        <h1 className="font-serif text-lg font-semibold leading-none text-cream">Image lab</h1>
        <p className="mt-1 truncate text-2xs tabular-nums text-fog">{subtitle}</p>
      </div>

      <div className="ml-3 h-6 w-px shrink-0 bg-cream/8" />

      <ScopeMenu scope={scope} setScope={setScope} open={scopeOpen} setOpen={setScopeOpen} />

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <div className="group relative">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fog/70 transition group-focus-within:text-gold"
          />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search generations…"
            className={cx(
              "w-[188px] rounded-pill border border-cream/10 bg-ink/50 py-1.5 pl-8 pr-7 text-xs text-cream",
              "placeholder:text-fog/60 transition-[border-color,box-shadow,width] duration-[var(--dur)]",
              "focus:w-[236px] focus:border-gold/50 focus:outline-none",
              "focus:shadow-[0_0_0_3px_rgba(201,169,110,0.12),0_0_18px_rgba(201,169,110,0.08)]",
            )}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              title="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fog/70 transition hover:text-cream"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-0.5 rounded-pill border border-cream/10 bg-ink/40 p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              title={v.label}
              className={cx(
                "flex h-6 w-7 items-center justify-center rounded-pill transition duration-[var(--dur-fast)]",
                v.id === view
                  ? "bg-gradient-to-b from-gold to-gold-deep text-ink"
                  : "text-fog hover:text-cream",
              )}
            >
              <v.icon size={12} />
            </button>
          ))}
        </div>

        <button
          onClick={() => setRailOpen(!railOpen)}
          title={railOpen ? "Hide history & references" : "Show history & references"}
          className={cx(
            "flex h-7 w-7 items-center justify-center rounded-lg border transition duration-[var(--dur)]",
            railOpen
              ? "border-gold/40 bg-gold/10 text-gold"
              : "border-cream/10 text-fog hover:border-gold/35 hover:text-cream",
          )}
        >
          {railOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
        </button>

        <GoldButton onClick={onNewGeneration} title="Clear the composer and start a fresh prompt">
          <Sparkles size={12} /> New generation
        </GoldButton>
      </div>
    </header>
  );
}
