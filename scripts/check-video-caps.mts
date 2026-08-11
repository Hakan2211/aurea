/* What does the video lab think it can do right now? Prints the capability
 * probe the Shot Director toggle is gated on, against the running app.
 *
 * Run: npx tsx scripts/check-video-caps.mts
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { createStudiodApi } = await import("../packages/core/src/tools.js");

const pf = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".aurea", "studiod.json"), "utf8"),
) as { port: number; token: string };
const api = createStudiodApi(pf.port, pf.token);

const caps = await api.labs.video.capabilities.query();
const flag = (name: string, v: boolean) => `  ${v ? "yes" : "NO "}  ${name}`;
console.log(`mode: ${caps.mode}   reachable: ${caps.reachable}`);
console.log(flag("director (Shot Director timeline)", caps.director));
console.log(flag("perfPatches", caps.perfPatches));
console.log(flag("nag", caps.nag));
console.log(flag("endFrame / keyframe guides", caps.endFrame));
console.log(flag("multiRef (cast references)", caps.multiRef));
console.log(flag("icLora (motion transfer)", caps.icLora));
console.log(`  loras: ${caps.availableLoras.length}, camera: ${Object.keys(caps.cameraLoras).length}`);
console.log(`note: ${caps.note ?? "(none)"}`);
console.log(`minimax: reachable=${caps.minimax.reachable} ${caps.minimax.note ?? ""}`);
