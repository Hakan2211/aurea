import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  AudioLines,
  ChevronDown,
  CircleAlert,
  Dices,
  Film,
  FlaskConical,
  LayoutPanelTop,
  ListPlus,
  Lock,
  Maximize2,
  Repeat,
  Replace,
  Scissors,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import {
  composeCineClause,
  composeFreeform,
  composeZonePrompt,
  resolveLoraByFile,
  sprayVariants,
  withLook,
  type CameraSpec,
  type DirectorRef,
  type MinimaxRefs,
  type VideoAb,
  type VideoGenerate,
  type VideoPreset,
} from "@aurea/shared";
import { useVideoAb, useVideoLab, useVideoPresets } from "@/hooks";
import { useEnhanceControl } from "@/screens/image/EnhanceButton";
import { useActivePromptProject } from "@/screens/image/promptHooks";
import { fileToPngBase64 } from "@/components/imageFile";
import { GhostButton, GoldButton, SectionLabel, Segmented, Slider, Toggle, cx } from "@/components/ui";
import { computeEngineSurface, type CameraMove, type EngineSurface } from "./engineSurface";
import { EnginePicker } from "./EnginePicker";
import { AbModal } from "./AbModal";
import { PresetRail } from "./PresetRail";
import { ShotPicker } from "./ShotPicker";
import { AudioLane } from "./lanes/AudioLane";
import { CastLane } from "./lanes/CastLane";
import { MotionLane } from "./lanes/MotionLane";
import { ReferenceLane } from "./lanes/ReferenceLane";
import { FramePicker } from "./FramePicker";
import {
  BankSelect,
  MIN_BEAT_SEC,
  MIN_RETAKE_SEC,
  clampSec,
  fmtTime,
  selectInput,
  snapDuration,
  type DirectorBeat,
  type DirectorKeyframe,
  type DirectorMotion,
  type DirectorTake,
  type RetakeDraft,
  type ShotPrefill,
} from "./shared";

/* The params panel — everything a render is, in one 280px column.
 *
 * Redesigned 2026-08 around the engine surface: the panel asks
 * computeEngineSurface() what the chosen engine offers on this machine and
 * renders exactly that, instead of sprinkling `engineId === "…"` branches
 * through every section. The reading order is the deciding order — engine,
 * prompt, frames — and everything less-than-daily lives in collapsed
 * disclosure rows that summarise their current value in one line. A locked
 * row stays visible and says why (visible gating is the house style); a
 * hidden one isn't part of the engine's vocabulary at all. */

/** One frame slot — a still with its caption, or a dashed invitation to pick
 * one. The board draws start and end as a matched pair, so they are one
 * component rather than two near-identical blocks. */
function FrameTile({
  url,
  swatch,
  name,
  meta,
  onPick,
  onClear,
  emptyLabel,
}: {
  url?: string;
  swatch?: string;
  name?: string;
  meta?: string;
  onPick: () => void;
  /** end frames are optional — only those get a clear affordance */
  onClear?: () => void;
  emptyLabel?: string;
}) {
  if (!url && emptyLabel) {
    return (
      <button
        onClick={onPick}
        className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-cream/15 px-2 text-center transition hover:border-gold/50 hover:text-gold"
      >
        <Replace size={13} className="text-fog" />
        <span className="text-2xs leading-tight text-fog">{emptyLabel}</span>
      </button>
    );
  }
  return (
    <div className="group relative">
      <button
        onClick={onPick}
        title="Choose a different still"
        className="relative block aspect-video w-full overflow-hidden rounded-xl border border-cream/10 text-left transition hover:border-gold/40"
      >
        <div className={cx("absolute inset-0", swatch ?? "bg-raised")} />
        {url ? (
          <img
            src={url}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_30%,rgba(237,234,228,0.07),transparent_60%)]" />
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-ink/45 opacity-0 backdrop-blur-[1px] transition group-hover:opacity-100">
          <span className="inline-flex items-center gap-1 rounded-pill bg-cream/95 px-2 py-0.5 text-2xs font-medium text-ink">
            <Maximize2 size={9} /> Browse
          </span>
        </div>
        {(name || meta) && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/90 to-transparent px-1.5 pb-1 pt-4">
            {name && <div className="truncate text-2xs leading-tight text-cream/90">{name}</div>}
            {meta && <div className="truncate text-2xs leading-tight text-fog">{meta}</div>}
          </div>
        )}
      </button>
      {onClear && (
        <button
          onClick={onClear}
          title="Clear the end frame"
          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-cream/20 bg-ink text-fog opacity-0 transition hover:border-red-400/60 hover:text-red-400 group-hover:opacity-100"
        >
          <X size={9} />
        </button>
      )}
    </div>
  );
}

/** which frame a click on the picker is retargeting */
type Picking =
  | "start"
  | "end"
  | { lane: "director" | "simple"; i: number }
  | null;

/** A collapsed summary row that expands on click — the panel's unit of
 * progressive disclosure. Locked renders greyed with the surface's reason;
 * the chevron and the one-line summary are the whole collapsed footprint. */
