import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router";
import {
  BookOpen,
  Clapperboard,
  Film,
  FolderOpen,
  Gauge,
  Image,
  Layers,
  LayoutGrid,
  MessagesSquare,
  Mic,
  Music,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from "lucide-react";
import { cx } from "@/components/ui";
import { GlobalStatus } from "@/components/GlobalStatus";
import { useProjects } from "@/hooks";
import { trpc } from "@/trpc";

type NavItem = {
  to: string;
  label: string;
  icon: typeof MessagesSquare;
  end?: boolean;
};

const navSections: { label: string; items: NavItem[] }[] = [
  {
    label: "Direct",
    // Director = chat + storyboard since the 2026-08-06 merge; /storyboard redirects
    items: [{ to: "/", label: "Director", icon: MessagesSquare, end: true }],
  },
  {
    label: "Story",
    // Studio = screenplay + board since the same merge; /script redirects
    items: [
      { to: "/studio", label: "Studio", icon: Layers },
      { to: "/bible", label: "Bible", icon: BookOpen },
    ],
  },
  {
    label: "Labs",
    items: [
      { to: "/images", label: "Image lab", icon: Image },
      { to: "/voice", label: "Voice lab", icon: Mic },
      { to: "/music", label: "Music lab", icon: Music },
      { to: "/video", label: "Video gen", icon: Clapperboard },
    ],
  },
  {
    label: "Assemble",
    items: [
      { to: "/timeline", label: "Timeline", icon: Film },
      { to: "/formats", label: "Formats", icon: LayoutGrid },
    ],
  },
  {
    label: "Manage",
    items: [
      { to: "/assets", label: "Assets", icon: FolderOpen },
      { to: "/jobs", label: "Jobs", icon: Gauge },
    ],
  },
];

const RAIL = 64;
const RAIL_WIDE = 208;
/** hover intent — a mouse crossing the rail on its way somewhere else
 * shouldn't unfurl it */
const EXPAND_DELAY_MS = 150;
const COLLAPSE_DELAY_MS = 250;
const PIN_KEY = "aurea:rail-pinned";

function RailLink({
  to,
  label,
  icon: Icon,
  end,
  badge,
  expanded,
}: NavItem & { badge?: number; expanded: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      title={expanded ? undefined : badge ? `${label} — ${badge} running` : label}
      className={({ isActive }) =>
        cx(
          "group/link relative mx-3 flex h-10 items-center rounded-xl transition-colors duration-[var(--dur-fast)]",
          isActive ? "bg-gold/12 text-gold" : "text-fog hover:bg-cream/5 hover:text-cream",
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* the active indicator — a gold bar that grows in, one per rail */}
          <span
            className={cx(
              "absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-gold to-gold-deep",
              "shadow-[0_0_12px_1px_rgba(201,169,110,0.55)]",
              "origin-center transition-transform duration-[var(--dur)] ease-[var(--ease-spring)]",
              isActive ? "scale-y-100" : "scale-y-0",
            )}
          />
          <span className="relative flex w-10 shrink-0 items-center justify-center">
            <Icon size={18} strokeWidth={isActive ? 2 : 1.75} />
            {!!badge && (
              <span className="absolute -right-0.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-pill bg-gradient-to-b from-gold to-gold-deep px-1 text-[9px] font-semibold tabular-nums text-ink">
                {badge > 9 ? "9+" : badge}
              </span>
            )}
          </span>
          <span
            className={cx(
              "min-w-0 truncate pr-2 text-sm font-medium transition-all duration-[var(--dur)] ease-[var(--ease-out-quart)]",
              expanded ? "translate-x-0 opacity-100" : "-translate-x-1 opacity-0",
            )}
          >
            {label}
          </span>
        </>
      )}
    </NavLink>
  );
}

/** The rail's anchor is the PROJECT, not an account — this is a local,
 * single-user studio. Click-through to the Studio board. */
function ProjectCard({ expanded }: { expanded: boolean }) {
  const { projects } = useProjects();
  const active = projects[0];
  if (!active) return null;
  return (
    <NavLink
      to="/studio"
      title={expanded ? undefined : `${active.name} — open the Studio board`}
      className="mx-3 flex h-11 items-center rounded-xl transition-colors duration-[var(--dur-fast)] hover:bg-cream/5"
    >
      <span className="flex w-10 shrink-0 items-center justify-center">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-gold/30 bg-gold/8">
          <Clapperboard size={14} className="text-gold" />
        </span>
      </span>
      <span
        className={cx(
          "min-w-0 transition-all duration-[var(--dur)] ease-[var(--ease-out-quart)]",
          expanded ? "translate-x-0 opacity-100" : "-translate-x-1 opacity-0",
        )}
      >
        <span className="block truncate text-xs font-medium text-cream">{active.name}</span>
        <span className="block truncate text-[9px] uppercase tracking-[0.14em] text-fog">
          {active.meta}
        </span>
      </span>
    </NavLink>
  );
}

/** queued + running jobs — the rail's "the studio is doing something" pulse */
function useActiveJobCount(): number {
  const jobs = trpc.jobs.list.useQuery().data;
  return (jobs ?? []).filter((j) => j.status === "running" || j.status === "queued").length;
}

