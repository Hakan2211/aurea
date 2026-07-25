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

function JobActions({ job }: { job: Job }) {
  if (job.status === "completed")
    return (
      <span className="flex items-center gap-1 text-[12px] text-sage">
        <Check size={12} /> View result
      </span>
    );
  if (job.status === "failed")
    return (
      <div className="flex items-center gap-2">
        <GhostButton className="border-gold/30 text-gold">
          <RotateCcw size={11} /> Retry
        </GhostButton>
        <GhostButton>
          <X size={11} /> Dismiss
        </GhostButton>
      </div>
    );
  return (
    <GhostButton>
      <X size={11} /> Cancel
    </GhostButton>
  );
}

function JobTableRow({ job }: { job: Job }) {
  const Icon = kindIcon[job.kind];
  const running = job.status === "running";
  const failed = job.status === "failed";
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
          failed ? "border-ember/40 text-[#e07a6b]" : "border-cream/10 text-gold/80",
        )}
      >
        {failed ? <AlertTriangle size={17} strokeWidth={1.5} /> : <Icon size={17} strokeWidth={1.5} />}
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
            <div className={cx("text-[11px]", failed ? "text-[#e07a6b]" : "text-fog/70")}>
              {running ? `ETA ${job.eta}` : failed ? job.error : "Completed"}
            </div>
          </>
        )}
      </div>

      <JobActions job={job} />
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
  const { jobs, vram } = useJobs();
  const { system } = useSystem();
  const inQueue = jobs.filter((j) => j.status === "running" || j.status === "queued").length;
  // the stream lists finished jobs oldest-first; the queue reads better with
  // active work on top and the most recent history right under it
  const active = jobs.filter((j) => j.status === "running" || j.status === "queued");
  const history = jobs.filter((j) => j.status !== "running" && j.status !== "queued").reverse();
  const shown = [...active, ...history];

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
            <button className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-b from-gold to-gold-deep px-3 py-1.5 text-[12px] font-semibold text-ink transition hover:brightness-110">
              <Pause size={12} /> Pause queue
            </button>
            <span className="text-[11px] text-fog">{inQueue} jobs in queue</span>
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
            <JobTableRow key={j.id} job={j} />
          ))}
        </div>

        <footer className="flex items-center justify-between border-t hairline px-6 py-2.5 text-[11px] text-fog">
          <span>{jobs.length} jobs</span>
          <span className="flex items-center gap-1.5">
            <i className="h-1.5 w-1.5 rounded-full bg-sage" /> All systems operational
          </span>
        </footer>
      </section>

      <RightRail />
    </div>
  );
}
