/* Replicate RVC v2 adapter — the songlar-quality voice path, two jobs:
 *
 *   rvcTrain     — train a per-voice RVC v2 model from the voice's reference
 *                  clip (replicate/train-rvc-model, 48k/v2/rmvpe_gpu/50
 *                  epochs, ~15 min, billed to the user's Replicate account).
 *                  The finished weights zip is stored locally at
 *                  <dataRoot>/voices/rvc/<voice>.zip — its existence is what
 *                  "this voice is RVC-ready" means everywhere else.
 *   voiceConvert — engine "rvc": re-voice audio through the trained model
 *                  (zsxkib/realistic-voice-cloning with rvc_model CUSTOM).
 *
 * Replicate only takes HTTPS URLs as inputs, and its delivery URLs expire in
 * about an hour — so every run uploads what it needs (source audio, model
 * zip) through Replicate's own Files API and downloads results immediately.
 * No third-party storage, nothing to configure beyond the token. */

import fs from "node:fs";
import path from "node:path";
import type { Job } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import { jobRunDir } from "./proc.js";
import { voiceRefCandidates } from "./tts.js";
import { autoPitchCorrection, type PitchCorrection } from "./pitch.js";
import type { JobResources } from "../scheduler.js";
import type { AdapterProgress, AdapterRun, EngineAdapter } from "./types.js";

/* Exact model versions songlar ran in production. */
const RVC_CONVERT_VERSION =
  "zsxkib/realistic-voice-cloning:0a9c7c558af4c0f20667c1bd1260ce32a2879944a0b9e44e1398660c077b1550";
const RVC_TRAIN_VERSION =
  "replicate/train-rvc-model:0397d5e28c9b54665e1e5d29d5cf4f722a7b89ec20e9dbf31487235305b1a101";
const TRAIN_EPOCHS = 50;

const API = "https://api.replicate.com/v1";
const POLL_CONVERT_MS = 3000;
const POLL_TRAIN_MS = 5000;

/** shown before spend — job-card detail lines quote these */
export const RVC_TRAIN_ESTIMATE = "≈ $1 · ~15 min";
export const RVC_CONVERT_ESTIMATE = "≈ $0.10";

/** where a voice's trained RVC weights live; existence = trained */
export function rvcModelPath(dataRoot: string, voiceId: string): string {
  return path.join(dataRoot, "voices", "rvc", `${voiceId.toLowerCase()}.zip`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const AUDIO_MIME: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
};

/* ---------- minimal stored (uncompressed) zip ----------
 * train-rvc-model wants dataset/<name>/split_<i>.wav inside a zip; one wav is
 * all we ship, so a ~50-line writer beats an archiver dependency. */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function storedZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed (stored) size
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/* ---------- Replicate REST (global fetch, like Seedance) ---------- */

interface Prediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: unknown;
  error?: unknown;
  logs?: string;
}

