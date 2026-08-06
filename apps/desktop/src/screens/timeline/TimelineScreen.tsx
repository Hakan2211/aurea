/* Timeline — the sequence editor (PRD F8). Rail of takes on the left, program
 * monitor in the middle, clip inspector on the right, lanes below. Drag to
 * move, edge-drag to trim, razor at the playhead, per-clip crossfade, per-track
 * mute/gain. Edits live in local state and save whole-document (debounced)
 * through useTimeline. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, Loader2 } from "lucide-react";
import type { Timeline, TimelineClip, TimelineTrack } from "@aurea/shared";
import { useTimeline } from "@/hooks";
import { GoldButton, cx } from "@/components/ui";
import { Inspector } from "./Inspector";
import { MediaRail, type PoolItem } from "./MediaRail";
import { Monitor } from "./Monitor";
import { Tracks } from "./Tracks";
import {
  FRAME,
  clampZoom,
  clipCount,
  fmtTc,
  probeDuration,
  sequenceEnd,
  snap,
  trackEnd,
  uid,
} from "./shared";

/** which track a library kind lands on */
const TRACK_FOR_KIND: Record<string, TimelineTrack["kind"]> = {
  video: "video",
  image: "video",
  audio: "voice",
  music: "music",
};

const ZONE_MIN = 190;
const ZONE_MAX = 700;

