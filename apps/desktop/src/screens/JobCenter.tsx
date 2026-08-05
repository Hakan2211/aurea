import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  FileAudio,
  FileImage,
  FileMusic,
  FileVideo,
  Gauge,
  HardDrive,
  Lightbulb,
  Pause,
  Play,
  RotateCcw,
  X,
} from "lucide-react";
import { useJobs, useSystem } from "@/hooks";
import type { Job } from "@/data/sample";
import { Chip, GhostButton, Progress, cx } from "@/components/ui";

/* Job center full screen — UI-Design/job center GPU queue (full screen).jpg.
 * One GPU queue with priorities, live progress and VRAM preflight; numbers
 * come from useJobs/useSystem (the studiod tRPC seam). */

const kindIcon = {
  video: FileVideo,
  image: FileImage,
  tts: FileAudio,
  music: FileMusic,
} as const;

const priorityChip: Record<Job["priority"], { tone: "gold" | "sage" | "muted"; label: string }> = {
  interactive: { tone: "gold", label: "Interactive" },
  preview: { tone: "sage", label: "Preview" },
  batch: { tone: "muted", label: "Batch" },
};

/* ---------- header band ---------- */

/** 180° arc gauge for VRAM — pure SVG, no chart dep. */
function VramGauge({ used, total }: { used: number; total: number }) {
  const pct = Math.min(1, used / total);
  const r = 52;
  const circumference = Math.PI * r; // half circle
  return (
    <div className="flex items-center gap-4">
      <svg width="128" height="72" viewBox="0 0 128 72">
        <path
          d={`M 12 66 A ${r} ${r} 0 0 1 116 66`}
          fill="none"
          stroke="rgba(237,234,228,0.1)"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <path
          d={`M 12 66 A ${r} ${r} 0 0 1 116 66`}
          fill="none"
          stroke="url(#vramGrad)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
        />
        <defs>
          <linearGradient id="vramGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#8a6f3c" />
            <stop offset="100%" stopColor="#C9A96E" />
          </linearGradient>
        </defs>
      </svg>
      <div>
        <div className="text-[11px] uppercase tracking-[0.14em] text-fog">VRAM</div>
        <div className="font-serif text-[30px] leading-tight text-cream">
          {used}
          <span className="text-[15px] text-fog"> / {total} GB</span>
        </div>
        <div className="text-[11px] text-fog">{Math.round(pct * 100)}% in use</div>
      </div>
    </div>
  );
}

/** Deterministic temperature sparkline (same trick as Waveform — no random). */
function TempSparkline({ tempC }: { tempC: number }) {
  const points: string[] = [];
  for (let i = 0; i <= 24; i++) {
    const y = 26 - 9 * Math.abs(Math.sin(i * 0.55) * 0.7 + Math.sin(i * 0.21) * 0.3);
    points.push(`${i * 5},${y.toFixed(1)}`);
  }
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.14em] text-fog">GPU temperature</div>
      <div className="mt-0.5 flex items-end gap-3">
        <div className="font-serif text-[30px] leading-tight text-cream">
          {tempC}
          <span className="text-[15px] text-fog"> °C</span>
        </div>
        <svg width="120" height="30" viewBox="0 0 120 30" className="mb-1.5">
          <polyline
            points={points.join(" ")}
            fill="none"
            stroke="#C9A96E"
            strokeWidth="1.5"
            strokeLinejoin="round"
            opacity="0.8"
          />
        </svg>
      </div>
    </div>
  );
}

/* ---------- job table ---------- */

/** the verbs a row can perform, handed down from the screen's useJobs() */
interface JobControls {
  live: boolean;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  dismiss: (id: string) => void;
}

const DEAD_CORE = "studiod isn't answering — reconnect to control the queue";

