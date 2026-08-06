/* Director — the shot inspector, as a slide-over rather than a third fixed
 * column: two permanent 3-column layouts (chat + board) don't fit side by
 * side, and the board should not pay board-width rent for a panel you open a
 * few times a scene. Esc closes; the board keeps its selection ring. */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Check, Clapperboard, RotateCcw, Sparkles, Star, Trash2, X } from "lucide-react";
import {
  composeKeyframePrompt,
  imageAspectSchema,
  resolveKeyframeRefs,
  type ImageAspect,
  type Scene,
  type Shot,
} from "@aurea/shared";
import { Chip, GhostButton, GoldButton, Progress, cx } from "@/components/ui";
import type { useBible, useProduction, useStoryboard } from "@/hooks";
import type { ShotPrefill } from "@/screens/VideoLab";
import { STATUS_TONE, fieldLabel, selectInput, textInput } from "./shared";

const textArea = cx(textInput, "min-h-[52px] resize-y leading-relaxed");

export function ShotInspector({
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

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

  /* Send to Video Lab: the core composes the shot into a Director timeline and
   * the Video lab opens with it loaded — nothing is enqueued here, because the
   * beats and the audio lane are worth a look before a ten-minute render.
   * (It used to say "Send to Director"; with the Director sitting on the same
   * screen now, that label named the wrong destination.) */
  const navigate = useNavigate();
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const sendToVideoLab = async () => {
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
    <aside
      className={cx(
        // slide-over: absolute over the board's right edge, not a layout column
        "absolute inset-y-0 right-0 z-[var(--z-panel)] flex w-[360px] flex-col border-l hairline bg-[#0e0e10]",
        "anim-slide-over shadow-2xl shadow-ink/70",
      )}
    >
      <header className="flex items-center justify-between border-b hairline px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-[12px] text-cream">{code}</span>
          <Chip tone={STATUS_TONE[shot.status]}>{shot.status}</Chip>
          <span className="truncate text-[11px] text-fog">{shot.title}</span>
        </div>
        <button
          onClick={close}
          title="Close (Esc)"
          className="rounded p-1 text-fog transition hover:text-cream"
        >
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
            <span className={fieldLabel}>Takes ({shot.keyframes.length})</span>
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

        {/* the primary action follows the shot's state: an unboarded shot wants
            keyframes; a boarded one wants to be shot */}
        {shot.keyframes.length === 0 ? (
          <>
            <GoldButton
              className="w-full justify-center"
              disabled={refs.length === 0 || board.pending || jobs.length > 0}
              onClick={generate}
            >
              <Sparkles size={13} /> Generate keyframes
            </GoldButton>
            <GhostButton
              className="w-full justify-center"
              disabled
              title="Board the shot first — the selected keyframe is the take's first frame"
            >
              <Clapperboard size={13} /> Send to Video Lab
            </GhostButton>
          </>
        ) : (
          <>
            <GoldButton
              className="w-full justify-center"
              disabled={sending}
              onClick={sendToVideoLab}
              title="Compose this shot into a Director timeline and open it in the Video lab"
            >
              <Clapperboard size={13} /> {sending ? "Composing…" : "Send to Video Lab"}
            </GoldButton>
            <GhostButton
              className="w-full justify-center"
              disabled={refs.length === 0 || board.pending || jobs.length > 0}
              onClick={generate}
            >
              <Sparkles size={13} /> Generate more takes
            </GhostButton>
          </>
        )}
      </div>
    </aside>
  );
}
