/* The one bar across the top (UI-SIMPLIFY-PLAN.md Stage 1). It replaces three
 * things: the Electron title strip, the GPU/VRAM/queue status strip, and the
 * project card at the foot of the old rail.
 *
 *   [A] [project ▾]      [ Search, jump to…  Ctrl K ]      [Director] [queue pill]
 *
 * Inside Electron the whole bar is the window's drag region (buttons opt out)
 * and the right edge leaves room for the native window controls, which
 * main.ts sizes to this bar's 48px.
 *
 * The stale-build warning moved here from GlobalStatus unchanged — see that
 * history: an app serving an old studiod looks perfectly healthy, and this
 * chip is the only tell. */

import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router";
import { ChevronDown, Loader2, MessagesSquare, Pause, RefreshCw, Search } from "lucide-react";
import { useJobs, useProjects, useSystem } from "@/hooks";
import { cx } from "@/components/ui";
import { useDirector } from "@/components/DirectorPanel";

const isElectron = () => !!window.aurea?.isElectron;

function ProjectSwitcher() {
  const { projects, active, setActive } = useProjects();
  if (!active) return null;
  return (
    <label className="relative flex h-9 items-center rounded-lg border border-cream/10 bg-surface pl-3 pr-8 transition-colors hover:border-cream/20">
      <span className="sr-only">Project</span>
      <select
        value={active.id}
        onChange={(e) => setActive(e.target.value)}
        title="Switch project — every screen follows"
        className="max-w-[220px] cursor-pointer appearance-none truncate border-0 bg-transparent p-0 text-sm font-medium text-cream outline-none [&>option]:bg-ink"
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 text-fog" />
    </label>
  );
}

function QueuePill() {
  const { jobs, vram, paused, live } = useJobs();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const running = jobs.filter((j) => j.status === "running");
  const queued = jobs.filter((j) => j.status === "queued");
  const active = [...running, ...queued];
  const busy = running.length > 0;
  const usedPct = vram.total ? Math.min(100, (vram.used / vram.total) * 100) : 0;

  const label = paused
    ? `Queue paused${queued.length ? ` · ${queued.length} waiting` : ""}`
    : busy
      ? `${running.length} rendering${queued.length ? ` · ${queued.length} queued` : ""}`
      : live
        ? "Idle"
        : "Core offline";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Render queue: ${label}. GPU memory ${vram.used.toFixed(1)} of ${vram.total} GB`}
        className={cx(
          "flex h-9 items-center gap-2.5 rounded-full border px-3.5 text-sm transition-colors",
          busy
            ? "border-gold/30 bg-gold/8 text-gold hover:bg-gold/12"
            : "border-cream/10 text-fog hover:border-cream/20 hover:text-cream",
        )}
      >
        {paused ? (
          <Pause size={13} />
        ) : busy ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <span className={cx("h-2 w-2 rounded-full", live ? "bg-sage" : "bg-fog/50")} />
        )}
        <span className="font-medium">{label}</span>
        <span className="hidden items-center gap-1.5 text-fog lg:flex">
          <span className="h-1 w-12 overflow-hidden rounded-full bg-cream/10">
            <span className="block h-full bg-gold/80" style={{ width: `${usedPct}%` }} />
          </span>
          <span className="tabular-nums">{vram.used.toFixed(0)}/{vram.total} GB</span>
        </span>
      </button>

      {open && (
        <div className="anim-scale-in absolute right-0 top-11 z-[var(--z-modal)] w-[360px] rounded-panel border border-cream/10 bg-surface p-4 shadow-2xl shadow-ink/80">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-fog">
              Render queue
            </span>
            <span className="text-xs tabular-nums text-fog">
              GPU {vram.used.toFixed(1)} / {vram.total} GB
            </span>
          </div>
          {active.length === 0 ? (
            <p className="py-3 text-sm text-fog">Nothing rendering. New jobs appear here.</p>
          ) : (
            <ul className="flex max-h-[320px] flex-col gap-3 overflow-y-auto">
              {active.slice(0, 6).map((j) => (
                <li key={j.id} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate text-cream">{j.title}</span>
                    <span className="shrink-0 text-xs text-fog">
                      {j.status === "queued" ? "Queued" : `${j.stage ?? "Rendering"} ${Math.round(j.progress)}%`}
                    </span>
                  </div>
                  <span className="h-1 overflow-hidden rounded-full bg-cream/10">
                    <span
                      className="block h-full rounded-full bg-gold"
                      style={{ width: `${j.status === "queued" ? 0 : j.progress}%` }}
                    />
                  </span>
                </li>
              ))}
              {active.length > 6 && (
                <li className="text-xs text-fog">and {active.length - 6} more…</li>
              )}
            </ul>
          )}
          <NavLink
            to="/jobs"
            onClick={() => setOpen(false)}
            className="mt-4 flex h-9 items-center justify-center rounded-lg border border-cream/10 text-sm text-cream transition hover:bg-cream/5"
          >
            Open all jobs
          </NavLink>
        </div>
      )}
    </div>
  );
}

export function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { system } = useSystem();
  const director = useDirector();
  const electron = isElectron();

  return (
    <header
      className={cx(
        "flex h-12 shrink-0 items-center gap-3 border-b hairline bg-ink pl-3",
        electron ? "drag-region pr-[150px]" : "pr-3",
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gold/30 select-none">
        <span className="font-serif text-base font-semibold text-gold">A</span>
      </div>
      <ProjectSwitcher />

      <button
        onClick={onOpenPalette}
        className="mx-auto flex h-9 w-full max-w-[460px] min-w-[180px] items-center gap-2.5 rounded-lg border border-cream/10 bg-surface px-3 text-sm text-fog transition-colors hover:border-cream/20 hover:text-cream"
      >
        <Search size={15} />
        <span className="flex-1 truncate text-left">Search or jump to…</span>
        <kbd className="rounded border border-cream/15 px-1.5 font-sans text-xs text-fog">Ctrl K</kbd>
      </button>

      {system.staleBuild && (
        <span
          title="Quit and reopen Aurea — the launcher rebuilds anything stale on the way up"
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-gold/12 px-2 py-1 text-xs font-medium text-gold"
        >
          <RefreshCw size={12} />
          Update ready — restart
        </span>
      )}

      <button
        onClick={director.toggle}
        aria-pressed={director.open}
        title="Show or hide the Director (Ctrl J)"
        className={cx(
          "flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors",
          director.open
            ? "border-gold/40 bg-gold/12 text-gold"
            : "border-cream/10 text-cream hover:border-cream/20 hover:bg-cream/5",
        )}
      >
        <MessagesSquare size={15} />
        Director
      </button>

      <QueuePill />
    </header>
  );
}
