/* Transport for a single <video> element the caller renders (the Video lab's
 * preview). Unlike useAudioPlayer this does NOT own the element — takes need
 * to stay mounted in the DOM for object-fit/fullscreen — so the hook hands
 * back a ref and mirrors the element's own events, which keeps the UI honest
 * when playback ends, stalls, or the user uses native controls.
 *
 * Sound is on by default. Chromium refuses unmuted autoplay until the page has
 * a user gesture, so a rejected play() falls back to muted playback and raises
 * `autoplayBlocked` — the UI shows an unmute affordance instead of silently
 * playing nothing. Volume/mute persist across takes and sessions. */

import { useCallback, useEffect, useRef, useState } from "react";

const fmt = (sec: number) => {
  if (!Number.isFinite(sec) || sec < 0) return "00:00.0";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
};

const VOLUME_KEY = "aurea.videoVolume";

function storedVolume(): { volume: number; muted: boolean } {
  try {
    const raw = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? "null");
    if (raw && typeof raw.volume === "number") {
      return { volume: Math.min(1, Math.max(0, raw.volume)), muted: !!raw.muted };
    }
  } catch {
    /* fall through to the default */
  }
  return { volume: 1, muted: false };
}

export interface VideoPlayer {
  /** attach to the <video> element you render */
  ref: React.RefObject<HTMLVideoElement | null>;
  playing: boolean;
  muted: boolean;
  /** 0..1 */
  volume: number;
  /** 0..1 through the clip */
  played: number;
  position: string;
  total: string;
  durationSec: number;
  /** playhead in seconds — what a "mark this bit" affordance works from */
  positionSec: number;
  /** true once the browser refused unmuted autoplay — offer an unmute button */
  autoplayBlocked: boolean;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  toggleMute: () => void;
  setVolume: (v: number) => void;
  /** seek to a 0..1 fraction of the clip */
  seekFraction: (f: number) => void;
  /** relative seek in seconds (clamped) */
  nudge: (sec: number) => void;
}

export function useVideoPlayer(src: string | undefined, autoPlay = true): VideoPlayer {
  const ref = useRef<HTMLVideoElement | null>(null);
  const initial = useRef(storedVolume());
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(initial.current.muted);
  const [volume, setVolumeState] = useState(initial.current.volume);
  const [time, setTime] = useState({ position: 0, duration: 0 });
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  /* mirror the element rather than guess at it — native controls, ended, and
   * stalls all move the real state without going through our buttons */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onTime = () => setTime({ position: el.currentTime, duration: el.duration || 0 });
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onVolume = () => {
      setMuted(el.muted);
      setVolumeState(el.volume);
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onTime);
    el.addEventListener("durationchange", onTime);
    el.addEventListener("seeked", onTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("playing", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onPause);
    el.addEventListener("volumechange", onVolume);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onTime);
      el.removeEventListener("durationchange", onTime);
      el.removeEventListener("seeked", onTime);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("playing", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onPause);
      el.removeEventListener("volumechange", onVolume);
    };
  }, [src]);

  /* a new take starts from the top at the remembered volume */
  useEffect(() => {
    const el = ref.current;
    if (!el || !src) return;
    el.volume = volume;
    el.muted = muted;
    setTime({ position: 0, duration: 0 });
    if (!autoPlay) return;
    void el.play().catch(() => {
      // Chromium's autoplay policy: retry muted so the take still animates
      if (!el.muted) {
        el.muted = true;
        setMuted(true);
        setAutoplayBlocked(true);
        void el.play().catch(() => {});
      }
    });
    // volume/muted are seeded here on purpose — later changes go through the
    // setters below, which write the element directly
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, autoPlay]);

  const persist = (v: number, m: boolean) => {
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume: v, muted: m }));
    } catch {
      /* private mode — volume just won't persist */
    }
  };

  const play = useCallback(() => {
    const el = ref.current;
    if (el) void el.play().catch(() => {});
  }, []);
  const pause = useCallback(() => ref.current?.pause(), []);
  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, []);

  const setVolume = useCallback((v: number) => {
    const el = ref.current;
    const next = Math.min(1, Math.max(0, v));
    setVolumeState(next);
    // raising the slider off zero is itself an unmute
    const nextMuted = next === 0;
    setMuted(nextMuted);
    setAutoplayBlocked(false);
    if (el) {
      el.volume = next;
      el.muted = nextMuted;
    }
    persist(next, nextMuted);
  }, []);

  const toggleMute = useCallback(() => {
    const el = ref.current;
    setMuted((m) => {
      const next = !m;
      if (el) {
        el.muted = next;
        // unmuting from a zero slider needs an audible level to mean anything
        if (!next && el.volume === 0) {
          el.volume = 0.8;
          setVolumeState(0.8);
        }
        persist(el.volume, next);
      }
      if (!next) setAutoplayBlocked(false);
      return next;
    });
  }, []);

  const seekFraction = useCallback((f: number) => {
    const el = ref.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    const t = Math.min(el.duration, Math.max(0, f * el.duration));
    el.currentTime = t;
    setTime({ position: t, duration: el.duration });
  }, []);

  const nudge = useCallback((sec: number) => {
    const el = ref.current;
    if (!el) return;
    const max = Number.isFinite(el.duration) ? el.duration : el.currentTime + sec;
    const t = Math.min(max, Math.max(0, el.currentTime + sec));
    el.currentTime = t;
    setTime({ position: t, duration: el.duration || 0 });
  }, []);

  return {
    ref,
    playing,
    muted,
    volume,
    played: time.duration > 0 ? Math.min(1, time.position / time.duration) : 0,
    position: fmt(time.position),
    total: fmt(time.duration),
    durationSec: time.duration,
    positionSec: time.position,
    autoplayBlocked,
    toggle,
    play,
    pause,
    toggleMute,
    setVolume,
    seekFraction,
    nudge,
  };
}
