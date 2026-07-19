/* Writers Room — S-P1 step 2. The episode as a screenplay: one scrolling
 * document (sluglines, action, centered dialogue) that edits the same
 * production.json the Studio board reads — script lines live on shots, so
 * locking the script IS boarding the episode. The right rail hands a premise
 * to the Director, whose production_* tool calls stream back into this screen
 * live through studio.onUpdate. */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  ChevronDown,
  Clapperboard,
  Feather,
  MessageSquareText,
  Plus,
  Square,
  Trash2,
} from "lucide-react";
import type { Episode, Scene, Shot } from "@aurea/shared";
import { Chip, GhostButton, GoldButton, cx } from "@/components/ui";
import { useBible, useChat, useDraft, useProduction } from "@/hooks";

const pad2 = (n: number) => String(n).padStart(2, "0");
const shotCode = (sceneIdx: number, shotIdx: number) => `S${pad2(sceneIdx + 1)}-${pad2(shotIdx + 1)}`;
const lineId = () => `l-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const sectionLabel = "text-[10px] font-semibold uppercase tracking-[0.16em] text-fog";
/** editable text that reads as typeset script until focused */
const quiet =
  "w-full rounded-md border border-transparent bg-transparent outline-none transition " +
  "focus:border-cream/10 focus:bg-ink/60 placeholder:text-fog/50";
/** auto-growing textarea — Chromium's field-sizing keeps it exactly text-height */
const grow = "resize-none [field-sizing:content]";

export function WritersRoomScreen() {
  const prod = useProduction();
  const bible = useBible();

  const episodes = useMemo(
    () =>
      (prod.production?.seasons ?? []).flatMap((season) =>
        season.episodes.map((e) => ({ season, episode: e })),
      ),
    [prod.production],
  );
  const [episodeId, setEpisodeId] = useState<string | null>(null);
  const current = episodes.find((e) => e.episode.id === episodeId) ?? episodes[0] ?? null;

  if (!prod.production) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-fog">
        Waiting for the studio core…
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <section className="flex min-w-0 flex-1 flex-col">
        <RoomHeader prod={prod} episodes={episodes} current={current} selectEpisode={setEpisodeId} />
        {current ? (
          <div className="flex min-h-0 flex-1">
            <OutlineRail key={`o-${current.episode.id}`} prod={prod} episode={current.episode} />
            <Screenplay key={current.episode.id} prod={prod} bible={bible} episode={current.episode} />
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <Feather size={28} className="text-gold/70" />
            <span className="font-serif text-xl text-cream">The room is empty</span>
            <p className="max-w-[360px] text-[12px] leading-relaxed text-fog">
              Start an episode, then draft it by hand here — or give the Director a premise in the
              rail and watch the script write itself.
            </p>
            <GoldButton onClick={() => prod.addEpisode({ title: "Pilot" })}>
              <Plus size={13} /> Start the pilot
            </GoldButton>
          </div>
        )}
      </section>

      <DirectorRail episode={current?.episode ?? null} production={prod.production} />
    </div>
  );
}

/* ---------- header: episode picker (Studio pattern) + script stats ---------- */

function RoomHeader({
  prod,
  episodes,
  current,
  selectEpisode,
}: {
  prod: ReturnType<typeof useProduction>;
  episodes: Array<{ season: { number: number }; episode: Episode }>;
  current: { season: { number: number }; episode: Episode } | null;
  selectEpisode: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const stats = useMemo(() => scriptStats(current?.episode ?? null), [current?.episode]);

  return (
    <header className="flex items-center justify-between gap-4 border-b hairline px-5 py-3">
      <div className="relative min-w-0">
        <button
          onClick={() => episodes.length > 0 && setOpen((o) => !o)}
          className="group flex min-w-0 items-center gap-2 text-left"
        >
          <h1 className="truncate font-serif text-[22px] font-semibold text-cream">
            {current
              ? `S${pad2(current.season.number)}E${pad2(current.episode.number)} — ${current.episode.title}`
              : (prod.production?.title ?? "Production")}
          </h1>
          {episodes.length > 0 && (
            <ChevronDown size={16} className="shrink-0 text-fog transition group-hover:text-gold" />
          )}
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
                    "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12px] transition",
                    episode.id === current?.episode.id ? "bg-gold/10 text-gold" : "text-cream hover:bg-cream/5",
                  )}
                >
                  <span className="truncate">
                    S{pad2(season.number)}E{pad2(episode.number)} — {episode.title}
                  </span>
                </button>
              ))}
              <button
                onClick={() => {
                  prod.addEpisode({ title: `Episode ${episodes.length + 1}` });
                  setOpen(false);
                }}
                className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-fog transition hover:bg-cream/5 hover:text-gold"
              >
                <Plus size={12} /> New episode
              </button>
            </div>
          </>
        )}
      </div>

      {current && (
        <div className="flex shrink-0 items-center gap-4 text-right">
          {(
            [
              [String(stats.scenes), "scenes"],
              [String(stats.shots), "shots"],
              [String(stats.dialogueLines), "lines"],
              [stats.runtime, "est. runtime"],
            ] as const
          ).map(([value, label]) => (
            <div key={label}>
              <p className="font-serif text-[16px] font-semibold text-cream">{value}</p>
              <p className="text-[9px] uppercase tracking-[0.14em] text-fog">{label}</p>
            </div>
          ))}
        </div>
      )}
    </header>
  );
}

/** dialogue at ~150 wpm plus a beat for every action line */
function scriptStats(episode: Episode | null) {
  if (!episode) return { scenes: 0, shots: 0, dialogueLines: 0, runtime: "0:00" };
  const shots = episode.scenes.flatMap((s) => s.shots);
  const lines = shots.flatMap((s) => s.scriptLines);
  const dialogue = lines.filter((l) => l.character);
  const words = dialogue.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);
  const seconds = Math.round(words / 2.5 + (lines.length - dialogue.length) * 2);
  return {
    scenes: episode.scenes.length,
    shots: shots.length,
    dialogueLines: dialogue.length,
    runtime: `${Math.floor(seconds / 60)}:${pad2(seconds % 60)}`,
  };
}

/* ---------- episode outline rail (mockup's left column) ---------- */

function OutlineRail({
  prod,
  episode,
}: {
  prod: ReturnType<typeof useProduction>;
  episode: Episode;
}) {
  return (
    <aside className="flex w-[220px] shrink-0 flex-col overflow-y-auto border-r hairline bg-[#0e0e10] px-3 py-3">
      <span className={sectionLabel}>Episode outline</span>
      <div className="mt-2 space-y-1">
        {episode.scenes.map((scene, i) => (
          <button
            key={scene.id}
            onClick={() =>
              document
                .getElementById(`scene-${scene.id}`)
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
            className="w-full rounded-lg border border-transparent px-2 py-1.5 text-left transition hover:border-cream/10 hover:bg-cream/5"
          >
            <span className="flex items-baseline gap-1.5">
              <span className="shrink-0 font-mono text-[10px] font-semibold text-gold/80">
                {pad2(i + 1)}
              </span>
              <span className="line-clamp-2 font-mono text-[10px] uppercase leading-snug text-cream/90">
                {scene.slugline}
              </span>
            </span>
            {scene.summary && (
              <span className="mt-0.5 line-clamp-2 pl-[22px] text-[10px] leading-snug text-fog">
                {scene.summary}
              </span>
            )}
          </button>
        ))}
        {episode.scenes.length === 0 && (
          <p className="px-2 text-[10px] leading-relaxed text-fog/80">
            No scenes yet — outline by hand below, or let the Director draft one.
          </p>
        )}
      </div>
      <button
        onClick={() =>
          prod.addScene({
            episodeId: episode.id,
            slugline: `INT. THE LOFT — SCENE ${episode.scenes.length + 1}`,
          })
        }
        className="mt-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fog transition hover:text-gold"
      >
        <Plus size={11} /> Add scene
      </button>
    </aside>
  );
}

/* ---------- the screenplay document ---------- */

function Screenplay({
  prod,
  bible,
  episode,
}: {
  prod: ReturnType<typeof useProduction>;
  bible: ReturnType<typeof useBible>;
  episode: Episode;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[680px] px-8 py-8">
        <TitleBlock key={`t-${episode.id}`} prod={prod} episode={episode} />
        {episode.scenes.map((scene, i) => (
          <SceneBlock key={scene.id} prod={prod} bible={bible} scene={scene} sceneIdx={i} />
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
    prod.updateEpisode(episode.id, { title: next.title, logline: next.logline, synopsis: next.synopsis }),
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
}: {
  prod: ReturnType<typeof useProduction>;
  bible: ReturnType<typeof useBible>;
  scene: Scene;
  sceneIdx: number;
}) {
  const { draft, patch } = useDraft(scene, (next) =>
    prod.updateScene(scene.id, { slugline: next.slugline, summary: next.summary, location: next.location }),
  );

  return (
    <div id={`scene-${scene.id}`} className="group/scene mt-7 scroll-mt-4">
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
        <ShotBlock key={shot.id} prod={prod} bible={bible} shot={shot} code={shotCode(sceneIdx, i)} />
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
}: {
  prod: ReturnType<typeof useProduction>;
  bible: ReturnType<typeof useBible>;
  shot: Shot;
  code: string;
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
    <div className="group/shot mt-3 ml-6 rounded-lg border-l-2 border-cream/8 py-1 pl-4 transition hover:border-gold/30">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-fog">{code}</span>
        {camera && <span className="truncate font-mono text-[10px] text-fog/70">{camera}</span>}
        <Chip tone={shot.status === "draft" ? "muted" : "violet"} className="!px-1.5 !text-[9px]">
          {shot.status}
        </Chip>
        <button
          title="Remove shot"
          onClick={() => prod.removeShot(shot.id)}
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

/* ---------- the Director rail ---------- */

const outlinePrompt = (episode: Episode, premise: string) =>
  [
    `Writers room — draft the OUTLINE for episode "${episode.title}" (episode id: ${episode.id}).`,
    `Premise: ${premise}`,
    "",
    "Work in the production spine, saving as you go:",
    "1. bible_get + production_get first — the cast, their speech patterns, and what already exists.",
    "2. episode_update: a one-line logline and a tight synopsis paragraph.",
    "3. production_add_scene: 3–5 scenes with proper sluglines, bible location ids, and 1–2 sentence",
    "   summaries that land the A-plot and one runner.",
    "No dialogue yet — this pass is the outline the writer signs off on. End with a one-line pitch.",
  ].join("\n");

const scriptPrompt = (episode: Episode, premise: string) =>
  [
    `Writers room — write the FULL SCRIPT for episode "${episode.title}" (episode id: ${episode.id}).`,
    `Premise: ${premise}`,
    "",
    "1. bible_get + production_get first. If the episode has no scenes yet, outline it first",
    "   (episode_update synopsis, then production_add_scene 3–5 scenes).",
    "2. Scene by scene: break each scene into 2–4 shots (production_add_shot) with camera specs in",
    "   the style bible's language, then write the dialogue with shot_update scriptLines —",
    "   character = bible character id, null = action line, deliveryNotes when the read matters.",
    "3. Keep every character inside their documented speech pattern. Sitcom pacing: short lines,",
    "   interruptions, every scene ends on a joke or a turn.",
    "Save shot by shot — the writer is watching the script fill in live on the Writers Room screen.",
  ].join("\n");

function DirectorRail({
  episode,
  production,
}: {
  episode: Episode | null;
  production: { logline: string };
}) {
  const chat = useChat();
  const navigate = useNavigate();
  const [premise, setPremise] = useState("");
  const effective = premise.trim() || episode?.logline || production.logline;

  // the newest Director text while it works — the room's over-the-shoulder view
  const latest = [...chat.messages].reverse().find((m) => m.role !== "user" && m.text?.trim());

  const dispatch = (build: (e: Episode, p: string) => string) => {
    if (!episode || chat.busy || !chat.live) return;
    chat.send(build(episode, effective || "Pick an episode idea worthy of the pilot."));
  };

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l hairline bg-[#0e0e10]">
      <div className="border-b hairline px-4 py-3">
        <span className={sectionLabel}>Writers room</span>
        <p className="mt-1 text-[11px] leading-relaxed text-fog">
          Hand the Director a premise. The script fills in here as it writes.
        </p>
      </div>

      <div className="space-y-2.5 px-4 py-3">
        <textarea
          value={premise}
          onChange={(e) => setPremise(e.target.value)}
          placeholder={
            episode?.logline
              ? `Premise — defaults to the episode logline: “${episode.logline}”`
              : "Premise — what is this episode about?"
          }
          className="min-h-[76px] w-full resize-y rounded-lg border border-cream/10 bg-ink/60 px-2.5 py-2 text-[12px] leading-relaxed text-cream outline-none placeholder:text-fog/60 focus:border-gold/40"
        />
        <div className="flex gap-2">
          <button
            onClick={() => dispatch(outlinePrompt)}
            disabled={!episode || chat.busy || !chat.live}
            className="flex-1 rounded-lg border border-gold/40 px-3 py-1.5 text-[12px] font-semibold text-gold transition enabled:hover:bg-gold/10 disabled:opacity-40"
          >
            Draft outline
          </button>
          <button
            onClick={() => dispatch(scriptPrompt)}
            disabled={!episode || chat.busy || !chat.live}
            className="flex-1 rounded-lg bg-gradient-to-b from-gold to-gold-deep px-3 py-1.5 text-[12px] font-semibold text-ink transition enabled:hover:brightness-110 disabled:opacity-40"
          >
            Write script
          </button>
        </div>
        {!chat.live && (
          <p className="text-[10px] leading-relaxed text-fog/80">
            The Director needs a live studio core.
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto border-t hairline px-4 py-3">
        {chat.busy ? (
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />
            <span className="text-[11px] font-medium text-gold">The Director is in the room…</span>
            <button
              title="Stop"
              onClick={chat.stop}
              className="ml-auto rounded p-1 text-fog transition hover:text-[#e07a6b]"
            >
              <Square size={11} fill="currentColor" />
            </button>
          </div>
        ) : (
          <span className={sectionLabel}>Latest from the Director</span>
        )}
        {latest?.text && (
          <p className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-cream/70">
            {latest.text}
          </p>
        )}
      </div>

      <div className="border-t hairline px-4 py-2.5">
        <GhostButton className="w-full justify-center" onClick={() => navigate("/")}>
          <Clapperboard size={12} /> Open Director chat
        </GhostButton>
      </div>
    </aside>
  );
}
