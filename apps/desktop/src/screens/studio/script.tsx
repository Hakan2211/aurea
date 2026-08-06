/* Studio — Script view. The episode as one typeset screenplay document
 * (sluglines, action, centered dialogue) editing the same production.json the
 * Board view reads: script lines live on shots, so locking the script IS
 * boarding the episode.
 *
 * The merge adds shared selection — a shot block carries the gold selection
 * rail when it's the selected shot, and clicking its code row hands the right
 * rail over to the inspector. Selection made in the Board view scrolls the
 * matching block into place here. */

import { useEffect, useRef } from "react";
import { MessageSquareText, Plus, Trash2 } from "lucide-react";
import type { Episode, Scene, Shot } from "@aurea/shared";
import { Chip, cx } from "@/components/ui";
import { useDraft, type useBible, type useProduction } from "@/hooks";
import { STATUS_TONE, grow, lineId, pad2, quiet, sceneAnchor, shotAnchor, shotCode } from "./shared";

export function ScriptView({
  prod,
  bible,
  episode,
  selectedShotId,
  selectShot,
}: {
  prod: ReturnType<typeof useProduction>;
  bible: ReturnType<typeof useBible>;
  episode: Episode;
  selectedShotId: string | null;
  selectShot: (id: string | null) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);

  /* a selection made in the Board view (or the rail) brings the block into
   * view; `nearest` makes it a no-op when the click happened right here */
  useEffect(() => {
    if (!selectedShotId) return;
    document
      .getElementById(shotAnchor(selectedShotId))
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedShotId]);

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[680px] px-8 py-8">
        <TitleBlock key={`t-${episode.id}`} prod={prod} episode={episode} />
        {episode.scenes.map((scene, i) => (
          <SceneBlock
            key={scene.id}
            prod={prod}
            bible={bible}
            scene={scene}
            sceneIdx={i}
            selectedShotId={selectedShotId}
            selectShot={selectShot}
          />
        ))}
        <button
          onClick={() =>
            prod.addScene({
              episodeId: episode.id,
              slugline: `INT. THE LOFT — SCENE ${episode.scenes.length + 1}`,
            })
          }
          className="mt-6 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-cream/15 py-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-fog transition hover:border-gold/40 hover:text-gold"
        >
          <Plus size={12} /> New scene
        </button>
        <div className="h-16" />
      </div>
    </div>
  );
}

function TitleBlock({
  prod,
  episode,
}: {
  prod: ReturnType<typeof useProduction>;
  episode: Episode;
}) {
  const { draft, patch } = useDraft(episode, (next) =>
    prod.updateEpisode(episode.id, {
      title: next.title,
      logline: next.logline,
      synopsis: next.synopsis,
    }),
  );
  return (
    <div className="mb-8 border-b hairline pb-6 text-center">
      <input
        value={draft.title}
        onChange={(e) => patch({ title: e.target.value })}
        placeholder="Episode title"
        className={cx(quiet, "text-center font-serif text-[26px] font-semibold text-cream")}
      />
      <input
        value={draft.logline}
        onChange={(e) => patch({ logline: e.target.value })}
        placeholder="Logline — the one-sentence pitch"
        className={cx(quiet, "mt-1 text-center text-[12px] italic text-fog")}
      />
      <textarea
        value={draft.synopsis}
        onChange={(e) => patch({ synopsis: e.target.value })}
        placeholder="Synopsis — the outline paragraph the episode hangs on."
        className={cx(quiet, grow, "mt-3 text-left text-[12px] leading-relaxed text-cream/75")}
      />
    </div>
  );
}

function SceneBlock({
  prod,
  bible,
  scene,
  sceneIdx,
  selectedShotId,
  selectShot,
}: {
  prod: ReturnType<typeof useProduction>;
  bible: ReturnType<typeof useBible>;
  scene: Scene;
  sceneIdx: number;
  selectedShotId: string | null;
  selectShot: (id: string | null) => void;
}) {
  const { draft, patch } = useDraft(scene, (next) =>
    prod.updateScene(scene.id, {
      slugline: next.slugline,
      summary: next.summary,
      location: next.location,
    }),
  );

  return (
    <div id={sceneAnchor(scene.id)} className="group/scene mt-7 scroll-mt-4">
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-mono text-[11px] font-semibold text-gold/80">
          {pad2(sceneIdx + 1)}
        </span>
        <input
          value={draft.slugline}
          onChange={(e) => patch({ slugline: e.target.value.toUpperCase() })}
          placeholder="INT. THE LOFT — NIGHT"
          className={cx(quiet, "font-mono text-[13px] font-semibold uppercase tracking-wide text-cream")}
        />
        <button
          title="Remove scene"
          onClick={() => prod.removeScene(scene.id)}
          className="shrink-0 rounded p-1 text-fog opacity-0 transition group-hover/scene:opacity-100 hover:text-[#e07a6b]"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <textarea
        value={draft.summary}
        onChange={(e) => patch({ summary: e.target.value })}
        placeholder="Scene direction — what happens here."
        className={cx(quiet, grow, "mt-1 pl-6 font-mono text-[12px] leading-relaxed text-cream/70")}
      />

      {scene.shots.map((shot, i) => (
        <ShotBlock
          key={shot.id}
          prod={prod}
          bible={bible}
          shot={shot}
          code={shotCode(sceneIdx, i)}
          selected={shot.id === selectedShotId}
          selectShot={selectShot}
        />
      ))}
      <button
        onClick={() => prod.addShot({ sceneId: scene.id })}
        className="mt-2 ml-6 flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fog/70 transition hover:text-gold"
      >
        <Plus size={11} /> Shot
      </button>
    </div>
  );
}

