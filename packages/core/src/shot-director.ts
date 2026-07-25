/* Storyboard → Shot Director, studiod side.
 *
 * `composeShotSpec` (shared) is pure — it turns a boarded shot into a Director
 * timeline but can't know two things: how long each voice take actually runs,
 * and whether the ComfyUI this machine points at can render cast references.
 * Both live here, so the Storyboard screen and the `shot_from_storyboard` tool
 * get an identical, renderable spec from a shot id alone. */

import fs from "node:fs";
import path from "node:path";
import {
  composeShotSpec,
  type ComposedShot,
  type ShotCompose,
  type ShotTakeInput,
  type JobPayload,
} from "@aurea/shared";
import { probeMedia } from "./adapters/ffmpeg-export.js";
import type { Labs } from "./labs.js";
import type { SettingsStore } from "./settings.js";
import type { StudioStore } from "./studio.js";

type VideoPayload = Extract<JobPayload, { type: "video" }>;

export interface ComposedShotResult extends ComposedShot {
  shotId: string;
  /** exactly what labs.video.generate takes — compose once, render anywhere */
  videoInput: Omit<VideoPayload, "type">;
}

export interface ShotComposeDeps {
  studio: StudioStore;
  settings: SettingsStore;
  labs: Labs;
}

/** Voice takes for a shot: the caller's list when it named one (the Director
 * has just generated them and knows which line each belongs to), otherwise the
 * shot's own voTakes in the order they were recorded. Each is measured — an
 * unmeasurable file is dropped with a note rather than laid down at a guessed
 * length, because the beat boundaries are cut to these numbers. */
async function measureTakes(
  asked: ShotCompose["takes"],
  voTakes: Array<{ asset: string; label: string }>,
  dataRoot: string,
  notes: string[],
): Promise<ShotTakeInput[]> {
  const list =
    asked && asked.length > 0
      ? asked.map((t) => ({ take: t.take, character: t.character ?? null, atSec: t.atSec }))
      : voTakes.map((t) => ({
          take: t.asset,
          // a take recorded for a character usually says so in its name; the
          // label is free text, so this is a hint, not a contract — an unmatched
          // take simply falls on the next open line
          character: null as string | null,
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

export async function composeShotFromBoard(
  deps: ShotComposeDeps,
  input: ShotCompose,
): Promise<ComposedShotResult> {
  const { shot, scene } = deps.studio.getShotContext(input.project, input.shotId);
  const bible = deps.studio.getBible(input.project);
  const dataRoot = deps.settings.get().storage.dataRoot;
  const notes: string[] = [];

  const takes = await measureTakes(input.takes ?? [], shot.voTakes, dataRoot, notes);

  /* Cast references are gated on the engine, not on taste: the adapter refuses
   * a shot that asks for a sheet the ComfyUI can't render, so composing one
   * would hand back a spec that fails at queue time. An explicit `refs` wins —
   * a caller who says no wants the start frame to carry the shot. */
  let refs = input.refs;
  if (refs === undefined) {
    const caps = await deps.labs.videoCapabilities().catch(() => null);
    refs = caps?.multiRef ?? false;
    if (caps && !caps.multiRef && caps.reachable && shot.characters.length > 1) {
      notes.push(caps.note ?? "This ComfyUI can't render cast references.");
    }
  }

  const composed = composeShotSpec(shot, scene, bible, {
    durationSec: input.durationSec,
    takes,
    gapSec: input.gapSec,
    leadInSec: input.leadInSec,
    prompt: input.prompt,
    refs,
  });

  return {
    ...composed,
    shotId: shot.id,
    notes: [...notes, ...composed.notes],
    videoInput: {
      prompt: composed.prompt,
      engine: "ltx2",
      startFrame: composed.startFrame ?? undefined,
      durationSec: composed.durationSec,
      resolution: "896 × 704 (landscape)",
      director: composed.director,
      board: { shotId: shot.id },
    },
  };
}
