/* One area (Story / Create / Edit): a slim tab strip over the active tab's
 * screen. The tabs are the pre-2026-11 screens, mounted unchanged through the
 * nested route's <Outlet/>. The last tab you visited in an area is remembered,
 * so clicking "Create" in the sidebar returns you to the lab you were in. */

import { NavLink, Outlet, useLocation } from "react-router";
import { useEffect } from "react";
import { AREAS, type AreaKey } from "@/nav";
import { cx } from "@/components/ui";

export const lastTabKey = (area: AreaKey) => `aurea:last-tab:${area}`;

export function AreaLayout({ area }: { area: AreaKey }) {
  const def = AREAS.find((a) => a.key === area)!;
  const { pathname } = useLocation();

  useEffect(() => {
    const tab = pathname.split("/")[2];
    if (tab && def.tabs.some((t) => t.key === tab)) localStorage.setItem(lastTabKey(area), tab);
  }, [pathname, area, def.tabs]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        aria-label={def.label}
        className="flex h-12 shrink-0 items-center gap-1 border-b hairline bg-[#0c0c0d] px-4"
      >
        {def.tabs.map((tab) => (
          <NavLink
            key={tab.key}
            role="tab"
            to={`/${area}/${tab.key}`}
            title={tab.hint}
            className={({ isActive }) =>
              cx(
                "flex h-8 items-center rounded-lg px-3.5 text-sm font-medium transition-colors duration-[var(--dur-fast)]",
                isActive
                  ? "bg-gold/12 text-gold"
                  : "text-fog hover:bg-cream/5 hover:text-cream",
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