function DisclosureRow({
  step,
  title,
  summary,
  state = "shown",
  reason,
  open,
  onToggle,
  children,
}: {
  /** position on the panel's numbered rail — the board's ⑤⑥⑦⑧ */
  step?: number;
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
          {step != null && <span className="step-numeral !border-cream/15 !text-fog">{step}</span>}
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
        {step != null && <span className="step-numeral">{step}</span>}
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

export function ParamsPanel({
  prefill,
  retake,
  setRetake,
  engineId,
  setEngineId,
}: {
  /** a shot sent over from the Storyboard; the panel is keyed on it, so every
   * piece of state below can seed from it in its initializer */
  prefill: ShotPrefill | null;
  retake: RetakeDraft | null;
  setRetake: (r: RetakeDraft | null) => void;
  /** lifted to the screen so the header can say which engine is on deck */
  engineId: string;
  setEngineId: (id: string) => void;
}) {
  const lab = useVideoLab();
  const ab = useVideoAb();
  const presets = useVideoPresets();
  /** the A/B dialog — an experiment on the payload this panel is holding */
  const [abOpen, setAbOpen] = useState(false);
  const [prompt, setPrompt] = useState(prefill?.prompt ?? lab.prompt);
  const [duration, setDuration] = useState(() =>
    prefill ? snapDuration(prefill.durationSec, lab.durations, lab.duration) : lab.duration,
  );
  const [resolution, setResolution] = useState(lab.resolution);
  const [motion, setMotion] = useState(lab.motionStrength);
  /** null = the default (newest library still); set by the Replace picker */
  const [frameRel, setFrameRel] = useState<string | null>(prefill?.startFrame ?? null);
  const [picking, setPicking] = useState<Picking>(null);
  /** Render from the prompt alone. The panel has always fallen back to the
   * newest library still, so there was no way to say "start from nothing" —
   * only engines with a real text-to-video path may turn this on. */
  const [noStartFrame, setNoStartFrame] = useState(false);
  /** The frame the take has to LAND on — MiniMax-H3's fl2va second anchor,
   * and (new) LTX's core end-frame guide where the install carries it. */
  const [endFrameRel, setEndFrameRel] = useState<string | null>(null);
  /** Loop (freeform plan §2.5): the take lands back on its own start frame —
   * `endFrame` = `startFrame` on the engines with an end-frame arm (H3 fl2va,
   * LTX's core guide). The take's sidecar records it so an export can drop
   * the seam frame. i2v only: there is nothing to loop back to otherwise. */
  const [loop, setLoop] = useState(false);
  /** LTX simple-path guide frames — mid-shot anchors on the way to the end
   * frame, without turning the full Director timeline on */
  const [simpleKeyframes, setSimpleKeyframes] = useState<DirectorKeyframe[]>([]);
  /** H3's OTHER head: things the shot must carry rather than a frame it starts
   * on. Non-empty switches the render to ref2va, which has no keyframes at all. */
  const [minimaxRefs, setMinimaxRefs] = useState<MinimaxRefs>({
    images: [],
    imageRoles: [],
    videos: [],
    audios: [],
    imageSize: "match",
  });
  /** name + preview for reference stills brought in from outside the library.
   * They are staged into projects/<id>/refs, which the library scanner never
   * walks, so the row would otherwise show a bare filename and a grey box. */
  const [importedRefs, setImportedRefs] = useState<Record<string, { name: string; url: string }>>(
    {},
  );
  const [refImportError, setRefImportError] = useState<string | null>(null);
  /** a dropped / pasted / picked still that failed to stage — under the tile */
  const [stillImportError, setStillImportError] = useState<string | null>(null);
  /* The bible-free aesthetics a LOOK put here (VIDEO-LAB-FREEFORM-PLAN.md).
   * The look prose is appended to the prompt once at submit (`withLook`
   * refuses to stack it), the negative rides `payload.negativePrompt` on the
   * LTX engines only — H3 and Seedance have no negative arm. */
  const [presetLook, setPresetLook] = useState("");
  const [negative, setNegative] = useState("");
  /** Shot Director: extra keyframes beyond the start frame, in seconds */
  const [directorOn, setDirectorOn] = useState(!!prefill);
  const [keyframes, setKeyframes] = useState<DirectorKeyframe[]>(
    // keyframe 0 IS the start frame here, and the panel puts it back at submit
    prefill ? prefill.director.keyframes.filter((k) => k.atSec > 0) : [],
  );
  /** prompt beats — the shot's phrasing over time; empty = one prompt throughout */
  const [beats, setBeats] = useState<DirectorBeat[]>(
    // a composed beat arrives already expanded (the storyboard resolved the
    // camera ids), so its pickers stay empty rather than expanding it twice
    prefill
      ? prefill.director.promptZones.map((z) => ({
          text: z.prompt,
          lengthSec: z.lengthSec,
          shot: z.shot,
          move: z.move,
        }))
      : [],
  );
  /** how hard a beat boundary lands: 0.001 a cut, 0.5 a dissolve */
  const [blend, setBlend] = useState(prefill?.director.epsilon ?? 0.001);
  /** optional dialogue take — switches the render to ia2v lip-sync */
  const [audioRel, setAudioRel] = useState<string | null>(null);
  const [audioOpen, setAudioOpen] = useState(false);
  /** Director audio lane: voice takes locked to timecodes. The simple path's
   * single take is the one-segment case of this, so turning the Director on
   * carries it onto the lane rather than dropping it. */
  const [lane, setLane] = useState<DirectorTake[]>(prefill?.director.audio ?? []);
  /** generate sound in the gaps between takes rather than leaving them silent */
  const [roomTone, setRoomTone] = useState(prefill?.director.inpaintAudio ?? true);
  /** an existing clip's movement, transferred onto this shot */
  const [motionRef, setMotionRef] = useState<DirectorMotion | null>(null);
  /** the cast this shot must stay on-model for — composed into one reference
   * sheet at render time */
  const [castRefs, setCastRefs] = useState<DirectorRef[]>(prefill?.director.refs ?? []);
  const [refStrength, setRefStrength] = useState(prefill?.director.refStrength ?? 1);
  /** LTX frame rate — 48 doubles frames for the same seconds, ~2× the wait */
  const [fps, setFps] = useState<24 | 48>(24);
  /* Quality. Two engines, two ladders: LTX has Draft (skip the ×2 upscale +
   * refine pass) and Final, H3 has three rungs — the 4-step distill, the
   * 8-step distill, and its own 25-step schedule. One piece of state holds
   * both, and `effectiveQuality` collapses the middle rung for the engines
   * that don't have one, so switching engine can't leave the segmented control
   * showing a value none of its options carry. */
  const [quality, setQuality] = useState<"draft" | "standard" | "final">("final");
  /** LTX 2.5's Gemma prompt enhancer — on by default when installed. Off is
   * the setting for a prompt authored to a structure (multi-shot prose, exact
   * quoted dialogue): the rewrite destroys cuts and drops lines. */
  const [enhance, setEnhance] = useState(true);
  /** stackable adapter LoRAs, from this install's own lora folder */
  const [loras, setLoras] = useState<{ name: string; strength: number }[]>([]);
  /** camera-control LoRA — hidden until 22b weights exist (see engineSurface) */
  const [cameraMove, setCameraMove] = useState<CameraMove | "">("");
  const [cameraStrength, setCameraStrength] = useState(1);
  /* The lane this shot is being rendered in, and the settings the lane put
   * there. Keeping the applied snapshot (rather than a dirty flag) is what
   * lets the chip say "customised" honestly: the panel compares what is set
   * NOW against what the lane set, so undoing an edit re-attaches the lane. */
  const [presetId, setPresetId] = useState<string | null>(null);
  const [presetSnapshot, setPresetSnapshot] = useState<Record<string, unknown> | null>(null);
  /** cinematography-bank ids for this render — a lane's defaults, or the
   * director's own picks. Expanded to prose at submit, never by an adapter. */
  const [cine, setCine] = useState<Partial<CameraSpec>>(prefill?.camera ?? {});
  /** the one open disclosure row — an accordion, so the column stays a column */
  const [openRow, setOpenRow] = useState<string | null>(null);
  const toggleRow = (id: string) => setOpenRow((o) => (o === id ? null : id));

  /* Applying a lane. Everything it names is set; everything it doesn't name is
   * left alone — a lane is a set of answers, not a reset button. The snapshot
   * is what the "customised" chip is measured against. */
  const applyPreset = (preset: VideoPreset) => {
    const p = preset.payload;
    if (p.engine) setEngineId(p.engine);
    if (p.resolution) setResolution(p.resolution);
    if (p.durationSec !== undefined)
      setDuration(snapDuration(p.durationSec, lab.durations, duration));
    if (p.fps) setFps(p.fps);
    if (p.enhance !== undefined) setEnhance(p.enhance);
    // H3's three rungs win where it has them; LTX only ever means draft-or-not
    const tier = p.minimaxTier ?? (p.fast === true ? "draft" : p.fast === false ? "final" : null);
    if (tier) setQuality(tier);
    setCine(preset.cine);
    /* a look's own fields. A lane leaves them alone unless it names them, so
     * applying a Zoo Logic lane over a look clears the look (a lane has no
     * look prose of its own) — the project's look line takes over downstream */
    setPresetLook(preset.look ?? "");
    setNegative(preset.negative ?? "");
    /* A look names its style LoRA by FILE. The name is kept AS WRITTEN here
     * and resolved against the install's own list when the payload is built
     * (`payloadLoras`) — resolving at apply time made the LoRA depend on
     * whether the capability probe had answered yet, which is a race the
     * user experiences as "the look sometimes brings its adapter". */
    if (p.loras) setLoras(p.loras.slice(0, lorasMax));
    if (p.cameraLora) {
      setCameraMove(p.cameraLora.move);
      setCameraStrength(p.cameraLora.strength ?? 1);
    }
    setPresetId(preset.id);
    setPresetSnapshot({
      engine: p.engine,
      resolution: p.resolution,
      durationSec: p.durationSec,
      fps: p.fps,
      enhance: p.enhance,
      tier,
      cine: JSON.stringify(preset.cine),
      negative: preset.negative ?? "",
    });
  };
  const clearPreset = () => {
    setPresetId(null);
    setPresetSnapshot(null);
    setPresetLook("");
    setNegative("");
  };

  /* Has the lane been edited out from under its chip? Compared field by field
   * against what the lane actually SET — a lane that says nothing about fps
   * can't be detached by changing the fps. */
  const presetCustomised =
    presetSnapshot !== null &&
    ((presetSnapshot.engine !== undefined && presetSnapshot.engine !== engineId) ||
      (presetSnapshot.resolution !== undefined && presetSnapshot.resolution !== resolution) ||
      (presetSnapshot.durationSec !== undefined &&
        presetSnapshot.durationSec !== (parseInt(duration) || 0)) ||
      (presetSnapshot.fps !== undefined && presetSnapshot.fps !== fps) ||
      (presetSnapshot.enhance !== undefined && presetSnapshot.enhance !== enhance) ||
      (presetSnapshot.tier !== null &&
        presetSnapshot.tier !== undefined &&
        presetSnapshot.tier !== quality) ||
      presetSnapshot.negative !== negative ||
      presetSnapshot.cine !== JSON.stringify(cine));

  /* the engine's declared surface on THIS machine — every section below reads
   * its own visibility off this instead of switching on engineId */
  const surface: EngineSurface = computeEngineSurface(
    {
      durations: lab.durations,
      resolutions: lab.resolutions,
      resolutionsByEngine: lab.resolutionsByEngine,
      ltx: lab.ltx,
      minimaxRefsAvailable: lab.minimaxRefsAvailable,
      minimaxTurboAvailable: lab.minimaxTurboAvailable,
      minimaxLongForm: lab.minimaxLongForm,
      minimaxCamera: lab.minimaxCamera,
      minimaxWeights: lab.minimaxWeights,
    },
    lab.capabilities,
    engineId,
  );
  /** both local LTX engines share the guide/fps/draft/LoRA surface; what
   * only 2.3 has (dialogue, Director, camera) is gated separately below */
  const isLtx = engineId === "ltx2" || engineId === "ltx25";
  const keyframesMax = lab.ltx?.keyframesMax ?? 8;
  const lorasMax = lab.ltx?.lorasMax ?? 3;

  // the dead-core fallback shape predates the live fields — narrow before use
  const chosen = frameRel ? lab.frames.find((f) => f.relPath === frameRel) : undefined;
  const defaultRel = "relPath" in lab.startFrame ? lab.startFrame.relPath : undefined;
  /* A named frame is the frame, whether or not the panel's roll (the newest 60
   * stills) happens to hold it — a shot sent over from the board can point at a
   * keyframe boarded weeks ago. Falling back to `chosen` here would silently
   * render the newest image in the library instead of the one that was asked
   * for, so only the thumbnail degrades, never the render. */
  const effectiveRel = frameRel ?? defaultRel;
  const endFrame = endFrameRel ? lab.frames.find((f) => f.relPath === endFrameRel) : undefined;
  const frameName = chosen?.name ?? (frameRel ? (frameRel.split("/").pop() ?? frameRel) : lab.startFrame.name);
  const frameMeta = chosen?.meta ?? (frameRel ? "start frame" : lab.startFrame.meta);
  const frameSwatch = chosen?.swatch ?? lab.startFrame.swatch;
  const startFrameUrl =
    chosen?.url ??
    lab.stillUrl(frameRel) ??
    (frameRel ? undefined : "url" in lab.startFrame ? lab.startFrame.url : undefined);
  /** a reference shot IS the reference set — ref2va takes no start frame, so
   * requiring one would block the only mode that can't use it */
  const refCount = minimaxRefs.images.length + minimaxRefs.videos.length + minimaxRefs.audios.length;
  const refsOn = engineId === "minimax-h3" && !retake && !directorOn && refCount > 0;
  /* All three engines render from a prompt alone, by three different routes:
   * Seedance 2.0 posts to its text-to-video endpoint, H3 simply omits the
   * optional first_frame on MiniMaxH3ImageToVideo, and LTX flips the template's
   * own "Switch to Text to Video?" boolean, which bypasses ImgToVideoInplace.
   * A reference shot is already frameless, and the Director timeline and a
   * retake both need an existing take to work from. */
  const t2vCapable =
    engineId === "seedance" || isLtx || engineId === "minimax-h3";
  /* Text to video is what the panel does when there is no frame — asked for
   * with the switch, or simply because the library has no still yet. Before
   * this the empty-library case was "can't generate" with nothing to say why. */
  const t2vOn = t2vCapable && (noStartFrame || !effectiveRel) && !retake && !directorOn && !refsOn;
  const canGenerate = "canGenerate" in lab ? refsOn || t2vOn || !!effectiveRel : false;
  const audioName = audioRel
    ? (lab.audioSources.find((a) => a.relPath === audioRel)?.name ?? audioRel)
    : null;
  /* Engines do not share a duration ladder either — H3 alone goes past 20s,
   * and only once the chunked sampler is installed. Same rule as the canvas
   * below: an engine switch must never leave a length selected that the new
   * engine's ladder does not carry, because nothing downstream would notice
   * and LTX would be handed a 60-second shot. */
  const effectiveDuration = surface.durations.includes(duration)
    ? duration
    : snapDuration(parseInt(duration) || 5, surface.durations, duration);
  const durationSec = parseInt(effectiveDuration) || 5;
  /* An engine switch may leave the chosen preset off the new engine's canvas;
   * the payload always sends a legal one, and the select shows what will
   * actually render rather than a stale label. */
  const effectiveResolution = surface.resolutions.includes(resolution)
    ? resolution
    : (surface.resolutions[0] ?? resolution);
  const isMinimax = engineId === "minimax-h3";
  const effectiveQuality = !isMinimax && quality === "standard" ? "final" : quality;
  /** the 2.5 Gemma enhancer is installed on this machine — the toggle only
   * appears where it would do something (visible gating, not silent absence,
   * but a control nobody can use is noise rather than gating) */
  const enhancer25 = engineId === "ltx25" && !!lab.ltx?.enhancer25;
  /* Exactly which MiniMax-H3 this Generate will run. Three independent choices
   * decide it and only one of them is a control the user touched: the head
   * (references or not), the checkpoint (the 4-bit set wins automatically when
   * installed) and the distill (the Quality tier). "Which model am I using"
   * must be answerable from the panel, not from a job's detail line after the
   * fact — that was the whole complaint. */
  const minimaxHead = refsOn ? ("ref2va" as const) : ("fl2va" as const);
  const minimaxFormat = lab.minimaxWeights[minimaxHead];
  const MINIMAX_DISTILL: Record<"draft" | "standard", Record<"fl2va" | "ref2va", string>> = {
    draft: {
      fl2va: "LightX2V fl2v 4-step v1.1 (768p)",
      ref2va: "LightX2V ref2v 4-step v0.1",
    },
    standard: {
      fl2va: "LightX2V fl2v 8-step v1.0 (768p)",
      ref2va: "LightX2V ref2v 4-step v0.1, run at 8 steps",
    },
  };
  const minimaxDistill =
    effectiveQuality === "final" ? null : MINIMAX_DISTILL[effectiveQuality][minimaxHead];
  const minimaxWeightLabel = minimaxFormat === "w4a8" ? "w4a8 · 4-bit" : "GGUF · Q3_K_M";
  const directorBlocked = surface.sections.director.state !== "shown";
  /** simple-path guide frames apply outside Director/retake renders only —
   * the Director timeline has its own keyframe lane */
  const guidesOn = isLtx && !directorOn && !retake && surface.sections.endFrame.state === "shown";
  /** Copy picked files into the project and attach them as reference stills.
   * The renderer re-encodes to PNG first — the core only takes PNG, and a
   * phone photo would blow its 32 MB ceiling. Non-images are skipped rather
   * than failed: a multi-select that catches a stray file should still add the
   * pictures. */
  const importRefImages = async (files: FileList | File[]) => {
    setRefImportError(null);
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const png = await fileToPngBase64(file);
        const rel = await lab.addRef(file.name.replace(/\.[^.]+$/, "") || "reference", png);
        setImportedRefs((m) => ({ ...m, [rel]: { name: file.name, url: URL.createObjectURL(file) } }));
        setMinimaxRefs((r) =>
          r.images.length >= 9 ? r : { ...r, images: [...r.images, rel] },
        );
      } catch (err) {
        setRefImportError(String((err as Error).message ?? err));
      }
    }
  };
  /** Bring a picture in from outside — dropped on a frame tile, pasted, or
   * picked from disk — and make it the frame in `slot`. Re-encoded to PNG in
   * the renderer (same contract as refs); staged as a LIBRARY asset so it has
   * a thumbnail and shows in every roll from now on. The first image wins;
   * a start frame is one picture. */
  const importStillInto = async (files: FileList | File[], slot: "start" | "end" | Picking) => {
    const file = Array.from(files).find((f) => f.type.startsWith("image/"));
    if (!file) {
      setStillImportError("That isn't a picture — drop a PNG, JPEG or WebP.");
      return;
    }
    setStillImportError(null);
    try {
      const png = await fileToPngBase64(file);
      const rel = await lab.importStill(file.name.replace(/\.[^.]+$/, "") || "still", png);
      if (slot === "start") {
        setFrameRel(rel);
        setNoStartFrame(false);
      } else if (slot === "end") setEndFrameRel(rel);
      else if (slot && typeof slot === "object") {
        if (slot.lane === "director")
          setKeyframes((ks) => ks.map((k, j) => (j === slot.i ? { ...k, image: rel } : k)));
        else setSimpleKeyframes((ks) => ks.map((k, j) => (j === slot.i ? { ...k, image: rel } : k)));
      }
    } catch (err) {
      setStillImportError(String((err as Error).message ?? err));
    }
  };
  /* Ctrl+V with a picture on the clipboard makes it the start frame — unless
   * the cursor is in a text field, where paste means paste. */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      void importStillInto(files, picking && picking !== "start" ? picking : "start");
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });
  /** drop handlers for a frame tile — the same import, aimed at one slot */
  const dropInto = (slot: "start" | "end") => ({
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer.files.length) void importStillInto(e.dataTransfer.files, slot);
    },
  });

  /** a clicked reference tag lands in the prompt — once */
  const insertTag = (tag: string) =>
    setPrompt((p) =>
      p.includes(tag) ? p : `${p.trimEnd()}${p.trim() ? " " : ""}${tag} `.slice(0, lab.promptMax),
    );

  /** a new beat takes the time the existing ones leave over, or an even third
   * of the shot when they already fill it */
  const addBeat = () => {
    setBeats((bs) => {
      const left = durationSec - bs.reduce((s, b) => s + b.lengthSec, 0);
      const lengthSec = Math.max(MIN_BEAT_SEC, left > 0.2 ? left : durationSec / 3);
      return [...bs, { text: "", lengthSec: Math.round(lengthSec * 10) / 10, shot: "", move: "" }];
    });
  };
  /** default a new keyframe to the newest still the user hasn't used yet —
   * shared by both keyframe lanes (Director and simple-path) */
  const nextUnusedFrame = (used: Iterable<string | undefined>) => {
    const taken = new Set(used);
    return lab.frames.find((f) => !taken.has(f.relPath)) ?? lab.frames[0];
  };
  const addKeyframe = (atSec: number) => {
    const next = nextUnusedFrame([effectiveRel, ...keyframes.map((k) => k.image)]);
    if (!next) return;
    setKeyframes((ks) =>
      [...ks, { image: next.relPath, atSec: clampSec(atSec, durationSec), strength: 1 }].sort(
        (a, b) => a.atSec - b.atSec,
      ),
    );
  };
  const addSimpleKeyframe = () => {
    const next = nextUnusedFrame([effectiveRel, endFrameRel ?? undefined, ...simpleKeyframes.map((k) => k.image)]);
    if (!next) return;
    setSimpleKeyframes((ks) =>
      ks.length >= keyframesMax
        ? ks
        : [...ks, { image: next.relPath, atSec: clampSec(durationSec / 2, durationSec), strength: 1 }].sort(
            (a, b) => a.atSec - b.atSec,
          ),
    );
  };
  /** Where each beat actually lands, mirroring fitZones() in the builder: beats
   * tile in order, one that starts past the end never arrives, and the last
   * surviving beat stretches to the boundary so the take is fully covered. */
  const tiling = (() => {
    let cursor = 0;
    const rows = beats.map((b) => {
      const start = cursor;
      const length = Math.max(0, Math.min(b.lengthSec, durationSec - cursor));
      cursor += length;
      return { start, length, dead: length <= 0 };
    });
    const live = rows.filter((r) => !r.dead);
    if (live.length && cursor < durationSec) live[live.length - 1].length += durationSec - cursor;
    return {
      rows,
      dead: rows.length - live.length,
      asked: beats.reduce((s, b) => s + b.lengthSec, 0),
      short: live.length > 0 && cursor < durationSec,
      flicker: live.some((r) => r.length < MIN_BEAT_SEC),
    };
  })();

  /** the typed line plus whatever the camera pickers say, expanded through the
   * bank here — the render path takes these prompts verbatim */
  const promptZones = beats
    .map((b) => ({
      // a beat left blank still owns its slice of the take, falling back to the
      // shot prompt — dropping it would slide every later beat earlier than
      // the bar above says it lands
      prompt:
        composeZonePrompt({ prompt: b.text, shot: b.shot, move: b.move }, lab.cinematography) ||
        prompt.trim(),
      lengthSec: Math.max(0.1, b.lengthSec),
      shot: b.shot,
      move: b.move,
    }))
    .filter((z) => z.prompt.length > 0);

  /* A retake is its own kind of render: the source take is the picture
   * everywhere outside the marked window, so keyframes, beats and the audio
   * lane don't apply, and the shot's length, rate and size come off the source
   * rather than the controls above. It doesn't need the Director toggle either
   * — marking a window IS the request. */
  const retakeReady =
    retake !== null && !directorBlocked && retake.prompt.trim().length > 0
      ? retake
      : null;

  const director = retakeReady
    ? {
        globalPrompt: prompt,
        negativePrompt: prefill?.director.negativePrompt,
        fps: 24,
        keyframes: [],
        promptZones: [],
        audio: [],
        retake: {
          source: retakeReady.source,
          atSec: retakeReady.atSec,
          lengthSec: Math.max(MIN_RETAKE_SEC, retakeReady.lengthSec),
          prompt: retakeReady.prompt.trim(),
          strength: retakeReady.strength,
          regenerateAudio: retakeReady.regenerateAudio,
        },
        inpaintAudio: retakeReady.regenerateAudio,
        epsilon: blend,
      }
    : directorOn && !directorBlocked && effectiveRel
      ? {
          globalPrompt: prompt,
          // a shot from the storyboard carries the show's own negative prompt
          negativePrompt: prefill?.director.negativePrompt,
          fps: 24,
          // the start frame is always keyframe 0; the rest ride on top
          keyframes: [
            { image: effectiveRel, atSec: 0, strength: 1 },
            ...keyframes.filter((k) => k.image !== effectiveRel || k.atSec > 0),
          ],
          promptZones,
          audio: lane,
          // one IC-LoRA slot, so the cast sheet and a motion reference are
          // mutually exclusive — the lanes disable each other above, and this
          // drops the cast rather than sending a pair the core would reject
          motion: motionRef ?? undefined,
          refs: motionRef ? [] : castRefs,
          refStrength,
          inpaintAudio: roomTone,
          epsilon: blend,
        }
      : undefined;

  /* The director's edit as prose. Composed HERE, once, and appended to the
   * prompt the panel sends — the adapters are handed language, never bank ids
   * (a second expansion downstream would say the framing twice). */
  const cineClauseText = composeCineClause(cine, lab.cinematography);
  const promptWithCine =
    cineClauseText && !prompt.toLowerCase().includes(cineClauseText.toLowerCase())
      ? `${prompt.trim().replace(/\.$/, "")}. ${cineClauseText}.`
      : prompt;

  /* A look renders through the art-director composer (freeform.ts): the
   * user's line is the subject in t2v and the MOTION in i2v (the image is the
   * subject there — re-describing it loses the frame), one clause says what
   * stays, the camera ids become bank prose even with no bible, the look
   * prose goes on once, H3 gets its soundscape line, and the craft table runs
   * last. The look's fields are read from the panel's state, not the preset,
   * so a customised look composes with what the user changed. */
  const activeLook = presetId ? presets.find((p) => p.id === presetId && p.lane === "look") : undefined;
  const composed = activeLook
    ? composeFreeform({
        subject: prompt,
        mode: t2vOn ? "t2v" : "i2v",
        look: { ...activeLook, look: presetLook, negative, cine: activeLook.cine },
        cine,
        engine: engineId,
        durationSec,
        bank: lab.cinematography,
        hasAudio: !!audioRel || lane.length > 0,
      })
    : null;
  /** the composer's own remarks, shown under the prompt — rule notes keep
   * their id so the line can be traced to the measurement */
  const composerNotes = composed?.notes.map((n) => n.replace(/\. Why: .*$/, "")) ?? [];

  /* The Claude enhance button beside the Prompt label — the Image lab's
   * control with intent "video", steered by the look when there is no bible
   * and told whether the expansion has to stay motion-only. */
  const promptProject = useActivePromptProject();
  const enhanceCtl = useEnhanceControl({
    prompt,
    projectId: promptProject,
    intent: "video",
    look: presetLook,
    mode: t2vOn ? "t2v" : "i2v",
    title: t2vOn
      ? "Expand this line into a one-shot video prompt (local Claude)"
      : "Expand the motion — the image already carries the scene (local Claude)",
    onAccept: (enhanced) => setPrompt(enhanced.slice(0, lab.promptMax)),
  });

  /* The payload, built once. It used to be assembled inline inside
   * `generate`, which meant the A/B queue would have had to reproduce every
   * one of the engine-gating rules below — and an experiment whose base
   * payload differs from what Generate sends is not an experiment. */
  /* the loop is only real where an end frame is: H3's fl2va, or LTX's core
   * guide nodes — and only with a start frame to land back on */
  const loopOn =
    loop &&
    !t2vOn &&
    !refsOn &&
    !retake &&
    !directorOn &&
    !!effectiveRel &&
    ((engineId === "minimax-h3") || guidesOn);
  /** the frame the take lands on: its own start when looping */
  const landRel = loopOn ? effectiveRel : (endFrameRel ?? undefined);
  /* the LoRAs as this install names them. A name the install does not carry
   * is dropped rather than sent: ComfyUI validates the combo verbatim and
   * refuses the whole render over one missing file, and a look must stay
   * renderable (as prose alone) on a machine that never downloaded the set. */
  const installedLoras = lab.capabilities?.availableLoras ?? [];
  const payloadLoras = loras
    .filter((l) => l.name)
    .map((l) => {
      const name = resolveLoraByFile(installedLoras, l.name);
      return name ? { ...l, name } : null;
    })
    .filter((l): l is { name: string; strength: number } => l !== null)
    .slice(0, lorasMax);
  /** a LoRA the look asked for that this install hasn't got — said once,
   * under the row, rather than failing the render */
  const missingLoras = loras
    .filter((l) => l.name && !resolveLoraByFile(installedLoras, l.name))
    .map((l) => l.name.split(/[\\/]/).pop() ?? l.name);
  const payload: Omit<VideoGenerate, "project"> = {
    // a look's prose goes on last and once; withLook refuses to repeat it
    prompt: composed
      ? composed.prompt
      : presetLook
        ? withLook(promptWithCine, presetLook)
        : promptWithCine,
    // LTX only — the other adapters have no negative arm and reject strays
    negativePrompt: isLtx
      ? (composed ? composed.negative : negative.trim()) || undefined
      : undefined,
    // what the picker said, for the record — the prose above is what renders
    cine: Object.values(cine).some((v) => v) ? cine : undefined,
    // for the sidecar: the end frame below does the work
    loop: loopOn ? true : undefined,
    engine: engineId,
    durationSec,
    resolution: effectiveResolution,
    motionStrength: motion,
    // a reference shot has no keyframes at all — sending one is an
    // error on ref2va, not a hint it can ignore
    startFrame: refsOn || t2vOn ? undefined : effectiveRel,
    /* the end frame rides two engines now: H3's fl2va, and LTX's core guide
     * nodes when the probe found them. Everywhere else the field is dead
     * weight that would survive an engine switch — and the adapters reject
     * engine-inappropriate fields loudly rather than ignoring them. */
    endFrame:
      engineId === "minimax-h3" && !refsOn
        ? landRel
        : guidesOn
          ? landRel
          : undefined,
    // everything below this line is LTX-2.3 vocabulary — omitted (never
    // defaulted) for other engines, so their adapters see a clean payload
    keyframes:
      guidesOn && simpleKeyframes.length
        ? simpleKeyframes.slice(0, keyframesMax)
        : undefined,
    fps: isLtx && fps === 48 ? 48 : undefined,
    // draft rides two engines now — LTX skips its refine stage, H3 loads the
    // Turbo distill; only sent where the surface offers the choice, so an
    // engine switch can't smuggle a stale draft flag into a clean payload
    fast:
      surface.sections.quality.state === "shown" && effectiveQuality === "draft"
        ? true
        : undefined,
    // only ever sent as false — undefined keeps the adapter's historical
    // "on when the weights are installed", so old cores read it unchanged
    enhance: engineId === "ltx25" && !enhance ? false : undefined,
    /* H3's own three-rung ladder. `fast` above stays in the payload because
     * LTX speaks it and an older core reads it; this is what H3 actually
     * renders from. */
    minimaxTier:
      isMinimax && surface.sections.quality.state === "shown" ? effectiveQuality : undefined,
    loras:
      isLtx && surface.sections.adapters.state === "shown" && payloadLoras.length
        ? payloadLoras
        : undefined,
    cameraLora:
      (isLtx || isMinimax) && surface.sections.camera.state === "shown" && cameraMove
        ? { move: cameraMove, strength: cameraStrength }
        : undefined,
    minimaxRefs: refsOn ? minimaxRefs : undefined,
    // the lane owns dialogue once the Director is on: leaving the
    // simple field set would put a take back at 0s that the user may
    // have just taken off the lane
    // 2.5 has no ia2v arm yet, and its adapter rejects a take rather than
    // ignoring it — so a stale audioRel from an engine switch must not ride
    audio: director || engineId !== "ltx2" ? undefined : (audioRel ?? undefined),
    director,
    // a shot sent over from the board delivers its take back to the
    // board; a retake is a fix for a clip, not a new take of a shot
    board: prefill && !retake ? { shotId: prefill.shotId } : undefined,
  };

  const generate = () => lab.generate(payload);

  /* ---- disclosure summaries — the one line each row shows while closed ---- */
  const sizeShort = effectiveResolution.split(" (")[0].replace(/\s/g, "");
  const sizeSummary = `${durationSec}s · ${sizeShort}${isLtx && fps === 48 ? " · 48fps" : ""}`;
  const soundSummary = retake
    ? "Kept from the source take"
    : directorOn
      ? "On the Director's audio lane"
      : (audioName ?? "None — the model scores it");
  const adapterSummary = loras.filter((l) => l.name).length
    ? loras
        .filter((l) => l.name)
        .map((l) => l.name.split(/[\\/]/).pop())
        .join(", ")
    : "None";
  const hd = /HD|2K|1080/.test(effectiveResolution);
  /* 48fps doubles frames, HD quadruples pixels over the 704-class canvas, and
   * past 8s the latents alone crowd a 24 GB card — all three at once is the
   * combination that dies at the VAE, so it gets its own warning */
  const vramStack = isLtx && fps === 48 && hd && durationSec > 8;
  const seedanceSnapSec = durationSec > 7 ? 10 : 5;
  const seedanceEst = (seedanceSnapSec * (/1080/.test(effectiveResolution) ? 0.15 : 0.05)).toFixed(2);

  /* Which moves the CHOSEN engine can actually steer. LTX asks the install
   * which Lightricks weights it can see; H3 has one weight that covers the
   * whole vocabulary, so the catalog simply lists it. Same control, two very
   * different mechanisms underneath. */
  const cameraMoves = isMinimax
    ? (lab.minimaxCamera.moves as CameraMove[])
    : (lab.ltx?.cameraMoves ?? []).filter(
        (m): m is CameraMove => !!lab.capabilities?.cameraLoras?.[m as CameraMove],
      );

  /* ---- the numbered rail ----
   * Engine is 1, prompt 2, the frames block takes 3 (and 4 when the engine
   * offers an end frame). Every disclosure row after that draws the next
   * number IN RENDER ORDER — computed rather than written down, because a row
   * the engine doesn't have is not rendered at all, and a rail that counts
   * 5, 7, 9 reads as broken rather than as filtered. */
  const endFrameShown =
    !directorOn &&
    !retake &&
    !refsOn &&
    // nothing to land a journey on when there is no frame to leave from; on
    // Seedance the end frame lives on the image endpoint the t2v path skips
    !t2vOn &&
    surface.sections.endFrame.state === "shown";
  let stepCursor = endFrameShown ? 4 : 3;
  const nextStep = (state: "shown" | "locked" | "hidden" = "shown") =>
    state === "hidden" ? undefined : ++stepCursor;

  return (
    <aside className="flex w-[304px] shrink-0 flex-col border-r hairline bg-[#0e0e10]">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {/* a shot sent over from the board — what was composed for you, and
            what the composer couldn't do on its own */}
        {prefill && (
          <section className="rounded-panel border border-gold/25 bg-gold/5 px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.12em] text-gold">
              <LayoutPanelTop size={11} /> From the storyboard
            </div>
            <p className="mt-1 text-xs leading-snug text-cream/90">
              {prefill.title || prefill.shotId}
            </p>
            <p className="mt-0.5 text-2xs leading-relaxed text-fog">
              Beats, cast and the audio lane are composed below — edit anything. The finished take
              lands back on the shot.
            </p>
            {prefill.notes.map((n) => (
              <p key={n} className="mt-1.5 text-2xs leading-relaxed text-gold/75">
                {n}
              </p>
            ))}
          </section>
        )}

        {/* 0 · the lane — eight answers in one click, for the four shapes the
            show actually shoots — and the LOOKS, the same eight answers for a
            shot that has no show: just a picture or a sentence */}
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

        {/* 1 · engine — the choice that decides what the rest of the panel is */}
        <EnginePicker
          engines={lab.engines}
          value={engineId}
          onChange={setEngineId}
          note={lab.engineNotes[engineId]}
        />

        {/* 2 · prompt */}
        <section>
          <SectionLabel right={enhanceCtl.button} step={2}>
            Prompt
          </SectionLabel>
          {/* the count lives inside the box, bottom-right, as on the board */}
          <div className="relative mt-2">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value.slice(0, lab.promptMax))}
              rows={5}
              className="w-full resize-none rounded-xl border border-cream/10 bg-surface p-3 pb-6 text-sm leading-relaxed text-cream transition-[border-color,box-shadow] placeholder:text-fog focus:border-gold/45 focus:shadow-[0_0_0_3px_rgba(201,169,110,0.1)] focus:outline-none"
              placeholder="Describe the shot…"
            />
            <span className="pointer-events-none absolute bottom-2 right-3 text-2xs tabular-nums text-fog">
              {prompt.length} / {lab.promptMax}
            </span>
          </div>
          {enhanceCtl.card}
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
        </section>

        {/* 3 · frames — where the take starts, lands and passes through.
            The board pairs start and end side by side with a swap between
            them; when the engine has no end frame the start runs full width. */}
        {(() => {
          const endShown = endFrameShown;
          const startTile = (
            <div {...dropInto("start")}>
              <FrameTile
                url={startFrameUrl}
                swatch={frameSwatch}
                name={frameName}
                meta={`${frameMeta}${!frameRel ? " · default" : ""}`}
                onPick={() => setPicking("start")}
              />
            </div>
          );
          /** the other way in: a picture that is not in the library yet */
          const importRow = (
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <label
                className={cx(
                  "inline-flex cursor-pointer items-center gap-1 text-2xs text-fog transition hover:text-gold",
                  lab.importingStill && "pointer-events-none opacity-60",
                )}
              >
                <Upload size={10} />
                {lab.importingStill ? "Bringing it in…" : "From your computer"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) void importStillInto(e.target.files, "start");
                    e.target.value = "";
                  }}
                />
              </label>
              <span className="text-2xs text-fog/50">or drop / paste a picture</span>
            </div>
          );
          /* Stills made on Midjourney / GPT / Krea: drop them in the project
           * inbox and they arrive in the roll, tagged with where they came
           * from. One that brought its prompt can hand it to the prompt box. */
          const inboxRow = (
            <div className="mt-1 space-y-1">
              {chosen?.sourcePrompt && (
                <button
                  type="button"
                  className="text-2xs text-fog transition hover:text-gold"
                  title={chosen.sourcePrompt}
                  onClick={() => setPrompt(chosen.sourcePrompt!.slice(0, lab.promptMax))}
                >
                  Use the still&apos;s own prompt
                </button>
              )}
              {lab.inboxDir && (
                <p className="select-text break-all text-2xs leading-relaxed text-fog/50" title="Drop Midjourney, GPT or Krea images here">
                  Inbox · {lab.inboxDir}
                </p>
              )}
            </div>
          );
          const importError = stillImportError && (
            <p className="mt-1 flex items-start gap-1 text-2xs text-red-300">
              <CircleAlert size={10} className="mt-px shrink-0" /> {stillImportError}
            </p>
          );
          /* "From the prompt only" — the panel otherwise always has a start
           * frame (it falls back to the newest still), so without an explicit
           * switch there is no way to express a text-to-video shot at all. */
          const t2vSwitch = t2vCapable && !retake && !directorOn && !refsOn && (
            <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-xl border border-cream/10 bg-surface/40 px-2.5 py-2 transition hover:border-cream/25">
              <input
                type="checkbox"
                checked={noStartFrame}
                onChange={(e) => setNoStartFrame(e.target.checked)}
                className="mt-0.5 h-3 w-3 shrink-0 accent-gold"
              />
              <span className="text-2xs leading-relaxed text-fog">
                <span className="font-medium text-cream">Text to video</span> — render from the
                prompt alone. Nothing anchors identity, so the look is whatever the prompt
                describes; for an on-model character, board a frame first.
              </span>
            </label>
          );
          if (t2vOn) {
            return (
              <section>
                <SectionLabel step={3}>Start frame</SectionLabel>
                {!effectiveRel && (
                  <div
                    {...dropInto("start")}
                    className="mt-2 flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-cream/15 px-3 text-center"
                  >
                    <Upload size={13} className="text-fog" />
                    <span className="text-2xs leading-tight text-fog">
                      No stills yet — drop or paste a picture to start from it, or render from
                      the prompt alone below.
                    </span>
                  </div>
                )}
                {effectiveRel ? null : importRow}
                {importError}
                {t2vSwitch}
              </section>
            );
          }
          return (
            <section>
              {endShown ? (
                <>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
                    <h3 className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.14em] text-fog">
                      <span className="step-numeral">3</span> Start
                    </h3>
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
                      className="flex h-5 w-5 items-center justify-center rounded-md text-fog transition hover:bg-cream/5 hover:text-gold disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fog"
                    >
                      <ArrowLeftRight size={11} />
                    </button>
                    <h3 className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.14em] text-fog">
                      <span className="step-numeral">4</span> End
                    </h3>
                  </div>
                  <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
                    {startTile}
                    <span className="h-px w-2 bg-cream/15" />
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
                  {importRow}
                  {inboxRow}
                  {importError}
                  <p className="mt-1.5 text-2xs leading-relaxed text-fog">
                    {endFrameRel
                      ? engineId === "minimax-h3"
                        ? "fl2va — H3 has to arrive at this frame by the last beat."
                        : "LTX interpolates the whole way there, in one continuous take."
                      : engineId === "minimax-h3"
                        ? "Leave empty and H3 animates forward freely from the start frame."
                        : "End frames work on LTX now, not just MiniMax — the take is guided to land here."}
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
              ) : (
                <>
                  <SectionLabel
                    step={3}
                    right={
                      <button
                        onClick={() => setPicking("start")}
                        className="inline-flex items-center gap-1 text-2xs text-fog transition hover:text-gold"
                      >
                        <Replace size={10} /> Replace
                      </button>
                    }
                  >
                    Start frame
                  </SectionLabel>
                  <div className="mt-2">{startTile}</div>
                  {importRow}
                  {inboxRow}
                  {importError}
                  {surface.sections.endFrame.state === "locked" && !directorOn && !retake && !refsOn && (
                    <p className="mt-1.5 text-2xs leading-relaxed text-fog">
                      End frame — {surface.sections.endFrame.reason}
                    </p>
                  )}
                </>
              )}
              {t2vSwitch}
              {refsOn && (
                <p className="mt-1.5 text-2xs leading-relaxed text-gold/75">
                  Not used by a reference shot — ref2va conditions on the references below, not on a
                  keyframe. If this frame belongs in the shot, add it as a reference still.
                </p>
              )}

          {/* mid-shot keyframes — the simple path's guide frames, without the
              full Director timeline */}
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
            </section>
          );
        })()}

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
              /* a marked window takes the whole section over: nothing else on the
               * timeline reaches a retake render */
              <div className="mt-2 space-y-2">
                <div className="rounded-xl border border-gold/30 bg-gold/6 px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    <Scissors size={11} className="shrink-0 text-gold/80" />
                    <span className="min-w-0 flex-1 truncate text-xs text-cream/90">
                      {retake.label}
                    </span>
                    <button
                      title="Cancel the retake"
                      onClick={() => setRetake(null)}
                      className="shrink-0 text-fog transition hover:text-red-400"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <div className="mt-1 text-2xs tabular-nums text-gold">
                    {fmtTime(retake.atSec)} → {fmtTime(retake.atSec + retake.lengthSec)} ·{" "}
                    {fmtTime(retake.lengthSec)} re-rendered
                  </div>
                </div>

                <textarea
                  value={retake.prompt}
                  onChange={(e) => setRetake({ ...retake, prompt: e.target.value })}
                  rows={3}
                  placeholder="What should happen in that window instead…"
                  className="w-full resize-none rounded-xl border border-cream/10 bg-surface p-2.5 text-xs leading-relaxed text-cream placeholder:text-fog focus:border-gold/40 focus:outline-none"
                />

                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-2xs text-fog">Freedom</span>
                  <input
                    type="range"
                    min={0.3}
                    max={1}
                    step={0.05}
                    value={retake.strength}
                    title={`How far from the original the window may go (${retake.strength.toFixed(2)})`}
                    onChange={(e) => setRetake({ ...retake, strength: Number(e.target.value) })}
                    className="min-w-0 flex-1 accent-gold"
                  />
                  <span className="w-7 shrink-0 text-right text-2xs tabular-nums text-gold">
                    {retake.strength.toFixed(2)}
                  </span>
                </div>

                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={retake.regenerateAudio}
                    onChange={(e) => setRetake({ ...retake, regenerateAudio: e.target.checked })}
                    className="accent-gold"
                  />
                  <span className="text-2xs text-fog">Re-render the sound too</span>
                </label>

                <p className="text-2xs leading-relaxed text-fog">
                  {retake.lengthSec < MIN_RETAKE_SEC
                    ? "Mark at least a third of a second — a shorter window rounds away and the take comes back unchanged."
                    : retake.regenerateAudio
                      ? "LTX rewrites the window's audio as well — expect invented speech if the original had a line there."
                      : "The original audio, length and framing are kept; only the picture inside the window is re-rendered."}
                </p>
              </div>
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
            step={nextStep(surface.sections.camera.state)}
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

          <DisclosureRow
            step={nextStep()}
            title="Duration & Size"
            summary={sizeSummary}
            open={openRow === "size"}
            onToggle={() => toggleRow("size")}
          >
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1">
                {surface.durations.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDuration(d)}
                    className={cx(
                      "rounded-pill border px-2 py-0.5 text-2xs tabular-nums transition duration-[var(--dur-fast)]",
                      d === effectiveDuration
                        ? "border-gold/60 bg-gold/12 text-gold"
                        : "border-cream/10 text-cream/75 hover:border-cream/25",
                    )}
                  >
                    {parseInt(d)}s
                  </button>
                ))}
              </div>
              <select
                value={effectiveResolution}
                onChange={(e) => setResolution(e.target.value)}
                style={{ colorScheme: "dark" }}
                className={cx(selectInput, "w-full")}
              >
                {surface.resolutions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              {surface.sections.fps.state === "shown" && (
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
              )}

              {retake && (
                <p className="text-2xs leading-relaxed text-gold/75">
                  A retake follows the take it fixes — {retake.label} sets the length, frame rate and
                  size, so these don't apply.
                </p>
              )}
              {engineId === "seedance" && (
                <p className="text-2xs leading-relaxed text-fog">
                  {durationSec > 7 && durationSec !== 10
                    ? `Seedance only renders 5s or 10s — this queues as a 10-second clip. `
                    : ""}
                  ≈ ${seedanceEst} estimated on your fal.ai account.
                </p>
              )}
              {engineId === "minimax-h3" && durationSec < 4 && (
                <p className="text-2xs leading-relaxed text-gold/75">
                  H3 renders 4–15 second shots — pick 4s or longer, or switch to LTX-2.3 for this
                  beat.
                </p>
              )}
              {engineId === "minimax-h3" && durationSec > 15 && (
                <p className="text-2xs leading-relaxed text-gold/75">
                  Past 15s is outside H3's own window, so the shot is sampled in chunks: each one
                  hands its finished tail to the next through H3's reference channel, and a
                  planner rewrites the prompt in between. Mark the cuts —{" "}
                  <span className="text-cream/85">[Shot 1]</span> with no timestamp, then{" "}
                  <span className="text-cream/85">[Shot 2] At 00:10.000,</span> and so on,
                  increasing — so there is something to plan against. Expect the wait to scale
                  with the number of chunks, not with the seconds.
                  {refCount === 0 && (
                    <>
                      {" "}
                      <span className="text-gold">
                        It also needs at least one reference still to anchor on — that is the
                        same channel the handover uses. Add the opening frame as a reference.
                      </span>
                    </>
                  )}
                  {(minimaxRefs.videos.length > 0 || minimaxRefs.audios.length > 0) && (
                    <>
                      {" "}
                      <span className="text-gold">
                        Reference clips and sounds can't ride along on a chunked shot — the
                        planner rebuilds the references every chunk and can only rebuild stills.
                      </span>
                    </>
                  )}
                </p>
              )}
              {engineId !== "seedance" && durationSec > 10 && (
                <p className="text-2xs leading-relaxed text-gold/75">
                  Long clips scale VRAM and render time roughly linearly — drop the
                  resolution if a {durationSec}s take runs out of memory.
                </p>
              )}
              {vramStack && (
                <p className="text-2xs leading-relaxed text-amber-300">
                  48 fps at HD past 8 seconds stacks all three VRAM multipliers — expect this to
                  fail on a 24 GB card. Drop one of the three.
                </p>
              )}
            </div>
          </DisclosureRow>

          <DisclosureRow
            step={nextStep(surface.sections.quality.state)}
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
            step={nextStep(surface.sections.adapters.state)}
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
            step={nextStep(surface.sections.dialogue.state)}
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
            step={nextStep(
              retake || directorOn ? "hidden" : surface.sections.references.state,
            )}
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
      </div>

      <div className="space-y-2 p-4 pt-2">
        <GoldButton
          onClick={generate}
          className={cx(
            "w-full justify-center gap-2.5 rounded-xl py-3.5 font-serif text-[15px] font-medium uppercase tracking-[0.22em]",
            (lab.busy ||
              !prompt.trim() ||
              (retake ? !retakeReady || retake.lengthSec < MIN_RETAKE_SEC : !canGenerate)) &&
              "pointer-events-none opacity-50",
          )}
        >
          {retake ? <Scissors size={14} /> : <Sparkles size={14} />}{" "}
          {lab.busy
            ? "Generating…"
            : retake
              ? retake.prompt.trim()
                ? `Re-render ${fmtTime(retake.lengthSec)}`
                : "Describe the fix"
              : canGenerate
                ? "Generate"
                : "Needs a start frame"}
        </GoldButton>
        {/* the same shot, several recipes — the only honest way to answer
            "is this recipe actually faster/better" (upgrade plan §5.1) */}
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
        {lab.error && (
          <p className="rounded-lg border border-red-500/25 bg-red-500/8 px-2.5 py-1.5 text-2xs leading-relaxed text-red-300">
            {lab.error}
          </p>
        )}
        {lab.failures.slice(0, 1).map((f) => (
          <div
            key={f.id}
            className="rounded-lg border border-red-500/25 bg-red-500/8 px-2.5 py-1.5"
          >
            <div className="flex items-center gap-1.5">
              <CircleAlert size={11} className="shrink-0 text-red-400" />
              <span className="min-w-0 flex-1 truncate text-2xs font-medium text-cream/90">
                {f.title} · {f.engine}
              </span>
              <button
                onClick={() => lab.retry(f.id)}
                className="shrink-0 text-2xs text-gold hover:underline"
              >
                Retry
              </button>
            </div>
            {/* ComfyUI's rejection message lists every model file it knows —
              * hundreds of lines. Unclamped it pushes the whole panel off
              * screen, so it scrolls inside the card instead. */}
            <p className="mt-1 max-h-20 overflow-y-auto text-2xs leading-relaxed text-red-300">
              {f.error}
            </p>
          </div>
        ))}
      </div>

      <AbModal
        open={abOpen}
        onClose={() => setAbOpen(false)}
        engineId={engineId}
        engines={lab.engines}
        resolutionsByEngine={lab.resolutionsByEngine}
        durations={surface.durations}
        disabled={!canGenerate || !prompt.trim()}
        queueing={ab.queueing}
        error={ab.error}
        onQueue={(input) => ab.queue({ ...input, base: payload })}
      />

      {picking !== null && (
        <FramePicker
          frames={lab.frames}
          mode={picking === "start" ? "start" : picking === "end" ? "end" : "keyframe"}
          selectedRel={
            picking === "start"
              ? effectiveRel
              : picking === "end"
                ? (endFrameRel ?? undefined)
                : picking.lane === "director"
                  ? keyframes[picking.i]?.image
                  : simpleKeyframes[picking.i]?.image
          }
          onPick={(rel) => {
            if (picking === "start") setFrameRel(rel);
            else if (picking === "end") setEndFrameRel(rel);
            else if (picking.lane === "director") {
              setKeyframes((ks) => ks.map((k, j) => (j === picking.i ? { ...k, image: rel } : k)));
            } else {
              setSimpleKeyframes((ks) =>
                ks.map((k, j) => (j === picking.i ? { ...k, image: rel } : k)),
              );
            }
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
          importing={lab.importingStill}
          onImport={(files) => {
            void importStillInto(files, picking).then(() => setPicking(null));
          }}
        />
      )}
    </aside>
  );
}
