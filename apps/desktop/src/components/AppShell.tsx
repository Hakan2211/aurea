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

const nav = [
  { to: "/", label: "Director", icon: MessagesSquare, end: true },
  { to: "/studio", label: "Studio", icon: Layers },
  { to: "/script", label: "Writers room", icon: Feather },
  { to: "/storyboard", label: "Storyboard", icon: LayoutPanelTop },
  { to: "/bible", label: "Bible", icon: BookOpen },
  { to: "/images", label: "Image lab", icon: Image },
  { to: "/voice", label: "Voice lab", icon: Mic },
  { to: "/music", label: "Music lab", icon: Music },
  { to: "/video", label: "Video gen", icon: Clapperboard },
  { to: "/timeline", label: "Timeline", icon: Film },
  { to: "/formats", label: "Formats", icon: LayoutGrid },
  { to: "/assets", label: "Assets", icon: FolderOpen },
  { to: "/jobs", label: "Jobs", icon: Gauge },
];

export function AppShell() {
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

        <nav className="flex flex-col gap-1.5">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={label}
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
              <span className="pointer-events-none absolute left-12 z-10 hidden whitespace-nowrap rounded-md glass px-2 py-1 text-[11px] text-cream group-hover:block">
                {label}
              </span>
            </NavLink>
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
