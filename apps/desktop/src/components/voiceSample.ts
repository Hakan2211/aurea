/* Voice-clone sample capture. Whatever the user uploads or records (mp3,
 * m4a, webm/opus from the mic, wav) is decoded by Chromium, downmixed to
 * mono, trimmed, and re-encoded as PCM16 WAV — studiod only ever stores
 * canonical RIFF/WAVE reference clips in <dataRoot>/voices/. */

import { useCallback, useEffect, useRef, useState } from "react";

const SAMPLE_RATE = 44100;
/** cloning needs ~10s of clean speech; cap keeps the upload payload small */
const MAX_SECONDS = 40;

function encodeWavPcm16(mono: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + mono.length * 2);
  const view = new DataView(buf);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + mono.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, mono.length * 2, true);
  for (let i = 0; i < mono.length; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export interface VoiceSample {
  wavBase64: string;
  seconds: number;
  /** object URL of the canonical wav, for the preview player */
  url: string;
}

export async function sampleFromBlob(blob: Blob, maxSeconds = MAX_SECONDS): Promise<VoiceSample> {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const frames = Math.min(decoded.length, Math.floor(maxSeconds * decoded.sampleRate));
    if (frames < decoded.sampleRate) throw new Error("sample is shorter than a second");
    const mono = new Float32Array(frames);
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      const data = decoded.getChannelData(ch);
      for (let i = 0; i < frames; i++) mono[i] += data[i] / decoded.numberOfChannels;
    }
    const wav = encodeWavPcm16(mono, decoded.sampleRate);
    return {
      wavBase64: toBase64(wav),
      seconds: frames / decoded.sampleRate,
      url: URL.createObjectURL(new Blob([wav], { type: "audio/wav" })),
    };
  } catch (err) {
    throw err instanceof Error ? err : new Error("could not decode that audio file");
  } finally {
    void ctx.close();
  }
}

export interface MicRecorder {
  /** null = mic not in use; otherwise seconds recorded so far */
  seconds: number | null;
  supported: boolean;
  start: () => Promise<void>;
  /** stop and hand back the captured audio */
  stop: () => Promise<Blob>;
}

export function useMicRecorder(): MicRecorder {
  const [seconds, setSeconds] = useState<number | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    recRef.current?.stream.getTracks().forEach((t) => t.stop());
    recRef.current = null;
    setSeconds(null);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    if (recRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    recRef.current = rec;
    rec.start();
    const t0 = Date.now();
    setSeconds(0);
    timerRef.current = setInterval(() => setSeconds((Date.now() - t0) / 1000), 200);
  }, []);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return Promise.reject(new Error("not recording"));
    return new Promise<Blob>((resolve, reject) => {
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        cleanup();
        chunks.length
          ? resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }))
          : reject(new Error("the microphone produced no audio"));
      };
      rec.stop();
    });
  }, [cleanup]);

  return {
    seconds,
    supported: typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
    start,
    stop,
  };
}
