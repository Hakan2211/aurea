/* Director — chat and storyboard on one screen (2026-08-06 route merge).
 *
 * The chat is the control plane, the board is the artifact it produces; split
 * across two routes the loop was broken (ask for shots here, go look there).
 * Now tool-call cards stream on the left while the affected card updates in
 * place on the right, a selected card puts a context chip over the composer,
 * and the shot inspector arrives as a slide-over instead of a third column.
 *
 * The job rail that used to live on the right is gone — GPU, VRAM and queue
 * are on the global status strip; the detail is in Jobs. */

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
import type { Asset } from "@/data/sample";
import { useBible, useProduction, useStoryboard } from "@/hooks";
import { cx } from "@/components/ui";
import { ChatPane, type AttachApi, type DirectorSeed } from "./director/chat";
import { BoardEmpty, BoardHeader, SceneRow, type BoardDensity } from "./director/board";
import { ShotInspector } from "./director/inspector";
import { shotCode, type ShotContext } from "./director/shared";

const CHAT_KEY = "aurea:director-chat-width";
const DENSITY_KEY = "aurea:director-board-density";
const CHAT_MIN = 340;
const CHAT_MAX = 720;
const CHAT_DEFAULT = 420;

const clampChat = (px: number) => Math.min(CHAT_MAX, Math.max(CHAT_MIN, px));

export function DirectorScreen() {
  const seed = (useLocation().state as { seed?: DirectorSeed } | null)?.seed ?? null;
  const prod = useProduction();
  const bible = useBible();
  const board = useStoryboard();

  /* ---- attachments (the paperclip popover feeds this) ---- */
  const [pending, setPending] = useState<Asset[]>([]);
  const attach: AttachApi = {
    pending,
    onAttach: (asset) =>
      setPending((prev) =>
        prev.some((p) => p.id === asset.id) || prev.length >= 8 ? prev : [...prev, asset],
      ),
    onDetach: (id) => setPending((prev) => prev.filter((p) => p.id !== id)),
    onClear: () => setPending([]),
  };

  /* ---- episode + selection ---- */
  const episodes = useMemo(
    () =>
      (prod.production?.seasons ?? []).flatMap((season) =>
        season.episodes.map((e) => ({ season, episode: e })),
      ),
    [prod.production],
  );
  const [episodeId, setEpisodeId] = useState<string | null>(null);
  const current = episodes.find((e) => e.episode.id === episodeId) ?? episodes[0] ?? null;

  const [shotId, setShotId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const located = useMemo(() => {
    for (const [sceneIdx, scene] of (current?.episode.scenes ?? []).entries()) {
      const shotIdx = scene.shots.findIndex((s) => s.id === shotId);
      if (shotIdx !== -1) return { scene, sceneIdx, shot: scene.shots[shotIdx], shotIdx };
    }
    return null;
  }, [current, shotId]);

  /* selection is what the chat talks about — one click both opens the
   * inspector and points the composer at the shot */
  const context: ShotContext | null = located
    ? {
        shotId: located.shot.id,
        code: shotCode(located.sceneIdx, located.shotIdx),
        scene: located.scene.slugline,
        title: located.shot.title,
      }
    : null;

  const selectShot = (id: string) => {
    setShotId(id);
    setInspectorOpen(true);
  };

  /* ---- split + density, both remembered ---- */
  const [chatWidth, setChatWidth] = useState(() => {
    const saved = Number(localStorage.getItem(CHAT_KEY));
    return saved ? clampChat(saved) : CHAT_DEFAULT;
  });
  const [density, setDensity] = useState<BoardDensity>(
    () => (localStorage.getItem(DENSITY_KEY) === "wide" ? "wide" : "cards"),
  );
  const setDensityPersisted = (d: BoardDensity) => {
    setDensity(d);
    localStorage.setItem(DENSITY_KEY, d);
  };

  const splitRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const left = splitRef.current?.getBoundingClientRect().left ?? 0;
      setChatWidth(clampChat(e.clientX - left));
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
    localStorage.setItem(CHAT_KEY, String(chatWidth));
  }, [chatWidth]);

  const shots = current?.episode.scenes.flatMap((s) => s.shots) ?? [];
  const boarded = shots.filter((s) => s.keyframes.length > 0).length;
  /* no episodes at all → the chat gets the whole window; a board with nothing
   * on it is just a wall of empty state next to the thing you actually use */
  const boardless = !prod.production || episodes.length === 0;

  if (boardless) {
    return (
      <div className="flex h-full">
        <ChatPane attach={attach} seed={seed} context={null} clearContext={() => {}} />
        <aside className="hidden w-[280px] shrink-0 flex-col justify-center border-l hairline px-6 text-center xl:flex">
          <p className="font-serif text-[15px] text-cream/80">The board appears here</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-fog">
            {prod.production
              ? "Create an episode in the Studio and its scenes and shots will board beside this thread."
              : "Waiting for the studio core…"}
          </p>
        </aside>
      </div>
    );
  }

  return (
    <div ref={splitRef} className={cx("flex h-full", dragging && "select-none")}>
      <div className="flex min-h-0 min-w-0 shrink-0 flex-col" style={{ width: chatWidth }}>
        <ChatPane
          attach={attach}
          seed={seed}
          context={context}
          clearContext={() => setShotId(null)}
        />
      </div>

      {/* the drag handle — 5px of hit area, one hairline of paint */}
      <div
        onMouseDown={() => setDragging(true)}
        onDoubleClick={() => setChatWidth(CHAT_DEFAULT)}
        title="Drag to resize · double-click to reset"
        className={cx(
          "group relative w-[5px] shrink-0 cursor-col-resize border-r hairline transition-colors",
          dragging ? "bg-gold/40" : "hover:bg-gold/25",
        )}
      />

      <section className="relative flex min-w-0 flex-1 flex-col">
        <BoardHeader
          episodes={episodes}
          current={current}
          selectEpisode={(id) => {
            setEpisodeId(id);
            setShotId(null);
            setInspectorOpen(false);
          }}
          boarded={boarded}
          total={shots.length}
          density={density}
          setDensity={setDensityPersisted}
        />

        {current && shots.length > 0 ? (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {current.episode.scenes.map((scene, sceneIdx) => (
              <SceneRow
                key={scene.id}
                scene={scene}
                sceneIdx={sceneIdx}
                bible={bible}
                board={board}
                density={density}
                activeShotId={located?.shot.id ?? null}
                selectShot={selectShot}
              />
            ))}
          </div>
        ) : (
          <BoardEmpty />
        )}

        {/* the inspector overlays the board; closing it keeps the selection, so
            the composer stays pointed at the shot you were just looking at */}
        {inspectorOpen && located && current && (
          <ShotInspector
            key={located.shot.id}
            shot={located.shot}
            scene={located.scene}
            code={shotCode(located.sceneIdx, located.shotIdx)}
            prod={prod}
            bible={bible}
            board={board}
            close={() => setInspectorOpen(false)}
          />
        )}
      </section>
    </div>
  );
}
