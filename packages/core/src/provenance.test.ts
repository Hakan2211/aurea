/* Two things a take must not lose on its way to disk:
 *
 *  - the words it was sung to. Job history is capped, so the request that
 *    carried the lyrics ages out long before the wav does; if the sidecar
 *    doesn't keep them, the Music lab has nothing to show.
 *  - its audio lanes. A sequence saved before a track kind existed used to
 *    stay short forever, and the Timeline screen only ever offered to add
 *    another *video* track — so Voice and Music were unreachable.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AssetMeta, Job } from "@aurea/shared";
import { ProjectStore } from "./projects.js";
import { TimelineStore } from "./timeline.js";

function scratch(): { dataRoot: string; settings: never } {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aurea-prov-"));
  return { dataRoot, settings: { get: () => ({ storage: { dataRoot } }) } as never };
}

/** a finished music job whose wav is sitting in a scratch dir */
function musicJob(dataRoot: string, overrides: Partial<Job["payload"] & object> = {}): Job {
  const out = path.join(dataRoot, "run", "track.wav");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, "RIFF");
  return {
    id: "j1",
    title: "Breakroom Blues",
    kind: "music",
    engine: "acestep",
    status: "completed",
    progress: 100,
    priority: "batch",
    project: "show",
    output: out,
    payload: {
      type: "music",
      description: "slow blues",
      styles: [],
      durationSec: 30,
      arrangement: "vocals",
      language: "unknown",
      duet: false,
      ...overrides,
    },
  } as Job;
}

const sidecarFor = (file: string): AssetMeta =>
  JSON.parse(
    fs.readFileSync(path.join(path.dirname(file), `.${path.basename(file)}.meta.json`), "utf8"),
  );

test("lyrics you wrote are kept beside the track, not left in the job", () => {
  const { dataRoot, settings } = scratch();
  const projects = new ProjectStore(settings);
  projects.create("Show");
  const job = musicJob(dataRoot, { lyrics: "[verse]\nthe coffee is decaf again" });

  const dest = projects.importJobOutput({ ...job, project: "show" });

  assert.ok(dest);
  const meta = sidecarFor(dest);
  assert.equal(meta.lyrics, "[verse]\nthe coffee is decaf again");
  assert.equal(meta.arrangement, "vocals");
});

test("lyrics the model wrote arrive from the adapter and win over the blank request", () => {
  const { dataRoot, settings } = scratch();
  const projects = new ProjectStore(settings);
  projects.create("Show");
  // no lyrics in the payload — ACE-Step's LM wrote them, and only the adapter saw them
  const job = musicJob(dataRoot);

  const dest = projects.importJobOutput({ ...job, project: "show" }, {
    lyrics: "[chorus]\nwho took the last cup",
    bpm: 92,
    keyscale: "A Minor",
  });

  const meta = sidecarFor(dest!);
  assert.equal(meta.lyrics, "[chorus]\nwho took the last cup");
  assert.equal(meta.bpm, 92);
  assert.equal(meta.keyscale, "A Minor");
  // the payload still explains the rest — the adapter merges, it doesn't replace
  assert.equal(meta.origin, "music");
  assert.equal(meta.arrangement, "vocals");
});

test("an instrumental records no lyrics even if the engine offers some", () => {
  const { dataRoot, settings } = scratch();
  const projects = new ProjectStore(settings);
  projects.create("Show");
  const job = musicJob(dataRoot, { arrangement: "instrumental", lyrics: "ignored" });

  const meta = sidecarFor(projects.importJobOutput({ ...job, project: "show" })!);
  assert.equal(meta.lyrics, undefined);
  assert.equal(meta.arrangement, "instrumental");
});

test("a re-voiced song carries the original's words across the conversion", () => {
  const { dataRoot, settings } = scratch();
  const projects = new ProjectStore(settings);
  projects.create("Show");
  const song = projects.importJobOutput({ ...musicJob(dataRoot), project: "show" }, {
    lyrics: "[verse]\nsame song, new voice",
  })!;
  const songRel = path.relative(dataRoot, song).split(path.sep).join("/");

  const converted = path.join(dataRoot, "run2", "converted.wav");
  fs.mkdirSync(path.dirname(converted), { recursive: true });
  fs.writeFileSync(converted, "RIFF");
  const convertJob = {
    ...musicJob(dataRoot),
    id: "j2",
    title: "Breakroom Blues (Sterling)",
    output: converted,
    payload: { type: "voiceConvert", source: songRel, voice: "sterling", mode: "sing" },
  } as unknown as Job;

  const meta = sidecarFor(projects.importJobOutput({ ...convertJob, project: "show" })!);
  assert.equal(meta.origin, "voiceConvert");
  assert.equal(meta.source, songRel);
  assert.equal(meta.lyrics, "[verse]\nsame song, new voice");
});

