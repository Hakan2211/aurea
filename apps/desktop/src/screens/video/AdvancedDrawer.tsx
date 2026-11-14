import {
  ArrowLeftRight,
  AudioLines,
  ChevronDown,
  CircleAlert,
  Dices,
  Film,
  FlaskConical,
  Lightbulb,
  ListPlus,
  Lock,
  Repeat,
  Scissors,
  X,
} from "lucide-react";
import { sprayVariants, type VideoAb } from "@aurea/shared";
import {
  GhostButton,
  LabDrawer,
  SectionLabel,
  Segmented,
  Slider,
  Toggle,
  customsSummary,
  cx,
} from "@/components/ui";
import type { CameraMove } from "./engineSurface";
import { PresetRail } from "./PresetRail";
import { ShotPicker } from "./ShotPicker";
import { AudioLane } from "./lanes/AudioLane";
import { CastLane } from "./lanes/CastLane";
import { MotionLane } from "./lanes/MotionLane";
import { ReferenceLane } from "./lanes/ReferenceLane";
import { FrameTile } from "./Composer";
import { BankSelect, MIN_BEAT_SEC, clampSec, fmtTime, selectInput } from "./shared";
import type { VideoParams } from "./useVideoParams";

/* The Advanced drawer (UI simplify plan, Stage 2) — every Video control that
 * isn't needed for a plain run: presets and looks, the end frame and guide
 * frames, the Shot Director timeline, camera, quality, frame rate, adapters,
 * sound, references, the cinematography picks, motion strength and the A/B /
 * seed-spray experiments. The markup is the old params panel's, moved; the
 * state is the same hook the composer reads, so opening or closing the drawer
 * never changes what Generate sends. */

/** A collapsed summary row that expands on click — the drawer's unit of
 * progressive disclosure. Locked renders greyed with the surface's reason;
 * the chevron and the one-line summary are the whole collapsed footprint. */
