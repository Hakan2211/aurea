/* Studio — the episode document, in two views (2026-08-06 route merge).
 *
 * Writers Room and the Studio board were never two destinations: they were one
 * `production.json` episode rendered two ways — a typeset screenplay and a
 * kanban of the same shots by status — each carrying its own copy of the
 * episode picker, the scene structure and the stats header. This screen is the
 * Notion pattern instead: one document, a SCRIPT | BOARD toggle, one header.
 *
 * Two things make the merge worth it beyond the saved route:
 *  - shared selection — a shot picked on the board is scrolled to and rail-lit
 *    in the script, and vice versa;
 *  - one right rail, selection-driven — the shot inspector when a shot is
 *    selected, the writers' room panel (premise → Director) when none is.
 *
 * `/script` redirects here. */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Clapperboard, Film, Plus } from "lucide-react";
import { GhostButton, GoldButton } from "@/components/ui";
import { useBible, useProduction } from "@/hooks";
import { StudioHeader, type StudioView } from "./studio/header";
import { StudioRail } from "./studio/rail";
import { ScriptView } from "./studio/script";
import { BoardPeek, SceneBoard, SceneTabs } from "./studio/board";
import { ShotInspector } from "./studio/inspector";
import { WritersPanel } from "./studio/writers";
import { locateShot, sceneAnchor, shotCode } from "./studio/shared";

const VIEW_KEY = "aurea:studio-view";
const PEEK_KEY = "aurea:studio-board-peek";

