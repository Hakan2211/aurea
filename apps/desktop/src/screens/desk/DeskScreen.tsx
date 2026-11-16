/* Production Desk (episode factory P1) — the per-episode surface you direct
 * from. Scenes as rows, shots as cards in derived-stage columns
 * (script → voiced → boarded → rendered → approved); click = the review
 * drawer with the two verdicts that matter (Approve / Retake with note); the
 * canon library keeps plates and sheets one click away; the strip on top says
 * how far the episode is and what the crew is doing right now.
 *
 * Everything here reads/writes procedures that already exist — the desk is a
 * view plus the two P1 verdict mutations (studio.production.approveShot /
 * retakeShot). /desk falls back to the first episode; /desk/:episodeId
 * deep-links one. */

import { SelectBox } from "@/components/ui/SelectBox";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { BookImage, ClipboardCheck, FlaskConical, PenLine, Ruler, Workflow } from "lucide-react";
import { shotStage, type Scene, type Shot, type ShotStage } from "@aurea/shared";
import { Chip, EmptyState, GoldButton, Progress, ScreenHeader, cx } from "@/components/ui";
import { CoreGate } from "@/components/CoreGate";
import { useBible, useDeskJobs, useProduction, useProjects } from "@/hooks";
import { locateShot, pad2, sectionLabel, selectInput, shotCode } from "../studio/shared";
import { EST_RENDER_MIN, STAGES, STAGE_DOT, STAGE_TONE, estRemaining } from "./shared";
import { ShotDrawer } from "./drawer";
import { CanonLibrary } from "./canon";
import { AbResults } from "./ab";
import { NormalizeDialog } from "./normalize";
import { AssembleDialog } from "./assembly";