function DisclosureRow({
  title,
  summary,
  state = "shown",
  reason,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: string;
  state?: "shown" | "locked" | "hidden";
  reason?: string;
  open: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  if (state === "hidden") return null;
  if (state === "locked") {
    return (
      <div className="rounded-panel border border-cream/8 bg-surface/30 px-3 py-2.5 opacity-60">
        <div className="flex items-center gap-2">
          <span className="flex-1 text-xs font-medium uppercase tracking-[0.1em] text-cream/70">
            {title}
          </span>
          <Lock size={11} className="shrink-0 text-fog" />
        </div>
        {reason && <p className="mt-1 text-2xs leading-relaxed text-fog">{reason}</p>}
      </div>
    );
  }
  return (
    <div className="rounded-panel border border-cream/10 bg-surface/40 transition hover:border-cream/18">
      <button onClick={onToggle} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        <span className="shrink-0 text-2xs font-semibold uppercase tracking-[0.12em] text-cream/85">
          {title}
        </span>
        <span className="ml-auto min-w-0 truncate text-right text-2xs text-fog">{summary}</span>
        <ChevronDown
          size={12}
          className={cx(
            "shrink-0 text-fog transition-transform duration-[var(--dur)] ease-[var(--ease-out-quart)]",
            open && "rotate-180",
          )}
        />
      </button>
      {open && <div className="anim-fade border-t hairline px-3 pb-3 pt-2.5">{children}</div>}
    </div>
  );
}

export function AdvancedDrawer({ p, onClose }: { p: VideoParams; onClose: () => void }) {
  const {
    lab, ab, presets, setAbOpen, prompt, setPrompt, motion, setMotion,
    frameRel, setFrameRel, setPicking, endFrameRel, setEndFrameRel, loop, setLoop,
    simpleKeyframes, setSimpleKeyframes, minimaxRefs, setMinimaxRefs, importedRefs,
    refImportError, stillImportError, presetLook, negative, setNegative,
    directorOn, setDirectorOn, keyframes, setKeyframes, beats, setBeats, blend, setBlend,
    audioRel, setAudioRel, audioOpen, setAudioOpen, lane, setLane, roomTone, setRoomTone,
    motionRef, setMotionRef, castRefs, setCastRefs, refStrength, setRefStrength,
    fps, setFps, setQuality, enhance, setEnhance, loras, setLoras,
    cameraMove, setCameraMove, cameraStrength, setCameraStrength,
    presetId, presetCustomised, cine, setCine, openRow, toggleRow, applyPreset, clearPreset,
    surface, isLtx, isMinimax, keyframesMax, lorasMax, retake, engineId,
    chosen, effectiveRel, endFrame, frameName, frameSwatch, startFrameUrl,
    refCount, refsOn, t2vOn, canGenerate, audioName, durationSec, effectiveQuality, enhancer25,
    minimaxHead, minimaxFormat, minimaxDistill, minimaxWeightLabel,
    directorBlocked, guidesOn, endFrameShown, loopOn,
    importRefImages, dropInto, insertTag,
    addBeat, addKeyframe, addSimpleKeyframe, tiling,
    cineClauseText, activeLook, composed, composerNotes,
    installedLoras, missingLoras, payload,
    soundSummary, adapterSummary, cameraMoves, customs,
  } = p;

  return (
    <LabDrawer title="Advanced" summary={customsSummary(customs)} onClose={onClose}>
      <div className="space-y-5 p-4">
        {/* presets — a lane (the show's shot shapes) or a look (no bible needed) */}
        <section className="space-y-4">
        <PresetRail
          presets={presets.filter((p) => p.lane !== "look")}
          activeId={presetId}
          customised={presetCustomised}
          onApply={applyPreset}
          onClear={clearPreset}
        />
        <PresetRail
          title="Look"
          hint="No bible needed — a look sets the engine, canvas, camera, look prose and negative for a picture or a sentence."
          presets={presets.filter((p) => p.lane === "look")}
          activeId={presetId}
          customised={presetCustomised}
          onApply={applyPreset}
          onClear={clearPreset}
          sampleUrl={lab.stillUrl}
        />
          <div>
          {composed && !t2vOn && (
            <p className="mt-1.5 text-2xs leading-relaxed text-fog">
              <span className="text-rose-200/80">Image to video ·</span> the image is the subject —
              write only what moves and what stays; the composer adds the camera, the look and the
              negative.
            </p>
          )}
          {presetLook && (
            <p className="mt-1.5 text-2xs leading-relaxed text-fog" title={presetLook}>
              <span className="text-rose-200/80">Look ·</span> {presetLook}
            </p>
          )}
          {negative && (
            <p className="mt-1 flex items-start gap-1.5 text-2xs leading-relaxed text-fog">
              <span className="min-w-0 flex-1 truncate" title={negative}>
                <span className="text-rose-200/80">Avoids ·</span> {negative}
                {!isLtx && <span className="text-fog/50"> (LTX only — this engine has no negative)</span>}
              </span>
              <button
                onClick={() => setNegative("")}
                title="Drop the negative"
                className="shrink-0 text-fog transition hover:text-red-300"
              >
                <X size={9} />
              </button>
            </p>
          )}
          {composerNotes.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {composerNotes.slice(0, 3).map((n) => (
                <li key={n} className="text-2xs leading-relaxed text-fog" title={n}>
                  <span className="text-gold/70">Composer ·</span> {n}
                </li>
              ))}
            </ul>
          )}
          </div>
        </section>

        {/* frames beyond the start: where the take lands, and what it passes through */}
        {(endFrameShown ||
          (guidesOn && surface.sections.keyframes.state === "shown") ||
          (surface.sections.endFrame.state === "locked" && !directorOn && !retake && !refsOn) ||
          !!chosen?.sourcePrompt ||
          !!lab.inboxDir) && (
          <section>
            <SectionLabel>Frames</SectionLabel>
            {endFrameShown && (
              <>
                <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
                  <span className="text-2xs uppercase tracking-[0.12em] text-fog">Start</span>
                  <span />
                  <span className="text-2xs uppercase tracking-[0.12em] text-fog">End</span>
                </div>
                <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
                  <FrameTile
                    url={startFrameUrl}
                    swatch={frameSwatch}
                    name={frameName}
                    onPick={() => setPicking("start")}
                  />
                  <button
                    onClick={() => {
                      // swapping is only meaningful once both slots are real
                      // stills — the start slot falls back to the newest
                      // still, which has no relPath to hand over
                      const start = frameRel ?? effectiveRel;
                      setFrameRel(endFrameRel);
                      setEndFrameRel(start ?? null);
                    }}
                    disabled={!endFrameRel || loopOn}
                    title={loopOn ? "Looping — the end frame is the start frame" : "Swap the start and end frames"}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-fog transition hover:bg-cream/5 hover:text-gold disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fog"
                  >
                    <ArrowLeftRight size={12} />
                  </button>
                  <div {...dropInto("end")}>
                    <FrameTile
                      url={loopOn ? startFrameUrl : (endFrame?.url ?? lab.stillUrl(endFrameRel))}
                      swatch={loopOn ? frameSwatch : endFrame?.swatch}
                      name={
                        loopOn
                          ? frameName
                          : endFrameRel
                            ? (endFrame?.name ?? (endFrameRel.split("/").pop() ?? endFrameRel))
                            : undefined
                      }
                      meta={loopOn ? "loops back here" : endFrameRel ? "lands here" : undefined}
                      emptyLabel={endFrameRel ? undefined : "Pick or drop a frame to land on"}
                      onPick={() => (loopOn ? setLoop(false) : setPicking("end"))}
                      onClear={loopOn ? () => setLoop(false) : endFrameRel ? () => setEndFrameRel(null) : undefined}
                    />
                  </div>
                </div>
                <p className="mt-1.5 text-2xs leading-relaxed text-fog">
                  {endFrameRel
                    ? engineId === "minimax-h3"
                      ? "fl2va — H3 has to arrive at this frame by the last beat."
                      : "LTX interpolates the whole way there, in one continuous take."
                    : engineId === "minimax-h3"
                      ? "Leave empty and H3 animates forward freely from the start frame."
                      : "Optional — the take is guided to land on this frame."}
                </p>
                {effectiveRel && (
                  <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-xl border border-cream/10 bg-surface/40 px-2.5 py-2 transition hover:border-cream/25">
                    <input
                      type="checkbox"
                      checked={loop}
                      onChange={(e) => setLoop(e.target.checked)}
                      className="mt-0.5 h-3 w-3 shrink-0 accent-gold"
                    />
                    <span className="text-2xs leading-relaxed text-fog">
                      <span className="inline-flex items-center gap-1 font-medium text-cream">
                        <Repeat size={10} /> Loop
                      </span>{" "}
                      — the take lands back on its start frame, so it cycles without a cut. The
                      seam frame is marked in the take for export to trim.
                    </span>
                  </label>
                )}
              </>
            )}
            {surface.sections.endFrame.state === "locked" && !directorOn && !retake && !refsOn && (
              <p className="mt-1.5 text-2xs leading-relaxed text-fog">
                End frame — {surface.sections.endFrame.reason}
              </p>
            )}
          {guidesOn && surface.sections.keyframes.state === "shown" && (
            <div className="mt-2 space-y-1.5">
              {simpleKeyframes.map((k, i) => {
                const still = lab.frames.find((f) => f.relPath === k.image);
                return (
                  <div
                    key={`${k.image}-${i}`}
                    className="flex items-center gap-2 rounded-xl border border-cream/10 bg-surface px-2.5 py-1.5"
                  >
                    <input
                      type="number"
                      min={0}
                      max={durationSec}
                      step={0.1}
                      value={k.atSec}
                      title="When this frame is imposed"
                      onChange={(e) =>
                        setSimpleKeyframes((ks) =>
                          ks.map((x, j) =>
                            j === i
                              ? { ...x, atSec: clampSec(Number(e.target.value), durationSec) }
                              : x,
                          ),
                        )
                      }
                      className="w-10 shrink-0 bg-transparent text-2xs tabular-nums text-gold focus:outline-none"
                    />
                    <button
                      onClick={() => setPicking({ lane: "simple", i })}
                      title="Choose a different still"
                      className="min-w-0 flex-1 truncate text-left text-xs text-cream/85 transition hover:text-gold"
                    >
                      {still?.name ?? k.image.split("/").pop()}
                    </button>
                    <input
                      type="range"
                      min={0.3}
                      max={1}
                      step={0.05}
                      value={k.strength}
                      title={`Hold strength ${k.strength.toFixed(2)}`}
                      onChange={(e) =>
                        setSimpleKeyframes((ks) =>
                          ks.map((x, j) => (j === i ? { ...x, strength: Number(e.target.value) } : x)),
                        )
                      }
                      className="w-12 shrink-0 accent-gold"
                    />
                    <button
                      onClick={() => setSimpleKeyframes((ks) => ks.filter((_, j) => j !== i))}
                      className="shrink-0 text-fog transition hover:text-red-400"
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
              {simpleKeyframes.length < keyframesMax && (
                <button
                  onClick={addSimpleKeyframe}
                  className="w-full rounded-xl border border-dashed border-cream/15 px-2 py-1.5 text-2xs text-cream/80 transition hover:border-gold/50 hover:text-gold"
                >
                  + Mid-shot keyframe
                </button>
              )}
              {simpleKeyframes.length > 0 && (
                <p className="text-2xs leading-relaxed text-fog">
                  {simpleKeyframes.length} of {keyframesMax} anchors — each still is imposed at its
                  time on the way to the end frame.
                </p>
              )}
            </div>
          )}
            <div className="mt-2 space-y-1">
              {chosen?.sourcePrompt && (
                <button
                  type="button"
                  className="text-2xs text-fog transition hover:text-gold"
                  title={chosen.sourcePrompt}
                  onClick={() => setPrompt(chosen.sourcePrompt!.slice(0, lab.promptMax))}
                >
                  Use the start still&apos;s own prompt
                </button>
              )}
              {lab.inboxDir && (
                <p
                  className="select-text break-all text-2xs leading-relaxed text-fog/50"
                  title="Drop Midjourney, GPT or Krea images here"
                >
                  Inbox · {lab.inboxDir}
                </p>
              )}
              {stillImportError && (
                <p className="flex items-start gap-1 text-2xs text-red-300">
                  <CircleAlert size={10} className="mt-px shrink-0" /> {stillImportError}
                </p>
              )}
            </div>
          </section>
        )}

        {/* Shot Director — the timeline path. Rendered whenever the engine
            speaks it (or a retake needs somewhere to live), and the surface's
            reason shows when this install can't run it. */}
        {(surface.sections.director.state !== "hidden" || retake) && (
          <section>
            <SectionLabel
              hint
              right={
                retake ? (
                  /* the toggle would be a lie mid-retake — nothing on the timeline
                   * reaches this render either way */
                  <span className="inline-flex items-center gap-1 rounded-pill bg-gold/20 px-2 py-0.5 text-2xs font-medium text-gold">
                    <Scissors size={10} /> Retake
                  </span>
                ) : (
                  <button
                    onClick={() => {
                      // the take attached above is dialogue at 0s — the lane's
                      // one-segment case, so carry it over instead of losing it
                      if (!directorOn && audioRel && lane.length === 0) {
                        setLane([{ take: audioRel, atSec: 0, trimStartSec: 0 }]);
                      }
                      setDirectorOn((o) => !o);
                    }}
                    disabled={directorBlocked}
                    className={cx(
                      "inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-2xs font-medium transition",
                      directorBlocked
                        ? "cursor-not-allowed bg-cream/5 text-fog/50"
                        : directorOn
                          ? "bg-gold/20 text-gold"
                          : "bg-gold/12 text-gold hover:bg-gold/20",
                    )}
                  >
                    <Film size={10} /> {directorOn ? "On" : "Off"}
                  </button>
                )
              }
            >
              Shot Director
            </SectionLabel>
            {directorBlocked ? (
              <p className="mt-1.5 text-2xs leading-relaxed text-fog">
                {surface.sections.director.reason ??
                  "Needs a ComfyUI with the Director node pack — check Settings → Engines."}
              </p>
            ) : retake ? (
              <p className="mt-1.5 text-2xs leading-relaxed text-gold/80">
                A retake is in progress — describe the fix in the composer under the preview.
                Nothing on the Director timeline reaches a retake render.
              </p>
            ) : !directorOn ? (
              <p className="mt-1.5 text-2xs leading-relaxed text-fog">
                Turn on to pin an end frame and mid-shot keyframes — LTX renders the move between
                them as one continuous take instead of a cut.
              </p>
            ) : (
              <div className="mt-2 space-y-1.5">
                <div className="flex items-center gap-2 rounded-xl border border-cream/10 bg-surface px-2.5 py-1.5">
                  <span className="w-10 shrink-0 text-2xs tabular-nums text-gold">0.0s</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-cream/85">
                    {frameName}
                  </span>
                  <span className="shrink-0 text-2xs uppercase tracking-wider text-fog">
                    start
                  </span>
                </div>

                {keyframes.map((k, i) => {
                  const still = lab.frames.find((f) => f.relPath === k.image);
                  return (
                    <div
                      key={`${k.image}-${i}`}
                      className="flex items-center gap-2 rounded-xl border border-cream/10 bg-surface px-2.5 py-1.5"
                    >
                      <input
                        type="number"
                        min={0}
                        max={durationSec}
                        step={0.1}
                        value={k.atSec}
                        onChange={(e) =>
                          setKeyframes((ks) =>
                            ks.map((x, j) =>
                              j === i
                                ? { ...x, atSec: clampSec(Number(e.target.value), durationSec) }
                                : x,
                            ),
                          )
                        }
                        className="w-10 shrink-0 bg-transparent text-2xs tabular-nums text-gold focus:outline-none"
                      />
                      <button
                        onClick={() => setPicking({ lane: "director", i })}
                        title="Choose a different still"
                        className="min-w-0 flex-1 truncate text-left text-xs text-cream/85 transition hover:text-gold"
                      >
                        {still?.name ?? k.image.split("/").pop()}
                      </button>
                      <input
                        type="range"
                        min={0.3}
                        max={1}
                        step={0.05}
                        value={k.strength}
                        title={`Hold strength ${k.strength.toFixed(2)}`}
                        onChange={(e) =>
                          setKeyframes((ks) =>
                            ks.map((x, j) => (j === i ? { ...x, strength: Number(e.target.value) } : x)),
                          )
                        }
                        className="w-12 shrink-0 accent-gold"
                      />
                      <button
                        onClick={() => setKeyframes((ks) => ks.filter((_, j) => j !== i))}
                        className="shrink-0 text-fog transition hover:text-red-400"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}

                <div className="flex gap-1.5">
                  <button
                    onClick={() => addKeyframe(durationSec)}
                    className="flex-1 rounded-xl border border-dashed border-cream/15 px-2 py-1.5 text-2xs text-cream/80 transition hover:border-gold/50 hover:text-gold"
                  >
                    + End frame
                  </button>
                  <button
                    onClick={() => addKeyframe(durationSec / 2)}
                    className="flex-1 rounded-xl border border-dashed border-cream/15 px-2 py-1.5 text-2xs text-cream/80 transition hover:border-gold/50 hover:text-gold"
                  >
                    + Keyframe
                  </button>
                </div>
                <p className="text-2xs leading-relaxed text-fog">
                  {keyframes.length === 0
                    ? "Add an end frame and LTX interpolates the whole transformation."
                    : `${keyframes.length + 1} keyframes over ${fmtTime(durationSec)} — the slider is how hard each is held.`}
                </p>

                {/* prompt beats — the shot's phrasing changing inside one take */}
                <div className="mt-3 border-t hairline pt-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-2xs font-semibold uppercase tracking-[0.14em] text-fog">
                      Prompt beats
                    </h4>
                    <button
                      onClick={addBeat}
                      className="inline-flex items-center gap-1 text-2xs text-fog transition hover:text-gold"
                    >
                      <ListPlus size={10} /> Add beat
                    </button>
                  </div>

                  {beats.length === 0 ? (
                    <p className="mt-1.5 text-2xs leading-relaxed text-fog">
                      One prompt runs the whole take. Add beats to change what LTX is describing
                      partway through — a wide that pushes in and lands on a reaction, in one
                      continuous render.
                    </p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {/* how the beats tile the shot */}
                      <div className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-cream/8">
                        {tiling.rows.map((r, i) =>
                          r.dead ? null : (
                            <div
                              key={i}
                              style={{ width: `${(r.length / Math.max(durationSec, 0.1)) * 100}%` }}
                              className={cx("h-full", i % 2 ? "bg-gold/45" : "bg-gold/80")}
                            />
                          ),
                        )}
                      </div>

                      {beats.map((b, i) => (
                        <div
                          key={i}
                          className={cx(
                            "space-y-1.5 rounded-xl border bg-surface p-2",
                            tiling.rows[i]?.dead ? "border-red-500/30" : "border-cream/10",
                          )}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="w-9 shrink-0 text-2xs tabular-nums text-gold">
                              {fmtTime(tiling.rows[i]?.start ?? 0)}
                            </span>
                            <input
                              value={b.text}
                              onChange={(e) =>
                                setBeats((bs) =>
                                  bs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)),
                                )
                              }
                              placeholder={`Beat ${i + 1} — what changes`}
                              className="min-w-0 flex-1 rounded-md border border-cream/10 bg-ink px-2 py-1 text-xs text-cream outline-none placeholder:text-fog focus:border-gold/40"
                            />
                            <button
                              onClick={() => setBeats((bs) => bs.filter((_, j) => j !== i))}
                              className="shrink-0 text-fog transition hover:text-red-400"
                            >
                              <X size={12} />
                            </button>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <BankSelect
                              value={b.shot}
                              placeholder="Shot"
                              // abbreviations are short — give the room to the move
                              className="w-[68px] shrink-0"
                              entries={lab.cinematography.shotSizes}
                              onChange={(v) =>
                                setBeats((bs) => bs.map((x, j) => (j === i ? { ...x, shot: v } : x)))
                              }
                            />
                            <BankSelect
                              value={b.move}
                              placeholder="Camera move"
                              entries={lab.cinematography.moves}
                              onChange={(v) =>
                                setBeats((bs) => bs.map((x, j) => (j === i ? { ...x, move: v } : x)))
                              }
                            />
                            <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-cream/10 bg-ink px-1.5 py-1">
                              <input
                                type="number"
                                min={MIN_BEAT_SEC}
                                max={durationSec}
                                step={0.5}
                                value={b.lengthSec}
                                onChange={(e) =>
                                  setBeats((bs) =>
                                    bs.map((x, j) =>
                                      j === i
                                        ? {
                                            ...x,
                                            lengthSec: clampSec(Number(e.target.value), durationSec),
                                          }
                                        : x,
                                    ),
                                  )
                                }
                                className="w-7 bg-transparent text-2xs tabular-nums text-gold outline-none"
                              />
                              <span className="text-2xs text-fog">s</span>
                            </div>
                          </div>
                        </div>
                      ))}

                      {/* beat blend — how hard a boundary lands */}
                      <div className="flex items-center gap-2 pt-0.5">
                        <span className="shrink-0 text-2xs text-fog">Blend</span>
                        <input
                          type="range"
                          min={0.001}
                          max={0.5}
                          step={0.001}
                          value={blend}
                          onChange={(e) => setBlend(Number(e.target.value))}
                          className="min-w-0 flex-1 accent-gold"
                        />
                        <span className="w-12 shrink-0 text-right text-2xs tabular-nums text-gold">
                          {blend <= 0.01 ? "cut" : blend >= 0.25 ? "dissolve" : blend.toFixed(2)}
                        </span>
                      </div>

                      {lab.cinematography.shotSizes.length === 0 && (
                        <p className="text-2xs leading-relaxed text-fog">
                          Import the cinematography bank on this project's Bible screen and the
                          pickers fill with the show's shot grammar.
                        </p>
                      )}
                      {tiling.dead > 0 ? (
                        <p className="text-2xs leading-relaxed text-red-300">
                          The beats ask for {fmtTime(tiling.asked)} of a {fmtTime(durationSec)} take —
                          the last {tiling.dead} never arrive{tiling.dead === 1 ? "s" : ""}. Shorten
                          them or make the clip longer.
                        </p>
                      ) : tiling.flicker ? (
                        <p className="text-2xs leading-relaxed text-gold/75">
                          A beat under {MIN_BEAT_SEC.toFixed(1)}s is shorter than one latent frame —
                          it will read as a flicker rather than a beat.
                        </p>
                      ) : (
                        <p className="text-2xs leading-relaxed text-fog">
                          {beats.length} beat{beats.length === 1 ? "" : "s"} across{" "}
                          {fmtTime(durationSec)}
                          {tiling.short ? " — the last one holds to the end." : "."}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <AudioLane
                  sources={lab.audioSources}
                  lane={lane}
                  setLane={setLane}
                  durationSec={durationSec}
                  roomTone={roomTone}
                  setRoomTone={setRoomTone}
                />

                <CastLane
                  refs={castRefs}
                  setRefs={setCastRefs}
                  cast={lab.cast}
                  sets={lab.sets}
                  frames={lab.frames}
                  strength={refStrength}
                  setStrength={setRefStrength}
                  // null = the probe hasn't answered yet; don't call it missing
                  available={lab.capabilities?.multiRef !== false}
                  note={lab.capabilities?.note}
                  blocked={
                    motionRef
                      ? "This shot is driven by a motion reference, which uses the same IC-LoRA " +
                        "slot. Remove it to reference the cast instead."
                      : undefined
                  }
                />

                <MotionLane
                  sources={lab.videoSources}
                  motion={motionRef}
                  setMotion={setMotionRef}
                  durationSec={durationSec}
                  // null = the probe hasn't answered yet; don't call it missing.
                  // A cast sheet closes this lane too: both ride the one IC-LoRA.
                  available={lab.capabilities?.icLora !== false && castRefs.length === 0}
                  note={
                    castRefs.length > 0
                      ? "The cast sheet above holds the IC-LoRA slot. Clear it to transfer motion " +
                        "onto this shot instead."
                      : undefined
                  }
                />
              </div>
            )}
          </section>
        )}

        {/* 4 · everything less-than-daily — collapsed rows that say their
            current value and open on demand */}
        <section className="space-y-1.5">
          <DisclosureRow
            title="Camera"
            summary={cameraMove ? `${cameraMove} · ${cameraStrength.toFixed(2)}` : "None"}
            state={surface.sections.camera.state}
            reason={surface.sections.camera.reason}
            open={openRow === "camera"}
            onToggle={() => toggleRow("camera")}
          >
            <div className="space-y-2">
              <select
                value={cameraMove}
                onChange={(e) => setCameraMove(e.target.value as CameraMove | "")}
                style={{ colorScheme: "dark" }}
                className={cx(selectInput, "w-full")}
              >
                <option value="">No camera LoRA</option>
                {cameraMoves.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              {cameraMove && (
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-2xs text-fog">Strength</span>
                  <Slider
                    value={cameraStrength}
                    onChange={setCameraStrength}
                    min={0.1}
                    max={1.5}
                    step={0.05}
                    className="min-w-0 flex-1"
                  />
                  <span className="w-8 shrink-0 text-right text-2xs tabular-nums text-gold">
                    {cameraStrength.toFixed(2)}
                  </span>
                </div>
              )}
              <p className="text-2xs leading-relaxed text-fog">
                A trained camera move imposed as a LoRA — stronger and more repeatable than prose,
                for the moves this install has weights for.
                {isMinimax && (
                  <>
                    {" "}
                    On H3 this is the only camera control there is: the weight rides the unet and
                    the trigger phrase <span className="text-cream/85">camera motion</span> is
                    prepended to the prompt for you. Push-in, pull-back and handheld hold best;
                    past ~1.1 the faces go.
                  </>
                )}
              </p>
            </div>
          </DisclosureRow>

          {surface.sections.fps.state === "shown" && (
            <DisclosureRow
              title="Frame rate"
              summary={fps === 48 ? "48 fps · ~2× time" : "24 fps"}
              open={openRow === "fps"}
              onToggle={() => toggleRow("fps")}
            >
              <div className="flex items-center gap-2">
                <Segmented
                  value={String(fps) as "24" | "48"}
                  onChange={(v) => setFps(v === "48" ? 48 : 24)}
                  options={[
                    { value: "24", label: "24 fps" },
                    { value: "48", label: "48 fps", title: "Double the frames — smoother, ~2× render time" },
                  ]}
                />
                {fps === 48 && <span className="text-2xs text-fog">~2× time</span>}
              </div>
            </DisclosureRow>
          )}

          <DisclosureRow
            title="Quality"
            summary={
              isMinimax
                ? effectiveQuality === "draft"
                  ? `Draft · 4 steps · ${minimaxWeightLabel}`
                  : effectiveQuality === "standard"
                    ? `Standard · 8 steps · ${minimaxWeightLabel}`
                    : `Final · 25 steps · ${minimaxWeightLabel}`
                : effectiveQuality === "draft"
                  ? `Draft — half-size, fast${enhancer25 && !enhance ? " · no enhancer" : ""}`
                  : `Final${enhancer25 && !enhance ? " · no enhancer" : ""}`
            }
            state={surface.sections.quality.state}
            reason={surface.sections.quality.reason}
            open={openRow === "quality"}
            onToggle={() => toggleRow("quality")}
          >
            <div className="space-y-2">
              <Segmented
                value={effectiveQuality}
                onChange={setQuality}
                options={
                  isMinimax
                    ? [
                        { value: "draft", label: "Draft" },
                        { value: "standard", label: "Standard" },
                        { value: "final", label: "Final" },
                      ]
                    : [
                        { value: "draft", label: "Draft" },
                        { value: "final", label: "Final" },
                      ]
                }
              />
              {enhancer25 && (
                <div className="flex items-start justify-between gap-3 rounded-xl border border-cream/10 bg-surface/40 px-2.5 py-2">
                  <div className="min-w-0">
                    <div className="text-2xs text-cream/85">Prompt enhancer</div>
                    <p className="mt-0.5 text-2xs leading-relaxed text-fog">
                      {enhance
                        ? "Gemma 4 E2B expands short prompts, reading the start frame. Switch it off for a prompt written to a structure — multi-shot prose with named cuts, or exact quoted dialogue — the rewrite destroys cuts and drops lines."
                        : "Off — the prompt reaches the encoder verbatim. The setting for multi-shot prose and exact dialogue."}
                    </p>
                  </div>
                  <Toggle on={enhance} onChange={() => setEnhance((e) => !e)} />
                </div>
              )}
              {isMinimax && (
                <div className="rounded-xl border border-cream/10 bg-surface/40 px-2.5 py-2">
                  <div className="text-2xs uppercase tracking-wider text-fog">
                    This render will load
                  </div>
                  <dl className="mt-1 space-y-0.5 text-2xs">
                    <div className="flex gap-2">
                      <dt className="w-14 shrink-0 text-fog">Head</dt>
                      <dd className="min-w-0 text-cream/85">
                        {minimaxHead === "ref2va"
                          ? "ref2va — references in"
                          : "fl2va — first/last frame"}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-14 shrink-0 text-fog">Weights</dt>
                      <dd className="min-w-0 text-cream/85">
                        {minimaxWeightLabel}
                        {minimaxFormat === "gguf" && (
                          <span className="text-fog">
                            {" "}
                            — install MiniMax-H3 (w4a8) for the faster set
                          </span>
                        )}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-14 shrink-0 text-fog">Distill</dt>
                      <dd className="min-w-0 text-cream/85">
                        {minimaxDistill ?? "none — the model's own schedule"}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}
              <p className="text-2xs leading-relaxed text-fog">
                {isMinimax
                  ? effectiveQuality === "draft"
                    ? "LightX2V's 4-step distill — the fastest H3 renders, sound included. Skin can look plasticky and fine texture goes soft; for blocking a shot, not keeping it."
                    : effectiveQuality === "standard"
                      ? "The 8-step distill — twice Draft's steps and most of Final's detail. The tier to reach for when a Draft take is right but looks plastic."
                      : "The model's own 25-step schedule, no distill. Slowest by a long way, and the delivery setting."
                  : effectiveQuality === "draft"
                    ? "Skips the ×2 upscale + refine pass — half-size picture, well under half the wait. For blocking a shot, not keeping it."
                    : "Full pipeline: base pass, ×2 spatial upscale, refine. The delivery setting."}
              </p>
            </div>
          </DisclosureRow>

          <DisclosureRow
            title="Adapters"
            summary={adapterSummary}
            state={surface.sections.adapters.state}
            reason={surface.sections.adapters.reason}
            open={openRow === "adapters"}
            onToggle={() => toggleRow("adapters")}
          >
            <div className="space-y-2">
              {loras.map((l, i) => (
                <div key={i} className="space-y-1.5 rounded-xl border border-cream/10 bg-surface p-2">
                  <div className="flex items-center gap-2">
                    <select
                      value={l.name}
                      onChange={(e) =>
                        setLoras((ls) => ls.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                      }
                      style={{ colorScheme: "dark" }}
                      className={cx(selectInput, "min-w-0 flex-1")}
                    >
                      <option value="">Choose a LoRA…</option>
                      {/* a look's LoRA is named by file; until the probe
                          answers it is not in the install's list, and a
                          select with no matching option renders blank */}
                      {l.name && !installedLoras.includes(l.name) && (
                        <option value={l.name}>{l.name.split(/[\\/]/).pop()}</option>
                      )}
                      {installedLoras.map((name) => (
                        <option key={name} value={name}>
                          {name.split(/[\\/]/).pop()}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => setLoras((ls) => ls.filter((_, j) => j !== i))}
                      title="Remove"
                      className="shrink-0 text-fog transition hover:text-red-300"
                    >
                      <X size={11} />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-2xs text-fog">Strength</span>
                    <Slider
                      value={l.strength}
                      onChange={(v) =>
                        setLoras((ls) => ls.map((x, j) => (j === i ? { ...x, strength: v } : x)))
                      }
                      min={0}
                      max={2}
                      step={0.05}
                      className="min-w-0 flex-1"
                    />
                    <span className="w-8 shrink-0 text-right text-2xs tabular-nums text-gold">
                      {l.strength.toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
              {loras.length < lorasMax && (
                <button
                  onClick={() => setLoras((ls) => [...ls, { name: "", strength: 1 }])}
                  className="w-full rounded-xl border border-dashed border-cream/15 px-2 py-1.5 text-2xs text-cream/80 transition hover:border-gold/50 hover:text-gold"
                >
                  + Adapter LoRA
                </button>
              )}
              {missingLoras.length > 0 && (
                <p className="text-2xs leading-relaxed text-gold/75">
                  {missingLoras.join(", ")} {missingLoras.length === 1 ? "is" : "are"} not in this
                  install's lora folder — the render goes ahead on the look's prose alone. Settings
                  → Models to install the style set.
                </p>
              )}
              <p className="text-2xs leading-relaxed text-fog">
                Up to {lorasMax} style/subject LoRAs from this ComfyUI's own lora folder, stacked
                onto the model in order.
              </p>
            </div>
          </DisclosureRow>

          <DisclosureRow
            title="Sound"
            summary={soundSummary}
            state={surface.sections.dialogue.state}
            reason={surface.sections.dialogue.reason}
            open={openRow === "sound"}
            onToggle={() => toggleRow("sound")}
          >
            {retake ? (
              <p className="text-2xs leading-relaxed text-fog">
                A retake keeps the sound of the take it's fixing — nothing to attach here.
              </p>
            ) : directorOn ? (
              <p className="text-2xs leading-relaxed text-fog">
                Dialogue is on the Director's audio lane above — where a line can sit at any
                timecode, and two characters can each have their own.
              </p>
            ) : (
              <>
                <div className="relative">
                  {audioRel ? (
                    <div className="flex items-center gap-2 rounded-xl border border-gold/30 bg-gold/6 px-3 py-2">
                      <AudioLines size={13} className="shrink-0 text-gold/80" />
                      <span className="min-w-0 flex-1 truncate text-xs text-cream/90">
                        {audioName}
                      </span>
                      <button
                        title="Remove audio — back to plain i2v"
                        onClick={() => setAudioRel(null)}
                        className="shrink-0 text-fog transition hover:text-red-400"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setAudioOpen((o) => !o)}
                      className="flex w-full items-center gap-2 rounded-xl border border-dashed border-cream/15 px-3 py-2 text-xs text-cream/80 transition hover:border-gold/50 hover:text-gold"
                    >
                      <AudioLines size={13} />
                      <span className="flex-1 text-left">Attach a voice take…</span>
                      <ChevronDown
                        size={11}
                        className={cx("text-fog transition-transform", audioOpen && "rotate-180")}
                      />
                    </button>
                  )}
                  {audioOpen && !audioRel && (
                    <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-44 overflow-y-auto rounded-xl border border-cream/12 bg-raised shadow-xl">
                      {lab.audioSources.length === 0 && (
                        <p className="px-3 py-2 text-xs text-fog">
                          No voice takes yet — generate one in the Voice lab.
                        </p>
                      )}
                      {lab.audioSources.map((a) => (
                        <button
                          key={a.relPath}
                          onClick={() => {
                            setAudioRel(a.relPath);
                            setAudioOpen(false);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-cream/85 transition hover:bg-cream/5"
                        >
                          <span className="flex-1 truncate">{a.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <p className="mt-1.5 text-2xs leading-relaxed text-fog">
                  {audioRel
                    ? "Renders with LTX ia2v — the named speaker lip-syncs this audio."
                    : "Attach a Voice-lab take to switch from i2v to ia2v lip-sync."}
                </p>
              </>
            )}
          </DisclosureRow>

          <DisclosureRow
            title="References"
            summary={refCount ? `${refCount} reference${refCount === 1 ? "" : "s"} (ref2va)` : "None"}
            state={retake || directorOn ? "hidden" : surface.sections.references.state}
            reason={surface.sections.references.reason}
            open={openRow === "refs"}
            onToggle={() => toggleRow("refs")}
          >
            <ReferenceLane
              refs={minimaxRefs}
              setRefs={(fn) => setMinimaxRefs(fn)}
              prompt={prompt}
              frames={lab.frames}
              videoSources={lab.videoSources}
              audioSources={lab.audioSources}
              cast={lab.cast}
              durationSec={durationSec}
              importImages={importRefImages}
              imported={importedRefs}
              importing={lab.addingRef}
              importError={refImportError}
              onUseTag={insertTag}
            />
          </DisclosureRow>
        </section>

        {/* the director's edit — the cinematography bank, finally reachable
            from the lab that renders the shot */}
        <ShotPicker
          cine={cine}
          bank={lab.cinematography}
          clause={cineClauseText}
          cameraLoras={lab.capabilities?.cameraLoras ?? {}}
          onChange={setCine}
        />

        {/* 5 · motion strength — the one creative dial that stays in the open */}
        <section>
          <SectionLabel
            hint
            right={
              <span className="text-sm font-medium tabular-nums text-gold">
                {motion.toFixed(2)}
              </span>
            }
          >
            Motion strength
          </SectionLabel>
          <Slider value={motion} onChange={setMotion} min={0} max={1} step={0.01} className="mt-2" />
        </section>

        {/* experiments on the payload the composer is holding */}
        <section className="space-y-2">
          <SectionLabel>Experiments</SectionLabel>
        <GhostButton
          onClick={() => setAbOpen(true)}
          title="Render this shot several ways at one seed and compare on the Desk"
          className={cx(
            "w-full justify-center gap-2 text-2xs",
            (retake !== null || !canGenerate) && "pointer-events-none opacity-40",
          )}
        >
          <FlaskConical size={12} /> A/B this shot
        </GhostButton>
        {/* the seed spray (freeform plan §2.5): four seeds at the sketch tier,
            queued as one run; the contact sheet shows in the preview and a
            click promotes one to a full render at exactly that seed */}
        <GhostButton
          onClick={() =>
            ab.queue({
              title: `Seeds — ${prompt.trim().replace(/\s+/g, " ").slice(0, 60)}`,
              notes: "seed spray at the sketch tier — pick one in the Video lab preview",
              base: payload,
              seedPolicy: "spray",
              variants: sprayVariants(activeLook, engineId) as VideoAb["variants"],
            })
          }
          title="Render four seeds at the sketch tier and pick one from the contact sheet"
          className={cx(
            "w-full justify-center gap-2 text-2xs",
            (retake !== null || !canGenerate || !prompt.trim() || ab.queueing) &&
              "pointer-events-none opacity-40",
          )}
        >
          <Dices size={12} /> {ab.queueing ? "Queueing…" : "Spray 4 seeds"}
        </GhostButton>
        </section>

        <section className="rounded-xl border border-gold/15 bg-gold/4 p-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-gold">
            <Lightbulb size={12} /> Tip
          </div>
          <p className="mt-1.5 text-2xs leading-relaxed text-fog">{lab.tip}</p>
        </section>
      </div>
    </LabDrawer>
  );
}
