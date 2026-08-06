/* One clip on a lane, and the two things that make Aurea's timeline read like
 * picture rather than coloured boxes: a real filmstrip inside video clips and
 * a real waveform inside audio ones — both taken straight off the media the
 * clip points at, plus the dialogue the take speaks printed on it. */

import { useEffect, useRef, useState } from "react";
import type { TimelineClip, TimelineTrack } from "@aurea/shared";
import { cx } from "@/components/ui";
import { filmstrip } from "./frames";
import { CLIP_H, FRAME, KIND, type ResolvedAsset, fmtDur, snap } from "./shared";

/* ---- waveform peaks: decoded once per file, cached for the session ---- */

const PEAKS_PER_SEC = 24;
const peaksCache = new Map<string, Promise<Float32Array>>();

function loadPeaks(url: string): Promise<Float32Array> {
  let p = peaksCache.get(url);
  if (!p) {
    p = (async () => {
      const buf = await (await fetch(url)).arrayBuffer();
      // OfflineAudioContext decodes without an audio device or autoplay policy
      const audio = await new OfflineAudioContext(1, 8, 8000).decodeAudioData(buf);
      const ch = audio.getChannelData(0);
      const n = Math.max(1, Math.ceil(audio.duration * PEAKS_PER_SEC));
      const per = Math.max(1, Math.floor(ch.length / n));
      const peaks = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let max = 0;
        const end = Math.min(ch.length, (i + 1) * per);
        for (let j = i * per; j < end; j += 4) {
          const v = Math.abs(ch[j]);
          if (v > max) max = v;
        }
        peaks[i] = max;
      }
      return peaks;
    })();
    peaksCache.set(url, p);
  }
  return p;
}

function usePeaks(url: string | undefined) {
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  useEffect(() => {
    let alive = true;
    if (url)
      loadPeaks(url).then(
        (p) => alive && setPeaks(p),
        () => {},
      );
    return () => {
      alive = false;
    };
  }, [url]);
  return peaks;
}

/** the audible slice [inSec, inSec+durSec] of the file, mirrored around the
 * clip's centre line the way every mixer draws it */
function ClipWave({
  url,
  inSec,
  durSec,
  widthPx,
  heightPx,
  color,
}: {
  url: string | undefined;
  inSec: number;
  durSec: number;
  widthPx: number;
  heightPx: number;
  color: string;
}) {
  const peaks = usePeaks(url);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !peaks) return;
    const w = Math.max(1, Math.floor(widthPx));
    const h = heightPx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color;
    const mid = h / 2;
    for (let x = 0; x < w; x += 2) {
      const t = inSec + (x / w) * durSec;
      const v = peaks[Math.floor(t * PEAKS_PER_SEC)] ?? 0;
      const barH = Math.max(1, v * (h - 2));
      ctx.beginPath();
      // rounded caps read as a soft ribbon rather than a picket fence
      ctx.roundRect(x, mid - barH / 2, 1.5, barH, 0.75);
      ctx.fill();
    }
  }, [peaks, inSec, durSec, widthPx, heightPx, color]);
  return (
    <canvas
      ref={ref}
      style={{ width: widthPx, height: heightPx }}
      className={cx(
        "pointer-events-none absolute inset-x-0 bottom-0 transition-opacity duration-300",
        peaks ? "opacity-100" : "opacity-0",
      )}
    />
  );
}

/** frames of the take laid across the clip, drawn from the shared decoder
 * pool (see frames.ts — one throttled element, cached frames) */
