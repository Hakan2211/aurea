/* Timeline — the minimal sequence editor (PRD F8): preview on top, shot rail
 * on the left, multitrack strip below. Drag to move, edge-drag to trim, razor
 * at the playhead, per-clip crossfade, per-track mute. Edits live in local
 * state and save whole-document (debounced) through useTimeline. */

import { useEffect, useRef, useState } from "react";
import {
  Clapperboard,
  FileAudio,
  FileImage,
  FileMusic,
  FileVideo,
  Film,
  Loader2,
  Pause,
  Play,
  Plus,
  Scissors,
  SkipBack,
  Trash2,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { Timeline, TimelineClip, TimelineTrack } from "@aurea/shared";
import { useTimeline } from "@/hooks";
import { cx } from "@/components/ui";

const RULER_H = 22;
const TRACK_H = 56;
const SNAP = 0.1;

const kindIcon = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  music: FileMusic,
  model3d: Film,
} as const;

/** which track a library kind lands on */
const TRACK_FOR_KIND: Record<string, TimelineTrack["kind"]> = {
  video: "video",
  image: "video",
  audio: "voice",
  music: "music",
};

const uid = () => Math.random().toString(36).slice(2, 10);
const snap = (v: number) => Math.max(0, Math.round(v / SNAP) * SNAP);
const fmt = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}.${Math.floor((sec % 1) * 10)}`;

function trackEnd(track: TimelineTrack): number {
  return track.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
}
function sequenceEnd(tl: Timeline): number {
  return tl.tracks.reduce((m, t) => Math.max(m, trackEnd(t)), 0);
}

/** probe a media file's duration (falls back for images) */
function probeDuration(url: string | undefined, kind: string): Promise<number> {
  if (!url || kind === "image") return Promise.resolve(4);
  return new Promise((resolve) => {
    const el = document.createElement(kind === "video" ? "video" : "audio");
    const done = (d: number) => {
      el.src = "";
      resolve(Number.isFinite(d) && d > 0 ? d : 5);
    };
    el.preload = "metadata";
    el.onloadedmetadata = () => done(el.duration);
    el.onerror = () => done(5);
    el.src = url;
  });
}

export function TimelineScreen() {
  const { initial, live, pool, resolve, save, exportCut, exportJob, exporting } = useTimeline();
  const [tl, setTl] = useState<Timeline | null>(null);
  const [selected, setSelected] = useState<{ track: string; clip: string } | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pxPerSec, setPxPerSec] = useState(48);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const raf = useRef(0);
  const playClock = useRef({ started: 0, base: 0 });
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (initial && !tl) setTl(initial);
  }, [initial, tl]);

  /** every edit funnels through here — updates local state, debounces the save */
  const apply = (next: Timeline) => {
    setTl(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(next), 700);
  };

  /* ---- transport ---- */
  const end = tl ? sequenceEnd(tl) : 0;
  useEffect(() => {
    if (!playing) return;
    playClock.current = { started: performance.now(), base: playhead };
    const tick = () => {
      const t = playClock.current.base + (performance.now() - playClock.current.started) / 1000;
      if (t >= end) {
        setPlayhead(end);
        setPlaying(false);
        return;
      }
      setPlayhead(t);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  /* ---- preview: the TOPMOST video clip under the playhead — later video
   * tracks composite on top (Video 2 = inserts over the base), so search
   * tracks last-to-first, matching the export's overlay order ---- */
  const activeClip = tl?.tracks
    .filter((t) => t.kind === "video")
    .reverse()
    .map((t) => t.clips.find((c) => playhead >= c.start && playhead < c.start + c.duration))
    .find(Boolean);
  const activeAsset = activeClip ? resolve(activeClip.asset) : undefined;
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !activeClip) return;
    const target = playhead - activeClip.start + activeClip.in;
    if (Math.abs(el.currentTime - target) > 0.35) el.currentTime = target;
    if (playing && el.paused) void el.play().catch(() => {});
    if (!playing && !el.paused) el.pause();
  }, [activeClip, playing, playhead]);

  if (!tl) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-fog">
        {live ? "Loading sequence…" : "Timeline needs a running studio core."}
      </div>
    );
  }

  /* ---- edit ops ---- */
  const addToTimeline = async (item: (typeof pool)[number]) => {
    const kind = TRACK_FOR_KIND[item.kind];
    if (!kind) return;
    const track = tl.tracks.find((t) => t.kind === kind) ?? tl.tracks[0];
    if (!track) return;
    const duration = snap(await probeDuration(item.url, item.kind));
    const clip: TimelineClip = {
      id: uid(),
      asset: item.relPath,
      label: item.name,
      start: snap(trackEnd(track)),
      in: 0,
      duration,
      transitionSec: 0,
    };
    apply({
      ...tl,
      tracks: tl.tracks.map((t) =>
        t.id === track.id ? { ...t, clips: [...t.clips, clip] } : t,
      ),
    });
    setSelected({ track: track.id, clip: clip.id });
  };

  const patchClip = (trackId: string, clipId: string, patch: Partial<TimelineClip>) => {
    apply({
      ...tl,
      tracks: tl.tracks.map((t) =>
        t.id !== trackId
          ? t
          : { ...t, clips: t.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)) },
      ),
    });
  };

  /** drop a clip onto an adjacent lane — only within the same track kind */
  const moveClip = (trackId: string, clipId: string, laneOffset: number) => {
    const idx = tl.tracks.findIndex((t) => t.id === trackId);
    const source = tl.tracks[idx];
    const target = tl.tracks[idx + laneOffset];
    if (!source || !target || target.id === source.id || target.kind !== source.kind) return;
    const clip = source.clips.find((c) => c.id === clipId);
    if (!clip) return;
    apply({
      ...tl,
      tracks: tl.tracks.map((t) =>
        t.id === source.id
          ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) }
          : t.id === target.id
            ? { ...t, clips: [...t.clips, clip] }
            : t,
      ),
    });
    setSelected({ track: target.id, clip: clipId });
  };

  const addVideoTrack = () => {
    const count = tl.tracks.filter((t) => t.kind === "video").length;
    // insert right after the last video track so the lanes stay grouped —
    // array order still means "later composites on top"
    const at = tl.tracks.reduce((m, t, i) => (t.kind === "video" ? i : m), -1) + 1;
    const tracks = [...tl.tracks];
    tracks.splice(at, 0, { id: uid(), kind: "video", name: `Video ${count + 1}`, muted: false, clips: [] });
    apply({ ...tl, tracks });
  };

  const removeTrack = (trackId: string) => {
    const track = tl.tracks.find((t) => t.id === trackId);
    if (!track || track.clips.length > 0) return;
    apply({ ...tl, tracks: tl.tracks.filter((t) => t.id !== trackId) });
    if (selected?.track === trackId) setSelected(null);
  };

  const removeSelected = () => {
    if (!selected) return;
    apply({
      ...tl,
      tracks: tl.tracks.map((t) =>
        t.id !== selected.track ? t : { ...t, clips: t.clips.filter((c) => c.id !== selected.clip) },
      ),
    });
    setSelected(null);
  };

  const razor = () => {
    if (!selected) return;
    const track = tl.tracks.find((t) => t.id === selected.track);
    const clip = track?.clips.find((c) => c.id === selected.clip);
    if (!track || !clip) return;
    const at = playhead;
    if (at <= clip.start + SNAP || at >= clip.start + clip.duration - SNAP) return;
    const left: TimelineClip = { ...clip, duration: snap(at - clip.start) };
    const right: TimelineClip = {
      ...clip,
      id: uid(),
      start: snap(at),
      in: clip.in + (at - clip.start),
      duration: snap(clip.start + clip.duration - at),
      transitionSec: 0,
    };
    apply({
      ...tl,
      tracks: tl.tracks.map((t) =>
        t.id !== track.id
          ? t
          : { ...t, clips: t.clips.flatMap((c) => (c.id === clip.id ? [left, right] : [c])) },
      ),
    });
  };

  const selectedClip = selected
    ? tl.tracks.find((t) => t.id === selected.track)?.clips.find((c) => c.id === selected.clip)
    : undefined;

  const width = Math.max(640, (end + 6) * pxPerSec);

  return (
    <div className="flex h-full flex-col">
      {/* ---- top: shot rail + preview ---- */}
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[220px] shrink-0 flex-col border-r hairline bg-[#0e0e10]">
          <div className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-fog">
            Shots & takes
          </div>
          <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto px-3 pb-3">
            {pool.map((a) => {
              const Icon = kindIcon[a.kind];
              return (
                <button
                  key={a.relPath}
                  title={`Add ${a.name} to the timeline`}
                  onClick={() => void addToTimeline(a)}
                  className="group relative aspect-video overflow-hidden rounded-lg border border-cream/5 bg-surface transition hover:border-gold/40"
                >
                  {a.url && a.kind === "image" && (
                    <img src={a.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  )}
                  {a.url && a.kind === "video" && (
                    <video src={a.url} preload="metadata" muted className="absolute inset-0 h-full w-full object-cover" />
                  )}
                  <Icon size={12} className="absolute left-1.5 top-1.5 text-cream/70" />
                  <span className="absolute inset-x-1 bottom-1 truncate text-left text-[9px] text-cream/75">
                    {a.name}
                  </span>
                </button>
              );
            })}
            {pool.length === 0 && (
              <p className="col-span-2 px-1 text-[11px] text-fog">
                Generate takes in the labs — they land here.
              </p>
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col bg-ink">
          <div className="relative m-4 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl border hairline bg-[#0a0a0b]">
            {activeAsset?.url ? (
              activeAsset.kind === "image" ? (
                <img src={activeAsset.url} alt="" className="max-h-full max-w-full object-contain" />
              ) : (
                <video ref={videoRef} src={activeAsset.url} muted={false} className="max-h-full max-w-full object-contain" />
              )
            ) : (
              <div className="flex flex-col items-center gap-2 text-fog">
                <Film size={22} className="text-gold/50" />
                <span className="text-[12px]">
                  {tl.tracks.some((t) => t.clips.length) ? "—" : "Add takes from the left rail to start the cut."}
                </span>
              </div>
            )}
            <span className="absolute bottom-2 right-3 rounded bg-ink/70 px-1.5 py-0.5 text-[11px] tabular-nums text-cream/85">
              {fmt(playhead)} / {fmt(end)}
            </span>
          </div>

          {/* transport + clip inspector */}
          <div className="flex items-center gap-2 px-4 pb-3">
            <button
              onClick={() => {
                setPlaying(false);
                setPlayhead(0);
              }}
              title="Back to start"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-fog transition hover:bg-cream/5 hover:text-cream"
            >
              <SkipBack size={14} />
            </button>
            <button
              onClick={() => setPlaying((p) => !p)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-gold text-ink transition hover:brightness-110"
              title={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
            </button>
            <button
              onClick={razor}
              disabled={!selectedClip}
              title="Razor: split the selected clip at the playhead"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-fog transition hover:bg-cream/5 hover:text-cream disabled:opacity-30"
            >
              <Scissors size={14} />
            </button>
            <button
              onClick={removeSelected}
              disabled={!selectedClip}
              title="Delete selected clip"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-fog transition hover:bg-cream/5 hover:text-ember disabled:opacity-30"
            >
              <Trash2 size={14} />
            </button>
            {selectedClip && selected && (
              <label className="ml-2 flex items-center gap-1.5 text-[11px] text-fog">
                Crossfade
                <input
                  type="number"
                  min={0}
                  max={Math.max(0, selectedClip.duration - 0.1)}
                  step={0.1}
                  value={selectedClip.transitionSec}
                  onChange={(e) =>
                    patchClip(selected.track, selected.clip, {
                      transitionSec: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className="w-14 rounded border border-cream/10 bg-surface px-1.5 py-0.5 tabular-nums text-cream/90 focus:border-gold/35 focus:outline-none"
                />
                s
              </label>
            )}
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => {
                  clearTimeout(saveTimer.current);
                  void exportCut(tl);
                }}
                disabled={exporting || end <= 0}
                title={
                  exportJob?.status === "failed"
                    ? `Last export failed: ${exportJob.error ?? "unknown error"} — click to retry`
                    : "Render the cut to an mp4 (lands in the project's video assets)"
                }
                className={cx(
                  "mr-2 flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[11px] font-semibold transition",
                  exporting
                    ? "border-gold/25 text-gold/80"
                    : "border-gold/40 text-gold hover:bg-gold/10",
                  end <= 0 && "opacity-30",
                )}
              >
                {exporting ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Exporting…{exportJob?.status === "running" ? ` ${Math.round(exportJob.progress)}%` : ""}
                  </>
                ) : (
                  <>
                    <Clapperboard size={12} />
                    {exportJob?.status === "completed" ? "Export again" : "Export"}
                  </>
                )}
              </button>
              <button
                onClick={() => setPxPerSec((z) => Math.max(16, z / 1.5))}
                title="Zoom out"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-fog transition hover:bg-cream/5 hover:text-cream"
              >
                <ZoomOut size={14} />
              </button>
              <button
                onClick={() => setPxPerSec((z) => Math.min(240, z * 1.5))}
                title="Zoom in"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-fog transition hover:bg-cream/5 hover:text-cream"
              >
                <ZoomIn size={14} />
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* ---- bottom: tracks ---- */}
      <div
        style={{ height: Math.min(348, RULER_H + tl.tracks.length * TRACK_H + 30) }}
        className="shrink-0 border-t hairline bg-[#0e0e10]"
      >
        <div className="flex h-full">
          <div className="w-[120px] shrink-0 border-r hairline">
            <div style={{ height: RULER_H }} />
            {tl.tracks.map((track, ti) => {
              const extra = tl.tracks.findIndex((t) => t.kind === track.kind) !== ti;
              return (
                <div
                  key={track.id}
                  style={{ height: TRACK_H }}
                  className="group flex items-center justify-between border-b border-cream/5 px-3"
                >
                  <span
                    title={extra && track.kind === "video" ? "Clips here appear over the tracks above" : undefined}
                    className="min-w-0 truncate text-[11px] font-medium capitalize text-cream/85"
                  >
                    {track.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {extra && track.clips.length === 0 && (
                      <button
                        onClick={() => removeTrack(track.id)}
                        title="Remove empty track"
                        className="text-fog/0 transition group-hover:text-fog hover:text-ember!"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                    <button
                      onClick={() =>
                        apply({
                          ...tl,
                          tracks: tl.tracks.map((t) =>
                            t.id === track.id ? { ...t, muted: !t.muted } : t,
                          ),
                        })
                      }
                      title={track.muted ? "Unmute" : "Mute"}
                      className={cx("transition", track.muted ? "text-ember" : "text-fog hover:text-cream")}
                    >
                      {track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                    </button>
                  </span>
                </div>
              );
            })}
            <button
              onClick={addVideoTrack}
              title="Add a video track — its clips composite over the tracks above (inserts, cutaways)"
              className="flex h-[26px] w-full items-center gap-1.5 px-3 text-[10px] font-medium text-fog transition hover:text-gold"
            >
              <Plus size={11} /> Video track
            </button>
          </div>

          <div className="relative flex-1 overflow-x-auto overflow-y-hidden">
            <div style={{ width }} className="relative">
              {/* ruler — click to seek */}
              <div
                style={{ height: RULER_H }}
                className="relative cursor-pointer border-b border-cream/8"
                onPointerDown={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setPlayhead(snap((e.clientX - rect.left) / pxPerSec));
                  setPlaying(false);
                }}
              >
                {Array.from({ length: Math.ceil(width / pxPerSec) }, (_, s) => (
                  <span
                    key={s}
                    style={{ left: s * pxPerSec }}
                    className="absolute top-1 text-[9px] tabular-nums text-fog/70"
                  >
                    {s % Math.max(1, Math.round(64 / pxPerSec)) === 0 ? `${s}s` : "·"}
                  </span>
                ))}
              </div>

              {tl.tracks.map((track) => (
                <TrackLane
                  key={track.id}
                  track={track}
                  pxPerSec={pxPerSec}
                  selected={selected?.track === track.id ? selected.clip : null}
                  onSelect={(clipId) => setSelected({ track: track.id, clip: clipId })}
                  onPatch={(clipId, patch) => patchClip(track.id, clipId, patch)}
                  onMoveVertical={(clipId, laneOffset) => moveClip(track.id, clipId, laneOffset)}
                />
              ))}

              {/* playhead */}
              <div
                style={{ left: playhead * pxPerSec, height: RULER_H + tl.tracks.length * TRACK_H }}
                className="pointer-events-none absolute top-0 w-px bg-gold"
              >
                <div className="-ml-[4px] h-0 w-0 border-x-[4px] border-t-[6px] border-x-transparent border-t-gold" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackLane({
  track,
  pxPerSec,
  selected,
  onSelect,
  onPatch,
  onMoveVertical,
}: {
  track: TimelineTrack;
  pxPerSec: number;
  selected: string | null;
  onSelect: (clipId: string) => void;
  onPatch: (clipId: string, patch: Partial<TimelineClip>) => void;
  onMoveVertical: (clipId: string, laneOffset: number) => void;
}) {
  return (
    <div style={{ height: TRACK_H }} className="relative border-b border-cream/5">
      {track.clips.map((clip) => (
        <Clip
          key={clip.id}
          clip={clip}
          pxPerSec={pxPerSec}
          kind={track.kind}
          selected={selected === clip.id}
          muted={track.muted}
          onSelect={() => onSelect(clip.id)}
          onPatch={(patch) => onPatch(clip.id, patch)}
          onMoveVertical={(laneOffset) => onMoveVertical(clip.id, laneOffset)}
        />
      ))}
    </div>
  );
}

type DragMode = "move" | "trim-l" | "trim-r";

function Clip({
  clip,
  pxPerSec,
  kind,
  selected,
  muted,
  onSelect,
  onPatch,
  onMoveVertical,
}: {
  clip: TimelineClip;
  pxPerSec: number;
  kind: TimelineTrack["kind"];
  selected: boolean;
  muted: boolean;
  onSelect: () => void;
  onPatch: (patch: Partial<TimelineClip>) => void;
  onMoveVertical: (laneOffset: number) => void;
}) {
  const drag = useRef<{ mode: DragMode; x: number; y: number; start: number; in: number; duration: number } | null>(null);

  const onPointerDown = (mode: DragMode) => (e: React.PointerEvent) => {
    e.stopPropagation();
    onSelect();
    drag.current = { mode, x: e.clientX, y: e.clientY, start: clip.start, in: clip.in, duration: clip.duration };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / pxPerSec;
    if (d.mode === "move") {
      onPatch({ start: snap(Math.max(0, d.start + dx)) });
    } else if (d.mode === "trim-r") {
      onPatch({ duration: snap(Math.max(SNAP, d.duration + dx)) });
    } else {
      const delta = Math.min(Math.max(dx, -d.in), d.duration - SNAP);
      onPatch({
        start: snap(d.start + delta),
        in: Math.max(0, d.in + delta),
        duration: snap(Math.max(SNAP, d.duration - delta)),
      });
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    // releasing a moved clip over an adjacent lane re-tracks it (same kind only)
    if (d?.mode === "move") {
      const laneOffset = Math.round((e.clientY - d.y) / TRACK_H);
      if (laneOffset !== 0) onMoveVertical(laneOffset);
    }
  };

  const tone =
    kind === "video"
      ? "from-gold/70 to-gold-deep/70 border-gold/60"
      : kind === "voice"
        ? "from-[#4a6a8a]/70 to-[#22303e]/80 border-[#6a90b5]/50"
        : "from-[#4a7a5a]/70 to-[#20342a]/80 border-[#6ab58a]/50";

  return (
    <div
      style={{ left: clip.start * pxPerSec, width: Math.max(6, clip.duration * pxPerSec) }}
      className={cx(
        "absolute top-1.5 flex h-[44px] cursor-grab select-none items-center overflow-hidden rounded-md border bg-gradient-to-b px-1.5 active:cursor-grabbing",
        tone,
        selected && "ring-2 ring-cream/70",
        muted && "opacity-40",
      )}
      onPointerDown={onPointerDown("move")}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {clip.transitionSec > 0 && (
        <div
          style={{ width: Math.min(clip.transitionSec * pxPerSec, clip.duration * pxPerSec) }}
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-ink/60 to-transparent"
        />
      )}
      <span className="pointer-events-none truncate text-[10px] font-medium text-ink/90 mix-blend-luminosity">
        {clip.label || clip.asset.split("/").pop()}
      </span>
      {/* trim handles */}
      <div
        onPointerDown={onPointerDown("trim-l")}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-cream/20 opacity-0 hover:opacity-100"
      />
      <div
        onPointerDown={onPointerDown("trim-r")}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-cream/20 opacity-0 hover:opacity-100"
      />
    </div>
  );
}