export function TimelineScreen() {
  const { project, initial, loading, pool, resolve, save, exportCut, exportJob, exporting } =
    useTimeline();
  const [tl, setTl] = useState<Timeline | null>(null);
  const [selected, setSelected] = useState<{ track: string; clip: string } | null>(null);
  const [playhead, setPlayheadRaw] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pxPerSec, setPxPerSec] = useState(48);
  const [zoneH, setZoneH] = useState(320);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const raf = useRef(0);
  const playClock = useRef({ started: 0, base: 0 });
  /** latest handlers, so the global key listener needs no re-binding */
  const keyOps = useRef<Record<string, () => void>>({});
  /** Tracks owns the viewport width, so it hands its "fit" up here for F */
  const fitRef = useRef<() => void>(() => {});

  /* Which project the document in `tl` belongs to. Without this the screen
   * initialised once and kept editing whatever it first loaded: switch project
   * (or have the active one resolve late) and the next debounced save writes
   * project A's document into project B's file — which is exactly how a cut
   * gets replaced by an empty one. The cut in state always names its project,
   * and a pending save is dropped the moment the project changes. */
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!project) return;
    if (loadedFor.current !== project) {
      clearTimeout(saveTimer.current);
      setTl(initial ?? null);
      setSelected(null);
      setPlayheadRaw(0);
      setPlaying(false);
      if (initial) loadedFor.current = project;
      return;
    }
    if (!tl && initial) setTl(initial);
  }, [initial, project, tl]);

  /** every edit funnels through here — updates local state, debounces the save */
  const apply = useCallback(
    (next: Timeline) => {
      setTl(next);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(next), 700);
    },
    [save],
  );

  const end = tl ? sequenceEnd(tl) : 0;
  const setPlayhead = useCallback(
    (t: number) => setPlayheadRaw(Math.max(0, Math.min(end || t, t))),
    [end],
  );

  /* ---- transport clock ---- */
  useEffect(() => {
    if (!playing) return;
    playClock.current = { started: performance.now(), base: playhead };
    const tick = () => {
      const t = playClock.current.base + (performance.now() - playClock.current.started) / 1000;
      if (t >= end) {
        setPlayheadRaw(end);
        setPlaying(false);
        return;
      }
      setPlayheadRaw(t);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  /* ---- keyboard: the transport and the razor, the way an NLE binds them ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const op = keyOps.current[e.key];
      if (!op) return;
      e.preventDefault();
      op();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---- edit ops ---- */
  const addToTimeline = async (item: PoolItem) => {
    if (!tl) return;
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
      tracks: tl.tracks.map((t) => (t.id === track.id ? { ...t, clips: [...t.clips, clip] } : t)),
    });
    setSelected({ track: track.id, clip: clip.id });
  };

  const patchClip = (trackId: string, clipId: string, patch: Partial<TimelineClip>) => {
    if (!tl) return;
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
    if (!tl) return;
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

  const removeSelected = () => {
    if (!tl || !selected) return;
    apply({
      ...tl,
      tracks: tl.tracks.map((t) =>
        t.id !== selected.track
          ? t
          : { ...t, clips: t.clips.filter((c) => c.id !== selected.clip) },
      ),
    });
    setSelected(null);
  };

  const razor = () => {
    if (!tl || !selected) return;
    const track = tl.tracks.find((t) => t.id === selected.track);
    const clip = track?.clips.find((c) => c.id === selected.clip);
    if (!track || !clip) return;
    const at = playhead;
    if (at <= clip.start + FRAME || at >= clip.start + clip.duration - FRAME) return;
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

  /** how many clips point at each library file — the rail's "in cut" state */
  const usedCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const track of tl?.tracks ?? [])
      for (const clip of track.clips) counts[clip.asset] = (counts[clip.asset] ?? 0) + 1;
    return counts;
  }, [tl]);

  /** every cut point in the sequence — what ⟨ ⟩ and ↑ ↓ jump between */
  const cuts = useMemo(() => {
    if (!tl) return [0];
    return [
      0,
      ...new Set(tl.tracks.flatMap((t) => t.clips.flatMap((c) => [c.start, c.start + c.duration]))),
    ].sort((a, b) => a - b);
  }, [tl]);
  const stepCut = (dir: -1 | 1) => {
    const next =
      dir < 0
        ? [...cuts].reverse().find((t) => t < playhead - 0.01)
        : cuts.find((t) => t > playhead + 0.01);
    setPlaying(false);
    setPlayhead(next ?? (dir < 0 ? 0 : end));
  };

  keyOps.current = {
    " ": () => setPlaying((p) => !p),
    ArrowLeft: () => {
      setPlaying(false);
      setPlayhead(snap(playhead - FRAME));
    },
    ArrowRight: () => {
      setPlaying(false);
      setPlayhead(snap(playhead + FRAME));
    },
    ArrowUp: () => stepCut(-1),
    ArrowDown: () => stepCut(1),
    Home: () => setPlayhead(0),
    End: () => setPlayhead(end),
    s: razor,
    S: razor,
    Delete: removeSelected,
    Backspace: removeSelected,
    f: () => fitRef.current(),
    F: () => fitRef.current(),
    "+": () => setPxPerSec((z) => clampZoom(z * 1.5)),
    "=": () => setPxPerSec((z) => clampZoom(z * 1.5)),
    "-": () => setPxPerSec((z) => clampZoom(z / 1.5)),
    Escape: () => setSelected(null),
  };

  if (!tl) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-fog">
        {loading ? "Loading sequence…" : "Timeline needs a running studio core."}
      </div>
    );
  }

  const selectedTrack = selected ? tl.tracks.find((t) => t.id === selected.track) : undefined;
  const selectedClip = selected
    ? selectedTrack?.clips.find((c) => c.id === selected.clip)
    : undefined;

  /* ---- the splitter between the monitor and the lanes ---- */
  const onSplitter = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const y0 = e.clientY;
    const h0 = zoneH;
    const move = (ev: PointerEvent) =>
      setZoneH(Math.max(ZONE_MIN, Math.min(ZONE_MAX, h0 - (ev.clientY - y0))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-4 border-b hairline px-5 py-3">
        <div className="min-w-0">
          <h1 className="font-serif text-lg font-semibold leading-tight text-cream">Timeline</h1>
          <p className="mt-0.5 flex items-center gap-2 truncate text-xs text-fog">
            <span className="tabular-nums">{fmtTc(end, end >= 3600)}</span>
            <span className="text-fog/40">·</span>
            <span>{clipCount(tl)} clips</span>
            <span className="text-fog/40">·</span>
            <span>{tl.tracks.length} tracks</span>
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <GoldButton
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
          >
            {exporting ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Exporting…
                {exportJob?.status === "running" ? ` ${Math.round(exportJob.progress)}%` : ""}
              </>
            ) : (
              <>
                <Clapperboard size={12} />
                {exportJob?.status === "completed" ? "Export again" : "Export"}
              </>
            )}
          </GoldButton>
        </div>
      </header>

      {/* ---- top: rail + monitor + inspector ---- */}
      <div className="flex min-h-0 flex-1">
        <MediaRail
          pool={pool}
          usedCounts={usedCounts}
          onAdd={(item) => void addToTimeline(item)}
        />
        <Monitor
          tl={tl}
          resolve={resolve}
          playhead={playhead}
          setPlayhead={setPlayhead}
          playing={playing}
          setPlaying={setPlaying}
          end={end}
          onStepCut={stepCut}
        />
        <Inspector
          tl={tl}
          clip={selectedClip}
          track={selectedTrack}
          asset={selectedClip ? resolve(selectedClip.asset) : undefined}
          onPatch={(patch) => selected && patchClip(selected.track, selected.clip, patch)}
          onDelete={removeSelected}
          exportState={{
            status: exportJob?.status,
            progress: exportJob?.progress,
            error: exportJob?.error,
          }}
        />
      </div>

      {/* ---- the grab bar: the lanes are worth more height on a long cut ---- */}
      <div
        onPointerDown={onSplitter}
        title="Drag to resize the timeline"
        className={cx(
          "group relative h-[7px] shrink-0 cursor-row-resize border-t hairline bg-[#0b0b0d]",
        )}
      >
        <span className="absolute left-1/2 top-1/2 h-[3px] w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cream/10 transition-colors duration-150 group-hover:bg-gold/60" />
      </div>

      {/* ---- bottom: lanes ---- */}
      <div style={{ height: zoneH }} className="flex shrink-0 flex-col">
        <Tracks
          tl={tl}
          pxPerSec={pxPerSec}
          setPxPerSec={setPxPerSec}
          playhead={playhead}
          setPlayhead={setPlayhead}
          playing={playing}
          selected={selected}
          onSelect={setSelected}
          resolve={resolve}
          onPatchClip={patchClip}
          onMoveClip={moveClip}
          onApply={apply}
          onRazor={razor}
          onDelete={removeSelected}
          registerFit={(fn) => {
            fitRef.current = fn;
          }}
        />
      </div>
    </div>
  );
}
