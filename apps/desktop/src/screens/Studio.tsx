/* Studio — the episode board (S-P1). Laid out after the "Episode Board"
 * design frame: cast & locations rail on the left, scene tabs over a
 * status-column board of shot cards in the center, and the shot inspector
 * (the takes-picker frame minus generation, which lands in S-P2) on the
 * right. Data = production.json via useProduction; granular mutations keep
 * the board, the inspector and Director edits converged. */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ChevronDown, ChevronLeft, ChevronRight, Clapperboard, Film, Plus, Trash2 } from "lucide-react";
import type { Episode, Scene, Shot, ShotStatus } from "@aurea/shared";
import { Chip, GhostButton, GoldButton, cx } from "@/components/ui";
import { useBible, useDraft, useProduction } from "@/hooks";

const STATUS: ShotStatus[] = ["draft", "boarded", "generated", "synced", "approved"];
const STATUS_TONE: Record<ShotStatus, "muted" | "violet" | "gold" | "ember" | "sage"> = {
  draft: "muted",
  boarded: "violet",
  generated: "gold",
  synced: "ember",
  approved: "sage",
};
const STATUS_DOT: Record<ShotStatus, string> = {
  draft: "bg-fog",
  boarded: "bg-[#a99bee]",
  generated: "bg-gold",
  synced: "bg-[#e07a6b]",
  approved: "bg-sage",
};

const sectionLabel = "text-[10px] font-semibold uppercase tracking-[0.16em] text-fog";
const fieldLabel = "mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-fog";
const textInput =
  "w-full rounded-lg border border-cream/10 bg-ink/60 px-2.5 py-1.5 text-[12px] text-cream " +
  "outline-none placeholder:text-fog/60 focus:border-gold/40";
const textArea = cx(textInput, "min-h-[52px] resize-y leading-relaxed");
const selectInput =
  "w-full rounded-md border border-cream/10 bg-ink px-2 py-1 text-[11px] text-cream outline-none focus:border-gold/40";

const pad2 = (n: number) => String(n).padStart(2, "0");
/** display code from position: scene 3, 2nd shot → S03-02 (computed, not stored) */
const shotCode = (sceneIdx: number, shotIdx: number) => `S${pad2(sceneIdx + 1)}-${pad2(shotIdx + 1)}`;

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
  const [sceneId, setSceneId] = useState<string | null>(null);
  const scenes = current?.episode.scenes ?? [];
  const sceneIdx = Math.max(0, scenes.findIndex((s) => s.id === sceneId));
  const scene = scenes[sceneIdx] ?? null;
  const [shotId, setShotId] = useState<string | null>(null);
  const shot = scene?.shots.find((s) => s.id === shotId) ?? null;

  if (!prod.production) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-fog">
        Waiting for the studio core…
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <CastRail bible={bible} />

      <section className="flex min-w-0 flex-1 flex-col">
        <BoardHeader
          prod={prod}
          episodes={episodes}
          current={current}
          selectEpisode={(id) => {
            setEpisodeId(id);
            setSceneId(null);
            setShotId(null);
          }}
        />

        {current ? (
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
                  episodeId: current.episode.id,
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
                shotId={shot?.id ?? null}
                selectShot={setShotId}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3">
                <p className="text-[12px] text-fog">No scenes yet — every episode starts with one.</p>
                <GoldButton
                  onClick={() =>
                    prod.addScene({ episodeId: current.episode.id, slugline: "INT. THE LOFT — DAY" })
                  }
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
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <Clapperboard size={28} className="text-gold/70" />
            <span className="font-serif text-xl text-cream">No episodes yet</span>
            <p className="max-w-[360px] text-[12px] leading-relaxed text-fog">
              {bible.bible.characters.length === 0
                ? "Seed the bible first (Bible → Seed Animal Sitcom), then start the pilot here — or ask the Director to draft an episode skeleton."
                : "Start the pilot — or ask the Director to draft an episode skeleton from a logline."}
            </p>
            <GoldButton onClick={() => prod.addEpisode({ title: "Pilot" })}>
              <Plus size={13} /> Add episode
            </GoldButton>
          </div>
        )}
      </section>

      {shot && scene && (
        <ShotInspector
          key={shot.id}
          shot={shot}
          code={shotCode(sceneIdx, scene.shots.findIndex((s) => s.id === shot.id))}
          scene={scene}
          prod={prod}
          bible={bible}
          selectShot={setShotId}
          close={() => setShotId(null)}
        />
      )}
    </div>
  );
}

/* ---------- cast & locations rail ---------- */

