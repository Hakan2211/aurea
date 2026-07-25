/* Storyboard — S-P1 step 3. The boarding surface: every shot of an episode as
 * a keyframe card in script order, one scene per row, with the generation
 * panel on the right. Keyframes come from the qwen-edit reference workflow
 * (studio.board.generate) — the prompt preview here is composed by the same
 * shared function the server uses, so what you read is what the engine gets.
 * Finished stills attach server-side and stream back over studio.onUpdate. */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  Check,
  ChevronDown,
  Clapperboard,
  Images,
  LayoutPanelTop,
  RotateCcw,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  composeKeyframePrompt,
  imageAspectSchema,
  resolveKeyframeRefs,
  type Episode,
  type ImageAspect,
  type Scene,
  type Shot,
  type ShotStatus,
} from "@aurea/shared";
import { Chip, GhostButton, GoldButton, Progress, cx } from "@/components/ui";
import { useBible, useProduction, useStoryboard } from "@/hooks";
import type { ShotPrefill } from "@/screens/VideoLab";

const STATUS_TONE: Record<ShotStatus, "muted" | "violet" | "gold" | "ember" | "sage"> = {
  draft: "muted",
  boarded: "violet",
  generated: "gold",
  synced: "ember",
  approved: "sage",
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
const shotCode = (sceneIdx: number, shotIdx: number) => `S${pad2(sceneIdx + 1)}-${pad2(shotIdx + 1)}`;

export function StoryboardScreen() {
  const prod = useProduction();
  const bible = useBible();
  const board = useStoryboard();
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
  const [shotId, setShotId] = useState<string | null>(null);
  const located = useMemo(() => {
    for (const [sceneIdx, scene] of (current?.episode.scenes ?? []).entries()) {
      const shotIdx = scene.shots.findIndex((s) => s.id === shotId);
      if (shotIdx !== -1) return { scene, sceneIdx, shot: scene.shots[shotIdx], shotIdx };
    }
    return null;
  }, [current, shotId]);

  if (!prod.production) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-fog">
        Waiting for the studio core…
      </div>
    );
  }

  const shots = current?.episode.scenes.flatMap((s) => s.shots) ?? [];
  const boarded = shots.filter((s) => s.keyframes.length > 0).length;

  return (
    <div className="flex h-full">
      <section className="flex min-w-0 flex-1 flex-col">
        <BoardHeader
          episodes={episodes}
          current={current}
          selectEpisode={(id) => {
            setEpisodeId(id);
            setShotId(null);
          }}
          boarded={boarded}
          total={shots.length}
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
                activeShotId={located?.shot.id ?? null}
                selectShot={setShotId}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <LayoutPanelTop size={28} className="text-gold/70" />
            <span className="font-serif text-xl text-cream">Nothing to board yet</span>
            <p className="max-w-[380px] text-[12px] leading-relaxed text-fog">
              The storyboard works from the episode's shot list. Break your episode into scenes and
              shots first — in the Writers Room, on the Studio board, or by asking the Director.
            </p>
            <div className="flex gap-2">
              <GoldButton onClick={() => navigate("/script")}>Open Writers Room</GoldButton>
              <GhostButton onClick={() => navigate("/studio")}>Open Studio</GhostButton>
            </div>
          </div>
        )}
      </section>

      {located && current && (
        <BoardInspector
          key={located.shot.id}
          shot={located.shot}
          scene={located.scene}
          code={shotCode(located.sceneIdx, located.shotIdx)}
          prod={prod}
          bible={bible}
          board={board}
          close={() => setShotId(null)}
        />
      )}
    </div>
  );
}

/* ---------- header ---------- */

function BoardHeader({
  episodes,
  current,
  selectEpisode,
  boarded,
  total,
}: {
  episodes: Array<{ season: { number: number }; episode: Episode }>;
  current: { season: { number: number }; episode: Episode } | null;
  selectEpisode: (id: string) => void;
  boarded: number;
  total: number;
}) {
  const [open, setOpen] = useState(false);
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
              : "Storyboard"}
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

      {total > 0 && (
        <div className="flex shrink-0 items-center gap-3">
          <Images size={16} className="text-gold/80" />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">Boarded</p>
            <p className="text-[11px] text-cream/80">
              {boarded} / {total} shots have keyframes
            </p>
          </div>
        </div>
      )}
    </header>
  );
}

/* ---------- scene rows ---------- */

