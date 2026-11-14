import { useState, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { cx } from "./cx";

/* The lab kit (UI simplify plan, Stage 3). Every Create tab has the same
 * shape: the work fills the screen, a composer bar along the bottom holds
 * what every run needs, and anything else opens in one drawer on the right
 * (Advanced, or a lab's own library/history). These are the shared parts, so
 * the five tabs look and behave alike. */

/** The bar along the bottom of a lab: prompt, the few settings that change
 * every run, then Advanced + Generate on the right. */
export function ComposerBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("shrink-0 border-t hairline bg-[#0e0e10] px-4 pb-3 pt-3", className)}>
      {children}
    </div>
  );
}

/** Opens the Advanced drawer. The chip counts the settings that are not at
 * their defaults, so nothing changes a run without showing from here. */
export function AdvancedButton({
  open,
  onClick,
  customs,
  hint,
}: {
  open: boolean;
  onClick: () => void;
  /** human labels of the non-default settings */
  customs: string[];
  /** what's inside, as hover text when everything is at its default */
  hint: string;
}) {
  return (
    <button
      onClick={onClick}
      title={customs.length ? `Not at their defaults:\n${customs.join("\n")}` : hint}
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs transition",
        open
          ? "border-gold/50 bg-gold/10 text-gold"
          : "border-cream/12 text-cream/85 hover:border-cream/30",
      )}
    >
      <SlidersHorizontal size={13} /> Advanced
      {customs.length > 0 && (
        <span className="rounded-pill bg-gold/20 px-1.5 py-px text-xs font-medium tabular-nums text-gold">
          {customs.length} custom
        </span>
      )}
    </button>
  );
}

/** The one primary button of a lab. Disabled still shows its label, which
 * says what is missing ("Add a reference", "Write a script"). */
export function GenerateButton({
  children,
  onClick,
  disabled,
  title,
  className,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-xl px-6 py-2.5 font-serif text-base font-medium uppercase tracking-[0.18em] text-ink",
        "bg-gradient-to-b from-[#dcc08e] via-gold to-gold-deep transition duration-[var(--dur)]",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_12px_rgba(201,169,110,0.2)]",
        "hover:brightness-110 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_6px_24px_rgba(201,169,110,0.4)]",
        "active:brightness-95 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** The right-hand drawer: a titled column with a close button. A lab shows
 * one drawer at a time. */
export function LabDrawer({
  title,
  summary,
  onClose,
  children,
  width = 360,
}: {
  title: string;
  /** one quiet line beside the title ("2 custom · Seed · Steps") */
  summary?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  return (
    <aside
      className="anim-fade flex shrink-0 flex-col border-l hairline bg-[#0e0e10]"
      style={{ width }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b hairline px-4 py-3">
        <h2 className="shrink-0 text-xs font-semibold uppercase tracking-[0.16em] text-cream">
          {title}
        </h2>
        <span className="min-w-0 flex-1 truncate text-2xs text-fog">{summary}</span>
        <button
          onClick={onClose}
          title={`Close ${title}`}
          className="shrink-0 rounded-md p-1 text-fog transition hover:bg-cream/5 hover:text-gold"
        >
          <X size={14} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}

/** The summary line for an Advanced drawer header. */
export const customsSummary = (customs: string[]) =>
  customs.length ? `${customs.length} custom · ${customs.join(" · ")}` : "All at defaults";

/** A labelled block inside a drawer. */
export function DrawerSection({
  title,
  right,
  note,
  children,
}: {
  title: string;
  right?: ReactNode;
  /** a line of explanation under the controls */
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b hairline px-4 py-3.5 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-2xs font-semibold uppercase tracking-[0.14em] text-fog">{title}</h3>
        {right}
      </div>
      <div className="mt-2.5">{children}</div>
      {note && <p className="mt-2 text-2xs leading-relaxed text-fog">{note}</p>}
    </section>
  );
}

/** A row of mutually exclusive pill choices: aspect, count, length, detail. */
export function ChoiceChips<T extends string | number>({
  value,
  options,
  onChange,
  className,
  disabled,
}: {
  value: T | null;
  options: Array<{ value: T; label: ReactNode; title?: string; disabled?: boolean }>;
  onChange: (v: T) => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div className={cx("flex flex-wrap items-center gap-1", disabled && "pointer-events-none opacity-40", className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          title={o.title}
          disabled={o.disabled}
          className={cx(
            "rounded-pill border px-2.5 py-0.5 text-xs tabular-nums transition duration-[var(--dur-fast)]",
            o.value === value
              ? "border-gold/60 bg-gold/12 text-gold"
              : "border-cream/10 text-cream/75 hover:border-cream/25",
            o.disabled && "cursor-not-allowed opacity-40",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A small labelled number/text field for drawers — label left, input right. */
export function DrawerField({
  label,
  children,
  title,
}: {
  label: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <label title={title} className="flex items-center justify-between gap-3 py-1 text-xs">
      <span className="text-fog">{label}</span>
      {children}
    </label>
  );
}

/** the input style DrawerField wraps */
export const drawerInput =
  "w-24 rounded-lg border border-cream/10 bg-surface px-2 py-1.5 text-right text-xs tabular-nums text-cream placeholder:text-fog/50 focus:border-gold/40 focus:outline-none";

/** Which drawer a lab has open, persisted per lab in localStorage. `null` is
 * closed. Toggling the open drawer closes it. */
export function useLabDrawer<K extends string>(lab: string, allowed: readonly K[]) {
  const key = `aurea.lab.${lab}.drawer`;
  const [drawer, setDrawerState] = useState<K | null>(() => {
    const raw = localStorage.getItem(key);
    return allowed.includes(raw as K) ? (raw as K) : null;
  });
  const setDrawer = (next: K | null) => {
    if (next) localStorage.setItem(key, next);
    else localStorage.removeItem(key);
    setDrawerState(next);
  };
  const toggle = (k: K) => setDrawer(drawer === k ? null : k);
  return { drawer, setDrawer, toggle };
}
