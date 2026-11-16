/* The shell (UI-SIMPLIFY-PLAN.md Stage 1, 2026-11-14).
 *
 *   ┌──────────────────────── TopBar ─────────────────────────┐
 *   │ Sidebar │            the screen            │ Director   │
 *   │ 4 areas │  (area tab strip + tab screen)   │ (optional) │
 *   └──────────────────────────────────────────────────────────┘
 *
 * The sidebar went from 15 icon-only destinations to four labelled areas
 * (Home, Story, Create, Edit); the utilities sit small at its foot. Each
 * area remembers the tab you were last in. Ctrl K opens the palette, Ctrl J
 * the Director. The sidebar can collapse to icons for narrow windows. */

import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { FolderOpen, Gauge, PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";
import { Tip, cx } from "@/components/ui";
import { AREAS, type Area } from "@/nav";
import { trpc } from "@/trpc";
import { TopBar } from "@/components/TopBar";
import { CommandPalette } from "@/components/CommandPalette";
import { DirectorPanel, DirectorProvider, useDirector } from "@/components/DirectorPanel";
import { lastTabKey } from "@/components/AreaLayout";

const COLLAPSED_KEY = "aurea:sidebar-collapsed";
const BLURBS_KEY = "aurea:sidebar-blurbs";

/** queued + running jobs — the "the studio is doing something" badge */
function useActiveJobCount(): number {
  const jobs = trpc.jobs.list.useQuery().data;
  return (jobs ?? []).filter((j) => j.status === "running" || j.status === "queued").length;
}

function areaTarget(area: Area): string {
  if (area.tabs.length === 0) return area.path;
  const last = localStorage.getItem(lastTabKey(area.key));
  const tab = area.tabs.find((t) => t.key === last) ?? area.tabs[0];
  return `${area.path}/${tab.key}`;
}

function AreaLink({
  area,
  collapsed,
  blurbs,
}: {
  area: Area;
  collapsed: boolean;
  blurbs: boolean;
}) {
  const { pathname } = useLocation();
  const active = area.path === "/" ? pathname === "/" : pathname.startsWith(area.path);
  const Icon = area.icon;
  return (
    <Tip
      disabled={!collapsed}
      side="right"
      content={
        <span className="flex flex-col">
          <span className="font-semibold">{area.label}</span>
          <span className="text-fog">{area.blurb}</span>
        </span>
      }
    >
      <NavLink
        to={areaTarget(area)}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? area.label : undefined}
        className={cx(
          "group relative flex items-center gap-3 rounded-xl outline-none transition-[background,color,box-shadow] duration-[var(--dur-fast)]",
          "focus-visible:ring-2 focus-visible:ring-gold/30",
          collapsed ? "mx-auto h-11 w-11 justify-center" : "min-h-12 px-3 py-2",
          active
            ? "bg-gradient-to-r from-gold/[0.14] to-gold/[0.05] text-gold shadow-[inset_0_0_0_1px_rgba(201,169,110,0.22)]"
            : "text-cream/85 hover:bg-cream/[0.045] hover:text-cream",
        )}
      >
        {active && !collapsed && (
          <span
            aria-hidden
            className="absolute -left-3 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-gold shadow-[0_0_12px_1px_rgba(201,169,110,0.55)]"
          />
        )}
        <Icon
          size={19}
          strokeWidth={active ? 2 : 1.75}
          className={cx("shrink-0 transition-transform duration-[var(--dur)]", !active && "group-hover:scale-105")}
        />
        {!collapsed && (
          <span className="flex min-w-0 flex-col">
            <span className="text-[15px] font-semibold leading-tight">{area.label}</span>
            {blurbs && (
              <span className={cx("truncate text-xs leading-snug", active ? "text-gold/70" : "text-fog")}>
                {area.blurb}
              </span>
            )}
          </span>
        )}
      </NavLink>
    </Tip>
  );
}

