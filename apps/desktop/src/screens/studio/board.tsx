/* Studio — Board view (the old Studio kanban) plus the Board peek strip.
 *
 * Board view is per-scene: scene tabs over five status columns of shot cards.
 * Board peek is the same data flattened for the *Script* view — a docked strip
 * of status columns for the whole episode, so the writer can see how far the
 * page has boarded without leaving the page (studio-v2's docked kanban,
 * prototyped here as the plan asked before committing to toggle-only). */

import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import type { Episode, Scene, Shot } from "@aurea/shared";
import { Chip, cx } from "@/components/ui";
import { useDraft, type useBible, type useProduction } from "@/hooks";
import { STATUS, STATUS_DOT, STATUS_TONE, pad2, sectionLabel, selectInput, shotCode } from "./shared";

export function SceneTabs({
  scenes,
  sceneIdx,
  select,
  addScene,
}: {
  scenes: Scene[];
  sceneIdx: number;
  select: (id: string) => void;
  addScene: () => void;
}) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b hairline px-4 pt-2.5">
      {scenes.map((s, i) => (
        <button
          key={s.id}
          onClick={() => select(s.id)}
          title={s.slugline}
          className={cx(
            "shrink-0 rounded-t-lg border-x border-t px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition",
            i === sceneIdx
              ? "border-cream/10 bg-surface text-gold"
              : "border-transparent text-fog hover:text-cream",
          )}
        >
          Scene {pad2(i + 1)}
        </button>
      ))}
      <button
        onClick={addScene}
        title="Add scene"
        className="shrink-0 rounded-t-lg px-2.5 py-1.5 text-fog transition hover:text-gold"
      >
        <Plus size={13} />
      </button>
    </div>
  );
}

