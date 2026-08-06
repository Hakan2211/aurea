/* One <audio> element per screen — whichever take/track last asked to play
 * owns it. Media URLs come from studiod's token-authed /media route. */

import { useCallback, useEffect, useRef, useState } from "react";

const fmt = (sec: number) => {
  if (!Number.isFinite(sec)) return "00:00.0";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
};

/** Volume, mute and playback speed are per-user, not per-clip — they outlive
 * the take, the screen and the session. */
const PREFS_KEY = "aurea.audioPrefs";

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

function storedPrefs(): { volume: number; muted: boolean; rate: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null");
    if (raw && typeof raw.volume === "number") {
      return {
        volume: Math.min(1, Math.max(0, raw.volume)),
        muted: !!raw.muted,
        rate: PLAYBACK_RATES.includes(raw.rate) ? raw.rate : 1,
      };
    }
  } catch {
    /* fall through to the default */
  }
  return { volume: 1, muted: false, rate: 1 };
}

export interface AudioPlayer {
  /** the URL currently loaded (null = nothing) */
  src: string | null;
  playing: boolean;
  /** 0..1 through the current clip */
  played: number;
  position: string;
  total: string;
  /** clip length in seconds (0 until metadata lands) */
  durationSec: number;
  /** 0..1 */
  volume: number;
  muted: boolean;
  /** playback speed multiplier — one of PLAYBACK_RATES */
  rate: number;
  /** play url (restarts if it's a different clip), or toggle pause when same */
  toggle: (url: string | undefined) => void;
  pause: () => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  setRate: (r: number) => void;
  /** seek to a 0..1 fraction of the clip */
  seekFraction: (f: number) => void;
  /** relative seek in seconds (clamped to the clip) */
  nudge: (sec: number) => void;
}

export function useAudioPlayer(): AudioPlayer {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState({ position: 0, duration: 0 });
  const [prefs, setPrefs] = useState(storedPrefs);
  // the element is created once, after prefs — keep a ref so the setup effect
  // doesn't have to re-run (and restart playback) when they change
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    const audio = new Audio();
    audio.volume = prefsRef.current.muted ? 0 : prefsRef.current.volume;
    audio.playbackRate = prefsRef.current.rate;
    audioRef.current = audio;
    const onTime = () => setTime({ position: audio.currentTime, duration: audio.duration || 0 });
    const onEnd = () => setPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onTime);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onTime);
      audio.removeEventListener("ended", onEnd);
      audioRef.current = null;
    };
  }, []);

  // mirror prefs onto the element and remember them for next time
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = prefs.muted ? 0 : prefs.volume;
      audio.playbackRate = prefs.rate;
    }
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }, [prefs]);

  const toggle = useCallback(
    (url: string | undefined) => {
      const audio = audioRef.current;
      if (!audio || !url) return;
      if (src === url) {
        if (audio.paused) void audio.play();
        else audio.pause();
        setPlaying(audio.paused ? false : true);
        return;
      }
      audio.src = url;
      setSrc(url);
      setTime({ position: 0, duration: 0 });
      void audio.play();
      setPlaying(true);
    },
    [src],
  );

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
  }, []);

  const seekTo = useCallback((sec: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    audio.currentTime = Math.min(audio.duration, Math.max(0, sec));
    setTime({ position: audio.currentTime, duration: audio.duration });
  }, []);

  return {
    src,
    playing,
    played: time.duration > 0 ? time.position / time.duration : 0,
    position: fmt(time.position),
    total: fmt(time.duration),
    durationSec: time.duration,
    volume: prefs.volume,
    muted: prefs.muted,
    rate: prefs.rate,
    toggle,
    pause,
    setVolume: (v) =>
      setPrefs((p) => ({ ...p, volume: Math.min(1, Math.max(0, v)), muted: v <= 0 })),
    toggleMute: () => setPrefs((p) => ({ ...p, muted: !p.muted })),
    setRate: (rate) => setPrefs((p) => ({ ...p, rate })),
    seekFraction: (f) => seekTo((audioRef.current?.duration ?? 0) * f),
    nudge: (sec) => seekTo((audioRef.current?.currentTime ?? 0) + sec),
  };
}

/* ---------- duration probe ---------- */

const fmtClock = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/** metadata probes are cheap but not free — remember every answer for the session */
const durationCache = new Map<string, number>();

/** "m:ss" length of a media URL, probed from its metadata ("" while unknown).
 * The library scan carries no duration, so cards probe client-side. */
export function useMediaDuration(url: string | undefined): string {
  const [sec, setSec] = useState<number | null>(() =>
    url ? (durationCache.get(url) ?? null) : null,
  );
  useEffect(() => {
    if (!url) {
      setSec(null);
      return;
    }
    const cached = durationCache.get(url);
    if (cached !== undefined) {
      setSec(cached);
      return;
    }
    let alive = true;
    const el = document.createElement("audio");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) {
        durationCache.set(url, el.duration);
        if (alive) setSec(el.duration);
      }
      el.src = "";
    };
    el.onerror = () => {
      el.src = "";
    };
    el.src = url;
    return () => {
      alive = false;
    };
  }, [url]);
  return sec != null && Number.isFinite(sec) ? fmtClock(sec) : "";
}
