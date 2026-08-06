import {
  Check,
  Film,
  Lightbulb,
  ListOrdered,
  Trash2,
  X,
} from "lucide-react";
import { useJobs, useVideoLab } from "@/hooks";
import type { Job, VideoStage } from "@/data/sample";
import { Progress, ProgressRing, cx } from "@/components/ui";

/* ---------- right rail: render queue + this render's stages ---------- */

function StageRow({ stage, index, last }: { stage: VideoStage; index: number; last: boolean }) {
  const done = stage.status === "completed";
  const running = stage.status === "running";
  return (
    <div className="relative flex gap-2.5 pb-4 last:pb-0">
      {!last && <span className="absolute bottom-0 left-[10px] top-5 w-px bg-gold/25" />}
      <span
        className={cx(
          "z-[1] flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[9px] font-semibold tabular-nums",
          done
            ? "border-gold bg-gradient-to-b from-gold to-gold-deep text-ink"
            : running
              ? "border-gold/70 bg-[#0e0e10] text-gold"
              : "border-cream/15 bg-[#0e0e10] text-fog",
        )}
      >
        {done ? <Check size={10} /> : index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cx("text-xs font-medium", stage.status === "pending" ? "text-fog" : "text-cream")}>
            {stage.label}
          </span>
          <span
            className={cx(
              "shrink-0 text-[9px]",
              done ? "text-fog" : running ? "text-gold" : "text-fog/60",
            )}
          >
            {done ? "Completed" : running ? "In progress" : "Pending"}
          </span>
        </div>
        {stage.detail && <div className="truncate text-[10px] text-fog">{stage.detail}</div>}
        {running && stage.progress != null && (
          <div className="mt-1.5 flex items-center gap-2">
            <Progress value={stage.progress} className="flex-1" />
            <span className="text-[10px] tabular-nums text-cream/80">{stage.progress}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** One card of the render queue: what's cooking, what's waiting, how far in.
 * Big enough to read at a glance from across the room — this rail is what you
 * look at while a render runs. */
function QueueRow({ job, onCancel }: { job: Job; onCancel?: () => void }) {
  const running = job.status === "running";
  return (
    <div
      className={cx(
        "group relative flex items-center gap-3 rounded-xl border p-2.5 transition",
        running
          ? "border-gold/30 bg-gold/6 shadow-[0_0_18px_rgba(201,169,110,0.08)]"
          : "border-cream/8 bg-surface/50 hover:border-cream/15",
      )}
    >
      <span
        className={cx(
          "flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-lg border",
          running
            ? "border-gold/30 bg-gold/8 text-gold/80"
            : "border-cream/10 bg-cream/4 text-fog/60",
        )}
      >
        <Film size={18} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-cream">{job.title}</div>
        <div className="truncate text-[10px] text-fog">
          {job.engine}
          {job.detail ? ` · ${job.detail}` : ""}
        </div>
        <div className={cx("mt-0.5 text-[10px] font-semibold", running ? "text-gold" : "text-fog/70")}>
          {running ? (job.stage ?? "Rendering") : "Queued"}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-center gap-1">
        <ProgressRing value={running ? job.progress : 0} size={42} stroke={3} />
        {running && job.eta && (
          <span className="text-[9px] tabular-nums text-fog">{job.eta} left</span>
        )}
      </div>

      {onCancel && (
        <button
          onClick={onCancel}
          title="Cancel this render"
          className="absolute right-1 top-1 rounded-full p-1 text-fog/60 opacity-0 transition hover:text-[#e07a6b] group-hover:opacity-100"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

export function JobRail() {
  const lab = useVideoLab();
  const { jobs, vram, live, cancel, clearFinished } = useJobs();
  const pct = Math.min(100, (vram.allocated / vram.total) * 100);
  const queue = jobs.filter(
    (j) => j.kind === "video" && (j.status === "running" || j.status === "queued"),
  );
  const finishedVideo = jobs.some(
    (j) => j.kind === "video" && (j.status === "completed" || j.status === "failed"),
  );
  const running = queue.some((j) => j.status === "running");

  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-l hairline bg-[#0e0e10]">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {/* render queue — the rail's headline: every video job on the engine,
            not just the one this lab last started */}
        <section>
          <div className="flex items-center justify-between pb-2.5">
            <h2 className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.16em] text-cream">
              Render queue
              {queue.length > 0 && (
                <span className="rounded-pill bg-gold/15 px-1.5 py-px text-[9px] font-semibold tabular-nums text-gold">
                  {queue.length}
                </span>
              )}
            </h2>
            <ListOrdered size={13} className="text-fog/60" />
          </div>
          {queue.length > 0 ? (
            <div className="space-y-2">
              {queue.map((j) => (
                <QueueRow
                  key={j.id}
                  job={j}
                  onCancel={live ? () => cancel(j.id) : undefined}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-cream/8 bg-surface/30 px-3 py-5 text-center text-2xs text-fog/70">
              Nothing rendering — the queue is clear.
            </p>
          )}
          {finishedVideo && live && (
            <button
              onClick={clearFinished}
              title="Clear completed jobs"
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-2xs text-fog transition hover:bg-cream/5 hover:text-gold"
            >
              <Trash2 size={11} /> Clear completed
            </button>
          )}
        </section>

        {/* the stage breakdown of the one render in flight — only worth the
            space while something is actually moving through it */}
        {running && lab.job.stages.length > 0 && (
          <section>
            <div className="flex items-baseline justify-between pb-2.5">
              <h2 className="text-2xs font-semibold uppercase tracking-[0.16em] text-cream">
                This render
              </h2>
              <span className="text-2xs tabular-nums text-fog">{lab.job.elapsed}</span>
            </div>
            <div className="px-1">
              {lab.job.stages.map((st, i) => (
                <StageRow key={st.id} stage={st} index={i} last={i === lab.job.stages.length - 1} />
              ))}
            </div>
          </section>
        )}

        {/* tip */}
        <section className="rounded-xl border border-gold/15 bg-gold/4 p-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-gold">
            <Lightbulb size={12} /> Tip
          </div>
          <p className="mt-1.5 text-2xs leading-relaxed text-fog">{lab.tip}</p>
        </section>
      </div>

      {/* the footer used to hold three buttons that did nothing; it now carries
          the one number you check before starting another render */}
      <div className="shrink-0 border-t hairline px-4 py-3">
        <div className="flex items-baseline justify-between text-2xs">
          <span className="text-fog">VRAM</span>
          <span className="tabular-nums text-cream/90">
            {vram.allocated} / {vram.total} GB
          </span>
        </div>
        <Progress value={pct} className="mt-1.5" />
      </div>
    </aside>
  );
}