function SceneRow({
  scene,
  sceneIdx,
  bible,
  board,
  activeShotId,
  selectShot,
}: {
  scene: Scene;
  sceneIdx: number;
  bible: ReturnType<typeof useBible>;
  board: ReturnType<typeof useStoryboard>;
  activeShotId: string | null;
  selectShot: (id: string) => void;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-3">
        <span className={sectionLabel}>Scene {pad2(sceneIdx + 1)}</span>
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
  active,
  job,
  keyframeUrl,
  onClick,
}: {
  shot: Shot;
  code: string;
  active: boolean;
  job?: { progress: number; stage?: string; status: string };
  keyframeUrl?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "w-[228px] shrink-0 overflow-hidden rounded-xl border text-left transition",
        active ? "border-gold/60" : "border-cream/10 hover:border-cream/25",
      )}
    >
      <div className="relative aspect-video w-full bg-gradient-to-br from-[#241c10] to-[#0d0a06]">
        {keyframeUrl && <img src={keyframeUrl} alt="" className="h-full w-full object-cover" />}
        {!keyframeUrl && !job && (
          <div className="flex h-full items-center justify-center text-[10px] text-fog/70">
            not boarded
          </div>
        )}
        {job && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-ink/70 px-4">
            <Sparkles size={14} className="text-gold" />
            <span className="text-[10px] text-cream/90">
              {job.status === "queued" ? "Queued" : (job.stage ?? "Rendering…")}
            </span>
            <div className="w-full">
              <Progress value={job.progress} />
            </div>
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
          <span className="shrink-0 text-[9px] text-fog/70">
            {shot.keyframes.length} kf
          </span>
        </div>
      </div>
    </button>
  );
}

/* ---------- inspector: takes + generation ---------- */