export function StudioScreen() {
  const prod = useProduction();
  const bible = useBible();
  const navigate = useNavigate();

  const episodes = useMemo(
    () =>
      (prod.production?.seasons ?? []).flatMap((season) =>
        season.episodes.map((e) => ({ season, episode: e })),
      ),
    [prod.production],
  );

  const [episodeId, setEpisodeId] = useState<string | null>(null);
  const current = episodes.find((e) => e.episode.id === episodeId) ?? episodes[0] ?? null;
  const episode = current?.episode ?? null;

  const [view, setViewState] = useState<StudioView>(() =>
    localStorage.getItem(VIEW_KEY) === "board" ? "board" : "script",
  );
  const setView = (v: StudioView) => {
    setViewState(v);
    localStorage.setItem(VIEW_KEY, v);
  };
  const [peekOpen, setPeekOpenState] = useState(() => localStorage.getItem(PEEK_KEY) !== "0");
  const setPeekOpen = (v: boolean) => {
    setPeekOpenState(v);
    localStorage.setItem(PEEK_KEY, v ? "1" : "0");
  };

  /* selection is shared by both views: the shot drives the right rail, and the
   * scene it lives in drives the board's tab */
  const [shotId, setShotId] = useState<string | null>(null);
  const [sceneId, setSceneId] = useState<string | null>(null);

  const scenes = episode?.scenes ?? [];
  const located = useMemo(() => locateShot(episode, shotId), [episode, shotId]);
  const sceneIdx = Math.max(0, scenes.findIndex((s) => s.id === sceneId));
  const scene = scenes[sceneIdx] ?? null;

  const selectShot = (id: string | null) => {
    setShotId(id);
    const found = locateShot(episode, id);
    if (found) setSceneId(found.scene.id);
  };

  /* the rail's scene click means "take me there" in whichever view is showing */
  const selectScene = (id: string) => {
    setSceneId(id);
    if (view === "script") {
      requestAnimationFrame(() =>
        document.getElementById(sceneAnchor(id))?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
  };

  /* Esc gives the right rail back to the writers' room */
  useEffect(() => {
    if (!shotId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShotId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shotId]);

  if (!prod.production) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-fog">
        Waiting for the studio core…
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <StudioRail
        prod={prod}
        bible={bible}
        episode={episode}
        activeSceneId={scene?.id ?? null}
        selectScene={selectScene}
      />

      {/* @container: the header's breakpoints have to answer "how wide is this
          pane", not "how wide is the window" — three rails sit between the two
          and the answer differs by ~750px */}
      <section className="@container flex min-w-0 flex-1 flex-col">
        <StudioHeader
          prod={prod}
          episodes={episodes}
          current={current}
          selectEpisode={(id) => {
            setEpisodeId(id);
            setSceneId(null);
            setShotId(null);
          }}
          view={view}
          setView={setView}
        />

        {!episode ? (
          <EmptyEpisodes
            hasCast={bible.bible.characters.length > 0}
            add={() => prod.addEpisode({ title: "Pilot" })}
          />
        ) : view === "script" ? (
          <>
            <ScriptView
              key={episode.id}
              prod={prod}
              bible={bible}
              episode={episode}
              selectedShotId={shotId}
              selectShot={selectShot}
            />
            {/* the docked mini-board — how far the page has boarded, without
                leaving the page (studio-v2's graft, prototyped alongside the
                toggle rather than replacing it) */}
            <BoardPeek
              episode={episode}
              open={peekOpen}
              setOpen={setPeekOpen}
              shotId={shotId}
              selectShot={selectShot}
            />
          </>
        ) : (
          <>
            <SceneTabs
              scenes={scenes}
              sceneIdx={sceneIdx}
              select={(id) => {
                setSceneId(id);
                setShotId(null);
              }}
              addScene={() =>
                prod.addScene({
                  episodeId: episode.id,
                  slugline: `INT. THE LOFT — SCENE ${scenes.length + 1}`,
                })
              }
            />
            {scene ? (
              <SceneBoard
                key={scene.id}
                prod={prod}
                bible={bible}
                scene={scene}
                sceneIdx={sceneIdx}
                shotId={shotId}
                selectShot={selectShot}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3">
                <p className="text-[12px] text-fog">No scenes yet — every episode starts with one.</p>
                <GoldButton
                  onClick={() => prod.addScene({ episodeId: episode.id, slugline: "INT. THE LOFT — DAY" })}
                >
                  <Plus size={13} /> Add scene
                </GoldButton>
              </div>
            )}
            <footer className="flex items-center justify-between border-t hairline px-4 py-2">
              <span className="text-[10px] uppercase tracking-[0.14em] text-fog">
                {scene ? `${scene.shots.length} shot${scene.shots.length === 1 ? "" : "s"} in scene` : ""}
              </span>
              <GhostButton onClick={() => navigate("/timeline")}>
                <Film size={12} /> Open in Timeline
              </GhostButton>
            </footer>
          </>
        )}
      </section>

      {/* one right rail, two occupants — inspector while a shot is selected,
          the writers' room the rest of the time */}
      <aside className="flex w-[280px] shrink-0 flex-col border-l hairline bg-[#0e0e10] xl:w-[320px]">
        {located ? (
          <ShotInspector
            key={located.shot.id}
            shot={located.shot}
            code={shotCode(located.sceneIdx, located.shotIdx)}
            scene={located.scene}
            prod={prod}
            bible={bible}
            selectShot={selectShot}
            close={() => setShotId(null)}
          />
        ) : (
          <WritersPanel episode={episode} production={prod.production} />
        )}
      </aside>
    </div>
  );
}

function EmptyEpisodes({ hasCast, add }: { hasCast: boolean; add: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <Clapperboard size={28} className="text-gold/70" />
      <span className="font-serif text-xl text-cream">No episodes yet</span>
      <p className="max-w-[380px] text-[12px] leading-relaxed text-fog">
        {hasCast
          ? "Start the pilot and write it here — or hand the Director a premise in the writers' room and watch the script fill in."
          : "Seed the bible first (Bible → Seed Animal Sitcom), then start the pilot here."}
      </p>
      <GoldButton onClick={add}>
        <Plus size={13} /> Start the pilot
      </GoldButton>
    </div>
  );
}