export function DeskScreen() {
  const { episodeId } = useParams();
  const navigate = useNavigate();
  const prod = useProduction();
  const bible = useBible();
  const desk = useDeskJobs();
  const { projects, activeId, setActive } = useProjects();

  const episodes = useMemo(
    () =>
      (prod.production?.seasons ?? []).flatMap((season) =>
        season.episodes.map((episode) => ({ season, episode })),
      ),
    [prod.production],
  );
  const current = episodes.find((e) => e.episode.id === episodeId) ?? episodes[0] ?? null;
  const episode = current?.episode ?? null;

  const [shotId, setShotId] = useState<string | null>(null);
  const [canonOpen, setCanonOpen] = useState(false);
  const [abOpen, setAbOpen] = useState(false);
  const [normalizeOpen, setNormalizeOpen] = useState(false);
  const [assembleSceneId, setAssembleSceneId] = useState<string | null>(null);
  const located = useMemo(() => locateShot(episode, shotId), [episode, shotId]);

  const charById = useMemo(
    () => new Map(bible.bible.characters.map((c) => [c.id, c.name])),
    [bible.bible.characters],
  );

  if (!prod.production) {
    return (
      <CoreGate
        screen="Episodes"
        purpose="Episodes is the review desk: every shot of an episode by stage, where you approve takes, retake the weak ones and assemble scenes."
        icon={ClipboardCheck}
      />
    );
  }

  const shots = episode?.scenes.flatMap((s) => s.shots) ?? [];

  return (
    <div className="flex h-full min-h-0">
      <section className="flex min-w-0 flex-1 flex-col">
        <ScreenHeader
          title="Episodes"
          sub={
            episode
              ? `${episode.title || episode.id} · ${episode.scenes.length} scenes · ${shots.length} shots`
              : "no episodes yet"
          }
        >
          {/* the console's project switcher (P6) — the same active project the
              rail shows and list_projects marks; the crew addresses projects by
              id, so this is how the human sees the one the crew is in */}
          {projects.length > 1 && (
            <SelectBox
              value={activeId}
              onChange={(e) => setActive(e.target.value)}
              title="Project — every screen follows this"
              className={cx(selectInput, "w-[160px]")}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </SelectBox>
          )}
          {episodes.length > 1 && (
            <SelectBox
              value={episode?.id ?? ""}
              onChange={(e) => navigate(`/story/episodes/${e.target.value}`)}
              className={cx(selectInput, "w-[220px]")}
            >
              {episodes.map(({ season, episode: ep }) => (
                <option key={ep.id} value={ep.id}>
                  S{pad2(season.number)}E{pad2(ep.number)} · {ep.title || ep.id}
                </option>
              ))}
            </SelectBox>
          )}
          <button
            onClick={() => setAbOpen(true)}
            title="Experiments queued from the Video lab — variants side by side, with their wall clocks"
            className="inline-flex items-center gap-1.5 rounded-lg border border-cream/10 px-3 py-1.5 text-sm font-medium text-cream/80 transition hover:border-gold/40 hover:text-gold"
          >
            <FlaskConical size={13} /> A/B
          </button>
          <button
            onClick={() => setNormalizeOpen(true)}
            title="Adopt the lane's canvas, re-lay the cut in script order, re-export at −16 LUFS (dry run first)"
            className="inline-flex items-center gap-1.5 rounded-lg border border-cream/10 px-3 py-1.5 text-sm font-medium text-cream/80 transition hover:border-gold/40 hover:text-gold"
          >
            <Ruler size={13} /> Normalize to lane
          </button>
          <button
            onClick={() => setCanonOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cream/10 px-3 py-1.5 text-sm font-medium text-cream/80 transition hover:border-gold/40 hover:text-gold"
          >
            <BookImage size={13} /> Canon library
          </button>
        </ScreenHeader>

        {episode ? (
          <>
            <ProgressStrip shots={shots} activeJobs={desk.active} />
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
              <StageHeader shots={shots} />
              {episode.scenes.map((scene, sceneIdx) => (
                <SceneRow
                  key={scene.id}
                  scene={scene}
                  sceneIdx={sceneIdx}
                  bible={bible}
                  charById={charById}
                  activeShotId={located?.shot.id ?? null}
                  selectShot={(id) => setShotId(id === shotId ? null : id)}
                  busyShot={(id) => desk.shotJobs(id).length > 0}
                  onAssemble={() => setAssembleSceneId(scene.id)}
                />
              ))}
            </div>
          </>
        ) : (
          <EmptyState
            icon={ClipboardCheck}
            title="No episodes to review yet"
            action={
              <GoldButton onClick={() => navigate("/story/script")}>
                <PenLine size={13} /> Write an episode
              </GoldButton>
            }
          >
            This desk lists every shot of an episode by stage, so you can approve, retake and
            assemble. Write the first episode in Script and its shots land here.
          </EmptyState>
        )}
      </section>

      {located && (
        <ShotDrawer
          key={located.shot.id}
          located={located}
          prod={prod}
          bible={bible}
          busy={desk.shotJobs(located.shot.id).length}
          onClose={() => setShotId(null)}
        />
      )}

      <AbResults open={abOpen} onClose={() => setAbOpen(false)} />

      <NormalizeDialog open={normalizeOpen} onClose={() => setNormalizeOpen(false)} prod={prod} />

      <AssembleDialog
        scene={episode?.scenes.find((s) => s.id === assembleSceneId) ?? null}
        onClose={() => setAssembleSceneId(null)}
      />

      <CanonLibrary
        open={canonOpen}
        onClose={() => setCanonOpen(false)}
        production={prod.production}
        bible={bible}
      />
    </div>
  );
}

/* ---------- the episode progress strip ---------- */

function ProgressStrip({
  shots,
  activeJobs,
}: {
  shots: Shot[];
  activeJobs: ReturnType<typeof useDeskJobs>["active"];
}) {
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<ShotStage, number>;
  for (const s of shots) counts[shotStage(s)]++;
  const total = shots.length;
  const unrendered = counts.script + counts.voiced + counts.boarded;
  const est = estRemaining(unrendered);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b hairline px-5 py-2.5">
      <div className="flex items-center gap-3">
        {STAGES.map((s) => (
          <span
            key={s}
            title={s}
            className="flex items-center gap-1.5 text-2xs tabular-nums text-fog"
          >
            <span className={cx("h-1.5 w-1.5 rounded-full", STAGE_DOT[s])} />
            {counts[s]}
          </span>
        ))}
      </div>
      <div className="flex w-[180px] items-center gap-2">
        <Progress value={total ? (counts.approved / total) * 100 : 0} />
        <span className="shrink-0 text-2xs tabular-nums text-fog">
          {counts.approved}/{total}
        </span>
      </div>
      {est && (
        <span
          className="text-2xs text-fog"
          title={`${unrendered} shots still need a render at ≈${EST_RENDER_MIN} min each (LTX 2.5 draft)`}
        >
          {est} of renders left
        </span>
      )}
      <span className="ml-auto flex items-center gap-1.5 text-2xs text-fog">
        {activeJobs.length > 0 ? (
          <>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />
            {activeJobs.length} in flight — {activeJobs[0].title}
          </>
        ) : (
          "crew idle"
        )}
      </span>
    </div>
  );
}

/* ---------- the board ---------- */

