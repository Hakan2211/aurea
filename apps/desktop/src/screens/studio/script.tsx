/* Studio — Script view. The episode as one typeset screenplay document
 * (sluglines, action, centered dialogue) editing the same production.json the
 * Board view reads: script lines live on shots, so locking the script IS
 * boarding the episode.
 *
 * The merge adds shared selection — a shot block carries the gold selection
 * rail when it's the selected shot, and clicking its code row hands the right
 * rail over to the inspector. Selection made in the Board view scrolls the
 * matching block into place here. */

import { SelectBox } from "@/components/ui/SelectBox";
import { useEffect, useRef } from "react";
import { Loader2, MessageSquareText, Mic, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { Episode, Scene, Shot } from "@aurea/shared";
import { Chip, cx } from "@/components/ui";
import { useDraft, useTableRead, type useBible, type useProduction } from "@/hooks";
import { STATUS_TONE, grow, lineId, pad2, quiet, sceneAnchor, shotAnchor, shotCode } from "./shared";

/** The voice state of one dialogue line — nothing until the line has a take
 * or one is being recorded; then play (the newest take) and retake. Reads the
 * shot's SERVER state, not the draft: takes attach in the core and arrive
 * over studio.onUpdate. */
function LineVoice({
  shot,
  sceneId,
  lineId,
  tableRead,
}: {
  shot: Shot;
  sceneId: string;
  lineId: string;
  tableRead: ReturnType<typeof useTableRead>;
}) {
  const take = [...shot.voTakes].reverse().find((t) => t.lineId === lineId);
  const busy = tableRead.lineActive(lineId);
  if (!take && !busy) return null;
  const url = take ? tableRead.takeUrl(take.asset) : undefined;
  return (
    <div className="mt-0.5 flex items-center justify-center gap-2 font-mono text-2xs uppercase tracking-[0.1em] text-fog">
      {busy ? (
        <span className="flex items-center gap-1 text-gold/70">
          <Loader2 size={9} className="animate-spin" /> voicing…
        </span>
      ) : (
        <>
          <button
            title="Play the newest take"
            disabled={!url}
            onClick={() => url && playTake(url)}
            className="flex items-center gap-1 transition hover:text-gold disabled:opacity-40"
          >
            <Play size={9} /> take
          </button>
          <button
            title="Retake this line"
            onClick={() => tableRead.read({ sceneId, lineIds: [lineId] })}
            className="flex items-center gap-1 transition hover:text-gold"
          >
            <RotateCcw size={9} /> retake
          </button>
        </>
      )}
    </div>
  );
}

/** one shared player, so a second line click replaces the first instead of
 * layering voices */
let currentTake: HTMLAudioElement | null = null;
function playTake(url: string) {
  currentTake?.pause();
  currentTake = new Audio(url);
  void currentTake.play();
}

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
  const tableRead = useTableRead();

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
            tableRead={tableRead}
          />
        ))}
        <button
          onClick={() =>
            prod.addScene({
              episodeId: episode.id,
              slugline: `INT. THE LOFT — SCENE ${episode.scenes.length + 1}`,
            })
          }
          className="mt-6 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-cream/15 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-fog transition hover:border-gold/40 hover:text-gold"
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
        className={cx(quiet, "mt-1 text-center text-sm italic text-fog")}
      />
      <textarea
        value={draft.synopsis}
        onChange={(e) => patch({ synopsis: e.target.value })}
        placeholder="Synopsis — the outline paragraph the episode hangs on."
        className={cx(quiet, grow, "mt-3 text-left text-sm leading-relaxed text-cream/75")}
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
  tableRead,
}: {
  prod: ReturnType<typeof useProduction>;
  bible: ReturnType<typeof useBible>;
  scene: Scene;
  sceneIdx: number;
  selectedShotId: string | null;
  selectShot: (id: string | null) => void;
  tableRead: ReturnType<typeof useTableRead>;
}) {
  const { draft, patch } = useDraft(scene, (next) =>
    prod.updateScene(scene.id, {
      slugline: next.slugline,
      summary: next.summary,
      location: next.location,
    }),
  );

  /* the table-read strip's scene totals: what can speak, what has spoken, and
   * what is being voiced right now (jobs carry the line id on their board) */
  const dialogue = scene.shots.flatMap((s) =>
    s.scriptLines.filter((l) => l.character && l.text.trim()),
  );
  const voiced = dialogue.filter((l) =>
    scene.shots.some((s) => s.voTakes.some((t) => t.lineId === l.id)),
  ).length;
  const reading = tableRead.active.filter((j) =>
    scene.shots.some((s) => s.id === j.payload.board?.shotId),
  ).length;
  // the hook's last result is app-wide — only this scene's skips belong here
  const skipped = tableRead.skipped.filter((s) => dialogue.some((l) => l.id === s.lineId));

  return (
    <div id={sceneAnchor(scene.id)} className="group/scene mt-7 scroll-mt-4">
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-mono text-xs font-semibold text-gold/80">
          {pad2(sceneIdx + 1)}
        </span>
        <input
          value={draft.slugline}
          onChange={(e) => patch({ slugline: e.target.value.toUpperCase() })}
          placeholder="INT. THE LOFT — NIGHT"
          className={cx(quiet, "font-mono text-sm font-semibold uppercase tracking-wide text-cream")}
        />
        {dialogue.length > 0 && (
          <button
            title={
              reading
                ? `Voicing ${reading} line${reading === 1 ? "" : "s"}…`
                : "Table read — voice every dialogue line in its character's cast voice"
            }
            disabled={reading > 0 || tableRead.pending}
            onClick={() => tableRead.read({ sceneId: scene.id })}
            className={cx(
              "flex shrink-0 items-center gap-1 rounded-pill border border-cream/12 px-2 py-0.5 font-mono text-2xs uppercase tracking-[0.1em] transition",
              reading > 0 || tableRead.pending
                ? "cursor-wait text-gold/70"
                : "text-fog hover:border-gold/40 hover:text-gold",
            )}
          >
            {reading > 0 ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <Mic size={10} />
            )}
            {reading > 0 ? `${reading} left` : `Table read · ${voiced}/${dialogue.length}`}
          </button>
        )}
        <button
          title="Remove scene"
          onClick={() => prod.removeScene(scene.id)}
          className="shrink-0 rounded p-1 text-fog opacity-0 transition group-hover/scene:opacity-100 hover:text-[#e07a6b]"
        >
          <Trash2 size={13} />
        </button>
      </div>
      {skipped.length > 0 && reading === 0 && (
        <p className="mt-1 pl-6 font-mono text-2xs text-amber-300/90">
          {skipped[0].reason}
          {skipped.length > 1 && ` (+${skipped.length - 1} more)`}
        </p>
      )}
      <textarea
        value={draft.summary}
        onChange={(e) => patch({ summary: e.target.value })}
        placeholder="Scene direction — what happens here."
        className={cx(quiet, grow, "mt-1 pl-6 font-mono text-sm leading-relaxed text-cream/70")}
      />

      {scene.shots.map((shot, i) => (
        <ShotBlock
          key={shot.id}
          prod={prod}
          bible={bible}
          shot={shot}
          sceneId={scene.id}
          code={shotCode(sceneIdx, i)}
          selected={shot.id === selectedShotId}
          selectShot={selectShot}
          tableRead={tableRead}
        />
      ))}
      <button
        onClick={() => prod.addShot({ sceneId: scene.id })}
        className="mt-2 ml-6 flex items-center gap-1 font-mono text-2xs uppercase tracking-[0.12em] text-fog transition hover:text-gold"
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
  sceneId,
  code,
  selected,
  selectShot,
  tableRead,
}: {
  prod: ReturnType<typeof useProduction>;
  bible: ReturnType<typeof useBible>;
  shot: Shot;
  sceneId: string;
  code: string;
  selected: boolean;
  selectShot: (id: string | null) => void;
  tableRead: ReturnType<typeof useTableRead>;
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
        <span className={cx("font-mono text-2xs", selected ? "text-gold" : "text-fog")}>
          {code}
        </span>
        {camera && <span className="truncate font-mono text-2xs text-fog">{camera}</span>}
        <Chip tone={STATUS_TONE[shot.status]} className="!px-1.5 !text-2xs">
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
                  <SelectBox
                    value={line.character}
                    onChange={(e) => patchLine(line.id, { character: e.target.value || null })}
                    className="cursor-pointer appearance-none rounded-md border border-transparent bg-transparent text-center font-mono text-sm font-semibold uppercase tracking-[0.1em] text-gold outline-none transition focus:border-cream/10 focus:bg-ink/60"
                  >
                    {bible.bible.characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                    <option value="">(action)</option>
                  </SelectBox>
                </div>
                <input
                  value={line.deliveryNotes}
                  onChange={(e) => patchLine(line.id, { deliveryNotes: e.target.value })}
                  placeholder="(delivery)"
                  className={cx(quiet, "text-center font-mono text-xs italic text-fog")}
                />
                <textarea
                  value={line.text}
                  onChange={(e) => patchLine(line.id, { text: e.target.value })}
                  placeholder="Dialogue…"
                  className={cx(quiet, grow, "text-center font-mono text-sm leading-relaxed text-cream")}
                />
                <LineVoice
                  shot={shot}
                  sceneId={sceneId}
                  lineId={line.id}
                  tableRead={tableRead}
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
                  className={cx(quiet, grow, "font-mono text-sm leading-relaxed text-cream/75")}
                />
              </div>
            )}
            <button
              title="Remove line"
              onClick={() => patch({ scriptLines: draft.scriptLines.filter((l) => l.id !== line.id) })}
              className="absolute -right-1 top-1 rounded p-0.5 text-fog opacity-0 transition group-hover/line:opacity-100 hover:text-[#e07a6b]"
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
          className="font-mono text-2xs uppercase tracking-[0.1em] text-fog transition hover:text-gold"
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
          className="font-mono text-2xs uppercase tracking-[0.1em] text-fog transition hover:text-gold"
        >
          + dialogue
        </button>
      </div>
    </div>
  );
}
