import { useState } from "react";
import { Waypoints, X } from "lucide-react";
import { cx } from "@/components/ui";
import { clampSec, selectInput, type DirectorMotion } from "../shared";

/** The motion lane — an existing clip's movement, transferred onto this shot.
 *
 * LTX reads the reference through an IC-LoRA rather than as a keyframe: the
 * shot keeps its own cast and set (the keyframes above), and takes the
 * reference's movement. Two weights are on disk and they behave differently —
 * motion-track follows the reference's movement closely (a dance, a specific
 * gesture), union-control takes its staging more loosely. */
export function MotionLane({
  sources,
  motion,
  setMotion,
  durationSec,
  available,
  note,
}: {
  sources: { relPath: string; name: string }[];
  motion: DirectorMotion | null;
  setMotion: (m: DirectorMotion | null) => void;
  durationSec: number;
  available: boolean;
  note?: string;
}) {
  const [picking, setPicking] = useState(false);
  const nameOf = (rel: string) =>
    sources.find((s) => s.relPath === rel)?.name ?? rel.split("/").pop();
  const patch = (p: Partial<DirectorMotion>) => motion && setMotion({ ...motion, ...p });

  return (
    <div className="relative mt-3 border-t hairline pt-3">
      <div className="flex items-center justify-between">
        <h4 className="text-2xs font-semibold uppercase tracking-[0.14em] text-fog">
          Motion reference
        </h4>
        {available && (
          <button
            onClick={() => (motion ? setMotion(null) : setPicking((p) => !p))}
            className="inline-flex items-center gap-1 text-2xs text-fog transition hover:text-gold"
          >
            {motion ? (
              <>
                <X size={10} /> Remove
              </>
            ) : (
              <>
                <Waypoints size={10} /> Add reference
              </>
            )}
          </button>
        )}
      </div>

      {!available ? (
        <p className="mt-1.5 text-2xs leading-relaxed text-fog/70">
          {note ??
            "Motion transfer needs an LTX IC-LoRA in your ComfyUI's loras folder — " +
              "ltx-2.3-22b-ic-lora-motion-track-control or -union-control."}
        </p>
      ) : !motion ? (
        <p className="mt-1.5 text-2xs leading-relaxed text-fog/70">
          Point at a clip and this shot borrows its movement — a dance, a gesture, a camera
          push — while keeping its own cast and set.
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2 rounded-xl border border-cream/10 bg-surface px-2.5 py-1.5">
            <button
              onClick={() => setPicking((p) => !p)}
              title="Choose a different reference"
              className="min-w-0 flex-1 truncate text-left text-xs text-cream/85 transition hover:text-gold"
            >
              {nameOf(motion.video)}
            </button>
            <span className="shrink-0 text-[9px] uppercase tracking-wider text-fog/60">ref</span>
          </div>

          <select
            value={motion.icLora}
            onChange={(e) => patch({ icLora: e.target.value as DirectorMotion["icLora"] })}
            style={{ colorScheme: "dark" }}
            className={cx(selectInput, "w-full")}
          >
            <option value="motionTrack">Track its movement (close)</option>
            <option value="union">Follow its staging (loose)</option>
          </select>

          <div className="flex items-center gap-1.5">
            {(
              [
                ["at", "atSec", "When its motion starts in the shot"],
                ["len", "lengthSec", "How long it drives"],
                ["skip", "trimStartSec", "Skip this far into the reference"],
              ] as const
            ).map(([label, key, title]) => (
              <div
                key={key}
                title={title}
                className="flex min-w-0 flex-1 items-center gap-1 rounded-md border border-cream/10 bg-ink px-1.5 py-1"
              >
                <span className="shrink-0 text-[9px] uppercase tracking-wider text-fog/60">
                  {label}
                </span>
                <input
                  type="number"
                  min={0}
                  max={key === "trimStartSec" ? undefined : durationSec}
                  step={0.5}
                  value={motion[key]}
                  onChange={(e) =>
                    patch({
                      [key]:
                        key === "trimStartSec"
                          ? Math.max(0, Number(e.target.value) || 0)
                          : clampSec(Number(e.target.value), durationSec),
                    } as Partial<DirectorMotion>)
                  }
                  className="w-full min-w-0 bg-transparent text-2xs tabular-nums text-gold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="shrink-0 text-2xs text-fog">Strength</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={motion.strength}
              onChange={(e) => patch({ strength: Number(e.target.value) })}
              className="min-w-0 flex-1 accent-gold"
            />
            <span className="w-7 shrink-0 text-right text-2xs tabular-nums text-gold">
              {motion.strength.toFixed(2)}
            </span>
          </div>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={motion.useItsAudio}
              onChange={(e) => patch({ useItsAudio: e.target.checked })}
              className="accent-gold"
            />
            <span className="text-2xs text-fog">Take its audio too</span>
          </label>
          {motion.useItsAudio && (
            <p className="text-2xs leading-relaxed text-gold/75">
              The reference's soundtrack replaces the audio lane for this shot.
            </p>
          )}
        </div>
      )}

      {picking && available && (
        <div className="absolute inset-x-0 top-7 z-10 max-h-44 overflow-y-auto rounded-xl border border-cream/12 bg-raised shadow-xl">
          {sources.length === 0 && (
            <p className="px-3 py-2 text-xs text-fog">
              No video in the library yet — render a take first.
            </p>
          )}
          {sources.map((s) => (
            <button
              key={s.relPath}
              onClick={() => {
                // swapping the reference keeps the timings already dialled in
                setMotion({
                  atSec: 0,
                  lengthSec: durationSec,
                  trimStartSec: 0,
                  icLora: "motionTrack",
                  strength: 1,
                  useItsAudio: false,
                  ...(motion ?? {}),
                  video: s.relPath,
                });
                setPicking(false);
              }}
              className="flex w-full items-center px-3 py-2 text-left text-xs text-cream/85 transition hover:bg-cream/5"
            >
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