test("a track keeps a readable name and its style chips, not the slug", () => {
  const { dataRoot, settings } = scratch();
  const projects = new ProjectStore(settings);
  projects.create("Show");
  const meta = sidecarFor(
    projects.importJobOutput({
      ...musicJob(dataRoot, {
        description: "A short bright ukulele sting, cheerful sitcom button",
        styles: ["Upbeat", "Sitcom brass"],
      }),
      project: "show",
    })!,
  );
  // cut at the clause break, never mid-word the way the queue row's title is
  assert.equal(meta.title, "A short bright ukulele sting");
  assert.deepEqual(meta.styles, ["Upbeat", "Sitcom brass"]);
});

test("cover art attaches to its track without inheriting the song's words", () => {
  const { dataRoot, settings } = scratch();
  const projects = new ProjectStore(settings);
  projects.create("Show");
  const song = projects.importJobOutput({ ...musicJob(dataRoot), project: "show" }, {
    lyrics: "[verse]\nwords that belong to the wav",
  })!;
  const songRel = path.relative(dataRoot, song).split(path.sep).join("/");

  const png = path.join(dataRoot, "run3", "cover.png");
  fs.mkdirSync(path.dirname(png), { recursive: true });
  fs.writeFileSync(png, "PNG");
  const coverJob = {
    ...musicJob(dataRoot),
    id: "j3",
    kind: "image",
    title: "Cover — Breakroom Blues",
    output: png,
    payload: { type: "image", prompt: "album art", model: "z-image", aspect: "1:1", count: 1, refs: [], cover: songRel },
  } as unknown as Job;
  const cover = projects.importJobOutput({ ...coverJob, project: "show" })!;
  const coverRel = path.relative(dataRoot, cover).split(path.sep).join("/");

  // the picture is filed as a byproduct, and stays a picture: a PNG that
  // inherits the song's lyrics is a PNG claiming to have a second verse
  const coverMeta = sidecarFor(cover);
  assert.equal(coverMeta.origin, "musicCover");
  assert.equal(coverMeta.source, songRel);
  assert.equal(coverMeta.lyrics, undefined);

  // and the track learns where its art is, after the fact
  projects.patchMeta(songRel, { cover: coverRel });
  const songMeta = sidecarFor(song);
  assert.equal(songMeta.cover, coverRel);
  assert.equal(songMeta.lyrics, "[verse]\nwords that belong to the wav");
});

test("a sequence saved without audio lanes gets them back on load", () => {
  const { dataRoot, settings } = scratch();
  const dir = path.join(dataRoot, "projects", "old");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "timeline.json"),
    JSON.stringify({
      version: 1,
      fps: 24,
      width: 896,
      height: 704,
      tracks: [
        { id: "v1", kind: "video", name: "Video", muted: false, gain: 1, clips: [
          { id: "c1", asset: "a.mp4", label: "loft", start: 0, in: 0, duration: 5, transitionSec: 0 },
        ] },
      ],
    }),
  );

  const tl = new TimelineStore(settings).get("old");

  assert.deepEqual(tl.tracks.map((t) => t.kind), ["video", "voice", "music"]);
  assert.equal(tl.tracks[0].clips.length, 1, "the cut survives the reconcile");
  assert.equal(tl.width, 896, "the sequence's own format is left alone");
});

test("extra video tracks keep their compositing order when the lanes are reconciled", () => {
  const { dataRoot, settings } = scratch();
  const dir = path.join(dataRoot, "projects", "layered");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "timeline.json"),
    JSON.stringify({
      version: 1,
      tracks: [
        { id: "v1", kind: "video", name: "Video", clips: [] },
        { id: "m1", kind: "music", name: "Music", clips: [] },
        { id: "v2", kind: "video", name: "Video 2", clips: [] },
      ],
    }),
  );

  const tl = new TimelineStore(settings).get("layered");

  assert.deepEqual(
    tl.tracks.map((t) => t.name),
    ["Video", "Video 2", "Voice", "Music"],
    "video lanes stay in array order (later composites on top); the missing lane is added",
  );
});

test("a sequence that already has every lane is handed back untouched", () => {
  const { dataRoot, settings } = scratch();
  const dir = path.join(dataRoot, "projects", "full");
  fs.mkdirSync(dir, { recursive: true });
  const tracks = [
    { id: "v1", kind: "video", name: "Video", muted: false, gain: 1, clips: [] },
    { id: "a1", kind: "voice", name: "Voice", muted: true, gain: 0.5, clips: [] },
    { id: "m1", kind: "music", name: "Music", muted: false, gain: 0.3, clips: [] },
  ];
  fs.writeFileSync(path.join(dir, "timeline.json"), JSON.stringify({ version: 1, tracks }));

  const tl = new TimelineStore(settings).get("full");

  assert.deepEqual(tl.tracks, tracks, "mute and gain settings are not reset");
});
