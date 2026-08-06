import { useState } from "react";
import { ListPlus, X } from "lucide-react";
import { sheetLayout, type DirectorRef } from "@aurea/shared";
import { cx } from "@/components/ui";
import { PickerHeading, selectInput } from "../shared";

/** The cast lane — who this shot is about, whether or not they're in the start
 * frame.
 *
 * LTX takes references as one reference SHEET plus prose naming each cell, so
 * what's authored here is a list and what's rendered is a grid: the label beside
 * each row ("Top Row Left") is the cell it lands in, and the same words go into
 * the prompt. A character picked from the Bible brings its own description —
 * species, wardrobe, identity anchors — so the sheet says what the character
 * sheets already say.
 *
 * Gated twice over, because it needs a pack update AND a gated download: with
 * either missing the section explains itself and stays closed rather than
 * queuing a render that dies in ComfyUI. */
export function CastLane({
  refs,
  setRefs,
  cast,
  sets,
  frames,
  strength,
  setStrength,
  available,
  note,
  blocked,
}: {
  refs: DirectorRef[];
  setRefs: (fn: (r: DirectorRef[]) => DirectorRef[]) => void;
  cast: { id: string; name: string; ref: DirectorRef }[];
  sets: { id: string; name: string; ref: DirectorRef }[];
  frames: { relPath: string; name: string; url?: string }[];
  strength: number;
  setStrength: (v: number) => void;
  available: boolean;
  note?: string;
  /** set when a motion reference already owns the IC-LoRA slot */
  blocked?: string;
}) {
  const [picking, setPicking] = useState(false);
  const layout = sheetLayout(refs.length);
  const full = refs.length >= 6;
  const add = (ref: DirectorRef) => {
    setRefs((r) => (r.length >= 6 ? r : [...r, ref]));
    setPicking(false);
  };
  const patch = (i: number, p: Partial<DirectorRef>) =>
    setRefs((r) => r.map((ref, j) => (j === i ? { ...ref, ...p } : ref)));
  const thumb = (rel: string) => frames.find((f) => f.relPath === rel)?.url;

  return (
    <div className="relative mt-3 border-t hairline pt-3">
      <div className="flex items-center justify-between">
        <h4 className="text-2xs font-semibold uppercase tracking-[0.14em] text-fog">
          Cast references
        </h4>
        {available && !blocked && !full && (
          <button
            onClick={() => setPicking((p) => !p)}
            className="inline-flex items-center gap-1 text-2xs text-fog transition hover:text-gold"
          >
            <ListPlus size={10} /> Add
          </button>
        )}
      </div>

      {!available ? (
        <p className="mt-1.5 text-2xs leading-relaxed text-fog/70">
          {note ??
            "Cast references need WhatDreamsCost-ComfyUI v2.0.4+ and the LTX Ingredients " +
              "IC-LoRA (ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors, a gated download " +
              "from huggingface.co/Lightricks) in your ComfyUI's loras folder."}
        </p>
      ) : blocked ? (
        <p className="mt-1.5 text-2xs leading-relaxed text-fog/70">{blocked}</p>
      ) : refs.length === 0 ? (
        <p className="mt-1.5 text-2xs leading-relaxed text-fog/70">
          Name the cast and LTX holds them on-model through the whole take — including
          characters who never appear in the start frame.
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {refs.map((ref, i) => (
            <div
              key={`${ref.image}-${i}`}
              className="space-y-1.5 rounded-xl border border-cream/10 bg-surface p-2"
            >
              <div className="flex items-center gap-2">
                {thumb(ref.image) ? (
                  <img
                    src={thumb(ref.image)}
                    alt=""
                    draggable={false}
                    className="h-7 w-7 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <div className="h-7 w-7 shrink-0 rounded-md bg-cream/5" />
                )}
                <input
                  value={ref.name}
                  onChange={(e) => patch(i, { name: e.target.value })}
                  placeholder="Name"
                  className="min-w-0 flex-1 bg-transparent text-xs text-cream/85 outline-none placeholder:text-fog/60"
                />
                <select
                  value={ref.kind}
                  onChange={(e) => patch(i, { kind: e.target.value as DirectorRef["kind"] })}
                  style={{ colorScheme: "dark" }}
                  className={cx(selectInput, "w-[74px]")}
                >
                  <option value="character">Character</option>
                  <option value="prop">Prop</option>
                  <option value="setting">Setting</option>
                </select>
                <button
                  onClick={() => setRefs((r) => r.filter((_, j) => j !== i))}
                  title="Remove"
                  className="shrink-0 text-fog transition hover:text-red-300"
                >
                  <X size={11} />
                </button>
              </div>
              <textarea
                value={ref.description}
                onChange={(e) => patch(i, { description: e.target.value })}
                rows={2}
                placeholder="What must stay true — build, wardrobe, markings"
                className="w-full resize-none rounded-md border border-cream/10 bg-ink p-1.5 text-2xs leading-relaxed text-cream/85 outline-none placeholder:text-fog/60 focus:border-gold/40"
              />
              <div className="text-[9px] uppercase tracking-wider text-fog/60">
                {layout.cells[i]?.label}
              </div>
            </div>
          ))}

          <div className="flex items-center gap-2">
            <span className="shrink-0 text-2xs text-fog">Hold</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={strength}
              onChange={(e) => setStrength(Number(e.target.value))}
              className="min-w-0 flex-1 accent-gold"
            />
            <span className="w-7 shrink-0 text-right text-2xs tabular-nums text-gold">
              {strength.toFixed(2)}
            </span>
          </div>
          <p className="text-2xs leading-relaxed text-fog/70">
            {refs.length} on a {layout.cols === 1 ? "single-cell" : `${layout.cols}×${layout.rows}`}{" "}
            sheet — the descriptions go in front of the shot prompt, so keep each to a line or two.
          </p>
        </div>
      )}

      {picking && available && !blocked && (
        <div className="absolute inset-x-0 top-7 z-10 max-h-52 overflow-y-auto rounded-xl border border-cream/12 bg-raised shadow-xl">
          {cast.length > 0 && <PickerHeading>From the Bible</PickerHeading>}
          {cast.map((c) => (
            <button
              key={c.id}
              onClick={() => add(c.ref)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-cream/85 transition hover:bg-cream/5"
            >
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="shrink-0 text-[9px] uppercase tracking-wider text-fog/60">cast</span>
            </button>
          ))}
          {sets.map((s) => (
            <button
              key={s.id}
              onClick={() => add(s.ref)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-cream/85 transition hover:bg-cream/5"
            >
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="shrink-0 text-[9px] uppercase tracking-wider text-fog/60">set</span>
            </button>
          ))}
          <PickerHeading>From the library</PickerHeading>
          {frames.length === 0 && (
            <p className="px-3 py-2 text-xs text-fog">No stills in the library yet.</p>
          )}
          {frames.slice(0, 30).map((f) => (
            <button
              key={f.relPath}
              onClick={() =>
                add({ image: f.relPath, name: "", kind: "character", description: "" })
              }
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-cream/85 transition hover:bg-cream/5"
            >
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
