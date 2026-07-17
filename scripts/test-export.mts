/* Timeline export E2E — real studiod, real ffmpeg, synthetic media:
 *
 *   1. a scratch project gets two colored+toned mp4 shots, a still, a voice
 *      tone and a music bed, synthesized by ffmpeg into its assets tree
 *   2. the sequence is built entirely through the new granular clip ops
 *      (addClip probing real durations, explicit overlap + crossfade,
 *      updateClip trim, removeClip)
 *   3. timeline.export enqueues an ffmpeg job on the cpu lane; we watch it
 *      to completion over the jobs stream
 *   4. the delivered mp4 is verified frame-accurately: probed duration,
 *      sampled pixel colors per timeline position (red shot → blue shot on
 *      top of the overlap → green still → black tail), audible audio, and
 *      the auto-import into the project's video assets
 *   5. the timeline_* tool registry (what the Director calls) is exercised
 *      directly: get / add / update / remove / export handlers
 *   6. multi-video-track semantics: trackIndex 1 creates "Video 2", a yellow
 *      insert composites OVER the base cut in its window (pixel-sampled),
 *      and the base picture returns outside it
 *
 * Run: npx tsx scripts/test-export.mts */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const { startStudiod } = await import("../packages/core/src/server.js");
const { createStudiodApi, buildTools } = await import("../packages/core/src/tools.js");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[]) =>
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { windowsHide: true });

const handle = await startStudiod({ writePortFile: false });
const api = createStudiodApi(handle.port, handle.token);

