/* Storyboard → Shot Director, studiod side.
 *
 * `composeShotSpec` (shared) is pure — it turns a boarded shot into a Director
 * timeline but can't know two things: how long each voice take actually runs,
 * and whether the ComfyUI this machine points at can render cast references.
 * Both live here, so the Storyboard screen and the `shot_from_storyboard` tool
 * get an identical, renderable spec from a shot id alone.
 *
 * Since the lane work (upgrade plan §2-3) this is also where a shot picks its
 * COMPOSER. There are four, because the engines do not share a control
 * surface: the LTX Director timeline (beats + an audio lane), MiniMax-H3's
 * block prompt (no timeline exists — the prompt is the whole surface), LTX 2.5
 * multi-shot prose (one paragraph that cuts, which a beat timeline would
 * fight), and the LTX 2.5 ia2v single (a motion-only prompt over a locked
 * still, with the audio lane flattened into one bed — 2.5 has no Director node
 * pack and no audio lane, so a single composed the classic way hard-errors in
 * the adapter before it reaches the GPU). The lane says which; the caller may
 * override it. */

import fs from "node:fs";
import path from "node:path";
import {
  applyCraftRules,
  cameraMoveToLora,
  composeH3Shot,
  shotLocation,
  composeIa2vShot,
  composeMultiShotProse,
  composeShotSpec,
  isMultiShotProse,
  projectLook,
  type ComposedShot,
  type ShotCompose,
  type ShotTakeInput,
  type JobPayload,
  type VideoPreset,
} from "@aurea/shared";
import { probeMedia } from "./adapters/ffmpeg-export.js";
import { buildVoiceBed } from "./voice-bed.js";
import type { Labs } from "./labs.js";
import type { PromptLibrary } from "./promptlib.js";
import type { SettingsStore } from "./settings.js";
import type { StudioStore } from "./studio.js";

type VideoPayload = Extract<JobPayload, { type: "video" }>;

export interface ComposedShotResult extends ComposedShot {
  shotId: string;
  /** exactly what labs.video.generate takes — compose once, render anywhere */
  videoInput: Omit<VideoPayload, "type">;
  /** the lane this was composed in, if any */
  preset?: string;
  /** craft-rule ids that fired (see shared/craftRules.ts); the notes say what each did */
  rulesFired: string[];
}

export interface ShotComposeDeps {
  studio: StudioStore;
  settings: SettingsStore;
  labs: Labs;
  /** render lanes; optional so older callers (and tests) keep working */
  prompts?: PromptLibrary;
}

/** Voice takes for a shot: the caller's list when it named one (the Director
 * has just generated them and knows which line each belongs to), otherwise the
 * shot's own voTakes in the order they were recorded. Each is measured — an
 * unmeasurable file is dropped with a note rather than laid down at a guessed
 * length, because the beat boundaries are cut to these numbers. */
async function measureTakes(
  asked: ShotCompose["takes"],
  voTakes: Array<{ asset: string; label: string; lineId?: string | null }>,
  dataRoot: string,
  notes: string[],
): Promise<ShotTakeInput[]> {
  const list =
    asked && asked.length > 0
      ? asked.map((t) => ({ take: t.take, character: t.character ?? null, lineId: t.lineId ?? null, atSec: t.atSec }))
      : voTakes.map((t) => ({
          take: t.asset,
          character: null as string | null,
          /* a table-read take records the line it voices — that binding is
           * exact, where "next open line" put a one-liner on the shot's long
           * speech (Milo confessional, 2026-11-10) */
          lineId: t.lineId ?? null,
          atSec: undefined as number | undefined,
        }));

  const measured: ShotTakeInput[] = [];
  for (const t of list) {
    const file = path.join(dataRoot, t.take);
    if (!fs.existsSync(file)) {
      notes.push(`Voice take not found: ${t.take} — left off the audio lane.`);
      continue;
    }
    const probe = await probeMedia(file).catch(() => null);
    if (!probe?.duration) {
      notes.push(`Could not measure ${t.take} — left off the audio lane.`);
      continue;
    }
    measured.push({ ...t, durationSec: Math.round(probe.duration * 100) / 100 });
  }
  return measured;
}

/** The lane's payload fields, laid into a video input. Only what the lane
 * actually names — a lane that says nothing about fps must not pin it. */
