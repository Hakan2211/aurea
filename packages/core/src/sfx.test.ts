/* The Sound FX lab, end to end on the parts that can't be eyeballed:
 *
 *  - a finished take lands on the project's own sfx shelf with its prompt
 *    kept beside it (so it never gets lost among the music beds or voice
 *    lines, and the lab can show what it was asked for);
 *  - the job card quotes the cloud price before anything is spent, and says
 *    "$0.00" for the local engine;
 *  - the fal adapter speaks fal's queue protocol, authenticates, asks for
 *    lossless 48 kHz PCM and turns the headerless bytes into a real WAV.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { falSfxEstimate, sfxPayloadSchema, type AssetMeta, type Job } from "@aurea/shared";
import { ProjectStore } from "./projects.js";
import { labEnqueue } from "./labs.js";
import { FalSfxAdapter, pcmToWav } from "./adapters/sfx.js";

function scratch(): { dataRoot: string; settings: never } {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aurea-sfx-"));
  return { dataRoot, settings: { get: () => ({ storage: { dataRoot } }) } as never };
}

const sidecarFor = (file: string): AssetMeta =>
  JSON.parse(fs.readFileSync(path.join(path.dirname(file), `.${path.basename(file)}.meta.json`), "utf8"));

function sfxJob(dataRoot: string, payload: Record<string, unknown> = {}): Job {
  const out = path.join(dataRoot, "run", "sfx.wav");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, pcmToWav(Buffer.alloc(960)));
  return {
    id: "s1",
    title: "Heavy elephant footstep",
    kind: "sfx",
    engine: "ElevenLabs SFX",
    status: "completed",
    progress: 100,
    priority: "interactive",
    project: "show",
    output: out,
    payload: sfxPayloadSchema.parse({
      type: "sfx",
      prompt: "One heavy elephant footstep on soft earth, close, no reverb",
      ...payload,
    }),
  } as Job;
}

test("a finished take lands on the sfx shelf with its prompt beside it", () => {
  const { dataRoot, settings } = scratch();
  const projects = new ProjectStore(settings);
  projects.create("Show");
  const dest = projects.importJobOutput(sfxJob(dataRoot, { loop: true }), { engine: "elevenlabs-sfx-v3" });
  assert.ok(dest);
  assert.match(dest.replace(/\\/g, "/"), /\/projects\/show\/assets\/sfx\//);
  const meta = sidecarFor(dest);
  assert.equal(meta.origin, "sfx");
  assert.equal(meta.prompt, "One heavy elephant footstep on soft earth, close, no reverb");
  assert.equal(meta.title, "One heavy elephant footstep on soft earth");
  assert.equal(meta.loop, true);
  assert.equal(meta.engine, "elevenlabs-sfx-v3");
});

test("the job card prices the cloud take up front and the local one at zero", () => {
  const cloud = labEnqueue(sfxPayloadSchema.parse({ type: "sfx", prompt: "whoosh", durationSec: 4 }), "show");
  assert.equal(cloud.kind, "sfx");
  assert.equal(cloud.engine, "ElevenLabs SFX");
  assert.match(cloud.detail ?? "", /cloud ≈ \$0\.008/);

  const auto = labEnqueue(sfxPayloadSchema.parse({ type: "sfx", prompt: "whoosh" }), "show");
  assert.match(auto.detail ?? "", /auto length/);

  const local = labEnqueue(sfxPayloadSchema.parse({ type: "sfx", engine: "moss", prompt: "boom" }), "show");
  assert.equal(local.engine, "MOSS-SoundEffect");
  assert.match(local.detail ?? "", /5s · local · \$0\.00/);
});

test("small sfx totals keep their third decimal", () => {
  assert.equal(falSfxEstimate(2.5), "≈ $0.005");
  assert.equal(falSfxEstimate(30, 4), "≈ $0.24");
});

test("pcmToWav writes a valid 48 kHz mono 16-bit header", () => {
  const wav = pcmToWav(Buffer.alloc(96_000));
  assert.equal(wav.subarray(0, 4).toString(), "RIFF");
  assert.equal(wav.subarray(8, 12).toString(), "WAVE");
  assert.equal(wav.readUInt32LE(24), 48_000);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), 96_000);
  assert.equal(wav.length, 44 + 96_000);
});

test("the fal adapter submits, polls, downloads and wraps the PCM as WAV", async () => {
  const seen: { auth?: string; body?: Record<string, unknown>; path?: string } = {};
  let polls = 0;
  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      const url = req.url ?? "";
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      if (req.method === "POST") {
        seen.auth = req.headers.authorization;
        seen.body = JSON.parse(data);
        seen.path = url;
        res.end(JSON.stringify({ request_id: "r1" }));
      } else if (url.endsWith("/status")) {
        polls++;
        res.end(JSON.stringify({ status: polls < 2 ? "IN_PROGRESS" : "COMPLETED" }));
      } else if (url.endsWith("/requests/r1")) {
        res.end(JSON.stringify({ audio: { url: `${base}/file.pcm` } }));
      } else if (url === "/file.pcm") {
        res.end(Buffer.alloc(4800, 1));
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  try {
    const settings = { get: () => ({ providers: { falApiKey: "test-key" } }) } as never;
    const adapter = new FalSfxAdapter(settings, `http://127.0.0.1:${port}`);
    const job = {
      id: `sfx-test-${Date.now()}`,
      payload: sfxPayloadSchema.parse({ type: "sfx", prompt: "a whoosh", durationSec: 1.5, loop: true }),
    } as Job;
    assert.equal(adapter.canRun(job), true);
    const { output } = await adapter.start(job, () => {}).done;
    assert.equal(seen.auth, "Key test-key");
    assert.equal(seen.path, "/fal-ai/elevenlabs/sound-effects/v3");
    assert.deepEqual(seen.body, {
      text: "a whoosh",
      duration_seconds: 1.5,
      prompt_influence: 0.45,
      loop: true,
      output_format: "pcm_48000",
    });
    const wav = fs.readFileSync(output!);
    assert.equal(wav.subarray(0, 4).toString(), "RIFF");
    assert.equal(wav.length, 44 + 4800);
  } finally {
    server.close();
  }
});

test("the fal adapter refuses to run without a key, before any request", async () => {
  const adapter = new FalSfxAdapter({ get: () => ({ providers: { falApiKey: "" } }) } as never, "http://127.0.0.1:9");
  const job = { id: `sfx-nokey-${Date.now()}`, payload: sfxPayloadSchema.parse({ type: "sfx", prompt: "x" }) } as Job;
  await assert.rejects(adapter.start(job, () => {}).done, /need a fal\.ai API key/);
});
