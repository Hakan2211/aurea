/* Poster frames, filmstrips and durations — without a <video> per thumbnail.
 *
 * The naive version (one media element per rail card, one per filmstrip tile)
 * puts hundreds of elements on the page. Chrome allows six connections per
 * origin and a media element holds its connection open, so the whole screen
 * stalls black while everything queues behind everything else.
 *
 * Instead: at most MAX_DECODERS elements exist at a time, each is released the
 * moment it has given up its frames, and every frame is cached for the session
 * so scrolling back, zooming or re-trimming costs nothing. */

const MAX_DECODERS = 3;
const THUMB_W = 240;
const THUMB_H = 135;

/* The elements are POOLED AND REUSED, never created per call. Chrome caps how
 * many media players a page may hold, and creating a fresh <video> for each of
 * a few hundred takes blows through that cap — after which every later load,
 * including the program monitor's, silently hangs at readyState 0. Three
 * elements are borrowed, re-pointed at the next file, and handed back. */
const pool: Partial<Record<"video" | "audio", HTMLMediaElement[]>> = {};
const waiting: Array<() => void> = [];
let active = 0;

function borrow(tag: "video" | "audio"): HTMLMediaElement {
  const free = (pool[tag] ??= []).pop();
  if (free) return free;
  const el = document.createElement(tag);
  el.muted = true;
  el.preload = tag === "video" ? "auto" : "metadata";
  if (el instanceof HTMLVideoElement) el.playsInline = true;
  return el;
}

async function withMedia<T>(
  url: string,
  tag: "video" | "audio",
  fn: (el: HTMLMediaElement) => Promise<T>,
): Promise<T> {
  if (active >= MAX_DECODERS) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  const el = borrow(tag);
  try {
    await new Promise<void>((resolve, reject) => {
      const ok = () => {
        cleanup();
        resolve();
      };
      const bad = () => {
        cleanup();
        reject(new Error(`cannot read ${url}`));
      };
      const cleanup = () => {
        // audio only needs the header; video needs a decodable first frame
        el.removeEventListener(tag === "video" ? "loadeddata" : "loadedmetadata", ok);
        el.removeEventListener("error", bad);
      };
      el.addEventListener(tag === "video" ? "loadeddata" : "loadedmetadata", ok);
      el.addEventListener("error", bad);
      el.src = url;
    });
    return await fn(el);
  } finally {
    // stop the download, keep the player — that's the whole point of the pool
    el.removeAttribute("src");
    el.load();
    pool[tag]!.push(el);
    active--;
    waiting.shift()?.();
  }
}

function seek(el: HTMLMediaElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    el.addEventListener("seeked", () => resolve(), { once: true });
    el.addEventListener("error", () => reject(new Error("seek failed")), { once: true });
    el.currentTime = Math.max(0, Math.min(t, (el.duration || t) - 0.05));
  });
}

function paint(el: HTMLMediaElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = THUMB_W;
  canvas.height = THUMB_H;
  canvas.getContext("2d")?.drawImage(el as HTMLVideoElement, 0, 0, THUMB_W, THUMB_H);
  return canvas;
}

const frames = new Map<string, HTMLCanvasElement>();
const posters = new Map<string, Promise<{ frame: HTMLCanvasElement; duration: number }>>();
const durations = new Map<string, Promise<number>>();

const key = (url: string, t: number) => `${url}@${t.toFixed(2)}`;

/** a representative frame for a rail card, plus the file's duration */
export function poster(url: string): Promise<{ frame: HTMLCanvasElement; duration: number }> {
  let p = posters.get(url);
  if (!p) {
    p = withMedia(url, "video", async (el) => {
      const duration = el.duration;
      // a little way in — frame 0 of a render is often a fade-up from black
      await seek(el, Math.min(duration * 0.15, 1.5));
      const frame = paint(el);
      frames.set(key(url, el.currentTime), frame);
      return { frame, duration };
    });
    posters.set(url, p);
  }
  return p;
}

/** how long an audio file runs */
export function mediaDuration(url: string): Promise<number> {
  let p = durations.get(url);
  if (!p) {
    p = withMedia(url, "audio", async (el) => el.duration);
    durations.set(url, p);
  }
  return p;
}

/** frames at `times`, handed back as they arrive — cached ones immediately,
 * the rest from a single decoder that seeks through them in order */
export async function filmstrip(
  url: string,
  times: number[],
  onFrame: (index: number, frame: HTMLCanvasElement) => void,
  alive: () => boolean,
): Promise<void> {
  const missing: Array<{ t: number; i: number }> = [];
  times.forEach((t, i) => {
    const hit = frames.get(key(url, t));
    if (hit) onFrame(i, hit);
    else missing.push({ t, i });
  });
  if (missing.length === 0 || !alive()) return;
  await withMedia(url, "video", async (el) => {
    for (const { t, i } of missing) {
      if (!alive()) return;
      await seek(el, t);
      const frame = paint(el);
      frames.set(key(url, t), frame);
      onFrame(i, frame);
    }
  });
}
