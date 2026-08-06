import { useState } from "react";
import {
  ArrowLeftRight,
  AudioLines,
  ChevronDown,
  CircleAlert,
  Film,
  LayoutPanelTop,
  ListPlus,
  Lock,
  Maximize2,
  Replace,
  Scissors,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { composeZonePrompt, type DirectorRef, type MinimaxRefs } from "@aurea/shared";
import { useVideoLab } from "@/hooks";
import { fileToPngBase64 } from "@/components/imageFile";
import { GoldButton, SectionLabel, Segmented, Slider, cx } from "@/components/ui";
import { computeEngineSurface, type CameraMove, type EngineSurface } from "./engineSurface";
import { EnginePicker } from "./EnginePicker";
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
        <span className="text-[9px] leading-tight text-fog">{emptyLabel}</span>
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
          <span className="inline-flex items-center gap-1 rounded-pill bg-cream/95 px-2 py-0.5 text-[9px] font-medium text-ink">
            <Maximize2 size={9} /> Browse
          </span>
        </div>
        {(name || meta) && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/90 to-transparent px-1.5 pb-1 pt-4">
            {name && <div className="truncate text-[9px] leading-tight text-cream/90">{name}</div>}
            {meta && <div className="truncate text-[8px] leading-tight text-fog">{meta}</div>}
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
          {step != null && <span className="step-numeral !border-cream/15 !text-fog/60">{step}</span>}
          <span className="flex-1 text-xs font-medium uppercase tracking-[0.1em] text-cream/70">
            {title}
          </span>
          <Lock size={11} className="shrink-0 text-fog/60" />
        </div>
        {reason && <p className="mt-1 text-2xs leading-relaxed text-fog/70">{reason}</p>}
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
  /** LTX simple-path guide frames — mid-shot anchors on the way to the end
   * frame, without turning the full Director timeline on */
  const [simpleKeyframes, setSimpleKeyframes] = useState<DirectorKeyframe[]>([]);
  /** H3's OTHER head: things the shot must carry rather than a frame it starts
   * on. Non-empty switches the render to ref2va, which has no keyframes at all. */
  const [minimaxRefs, setMinimaxRefs] = useState<MinimaxRefs>({
    images: [],
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
  /** Draft skips the ×2 upscale + refine pass — half-size picture, fast */
  const [quality, setQuality] = useState<"draft" | "final">("final");
  /** stackable adapter LoRAs, from this install's own lora folder */
  const [loras, setLoras] = useState<{ name: string; strength: number }[]>([]);
  /** camera-control LoRA — hidden until 22b weights exist (see engineSurface) */
  const [cameraMove, setCameraMove] = useState<CameraMove | "">("");
  const [cameraStrength, setCameraStrength] = useState(1);
  /** the one open disclosure row — an accordion, so the column stays a column */
  const [openRow, setOpenRow] = useState<string | null>(null);
  const toggleRow = (id: string) => setOpenRow((o) => (o === id ? null : id));

  /* the engine's declared surface on THIS machine — every section below reads
   * its own visibility off this instead of switching on engineId */
  const surface: EngineSurface = computeEngineSurface(
    {
      durations: lab.durations,
      resolutions: lab.resolutions,
      resolutionsByEngine: lab.resolutionsByEngine,
      ltx: lab.ltx,
      minimaxRefsAvailable: lab.minimaxRefsAvailable,
    },
    lab.capabilities,
    engineId,
  );
  const isLtx = engineId === "ltx2";
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
  const t2vCapable = engineId === "seedance" || engineId === "ltx2" || engineId === "minimax-h3";
  const t2vOn = t2vCapable && noStartFrame && !retake && !directorOn && !refsOn;
  const canGenerate = "canGenerate" in lab ? refsOn || t2vOn || !!effectiveRel : false;
  const audioName = audioRel
    ? (lab.audioSources.find((a) => a.relPath === audioRel)?.name ?? audioRel)
    : null;
  const durationSec = parseInt(duration) || 5;
  /* An engine switch may leave the chosen preset off the new engine's canvas;
   * the payload always sends a legal one, and the select shows what will
   * actually render rather than a stale label. */
  const effectiveResolution = surface.resolutions.includes(resolution)
    ? resolution
    : (surface.resolutions[0] ?? resolution);
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

  const generate = () =>
    lab.generate({
      prompt,
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
          ? (endFrameRel ?? undefined)
          : guidesOn
            ? (endFrameRel ?? undefined)
            : undefined,
      // everything below this line is LTX-2.3 vocabulary — omitted (never
      // defaulted) for other engines, so their adapters see a clean payload
      keyframes:
        guidesOn && simpleKeyframes.length
          ? simpleKeyframes.slice(0, keyframesMax)
          : undefined,
      fps: isLtx && fps === 48 ? 48 : undefined,
      fast: isLtx && quality === "draft" ? true : undefined,
      loras:
        isLtx && surface.sections.adapters.state === "shown" && loras.some((l) => l.name)
          ? loras.filter((l) => l.name).slice(0, lorasMax)
          : undefined,
      cameraLora:
        isLtx && surface.sections.camera.state === "shown" && cameraMove
          ? { move: cameraMove, strength: cameraStrength }
          : undefined,
      minimaxRefs: refsOn ? minimaxRefs : undefined,
      // the lane owns dialogue once the Director is on: leaving the
      // simple field set would put a take back at 0s that the user may
      // have just taken off the lane
      audio: director || !isLtx ? undefined : (audioRel ?? undefined),
      director,
      // a shot sent over from the board delivers its take back to the
      // board; a retake is a fix for a clip, not a new take of a shot
      board: prefill && !retake ? { shotId: prefill.shotId } : undefined,
    });

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

  const cameraMoves = (lab.ltx?.cameraMoves ?? []).filter(
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
            <p className="mt-0.5 text-[9px] leading-relaxed text-fog/80">
              Beats, cast and the audio lane are composed below — edit anything. The finished take
              lands back on the shot.
            </p>
            {prefill.notes.map((n) => (
              <p key={n} className="mt-1.5 text-[9px] leading-relaxed text-gold/75">
                {n}
              </p>
            ))}
          </section>
        )}

        {/* 1 · engine — the choice that decides what the rest of the panel is */}
        <EnginePicker
          engines={lab.engines}
          value={engineId}
          onChange={setEngineId}
          note={lab.engineNotes[engineId]}
        />

        {/* 2 · prompt */}
        <section>
          <SectionLabel
            right={
              <button className="inline-flex items-center gap-1 rounded-pill bg-gold/12 px-2 py-0.5 text-2xs font-medium text-gold transition hover:bg-gold/20">
                <Wand2 size={10} /> Magic prompt
              </button>
            }
            step={2}
          >
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
            <span className="pointer-events-none absolute bottom-2 right-3 text-2xs tabular-nums text-fog/60">
              {prompt.length} / {lab.promptMax}
            </span>
          </div>
        </section>

        {/* 3 · frames — where the take starts, lands and passes through.
            The board pairs start and end side by side with a swap between
            them; when the engine has no end frame the start runs full width. */}
        {(() => {
          const endShown = endFrameShown;
          const startTile = (
            <FrameTile
              url={startFrameUrl}
              swatch={frameSwatch}
              name={frameName}
              meta={`${frameMeta}${!frameRel ? " · default" : ""}`}
              onPick={() => setPicking("start")}
            />
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
              <span className="text-2xs leading-relaxed text-fog/80">
                <span className="font-medium text-cream">No start frame</span> — render from the
                prompt alone. Nothing anchors identity, so the look is whatever the prompt
                describes; for an on-model character, board a frame first.
              </span>
            </label>
          );
          if (t2vOn) {
            return (
              <section>
                <SectionLabel step={3}>Start frame</SectionLabel>
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
                      disabled={!endFrameRel}
                      title="Swap the start and end frames"
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
                    <FrameTile
                      url={endFrame?.url}
                      swatch={endFrame?.swatch}
                      name={
                        endFrameRel
                          ? (endFrame?.name ?? (endFrameRel.split("/").pop() ?? endFrameRel))
                          : undefined
                      }
                      meta={endFrameRel ? "lands here" : undefined}
                      emptyLabel={endFrameRel ? undefined : "Pick a frame to land on"}
                      onPick={() => setPicking("end")}
                      onClear={endFrameRel ? () => setEndFrameRel(null) : undefined}
                    />
                  </div>
                  <p className="mt-1.5 text-2xs leading-relaxed text-fog/70">
                    {endFrameRel
                      ? engineId === "minimax-h3"
                        ? "fl2va — H3 has to arrive at this frame by the last beat."
                        : "LTX interpolates the whole way there, in one continuous take."
                      : engineId === "minimax-h3"
                        ? "Leave empty and H3 animates forward freely from the start frame."
                        : "End frames work on LTX now, not just MiniMax — the take is guided to land here."}
                  </p>
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
                  {surface.sections.endFrame.state === "locked" && !directorOn && !retake && !refsOn && (
                    <p className="mt-1.5 text-2xs leading-relaxed text-fog/60">
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
                      className="shrink-0 text-fog/60 transition hover:text-red-400"
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
                <p className="text-2xs leading-relaxed text-fog/70">
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
              <p className="mt-1.5 text-2xs leading-relaxed text-fog/70">
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
                      className="shrink-0 text-fog/60 transition hover:text-red-400"
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
                  className="w-full resize-none rounded-xl border border-cream/10 bg-surface p-2.5 text-xs leading-relaxed text-cream placeholder:text-fog/60 focus:border-gold/40 focus:outline-none"
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

                <p className="text-2xs leading-relaxed text-fog/70">
                  {retake.lengthSec < MIN_RETAKE_SEC
                    ? "Mark at least a third of a second — a shorter window rounds away and the take comes back unchanged."
                    : retake.regenerateAudio
                      ? "LTX rewrites the window's audio as well — expect invented speech if the original had a line there."
                      : "The original audio, length and framing are kept; only the picture inside the window is re-rendered."}
                </p>
              </div>
            ) : !directorOn ? (
              <p className="mt-1.5 text-2xs leading-relaxed text-fog/70">
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
                  <span className="shrink-0 text-[9px] uppercase tracking-wider text-fog/60">
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
                        className="shrink-0 text-fog/60 transition hover:text-red-400"
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
                <p className="text-2xs leading-relaxed text-fog/70">
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
                    <p className="mt-1.5 text-2xs leading-relaxed text-fog/70">
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
                              className="min-w-0 flex-1 rounded-md border border-cream/10 bg-ink px-2 py-1 text-xs text-cream outline-none placeholder:text-fog/60 focus:border-gold/40"
                            />
                            <button
                              onClick={() => setBeats((bs) => bs.filter((_, j) => j !== i))}
                              className="shrink-0 text-fog/60 transition hover:text-red-400"
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
                              <span className="text-2xs text-fog/70">s</span>
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
                        <p className="text-2xs leading-relaxed text-fog/70">
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
                        <p className="text-2xs leading-relaxed text-fog/70">
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
              <p className="text-2xs leading-relaxed text-fog/70">
                A trained camera move imposed as a LoRA — stronger and more repeatable than prose,
                for the moves this install has weights for.
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
                      d === duration
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
                  {fps === 48 && <span className="text-2xs text-fog/70">~2× time</span>}
                </div>
              )}

              {retake && (
                <p className="text-2xs leading-relaxed text-gold/75">
                  A retake follows the take it fixes — {retake.label} sets the length, frame rate and
                  size, so these don't apply.
                </p>
              )}
              {engineId === "seedance" && (
                <p className="text-2xs leading-relaxed text-fog/70">
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
                  Past 15s is outside what H3 was trained on — it will render, but quality is
                  untested and this is already the slow engine.
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
            summary={quality === "draft" ? "Draft — half-size, fast" : "Final"}
            state={surface.sections.quality.state}
            reason={surface.sections.quality.reason}
            open={openRow === "quality"}
            onToggle={() => toggleRow("quality")}
          >
            <div className="space-y-2">
              <Segmented
                value={quality}
                onChange={setQuality}
                options={[
                  { value: "draft", label: "Draft" },
                  { value: "final", label: "Final" },
                ]}
              />
              <p className="text-2xs leading-relaxed text-fog/70">
                {quality === "draft"
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
                      {(lab.capabilities?.availableLoras ?? []).map((name) => (
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
              <p className="text-2xs leading-relaxed text-fog/70">
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
              <p className="text-2xs leading-relaxed text-fog/70">
                A retake keeps the sound of the take it's fixing — nothing to attach here.
              </p>
            ) : directorOn ? (
              <p className="text-2xs leading-relaxed text-fog/70">
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
                        className="shrink-0 text-fog/60 transition hover:text-red-400"
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
                <p className="mt-1.5 text-2xs leading-relaxed text-fog/70">
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
        />
      )}
    </aside>
  );
}
