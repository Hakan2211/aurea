/* "Normalize to lane" (production experience plan P4). The dialog runs the
 * dry run first and shows the diff — canvas from → to, base-track order
 * before → after, what is missing — then applies on a second, deliberate
 * click. Calls the same procedure the normalize_project tool does. */

import { SelectBox } from "@/components/ui/SelectBox";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { GhostButton, GoldButton, Modal, ModalHeader, cx } from "@/components/ui";
import type { useProduction } from "@/hooks";
import { useVideoPresets } from "@/hooks";
import { sectionLabel, selectInput } from "../studio/shared";

type Plan = Awaited<ReturnType<ReturnType<typeof useProduction>["normalize"]>>["plan"];

export function NormalizeDialog({
  open,
  onClose,
  prod,
}: {
  open: boolean;
  onClose: () => void;
  prod: ReturnType<typeof useProduction>;
}) {
  const lanes = useVideoPresets();
  const [lane, setLane] = useState<string>("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // the diff is re-read whenever the dialog opens or the lane changes
  useEffect(() => {
    if (!open) return;
    let live = true;
    setError(null);
    setDone(null);
    setPlan(null);
    prod
      .normalize({ lane: lane || undefined, dryRun: true })
      .then((r) => live && setPlan(r.plan))
      .catch((err) => live && setError(String((err as Error).message)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lane]);

  const apply = async () => {
    setError(null);
    try {
      const r = await prod.normalize({ lane: lane || undefined, dryRun: false });
      setPlan(r.plan);
      setDone(
        `Applied — ${r.timeline.width}×${r.timeline.height}, ${r.plan.order.after.length} clip${r.plan.order.after.length === 1 ? "" : "s"} in script order${r.job ? `, export queued (${r.job.title})` : ""}.`,
      );
    } catch (err) {
      setError(String((err as Error).message));
    }
  };

  const nothing = plan && !plan.canvas.to && !plan.order.changed;

  return (
    <Modal open={open} onClose={onClose} size="md">
      <ModalHeader
        title="Normalize to lane"
        sub="Canvas, script order, and a −16 LUFS export — the once-only rules, run again on purpose"
        onClose={onClose}
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div>
          <p className={sectionLabel}>Canvas from</p>
          <SelectBox value={lane} onChange={(e) => setLane(e.target.value)} className={cx(selectInput, "mt-1.5 w-full")}>
            <option value="">The approved takes' own canvas</option>
            {lanes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.payload.resolution ? ` · ${p.payload.resolution}` : ""}
              </option>
            ))}
          </SelectBox>
        </div>

        {error && <p className="text-xs text-[#f0a89d]">{error}</p>}
        {!plan && !error && <p className="text-xs text-fog">Reading the sequence…</p>}

        {plan && (
          <>
            <div className="rounded-xl border hairline bg-surface/50 p-3">
              <p className={sectionLabel}>Canvas</p>
              <p className="mt-1 flex items-center gap-2 text-sm text-cream">
                <span className="font-mono tabular-nums">
                  {plan.canvas.from.width}×{plan.canvas.from.height}
                </span>
                {plan.canvas.to && (
                  <>
                    <ArrowRight size={12} className="text-gold" />
                    <span className="font-mono tabular-nums text-gold">
                      {plan.canvas.to.width}×{plan.canvas.to.height}
                    </span>
                  </>
                )}
              </p>
              <p className="mt-0.5 text-2xs text-fog">{plan.canvas.detail}</p>
            </div>

            <div className="rounded-xl border hairline bg-surface/50 p-3">
              <p className={sectionLabel}>Base track{plan.order.changed ? " · re-laid" : " · already in script order"}</p>
              <div className="mt-1.5 grid grid-cols-2 gap-3">
                <OrderList title="Now" items={plan.order.before} />
                <OrderList title="Script order" items={plan.order.after} highlight={plan.order.changed} />
              </div>
            </div>

            {plan.notes.length > 0 && (
              <ul className="space-y-1">
                {plan.notes.map((n, i) => (
                  <li key={i} className="text-2xs leading-snug text-fog">
                    · {n}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {done && <p className="text-xs text-sage">{done}</p>}
      </div>
      <footer className="flex shrink-0 items-center gap-2 border-t hairline px-5 py-3">
        <span className="text-2xs text-fog">
          {nothing ? "Nothing to change — the export still re-runs at −16 LUFS." : "The diff above is what will change."}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <GhostButton onClick={onClose}>Close</GhostButton>
          <GoldButton onClick={apply} disabled={!plan || prod.normalizing || !!done}>
            {prod.normalizing ? "Applying…" : "Apply and export"}
          </GoldButton>
        </span>
      </footer>
    </Modal>
  );
}

function OrderList({ title, items, highlight }: { title: string; items: string[]; highlight?: boolean }) {
  return (
    <div>
      <p className="text-2xs uppercase tracking-wide text-fog">{title}</p>
      <ol className="mt-1 space-y-0.5">
        {items.length === 0 && <li className="text-2xs text-fog/50">—</li>}
        {items.map((label, i) => (
          <li key={`${label}-${i}`} className={cx("truncate text-xs", highlight ? "text-gold" : "text-cream/80")}>
            <span className="mr-1.5 font-mono text-2xs text-fog">{String(i + 1).padStart(2, "0")}</span>
            {label}
          </li>
        ))}
      </ol>
    </div>
  );
}