export function AppShell() {
  const activeJobs = useActiveJobCount();
  const [pinned, setPinned] = useState(() => localStorage.getItem(PIN_KEY) === "1");
  const [hovering, setHovering] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const schedule = (next: boolean, delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHovering(next), delay);
  };

  const expanded = pinned || hovering;
  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    localStorage.setItem(PIN_KEY, next ? "1" : "0");
    if (!next) setHovering(false);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Frameless-window title bar — only inside the Electron shell; native
          window controls overlay the right edge (titleBarOverlay, 36px). The
          rail expands BELOW this strip, so the drag region is never covered. */}
      {window.aurea?.isElectron && (
        <header className="drag-region flex h-9 shrink-0 items-center border-b hairline bg-[#0c0c0d] px-4">
          <span className="font-serif text-xs font-medium tracking-[0.3em] text-fog select-none">
            AUREA
          </span>
        </header>
      )}

      {/* the machine's line — GPU, VRAM, queue; every screen gets it, no screen
          owns it (the Director merge took the job rail off the right edge) */}
      <GlobalStatus />

      <div className="grain flex min-h-0 flex-1">
        {/* The rail holds 64px of layout when floating; pinning widens the
            layout itself. The hover expansion is an overlay — content must not
            reflow every time the mouse crosses the left edge. */}
        <aside
          className="relative shrink-0 transition-[width] duration-[var(--dur-slow)] ease-[var(--ease-out-quart)]"
          style={{ width: pinned ? RAIL_WIDE : RAIL }}
          onMouseEnter={() => !pinned && schedule(true, EXPAND_DELAY_MS)}
          onMouseLeave={() => !pinned && schedule(false, COLLAPSE_DELAY_MS)}
        >
          <div
            className={cx(
              // z-scrim, not z-panel: when it unfurls it overlays the screen to
              // its right, so it has to sit above that screen's own chrome
              // (headers, sticky section rules) — below modals, which portal
              // out at z-modal.
              "absolute inset-y-0 left-0 z-[var(--z-scrim)] flex flex-col overflow-hidden border-r hairline bg-[#0c0c0d]",
              "transition-[width,box-shadow] duration-[var(--dur-slow)] ease-[var(--ease-out-quart)]",
              expanded && !pinned && "shadow-2xl shadow-ink/70",
            )}
            style={{ width: expanded ? RAIL_WIDE : RAIL }}
          >
            {/* Wordmark row — the "A" seal stays put; the word fades in */}
            <div className="mb-4 mt-4 flex h-9 items-center px-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gold/30">
                <span className="font-serif text-lg font-semibold text-gold">A</span>
              </div>
              <span
                className={cx(
                  "ml-2.5 select-none font-serif text-sm font-medium tracking-[0.25em] text-cream/90",
                  "transition-all duration-[var(--dur)] ease-[var(--ease-out-quart)]",
                  expanded ? "translate-x-0 opacity-100" : "-translate-x-1 opacity-0",
                )}
              >
                AUREA
              </span>
              <button
                onClick={togglePin}
                title={pinned ? "Unpin the sidebar" : "Pin the sidebar open"}
                className={cx(
                  "ml-auto rounded-md p-1.5 text-fog transition-all duration-[var(--dur)] hover:bg-cream/5 hover:text-cream",
                  expanded ? "opacity-100" : "pointer-events-none opacity-0",
                )}
              >
                {pinned ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
              </button>
            </div>

            <nav className="scrollbar-none flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden pb-2">
              {navSections.map((section, i) => (
                <div key={section.label} className="flex flex-col gap-0.5">
                  {/* group header when open; a quiet hairline when closed */}
                  <div className={cx("relative h-6", i === 0 ? "mt-0" : "mt-1.5")}>
                    <span
                      className={cx(
                        "absolute left-4 top-1/2 -translate-y-1/2 select-none text-[9px] font-semibold uppercase tracking-[0.2em] text-fog/60",
                        "transition-all duration-[var(--dur)] ease-[var(--ease-out-quart)]",
                        expanded ? "translate-x-0 opacity-100" : "-translate-x-1 opacity-0",
                      )}
                    >
                      {section.label}
                    </span>
                    <span
                      className={cx(
                        "absolute left-1/2 top-1/2 h-px w-6 -translate-x-1/2 -translate-y-1/2 bg-cream/10",
                        "transition-opacity duration-[var(--dur)]",
                        expanded ? "opacity-0" : i === 0 ? "opacity-0" : "opacity-100",
                      )}
                    />
                  </div>
                  {section.items.map((item) => (
                    <RailLink
                      key={item.to}
                      {...item}
                      expanded={expanded}
                      badge={item.to === "/jobs" ? activeJobs : undefined}
                    />
                  ))}
                </div>
              ))}
            </nav>

            <div className="mb-3 flex flex-col gap-0.5 border-t hairline pt-2">
              <RailLink to="/settings" label="Settings" icon={Settings} expanded={expanded} />
              <ProjectCard expanded={expanded} />
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
