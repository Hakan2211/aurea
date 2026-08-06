/* Director — the board pane. Every shot of an episode as a keyframe card in
 * script order, one scene per row. Keyframes come from the qwen-edit reference
 * workflow (studio.board.generate); finished stills attach server-side and
 * stream back over studio.onUpdate.
 *
 * Two densities: `cards` is the default browsing zoom, `wide` is the cinematic
 * strip — one big frame per card, for reading a scene rather than counting it. */

import { useState } from "react";
import { useNavigate } from "react-router";
import { ChevronDown, LayoutPanelTop, Rows3, Sparkles, LayoutGrid } from "lucide-react";
import type { Episode, Scene, Shot } from "@aurea/shared";
import { Chip, GoldButton, Progress, Segmented, cx } from "@/components/ui";
import type { useBible, useStoryboard } from "@/hooks";
import { STATUS_TONE, pad2, shotCode } from "./shared";

export type BoardDensity = "cards" | "wide";

export interface EpisodeEntry {
  season: { number: number };
  episode: Episode;
}

export function BoardHeader({
  episodes,
  current,
  selectEpisode,
  boarded,
  total,
  density,
  setDensity,
}: {
  episodes: EpisodeEntry[];
  current: EpisodeEntry | null;
  selectEpisode: (id: string) => void;
  boarded: number;
  total: number;
  density: BoardDensity;
  setDensity: (d: BoardDensity) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <header className="flex items-center gap-4 border-b hairline px-5 py-2.5">
      {/* the quiet header the v2 mockup argued for: an episode chip, not a
          title block — the board itself is the loud element */}
      <div className="relative min-w-0">
        <button
          onClick={() => episodes.length > 0 && setOpen((o) => !o)}
          className={cx(
            "flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-left transition",
            episodes.length > 0 && "hover:bg-cream/5",
          )}
        >
          <span className="truncate font-serif text-[14px] text-cream">
            {current
              ? `S${pad2(current.season.number)}E${pad2(current.episode.number)} — ${current.episode.title}`
              : "No episode"}
          </span>
          {episodes.length > 0 && <ChevronDown size={13} className="shrink-0 text-fog" />}
        </button>
        {open && (
          <>
            <button className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
            <div className="absolute left-0 top-full z-20 mt-1 w-[300px] rounded-xl border hairline bg-raised p-1 shadow-xl">
              {episodes.map(({ season, episode }) => (
                <button
                  key={episode.id}
                  onClick={() => {
                    selectEpisode(episode.id);
                    setOpen(false);
                  }}
                  className={cx(
                    "flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[12px] transition",
                    episode.id === current?.episode.id
                      ? "bg-gold/10 text-gold"
                      : "text-cream hover:bg-cream/5",
                  )}
                >
                  <span className="truncate">
                    S{pad2(season.number)}E{pad2(episode.number)} — {episode.title}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-3">
        {total > 0 && (
          <>
            <span className="text-[11px] text-fog">
              Boarded <span className="text-cream/85">{boarded}</span>/{total}
            </span>
            <div className="h-1 w-24 overflow-hidden rounded-full bg-cream/8">
              <div
                className="h-full rounded-full bg-gradient-to-r from-gold-deep to-gold transition-[width]"
                style={{ width: `${total ? (boarded / total) * 100 : 0}%` }}
              />
            </div>
          </>
        )}
        <Segmented
          value={density}
          onChange={setDensity}
          options={[
            { value: "cards", label: <LayoutGrid size={12} />, title: "Card density" },
            { value: "wide", label: <Rows3 size={12} />, title: "Cinematic strips" },
          ]}
        />
      </div>
    </header>
  );
}

export function SceneRow({
  scene,
  sceneIdx,
  bible,
  board,
  density,
  activeShotId,
  selectShot,
}: {
  scene: Scene;
  sceneIdx: number;
  bible: ReturnType<typeof useBible>;
  board: ReturnType<typeof useStoryboard>;
  density: BoardDensity;
  activeShotId: string | null;
  selectShot: (id: string) => void;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fog">
          Scene {pad2(sceneIdx + 1)}
        </span>
        <span className="truncate font-mono text-[11px] uppercase tracking-wide text-cream/70">
          {scene.slugline}
        </span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1.5">
        {scene.shots.map((shot, shotIdx) => (
          <BoardCard
            key={shot.id}
            shot={shot}
            code={shotCode(sceneIdx, shotIdx)}
            number={shotIdx + 1}
            density={density}
            active={shot.id === activeShotId}
            job={board.shotJobs(shot.id)[0]}
            keyframeUrl={bible.refUrl(
              shot.keyframes.find((k) => k.id === shot.selectedKeyframe)?.asset ??
                shot.keyframes[shot.keyframes.length - 1]?.asset,
            )}
            onClick={() => selectShot(shot.id)}
          />
        ))}
        {scene.shots.length === 0 && (
          <p className="py-4 text-[11px] text-fog/80">No shots in this scene yet.</p>
        )}
      </div>
    </section>
  );
}

function BoardCard({
  shot,
  code,
  number,
  density,
  active,
  job,
  keyframeUrl,
  onClick,
}: {
  shot: Shot;
  code: string;
  /** 1-based position in the scene — the card's big serif slate numeral */
  number: number;
  density: BoardDensity;
  active: boolean;
  job?: { progress: number; stage?: string; status: string };
  keyframeUrl?: string;
  onClick: () => void;
}) {
  const wide = density === "wide";
  return (
    <button
      onClick={onClick}
      className={cx(
        "shrink-0 overflow-hidden rounded-xl border text-left transition",
        wide ? "w-[400px]" : "w-[228px]",
        active
          ? "border-gold/60 shadow-[0_0_18px_rgba(201,169,110,0.12)]"
          : "border-cream/10 hover:border-cream/25",
      )}
    >
      <div className="relative aspect-video w-full bg-gradient-to-br from-[#241c10] to-[#0d0a06]">
        {keyframeUrl && <img src={keyframeUrl} alt="" className="h-full w-full object-cover" />}
        {/* slate numeral — big, serif, half-lit, like a number burned onto the board */}
        <span
          className={cx(
            "pointer-events-none absolute left-2 top-0.5 font-serif font-semibold leading-none text-cream/85 [text-shadow:0_1px_10px_rgba(0,0,0,0.85)]",
            wide ? "text-[52px]" : "text-[30px]",
          )}
        >
          {number}
        </span>
        {!keyframeUrl && !job && (
          <div className="flex h-full items-center justify-center text-[10px] text-fog/70">
            not boarded
          </div>
        )}
        {/* in-frame progress: a caption line over the plate, not a lens-cap
            overlay — you can still read the frame while it renders */}
        {job && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/90 to-transparent px-2 pb-1.5 pt-6">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] text-cream/90">
              <Sparkles size={11} className="shrink-0 text-gold" />
              <span className="tabular-nums text-gold">{Math.round(job.progress)}%</span>
              <span className="truncate text-cream/70">
                · {job.status === "queued" ? "Queued" : (job.stage ?? "Rendering…")}
              </span>
            </div>
            <Progress value={job.progress} />
          </div>
        )}
      </div>
      <div className="space-y-1 bg-surface px-2 py-1.5">
        <div className="flex items-center justify-between gap-1">
          <span className="font-mono text-[10px] text-cream/90">{code}</span>
          <Chip tone={STATUS_TONE[shot.status]} className="!px-1.5 !text-[9px]">
            {shot.status}
          </Chip>
        </div>
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-[10px] text-fog">{shot.title || "Untitled"}</span>
          <span className="shrink-0 text-[9px] text-fog/70">{shot.keyframes.length} kf</span>
        </div>
      </div>
    </button>
  );
}

/** nothing to board — the shot list lives in the Studio, so point there */
export function BoardEmpty() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <LayoutPanelTop size={26} className="text-gold/70" />
      <span className="font-serif text-lg text-cream">Nothing to board yet</span>
      <p className="max-w-[360px] text-[12px] leading-relaxed text-fog">
        The board works from the episode's shot list. Break the episode into scenes and shots
        first — on the Studio board, or by asking the Director beside you.
      </p>
      <GoldButton onClick={() => navigate("/studio")}>Open Studio</GoldButton>
    </div>
  );
}