function laneFields(preset: VideoPreset | null): Partial<Omit<VideoPayload, "type">> {
  if (!preset) return {};
  const p = preset.payload;
  return {
    ...(p.resolution ? { resolution: p.resolution } : {}),
    ...(p.fps ? { fps: p.fps } : {}),
    ...(p.fast !== undefined ? { fast: p.fast } : {}),
    ...(p.enhance !== undefined ? { enhance: p.enhance } : {}),
    ...(p.minimaxTier ? { minimaxTier: p.minimaxTier } : {}),
    ...(p.loras?.length ? { loras: p.loras } : {}),
    ...(p.motionStrength !== undefined ? { motionStrength: p.motionStrength } : {}),
  };
}

export async function composeShotFromBoard(
  deps: ShotComposeDeps,
  input: ShotCompose,
): Promise<ComposedShotResult> {
  const { shot, scene } = deps.studio.getShotContext(input.project, input.shotId);
  const bible = deps.studio.getBible(input.project);
  const dataRoot = deps.settings.get().storage.dataRoot;
  const notes: string[] = [];

  const takes = await measureTakes(input.takes ?? [], shot.voTakes, dataRoot, notes);

  /* The lane. A named lane that doesn't exist is a typo worth hearing about —
   * silently composing the default would render the wrong shape for ten
   * minutes and look like the lane simply did nothing. */
  let preset: VideoPreset | null = null;
  if (input.preset) {
    preset = deps.prompts?.videoPresets(input.project).find((p) => p.id === input.preset) ?? null;
    if (!preset) notes.push(`No render lane "${input.preset}" — composed with the defaults instead.`);
  }
  const engine = input.engine ?? preset?.payload.engine ?? "ltx2";
  const durationSec = input.durationSec ?? preset?.payload.durationSec;
  /* A lane may carry its own look (a night lane grades differently); otherwise
   * the project's own, which composeShotSpec would have derived anyway. */
  const look = preset?.look ?? projectLook(bible);
  const camera = preset?.cine;

  /* Cast references are gated on the engine, not on taste: the adapter refuses
   * a shot that asks for a sheet the ComfyUI can't render, so composing one
   * would hand back a spec that fails at queue time. An explicit `refs` wins —
   * a caller who says no wants the start frame to carry the shot. */
  const caps = await deps.labs.videoCapabilities().catch(() => null);
  let refs = input.refs;
  if (refs === undefined) {
    refs = caps?.multiRef ?? false;
    if (caps && !caps.multiRef && caps.reachable && shot.characters.length > 1) {
      notes.push(caps.note ?? "This ComfyUI can't render cast references.");
    }
  }

  /* The bank's camera move doubles as a camera-control LoRA when this install
   * actually has the weight. The prose clause stays in the prompt either way —
   * the LoRA steers, the prompt describes. */
  const moveId = shot.camera.move || camera?.move || "";
  const loraMove = moveId ? cameraMoveToLora(moveId) : null;
  /* …on 2.3 only. The weights are 2.3-trained and the 2.5 adapter refuses a
   * payload that carries one, so on a 2.5 lane the move stays prose — which
   * the multi-shot pilot and the ia2v single both write into the prompt. */
  const lora25 = engine === "ltx25";
  const cameraLora =
    !lora25 && loraMove && caps?.cameraLoras?.[loraMove]
      ? { move: loraMove, strength: preset?.payload.cameraLora?.strength ?? 1 }
      : undefined;
  if (cameraLora) {
    notes.push(
      `Camera move "${moveId}" also rides the ${loraMove} camera-control LoRA on this install.`,
    );
  }

  const lane = laneFields(preset);
  const cine = camera ? { ...camera, ...nonEmptyCamera(shot.camera) } : undefined;

  const location = shotLocation(shot, scene, bible);
  const hasDialogue = shot.scriptLines.some((l) => l.character !== null && l.text.trim());

  /* ---- MiniMax-H3: the block prompt, no timeline ---------------------- */
  if (engine === "minimax-h3") {
    const h3 = composeH3Shot(shot, scene, bible, { durationSec, takes, camera, look });
    notes.push(
      "H3 performs the dialogue itself — the voice takes are timing, not audio; nothing is mixed in.",
    );
    const craft = applyCraftRules({
      prompt: h3.prompt,
      mode: "h3",
      engine,
      durationSec: h3.durationSec,
      hasDialogue,
      hasAudio: false,
      camera: cine,
      shot,
      bible,
      location,
    });
    return {
      prompt: craft.prompt,
      startFrame: h3.startFrame,
      durationSec: h3.durationSec,
      notes: [...notes, ...h3.notes, ...craft.notes],
      rulesFired: craft.rulesFired,
      shotId: shot.id,
      preset: preset?.id,
      // H3 has no Director surface; the spec is carried so the result shape
      // stays one thing, and `videoInput.director` is deliberately absent
      director: bareSpec(craft.prompt, h3.startFrame, bible),
      videoInput: {
        prompt: craft.prompt,
        engine,
        startFrame: h3.startFrame ?? undefined,
        durationSec: h3.durationSec,
        resolution: "1344 × 768 (16:9 · native)",
        fps: 24 as const,
        fast: false,
        minimaxTier: "draft" as const,
        keyframes: [],
        loras: [],
        cine,
        ...lane,
        board: { shotId: shot.id },
      },
    };
  }

  /* ---- LTX 2.5 multi-shot: one paragraph that cuts -------------------- */
  const multiShot = input.multiShot ?? preset?.rules.multiShot ?? false;
  if (multiShot) {
    const prose = composeMultiShotProse(shot, scene, bible, { durationSec, takes, camera, look });
    // multi-shot prose is a 2.5 form; an ltx2 lane is promoted, and the
    // promotion takes the camera LoRA with it (2.5 refuses one)
    const proseEngine = engine === "ltx2" ? "ltx25" : engine;
    const craft = applyCraftRules({
      prompt: prose.prompt,
      mode: "multi-shot",
      engine: proseEngine,
      durationSec: prose.durationSec,
      hasDialogue,
      hasAudio: false,
      enhance: lane.enhance,
      cameraLora: proseEngine === "ltx25" ? undefined : cameraLora,
      camera: cine,
      shot,
      bible,
      location,
    });
    return {
      prompt: craft.prompt,
      startFrame: prose.startFrame,
      durationSec: prose.durationSec,
      notes: [...notes, ...prose.warnings, ...prose.notes, ...craft.notes],
      rulesFired: craft.rulesFired,
      shotId: shot.id,
      preset: preset?.id,
      director: bareSpec(craft.prompt, prose.startFrame, bible),
      videoInput: {
        prompt: craft.prompt,
        engine: proseEngine,
        startFrame: prose.startFrame ?? undefined,
        durationSec: prose.durationSec,
        resolution: "1280 × 704 (16:9)",
        fps: 24 as const,
        fast: false,
        keyframes: [],
        loras: [],
        cameraLora: proseEngine === "ltx25" || craft.dropCameraLora ? undefined : cameraLora,
        cine,
        ...lane,
        // never negotiable: the enhancer flattens the cuts and drops lines
        // (rule enhance-off-multishot says so in the notes)
        enhance: false,
        board: { shotId: shot.id },
      },
    };
  }

  /* ---- LTX 2.5 single: motion over a locked still ---------------------
   * The documentary spine. 2.5 refuses both of the classic path's outputs —
   * the Director timeline (its node pack is 2.3-only) and the camera LoRA
   * (trained on 2.3) — so `zoo-interview-single` could never render until
   * this composer existed (pilot defect #6, 2026-09-02). What it emits is a
   * plain ia2v payload: the board as the start frame, one flattened voice bed
   * as the audio, and a prompt that describes ONLY motion. */
  if (engine === "ltx25") {
    /* The lane's length is for a shot nobody has recorded yet. Once there are
     * takes, the AUDIO decides: lead-in + lines + a short tail. An 8 s lane
     * around a 1.8 s line left 5 s of silence for the model to fill with a
     * talking mouth (Milo confessional, 2026-11-10). An explicit duration
     * from the caller still wins. */
    const singleDuration = takes.length && input.durationSec === undefined ? undefined : durationSec;
    if (singleDuration === undefined && takes.length && preset?.payload.durationSec) {
      notes.push(
        `Length follows the recorded audio, not the lane's ${preset.payload.durationSec}s — pass durationSec to hold the shot longer.`,
      );
    }
    const single = composeIa2vShot(shot, scene, bible, { durationSec: singleDuration, takes, camera });
    const placed = single.planned
      .filter((p) => p.takeIndex !== -1)
      .map((p) => ({ take: takes[p.takeIndex].take, atSec: p.atSec }));
    const bed = await buildVoiceBed(dataRoot, placed, single.durationSec);
    if (bed) {
      notes.push(
        placed.length > 1
          ? `${placed.length} takes flattened into one voice bed — 2.5's ia2v arm lip-syncs to a single file, so the lane is rendered down before the render.`
          : "The take drives the render directly (ia2v): 2.5 lip-syncs the picture to it.",
      );
    } else {
      notes.push(
        "No voice takes on this shot — 2.5 will score it itself. Table-read the lines first if the shot is meant to be lip-synced.",
      );
    }
    /* the ia2v composer already ran the table; this pass only sees what the
     * lane adds (an enhancer turned off on a single, say) */
    const laneCraft = applyCraftRules({
      prompt: single.prompt,
      mode: "i2v-single",
      engine,
      durationSec: single.durationSec,
      hasDialogue,
      hasAudio: Boolean(bed),
      enhance: lane.enhance,
      camera: cine,
      shot,
      bible,
      location,
    });
    const laneOnly = laneCraft.rulesFired.filter((id) => !single.rulesFired.includes(id));
    return {
      prompt: single.prompt,
      startFrame: single.startFrame,
      durationSec: single.durationSec,
      notes: [
        ...notes,
        ...single.notes,
        ...laneCraft.notes.filter((n) => laneOnly.some((id) => n.startsWith(`Rule ${id}`))),
      ],
      rulesFired: [...single.rulesFired, ...laneOnly],
      shotId: shot.id,
      preset: preset?.id,
      /* Never rendered (`videoInput.director` is absent — 2.5 has no Director
       * node pack), but qc.shot reads the audio lane off it to find the speech
       * windows the articulation check measures. The bed is one file; the
       * WINDOWS are what QC needs, so the placed takes go here. */
      director: {
        ...bareSpec(single.prompt, single.startFrame, bible),
        audio: placed.map((p) => ({ take: p.take, atSec: p.atSec, trimStartSec: 0 })),
      },
      videoInput: {
        prompt: single.prompt,
        engine,
        startFrame: single.startFrame ?? undefined,
        audio: bed ?? undefined,
        durationSec: single.durationSec,
        resolution: "1280 × 704 (16:9)",
        fps: 24 as const,
        fast: false,
        keyframes: [],
        loras: [],
        // deliberately no cameraLora and no director: the 2.5 adapter refuses
        // both, and the move is written into the motion prompt instead
        cine,
        ...lane,
        board: { shotId: shot.id },
      },
    };
  }

  /* ---- the Director timeline (the classic path) ----------------------- */
  const composed = composeShotSpec(shot, scene, bible, {
    durationSec,
    takes,
    gapSec: input.gapSec,
    leadInSec: input.leadInSec,
    prompt: input.prompt,
    refs,
    look,
    camera,
  });

  const prose = isMultiShotProse(composed.prompt);
  const craft = applyCraftRules({
    prompt: composed.prompt,
    mode: prose ? "multi-shot" : "director",
    engine,
    durationSec: composed.durationSec,
    hasDialogue,
    hasAudio: composed.director.audio.length > 0,
    // a prompt written as multi-shot prose must reach the encoder verbatim:
    // the Gemma enhancer rewrites away the cut structure and drops lines
    // (MULTI-SHOT-PODCAST-PILOT.md). Everything else keeps the default.
    enhance: prose ? false : lane.enhance,
    cameraLora,
    director: composed.director,
    camera: cine,
    shot,
    bible,
    location,
  });
  const director = craft.dropDirector
    ? undefined
    : { ...composed.director, globalPrompt: craft.prompt };

  return {
    ...composed,
    prompt: craft.prompt,
    director: director ?? composed.director,
    shotId: shot.id,
    preset: preset?.id,
    notes: [...notes, ...composed.notes, ...craft.notes],
    rulesFired: craft.rulesFired,
    videoInput: {
      prompt: craft.prompt,
      engine,
      startFrame: composed.startFrame ?? undefined,
      durationSec: composed.durationSec,
      resolution: "896 × 704 (landscape)",
      fps: 24 as const,
      fast: false,
      keyframes: [],
      loras: [],
      cameraLora: craft.dropCameraLora ? undefined : cameraLora,
      cine,
      director,
      ...lane,
      enhance: prose ? false : craft.enhance,
      board: { shotId: shot.id },
    },
  };
}

/** drop the empty fields of a camera spec so a lane's value shows through */
function nonEmptyCamera(camera: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(camera).filter(([, v]) => v.trim()));
}

/** A Director spec for engines that have no Director. It is never rendered —
 * `videoInput.director` is omitted on those paths — but the composed result is
 * one shape for every caller, and a preview that showed an empty object where
 * the prompt should be would read as a failure. */
function bareSpec(
  prompt: string,
  startFrame: string | null,
  bible: { style: { negativePrompt: string } },
): ComposedShot["director"] {
  return {
    globalPrompt: prompt,
    negativePrompt: bible.style.negativePrompt.trim() || undefined,
    fps: 24,
    keyframes: startFrame ? [{ image: startFrame, atSec: 0, strength: 1 }] : [],
    promptZones: [],
    audio: [],
    refs: [],
    refStrength: 1,
    inpaintAudio: false,
    epsilon: 0.001,
  };
}
