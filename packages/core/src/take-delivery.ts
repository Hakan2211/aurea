/* Delivery-time take verification (P3.1 + P3.2). Runs right after
 * StudioStore.attachTake from the job-completion import hook, and on demand
 * from studio.production.verifyTake.
 *
 *   measure → judge → (silent, no lines, roomTone: auto, location has a bed)
 *           → lay the bed → record on the take
 *
 * The bed is a fallback for LTX 2.5's digital silence on no-dialogue shots
 * (rule silence-25). A take that is silent UNDER placed lines is broken, not
 * bedded — that is the LoadAudio-pointed-at-a-PNG class of failure and it has
 * to show red. */

import fs from "node:fs";
import path from "node:path";
import type { TakeVerify } from "@aurea/shared";
import type { SettingsStore } from "./settings.js";
import type { StudioStore } from "./studio.js";
import { bedRoomTone, judgeTake, measureTake, verifyRecord, type TakeExpectation } from "./take-verify.js";

export interface TakeDeliveryDeps {
  studio: StudioStore;
  settings: SettingsStore;
}

export interface VerifyTakeResult {
  verify: TakeVerify;
  /** library relPath the take now points at (changes when a bed was laid) */
  asset: string;
  notes: string[];
}

export async function verifyDeliveredTake(
  deps: TakeDeliveryDeps,
  project: string,
  shotId: string,
  takeId: string,
  expect: TakeExpectation,
): Promise<VerifyTakeResult> {
  const { shot } = deps.studio.getShotContext(project, shotId);
  const take = shot.videoTakes.find((t) => t.id === takeId);
  if (!take) throw new Error(`unknown take "${takeId}" on shot "${shotId}"`);
  const dataRoot = deps.settings.get().storage.dataRoot;
  const notes: string[] = [];
  let asset = take.asset;
  const file = path.join(dataRoot, asset);
  if (!fs.existsSync(file)) {
    const verify: TakeVerify = {
      status: "broken",
      reasons: [`take file missing on disk: ${asset}`],
      checkedAt: new Date().toISOString(),
    };
    deps.studio.recordTakeVerify(project, shotId, takeId, verify);
    return { verify, asset, notes };
  }

  const m = await measureTake(file);
  const j = judgeTake(m, expect);

  /* room tone: only a take that is silent for the RIGHT reason gets a bed —
   * and never a preview (P5), which is thrown away after the blocking check */
  let roomTone: string | undefined;
  if (j.silent && !expect.expectAudio && j.status === "ok" && !expect.preview) {
    const bible = deps.studio.getBible(project);
    const location = shot.location ? bible.locations.find((l) => l.id === shot.location) : undefined;
    if (bible.style.roomTone === "off") {
      notes.push("take is silent; room tone is off for this project (bible.style.roomTone)");
    } else if (!location) {
      notes.push("take is silent and the shot has no location — no room-tone bed to lay");
    } else if (!location.roomTone) {
      notes.push(`take is silent and "${location.name}" has no room-tone bed yet — seed one in the Bible`);
    } else {
      const bed = path.join(dataRoot, location.roomTone);
      if (!fs.existsSync(bed)) {
        notes.push(`take is silent but the room-tone bed for "${location.name}" is missing on disk: ${location.roomTone}`);
      } else {
        try {
          const out = await bedRoomTone(file, bed);
          asset = path.relative(dataRoot, out).split(path.sep).join("/");
          roomTone = location.roomTone;
          notes.push(`room tone for "${location.name}" laid under the take at −40 dB`);
        } catch (err) {
          notes.push(`room-tone bed failed: ${String((err as Error).message)}`);
        }
      }
    }
  }

  const verify = verifyRecord(m, j, roomTone);
  deps.studio.recordTakeVerify(project, shotId, takeId, verify, asset !== take.asset ? { asset } : {});
  return { verify, asset, notes };
}

/** what the render was asked for, read off the video job payload */
export function expectationOf(payload: {
  audio?: string;
  director?: { audio?: unknown[]; inpaintAudio?: boolean };
  durationSec?: number;
  board?: { preview?: boolean };
}): TakeExpectation {
  return {
    expectAudio: !!payload.audio || (payload.director?.audio?.length ?? 0) > 0 || !!payload.director?.inpaintAudio,
    requestedDurationSec: payload.durationSec ?? null,
    preview: !!payload.board?.preview,
  };
}
