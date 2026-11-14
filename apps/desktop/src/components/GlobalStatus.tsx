/* The global status strip — GPU, VRAM and the queue, one line across the top
 * of every screen. It exists because the Director/Storyboard merge evicted the
 * job rail: the numbers you glance at belong to the machine, not to one route,
 * and the full queue is a click away in Jobs.
 *
 * It also carries the stale-build warning, because there is nowhere else a
 * person would think to look. Electron loads dist-electron/studiod.js once at
 * startup; rebuild it while the app is open and the app keeps serving the old
 * backend, looking perfectly healthy. That is how an engine fix can be shipped,
 * verified end to end, and still appear not to work at all — the app was never
 * running it. This line is the only thing standing between that and an
 * afternoon of debugging code that isn't executing. */

import { NavLink } from "react-router";
import { Loader2, Pause, RefreshCw } from "lucide-react";
import { useJobs, useSystem } from "@/hooks";
import { cx } from "@/components/ui";

export function GlobalStatus() {
  const { jobs, vram, paused, live } = useJobs();
  const { system } = useSystem();

  const running = jobs.filter((j) => j.status === "running");
  const queued = jobs.filter((j) => j.status === "queued").length;
  /* the honest ETA is the longest one in flight — the queue is done when the
   * slowest job is */
  const eta = running.map((j) => j.eta).filter(Boolean)[0];
  const usedPct = vram.total ? (vram.used / vram.total) * 100 : 0;
  const allocPct = vram.total ? ((vram.allocated - vram.used) / vram.total) * 100 : 0;

  return (
    <div className="flex h-7 shrink-0 items-center gap-4 border-b hairline bg-[#0c0c0d] px-4 text-2xs text-fog">
      <span className="truncate text-cream/70">{system.gpu}</span>

      <span className="flex shrink-0 items-center gap-2" title={`${vram.used} of ${vram.total} GB in use`}>
        <span className="uppercase tracking-[0.14em]">VRAM</span>
        <span className="flex h-1 w-20 gap-px overflow-hidden rounded-full bg-cream/8">
          <span className="bg-gold" style={{ width: `${usedPct}%` }} />
          <span className="bg-gold/35" style={{ width: `${allocPct}%` }} />
        </span>
        <span className="tabular-nums text-cream/70">
          {vram.used.toFixed(1)} / {vram.total} GB
        </span>
      </span>

      {system.staleBuild && (
        <span
          title="Quit and reopen Aurea — the launcher rebuilds anything stale on the way up"
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-gold/12 px-2 py-0.5 font-medium text-gold"
        >
          <RefreshCw size={10} />
          Update ready — restart Aurea
        </span>
      )}

      <NavLink
        to="/jobs"
        title="Open the job center"
        className={cx(
          "ml-auto flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 transition hover:text-cream",
          running.length > 0 && "text-gold",
        )}
      >
        {paused ? (
          <>
            <Pause size={10} /> Queue paused
            {queued > 0 && <span className="text-fog">· {queued} waiting</span>}
          </>
        ) : running.length > 0 ? (
          <>
            <Loader2 size={10} className="animate-spin" />
            {running.length} rendering
            {queued > 0 && <span className="text-fog">· {queued} queued</span>}
            {eta && <span className="text-fog">· ETA {eta}</span>}
          </>
        ) : (
          <span>{live ? "Queue idle" : "Studio core offline"}</span>
        )}
      </NavLink>
    </div>
  );
}
