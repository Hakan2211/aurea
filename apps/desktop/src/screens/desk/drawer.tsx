/* The desk's review drawer — takes newest-first with A/B compare, and the
 * crew verbs on this shot. The verbs are CREW_VERBS (shared): the same
 * argument shapes, the same procedures, as the qc_shot / approve_shot /
 * retake_shot / shot_from_storyboard / preview_shot / verify_take tools the
 * shell exposes (P6, "one console"). `verb` below is a Record over the
 * per-shot verb ids, so a verb added to the contract without a button here
 * is a type error, and crew-parity.test holds the tool side to the same
 * table. Approve and Retake are the two HUMAN verdicts: the note lands on
 * shot.takeNotes and rides every later render's prompt, so direction
 * accumulates on the shot instead of living in your head. */

import { SelectBox } from "@/components/ui/SelectBox";
import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  Clapperboard,
  FileSearch,
  Gauge,
  Play,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  StickyNote,
  X,
  Zap,
} from "lucide-react";
import {
  FIX_IDS,
  FIX_VOCABULARY,
  ruleOfNote,
  shotStage,
  craftRule,
  crewVerb,
  type CrewVerbId,
  type FixId,
  type ShotTake,
} from "@aurea/shared";
import { Chip, GhostButton, GoldButton, cx } from "@/components/ui";
import {
  useLibraryAssets,
  useVideoPresets,
  type ShotLaneOpts,
  type useBible,
  type useProduction,
} from "@/hooks";
import { pad2, sectionLabel, selectInput, shotCode, textArea, type Located } from "../studio/shared";
import { STAGE_TONE } from "./shared";

/* one shared element, the script view's pattern — a second line stops the first */
let voiceEl: HTMLAudioElement | null = null;
function playVoice(url: string) {
  if (!voiceEl) voiceEl = new Audio();
  voiceEl.src = url;
  void voiceEl.play().catch(() => {});
}