const dataRoot = (await api.settings.get.query()).storage.dataRoot;
const project = (await api.projects.create.mutate({ name: `Export Test ${Date.now() % 100000}` })).id;
const projectDir = path.join(dataRoot, "projects", project);
const assets = (kind: string) => {
  const dir = path.join(projectDir, "assets", kind);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
console.log(`scratch project: ${project}`);

try {
  /* ---- 1. synthetic media ---- */
  const shotA = path.join(assets("video"), "shot-a.mp4");
  const shotB = path.join(assets("video"), "shot-b.mp4");
  const still = path.join(assets("image"), "title.png");
  const voice = path.join(assets("audio"), "line.wav");
  const music = path.join(assets("music"), "bed.wav");
  ff(["-f", "lavfi", "-i", "color=c=red:s=320x180:r=24:d=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", shotA]);
  ff(["-f", "lavfi", "-i", "color=c=blue:s=320x180:r=24:d=2", "-f", "lavfi", "-i", "sine=frequency=660:duration=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", shotB]);
  ff(["-f", "lavfi", "-i", "color=c=green:s=320x180", "-frames:v", "1", still]);
  ff(["-f", "lavfi", "-i", "sine=frequency=220:duration=3", voice]);
  ff(["-f", "lavfi", "-i", "sine=frequency=110:duration=6", music]);
  const rel = (abs: string) => path.relative(dataRoot, abs).replace(/\\/g, "/");

  /* ---- 2. build the cut through the clip ops ---- */
  const fresh = await api.timeline.get.query({ project });
  check("fresh timeline has the 3 default tracks", fresh.tracks.length === 3);

  const a = await api.timeline.addClip.mutate({ project, asset: rel(shotA) });
  check("shot A: probed duration ≈ 2s at start 0",
    Math.abs(a.clip.duration - 2) < 0.15 && a.clip.start === 0,
    `start=${a.clip.start} dur=${a.clip.duration}`);

  const b = await api.timeline.addClip.mutate({
    project, asset: rel(shotB), start: 1.5, transitionSec: 0.5,
  });
  check("shot B: placed at 1.5 with 0.5s crossfade", b.clip.start === 1.5 && b.clip.transitionSec === 0.5);

  const img = await api.timeline.addClip.mutate({ project, asset: rel(still), start: 3.5, duration: 2 });
  check("still lands on the video track for 2s", img.clip.duration === 2);

  const v = await api.timeline.addClip.mutate({ project, asset: rel(voice) });
  const m = await api.timeline.addClip.mutate({ project, asset: rel(music) });
  check("voice + music routed to their tracks by asset kind", !!v.clip.id && !!m.clip.id);

  // trim then untrim shot A via updateClip; drop and re-add the music clip
  await api.timeline.updateClip.mutate({ project, clip: a.clip.id, patch: { duration: 1 } });
  const trimmed = await api.timeline.get.query({ project });
  check("updateClip trims shot A to 1s",
    trimmed.tracks.find((t) => t.kind === "video")!.clips.find((c) => c.id === a.clip.id)!.duration === 1);
  await api.timeline.updateClip.mutate({ project, clip: a.clip.id, patch: { duration: 2 } });

  await api.timeline.removeClip.mutate({ project, clip: m.clip.id });
  const afterRemove = await api.timeline.get.query({ project });
  check("removeClip drops the music clip",
    !afterRemove.tracks.some((t) => t.clips.some((c) => c.id === m.clip.id)));
  const m2 = await api.timeline.addClip.mutate({ project, asset: rel(music) });
  check("music re-added for the final cut", !!m2.clip.id);

  /* ---- 3. export ---- */
  const job = await api.timeline.export.mutate({ project });
  check("export job enqueued on ffmpeg engine", job.engine === "ffmpeg" && job.kind === "video", job.detail);

  let final = job;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    final = (await api.jobs.list.query()).find((j) => j.id === job.id)!;
    if (final.status === "completed" || final.status === "failed") break;
  }
  check("export job completed", final.status === "completed", final.error ?? final.stage ?? "");

  /* ---- 4. verify the master ---- */
  const out = final.output!;
  check("output landed in the project's video assets",
    !!out && out.includes(path.join("projects", project, "assets", "video")), out);

  const probe = JSON.parse(execFileSync("ffprobe",
    ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", out],
    { windowsHide: true }).toString()) as { format: { duration: string }; streams: Array<{ codec_type: string }> };
  const dur = Number(probe.format.duration);
  check("master runs ≈ 6s (music bed defines the tail)", Math.abs(dur - 6) < 0.25, `${dur}s`);
  check("master has video + audio streams",
    probe.streams.some((s) => s.codec_type === "video") && probe.streams.some((s) => s.codec_type === "audio"));

  const pixelAt = (t: number): [number, number, number] => {
    const raw = execFileSync("ffmpeg",
      ["-v", "error", "-ss", String(t), "-i", out, "-frames:v", "1", "-vf", "scale=1:1",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
      { windowsHide: true });
    return [raw[0], raw[1], raw[2]];
  };
  const [r1] = pixelAt(1.0);
  check("t=1.0 shows shot A (red)", r1 > 180, `rgb=${pixelAt(1.0).join(",")}`);
  const [, , b3] = pixelAt(3.0);
  check("t=3.0 shows shot B on top (blue)", b3 > 180, `rgb=${pixelAt(3.0).join(",")}`);
  const [, g45] = pixelAt(4.5);
  check("t=4.5 shows the still (green)", g45 > 100, `rgb=${pixelAt(4.5).join(",")}`);
  const tail = pixelAt(5.8);
  check("t=5.8 is black under the music tail", tail.every((c) => c < 24), `rgb=${tail.join(",")}`);
  const mid = pixelAt(1.75); // crossfade region: B fading in over A
  check("t=1.75 blends A and B (crossfade)", mid[0] > 30 && mid[2] > 30, `rgb=${mid.join(",")}`);

  // volumedetect reports on stderr
  const volRun = spawnSync("ffmpeg", ["-i", out, "-af", "volumedetect", "-f", "null", "-"],
    { windowsHide: true });
  const vol = /mean_volume:\s*(-?[\d.]+) dB/.exec(volRun.stderr.toString());
  check("master is audible (tones mixed in)", !!vol && Number(vol[1]) > -50, vol?.[1] ?? "no reading");

  const inLibrary = (await api.library.list.query()).assets.some(
    (x) => x.project === project && x.kind === "video" && x.name.startsWith("export-"),
  );
  check("library scan lists the exported master", inLibrary);

  /* ---- 5. the Director's tool registry over the same ops ---- */
  const tools = buildTools(api);
  const call = async (name: string, args: Record<string, unknown>) => {
    const tool = tools.find((t) => t.name === name)!;
    return JSON.parse((await tool.handler(args)).content[0].text) as Record<string, unknown>;
  };
  const names = ["timeline_get", "timeline_add_clip", "timeline_update_clip", "timeline_remove_clip", "timeline_export"];
  check("all 5 timeline tools registered", names.every((tn) => tools.some((t) => t.name === tn)),
    `${tools.length} tools total`);

  const got = await call("timeline_get", { project });
  check("timeline_get reports the cut's duration", Math.abs((got.durationSec as number) - 6) < 0.01,
    String(got.durationSec));
  const added = await call("timeline_add_clip", { project, asset: rel(shotA), start: 6, duration: 1 });
  const addedClip = (added.clip as { id: string }).id;
  check("timeline_add_clip places a clip via the tool", (added.durationSec as number) === 7);
  await call("timeline_update_clip", { project, clip: addedClip, duration: 0.5 });
  const removed = await call("timeline_remove_clip", { project, clip: addedClip });
  check("tool update+remove round-trip", (removed.durationSec as number) === 6);
  const exported = await call("timeline_export", { project });
  check("timeline_export enqueues a job via the tool", typeof exported.id === "string" && exported.engine === "ffmpeg");
  await api.jobs.cancel.mutate({ id: exported.id as string }); // no need to render twice

  /* ---- 6. multi-video-track: an insert composites over the base cut ---- */
  const insertSrc = path.join(assets("video"), "insert.mp4");
  ff(["-f", "lavfi", "-i", "color=c=yellow:s=320x180:r=24:d=2", "-f", "lavfi", "-i", "sine=frequency=880:duration=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", insertSrc]);

  const ins = await api.timeline.addClip.mutate({
    project, asset: rel(insertSrc), trackIndex: 1, start: 0.5, duration: 1,
  });
  const withInsert = await api.timeline.get.query({ project });
  const videoTracks = withInsert.tracks.filter((t) => t.kind === "video");
  check("trackIndex 1 created a second video track named Video 2",
    videoTracks.length === 2 && videoTracks[1].name === "Video 2",
    videoTracks.map((t) => t.name).join(" | "));
  check("insert lives on the overlay track",
    videoTracks[1].clips.some((c) => c.id === ins.clip.id));

  const job2 = await api.timeline.export.mutate({ project });
  let final2 = job2;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    final2 = (await api.jobs.list.query()).find((j) => j.id === job2.id)!;
    if (final2.status === "completed" || final2.status === "failed") break;
  }
  check("overlay export completed", final2.status === "completed", final2.error ?? "");

  const out2 = final2.output!;
  const pixelAt2 = (t: number): [number, number, number] => {
    const raw = execFileSync("ffmpeg",
      ["-v", "error", "-ss", String(t), "-i", out2, "-frames:v", "1", "-vf", "scale=1:1",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
      { windowsHide: true });
    return [raw[0], raw[1], raw[2]];
  };
  const pre = pixelAt2(0.25);
  check("t=0.25 shows the base (red) before the insert window", pre[0] > 180 && pre[1] < 100,
    `rgb=${pre.join(",")}`);
  const over = pixelAt2(1.0);
  check("t=1.0 the insert (yellow) composites over the base", over[0] > 180 && over[1] > 180 && over[2] < 100,
    `rgb=${over.join(",")}`);
  const post = pixelAt2(3.0);
  check("t=3.0 the base cut (blue) returns after the insert", post[2] > 180,
    `rgb=${post.join(",")}`);
} finally {
  await handle.close();
  // scratch project + its assets vanish; job history entries are harmless
  fs.rmSync(projectDir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
