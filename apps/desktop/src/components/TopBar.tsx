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

import { useState } from "react";
import { NavLink, useNavigate } from "react-router";
import {
  Check,
  ChevronsUpDown,
  LayoutGrid,
  Loader2,
  MessagesSquare,
  Pause,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { useJobs, useProjects, useSystem } from "@/hooks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  GoldButton,
  GhostButton,
  Modal,
  ModalHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tip,
  cx,
  inputCls,
} from "@/components/ui";
import { useDirector } from "@/components/DirectorPanel";

const isElectron = () => !!window.aurea?.isElectron;

/** A project's mark: its initials on a tile tinted from its name, so two
 * projects are told apart by colour before their names are read. */
export function ProjectMark({ name, size = 22 }: { name: string; size?: number }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-md font-serif font-semibold text-cream/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(0,0,0,0.5)]"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.46),
        background: `linear-gradient(140deg, hsl(${h} 38% 46%), hsl(${(h + 40) % 360} 34% 24%))`,
      }}
    >
      {initials}
    </span>
  );
}

function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { createProject } = useProjects();
  const [name, setName] = useState("");
  const submit = () => {
    const n = name.trim();
    if (!n) return;
    createProject(n);
    setName("");
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" labelledBy="new-project-title">
      <ModalHeader id="new-project-title" title="New project" sub="A series, a channel, or one piece." onClose={onClose} />
      <form
        className="flex flex-col gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-center gap-3">
          <ProjectMark name={name.trim() || "?"} size={36} />
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            className={cx(inputCls, "h-10 text-base")}
          />
        </div>
        <div className="flex justify-end gap-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <GoldButton disabled={!name.trim()} onClick={submit}>
            Create project
          </GoldButton>
        </div>
      </form>
    </Modal>
  );
}

