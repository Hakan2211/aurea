import { useState } from "react";
import { useLikes, useMusicLab } from "@/hooks";
import type { MusicTrack } from "@/data/sample";
import { useAudioPlayer } from "@/components/useAudioPlayer";
import { MusicAdvanced, MusicComposer, useMusicParams } from "./music/create";
import { useLabDrawer } from "@/components/ui";
import { TracksPanel } from "./music/tracks";
import { TrackInspector } from "./music/inspector";
import { PlayerBar } from "./music/player";

/* Music lab — simple by default since the UI simplify plan, Stage 3: track
 * list and inspector on top, the composer under them, the rest in the
 * Advanced drawer. Originally built to design-refs/2026-08-06-ui-mockups/music-lab-v1.jpg
 * with v2's grafts (cover art per track, date+time metadata, the "Generating
 * your track…" status line, stem toggles); verdicts in that folder's
 * DECISIONS.md. Create rail → track list → inspector, over ACE-Step local,
 * with the transport pinned across the bottom. Data flows through
 * useMusicLab (tRPC seam). */

export function MusicLab() {
  const lab = useMusicLab();
  const player = useAudioPlayer();
  const likes = useLikes();
  const [trackId, setTrackId] = useState<string | null>(null);
  const p = useMusicParams();
  const { drawer, setDrawer, toggle } = useLabDrawer("music", ["advanced"] as const);
  const playable = lab.tracks.filter((t) => !t.generating);
  const track: MusicTrack | undefined =
    playable.find((t) => t.id === trackId) ?? playable.find((t) => t.selected) ?? playable[0];

  /** transport skip — walks the list in the order the centre column shows it */
  const step = (delta: number) => {
    if (!track) return;
    const i = playable.findIndex((t) => t.id === track.id);
    const next = playable[i + delta];
    if (!next) return;
    setTrackId(next.id);
    if (player.playing && next.url) player.toggle(next.url);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <TracksPanel
              trackId={track?.id ?? ""}
              player={player}
              likes={likes}
              onSelect={setTrackId}
            />
            {track && <TrackInspector track={track} player={player} likes={likes} />}
          </div>
          <MusicComposer
            p={p}
            advancedOpen={drawer === "advanced"}
            onToggleAdvanced={() => toggle("advanced")}
          />
        </div>
        {drawer === "advanced" && <MusicAdvanced p={p} onClose={() => setDrawer(null)} />}
      </div>
      <PlayerBar track={track} player={player} likes={likes} onStep={step} />
    </div>
  );
}