function BoardInspector({
  shot,
  scene,
  code,
  prod,
  bible,
  board,
  close,
}: {
  shot: Shot;
  scene: Scene;
  code: string;
  prod: ReturnType<typeof useProduction>;
  bible: ReturnType<typeof useBible>;
  board: ReturnType<typeof useStoryboard>;
  close: () => void;
}) {
  const composed = useMemo(
    () => composeKeyframePrompt(shot, scene, bible.bible),
    [shot, scene, bible.bible],
  );
  const refs = useMemo(
    () => resolveKeyframeRefs(shot, scene, bible.bible),
    [shot, scene, bible.bible],
  );
  // null = follow the composed prompt; a string = the user's override
  const [override, setOverride] = useState<string | null>(null);
  const prompt = override ?? composed;
  const [count, setCount] = useState(2);
  const [aspect, setAspect] = useState<ImageAspect>("16:9");
  const [seed, setSeed] = useState("");

  const jobs = board.shotJobs(shot.id);
  const selected = shot.keyframes.find((k) => k.id === shot.selectedKeyframe) ?? shot.keyframes[0];
  const previewUrl = bible.refUrl(selected?.asset);

  const patchKeyframes = (keyframes: Shot["keyframes"], selectedKeyframe: string | null) =>
    prod.updateShot(shot.id, { keyframes, selectedKeyframe });

  const removeKeyframe = (id: string) => {
    const next = shot.keyframes.filter((k) => k.id !== id);
    patchKeyframes(next, shot.selectedKeyframe === id ? (next[0]?.id ?? null) : shot.selectedKeyframe);
  };

  const toggleApproved = (id: string) =>
    prod.updateShot(shot.id, {
      keyframes: shot.keyframes.map((k) => (k.id === id ? { ...k, approved: !k.approved } : k)),
      selectedKeyframe: id,
    });

  const generate = () =>
    board.generate({
      shotId: shot.id,
      prompt: override?.trim() ? override.trim() : undefined,
      count,
      aspect,
      seed: seed.trim() ? Number(seed.trim()) : undefined,
    });

  /* Send to Director: the core composes the shot into a Director timeline and
   * the Video lab opens with it loaded — nothing is enqueued here, because the
   * beats and the audio lane are worth a look before a ten-minute render. */
  const navigate = useNavigate();
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const sendToDirector = async () => {
    setSending(true);
    setSendError(null);
    try {
      const spec = await board.composeShot(shot.id);
      const state: { shot: ShotPrefill } = {
        shot: {
          shotId: shot.id,
          title: `${code} · ${shot.title || "Untitled"}`,
          sentAt: Date.now(),
          prompt: spec.prompt,
          startFrame: spec.startFrame,
          durationSec: spec.durationSec,
          director: spec.director,
          notes: spec.notes,
        },
      };
      navigate("/video", { state });
    } catch (err) {
      setSendError(String((err as Error).message));
    } finally {
      setSending(false);
    }
  };

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l hairline">
      <header className="flex items-center justify-between border-b hairline px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-[12px] text-cream">{code}</span>
          <Chip tone={STATUS_TONE[shot.status]}>{shot.status}</Chip>
          <span className="truncate text-[11px] text-fog">{shot.title}</span>
        </div>
        <button onClick={close} className="rounded p-1 text-fog transition hover:text-cream">
          <X size={14} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {/* selected keyframe preview */}
        <div className="overflow-hidden rounded-xl border hairline">
          <div className="relative aspect-video w-full bg-gradient-to-br from-[#241c10] to-[#0d0a06]">
            {previewUrl ? (
              <img src={previewUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center px-4 text-center text-[10px] leading-relaxed text-fog">
                No keyframes yet — generate the first takes below.
              </div>
            )}
            {selected?.approved && (
              <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-ink/80 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-sage">
                <Check size={10} /> approved
              </span>
            )}
          </div>
        </div>

        {/* takes strip */}
        {shot.keyframes.length > 0 && (
          <div>
            <span className={fieldLabel}>
              Takes ({shot.keyframes.length})
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {shot.keyframes.map((k) => {
                const url = bible.refUrl(k.asset);
                const isSelected = k.id === (shot.selectedKeyframe ?? shot.keyframes[0]?.id);
                return (
                  <div
                    key={k.id}
                    className={cx(
                      "group relative aspect-video overflow-hidden rounded-lg border transition",
                      isSelected ? "border-gold/60" : "border-cream/10 hover:border-cream/30",
                    )}
                  >
                    <button
                      className="h-full w-full"
                      title="Select keyframe"
                      onClick={() => prod.updateShot(shot.id, { selectedKeyframe: k.id })}
                    >
                      {url && <img src={url} alt="" className="h-full w-full object-cover" />}
                    </button>
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-ink/70 px-1 py-0.5 opacity-0 transition group-hover:opacity-100">
                      <button
                        title={k.approved ? "Unapprove" : "Approve"}
                        onClick={() => toggleApproved(k.id)}
                        className={cx("p-0.5 transition", k.approved ? "text-sage" : "text-fog hover:text-gold")}
                      >
                        <Star size={11} fill={k.approved ? "currentColor" : "none"} />
                      </button>
                      <button
                        title="Delete keyframe"
                        onClick={() => removeKeyframe(k.id)}
                        className="p-0.5 text-fog transition hover:text-[#e07a6b]"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                    {k.approved && (
                      <span className="absolute right-1 top-1 text-sage">
                        <Check size={11} />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* reference stack */}
        <div>
          <span className={fieldLabel}>References ({refs.length}/3)</span>
          {refs.length > 0 ? (
            <div className="flex gap-1.5">
              {refs.map((r) => {
                const url = bible.refUrl(r);
                return (
                  <span
                    key={r}
                    title={r}
                    className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-cream/10"
                  >
                    {url && <img src={url} alt="" className="h-full w-full object-cover object-top" />}
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="text-[10px] leading-relaxed text-fog/80">
              No references — give this shot characters (with bible refs) in the Studio inspector,
              or seed the Animal Sitcom bible.
            </p>
          )}
        </div>

        {/* prompt */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className={cx(fieldLabel, "mb-0")}>Prompt</span>
            {override !== null && (
              <button
                onClick={() => setOverride(null)}
                className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-fog transition hover:text-gold"
              >
                <RotateCcw size={10} /> Recompose
              </button>
            )}
          </div>
          <textarea
            className={cx(textArea, "min-h-[96px] text-[11px]")}
            value={prompt}
            onChange={(e) => setOverride(e.target.value)}
          />
          <p className="mt-1 text-[9px] leading-relaxed text-fog/70">
            Composed from script lines · camera · location · style bible. Edit to override this run.
          </p>
        </div>

        {/* generation controls */}
        <div className="grid grid-cols-3 gap-1.5">
          <label className="block">
            <span className={fieldLabel}>Takes</span>
            <select
              className={selectInput}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={fieldLabel}>Aspect</span>
            <select
              className={selectInput}
              value={aspect}
              onChange={(e) => setAspect(e.target.value as ImageAspect)}
            >
              {imageAspectSchema.options.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={fieldLabel}>Seed</span>
            <input
              className={textInput}
              placeholder="rnd"
              value={seed}
              onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </label>
        </div>

        {jobs.length > 0 && (
          <div className="rounded-lg border border-gold/25 bg-gold/5 px-2.5 py-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gold">
                {jobs[0].status === "queued" ? "Queued" : (jobs[0].stage ?? "Rendering")}
              </span>
              <span className="text-[10px] text-fog">{Math.round(jobs[0].progress)}%</span>
            </div>
            <Progress value={jobs[0].progress} />
          </div>
        )}

        {board.error && (
          <p className="rounded-lg border border-ember/40 bg-ember/10 px-2.5 py-2 text-[10px] leading-relaxed text-[#e0968b]">
            {board.error}
          </p>
        )}

        {sendError && (
          <p className="rounded-lg border border-ember/40 bg-ember/10 px-2.5 py-2 text-[10px] leading-relaxed text-[#e0968b]">
            {sendError}
          </p>
        )}

        <GoldButton
          className="w-full justify-center"
          disabled={refs.length === 0 || board.pending || jobs.length > 0}
          onClick={generate}
        >
          <Sparkles size={13} />
          {shot.keyframes.length > 0 ? "Generate more takes" : "Generate keyframes"}
        </GoldButton>

        {/* the boarded shot's next step: shoot it */}
        <GhostButton
          className="w-full justify-center"
          disabled={shot.keyframes.length === 0 || sending}
          onClick={sendToDirector}
          title={
            shot.keyframes.length === 0
              ? "Board the shot first — the selected keyframe is the take's first frame"
              : "Compose this shot into a Director timeline and open it in the Video lab"
          }
        >
          <Clapperboard size={13} />
          {sending ? "Composing…" : "Send to Director"}
        </GhostButton>
      </div>
    </aside>
  );
}
