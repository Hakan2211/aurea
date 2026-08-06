import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cx } from "./cx";

/* The one modal. The app previously carried seven independent fixed-inset
 * overlays with different scrims, blurs and z-indexes; every dialog now rides
 * this portal — one scrim, one z layer (--z-modal), one entrance motion,
 * escape + click-away + a basic focus trap for free. */
export function Modal({
  open,
  onClose,
  children,
  size = "md",
  className,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** md = dialogs/forms · lg = pickers · full = lightbox-scale surfaces */
  size?: "sm" | "md" | "lg" | "full";
  className?: string;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && ref.current) {
        // keep tabbing inside the dialog — the app behind it is inert
        const focusables = ref.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const sizes: Record<string, string> = {
    sm: "w-[min(420px,92vw)] max-h-[80vh]",
    md: "w-[min(640px,94vw)] max-h-[86vh]",
    lg: "w-[min(1024px,94vw)] max-h-[90vh]",
    full: "h-[min(92vh,1000px)] w-[min(1520px,96vw)]",
  };

  return createPortal(
    <div
      className="anim-fade fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-ink/85 p-6 backdrop-blur-md"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cx(
          "anim-scale-in flex flex-col overflow-hidden rounded-panel border border-cream/10 bg-raised shadow-2xl",
          sizes[size],
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** the standard dialog header — title (serif), optional sub-line, actions slot,
 * and the close affordance every overlay kept re-inventing */
export function ModalHeader({
  title,
  sub,
  onClose,
  children,
  id,
}: {
  title: ReactNode;
  sub?: ReactNode;
  onClose?: () => void;
  /** right-aligned actions (search field, filters) */
  children?: ReactNode;
  id?: string;
}) {
  return (
    <header className="flex shrink-0 items-center gap-4 border-b hairline px-5 py-3.5">
      <div className="min-w-0">
        <h3 id={id} className="font-serif text-lg font-semibold leading-tight text-cream">
          {title}
        </h3>
        {sub && <p className="mt-0.5 text-xs text-fog">{sub}</p>}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {children}
        {onClose && (
          <button
            onClick={onClose}
            title="Close"
            className="rounded-pill border border-cream/10 p-1.5 text-fog transition duration-[var(--dur-fast)] hover:border-gold/40 hover:text-gold"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </header>
  );
}