function JobActions({ job, ctl }: { job: Job; ctl: JobControls }) {
  /* Stopping a render throws away real GPU minutes, so a running job asks
   * twice. A queued one has nothing to lose and goes on the first click. */
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4_000);
    return () => clearTimeout(t);
  }, [armed]);

  if (job.status === "completed")
    return (
      <div className="flex items-center gap-2">
        <a
          href="#/assets"
          className="inline-flex items-center gap-1.5 rounded-lg border border-sage/25 px-3 py-1.5 text-[12px] font-medium text-sage transition hover:border-sage/60"
        >
          <Check size={12} /> View result
        </a>
        <GhostButton
          title={ctl.live ? "Remove from history" : DEAD_CORE}
          disabled={!ctl.live}
          onClick={() => ctl.dismiss(job.id)}
        >
          <X size={11} />
        </GhostButton>
      </div>
    );

  if (job.status === "failed")
    return (
      <div className="flex items-center gap-2">
        <GhostButton
          className="border-gold/30 text-gold"
          title={ctl.live ? "Run this job again" : DEAD_CORE}
          disabled={!ctl.live}
          onClick={() => ctl.retry(job.id)}
        >
          <RotateCcw size={11} /> Retry
        </GhostButton>
        <GhostButton
          title={ctl.live ? "Remove from history" : DEAD_CORE}
          disabled={!ctl.live}
          onClick={() => ctl.dismiss(job.id)}
        >
          <X size={11} /> Dismiss
        </GhostButton>
      </div>
    );

  const running = job.status === "running";
  return (
    <GhostButton
      className={cx(
        armed
          ? "border-ember/60 bg-ember/12 text-[#e07a6b] hover:border-ember hover:text-[#e07a6b]"
          : "hover:border-ember/50 hover:text-[#e07a6b]",
      )}
      disabled={!ctl.live}
      title={
        !ctl.live
          ? DEAD_CORE
          : running
            ? "Stop this render — the GPU work so far is lost"
            : "Take this job out of the queue"
      }
      onClick={() => {
        if (running && !armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        ctl.cancel(job.id);
      }}
    >
      {armed ? (
        <>
          <AlertTriangle size={11} /> Stop it?
        </>
      ) : (
        <>
          <X size={11} /> Cancel
        </>
      )}
    </GhostButton>
  );
}

function JobTableRow({ job, ctl }: { job: Job; ctl: JobControls }) {
  const Icon = kindIcon[job.kind];
  const running = job.status === "running";
  const failed = job.status === "failed";
  // the engine has no "canceled" status — a stopped job is a failed one whose
  // reason is the cancel. Reading it back keeps the row from crying wolf.
  const canceled = failed && /^cancel(l)?ed/i.test(job.error ?? "");
  const prio = priorityChip[job.priority];

  return (
    <div
      className={cx(
        "grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-5 rounded-xl border px-4 py-3.5",
        running
          ? "border-gold/35 bg-surface shadow-[inset_2px_0_0_0_#C9A96E]"
          : "border-transparent bg-surface/60",
      )}
    >
      <div
        className={cx(
          "flex h-11 w-11 items-center justify-center rounded-lg border",
          canceled
            ? "border-cream/10 text-fog"
            : failed
              ? "border-ember/40 text-[#e07a6b]"
              : "border-cream/10 text-gold/80",
        )}
      >
        {canceled ? (
          <X size={17} strokeWidth={1.5} />
        ) : failed ? (
          <AlertTriangle size={17} strokeWidth={1.5} />
        ) : (
          <Icon size={17} strokeWidth={1.5} />
        )}
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <span className="truncate text-[13px] font-medium text-cream">{job.title}</span>
          <Chip tone={prio.tone}>{prio.label}</Chip>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-fog">
          {job.detail && <span>{job.detail} · </span>}
          {job.engine}
          {job.project && <span className="text-fog/60"> · {job.project}</span>}
        </div>
        {running && (
          <div className="mt-2 flex items-center gap-3">
            <Progress value={job.progress} className="max-w-[320px]" />
            <span className="text-[12px] font-semibold text-gold">{job.progress}%</span>
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-gold/80">
              <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />
              {job.stage}
            </span>
          </div>
        )}
        {job.status === "queued" && job.stage && (
          // scheduler wait reason (external batch owns the GPU, VRAM headroom)
          <div className="mt-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-fog">
            <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-fog/60" />
            {job.stage}
          </div>
        )}
      </div>

      <div className="w-[88px] text-right">
        {job.status === "queued" ? (
          <>
            <div className="text-[13px] text-fog">—</div>
            <div className="text-[11px] text-fog/70">Queued</div>
          </>
        ) : (
          <>
            <div className="text-[13px] tabular-nums text-cream/85">{job.elapsed}</div>
            <div
              className={cx("text-[11px]", failed && !canceled ? "text-[#e07a6b]" : "text-fog/70")}
            >
              {running ? `ETA ${job.eta}` : canceled ? "Canceled" : failed ? job.error : "Completed"}
            </div>
          </>
        )}
      </div>

      <JobActions job={job} ctl={ctl} />
    </div>
  );
}

/* ---------- right rail ---------- */