export function SceneBoard({
  prod,
  bible,
  scene,
  sceneIdx,
  shotId,
  selectShot,
}: {
  prod: ReturnType<typeof useProduction>;
  bible: ReturnType<typeof useBible>;
  scene: Scene;
  sceneIdx: number;
  shotId: string | null;
  selectShot: (id: string | null) => void;
}) {
  const { draft, patch } = useDraft(scene, (next) =>
    prod.updateScene(scene.id, {
      slugline: next.slugline,
      summary: next.summary,
      location: next.location,
    }),
  );
  const charById = new Map(bible.bible.characters.map((c) => [c.id, c]));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 px-4 py-2">
        <input
          value={draft.slugline}
          onChange={(e) => patch({ slugline: e.target.value })}
          className="w-[340px] rounded-lg border border-transparent bg-transparent px-2 py-1 font-mono text-[12px] uppercase tracking-wide text-cream/90 outline-none transition focus:border-cream/10 focus:bg-ink/60"
        />
        <select
          value={draft.location ?? ""}
          onChange={(e) => patch({ location: e.target.value || null })}
          className={cx(selectInput, "w-[160px]")}
        >
          <option value="">— location —</option>
          {bible.bible.locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <button
          title="Remove scene"
          onClick={() => prod.removeScene(scene.id)}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-fog transition hover:bg-ember/20 hover:text-[#e07a6b]"
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-3">
        {STATUS.map((status) => {
          const shots = scene.shots
            .map((s, i) => ({ shot: s, idx: i }))
            .filter(({ shot }) => shot.status === status);
          return (
            <div
              key={status}
              className="flex w-[210px] shrink-0 flex-col rounded-xl border hairline bg-surface/50"
            >
              <div className="flex items-center gap-2 px-3 py-2">
                <span className={cx("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])} />
                <span className={sectionLabel}>{status}</span>
                <span className="ml-auto rounded-full bg-cream/8 px-1.5 text-[10px] text-fog">
                  {shots.length}
                </span>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {shots.map(({ shot, idx }) => (
                  <ShotCard
                    key={shot.id}
                    shot={shot}
                    code={shotCode(sceneIdx, idx)}
                    active={shot.id === shotId}
                    charNames={shot.characters.map((id) => charById.get(id)?.name ?? id)}
                    keyframeUrl={bible.refUrl(
                      shot.keyframes.find((k) => k.id === shot.selectedKeyframe)?.asset ??
                        shot.keyframes[0]?.asset,
                    )}
                    onClick={() => selectShot(shot.id === shotId ? null : shot.id)}
                  />
                ))}
                {status === "draft" && (
                  <button
                    onClick={() => prod.addShot({ sceneId: scene.id })}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-cream/15 py-2 text-[11px] text-fog transition hover:border-gold/40 hover:text-gold"
                  >
                    <Plus size={12} /> Add shot
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ShotCard({
  shot,
  code,
  active,
  charNames,
  keyframeUrl,
  onClick,
}: {
  shot: Shot;
  code: string;
  active: boolean;
  charNames: string[];
  keyframeUrl?: string;
  onClick: () => void;
}) {
  const takes = shot.videoTakes.length;
  return (
    <button
      onClick={onClick}
      className={cx(
        "w-full overflow-hidden rounded-xl border text-left transition",
        active ? "border-gold/60" : "border-cream/10 hover:border-cream/25",
      )}
    >
      <div className="aspect-[16/10] w-full bg-gradient-to-br from-[#241c10] to-[#0d0a06]">
        {keyframeUrl && <img src={keyframeUrl} alt="" className="h-full w-full object-cover" />}
      </div>
      <div className="space-y-1 bg-surface px-2 py-1.5">
        <div className="flex items-center justify-between gap-1">
          <span className="font-mono text-[10px] text-cream/90">{code}</span>
          <Chip tone={STATUS_TONE[shot.status]} className="!px-1.5 !text-[9px]">
            {shot.status}
          </Chip>
        </div>
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-[10px] text-fog">
            {shot.title || charNames.slice(0, 2).join(", ") || "Untitled"}
          </span>
          <span className="shrink-0 text-[9px] text-fog/70">
            {takes} take{takes === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </button>
  );
}

/* ---------- board peek (docked under the Script view) ---------- */

export function BoardPeek({
  episode,
  open,
  setOpen,
  shotId,
  selectShot,
}: {
  episode: Episode;
  open: boolean;
  setOpen: (v: boolean) => void;
  shotId: string | null;
  selectShot: (id: string | null) => void;
}) {
  /* every shot in the episode with its display code, bucketed by status */
  const coded = episode.scenes.flatMap((scene, sceneIdx) =>
    scene.shots.map((shot, shotIdx) => ({ shot, code: shotCode(sceneIdx, shotIdx) })),
  );

  return (
    <div className="shrink-0 border-t hairline bg-[#0e0e10]">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-4 py-1.5 text-fog transition hover:text-cream"
      >
        <span className={sectionLabel}>Board peek</span>
        <span className="flex items-center gap-2">
          {STATUS.map((s) => {
            const n = coded.filter(({ shot }) => shot.status === s).length;
            return (
              <span key={s} title={s} className="flex items-center gap-1 text-[10px] tabular-nums">
                <span className={cx("h-1.5 w-1.5 rounded-full", STATUS_DOT[s])} />
                {n}
              </span>
            );
          })}
        </span>
        <span className="ml-auto">
          {open ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </span>
      </button>

      {open && (
        <div className="flex gap-3 overflow-x-auto px-4 pb-3">
          {STATUS.map((status) => {
            const bucket = coded.filter(({ shot }) => shot.status === status);
            return (
              <div key={status} className="flex w-[168px] shrink-0 flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <span className={cx("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])} />
                  <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-fog">
                    {status}
                  </span>
                  <span className="ml-auto text-[9px] tabular-nums text-fog/70">
                    {bucket.length}
                  </span>
                </div>
                <div className="max-h-[104px] space-y-1 overflow-y-auto pr-0.5">
                  {bucket.map(({ shot, code }) => (
                    <button
                      key={shot.id}
                      onClick={() => selectShot(shot.id === shotId ? null : shot.id)}
                      title={shot.title || code}
                      className={cx(
                        "flex w-full items-center gap-1.5 rounded-md border px-1.5 py-1 text-left transition",
                        shot.id === shotId
                          ? "border-gold/50 bg-gold/10"
                          : "border-cream/10 hover:border-cream/25",
                      )}
                    >
                      <span className="shrink-0 font-mono text-[9px] text-cream/90">{code}</span>
                      <span className="truncate text-[9px] text-fog">
                        {shot.title || "Untitled"}
                      </span>
                    </button>
                  ))}
                  {bucket.length === 0 && (
                    <p className="px-1 text-[9px] text-fog/50">—</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