function CastRail({ bible }: { bible: ReturnType<typeof useBible> }) {
  return (
    <aside className="flex w-[210px] shrink-0 flex-col overflow-y-auto border-r hairline bg-[#0e0e10] px-3 py-4">
      <span className={sectionLabel}>Characters</span>
      <div className="mt-2 space-y-0.5">
        {bible.bible.characters.map((c) => {
          const url = bible.refUrl(c.refs.hero ?? c.refs.turnaround ?? c.refs.sheet);
          return (
            <div key={c.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-cream/10">
                {url ? (
                  <img src={url} alt="" className="h-full w-full object-cover object-top" />
                ) : (
                  <span className="font-serif text-[11px] text-gold">{c.name.charAt(0)}</span>
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-medium text-cream">{c.name}</span>
                <span className="block truncate text-[9px] uppercase tracking-[0.08em] text-fog">
                  {c.species || "—"}
                </span>
              </span>
            </div>
          );
        })}
        {bible.bible.characters.length === 0 && (
          <p className="px-1.5 text-[10px] leading-relaxed text-fog/80">
            Empty — seed the cast on the Bible screen.
          </p>
        )}
      </div>

      <span className={cx(sectionLabel, "mt-5")}>Locations</span>
      <div className="mt-2 space-y-0.5">
        {bible.bible.locations.map((l) => (
          <div key={l.id} className="rounded-lg px-1.5 py-1">
            <span className="block truncate text-[11px] font-medium text-cream">{l.name}</span>
            <span className="block truncate text-[9px] text-fog">{l.description || "—"}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

/* ---------- header: episode picker + progress ---------- */

function BoardHeader({
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
  const shots = current?.episode.scenes.flatMap((s) => s.shots) ?? [];
  const approved = shots.filter((s) => s.status === "approved").length;
  const pct = shots.length ? Math.round((approved / shots.length) * 100) : 0;

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
              : prod.production?.title ?? "Production"}
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
                  <button
                    title="Remove episode"
                    onClick={(e) => {
                      e.stopPropagation();
                      prod.removeEpisode(episode.id);
                    }}
                    className="ml-2 text-fog transition hover:text-[#e07a6b]"
                  >
                    <Trash2 size={12} />
                  </button>
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
        {current?.episode.logline && (
          <p className="mt-0.5 truncate text-[11px] text-fog">{current.episode.logline}</p>
        )}
      </div>

      {current && (
        <div className="flex shrink-0 items-center gap-3">
          <ProgressRing pct={pct} />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">
              Episode progress
            </p>
            <p className="text-[11px] text-cream/80">
              {approved} / {shots.length} shots approved
            </p>
          </div>
        </div>
      )}
    </header>
  );
}

function ProgressRing({ pct }: { pct: number }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" className="-rotate-90">
      <circle cx="22" cy="22" r={r} fill="none" stroke="rgba(237,234,228,0.08)" strokeWidth="4" />
      <circle
        cx="22"
        cy="22"
        r={r}
        fill="none"
        stroke="#c9a96e"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct / 100)}
      />
      <text
        x="22"
        y="22"
        textAnchor="middle"
        dominantBaseline="central"
        className="rotate-90"
        transform="rotate(90 22 22)"
        fill="#edeae4"
        fontSize="10"
        fontWeight="600"
      >
        {pct}%
      </text>
    </svg>
  );
}

/* ---------- scene tabs + board ---------- */

function SceneTabs({
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

function SceneBoard({
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
  selectShot: (id: string) => void;
}) {
  const { draft, patch } = useDraft(scene, (next) =>
    prod.updateScene(scene.id, { slugline: next.slugline, summary: next.summary, location: next.location }),
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
            <div key={status} className="flex w-[210px] shrink-0 flex-col rounded-xl border hairline bg-surface/50">
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
                    onClick={() => selectShot(shot.id)}
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

/* ---------- shot inspector ---------- */

function ShotInspector({
  shot,
  code,
  scene,
  prod,
  bible,
  selectShot,
  close,
}: {
  shot: Shot;
  code: string;
  scene: Scene;
  prod: ReturnType<typeof useProduction>;
  bible: ReturnType<typeof useBible>;
  selectShot: (id: string) => void;
  close: () => void;
}) {
  const { draft, patch } = useDraft(shot, (next) => {
    const { id: _id, ...rest } = next;
    prod.updateShot(shot.id, rest);
  });
  const idx = scene.shots.findIndex((s) => s.id === shot.id);
  const keyframeUrl = bible.refUrl(
    draft.keyframes.find((k) => k.id === draft.selectedKeyframe)?.asset ?? draft.keyframes[0]?.asset,
  );

  const toggleCharacter = (id: string) =>
    patch({
      characters: draft.characters.includes(id)
        ? draft.characters.filter((c) => c !== id)
        : [...draft.characters, id],
    });

  const patchLine = (lineId: string, p: Partial<Shot["scriptLines"][number]>) =>
    patch({ scriptLines: draft.scriptLines.map((l) => (l.id === lineId ? { ...l, ...p } : l)) });

  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-l hairline">
      <header className="flex items-center justify-between border-b hairline px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] text-cream">{code}</span>
          <Chip tone={STATUS_TONE[draft.status]}>{draft.status}</Chip>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            title="Previous shot"
            onClick={() => idx > 0 && selectShot(scene.shots[idx - 1].id)}
            className={cx("rounded p-1 transition", idx > 0 ? "text-fog hover:text-gold" : "text-fog/30")}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            title="Next shot"
            onClick={() => idx < scene.shots.length - 1 && selectShot(scene.shots[idx + 1].id)}
            className={cx(
              "rounded p-1 transition",
              idx < scene.shots.length - 1 ? "text-fog hover:text-gold" : "text-fog/30",
            )}
          >
            <ChevronRight size={14} />
          </button>
          <button
            title="Remove shot"
            onClick={() => {
              prod.removeShot(shot.id);
              close();
            }}
            className="rounded p-1 text-fog transition hover:text-[#e07a6b]"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {/* keyframe slot */}
        <div className="overflow-hidden rounded-xl border hairline">
          <div className="aspect-video w-full bg-gradient-to-br from-[#241c10] to-[#0d0a06]">
            {keyframeUrl ? (
              <img src={keyframeUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center px-4 text-center text-[10px] leading-relaxed text-fog">
                Keyframe slot — the storyboard step generates stills here from the bible refs +
                camera spec.
              </div>
            )}
          </div>
        </div>

        <label className="block">
          <span className={fieldLabel}>Title</span>
          <input
            className={textInput}
            value={draft.title}
            placeholder="MS, low angle, sitcom lighting"
            onChange={(e) => patch({ title: e.target.value })}
          />
        </label>

        <label className="block">
          <span className={fieldLabel}>Status</span>
          <select
            className={selectInput}
            value={draft.status}
            onChange={(e) => patch({ status: e.target.value as ShotStatus })}
          >
            {STATUS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <div>
          <span className={fieldLabel}>Characters</span>
          <div className="flex flex-wrap gap-1">
            {bible.bible.characters.map((c) => {
              const on = draft.characters.includes(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggleCharacter(c.id)}
                  className={cx(
                    "rounded-full border px-2 py-0.5 text-[10px] font-medium transition",
                    on
                      ? "border-gold/50 bg-gold/15 text-gold"
                      : "border-cream/10 text-fog hover:border-cream/25 hover:text-cream",
                  )}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>

        <label className="block">
          <span className={fieldLabel}>Location</span>
          <select
            className={selectInput}
            value={draft.location ?? ""}
            onChange={(e) => patch({ location: e.target.value || null })}
          >
            <option value="">— inherit scene —</option>
            {bible.bible.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>

        {/* camera & lens */}
        <div>
          <span className={fieldLabel}>Camera &amp; lens</span>
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                ["Shot size", "shotSize", "MS"],
                ["Angle", "angle", "low angle"],
                ["Move", "move", "slow push-in"],
                ["Lens", "lens", "35mm"],
              ] as const
            ).map(([label, key, ph]) => (
              <input
                key={key}
                title={label}
                placeholder={ph}
                className={textInput}
                value={draft.camera[key]}
                onChange={(e) => patch({ camera: { ...draft.camera, [key]: e.target.value } })}
              />
            ))}
          </div>
          <input
            title="Lighting"
            placeholder="sitcom lighting bank"
            className={cx(textInput, "mt-1.5")}
            value={draft.camera.lighting}
            onChange={(e) => patch({ camera: { ...draft.camera, lighting: e.target.value } })}
          />
        </div>

        {/* script / dialogue */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className={cx(fieldLabel, "mb-0")}>Script / dialogue</span>
            <button
              onClick={() =>
                patch({
                  scriptLines: [
                    ...draft.scriptLines,
                    { id: `l-${Date.now().toString(36)}`, character: null, text: "", deliveryNotes: "" },
                  ],
                })
              }
              className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-fog transition hover:text-gold"
            >
              <Plus size={11} /> Line
            </button>
          </div>
          <div className="space-y-2">
            {draft.scriptLines.map((line) => (
              <div key={line.id} className="rounded-lg border border-cream/10 bg-ink/40 p-2">
                <div className="mb-1 flex items-center gap-1.5">
                  <select
                    className={cx(selectInput, "flex-1")}
                    value={line.character ?? ""}
                    onChange={(e) => patchLine(line.id, { character: e.target.value || null })}
                  >
                    <option value="">— action —</option>
                    {bible.bible.characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    title="Remove line"
                    onClick={() =>
                      patch({ scriptLines: draft.scriptLines.filter((l) => l.id !== line.id) })
                    }
                    className="text-fog transition hover:text-[#e07a6b]"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <textarea
                  className={cx(textArea, "min-h-[40px]")}
                  placeholder={line.character ? "Dialogue…" : "Action / stage direction…"}
                  value={line.text}
                  onChange={(e) => patchLine(line.id, { text: e.target.value })}
                />
                {line.character && (
                  <input
                    className={cx(textInput, "mt-1")}
                    placeholder="Delivery — “more sarcastic”"
                    value={line.deliveryNotes}
                    onChange={(e) => patchLine(line.id, { deliveryNotes: e.target.value })}
                  />
                )}
              </div>
            ))}
            {draft.scriptLines.length === 0 && (
              <p className="text-[10px] leading-relaxed text-fog/80">
                No lines yet — dialogue assigned here drives voice takes and lip-sync in S-P2.
              </p>
            )}
          </div>
        </div>

        <label className="block">
          <span className={fieldLabel}>Notes</span>
          <textarea
            className={textArea}
            value={draft.notes}
            onChange={(e) => patch({ notes: e.target.value })}
          />
        </label>
      </div>
    </aside>
  );
}
