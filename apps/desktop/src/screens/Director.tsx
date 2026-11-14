/* Story › Board — the storyboard for one episode.
 *
 * History: 2026-08-06 merged chat + storyboard into one "Director" route. In
 * the 2026-11 simplification (UI-SIMPLIFY-PLAN.md Stage 1) the chat moved into
 * a side panel available on every screen (components/DirectorPanel.tsx) and
 * this file became the board alone. The loop survives: selecting a shot here
 * sets the panel's context chip, so "make this a push-in" still means THIS
 * shot, and the shot inspector still arrives as a slide-over. */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { LayoutPanelTop, MessagesSquare, PenLine } from "lucide-react";
import { useBible, useProduction, useStoryboard } from "@/hooks";
import { EmptyState, GhostButton, GoldButton } from "@/components/ui";
import { CoreGate } from "@/components/CoreGate";
import { useDirector } from "@/components/DirectorPanel";
import { BoardEmpty, BoardHeader, SceneRow, type BoardDensity } from "./director/board";
import { ShotInspector } from "./director/inspector";
import { shotCode } from "./director/shared";

const DENSITY_KEY = "aurea:director-board-density";

export function BoardScreen() {
  const prod = useProduction();
  const bible = useBible();
  const board = useStoryboard();
  const director = useDirector();
  const navigate = useNavigate();

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
   * inspector and points the Director panel's composer at the shot */
  const selectShot = (id: string) => {
    setShotId(id);
    setInspectorOpen(true);
    for (const [sceneIdx, scene] of (current?.episode.scenes ?? []).entries()) {
      const shotIdx = scene.shots.findIndex((s) => s.id === id);
      if (shotIdx === -1) continue;
      const shot = scene.shots[shotIdx];
      director.setShot({
        shotId: shot.id,
        code: shotCode(sceneIdx, shotIdx),
        scene: scene.slugline,
        title: shot.title,
      });
      break;
    }
  };

  const [density, setDensity] = useState<BoardDensity>(
    () => (localStorage.getItem(DENSITY_KEY) === "wide" ? "wide" : "cards"),
  );
  const setDensityPersisted = (d: BoardDensity) => {
    setDensity(d);
    localStorage.setItem(DENSITY_KEY, d);
  };

  const shots = current?.episode.scenes.flatMap((s) => s.shots) ?? [];
  const boarded = shots.filter((s) => s.keyframes.length > 0).length;

  if (!prod.production) {
    return (
      <CoreGate
        screen="Board"
        purpose="The board shows every shot of an episode as a frame, so you can storyboard, pick keyframes and send shots to render."
        icon={LayoutPanelTop}
      />
    );
  }

  if (episodes.length === 0) {
    return (
      <EmptyState
        icon={LayoutPanelTop}
        title="No episodes to board yet"
        action={
          <GoldButton onClick={() => navigate("/story/script")}>
            <PenLine size={13} /> Write an episode
          </GoldButton>
        }
        secondary={
          <GhostButton
            onClick={() =>
              director.openWith("Help me plan a new episode: logline, scenes, and a shot list.")
            }
          >
            <MessagesSquare size={13} /> Plan it with the Director
          </GhostButton>
        }
      >
        The board shows every shot of an episode as a frame. Write an episode in Script, or ask
        the Director to draft one, and its scenes and shots appear here.
      </EmptyState>
    );
  }

  return (
    <section className="relative flex h-full min-w-0 flex-1 flex-col">
      <BoardHeader
        episodes={episodes}
        current={current}
        selectEpisode={(id) => {
          setEpisodeId(id);
          setShotId(null);
          setInspectorOpen(false);
          director.setShot(null);
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
          the Director's composer stays pointed at the shot you just looked at */}
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
  );
}
