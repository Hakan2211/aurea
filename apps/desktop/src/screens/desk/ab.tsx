/* A/B results — the review end of the experiment queue.
 *
 * The lab queues a run (one base payload, N recipes, one seed); this is where
 * the answer is read. Two things matter and neither survives in anyone's head:
 * the wall clock per variant, and the takes playing next to each other. Both
 * come off the run record on disk, so a run read back next month still has its
 * numbers even though the job history rolled over long ago. */

import { useMemo, useState } from "react";
import { FlaskConical, Trash2 } from "lucide-react";
import type { AbRun } from "@aurea/shared";
import { Modal, ModalHeader, cx } from "@/components/ui";
import { useVideoAb } from "@/hooks";

const STATUS_TONE: Record<string, string> = {
  completed: "text-emerald-300",
  failed: "text-red-300",
  running: "text-gold",
  queued: "text-fog",
};

/** mm:ss — the only unit an experiment is ever compared in */
const fmtMs = (ms: number | undefined) => {
  if (ms === undefined) return "—";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** How much slower than the fastest FINISHED variant. Percentages against a
 * variant that hasn't finished yet would move every time the page polls. */
function relative(run: AbRun): (ms: number | undefined) => string | null {
  const times = run.variants.map((v) => v.renderMs).filter((n): n is number => !!n);
  const best = times.length > 1 ? Math.min(...times) : null;
  return (ms) =>
    best && ms && ms > best ? `+${Math.round(((ms - best) / best) * 100)}%` : best && ms ? "fastest" : null;
}

export function AbResults({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ab = useVideoAb();
  const [openId, setOpenId] = useState<string | null>(null);
  const runs = ab.runs;
  const current = useMemo(
    () => runs.find((r) => r.id === openId) ?? runs[0] ?? null,
    [runs, openId],
  );

  return (
    <Modal open={open} onClose={onClose} size="full">
      <ModalHeader
        title="A/B renders"
        sub="Same shot, same seed, one thing changed — queued from the Video lab"
        onClose={onClose}
      />
      <div className="flex min-h-0 flex-1">
        <aside className="w-[260px] shrink-0 overflow-y-auto border-r hairline p-3">
          {runs.length === 0 && (
            <p className="px-1 py-6 text-center text-2xs leading-relaxed text-fog">
              No experiments yet. In the Video lab, configure a shot and hit “A/B this shot”.
            </p>
          )}
          {runs.map((run) => {
            const done = run.variants.filter((v) => v.status === "completed").length;
            return (
              <button
                key={run.id}
                onClick={() => setOpenId(run.id)}
                className={cx(
                  "mb-1.5 w-full rounded-lg border px-2.5 py-2 text-left transition",
                  current?.id === run.id
                    ? "border-gold/40 bg-gold/5"
                    : "border-cream/10 hover:border-cream/25",
                )}
              >
                <p className="truncate text-xs font-medium text-cream/90">{run.title}</p>
                <p className="mt-0.5 text-2xs tabular-nums text-fog">
                  {run.createdAt.slice(0, 16).replace("T", " ")} · {run.engine} · seed {run.seed}
                </p>
                <p className="mt-0.5 text-2xs tabular-nums text-fog">
                  {done}/{run.variants.length} rendered
                </p>
              </button>
            );
          })}
        </aside>

        {current ? (
          <section className="min-w-0 flex-1 overflow-y-auto p-5">
            <header className="flex items-start gap-3">
              <div className="min-w-0">
                <h4 className="font-serif text-base text-cream">{current.title}</h4>
                {current.notes && (
                  <p className="mt-0.5 text-2xs leading-relaxed text-fog">{current.notes}</p>
                )}
                <p className="mt-1 text-2xs tabular-nums text-fog">
                  {current.base.resolution} · {current.base.durationSec}s · seed {current.seed}
                </p>
              </div>
              <button
                onClick={() => {
                  ab.remove(current.id);
                  setOpenId(null);
                }}
                title="Delete this run's record (the takes stay in the library)"
                className="ml-auto shrink-0 rounded-md border border-cream/10 p-1.5 text-fog transition hover:border-red-400/40 hover:text-red-300"
              >
                <Trash2 size={13} />
              </button>
            </header>

            <div className="mt-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
              {current.variants.map((v, i) => {
                const url = ab.takeUrl(v.output);
                const rel = relative(current)(v.renderMs);
                return (
                  <article
                    key={v.jobId}
                    className="overflow-hidden rounded-panel border border-cream/10 bg-ink/50"
                  >
                    <div className="aspect-video bg-black/60">
                      {url ? (
                        <video
                          src={url}
                          controls
                          loop
                          muted
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-2xs text-fog">
                          {v.status === "failed" ? "failed" : "rendering…"}
                        </div>
                      )}
                    </div>
                    <div className="p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-serif text-sm text-gold">
                          {String.fromCharCode(65 + i)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs text-cream/90">
                          {v.label}
                        </span>
                        <span
                          className={cx(
                            "shrink-0 text-2xs uppercase tracking-wider",
                            STATUS_TONE[v.status] ?? "text-fog",
                          )}
                        >
                          {v.status}
                        </span>
                      </div>
                      <p className="mt-1 text-2xs tabular-nums text-cream/80">
                        {fmtMs(v.renderMs)}
                        {rel && (
                          <span className={cx("ml-1.5", rel === "fastest" ? "text-emerald-300" : "text-fog")}>
                            {rel}
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-2xs leading-relaxed text-fog">
                        {Object.entries(v.overrides).length
                          ? Object.entries(v.overrides)
                              .map(([k, val]) => `${k}: ${String(val)}`)
                              .join(" · ")
                          : "control — the base payload unchanged"}
                      </p>
                      {v.error && (
                        <p className="mt-1 max-h-16 overflow-y-auto text-2xs leading-relaxed text-red-300">
                          {v.error}
                        </p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : (
          <section className="flex flex-1 items-center justify-center gap-2 text-2xs text-fog">
            <FlaskConical size={14} /> Nothing to compare yet.
          </section>
        )}
      </div>
    </Modal>
  );
}