function Filmstrip({
  url,
  inSec,
  durSec,
  widthPx,
}: {
  url: string;
  inSec: number;
  durSec: number;
  widthPx: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // one thumbnail per ~16:9 tile, so the strip reads as frames, not smears
  const n = Math.min(24, Math.max(1, Math.round(widthPx / (CLIP_H * 1.6))));

  useEffect(() => {
    let alive = true;
    const canvas = ref.current;
    if (!canvas) return;
    const w = Math.max(1, Math.floor(widthPx));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = w * dpr;
    canvas.height = CLIP_H * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const tileW = w / n;
    const times = Array.from({ length: n }, (_, i) => inSec + ((i + 0.5) / n) * durSec);
    void filmstrip(
      url,
      times,
      (i, frame) => {
        // cover-fit: the tile is narrower than 16:9, so crop the sides
        const scale = Math.max(tileW / frame.width, CLIP_H / frame.height);
        const sw = tileW / scale;
        ctx.drawImage(
          frame,
          (frame.width - sw) / 2,
          0,
          sw,
          frame.height,
          i * tileW,
          0,
          tileW + 0.5,
          CLIP_H,
        );
      },
      () => alive,
    ).catch(() => {});
    return () => {
      alive = false;
    };
  }, [url, inSec, durSec, widthPx, n]);

  return (
    <canvas
      ref={ref}
      style={{ width: widthPx, height: CLIP_H }}
      className="pointer-events-none absolute inset-0 bg-black/60"
    />
  );
}

type DragMode = "move" | "trim-l" | "trim-r";

export function Clip({
  clip,
  pxPerSec,
  kind,
  asset,
  selected,
  muted,
  snapTargets,
  onSelect,
  onPatch,
  onMoveVertical,
  onGuide,
}: {
  clip: TimelineClip;
  pxPerSec: number;
  kind: TimelineTrack["kind"];
  asset: ResolvedAsset;
  selected: boolean;
  muted: boolean;
  /** other clips' edges + the playhead — a move snaps to the nearest one */
  snapTargets: number[];
  onSelect: () => void;
  onPatch: (patch: Partial<TimelineClip>) => void;
  onMoveVertical: (laneOffset: number) => void;
  /** show/hide the magnetic guide line while dragging */
  onGuide: (t: number | null) => void;
}) {
  const drag = useRef<{
    mode: DragMode;
    x: number;
    y: number;
    start: number;
    in: number;
    duration: number;
  } | null>(null);

  /** pull `t` (and the clip's other edge) onto the nearest guide within 7px */
  const magnet = (start: number): { start: number; guide: number | null } => {
    const tol = 7 / pxPerSec;
    let best: { start: number; guide: number } | null = null;
    for (const edge of [start, start + clip.duration]) {
      for (const target of snapTargets) {
        const d = Math.abs(edge - target);
        if (d > tol) continue;
        if (best && d >= Math.abs(edge - best.guide)) continue;
        best = { start: start + (target - edge), guide: target };
      }
    }
    return best ? { start: Math.max(0, best.start), guide: best.guide } : { start, guide: null };
  };

  const onPointerDown = (mode: DragMode) => (e: React.PointerEvent) => {
    e.stopPropagation();
    onSelect();
    drag.current = {
      mode,
      x: e.clientX,
      y: e.clientY,
      start: clip.start,
      in: clip.in,
      duration: clip.duration,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / pxPerSec;
    if (d.mode === "move") {
      const { start, guide } = magnet(Math.max(0, d.start + dx));
      onGuide(guide);
      onPatch({ start: snap(start) });
    } else if (d.mode === "trim-r") {
      onPatch({ duration: snap(Math.max(FRAME, d.duration + dx)) });
    } else {
      const delta = Math.min(Math.max(dx, -d.in), d.duration - FRAME);
      onPatch({
        start: snap(d.start + delta),
        in: Math.max(0, d.in + delta),
        duration: snap(Math.max(FRAME, d.duration - delta)),
      });
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    onGuide(null);
    // releasing a moved clip over an adjacent lane re-tracks it (same kind only)
    if (d?.mode === "move") {
      const laneOffset = Math.round((e.clientY - d.y) / (CLIP_H + 14));
      if (laneOffset !== 0) onMoveVertical(laneOffset);
    }
  };

  const { accent, wave } = KIND[kind];
  const widthPx = Math.max(6, clip.duration * pxPerSec);
  const tight = widthPx < 64;
  const label = clip.label || clip.asset.split("/").pop();
  /* what a voice clip says, straight off the take's sidecar — the reason this
   * timeline can caption dialogue when real NLEs can't */
  const line = kind === "voice" ? asset?.meta?.text : undefined;
  const speaker = kind === "voice" ? asset?.meta?.voice : undefined;
  const filmstrip = kind === "video" && asset?.kind === "video" && asset.url;
  const missing = !asset;

  return (
    <div
      style={{
        left: clip.start * pxPerSec,
        width: widthPx,
        height: CLIP_H,
        // the clip's body: a dark plate carrying a hairline of its lane colour
        background:
          kind === "video"
            ? "#0d0d0f"
            : `linear-gradient(180deg, ${accent}22, ${accent}0f 55%, #0d0d0f)`,
        boxShadow: selected
          ? `inset 0 0 0 1.5px ${accent}, 0 0 0 1px rgba(10,10,11,.9), 0 10px 26px -8px ${accent}99`
          : `inset 0 0 0 1px ${accent}59, inset 0 1px 0 rgba(255,255,255,.06), 0 2px 6px -2px rgba(0,0,0,.7)`,
      }}
      className={cx(
        "group/clip absolute top-[7px] cursor-grab select-none overflow-hidden rounded-[7px]",
        "transition-[box-shadow,filter,opacity] duration-150 ease-[cubic-bezier(0.25,1,0.5,1)]",
        "hover:brightness-[1.12] active:cursor-grabbing",
        muted && "opacity-45 saturate-50",
        selected && "z-10",
      )}
      onPointerDown={onPointerDown("move")}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title={`${label}${line ? ` — “${line}”` : ""}`}
    >
      {filmstrip && (
        <Filmstrip url={asset.url!} inSec={clip.in} durSec={clip.duration} widthPx={widthPx} />
      )}
      {kind === "video" && !filmstrip && asset?.kind === "image" && asset.url && (
        <img
          src={asset.url}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      )}
      {kind !== "video" && (
        <ClipWave
          url={asset?.url}
          inSec={clip.in}
          durSec={clip.duration}
          widthPx={widthPx}
          heightPx={CLIP_H - (line || speaker ? 16 : 12)}
          color={wave}
        />
      )}

      {/* crossfade — the incoming ramp, drawn as the dissolve it exports as */}
      {clip.transitionSec > 0 && (
        <div
          style={{
            width: Math.min(clip.transitionSec, clip.duration) * pxPerSec,
            background:
              "linear-gradient(100deg, rgba(10,10,11,.94) 0%, rgba(10,10,11,.55) 55%, transparent 100%)",
          }}
          className="pointer-events-none absolute inset-y-0 left-0"
        >
          <span className="absolute inset-y-0 right-0 w-px bg-cream/25" />
        </div>
      )}

      {/* label plate — a scrim over picture, a plain line over waveforms */}
      {kind === "voice" && (line || speaker) ? (
        <span className="pointer-events-none absolute inset-x-2 top-1 flex items-baseline gap-1.5 overflow-hidden whitespace-nowrap text-[9.5px] leading-none">
          <span style={{ color: accent }} className="text-[7px]">
            ◆
          </span>
          {speaker && (
            <span style={{ color: accent }} className="font-semibold uppercase tracking-[0.08em]">
              {speaker}
            </span>
          )}
          {line && <span className="truncate italic text-cream/75">“{line}”</span>}
        </span>
      ) : kind === "video" ? (
        !tight && (
          <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-ink/90 via-ink/55 to-transparent px-2 pb-1 pt-4 text-[9.5px] font-medium leading-none text-cream/90">
            <span className="truncate">{label}</span>
            <span className="ml-auto shrink-0 tabular-nums text-cream/45">
              {fmtDur(clip.duration)}
            </span>
          </span>
        )
      ) : (
        <span className="pointer-events-none absolute inset-x-2 top-1 truncate text-[9.5px] font-medium leading-none text-cream/70">
          {label}
        </span>
      )}

      {missing && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ember/15 text-[9px] font-semibold uppercase tracking-wider text-[#e07a6b]">
          missing
        </span>
      )}

      {/* trim handles — invisible until the clip is under the cursor */}
      {(["trim-l", "trim-r"] as const).map((mode) => (
        <div
          key={mode}
          onPointerDown={onPointerDown(mode)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className={cx(
            "absolute inset-y-0 flex w-2.5 cursor-ew-resize items-center justify-center",
            "opacity-0 transition-opacity duration-150 group-hover/clip:opacity-100",
            mode === "trim-l" ? "left-0" : "right-0",
          )}
        >
          <span
            style={{ background: accent }}
            className="h-1/2 w-[3px] rounded-full shadow-[0_0_6px_rgba(0,0,0,.8)]"
          />
        </div>
      ))}
    </div>
  );
}
