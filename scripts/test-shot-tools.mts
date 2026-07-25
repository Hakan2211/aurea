/* V7 — Director 2.0: the Shot Director as a tool surface.
 *
 * The milestone's claim is that an agent can shoot a boarded shot without a
 * human filling anything in: "take the boarded breakroom shot, make it 12
 * seconds, Sterling's line at 2s and Bruno's at 7s, push in on the punchline"
 * → a rendered mp4 attached back to the shot. So this harness drives the same
 * registry the Director chat and the MCP server drive (buildTools), through the
 * same zod parse the hosts do, rather than calling the router underneath it.
 *
 *   npx tsx scripts/test-shot-tools.mts            offline + compose + retake wiring
 *   npx tsx scripts/test-shot-tools.mts --render   …and the full ~7 min render
 *
 * Needs a running studiod (~/.aurea/studiod.json) and, for --render, the
 * ComfyUI the video engine points at. The shot it composes is created in the
 * playground project the first time and reused after. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { buildTools, createStudiodApi } from "../packages/core/src/tools.js";

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ok " : "FAIL "} ${name}${detail !== undefined ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const pf = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".aurea", "studiod.json"), "utf8"),
) as { port: number; token: string };
const api = createStudiodApi(pf.port, pf.token);
const tools = new Map(buildTools(api).map((t) => [t.name, t]));

/** what an MCP host does with a call: parse against the tool's schema, then run */
async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const tool = tools.get(name);
  if (!tool) throw new Error(`no tool "${name}"`);
  const parsed = z.object(tool.schema).parse(args);
  const result = await tool.handler(parsed as Record<string, unknown>);
  return JSON.parse(result.content[0].text);
}

/* ---- 1: offline — the surface itself ---- */
console.log("\n— the tool surface —");
for (const name of ["generate_shot", "shot_retake", "shot_from_storyboard"]) {
  check(`${name} is registered`, tools.has(name));
}

{
  const shape = z.object(tools.get("generate_shot")!.schema);
  check(
    "generate_shot insists on a timeline — that's the whole difference from generate_video",
    !shape.safeParse({ prompt: "a lion waits" }).success,
  );
  const ok = shape.parse({
    prompt: "a lion waits",
    director: { keyframes: [{ image: "a.png" }] },
  });
  check("…and fills the spec's defaults", ok.director.fps === 24 && ok.director.epsilon === 0.001);
  check("…landing in the playground project unless told otherwise", ok.project === "playground");
}

{
  const args = z.object(tools.get("shot_retake")!.schema).parse({
    source: "take.mp4",
    atSec: 3,
    lengthSec: 2,
    prompt: "his hand stays on the mug",
  });
  check(
    "shot_retake defaults to a full-strength picture fix that keeps the original sound",
    args.strength === 1 && args.regenerateAudio === false,
  );
}

{
  const args = z.object(tools.get("shot_from_storyboard")!.schema).parse({ shotId: "sh1" });
  check(
    "shot_from_storyboard needs nothing but a shot id",
    args.project === "playground" && args.dryRun === false && args.takes.length === 0,
  );
}

/* ---- 2: live — what the agent reads before it composes ---- */
console.log("\n— lab_catalog('video') —");
const catalog = await call("lab_catalog", { lab: "video" });
check("the catalog carries the Director's limits", catalog.director?.limits?.keyframes === 24, JSON.stringify(catalog.director?.limits));
check("…and the rules that cost a render to learn", (catalog.director?.rules ?? []).length >= 5);
check(
  "…and what this machine can actually run",
  catalog.director?.capabilities?.reachable === true,
  catalog.director?.capabilities?.note ?? JSON.stringify(catalog.director?.capabilities),
);
if (!catalog.director?.capabilities?.director) {
  console.log("\nComfyUI can't run Director shots — stopping here.");
  process.exit(1);
}

/* ---- 3: a boarded shot to shoot ---- */
console.log("\n— the boarded shot —");
const project = "playground";
const assets = (await api.library.list.query()).assets;
const find = (needle: string) => {
  const a = assets.find((x) => x.relPath.includes(needle));
  if (!a) throw new Error(`missing library asset: ${needle}`);
  return a.relPath;
};
const plate = find("breakroom-two-shot");
const sterlingLine = find("sterling-decaf-line");
const brunoLine = find("bruno-heart-line");