function ProjectSwitcher() {
  const { projects, active, setActive } = useProjects();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  if (!active) return null;
  return (
    <>
      <DropdownMenu>
        <Tip content="Switch project — every screen follows" side="bottom" align="start">
          <DropdownMenuTrigger
            className={cx(
              "group flex h-9 max-w-[260px] items-center gap-2.5 rounded-lg border border-transparent pl-1.5 pr-2 outline-none",
              "transition-colors duration-[var(--dur-fast)] hover:border-cream/10 hover:bg-cream/[0.04]",
              "focus-visible:ring-2 focus-visible:ring-gold/25 data-[state=open]:border-cream/10 data-[state=open]:bg-cream/[0.05]",
            )}
          >
            <ProjectMark name={active.name} />
            <span className="truncate text-sm font-semibold text-cream">{active.name}</span>
            <ChevronsUpDown
              size={14}
              className="shrink-0 text-fog transition-colors group-hover:text-cream group-data-[state=open]:text-cream"
            />
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="start" className="w-[300px]">
          <DropdownMenuLabel className="flex items-center justify-between">
            Projects
            <span className="font-medium normal-case tracking-normal tabular-nums">{projects.length}</span>
          </DropdownMenuLabel>
          {projects.map((p) => {
            const isActive = p.id === active.id;
            return (
              <DropdownMenuItem
                key={p.id}
                onSelect={() => !isActive && setActive(p.id)}
                className={cx("gap-3 py-1.5", isActive && "bg-gold/[0.07]")}
              >
                <ProjectMark name={p.name} size={30} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cx("truncate font-medium", isActive ? "text-gold" : "text-cream")}>
                    {p.name}
                  </span>
                  {p.meta && <span className="truncate text-xs text-fog">{p.meta}</span>}
                </span>
                {isActive && <Check size={15} className="text-gold" />}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus size={15} className="text-fog" />
            New project…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate("/")}>
            <LayoutGrid size={15} className="text-fog" />
            All projects
            <DropdownMenuShortcut>Home</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewProjectDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function QueuePill() {
  const { jobs, vram, paused, live } = useJobs();
  const [open, setOpen] = useState(false);

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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Render queue: ${label}. GPU memory ${vram.used.toFixed(1)} of ${vram.total} GB`}
        className={cx(
          "flex h-9 shrink-0 items-center gap-2.5 rounded-full border px-3.5 text-sm outline-none transition-colors",
          "focus-visible:ring-2 focus-visible:ring-gold/25",
          busy
            ? "border-gold/30 bg-gold/8 text-gold hover:bg-gold/12"
            : "border-cream/10 text-fog hover:border-cream/20 hover:text-cream",
          open && "border-cream/20",
        )}
      >
        {paused ? (
          <Pause size={13} />
        ) : busy ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <span className="relative flex h-2 w-2">
            {live && <span className="absolute inset-0 animate-ping rounded-full bg-sage/50 [animation-duration:2.4s]" />}
            <span className={cx("relative h-2 w-2 rounded-full", live ? "bg-sage" : "bg-fog/50")} />
          </span>
        )}
        <span className="font-medium">{label}</span>
        <span className="hidden items-center gap-1.5 text-fog lg:flex">
          <span className="h-1 w-12 overflow-hidden rounded-full bg-cream/10">
            <span className="block h-full rounded-full bg-gradient-to-r from-gold-deep to-gold" style={{ width: `${usedPct}%` }} />
          </span>
          <span className="tabular-nums">{vram.used.toFixed(0)}/{vram.total} GB</span>
        </span>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-baseline justify-between border-b hairline px-4 py-3">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-fog">Render queue</span>
          <span className="text-xs tabular-nums text-fog">
            GPU {vram.used.toFixed(1)} / {vram.total} GB
          </span>
        </div>
        <div className="px-4 py-3">
          {active.length === 0 ? (
            <p className="py-3 text-center text-sm text-fog">Nothing rendering. New jobs appear here.</p>
          ) : (
            <ul className="flex max-h-[320px] flex-col gap-3.5 overflow-y-auto">
              {active.slice(0, 6).map((j) => (
                <li key={j.id} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate text-cream">{j.title}</span>
                    <span className="shrink-0 text-xs tabular-nums text-fog">
                      {j.status === "queued" ? "Queued" : `${j.stage ?? "Rendering"} ${Math.round(j.progress)}%`}
                    </span>
                  </div>
                  <span className="h-1 overflow-hidden rounded-full bg-cream/10">
                    <span
                      className="block h-full rounded-full bg-gradient-to-r from-gold-deep to-gold transition-[width] duration-500"
                      style={{ width: `${j.status === "queued" ? 0 : j.progress}%` }}
                    />
                  </span>
                </li>
              ))}
              {active.length > 6 && <li className="text-xs text-fog">and {active.length - 6} more…</li>}
            </ul>
          )}
        </div>
        <div className="border-t hairline p-2">
          <NavLink
            to="/jobs"
            onClick={() => setOpen(false)}
            className="flex h-9 items-center justify-center rounded-lg text-sm text-cream transition hover:bg-cream/5"
          >
            Open all jobs
          </NavLink>
        </div>
      </PopoverContent>
    </Popover>
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
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gold/30 bg-gradient-to-b from-gold/10 to-transparent select-none">
        <span className="font-serif text-base font-semibold text-gold">A</span>
      </div>
      <span aria-hidden className="h-5 w-px bg-cream/10" />
      <ProjectSwitcher />

      <button
        onClick={onOpenPalette}
        className="group mx-auto flex h-9 w-full max-w-[460px] min-w-[180px] items-center gap-2.5 rounded-lg border border-cream/10 bg-surface/80 px-3 text-sm text-fog shadow-[inset_0_1px_0_rgba(237,234,228,0.03)] transition-colors hover:border-cream/20 hover:bg-surface hover:text-cream"
      >
        <Search size={15} className="transition-colors group-hover:text-gold" />
        <span className="flex-1 truncate text-left">Search or jump to…</span>
        <kbd className="rounded-md border border-cream/12 bg-ink/60 px-1.5 py-px font-sans text-2xs text-fog">Ctrl K</kbd>
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

      <Tip content={director.open ? "Hide the Director" : "Show the Director"} shortcut="Ctrl J" side="bottom">
      <button
        onClick={director.toggle}
        aria-pressed={director.open}
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
      </Tip>

      <QueuePill />
    </header>
  );
}