function headers(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** upload bytes to Replicate's Files API; the returned URL is model-input-ready */
async function uploadFile(
  token: string,
  data: Buffer,
  filename: string,
  contentType: string,
): Promise<string> {
  const form = new FormData();
  form.append("content", new Blob([new Uint8Array(data)], { type: contentType }), filename);
  const res = await fetch(`${API}/files`, { method: "POST", headers: headers(token), body: form });
  if (!res.ok) throw new Error(`Replicate upload failed (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { urls?: { get?: string } };
  const url = json.urls?.get;
  if (!url) throw new Error("Replicate upload returned no file URL");
  return url;
}

async function createPrediction(
  token: string,
  version: string,
  input: Record<string, unknown>,
): Promise<Prediction> {
  const res = await fetch(`${API}/predictions`, {
    method: "POST",
    headers: { ...headers(token), "content-type": "application/json" },
    body: JSON.stringify({ version, input }),
  });
  if (!res.ok) throw new Error(`Replicate submit failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as Prediction;
}

async function getPrediction(token: string, id: string): Promise<Prediction> {
  const res = await fetch(`${API}/predictions/${id}`, { headers: headers(token) });
  if (!res.ok) throw new Error(`Replicate status failed (${res.status})`);
  return (await res.json()) as Prediction;
}

function cancelPrediction(token: string, id: string): void {
  void fetch(`${API}/predictions/${id}/cancel`, {
    method: "POST",
    headers: headers(token),
  }).catch(() => {});
}

/** prediction.output is a URL string or an array whose [0] is the URL */
function outputUrl(p: Prediction): string {
  const out = p.output;
  const url = typeof out === "string" ? out : Array.isArray(out) && out.length ? out[0] : null;
  if (typeof url !== "string" || !/^https?:/.test(url)) {
    throw new Error("Replicate finished without a usable output URL");
  }
  return url;
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`result download failed (${res.status})`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

/* ---------- the adapter ---------- */

export class ReplicateRvcAdapter implements EngineAdapter {
  id = "replicate-rvc";

  constructor(private settings: SettingsStore) {}

  canRun(job: Job): boolean {
    const p = job.payload;
    return p?.type === "rvcTrain" || (p?.type === "voiceConvert" && p.engine === "rvc");
  }

  resources(): JobResources {
    // remote GPU — locally this is uploads + polling
    return { klass: "cpu" };
  }

  start(job: Job, report: (p: AdapterProgress) => void): AdapterRun {
    let canceled = false;
    let predictionId: string | null = null;
    const token = this.settings.get().providers.replicateApiToken;

    const checkCanceled = () => {
      if (canceled) throw new Error("Canceled by user");
    };

    const done = (async (): Promise<{ output?: string }> => {
      if (!token) {
        throw new Error("RVC needs a Replicate API token — Settings → AI Providers");
      }
      const payload = job.payload;
      if (payload?.type === "rvcTrain") return this.train(payload.voice, token, report, {
        setPrediction: (id) => (predictionId = id),
        checkCanceled,
      });
      if (payload?.type === "voiceConvert" && payload.engine === "rvc") {
        return this.convert(job, token, report, {
          setPrediction: (id) => (predictionId = id),
          checkCanceled,
        });
      }
      throw new Error("not an RVC job");
    })();

    return {
      done,
      cancel: () => {
        canceled = true;
        if (predictionId) cancelPrediction(token, predictionId);
      },
    };
  }

  private async train(
    voice: string,
    token: string,
    report: (p: AdapterProgress) => void,
    ctl: { setPrediction: (id: string) => void; checkCanceled: () => void },
  ): Promise<{ output?: string }> {
    const { storage, paths } = this.settings.get();
    const ref = voiceRefCandidates(voice, storage.dataRoot, paths.videofastDir).find((c) =>
      fs.existsSync(c),
    );
    if (!ref) throw new Error(`no reference clip for voice "${voice}"`);

    report({ progress: 2, stage: "Uploading voice dataset" });
    // required internal layout: dataset/<rvc_name>/split_<i>.wav
    const zip = storedZip([{ name: "dataset/voice-clone/split_0.wav", data: fs.readFileSync(ref) }]);
    const datasetUrl = await uploadFile(token, zip, `rvc-dataset-${voice}.zip`, "application/zip");
    ctl.checkCanceled();

    report({ progress: 6, stage: "Starting training", detail: `50 epochs · ${RVC_TRAIN_ESTIMATE}` });
    const created = await createPrediction(token, RVC_TRAIN_VERSION, {
      dataset_zip: datasetUrl,
      sample_rate: "48k",
      version: "v2",
      f0method: "rmvpe_gpu",
      epoch: TRAIN_EPOCHS,
      batch_size: "7",
    });
    ctl.setPrediction(created.id);

    for (;;) {
      await sleep(POLL_TRAIN_MS);
      ctl.checkCanceled();
      const p = await getPrediction(token, created.id);
      if (p.status === "succeeded") {
        report({ progress: 90, stage: "Downloading trained model" });
        const dest = rvcModelPath(storage.dataRoot, voice);
        await download(outputUrl(p), dest);
        report({ progress: 98, stage: "Model ready" });
        // the model zip is a capability, not a take — nothing to import
        return {};
      }
      if (p.status === "failed" || p.status === "canceled") {
        throw new Error(String(p.error ?? `training ${p.status}`));
      }
      // progress from the training logs' epoch counter
      const epochs = [...(p.logs ?? "").matchAll(/Epoch (\d+)/g)];
      const epoch = epochs.length ? Number(epochs[epochs.length - 1][1]) : 0;
      report({
        progress: Math.min(88, 8 + Math.round((epoch / TRAIN_EPOCHS) * 78)),
        stage: epoch ? `Training — epoch ${epoch}/${TRAIN_EPOCHS}` : "Waiting for a cloud GPU",
      });
    }
  }

  private async convert(
    job: Job,
    token: string,
    report: (p: AdapterProgress) => void,
    ctl: { setPrediction: (id: string) => void; checkCanceled: () => void },
  ): Promise<{ output?: string }> {
    const payload = job.payload;
    if (payload?.type !== "voiceConvert") throw new Error("not a voice-convert job");
    const { storage, paths } = this.settings.get();

    const source = path.join(storage.dataRoot, payload.source);
    if (!fs.existsSync(source)) throw new Error(`source audio not found: ${payload.source}`);
    const model = rvcModelPath(storage.dataRoot, payload.voice);
    if (!fs.existsSync(model)) {
      throw new Error(
        `no trained RVC model for "${payload.voice}" — run Train RVC voice in the Voice lab first`,
      );
    }

    // RVC keeps the source melody's pitch and only swaps timbre, so bring the
    // melody into the chosen voice's register first — measured, not assumed
    // from gender. Manual octave modes skip the measurement.
    let pitchChange: PitchCorrection = "no-change";
    let pitchDetail = "";
    const pitchMode = payload.pitchMode ?? "auto";
    if (payload.mode === "sing" && pitchMode !== "none") {
      if (pitchMode === "octave-down") pitchChange = "female-to-male";
      else if (pitchMode === "octave-up") pitchChange = "male-to-female";
      else {
        const ref = voiceRefCandidates(payload.voice, storage.dataRoot, paths.videofastDir).find(
          (c) => fs.existsSync(c),
        );
        if (ref) {
          report({ progress: 2, stage: "Matching pitch to voice" });
          const match = await autoPitchCorrection(source, ref);
          pitchChange = match.correction;
          pitchDetail = match.detail;
        }
      }
      ctl.checkCanceled();
    }

    const ext = path.extname(source).slice(1).toLowerCase();
    report({ progress: 3, stage: "Uploading source audio", detail: pitchDetail || undefined });
    const sourceUrl = await uploadFile(
      token,
      fs.readFileSync(source),
      `source.${ext || "wav"}`,
      AUDIO_MIME[ext] ?? "application/octet-stream",
    );
    ctl.checkCanceled();
    report({ progress: 6, stage: "Uploading voice model" });
    const modelUrl = await uploadFile(token, fs.readFileSync(model), "model.zip", "application/zip");
    ctl.checkCanceled();

    report({ progress: 10, stage: "Converting on Replicate", detail: RVC_CONVERT_ESTIMATE });
    const created = await createPrediction(token, RVC_CONVERT_VERSION, {
      song_input: sourceUrl,
      rvc_model: "CUSTOM",
      custom_rvc_model_download_url: modelUrl,
      // pitch_change is a string enum on this model ("no-change" | "male-to-female" |
      // "female-to-male") shifting ONLY the vocals by ±1 octave; pitch_change_all
      // transposes vocals AND instrumentals (a key change) by semitones
      pitch_change: pitchChange,
      ...(payload.semitoneShift ? { pitch_change_all: payload.semitoneShift } : {}),
    });
    ctl.setPrediction(created.id);

    for (;;) {
      await sleep(POLL_CONVERT_MS);
      ctl.checkCanceled();
      const p = await getPrediction(token, created.id);
      if (p.status === "succeeded") {
        report({ progress: 90, stage: "Downloading result" });
        const url = outputUrl(p);
        const outExt = path.extname(new URL(url).pathname).slice(1).toLowerCase() || "mp3";
        const out = path.join(jobRunDir(job.id), "out", `converted.${outExt}`);
        await download(url, out);
        report({ progress: 96 });
        return { output: out };
      }
      if (p.status === "failed" || p.status === "canceled") {
        throw new Error(String(p.error ?? `conversion ${p.status}`));
      }
      report({ progress: p.status === "starting" ? 15 : 55 });
    }
  }
}
