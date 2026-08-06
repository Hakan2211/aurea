import { useState } from "react";
import { AudioLines, X } from "lucide-react";
import { cx } from "@/components/ui";
import {
  IMPROV_GAP_SEC,
  clampSec,
  fmtTime,
  useTakeDurations,
  type DirectorTake,
} from "../shared";

/** The audio lane — the cast's real voices at exact timecodes.
 *
 * Each take is locked where it's placed (LTX lip-syncs to it and cannot
 * overwrite it); everything between takes is left free for the model to score.
 * Overlapping takes are mixed together rather than one replacing the other,
 * which is how two characters end up talking over each other on purpose.
 *
 * What the model does with the free air was measured on the 07-25 breakroom
 * runs and is not what "room tone" suggests: sub-second holes came back
 * silent, and a 2.7s hole came back as *invented dialogue* — audio and moving
 * mouth both. Hence the warning below rather than a promise of ambience. */
export function AudioLane({
  sources,
  lane,
  setLane,
  durationSec,
  roomTone,
  setRoomTone,
}: {
  sources: { relPath: string; name: string; url?: string }[];
  lane: DirectorTake[];
  setLane: (fn: (l: DirectorTake[]) => DirectorTake[]) => void;
  durationSec: number;
  roomTone: boolean;
  setRoomTone: (v: boolean) => void;
}) {
  const [picking, setPicking] = useState(false);
  const durations = useTakeDurations(sources);
  const nameOf = (rel: string) => sources.find((s) => s.relPath === rel)?.name ?? rel.split("/").pop();

  /* where each take actually lands, mirroring fitAudio() in the builder: a
   * take is cut off at the end of the shot, and one placed past the end never
   * plays at all */
  const blocks = lane.map((t) => {
    const full = durations[t.take];
    const heard = full === undefined ? undefined : Math.max(0, full - t.trimStartSec);
    const room = Math.max(0, durationSec - t.atSec);
    return {
      start: t.atSec,
      length: heard === undefined ? undefined : Math.min(heard, room),
      clipped: heard !== undefined && heard > room + 0.05,
      lost: t.atSec >= durationSec,
      unknown: heard === undefined || heard === 0,
    };
  });
  const overlapping = blocks.some((b, i) =>
    blocks.some(
      (o, j) =>
        j !== i &&
        b.length !== undefined &&
        o.length !== undefined &&
        b.start < o.start + o.length &&
        o.start < b.start + b.length,
    ),
  );
  /* What LTX is left to score. Measured off the union of the takes, not their
   * sum, so a deliberate talk-over doesn't read as double the dialogue — and
   * the LONGEST single hole matters on its own, because that's the one the
   * model improvises into (see the warning below). */
  const { gap, longestGap } = (() => {
    const taken = blocks
      .filter((b) => !b.lost && b.length)
      .map((b) => ({ from: b.start, to: b.start + b.length! }))
      .sort((a, b) => a.from - b.from);
    let covered = 0;
    let end = 0;
    let longest = 0;
    for (const r of taken) {
      if (r.from > end) longest = Math.max(longest, r.from - end);
      covered += Math.max(0, r.to - Math.max(end, r.from));
      end = Math.max(end, r.to);
    }
    longest = Math.max(longest, durationSec - end);
    return { gap: Math.max(0, durationSec - covered), longestGap: longest };
  })();

  return (
    <div className="relative mt-3 border-t hairline pt-3">
      <div className="flex items-center justify-between">
        <h4 className="text-2xs font-semibold uppercase tracking-[0.14em] text-fog">
          Audio lane
        </h4>
        <button
          onClick={() => setPicking((p) => !p)}
          className="inline-flex items-center gap-1 text-2xs text-fog transition hover:text-gold"
        >
          <AudioLines size={10} /> Add take
        </button>
      </div>

      {lane.length === 0 && !picking ? (
        <p className="mt-1.5 text-2xs leading-relaxed text-fog/70">
          The shot scores itself. Add voice takes to lock dialogue to exact timecodes — each
          character lip-syncs their own line, in one continuous render.
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {/* the shot ruler: gold where a take is locked, dark where LTX is free */}
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-cream/8">
            {blocks.map((b, i) =>
              b.lost ? null : (
                <div
                  key={i}
                  title={nameOf(lane[i].take)}
                  style={{
                    left: `${(b.start / Math.max(durationSec, 0.1)) * 100}%`,
                    width: b.length ? `${(b.length / Math.max(durationSec, 0.1)) * 100}%` : "2px",
                  }}
                  className={cx(
                    "absolute inset-y-0 rounded-full",
                    b.unknown ? "bg-gold/50" : i % 2 ? "bg-gold/60" : "bg-gold/90",
                  )}
                />
              ),
            )}
          </div>

          {lane.map((t, i) => (
            <div
              key={`${t.take}-${i}`}
              className={cx(
                "flex items-center gap-2 rounded-xl border bg-surface px-2.5 py-1.5",
                blocks[i].lost ? "border-red-500/30" : "border-cream/10",
              )}
            >
              <input
                type="number"
                min={0}
                max={durationSec}
                step={0.1}
                value={t.atSec}
                title="When this line starts"
                onChange={(e) =>
                  setLane((l) =>
                    l.map((x, j) =>
                      j === i ? { ...x, atSec: clampSec(Number(e.target.value), durationSec) } : x,
                    ),
                  )
                }
                className="w-10 shrink-0 bg-transparent text-2xs tabular-nums text-gold focus:outline-none"
              />
              <span className="min-w-0 flex-1 truncate text-xs text-cream/85">
                {nameOf(t.take)}
              </span>
              <span className="shrink-0 text-[9px] tabular-nums text-fog/60">
                {blocks[i].length !== undefined ? fmtTime(blocks[i].length!) : "…"}
              </span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={t.trimStartSec}
                title="Skip this far into the take before it plays"
                onChange={(e) =>
                  setLane((l) =>
                    l.map((x, j) =>
                      j === i
                        ? { ...x, trimStartSec: Math.max(0, Number(e.target.value) || 0) }
                        : x,
                    ),
                  )
                }
                // the spinner arrows eat half of a control this narrow
                className="w-9 shrink-0 rounded-md border border-cream/10 bg-ink px-1 py-0.5 text-2xs tabular-nums text-cream/70 outline-none [appearance:textfield] focus:border-gold/40 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <button
                onClick={() => setLane((l) => l.filter((_, j) => j !== i))}
                className="shrink-0 text-fog/60 transition hover:text-red-400"
              >
                <X size={12} />
              </button>
            </div>
          ))}

          {/* room tone — what happens in the silence between the lines */}
          <label className="flex cursor-pointer items-center gap-2 pt-0.5">
            <input
              type="checkbox"
              checked={roomTone}
              onChange={(e) => setRoomTone(e.target.checked)}
              className="accent-gold"
            />
            <span className="text-2xs text-fog">Score the gaps ({fmtTime(gap)})</span>
          </label>

          {blocks.some((b) => b.lost) ? (
            <p className="text-2xs leading-relaxed text-red-300">
              A take starts after the shot ends — it never plays. Move it earlier or make the clip
              longer.
            </p>
          ) : blocks.some((b) => b.clipped) ? (
            <p className="text-2xs leading-relaxed text-gold/75">
              A take runs past the end of the shot and gets cut off mid-line. Lengthen the clip, or
              trim the take's lead-in.
            </p>
          ) : overlapping ? (
            <p className="text-2xs leading-relaxed text-gold/75">
              Two takes overlap — they'll be heard together. Fine for a talk-over, otherwise move
              one along.
            </p>
          ) : roomTone && longestGap > IMPROV_GAP_SEC ? (
            // measured 07-25: a 2.7s hole came back as invented speech with the
            // mouth movement to match, while sub-second holes stayed silent
            <p className="text-2xs leading-relaxed text-gold/75">
              {fmtTime(longestGap)} of open air with scoring on — LTX tends to improvise dialogue
              into a gap this long, lip-sync and all. Turn scoring off and lay room tone on the
              Timeline instead.
            </p>
          ) : (
            <p className="text-2xs leading-relaxed text-fog/70">
              {roomTone
                ? "Locked lines drive lip-sync. Short gaps between them come back near-silent, which is usually what a scene wants."
                : "Gaps stay silent — nothing is generated between the lines."}
            </p>
          )}
        </div>
      )}

      {picking && (
        <div className="absolute inset-x-0 top-7 z-10 max-h-44 overflow-y-auto rounded-xl border border-cream/12 bg-raised shadow-xl">
          {sources.length === 0 && (
            <p className="px-3 py-2 text-xs text-fog">
              No voice takes yet — generate one in the Voice lab.
            </p>
          )}
          {sources.map((a) => (
            <button
              key={a.relPath}
              onClick={() => {
                // land it after whatever's already down, so takes queue up as
                // dialogue rather than stacking on top of each other at zero
                const after = lane.reduce(
                  (end, t) =>
                    Math.max(end, t.atSec + Math.max(0, (durations[t.take] ?? 1) - t.trimStartSec)),
                  0,
                );
                setLane((l) => [
                  ...l,
                  { take: a.relPath, atSec: clampSec(after, durationSec), trimStartSec: 0 },
                ]);
                setPicking(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-cream/85 transition hover:bg-cream/5"
            >
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              {durations[a.relPath] ? (
                <span className="shrink-0 text-[9px] tabular-nums text-fog/60">
                  {fmtTime(durations[a.relPath])}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