function UtilityLink({
  to,
  label,
  icon: Icon,
  badge,
  collapsed,
}: {
  to: string;
  label: string;
  icon: typeof Settings;
  badge?: number;
  collapsed: boolean;
}) {
  return (
    <Tip disabled={!collapsed} side="right" content={label}>
      <NavLink
        to={to}
        aria-label={collapsed ? label : undefined}
        className={({ isActive }) =>
          cx(
            "relative flex h-9 items-center gap-3 rounded-lg text-sm outline-none transition-colors duration-[var(--dur-fast)]",
            "focus-visible:ring-2 focus-visible:ring-gold/30",
            collapsed ? "mx-auto w-9 justify-center" : "px-3",
            isActive ? "bg-cream/[0.07] text-cream" : "text-fog hover:bg-cream/[0.045] hover:text-cream",
          )
        }
      >
        <Icon size={16} className="shrink-0" />
        {!collapsed && <span className="flex-1">{label}</span>}
        {!!badge && (
          <span
            className={cx(
              "flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-gradient-to-b from-gold to-gold-deep px-1 text-2xs font-semibold tabular-nums text-ink shadow-[0_0_10px_-2px_rgba(201,169,110,0.6)]",
              collapsed && "absolute -right-1.5 -top-1.5",
            )}
          >
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </NavLink>
    </Tip>
  );
}

function Sidebar() {
  const activeJobs = useActiveJobCount();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === "1");
  const [blurbs, setBlurbs] = useState(() => localStorage.getItem(BLURBS_KEY) !== "0");

  const toggleCollapsed = () => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "0" : "1");
    setCollapsed(!collapsed);
  };
  const toggleBlurbs = () => {
    localStorage.setItem(BLURBS_KEY, blurbs ? "0" : "1");
    setBlurbs(!blurbs);
  };

  return (
    <aside
      className={cx(
        "flex shrink-0 flex-col border-r hairline bg-gradient-to-b from-[#0d0d0e] to-[#0a0a0b] transition-[width] duration-[var(--dur-slow)] ease-[var(--ease-out-quart)]",
        collapsed ? "w-[68px]" : "w-[220px]",
      )}
    >
      <nav aria-label="Main" className="flex flex-col gap-1.5 px-3 pt-4">
        {AREAS.map((area) => (
          <AreaLink key={area.key} area={area} collapsed={collapsed} blurbs={blurbs} />
        ))}
      </nav>

      <div className="flex-1" />

      <div className="flex flex-col gap-0.5 border-t hairline px-3 py-3">
        <UtilityLink to="/assets" label="Library" icon={FolderOpen} collapsed={collapsed} />
        <UtilityLink to="/jobs" label="Jobs" icon={Gauge} badge={activeJobs} collapsed={collapsed} />
        <UtilityLink to="/settings" label="Settings" icon={Settings} collapsed={collapsed} />
        <div className={cx("mt-2 flex items-center", collapsed ? "justify-center" : "justify-between px-1")}>
          {!collapsed && (
            <Tip content="Show or hide the one-line descriptions under each area" side="top" align="start">
              <button
                onClick={toggleBlurbs}
                className="rounded-md px-1.5 py-1 text-xs text-fog transition hover:bg-cream/5 hover:text-cream"
              >
                {blurbs ? "Hide descriptions" : "Show descriptions"}
              </button>
            </Tip>
          )}
          <Tip content={collapsed ? "Expand the sidebar" : "Collapse the sidebar"} side={collapsed ? "right" : "top"}>
            <button
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
              className="rounded-md p-1.5 text-fog transition hover:bg-cream/5 hover:text-cream"
            >
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </Tip>
        </div>
      </div>
    </aside>
  );
}

function Shell() {
  const director = useDirector();
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      } else if (k === "j") {
        e.preventDefault();
        director.toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [director]);

  return (
    <div className="flex h-full flex-col">
      <TopBar onOpenPalette={() => setPalette(true)} />
      <div className="grain flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
        <DirectorPanel />
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}

export function AppShell() {
  return (
    <DirectorProvider>
      <Shell />
    </DirectorProvider>
  );
}
