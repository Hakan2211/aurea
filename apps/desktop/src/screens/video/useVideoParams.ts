import { useEffect, useState } from "react";
import {
  composeCineClause,
  composeFreeform,
  composeZonePrompt,
  resolveLoraByFile,
  withLook,
  type CameraSpec,
  type DirectorRef,
  type MinimaxRefs,
  type VideoGenerate,
  type VideoPreset,
} from "@aurea/shared";
import { useVideoAb, useVideoLab, useVideoPresets } from "@/hooks";
import { useEnhanceControl } from "@/screens/image/EnhanceButton";
import { useActivePromptProject } from "@/screens/image/promptHooks";
import { fileToPngBase64 } from "@/components/imageFile";
import { computeEngineSurface, type CameraMove, type EngineSurface } from "./engineSurface";
import {
  MIN_BEAT_SEC,
  MIN_RETAKE_SEC,
  clampSec,
  snapDuration,
  type DirectorBeat,
  type DirectorKeyframe,
  type DirectorMotion,
  type DirectorTake,
  type RetakeDraft,
  type ShotPrefill,
} from "./shared";

/* Everything a Video render IS, with no layout: the state behind every
 * control, the engine surface, the gating rules and the one payload Generate,
 * A/B and the seed spray all send. Moved here verbatim from the old 2,400-line
 * ParamsPanel (UI simplify plan, Stage 2) so the composer and the Advanced
 * drawer can sit in different places on screen while reading ONE state — and
 * so a job rendered from the new layout is the job the old one sent. */

/** which frame a click on the picker is retargeting */
export type Picking =
  | "start"
  | "end"
  | { lane: "director" | "simple"; i: number }
  | null;

export function useVideoParams({
  prefill,
  retake,
  setRetake,
  engineId,
  setEngineId,
}: {
  /** a shot sent over from the Storyboard; the workbench is keyed on it, so
   * every piece of state below can seed from it in its initializer */
  prefill: ShotPrefill | null;
  retake: RetakeDraft | null;
  setRetake: (r: RetakeDraft | null) => void;
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

  /* What the Advanced drawer has changed from a plain run, read off what the
   * payload will actually carry — a control the engine ignores doesn't count.
   * The composer shows the count so nothing is ever hidden silently. */
  const customs: string[] = [];
  if (presetId) customs.push(`Preset: ${presets.find((p) => p.id === presetId)?.label ?? presetId}`);
  if (endFrameShown && endFrameRel && !loopOn) customs.push("End frame");
  if (loopOn) customs.push("Loop");
  if (payload.keyframes?.length) customs.push(`${payload.keyframes.length} mid-shot keyframe${payload.keyframes.length === 1 ? "" : "s"}`);
  if (payload.director && !retake) customs.push("Shot Director");
  if (payload.cameraLora) customs.push(`Camera LoRA: ${payload.cameraLora.move}`);
  if (surface.sections.quality.state === "shown" && effectiveQuality !== "final")
    customs.push(effectiveQuality === "draft" ? "Draft quality" : "Standard quality");
  if (payload.fps === 48) customs.push("48 fps");
  if (payload.enhance === false) customs.push("Prompt enhancer off");
  if (payload.loras?.length) customs.push(`${payload.loras.length} adapter LoRA${payload.loras.length === 1 ? "" : "s"}`);
  if (payload.audio) customs.push("Voice take (lip-sync)");
  if (payload.minimaxRefs) customs.push(`${refCount} reference${refCount === 1 ? "" : "s"}`);
  if (payload.cine) customs.push("Shot picks");
  if (payload.negativePrompt && !presetId) customs.push("Negative prompt");
  if (motion !== lab.motionStrength) customs.push(`Motion ${motion.toFixed(2)}`);

  return {
    prefill, retake, setRetake, engineId, setEngineId,
    lab, ab, presets, abOpen, setAbOpen,
    prompt, setPrompt, duration, setDuration, resolution, setResolution, motion, setMotion,
    frameRel, setFrameRel, picking, setPicking, noStartFrame, setNoStartFrame,
    endFrameRel, setEndFrameRel, loop, setLoop, simpleKeyframes, setSimpleKeyframes,
    minimaxRefs, setMinimaxRefs, importedRefs, refImportError, stillImportError,
    presetLook, negative, setNegative, directorOn, setDirectorOn, keyframes, setKeyframes,
    beats, setBeats, blend, setBlend, audioRel, setAudioRel, audioOpen, setAudioOpen,
    lane, setLane, roomTone, setRoomTone, motionRef, setMotionRef, castRefs, setCastRefs,
    refStrength, setRefStrength, fps, setFps, quality, setQuality, enhance, setEnhance,
    loras, setLoras, cameraMove, setCameraMove, cameraStrength, setCameraStrength,
    presetId, presetCustomised, cine, setCine, openRow, toggleRow, applyPreset, clearPreset,
    surface, isLtx, isMinimax, keyframesMax, lorasMax,
    chosen, effectiveRel, endFrame, frameName, frameMeta, frameSwatch, startFrameUrl,
    refCount, refsOn, t2vCapable, t2vOn, canGenerate, audioName,
    effectiveDuration, durationSec, effectiveResolution, effectiveQuality, enhancer25,
    minimaxHead, minimaxFormat, minimaxDistill, minimaxWeightLabel,
    directorBlocked, guidesOn, endFrameShown, loopOn,
    importRefImages, importStillInto, dropInto, insertTag,
    addBeat, addKeyframe, addSimpleKeyframe, tiling, retakeReady,
    cineClauseText, activeLook, composed, composerNotes, enhanceCtl,
    installedLoras, missingLoras, payload, generate,
    sizeSummary, soundSummary, adapterSummary, vramStack, seedanceSnapSec, seedanceEst,
    cameraMoves, customs,
  };
}

export type VideoParams = ReturnType<typeof useVideoParams>;