const TITLE = "V7 — the decaf confession";
const allShots = (prod: any) =>
  prod.seasons.flatMap((s: any) => s.episodes.flatMap((e: any) => e.scenes.flatMap((sc: any) => sc.shots)));

let shot = allShots(await api.studio.production.get.query({ project })).find(
  (s: any) => s.title === TITLE,
);
if (!shot) {
  const { episode } = await api.studio.production.addEpisode.mutate({
    project,
    title: "V7 acceptance",
    logline: "The Shot Director, driven by tools.",
  });
  const { scene } = await api.studio.production.addScene.mutate({
    project,
    episodeId: episode.id,
    slugline: "INT. OFFICE BREAKROOM — DAY",
    location: "the-office",
  });
  ({ shot } = await api.studio.production.addShot.mutate({
    project,
    sceneId: scene.id,
    title: TITLE,
    characters: ["sterling", "bruno"],
    camera: { shotSize: "ws", move: "push-in", lighting: "sitcom.warm-home" },
    scriptLines: [
      {
        id: "l0",
        character: null,
        text: "Sterling and Bruno face each other at the coffee machine.",
        deliveryNotes: "",
      },
      { id: "l1", character: "sterling", text: "You switched the pot.", deliveryNotes: "indignant" },
      { id: "l2", character: "bruno", text: "You seemed tense.", deliveryNotes: "sheepish" },
    ],
  }));
}
// the board's own plate stands in for a keyframe render — boarding is S-P1's
// proven ground, and this milestone is about what happens after it
if (shot.keyframes.length === 0) {
  const patched = await api.studio.production.updateShot.mutate({
    project,
    shotId: shot.id,
    patch: {
      keyframes: [{ id: "kf0", asset: plate, approved: true }],
      selectedKeyframe: "kf0",
      status: "boarded",
    },
  });
  shot = patched.shot;
}
check("a boarded two-hander to shoot", shot.keyframes.length > 0, `${shot.id} · ${shot.status}`);

/* ---- 4: compose it (the agent's dry run) ---- */
console.log("\n— shot_from_storyboard, composed —");
const takes = [
  { take: sterlingLine, character: "sterling", atSec: 2 },
  { take: brunoLine, character: "bruno", atSec: 7 },
];
const dry = await call("shot_from_storyboard", {
  shotId: shot.id,
  durationSec: 12,
  takes,
  dryRun: true,
});
const spec = dry.director;
console.log(JSON.stringify({ ...dry, videoInput: undefined }, null, 2).slice(0, 2400));

check("the shot is 12 seconds", dry.durationSec === 12);
check(
  "the board's selected keyframe is the first frame",
  spec.keyframes.length === 1 && spec.keyframes[0].image === plate && spec.keyframes[0].atSec === 0,
);
check("three beats: the room, then each line", spec.promptZones.length === 3);
check(
  "…tiling the whole take from 0s",
  Math.abs(spec.promptZones.reduce((s: number, z: any) => s + z.lengthSec, 0) - 12) < 0.05,
  spec.promptZones.map((z: any) => z.lengthSec).join(" + "),
);
check(
  "the camera move rides the opening beat",
  /push(-| )in/i.test(spec.promptZones[0].prompt),
  spec.promptZones[0].prompt,
);
check(
  "Sterling's beat names Sterling and shuts Bruno up",
  /^Sterling the lion.*talks, mouth moving while speaking, indignant/.test(spec.promptZones[1].prompt) &&
    /Bruno the gorilla.*listens in silence, mouth closed/.test(spec.promptZones[1].prompt),
  spec.promptZones[1].prompt,
);
check(
  "…and Bruno's beat does the reverse",
  /^Bruno the gorilla.*talks/.test(spec.promptZones[2].prompt) &&
    /Sterling the lion.*listens in silence/.test(spec.promptZones[2].prompt),
  spec.promptZones[2].prompt,
);
check(
  "both takes land where the agent asked",
  spec.audio.length === 2 && spec.audio[0].atSec === 2 && spec.audio[1].atSec === 7,
  spec.audio.map((a: any) => `${a.take.split("/").pop()}@${a.atSec}s`).join(" "),
);
check(
  "…and each beat starts with its own line",
  Math.abs(spec.promptZones[0].lengthSec - 2) < 0.05 &&
    Math.abs(spec.promptZones[1].lengthSec - 5) < 0.05,
);
check("scoring is off — LTX invents dialogue into open air", spec.inpaintAudio === false);
check(
  "the cast comes off the bible",
  spec.refs.length === 2 &&
    spec.refs.every((r: any) => r.kind === "character" && r.image && r.description),
  spec.refs.map((r: any) => r.name).join(" + "),
);
check("the show's negative prompt came along", typeof spec.negativePrompt === "string");
check("nothing was rendered", dry.job === undefined);
if (dry.notes.length) console.log("notes:", dry.notes.join("\n       "));

