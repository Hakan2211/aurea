import { NavLink, Outlet } from "react-router";
import {
  BookOpen,
  Clapperboard,
  Feather,
  Film,
  FolderOpen,
  Gauge,
  Image,
  Layers,
  LayoutGrid,
  LayoutPanelTop,
  MessagesSquare,
  Mic,
  Music,
  Settings,
} from "lucide-react";
import { cx } from "@/components/ui";
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
    items: [
      { to: "/", label: "Director", icon: MessagesSquare, end: true },
      { to: "/studio", label: "Studio", icon: Layers },
    ],
  },
  {
    label: "Story",
    items: [
      { to: "/script", label: "Writers room", icon: Feather },
      { to: "/storyboard", label: "Storyboard", icon: LayoutPanelTop },
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

function RailLink({ to, label, icon: Icon, end, badge }: NavItem & { badge?: number }) {
  return (
    <NavLink
      to={to}
      end={end}
      title={badge ? `${label} — ${badge} running` : label}
      className={({ isActive }) =>
        cx(
          "group relative flex h-10 w-10 items-center justify-center rounded-xl transition",
          isActive
            ? "bg-gold/12 text-gold"
            : "text-fog hover:bg-cream/5 hover:text-cream",
        )
      }
    >
      <Icon size={18} strokeWidth={1.75} />
      {!!badge && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gradient-to-b from-gold to-gold-deep px-1 text-[9px] font-semibold tabular-nums text-ink">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
      <span className="pointer-events-none absolute left-12 z-10 hidden whitespace-nowrap rounded-md glass px-2 py-1 text-[11px] text-cream group-hover:block">
        {label}
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
  return (
    <div className="flex h-full flex-col">
      {/* Frameless-window title bar — only inside the Electron shell; native
          window controls overlay the right edge (titleBarOverlay, 36px) */}
      {window.aurea?.isElectron && (
        <header className="drag-region flex h-9 shrink-0 items-center border-b hairline bg-[#0c0c0d] px-4">
          <span className="font-serif text-[12px] font-medium tracking-[0.3em] text-fog select-none">
            AUREA
          </span>
        </header>
      )}

      <div className="grain flex min-h-0 flex-1">
      <aside className="flex w-[64px] shrink-0 flex-col items-center border-r hairline bg-[#0c0c0d] py-4">
        {/* Wordmark */}
        <div className="mb-6 flex h-9 w-9 items-center justify-center rounded-xl border border-gold/30">
          <span className="font-serif text-lg font-semibold text-gold">A</span>
        </div>

        <nav className="flex min-h-0 flex-col gap-1 overflow-y-auto">
          {navSections.map((section, i) => (
            <div key={section.label} className="flex flex-col items-center gap-1.5">
              <span
                className={cx(
                  "select-none text-[8px] font-medium uppercase tracking-[0.2em] text-fog/50",
                  i === 0 ? "mt-0" : "mt-2",
                )}
              >
                {section.label}
              </span>
              {section.items.map((item) => (
                <RailLink
                  key={item.to}
                  {...item}
                  badge={item.to === "/jobs" ? activeJobs : undefined}
                />
              ))}
            </div>
          ))}
        </nav>

        <div className="mt-auto flex flex-col items-center gap-1.5">
          <NavLink
            to="/settings"
            title="Settings"
            className={({ isActive }) =>
              cx(
                "flex h-10 w-10 items-center justify-center rounded-xl transition",
                isActive ? "bg-gold/12 text-gold" : "text-fog hover:bg-cream/5 hover:text-cream",
              )
            }
          >
            <Settings size={18} strokeWidth={1.75} />
          </NavLink>
          <div
            title="hbilgic · Pro"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-gold/60 to-gold-deep/60 text-[11px] font-semibold text-ink"
          >
            H
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
