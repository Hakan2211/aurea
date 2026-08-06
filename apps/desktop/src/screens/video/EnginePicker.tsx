import { useNavigate } from "react-router";
import { Check, ChevronRight } from "lucide-react";
import { cx } from "@/components/ui";

/* The engine choice, as the design board draws it: three tall cards in a row,
 * each with the maker's mark, the model name, who built it, and a one-word
 * positioning badge. The selected card takes a gold border and a check seal.
 *
 * The catalog (packages/core/src/labs.ts) stays the authority on what an
 * engine IS and whether it's available — everything here is presentation. */

/** display metadata the catalog has no business carrying */
const ENGINE_LOOK: Record<string, { maker: string; badge: string }> = {
  ltx2: { maker: "by Lightricks", badge: "Best quality" },
  // the mockup's H3 badge reads FAST; on this machine H3 is ~10× LTX's render
  // time, so the badge says the thing that's actually true and actually rare
  "minimax-h3": { maker: "by MiniMax", badge: "Native audio" },
  seedance: { maker: "by ByteDance", badge: "Balanced" },
};

/* ---------- maker marks ----------
 * Drawn rather than imported: no external asset can be shipped with the app,
 * and three 34px glyphs are cheaper as paths than as PNGs. */

/** LTX — a radiating burst, rays of alternating length */
function BurstMark({ lit }: { lit: boolean }) {
  const rays = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    const len = i % 2 === 0 ? 15 : 9;
    return {
      x1: 17 + Math.cos(a) * 3,
      y1: 17 + Math.sin(a) * 3,
      x2: 17 + Math.cos(a) * len,
      y2: 17 + Math.sin(a) * len,
      key: i,
    };
  });
  return (
    <svg viewBox="0 0 34 34" className="h-full w-full">
      {rays.map((r) => (
        <line
          key={r.key}
          x1={r.x1}
          y1={r.y1}
          x2={r.x2}
          y2={r.y2}
          stroke="currentColor"
          strokeWidth={r.key % 2 === 0 ? 1.1 : 0.7}
          strokeLinecap="round"
          opacity={lit ? 0.95 : 0.6}
        />
      ))}
      <circle cx={17} cy={17} r={1.6} fill="currentColor" />
    </svg>
  );
}

/** MiniMax — an "M" monogram set in the house serif */
function MonogramMark({ letter }: { letter: string }) {
  return (
    <svg viewBox="0 0 34 34" className="h-full w-full">
      <text
        x={17}
        y={25}
        textAnchor="middle"
        fill="currentColor"
        className="font-serif"
        style={{ fontSize: 26, fontWeight: 500 }}
      >
        {letter}
      </text>
    </svg>
  );
}

/** Seedance — a dotted orbit, dots thinning as they go round */
function OrbitMark() {
  const dots = Array.from({ length: 22 }, (_, i) => {
    const a = (i / 22) * Math.PI * 2;
    const ring = i % 3 === 0 ? 12.5 : 8.5;
    return {
      cx: 17 + Math.cos(a) * ring,
      cy: 17 + Math.sin(a) * ring,
      r: i % 3 === 0 ? 1.1 : 0.75,
      o: 0.35 + (i / 22) * 0.6,
      key: i,
    };
  });
  return (
    <svg viewBox="0 0 34 34" className="h-full w-full">
      {dots.map((d) => (
        <circle key={d.key} cx={d.cx} cy={d.cy} r={d.r} fill="currentColor" opacity={d.o} />
      ))}
    </svg>
  );
}

function EngineMark({ id, lit }: { id: string; lit: boolean }) {
  if (id === "minimax-h3") return <MonogramMark letter="M" />;
  if (id === "seedance") return <OrbitMark />;
  return <BurstMark lit={lit} />;
}

export interface EngineOption {
  id: string;
  label: string;
  sub: string;
  note: string;
}

export function EnginePicker({
  engines,
  value,
  onChange,
  note,
}: {
  engines: EngineOption[];
  value: string;
  onChange: (id: string) => void;
  /** the catalog's live line about the chosen engine on THIS machine */
  note?: string;
}) {
  const navigate = useNavigate();
  return (
    <section>
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.14em] text-fog">
          <span className="step-numeral">1</span>
          Engine
        </h3>
        <button
          onClick={() => navigate("/settings")}
          title="Engine setup — URLs, managed vs external, weights"
          className="inline-flex items-center gap-0.5 text-2xs text-fog transition hover:text-gold"
        >
          View all engines <ChevronRight size={11} />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {engines.map((e) => {
          const on = e.id === value;
          const look = ENGINE_LOOK[e.id];
          return (
            <button
              key={e.id}
              onClick={() => onChange(e.id)}
              title={e.note}
              className={cx(
                "relative flex flex-col items-center rounded-xl border px-1.5 pb-2 pt-3.5",
                "transition duration-[var(--dur-fast)]",
                on
                  ? "border-gold/60 bg-gold/6 shadow-[0_0_18px_rgba(201,169,110,0.1)]"
                  : "border-cream/10 hover:border-cream/25",
              )}
            >
              {on && (
                <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-b from-gold to-gold-deep text-ink shadow-[0_2px_8px_rgba(201,169,110,0.45)]">
                  <Check size={10} strokeWidth={3} />
                </span>
              )}

              <span className={cx("h-8 w-8", on ? "text-gold" : "text-cream/40")}>
                <EngineMark id={e.id} lit={on} />
              </span>

              <span
                className={cx(
                  "mt-2 w-full truncate text-center text-[11px] font-medium leading-tight",
                  on ? "text-cream" : "text-cream/85",
                )}
              >
                {e.label}
              </span>
              <span className="w-full truncate text-center text-[8px] leading-tight text-fog/80">
                {look?.maker ?? e.sub}
              </span>

              {look && (
                <span
                  className={cx(
                    "mt-1.5 w-full truncate rounded-[3px] border px-1 py-px text-center text-[7px] font-semibold uppercase tracking-[0.08em]",
                    on ? "border-gold/45 bg-gold/10 text-gold" : "border-cream/12 text-fog",
                  )}
                >
                  {look.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {note && <p className="mt-1.5 text-2xs leading-relaxed text-fog/70">{note}</p>}
    </section>
  );
}