function ShotBlock({
  prod,
  bible,
  shot,
  code,
  selected,
  selectShot,
}: {
  prod: ReturnType<typeof useProduction>;
  bible: ReturnType<typeof useBible>;
  shot: Shot;
  code: string;
  selected: boolean;
  selectShot: (id: string | null) => void;
}) {
  const { draft, patch } = useDraft(shot, (next) => {
    const { id: _id, ...rest } = next;
    prod.updateShot(shot.id, rest);
  });
  const patchLine = (id: string, p: Partial<Shot["scriptLines"][number]>) =>
    patch({ scriptLines: draft.scriptLines.map((l) => (l.id === id ? { ...l, ...p } : l)) });

  const camera = [draft.camera.shotSize, draft.camera.angle, draft.camera.move]
    .filter(Boolean)
    .join(", ");

  return (
    <div
      id={shotAnchor(shot.id)}
      className={cx(
        "group/shot mt-3 ml-6 scroll-mt-4 rounded-lg border-l-2 py-1 pl-4 transition",
        selected ? "border-gold bg-gold/[0.04]" : "border-cream/8 hover:border-gold/30",
      )}
    >
      {/* the code row is the selection handle — clicking script text keeps the
          writers' rail in place, so typing never swaps the right column */}
      <div
        role="button"
        tabIndex={0}
        title={selected ? "Selected — click to deselect" : "Select this shot (opens the inspector)"}
        onClick={() => selectShot(selected ? null : shot.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selectShot(selected ? null : shot.id);
          }
        }}
        className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 transition hover:bg-cream/5"
      >
        <span className={cx("font-mono text-[10px]", selected ? "text-gold" : "text-fog")}>
          {code}
        </span>
        {camera && <span className="truncate font-mono text-[10px] text-fog/70">{camera}</span>}
        <Chip tone={STATUS_TONE[shot.status]} className="!px-1.5 !text-[9px]">
          {shot.status}
        </Chip>
        <button
          title="Remove shot"
          onClick={(e) => {
            e.stopPropagation();
            prod.removeShot(shot.id);
          }}
          className="ml-auto rounded p-0.5 text-fog opacity-0 transition group-hover/shot:opacity-100 hover:text-[#e07a6b]"
        >
          <Trash2 size={12} />
        </button>
      </div>

      <div className="mt-1 space-y-1.5">
        {draft.scriptLines.map((line) => (
          <div key={line.id} className="group/line relative">
            {line.character ? (
              <div className="px-10">
                <div className="flex items-center justify-center">
                  <select
                    value={line.character}
                    onChange={(e) => patchLine(line.id, { character: e.target.value || null })}
                    className="cursor-pointer appearance-none rounded-md border border-transparent bg-transparent text-center font-mono text-[12px] font-semibold uppercase tracking-[0.1em] text-gold outline-none transition focus:border-cream/10 focus:bg-ink/60"
                  >
                    {bible.bible.characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                    <option value="">(action)</option>
                  </select>
                </div>
                <input
                  value={line.deliveryNotes}
                  onChange={(e) => patchLine(line.id, { deliveryNotes: e.target.value })}
                  placeholder="(delivery)"
                  className={cx(quiet, "text-center font-mono text-[11px] italic text-fog")}
                />
                <textarea
                  value={line.text}
                  onChange={(e) => patchLine(line.id, { text: e.target.value })}
                  placeholder="Dialogue…"
                  className={cx(quiet, grow, "text-center font-mono text-[12.5px] leading-relaxed text-cream")}
                />
              </div>
            ) : (
              <div className="flex items-start gap-1">
                <button
                  title="Make dialogue"
                  onClick={() =>
                    patchLine(line.id, { character: bible.bible.characters[0]?.id ?? null })
                  }
                  className="mt-1 shrink-0 rounded p-0.5 text-fog/50 opacity-0 transition group-hover/line:opacity-100 hover:text-gold"
                >
                  <MessageSquareText size={11} />
                </button>
                <textarea
                  value={line.text}
                  onChange={(e) => patchLine(line.id, { text: e.target.value })}
                  placeholder="Action / stage direction…"
                  className={cx(quiet, grow, "font-mono text-[12px] leading-relaxed text-cream/75")}
                />
              </div>
            )}
            <button
              title="Remove line"
              onClick={() => patch({ scriptLines: draft.scriptLines.filter((l) => l.id !== line.id) })}
              className="absolute -right-1 top-1 rounded p-0.5 text-fog/60 opacity-0 transition group-hover/line:opacity-100 hover:text-[#e07a6b]"
            >
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-1 flex gap-3 opacity-0 transition group-hover/shot:opacity-100">
        <button
          onClick={() =>
            patch({
              scriptLines: [
                ...draft.scriptLines,
                { id: lineId(), character: null, text: "", deliveryNotes: "" },
              ],
            })
          }
          className="font-mono text-[10px] uppercase tracking-[0.1em] text-fog/70 transition hover:text-gold"
        >
          + action
        </button>
        <button
          onClick={() =>
            patch({
              scriptLines: [
                ...draft.scriptLines,
                {
                  id: lineId(),
                  character: bible.bible.characters[0]?.id ?? null,
                  text: "",
                  deliveryNotes: "",
                },
              ],
            })
          }
          className="font-mono text-[10px] uppercase tracking-[0.1em] text-fog/70 transition hover:text-gold"
        >
          + dialogue
        </button>
      </div>
    </div>
  );
}
