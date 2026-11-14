/* The Director as a side panel (UI-SIMPLIFY-PLAN.md Stage 1).
 *
 * Until 2026-11 the Director was a destination: chat on the left, board on the
 * right, at "/". Now the chat is a helper that opens beside WHATEVER you are
 * working on — Story, Create or Edit — the way an editor's AI chat sits beside
 * the file. The board moved to Story › Board and talks to the chat through this
 * context: selecting a shot there puts its chip on the composer here.
 *
 * Other screens hand the chat a brief with `openWith(text)` (Formats' "Chat
 * with Director") instead of navigating to "/" with router state. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import type { Asset } from "@/data/sample";
import { cx } from "@/components/ui";
import { ChatPane, type AttachApi, type DirectorSeed } from "@/screens/director/chat";
import type { ShotContext } from "@/screens/director/shared";

const OPEN_KEY = "aurea:director-open";
const WIDTH_KEY = "aurea:director-panel-width";
const MIN = 340;
const MAX = 720;
const DEFAULT = 420;
const clamp = (px: number) => Math.min(MAX, Math.max(MIN, px));

interface DirectorApi {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /** open the panel with the composer pre-filled */
  openWith: (text: string) => void;
  seed: DirectorSeed | null;
  /** the shot the chat is talking about (set by Story › Board) */
  shot: ShotContext | null;
  setShot: (shot: ShotContext | null) => void;
  attach: AttachApi;
}

const DirectorContext = createContext<DirectorApi | null>(null);

export function useDirector(): DirectorApi {
  const api = useContext(DirectorContext);
  if (!api) throw new Error("useDirector outside <DirectorProvider>");
  return api;
}

export function DirectorProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(() => localStorage.getItem(OPEN_KEY) === "1");
  const [seed, setSeed] = useState<DirectorSeed | null>(null);
  const [shot, setShot] = useState<ShotContext | null>(null);
  const [pending, setPending] = useState<Asset[]>([]);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    localStorage.setItem(OPEN_KEY, next ? "1" : "0");
  }, []);

  const api = useMemo<DirectorApi>(
    () => ({
      open,
      setOpen,
      toggle: () => setOpen(!open),
      openWith: (text) => {
        setSeed({ text, sentAt: Date.now() });
        setOpen(true);
      },
      seed,
      shot,
      setShot,
      attach: {
        pending,
        onAttach: (asset) =>
          setPending((prev) =>
            prev.some((p) => p.id === asset.id) || prev.length >= 8 ? prev : [...prev, asset],
          ),
        onDetach: (id) => setPending((prev) => prev.filter((p) => p.id !== id)),
        onClear: () => setPending([]),
      },
    }),
    [open, setOpen, seed, shot, pending],
  );

  return <DirectorContext.Provider value={api}>{children}</DirectorContext.Provider>;
}

/** The panel itself — mounted by AppShell to the right of the screen. */
export function DirectorPanel() {
  const director = useDirector();
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return saved ? clamp(saved) : DEFAULT;
  });
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const right = panelRef.current?.getBoundingClientRect().right ?? window.innerWidth;
      setWidth(clamp(right - e.clientX));
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);
  useEffect(() => {
    localStorage.setItem(WIDTH_KEY, String(width));
  }, [width]);

  if (!director.open) return null;

  return (
    <aside
      ref={panelRef}
      aria-label="Director"
      className={cx(
        "anim-slide-over relative flex min-h-0 shrink-0 border-l hairline bg-[#0e0e10]",
        dragging && "select-none",
      )}
      style={{ width }}
    >
      {/* resize handle on the panel's left edge */}
      <div
        onMouseDown={() => setDragging(true)}
        onDoubleClick={() => setWidth(DEFAULT)}
        title="Drag to resize · double-click to reset"
        className={cx(
          "absolute inset-y-0 -left-[3px] z-[var(--z-panel)] w-[6px] cursor-col-resize transition-colors",
          dragging ? "bg-gold/40" : "hover:bg-gold/25",
        )}
      />
      <button
        onClick={() => director.setOpen(false)}
        aria-label="Close the Director"
        title="Close (Ctrl J)"
        className="absolute right-3 top-3 z-[var(--z-panel)] rounded-md p-1.5 text-fog transition hover:bg-cream/5 hover:text-cream"
      >
        <X size={16} />
      </button>
      <ChatPane
        attach={director.attach}
        seed={director.seed}
        context={director.shot}
        clearContext={() => director.setShot(null)}
      />
    </aside>
  );
}
