/* Ctrl K — jump anywhere, run a common action, switch project.
 *
 * The palette is what lets the sidebar stay at four areas: every tab of every
 * area, the utilities (Library, Jobs, Settings) and each project are one
 * keystroke and a few letters away. Arrow keys move, Enter runs, Esc closes. */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { CornerDownLeft, Search } from "lucide-react";
import { AREAS, UTILITIES } from "@/nav";
import { useProjects } from "@/hooks";
import { cx } from "@/components/ui";
import { useDirector } from "@/components/DirectorPanel";

interface Command {
  id: string;
  label: string;
  group: string;
  hint?: string;
  run: () => void;
}

/** every query word must appear somewhere in the label, group or hint */
const matches = (cmd: Command, q: string) => {
  const hay = `${cmd.label} ${cmd.group} ${cmd.hint ?? ""}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
};

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const director = useDirector();
  const { projects, activeId, setActive } = useProjects();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => navigate(path);
    const list: Command[] = [];
    for (const area of AREAS) {
      if (area.tabs.length === 0) {
        list.push({ id: area.key, label: area.label, group: "Go to", hint: area.blurb, run: go(area.path) });
      }
      for (const tab of area.tabs) {
        list.push({
          id: `${area.key}/${tab.key}`,
          label: `${area.label} › ${tab.label}`,
          group: "Go to",
          hint: tab.hint,
          run: go(`/${area.key}/${tab.key}`),
        });
      }
    }
    for (const u of UTILITIES) {
      list.push({ id: u.path, label: u.label, group: "Go to", hint: u.hint, run: go(u.path) });
    }
    list.push(
      {
        id: "director",
        label: director.open ? "Hide the Director" : "Ask the Director",
        group: "Action",
        hint: "AI co-pilot chat · Ctrl J",
        run: director.toggle,
      },
      {
        id: "new-image",
        label: "New image",
        group: "Action",
        hint: "Image tab",
        run: go("/create/image"),
      },
      {
        id: "new-video",
        label: "New video",
        group: "Action",
        hint: "Video tab",
        run: go("/create/video"),
      },
      {
        id: "review",
        label: "Review and approve takes",
        group: "Action",
        hint: "Story › Episodes",
        run: go("/story/episodes"),
      },
    );
    for (const p of projects) {
      if (p.id === activeId) continue;
      list.push({
        id: `project:${p.id}`,
        label: `Switch to ${p.name}`,
        group: "Project",
        hint: p.meta,
        run: () => setActive(p.id),
      });
    }
    return list;
  }, [navigate, director, projects, activeId, setActive]);

  const shown = useMemo(
    () => (query.trim() ? commands.filter((c) => matches(c, query)) : commands),
    [commands, query],
  );

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (!open) return null;

  const run = (cmd: Command | undefined) => {
    if (!cmd) return;
    onClose();
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(shown.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(shown[index]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="anim-fade fixed inset-0 z-[var(--z-modal)] flex items-start justify-center bg-ink/70 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search and jump"
        className="anim-scale-in w-[min(92vw,620px)] overflow-hidden rounded-panel border border-cream/10 bg-surface shadow-2xl shadow-ink"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b hairline px-4">
          <Search size={17} className="shrink-0 text-fog" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Go to a screen, run an action, switch project…"
            aria-label="Search"
            aria-controls="palette-list"
            className="h-14 flex-1 border-0 bg-transparent text-base text-cream outline-none placeholder:text-fog"
          />
          <kbd className="rounded border border-cream/15 px-1.5 text-xs text-fog">Esc</kbd>
        </div>
        <ul id="palette-list" ref={listRef} role="listbox" className="max-h-[52vh] overflow-y-auto p-2">
          {shown.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-fog">
              Nothing matches “{query}”.{" "}
              <button
                className="text-gold hover:underline"
                onClick={() => {
                  onClose();
                  director.openWith(query);
                }}
              >
                Ask the Director instead
              </button>
            </li>
          )}
          {shown.map((cmd, i) => (
            <li key={cmd.id} role="option" aria-selected={i === index}>
              <button
                data-index={i}
                onMouseMove={() => setIndex(i)}
                onClick={() => run(cmd)}
                className={cx(
                  "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left",
                  i === index ? "bg-cream/8 text-cream" : "text-cream/85",
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col py-1.5">
                  <span className="truncate text-sm font-medium">{cmd.label}</span>
                  {cmd.hint && <span className="truncate text-xs text-fog">{cmd.hint}</span>}
                </span>
                <span className="shrink-0 text-xs text-fog">{cmd.group}</span>
                {i === index && <CornerDownLeft size={13} className="shrink-0 text-fog" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
