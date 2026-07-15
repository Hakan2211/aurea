/* One <audio> element per screen — whichever take/track last asked to play
 * owns it. Media URLs come from studiod's token-authed /media route. */

import { useCallback, useEffect, useRef, useState } from "react";

const fmt = (sec: number) => {
  if (!Number.isFinite(sec)) return "00:00.0";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
};

export interface AudioPlayer {
  /** the URL currently loaded (null = nothing) */
  src: string | null;
  playing: boolean;
  /** 0..1 through the current clip */
  played: number;
  position: string;
  total: string;
  /** play url (restarts if it's a different clip), or toggle pause when same */
  toggle: (url: string | undefined) => void;
}

export function useAudioPlayer(): AudioPlayer {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState({ position: 0, duration: 0 });

  useEffect(() => {
    const audio = new Audio();
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

  return {
    src,
    playing,
    played: time.duration > 0 ? time.position / time.duration : 0,
    position: fmt(time.position),
    total: fmt(time.duration),
    toggle,
  };
}