/** stage column headers, sticky over every scene row */
function StageHeader({ shots }: { shots: Shot[] }) {
  return (
    <div className="sticky top-0 z-10 grid grid-cols-5 gap-3 bg-ink pb-1.5 pt-3">
      {STAGES.map((stage) => {
        const n = shots.filter((s) => shotStage(s) === stage).length;
        return (
          <div key={stage} className="flex items-center gap-2 px-2">
            <span className={cx("h-1.5 w-1.5 rounded-full", STAGE_DOT[stage])} />
            <span className={sectionLabel}>{stage}</span>
            <span className="ml-auto rounded-full bg-cream/8 px-1.5 text-2xs tabular-nums text-fog">
              {n}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SceneRow({
  scene,
  sceneIdx,
  bible,
  charById,
  activeShotId,
  selectShot,
  busyShot,
  onAssemble,
}: {
  scene: Scene;
  sceneIdx: number;
  bible: ReturnType<typeof useBible>;
  charById: Map<string, string>;
  activeShotId: string | null;
  selectShot: (id: string) => void;
  busyShot: (id: string) => boolean;
  onAssemble: () => void;
}) {
  const location = bible.bible.locations.find((l) => l.id === scene.location)?.name;
  return (
    <div className="mb-1">
      <div className="mb-2 mt-4 flex items-baseline gap-2">
        <span className="shrink-0 font-mono text-xs text-gold">S{pad2(sceneIdx + 1)}</span>
        <span className="truncate font-mono text-xs uppercase tracking-wide text-cream/80">
          {scene.slugline || "Untitled scene"}
        </span>
        {location && <span className="shrink-0 text-2xs text-fog">· {location}</span>}
        <span className="ml-auto shrink-0 text-2xs tabular-nums text-fog">
          {scene.shots.length} shot{scene.shots.length === 1 ? "" : "s"}
        </span>
        <button
          onClick={onAssemble}
          title="Plan, then run: voice + boards → renders → cut, only what each shot is missing"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-cream/10 px-2 py-0.5 text-2xs text-cream/70 transition hover:border-gold/40 hover:text-gold"
        >
          <Workflow size={11} /> Assemble
        </button>
      </div>
      <div className="grid grid-cols-5 gap-3">
        {STAGES.map((stage) => {
          const cell = scene.shots
            .map((shot, idx) => ({ shot, idx }))
            .filter(({ shot }) => shotStage(shot) === stage);
          return (
            <div
              key={stage}
              className="min-h-[52px] space-y-2 rounded-xl border hairline bg-surface/40 p-2"
            >
              {cell.map(({ shot, idx }) => (
                <DeskShotCard
                  key={shot.id}
                  shot={shot}
                  code={shotCode(sceneIdx, idx)}
                  active={shot.id === activeShotId}
                  busy={busyShot(shot.id)}
                  charNames={shot.characters.map((id) => charById.get(id) ?? id)}
                  keyframeUrl={bible.refUrl(
                    shot.keyframes.find((k) => k.id === shot.selectedKeyframe)?.asset ??
                      shot.keyframes[0]?.asset,
                  )}
                  onClick={() => selectShot(shot.id)}
                />
              ))}
              {cell.length === 0 && (
                <div className="flex h-9 items-center justify-center text-2xs text-fog/40">—</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DeskShotCard({
  shot,
  code,
  active,
  busy,
  charNames,
  keyframeUrl,
  onClick,
}: {
  shot: Shot;
  code: string;
  active: boolean;
  busy: boolean;
  charNames: string[];
  keyframeUrl?: string;
  onClick: () => void;
}) {
  const stage = shotStage(shot);
  const lines = shot.scriptLines.filter((l) => l.character && l.text.trim()).length;
  const newest = shot.videoTakes[shot.videoTakes.length - 1];
  const picked = shot.videoTakes.find((t) => t.id === shot.selectedTake) ?? newest;
  const broken = picked?.verify?.status === "broken" ? picked.verify.reasons.join("; ") : null;
  return (
    <button
      onClick={onClick}
      className={cx(
        "w-full overflow-hidden rounded-xl border text-left transition",
        active ? "border-gold/60" : "border-cream/10 hover:border-cream/25",
      )}
    >
      <div className="relative aspect-[16/10] w-full bg-gradient-to-br from-[#241c10] to-[#0d0a06]">
        {keyframeUrl && <img src={keyframeUrl} alt="" className="h-full w-full object-cover" />}
        {busy && (
          <span
            title="the crew is on it"
            className="absolute right-1.5 top-1.5 h-2 w-2 animate-pulse rounded-full bg-gold shadow-[0_0_8px_rgba(201,169,110,0.8)]"
          />
        )}
      </div>
      <div className="space-y-1 bg-surface px-2 py-1.5">
        <div className="flex items-center justify-between gap-1">
          <span className="font-mono text-2xs text-cream/90">{code}</span>
          <span className="flex items-center gap-1">
            {broken && (
              <span title={`Broken take: ${broken}`}>
                <Chip tone="ember" className="!px-1.5 !text-2xs">
                  broken
                </Chip>
              </span>
            )}
            <Chip tone={STAGE_TONE[stage]} className="!px-1.5 !text-2xs">
              {stage}
            </Chip>
          </span>
        </div>
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-2xs text-fog">
            {shot.title || charNames.slice(0, 2).join(", ") || "Untitled"}
          </span>
          <span className="shrink-0 text-2xs tabular-nums text-fog">
            {lines} ln · {shot.videoTakes.length} tk
          </span>
        </div>
        {(newest || shot.takeNotes.length > 0) && (
          <div className="flex items-center justify-between gap-1">
            <span className="truncate text-2xs text-fog">{newest?.engine ?? ""}</span>
            {shot.takeNotes.length > 0 && (
              <span className="shrink-0 text-2xs text-gold/70" title={shot.takeNotes.join(" · ")}>
                {shot.takeNotes.length} note{shot.takeNotes.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}
