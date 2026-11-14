/* The director's edit — shot size · angle · move · lens · light.
 *
 * The cinematography bank has been in the bible since doc 26 and the Video lab
 * has never exposed it: the only way to ask for a medium close-up on a long
 * lens was to remember the wording and type it into the prompt. These five
 * pickers speak the bank's ids and the row underneath shows exactly what will
 * be appended, so the prompt box stays the shot's CONTENT and the camera stops
 * competing with it for space.
 *
 * The move is the one choice with a second mechanism behind it: where this
 * install has the matching camera-control LoRA the render is steered as well
 * as described, and where it hasn't, the prose is the whole thing. The row
 * says which, rather than quietly doing less than it looks like it does. */

import { Camera } from "lucide-react";
import { cameraMoveToLora, type BibleCinematography, type CameraSpec } from "@aurea/shared";
import { SectionLabel, cx } from "@/components/ui";
import { BankSelect } from "./shared";
import type { CameraMove } from "./engineSurface";

/** Lighting entries live in named banks ("sitcom", "concert"), and the bank
 * resolver takes "<bank>.<entry>" — so the picker's options are flattened to
 * those compound ids rather than the bare entry names, which collide. */
function lightingEntries(cine: BibleCinematography) {
  return cine.lighting.flatMap((bank) =>
    bank.entries.map((entry) => ({
      id: `${bank.id}.${entry.id}`,
      name: `${bank.name.split("—")[0].trim()} · ${entry.name}`,
      use: entry.use,
    })),
  );
}

export function ShotPicker({
  cine,
  bank,
  clause,
  cameraLoras,
  onChange,
}: {
  cine: Partial<CameraSpec>;
  bank: BibleCinematography;
  /** the prose this row will append, already expanded */
  clause: string;
  /** moves this install has camera-control weights for */
  cameraLoras: Partial<Record<CameraMove, string>>;
  onChange: (next: Partial<CameraSpec>) => void;
}) {
  if (bank.shotSizes.length === 0) return null;
  const set = (key: keyof CameraSpec, value: string) => onChange({ ...cine, [key]: value });

  const lora = cine.move ? cameraMoveToLora(cine.move) : null;
  const steered = lora ? !!cameraLoras[lora] : false;

  return (
    <section>
      <SectionLabel hint>Shot</SectionLabel>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <BankSelect
          value={cine.shotSize ?? ""}
          placeholder="size"
          entries={bank.shotSizes}
          onChange={(v) => set("shotSize", v)}
          className="min-w-0"
        />
        <BankSelect
          value={cine.angle ?? ""}
          placeholder="angle"
          entries={bank.angles}
          onChange={(v) => set("angle", v)}
          className="min-w-0"
        />
        <BankSelect
          value={cine.move ?? ""}
          placeholder="move"
          entries={bank.moves}
          onChange={(v) => set("move", v)}
          className="min-w-0"
        />
        <BankSelect
          value={cine.lens ?? ""}
          placeholder="lens"
          entries={bank.lenses}
          onChange={(v) => set("lens", v)}
          className="min-w-0"
        />
        <BankSelect
          value={cine.lighting ?? ""}
          placeholder="light"
          entries={lightingEntries(bank)}
          onChange={(v) => set("lighting", v)}
          className="col-span-2 min-w-0"
        />
      </div>

      {cine.move && (
        <p className="mt-1.5 flex items-center gap-1.5 text-2xs text-fog">
          <Camera size={10} className="shrink-0" />
          {steered ? (
            <>
              steered by the <span className="text-gold/85">{lora}</span> camera LoRA, and described
              in the prompt
            </>
          ) : (
            <>
              <span className="rounded-pill border border-cream/20 px-1.5 py-px text-cream/70">
                prose
              </span>
              no camera weight for this move — the prompt is the whole mechanism
            </>
          )}
        </p>
      )}

      {clause && (
        <p
          className={cx(
            "mt-1.5 rounded-lg border border-dashed border-cream/12 px-2 py-1.5",
            "text-2xs italic leading-relaxed text-fog",
          )}
          title="Appended to the prompt at render time — once, by the panel, never by the engine"
        >
          …{clause}
        </p>
      )}
    </section>
  );
}