export function ShotDrawer({
  located,
  prod,
  bible,
  busy,
  onClose,
}: {
  located: Located;
  prod: ReturnType<typeof useProduction>;
  bible: ReturnType<typeof useBible>;
  /** queued/running jobs on this shot */
  busy: number;
  onClose: () => void;
}) {
  const { shot, sceneIdx, shotIdx } = located;
  const stage = shotStage(shot);
  const takes = [...shot.videoTakes].reverse(); // newest first

  const [activeId, setActiveId] = useState<string | null>(null);
  const active =
    takes.find((t) => t.id === activeId) ??
    takes.find((t) => t.id === shot.selectedTake) ??
    takes[0];
  const [bId, setBId] = useState<string | null>(null);
  const b = bId && bId !== active?.id ? takes.find((t) => t.id === bId) : undefined;

  const [note, setNote] = useState("");
  const [fix, setFix] = useState<FixId[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [composeNotes, setComposeNotes] = useState<string[]>([]);
  /* a broken take (P3.1) needs a second, deliberate click to approve */
  const [forceArmed, setForceArmed] = useState(false);
  useEffect(() => setForceArmed(false), [active?.id]);
  const toggleFix = (id: FixId) =>
    setFix((cur) => (cur.includes(id) ? cur.filter((f) => f !== id) : [...cur, id]));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const url = (rel: string | undefined) => (rel ? bible.refUrl(rel) : undefined);
  const keyframe =
    shot.keyframes.find((k) => k.id === shot.selectedKeyframe)?.asset ??
    shot.keyframes[shot.keyframes.length - 1]?.asset;
  const charById = new Map(bible.bible.characters.map((c) => [c.id, c.name]));
  const dialogue = shot.scriptLines.filter((l) => l.character && l.text.trim());

  /* the lane a render / preview goes out in (P5) — the shipped lanes plus
   * this project's own; empty = the composer's defaults */
  const lanes = useVideoPresets();
  const [lane, setLane] = useState<string>("");
  useEffect(() => {
    if (!lane && lanes.length) setLane(lanes.find((p) => p.lane === "interview")?.id ?? lanes[0].id);
  }, [lanes, lane]);
  /* the two overrides that pick the COMPOSER (shot_from_storyboard's engine /
   * multiShot): "" = whatever the lane says */
  const [engine, setEngine] = useState<string>("");
  const [multiShot, setMultiShot] = useState<"" | "on" | "off">("");
  const laneOpts = (): ShotLaneOpts => ({
    preset: lane || undefined,
    engine: engine || undefined,
    multiShot: multiShot === "" ? undefined : multiShot === "on",
  });
  const [spec, setSpec] = useState<Awaited<ReturnType<typeof prod.checkSpec>> | null>(null);
  const [qc, setQc] = useState<Awaited<ReturnType<typeof prod.qcShot>> | null>(null);

  const approve = async () => {
    if (!active) return;
    setFeedback(null);
    const broken = active.verify?.status === "broken";
    if (broken && !forceArmed) {
      setForceArmed(true);
      setFeedback(`This take failed hard verification: ${active.verify?.reasons.join("; ")}. Click again to approve it anyway.`);
      return;
    }
    try {
      const r = await prod.approveShot(shot.id, active.id, broken);
      setForceArmed(false);
      if (r.take.preview) {
        setFeedback(`Preview approved — seed ${r.take.seed} is carried into the next render. Nothing landed on the timeline.`);
      } else {
        setFeedback(broken ? "Approved anyway (forced) — the take is on the timeline." : "Approved — the take is on the timeline.");
      }
    } catch (err) {
      setFeedback(String((err as Error).message));
    }
  };

  /* finish_take on the active take. Whether it kept latents is read off its
   * sidecar through the library list (the take record itself only names the
   * file), so the "Full from draft" button knows before the click. */
  const library = useLibraryAssets();
  const activeDraft = !!active && !!library.find((a) => a.relPath === active.asset)?.meta?.draftLatents;
  const finish = async (mode: "refine" | "upscale") => {
    if (!active) return;
    setFeedback(null);
    try {
      const job = await prod.finishTake(shot.id, active.asset, mode);
      setFeedback(
        mode === "refine"
          ? `Full render queued over the draft's latents (${job.title}) — same blocking, full size.`
          : `×2 finish queued (${job.detail ?? job.title}) — it lands on this shot as a new take.`,
      );
    } catch (err) {
      setFeedback(String((err as Error).message));
    }
  };

  const render = async (preview: boolean) => {
    setFeedback(null);
    try {
      const r = await prod.renderShot(shot.id, { ...laneOpts(), preview });
      setComposeNotes(r.notes);
      setFeedback(
        preview
          ? `Preview queued — ${r.durationSec}s at seed ${r.seed}. Approve it to carry the seed into the render.`
          : `Render queued at seed ${r.seed}${shot.approvedPreview && r.seed === shot.approvedPreview.seed ? " (from the approved preview)" : ""}.`,
      );
    } catch (err) {
      setFeedback(String((err as Error).message));
    }
  };

  const verify = async () => {
    if (!active) return;
    setFeedback(null);
    try {
      const r = await prod.verifyTake(shot.id, active.id);
      setFeedback(
        r.verify.status === "broken"
          ? `Broken — ${r.verify.reasons.join("; ")}`
          : `Verified ok${r.notes.length ? ` — ${r.notes.join("; ")}` : ""}`,
      );
    } catch (err) {
      setFeedback(String((err as Error).message));
    }
  };

  const checkSpec = async () => {
    setFeedback(null);
    try {
      const r = await prod.checkSpec(shot.id, laneOpts());
      setSpec(r);
      setComposeNotes(r.notes);
    } catch (err) {
      setFeedback(String((err as Error).message));
    }
  };

  const runQc = async () => {
    if (!active) return;
    setFeedback(null);
    try {
      setQc(await prod.qcShot(shot.id, active.id));
    } catch (err) {
      setFeedback(String((err as Error).message));
    }
  };

  const retake = async () => {
    const trimmed = note.trim();
    if (!trimmed && !fix.length) return;
    setFeedback(null);
    try {
      const res = await prod.retakeShot(shot.id, trimmed, fix, laneOpts());
      setNote("");
      setFix([]);
      setComposeNotes(res.notes);
      if (res.job) setFeedback("Retake queued — the note rides every render of this shot now.");
    } catch (err) {
      setFeedback(String((err as Error).message));
    }
  };

  /* One button per crew verb on a shot. Keyed by the contract's ids so the
   * drawer cannot fall behind the tool registry (Record = every key). The
   * titles come from the contract; what a button DOES is the same procedure
   * the tool of that name calls (crew-parity.test). */
  const verb: Record<Exclude<CrewVerbId, "normalize_project" | "scene_assemble_plan" | "scene_assemble">, ReactNode> = {
    approve_shot: (
      <GoldButton
        onClick={approve}
        disabled={!active || prod.approving}
        title={
          active
            ? "Lock this take, approve the shot, drop it on the timeline (approve_shot)"
            : "No rendered take to approve yet"
        }
      >
        <Check size={13} />{" "}
        {prod.approving
          ? "Approving…"
          : active?.verify?.status === "broken"
            ? forceArmed
              ? "Approve anyway"
              : "Approve broken take…"
            : crewVerb("approve_shot").title}
      </GoldButton>
    ),
    qc_shot: (
      <GhostButton
        onClick={runQc}
        disabled={!active || prod.qcing}
        title={
          active
            ? "Measure this take against its intent: cuts, audio, length, articulation, board hold — and write the evidence for the vision pass (qc_shot)"
            : "No rendered take to check yet"
        }
      >
        <Gauge size={12} /> {prod.qcing ? "Measuring…" : crewVerb("qc_shot").title}
      </GhostButton>
    ),
    verify_take: null, // rendered inside TakeVerifyStrip (Re-verify), by the take it judges
    "shot_from_storyboard:dryRun": (
      <GhostButton
        onClick={checkSpec}
        disabled={!keyframe}
        title={keyframe ? "Compose the spec in this lane and show it — no render (shot_from_storyboard dryRun)" : "Board the shot first"}
      >
        <FileSearch size={12} /> {crewVerb("shot_from_storyboard:dryRun").title}
      </GhostButton>
    ),
    preview_shot: (
      <GhostButton
        onClick={() => render(true)}
        disabled={!keyframe || prod.rendering || busy > 0}
        title={
          keyframe
            ? "Preview: 2s at 480p, draft, no audio — ~90s on 2.5. Approve it to carry the seed (preview_shot)"
            : "Board the shot first"
        }
      >
        <Zap size={12} /> {crewVerb("preview_shot").title}
      </GhostButton>
    ),
    shot_from_storyboard: (
      <GhostButton
        onClick={() => render(false)}
        disabled={!keyframe || prod.rendering || busy > 0}
        title={
          !keyframe
            ? "Board the shot first"
            : shot.approvedPreview
              ? `Render at the approved preview's seed (${shot.approvedPreview.seed}) (shot_from_storyboard)`
              : "Render the shot in this lane (shot_from_storyboard)"
        }
      >
        <Clapperboard size={12} /> {prod.rendering ? "Queueing…" : crewVerb("shot_from_storyboard").title}
      </GhostButton>
    ),
    retake_shot: (
      <GhostButton
        onClick={retake}
        disabled={(!note.trim() && !fix.length) || prod.retaking}
        title="Record the direction on the shot and re-render it in this lane (retake_shot)"
      >
        <Send size={12} /> {prod.retaking ? "Queueing…" : crewVerb("retake_shot").title}
      </GhostButton>
    ),
    /* finish_take has two modes; the drawer shows them as two buttons on the
     * active take (both the same verb, the same procedure) */
    finish_take: (
      <>
        <GhostButton
          onClick={() => finish("refine")}
          disabled={!active || !activeDraft || prod.finishing || busy > 0}
          title={
            !active
              ? "No take to finish yet"
              : activeDraft
                ? "Full render over THIS draft's kept latents — the same blocking at full size, guaranteed (finish_take refine)"
                : "Only an LTX 2.5 draft rendered since the finish pass existed keeps its latents — render a draft first"
          }
        >
          <Sparkles size={12} /> {prod.finishing ? "Queueing…" : "Full from draft"}
        </GhostButton>
        <GhostButton
          onClick={() => finish("upscale")}
          disabled={!active || prod.finishing || busy > 0}
          title={
            active
              ? "×2 finish: the Pixel Spatial Upscaler IC-LoRA re-renders this take at twice the size with reinvented detail (finish_take upscale)"
              : "No take to finish yet"
          }
        >
          <Sparkles size={12} /> {prod.finishing ? "Queueing…" : "Finish ×2"}
        </GhostButton>
      </>
    ),
  };

  return (
    <aside className="flex w-[420px] shrink-0 flex-col border-l hairline bg-[#0e0e10]">
      <header className="flex items-center gap-2 border-b hairline px-4 py-3">
        <span className="shrink-0 font-mono text-xs text-gold">
          {shotCode(sceneIdx, shotIdx)}
        </span>
        <span className="truncate text-sm font-medium text-cream">
          {shot.title || "Untitled shot"}
        </span>
        <Chip tone={STAGE_TONE[stage]} className="!px-1.5 !text-2xs">
          {stage}
        </Chip>
        {busy > 0 && (
          <span
            title={`${busy} job${busy === 1 ? "" : "s"} in flight for this shot`}
            className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-gold"
          />
        )}
        <button
          onClick={onClose}
          title="Close (Esc)"
          className="ml-auto rounded-pill border border-cream/10 p-1.5 text-fog transition hover:border-gold/40 hover:text-gold"
        >
          <X size={13} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {/* ---- playback: the newest take, or A/B side by side ---- */}
        {active ? (
          b ? (
            <div className="grid grid-cols-2 gap-2">
              {[
                { take: active, tag: "A" },
                { take: b, tag: "B" },
              ].map(({ take, tag }) => (
                <div key={take.id}>
                  <video
                    key={take.id}
                    src={url(take.asset)}
                    controls
                    loop
                    className="w-full rounded-lg border border-cream/10 bg-ink"
                  />
                  <p className="mt-1 text-center text-2xs text-fog">
                    {tag} · {pad2(shot.videoTakes.findIndex((t) => t.id === take.id) + 1)}
                    {take.engine ? ` · ${take.engine}` : ""}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <video
              key={active.id}
              src={url(active.asset)}
              controls
              className="w-full rounded-lg border border-cream/10 bg-ink"
            />
          )
        ) : (
          <div>
            <div className="aspect-video w-full overflow-hidden rounded-lg border border-cream/10 bg-gradient-to-br from-[#241c10] to-[#0d0a06]">
              {keyframe && <img src={url(keyframe)} alt="" className="h-full w-full object-cover" />}
            </div>
            <p className="mt-1.5 text-xs text-fog">
              No takes yet
              {keyframe
                ? " — a retake note below renders the first one."
                : " — board the shot first (a note still sticks)."}
            </p>
          </div>
        )}

        {/* ---- hard verification (P3.1): the badge's own verdict ---- */}
        {active && <TakeVerifyStrip take={active} verifying={prod.verifying} onVerify={verify} />}

        {/* ---- takes, newest first ---- */}
        {takes.length > 0 && (
          <div>
            <p className={sectionLabel}>Takes · newest first</p>
            <div className="mt-1.5 flex gap-2 overflow-x-auto pb-1">
              {takes.map((t) => {
                const slate = shot.videoTakes.findIndex((x) => x.id === t.id) + 1;
                const isActive = t.id === active?.id;
                const broken = t.verify?.status === "broken";
                return (
                  <div
                    key={t.id}
                    title={broken ? `Broken: ${t.verify?.reasons.join("; ")}` : undefined}
                    className={cx(
                      "flex shrink-0 items-center overflow-hidden rounded-lg border transition",
                      broken
                        ? isActive
                          ? "border-[#e07a6b]"
                          : "border-[#e07a6b]/50 hover:border-[#e07a6b]"
                        : isActive
                          ? "border-gold/60"
                          : "border-cream/10 hover:border-cream/25",
                    )}
                  >
                    <button
                      onClick={() => setActiveId(t.id)}
                      className="flex items-center gap-1.5 px-2 py-1.5 text-left"
                      title={t.label || `take ${pad2(slate)}`}
                    >
                      <span
                        className={cx(
                          "rounded px-1 text-2xs font-semibold tabular-nums",
                          broken ? "bg-[#e07a6b] text-ink" : isActive ? "bg-gold text-ink" : "bg-cream/12 text-cream/80",
                        )}
                      >
                        {pad2(slate)}
                      </span>
                      <span className="text-2xs text-fog">{t.engine || "take"}</span>
                      {t.preview && (
                        <span
                          title={`Preview (2s blocking pass)${t.seed !== undefined ? ` · seed ${t.seed}` : ""}${shot.approvedPreview?.takeId === t.id ? " · approved" : ""}`}
                          className={cx(
                            "rounded-pill border px-1 text-2xs font-semibold uppercase tracking-wide",
                            shot.approvedPreview?.takeId === t.id ? "border-sage/60 text-sage" : "border-cream/20 text-fog",
                          )}
                        >
                          pre
                        </span>
                      )}
                      {t.id === shot.selectedTake && (
                        <Star size={10} className="text-gold" fill="currentColor" />
                      )}
                    </button>
                    <button
                      onClick={() => setBId(bId === t.id ? null : t.id)}
                      title="Compare this take as B"
                      className={cx(
                        "border-l border-cream/10 px-1.5 py-2 text-2xs font-semibold transition",
                        bId === t.id ? "bg-gold/15 text-gold" : "text-fog hover:text-cream",
                      )}
                    >
                      B
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ---- the crew verbs on this shot (CREW_VERBS, minus the project-level normalize) ---- */}
        <div className="space-y-2 rounded-xl border hairline bg-surface/50 p-3">
          <div className="flex items-center gap-2">
            {verb.approve_shot}
            {verb.qc_shot}
            {stage === "approved" && <span className="text-2xs text-sage">approved ✓</span>}
          </div>
          {qc && <QcPanel report={qc} onClose={() => setQc(null)} />}
          {/* ---- the lane and the two composer overrides, then the render-shaped verbs ---- */}
          <div className="flex items-center gap-1.5">
            <SelectBox
              value={lane}
              onChange={(e) => setLane(e.target.value)}
              title="Render lane — engine, canvas, length, tier and camera in one word"
              className={cx(selectInput, "w-full !py-1 !text-xs")}
            >
              <option value="">Composer defaults</option>
              {lanes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </SelectBox>
          </div>
          <div className="flex items-center gap-1.5">
            <SelectBox
              value={engine}
              onChange={(e) => setEngine(e.target.value)}
              title="Engine override — picks the composer: H3 composes its block prompt, LTX composes a Director timeline or multi-shot prose"
              className={cx(selectInput, "min-w-0 flex-1 !py-1 !text-xs")}
            >
              <option value="">Lane engine</option>
              <option value="ltx25">LTX 2.5</option>
              <option value="ltx2">LTX 2.3</option>
              <option value="minimax-h3">MiniMax H3</option>
            </SelectBox>
            <SelectBox
              value={multiShot}
              onChange={(e) => setMultiShot(e.target.value as "" | "on" | "off")}
              title="Multi-shot — compose the beats as ONE cutting prose paragraph (LTX 2.5 cuts inside a single generation; the enhancer is forced off)"
              className={cx(selectInput, "min-w-0 flex-1 !py-1 !text-xs")}
            >
              <option value="">Lane cuts</option>
              <option value="on">Multi-shot</option>
              <option value="off">Single take</option>
            </SelectBox>
          </div>
          <div className="flex items-center gap-1.5">
            {verb["shot_from_storyboard:dryRun"]}
            {verb.preview_shot}
            {verb.shot_from_storyboard}
          </div>
          <div className="flex items-center gap-1.5">{verb.finish_take}</div>
          {spec && <SpecPanel spec={spec} onClose={() => setSpec(null)} />}
          {shot.approvedPreview && (
            <p className="text-2xs text-fog">
              Preview approved · seed {shot.approvedPreview.seed} rides the next render
            </p>
          )}
          {/* fixes with a measured phrasing each — the words that held on the pilot */}
          <div className="flex flex-wrap gap-1">
            {FIX_IDS.map((id) => (
              <button
                key={id}
                type="button"
                title={FIX_VOCABULARY[id]}
                onClick={() => toggleFix(id)}
                className={cx(
                  "rounded-pill border px-2 py-0.5 text-2xs transition",
                  fix.includes(id)
                    ? "border-gold/60 bg-gold/15 text-gold"
                    : "border-cream/10 text-fog hover:border-gold/40 hover:text-cream",
                )}
              >
                {id}
              </button>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder='Direction as an instruction — "stay seated, hold the framing" (not what went wrong)'
            className={textArea}
          />
          {verb.retake_shot}
          {feedback && <p className="text-xs text-fog">{feedback}</p>}
          <ComposerNotes notes={composeNotes} />
        </div>

        {/* ---- direction so far ---- */}
        {shot.takeNotes.length > 0 && (
          <div>
            <p className={sectionLabel}>Direction so far</p>
            <ul className="mt-1.5 space-y-1">
              {shot.takeNotes.map((n, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-cream/80">
                  <StickyNote size={11} className="mt-0.5 shrink-0 text-gold/70" />
                  {n}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ---- lines & voice takes ---- */}
        {dialogue.length > 0 && (
          <div>
            <p className={sectionLabel}>Lines</p>
            <ul className="mt-1.5 space-y-1.5">
              {dialogue.map((l) => {
                const take = [...shot.voTakes].reverse().find((t) => t.lineId === l.id);
                const takeUrl = take ? url(take.asset) : undefined;
                return (
                  <li key={l.id} className="flex items-center gap-2 text-xs">
                    <button
                      disabled={!takeUrl}
                      onClick={() => takeUrl && playVoice(takeUrl)}
                      title={take ? "Play the newest take" : "Not voiced yet — run the table read"}
                      className={cx(
                        "shrink-0 rounded-full border p-1 transition",
                        takeUrl
                          ? "border-gold/40 text-gold hover:bg-gold/10"
                          : "border-cream/10 text-fog/40",
                      )}
                    >
                      <Play size={9} />
                    </button>
                    <span className="shrink-0 font-semibold text-cream/80">
                      {charById.get(l.character!) ?? l.character}
                    </span>
                    <span className="truncate text-fog" title={l.text}>
                      {l.text}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}

/** Delivery-time hard verification (P3.1) for the take under review. Red
 * with the reasons when it failed; the reasons are the whole message. */
function TakeVerifyStrip({
  take,
  verifying,
  onVerify,
}: {
  take: ShotTake;
  verifying: boolean;
  onVerify: () => void;
}) {
  const v = take.verify;
  const broken = v?.status === "broken";
  return (
    <div
      className={cx(
        "flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
        broken ? "border-[#e07a6b]/50 bg-[#e07a6b]/10 text-[#f0a89d]" : "border-cream/10 text-fog",
      )}
    >
      {broken ? (
        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
      ) : (
        <ShieldCheck size={12} className={cx("mt-0.5 shrink-0", v?.status === "ok" ? "text-sage" : "text-fog/50")} />
      )}
      <div className="min-w-0 flex-1 leading-relaxed">
        {broken ? (
          <p className="font-medium">Broken take — {v.reasons.join("; ")}</p>
        ) : v?.status === "ok" ? (
          <p>
            Verified ok
            {typeof v.measuredDurationSec === "number" ? ` · ${v.measuredDurationSec.toFixed(1)}s` : ""}
            {typeof v.meanDb === "number" ? ` · ${v.meanDb.toFixed(0)} dB` : ""}
            {v.roomTone ? " · room-tone bed laid" : ""}
          </p>
        ) : v?.status === "pending" ? (
          <p>Verifying…</p>
        ) : (
          <p>Not verified — this take predates delivery verification</p>
        )}
      </div>
      <button
        onClick={onVerify}
        disabled={verifying}
        title="Re-run hard verification (and lay room tone if the location has a bed)"
        className="shrink-0 text-2xs text-gold hover:underline disabled:opacity-40"
      >
        {verifying ? "Checking…" : "Re-verify"}
      </button>
    </div>
  );
}

/** The composer's notes, grouped: what the craft rules CHANGED, what they
 * only warned about, and the ordinary composer notes. Each rule line carries
 * its id as a chip whose title is the measurement it came from — so a rule
 * you would otherwise have had to remember is on screen, with its evidence. */
function ComposerNotes({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  const changed = notes.filter((n) => ruleOfNote(n)?.changed);
  const warned = notes.filter((n) => ruleOfNote(n) && !ruleOfNote(n)?.changed);
  const plain = notes.filter((n) => !ruleOfNote(n));
  const RuleLine = ({ n }: { n: string }) => {
    const rule = ruleOfNote(n);
    const body = n.replace(/^Rule [a-z0-9-]+( changed the prompt)?:\s*/, "").replace(/\s*Why:.*$/, "");
    return (
      <p className="flex items-start gap-1.5 text-2xs leading-snug text-fog">
        <span
          title={rule ? craftRule(rule.id)?.why : undefined}
          className="shrink-0 rounded-pill border border-gold/40 px-1.5 font-mono text-2xs text-gold"
        >
          {rule?.id}
        </span>
        <span>{body}</span>
      </p>
    );
  };
  return (
    <div className="space-y-1.5">
      {changed.length > 0 && (
        <div>
          <p className={sectionLabel}>Composer changed your prompt</p>
          {changed.map((n, i) => <RuleLine key={i} n={n} />)}
        </div>
      )}
      {warned.length > 0 && (
        <div>
          <p className={sectionLabel}>Composer warnings</p>
          {warned.map((n, i) => <RuleLine key={i} n={n} />)}
        </div>
      )}
      {plain.map((n, i) => (
        <p key={i} className="text-2xs leading-snug text-fog">
          · {n}
        </p>
      ))}
    </div>
  );
}

/** qc_shot's report, as the tool prints it: the verdict, each measured
 * check, and the evidence directory for the vision pass — the only part
 * the crew cannot do for you. */
function QcPanel({
  report,
  onClose,
}: {
  report: NonNullable<Awaited<ReturnType<ReturnType<typeof useProduction>["qcShot"]>>>;
  onClose: () => void;
}) {
  const tone = report.verdict === "pass" ? "sage" : report.verdict === "review" ? "gold" : "ember";
  return (
    <div className="space-y-1.5 rounded-lg border border-cream/10 bg-ink/40 p-2.5">
      <div className="flex items-center gap-2">
        <Chip tone={tone} className="!px-1.5 !text-2xs">
          QC {report.verdict}
        </Chip>
        <span className="truncate text-2xs text-fog">take {report.takeId}</span>
        <button onClick={onClose} className="ml-auto text-fog hover:text-cream" title="Dismiss">
          <X size={11} />
        </button>
      </div>
      <ul className="space-y-0.5">
        {report.checks.map((c) => (
          <li key={c.id} className="flex items-start gap-1.5 text-2xs leading-snug text-fog">
            <span
              className={cx(
                "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                c.status === "pass" ? "bg-sage" : c.status === "warn" ? "bg-gold" : "bg-[#e07a6b]",
              )}
            />
            <span>
              <span className="font-mono text-cream/80">{c.id}</span> · {c.detail}
            </span>
          </li>
        ))}
      </ul>
      {report.notes.map((n, i) => (
        <p key={i} className="text-2xs leading-snug text-fog">
          · {n}
        </p>
      ))}
      <p className="break-all font-mono text-2xs text-fog" title="Open these for the vision pass: contact sheet, cut frames, keyframe, cast refs">
        evidence · {report.artifacts.dir}
      </p>
    </div>
  );
}

/** the composed spec (shot_from_storyboard dryRun): what a render in this
 * lane would ask for, before paying for it */
function SpecPanel({
  spec,
  onClose,
}: {
  spec: NonNullable<Awaited<ReturnType<ReturnType<typeof useProduction>["checkSpec"]>>>;
  onClose: () => void;
}) {
  const v = spec.videoInput;
  const prompt = v.prompt ?? "";
  return (
    <div className="space-y-1.5 rounded-lg border border-cream/10 bg-ink/40 p-2.5">
      <div className="flex items-center gap-2 text-2xs text-fog">
        <span className="font-mono text-cream/80">{v.engine ?? "ltx2"}</span>
        <span>· {spec.durationSec}s</span>
        {v.resolution && <span>· {v.resolution}</span>}
        {spec.preset && <span>· {spec.preset}</span>}
        <span>· {spec.director.audio.length} line{spec.director.audio.length === 1 ? "" : "s"} placed</span>
        <button onClick={onClose} className="ml-auto text-fog hover:text-cream" title="Dismiss">
          <X size={11} />
        </button>
      </div>
      <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-2xs leading-snug text-cream/80">{prompt}</p>
    </div>
  );
}