/* ---- 5: shot_retake composes a retake payload (enqueue, inspect, cancel) ---- */
console.log("\n— shot_retake —");
const takeAsset = assets.find((a) => a.kind === "video");
if (!takeAsset) {
  check("a finished take to fix", false, "no video in the library");
} else {
  const job = await call("shot_retake", {
    source: takeAsset.relPath,
    atSec: 3,
    lengthSec: 2,
    prompt: "the mug stays in his hand, no flicker",
    shotPrompt: "two animals in an office breakroom",
    strength: 0.8,
  });
  const payload = (await api.jobs.list.query()).find((j) => j.id === job.id)?.payload as any;
  await api.jobs.cancel.mutate({ id: job.id }).catch(() => undefined);
  check(
    "the window and its fix reach the job verbatim",
    payload?.director?.retake?.atSec === 3 &&
      payload.director.retake.lengthSec === 2 &&
      payload.director.retake.strength === 0.8,
    JSON.stringify(payload?.director?.retake),
  );
  check(
    "the anchor holds the frames outside the window",
    payload?.director?.globalPrompt === "two animals in an office breakroom",
  );
  check(
    "the original sound is kept unless asked otherwise",
    payload?.director?.retake?.regenerateAudio === false && payload.director.inpaintAudio === false,
  );
  check("nothing else is on the timeline", payload?.director?.keyframes?.length === 0);
}

if (!process.argv.includes("--render")) {
  console.log(`\n(offline + compose only — pass --render for the full take)`);
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

/* ---- 6: shoot it ---- */
console.log("\n— the render —");
const startedAt = new Date().toISOString();
const rendered = await call("shot_from_storyboard", {
  shotId: shot.id,
  durationSec: 12,
  takes,
  seed: 6161,
});
console.log(`enqueued ${rendered.job.id} — 12s, 2 voice takes, ${rendered.spec.refs.length} cast refs`);
const began = Date.now();
const stages = new Set<string>();
for (;;) {
  const j = (await api.jobs.list.query()).find((x) => x.id === rendered.job.id)!;
  if (j.stage) stages.add(j.stage);
  if (j.status === "completed" || j.status === "failed") {
    const tookSec = Math.round((Date.now() - began) / 1000);
    check("the shot rendered", j.status === "completed", j.error ?? `${tookSec}s`);
    check(
      "the cast sheet was encoded",
      [...stages].some((s) => /cast sheet/i.test(s)),
      [...stages].join(" | "),
    );
    check("mp4 on disk", !!j.output && fs.existsSync(j.output) && fs.statSync(j.output).size > 100_000, j.output);
    break;
  }
  if (Date.now() - began > 45 * 60_000) {
    await api.jobs.cancel.mutate({ id: rendered.job.id }).catch(() => undefined);
    check("the shot rendered", false, "timed out after 45 min");
    break;
  }
  await sleep(3000);
}

const after = allShots(await api.studio.production.get.query({ project })).find(
  (s: any) => s.id === shot.id,
);
check(
  "the take came back to the shot it was composed from",
  after.videoTakes.length > 0 && !!after.selectedTake,
  after.videoTakes.map((t: any) => t.asset).join(" "),
);
check("…and moved it along the ladder", after.status === "generated", after.status);
const imported = (await api.library.list.query()).assets.find(
  (a) => a.kind === "video" && a.createdAt >= startedAt,
);
if (imported) console.log(`\nOUTPUT ${path.join(os.homedir(), "Aurea", imported.relPath)}`);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