function RailCard({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Gauge;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl bg-surface p-4">
      <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">
        <Icon size={13} className="text-gold/70" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function RightRail() {
  const { system, preflight } = useSystem();
  const specs: [string, string][] = [
    ["GPU", system.gpu],
    ["Driver", system.driver],
    ["CUDA cores", system.cudaCores],
    ["VRAM", system.vram],
    ["RAM", system.ram],
    ["Storage", system.storage],
  ];
  return (
    <aside className="flex w-[300px] shrink-0 flex-col gap-3 overflow-y-auto border-l hairline bg-[#0e0e10] p-3">
      <RailCard icon={Gauge} title="VRAM preflight">
        <p className="mt-2.5 text-[12px] leading-relaxed text-cream/85">{preflight.message}</p>
        <div className="mt-2.5 flex items-center justify-between rounded-lg bg-cream/4 px-2.5 py-2 text-[11px]">
          <span className="text-fog">Estimated after unload</span>
          <span className="font-semibold text-gold">{preflight.after}</span>
        </div>
      </RailCard>

      <RailCard icon={HardDrive} title="System">
        <dl className="mt-2.5 space-y-1.5">
          {specs.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 text-[11px]">
              <dt className="text-fog">{k}</dt>
              <dd className="text-right text-cream/85">{v}</dd>
            </div>
          ))}
        </dl>
      </RailCard>

      <RailCard icon={Lightbulb} title="Tips">
        <p className="mt-2.5 text-[11px] leading-relaxed text-fog">
          Enable <span className="text-cream/80">Auto unload</span> in Settings to reclaim VRAM
          between jobs automatically.
        </p>
        <a href="#/settings" className="mt-2 inline-block text-[11px] text-gold hover:underline">
          Go to Settings →
        </a>
      </RailCard>
    </aside>
  );
}

/* ---------- screen ---------- */

export function JobCenter() {
  const { jobs, vram, paused, live, cancel, retry, dismiss, clearFinished, setPaused } = useJobs();
  const { system } = useSystem();
  const ctl: JobControls = { live, cancel, retry, dismiss };
  // the stream lists finished jobs oldest-first; the queue reads better with
  // active work on top and the most recent history right under it
  const active = jobs.filter((j) => j.status === "running" || j.status === "queued");
  const history = jobs.filter((j) => j.status !== "running" && j.status !== "queued").reverse();
  const shown = [...active, ...history];
  const inQueue = active.length;
  const queued = active.filter((j) => j.status === "queued");

  return (
    <div className="flex h-full">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-stretch gap-4 border-b hairline px-6 py-4">
          <div className="mr-2 flex flex-col justify-center">
            <h1 className="font-serif text-[26px] leading-tight text-cream">Render queue</h1>
            <p className="text-[11px] text-fog">Manage and monitor jobs on your GPU</p>
          </div>

          <div className="glass flex items-center rounded-2xl px-5 py-3">
            <VramGauge used={vram.used} total={vram.total} />
          </div>
          <div className="glass flex items-center rounded-2xl px-5 py-3">
            <TempSparkline tempC={system.tempC} />
          </div>

          <div className="glass ml-auto flex flex-col justify-center gap-2 rounded-2xl px-5 py-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">
              Queue status
            </span>
            <button
              disabled={!live}
              onClick={() => setPaused(!paused)}
              title={
                !live
                  ? DEAD_CORE
                  : paused
                    ? "Start admitting queued jobs again"
                    : "Hold queued jobs — anything already rendering finishes"
              }
              className={cx(
                "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition",
                "disabled:cursor-not-allowed disabled:opacity-40",
                paused
                  ? "border border-gold/40 bg-gold/12 text-gold hover:bg-gold/20"
                  : "bg-gradient-to-b from-gold to-gold-deep text-ink hover:brightness-110",
              )}
            >
              {paused ? <Play size={12} /> : <Pause size={12} />}
              {paused ? "Resume queue" : "Pause queue"}
            </button>
            <span className="text-[11px] text-fog">
              {inQueue} job{inQueue === 1 ? "" : "s"} in queue
              {paused && <span className="text-gold"> · held</span>}
            </span>
          </div>
        </header>

        <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-5 px-10 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-fog/70">
          <span className="w-11" />
          <span>Job</span>
          <span className="w-[88px] text-right">Elapsed</span>
          <span className="pr-2">Actions</span>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-6 pb-4 pt-1">
          {shown.map((j) => (
            <JobTableRow key={j.id} job={j} ctl={ctl} />
          ))}
          {shown.length === 0 && (
            <p className="py-16 text-center text-[12px] text-fog">The queue is empty.</p>
          )}
        </div>

        <footer className="flex items-center gap-4 border-t hairline px-6 py-2.5 text-[11px] text-fog">
          <span>{jobs.length} jobs</span>
          {queued.length > 0 && (
            <button
              disabled={!live}
              onClick={() => queued.forEach((j) => cancel(j.id))}
              title="Take every waiting job out of the queue — running jobs are untouched"
              className="text-fog transition hover:text-[#e07a6b] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Cancel {queued.length} queued
            </button>
          )}
          {history.length > 0 && (
            <button
              disabled={!live}
              onClick={() => clearFinished()}
              title="Empty the finished-jobs history"
              className="text-fog transition hover:text-cream disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clear history
            </button>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            <i className={cx("h-1.5 w-1.5 rounded-full", paused ? "bg-gold" : "bg-sage")} />
            {paused ? "Queue paused" : "All systems operational"}
          </span>
        </footer>
      </section>

      <RightRail />
    </div>
  );
}
