/* Studio — the shot inspector. Unchanged in substance from the pre-merge
 * Studio board; what changed is where it lives: it now shares the right rail
 * with the writers' room panel and is driven by the selection both views make,
 * so a shot picked on the kanban is the shot you edit while reading the page. */

import { ChevronLeft, ChevronRight, Plus, Trash2, X } from "lucide-react";
import type { Scene, Shot, ShotStatus } from "@aurea/shared";
import { Chip, cx } from "@/components/ui";
import { useDraft, type useBible, type useProduction } from "@/hooks";
import {
  STATUS,
  STATUS_TONE,
  fieldLabel,
  selectInput,
  textArea,
  textInput,
} from "./shared";

export function ShotInspector({
  shot,
  code,
  scene,
  prod,
  bible,
  selectShot,
  close,
}: {
  shot: Shot;
  code: string;
  scene: Scene;
  prod: ReturnType<typeof useProduction>;
  bible: ReturnType<typeof useBible>;
  selectShot: (id: string) => void;
  close: () => void;
}) {
  const { draft, patch } = useDraft(shot, (next) => {
    const { id: _id, ...rest } = next;
    prod.updateShot(shot.id, rest);
  });
  const idx = scene.shots.findIndex((s) => s.id === shot.id);
  const keyframeUrl = bible.refUrl(
    draft.keyframes.find((k) => k.id === draft.selectedKeyframe)?.asset ?? draft.keyframes[0]?.asset,
  );

  const toggleCharacter = (id: string) =>
    patch({
      characters: draft.characters.includes(id)
        ? draft.characters.filter((c) => c !== id)
        : [...draft.characters, id],
    });

  const patchLine = (lineId: string, p: Partial<Shot["scriptLines"][number]>) =>
    patch({ scriptLines: draft.scriptLines.map((l) => (l.id === lineId ? { ...l, ...p } : l)) });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b hairline px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] text-cream">{code}</span>
          <Chip tone={STATUS_TONE[draft.status]}>{draft.status}</Chip>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            title="Previous shot"
            onClick={() => idx > 0 && selectShot(scene.shots[idx - 1].id)}
            className={cx("rounded p-1 transition", idx > 0 ? "text-fog hover:text-gold" : "text-fog/30")}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            title="Next shot"
            onClick={() => idx < scene.shots.length - 1 && selectShot(scene.shots[idx + 1].id)}
            className={cx(
              "rounded p-1 transition",
              idx < scene.shots.length - 1 ? "text-fog hover:text-gold" : "text-fog/30",
            )}
          >
            <ChevronRight size={14} />
          </button>
          <button
            title="Remove shot"
            onClick={() => {
              prod.removeShot(shot.id);
              close();
            }}
            className="rounded p-1 text-fog transition hover:text-[#e07a6b]"
          >
            <Trash2 size={13} />
          </button>
          {/* deselecting hands the rail back to the writers' room */}
          <button
            title="Close the inspector (Esc)"
            onClick={close}
            className="rounded p-1 text-fog transition hover:text-cream"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {/* keyframe slot */}
        <div className="overflow-hidden rounded-xl border hairline">
          <div className="aspect-video w-full bg-gradient-to-br from-[#241c10] to-[#0d0a06]">
            {keyframeUrl ? (
              <img src={keyframeUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center px-4 text-center text-[10px] leading-relaxed text-fog">
                Keyframe slot — board this shot from the Director to generate stills from the bible
                refs + camera spec.
              </div>
            )}
          </div>
        </div>

        <label className="block">
          <span className={fieldLabel}>Title</span>
          <input
            className={textInput}
            value={draft.title}
            placeholder="MS, low angle, sitcom lighting"
            onChange={(e) => patch({ title: e.target.value })}
          />
        </label>

        <label className="block">
          <span className={fieldLabel}>Status</span>
          <select
            className={selectInput}
            value={draft.status}
            onChange={(e) => patch({ status: e.target.value as ShotStatus })}
          >
            {STATUS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <div>
          <span className={fieldLabel}>Characters</span>
          <div className="flex flex-wrap gap-1">
            {bible.bible.characters.map((c) => {
              const on = draft.characters.includes(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggleCharacter(c.id)}
                  className={cx(
                    "rounded-full border px-2 py-0.5 text-[10px] font-medium transition",
                    on
                      ? "border-gold/50 bg-gold/15 text-gold"
                      : "border-cream/10 text-fog hover:border-cream/25 hover:text-cream",
                  )}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>

        <label className="block">
          <span className={fieldLabel}>Location</span>
          <select
            className={selectInput}
            value={draft.location ?? ""}
            onChange={(e) => patch({ location: e.target.value || null })}
          >
            <option value="">— inherit scene —</option>
            {bible.bible.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>

        {/* camera & lens — bank ids autocomplete from the cinematography bank
            (free text always allowed; ids expand in prompts) */}
        <div>
          <span className={fieldLabel}>Camera &amp; lens</span>
          {(
            [
              ["shotSize", bible.bible.cinematography.shotSizes],
              ["angle", bible.bible.cinematography.angles],
              ["move", bible.bible.cinematography.moves],
              ["lens", bible.bible.cinematography.lenses],
            ] as const
          ).map(([key, entries]) => (
            <datalist key={key} id={`cine-${key}`}>
              {entries.map((c) => (
                <option key={c.id} value={c.id}>{`${c.name}${c.use ? ` — ${c.use}` : ""}`}</option>
              ))}
            </datalist>
          ))}
          <datalist id="cine-lighting">
            {bible.bible.cinematography.lighting.flatMap((b) =>
              b.entries.map((e) => (
                <option key={`${b.id}.${e.id}`} value={`${b.id}.${e.id}`}>
                  {`${b.name} — ${e.name}`}
                </option>
              )),
            )}
          </datalist>
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                ["Shot size", "shotSize", "ws"],
                ["Angle", "angle", "low"],
                ["Move", "move", "push-in"],
                ["Lens", "lens", "deep"],
              ] as const
            ).map(([label, key, ph]) => (
              <input
                key={key}
                title={label}
                placeholder={ph}
                list={`cine-${key}`}
                className={textInput}
                value={draft.camera[key]}
                onChange={(e) => patch({ camera: { ...draft.camera, [key]: e.target.value } })}
              />
            ))}
          </div>
          <input
            title="Lighting"
            placeholder="sitcom.warm-home"
            list="cine-lighting"
            className={cx(textInput, "mt-1.5")}
            value={draft.camera.lighting}
            onChange={(e) => patch({ camera: { ...draft.camera, lighting: e.target.value } })}
          />
        </div>

        {/* script / dialogue — the same lines the Script view typesets */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className={cx(fieldLabel, "mb-0")}>Script / dialogue</span>
            <button
              onClick={() =>
                patch({
                  scriptLines: [
                    ...draft.scriptLines,
                    { id: `l-${Date.now().toString(36)}`, character: null, text: "", deliveryNotes: "" },
                  ],
                })
              }
              className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-fog transition hover:text-gold"
            >
              <Plus size={11} /> Line
            </button>
          </div>
          <div className="space-y-2">
            {draft.scriptLines.map((line) => (
              <div key={line.id} className="rounded-lg border border-cream/10 bg-ink/40 p-2">
                <div className="mb-1 flex items-center gap-1.5">
                  <select
                    className={cx(selectInput, "flex-1")}
                    value={line.character ?? ""}
                    onChange={(e) => patchLine(line.id, { character: e.target.value || null })}
                  >
                    <option value="">— action —</option>
                    {bible.bible.characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    title="Remove line"
                    onClick={() =>
                      patch({ scriptLines: draft.scriptLines.filter((l) => l.id !== line.id) })
                    }
                    className="text-fog transition hover:text-[#e07a6b]"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <textarea
                  className={cx(textArea, "min-h-[40px]")}
                  placeholder={line.character ? "Dialogue…" : "Action / stage direction…"}
                  value={line.text}
                  onChange={(e) => patchLine(line.id, { text: e.target.value })}
                />
                {line.character && (
                  <input
                    className={cx(textInput, "mt-1")}
                    placeholder="Delivery — “more sarcastic”"
                    value={line.deliveryNotes}
                    onChange={(e) => patchLine(line.id, { deliveryNotes: e.target.value })}
                  />
                )}
              </div>
            ))}
            {draft.scriptLines.length === 0 && (
              <p className="text-[10px] leading-relaxed text-fog/80">
                No lines yet — dialogue assigned here drives voice takes and lip-sync.
              </p>
            )}
          </div>
        </div>

        <label className="block">
          <span className={fieldLabel}>Notes</span>
          <textarea
            className={textArea}
            value={draft.notes}
            onChange={(e) => patch({ notes: e.target.value })}
          />
        </label>
      </div>
    </div>
  );
}
