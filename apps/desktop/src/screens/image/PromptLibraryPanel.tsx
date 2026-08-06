import { useMemo, useState } from "react";
import { BookOpen, Plus, X } from "lucide-react";
import type { PromptCategory, PromptPreset, StylePack } from "@aurea/shared";
import { Chip, GoldButton, Modal, ModalHeader, SectionLabel, cx, inputCls } from "@/components/ui";
import { CATEGORY_CHIP, CATEGORY_ORDER } from "./PromptBuilder";
import { usePromptLibrary } from "./promptHooks";

/* The prompt library — every saved fragment (style/subject/lighting/camera/
 * mood/negative) plus the shipped style packs and the live "from the bible"
 * pack. Clicking anything appends it to the prompt via onPick; the modal
 * stays open so a prompt can be assembled in a few clicks. */

const CATEGORY_LABEL: Record<PromptCategory, string> = {
  style: "Style",
  subject: "Subject",
  lighting: "Lighting",
  camera: "Camera",
  mood: "Mood",
  negative: "Negative",
};

/** one clickable preset — used by both the pack rows and the category grid */
function PresetChip({
  preset,
  onPick,
  onRemove,
  removing,
}: {
  preset: PromptPreset;
  onPick: (p: PromptPreset) => void;
  /** absent for pack presets — they live inside the pack file, not as files */
  onRemove?: (id: string) => void;
  removing?: boolean;
}) {
  /** delete is one small × away — the confirm is inline, never window.confirm */
  const [armed, setArmed] = useState(false);

  return (
    <span
      className={cx(
        "group/preset inline-flex max-w-full items-center gap-1 rounded-pill border text-2xs font-medium",
        "transition duration-[var(--dur)] ease-[var(--ease-out-quart)]",
        CATEGORY_CHIP[preset.category],
      )}
    >
      <button
        title={preset.text}
        onClick={() => onPick(preset)}
        className="max-w-[260px] truncate py-1 pl-2.5 transition hover:brightness-125"
      >
        {preset.title}
      </button>
      {onRemove ? (
        armed ? (
          <span className="flex items-center gap-1 pr-1.5">
            <button
              disabled={removing}
              onClick={() => {
                onRemove(preset.id);
                setArmed(false);
              }}
              className="rounded-pill bg-red-500/80 px-1.5 py-0.5 text-[9px] font-semibold text-cream transition hover:bg-red-500 disabled:opacity-50"
            >
              Sure?
            </button>
            <button
              title="Keep it"
              onClick={() => setArmed(false)}
              className="text-fog/70 transition hover:text-cream"
            >
              <X size={10} />
            </button>
          </span>
        ) : (
          <button
            title={preset.builtin ? "Delete (built-in — it stays deleted)" : "Delete preset"}
            onClick={() => setArmed(true)}
            className="pr-2 opacity-0 transition group-hover/preset:opacity-60 hover:!opacity-100"
          >
            <X size={10} />
          </button>
        )
      ) : (
        <span className="pr-2" />
      )}
    </span>
  );
}

function PackSection({ pack, onPick }: { pack: StylePack; onPick: (p: PromptPreset) => void }) {
  return (
    <div className="rounded-card border border-cream/10 bg-surface/60 p-3">
      <div className="flex items-baseline gap-2">
        <h4 className="text-sm font-semibold text-cream">{pack.title}</h4>
        {pack.fromBible && (
          <Chip tone="gold" className="text-[9px]">
            from this project's bible
          </Chip>
        )}
      </div>
      <p className="mt-0.5 text-2xs leading-relaxed text-fog">{pack.description}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {pack.presets.map((p) => (
          <PresetChip key={p.id} preset={p} onPick={onPick} />
        ))}
      </div>
      {pack.negative && (
        <p className="mt-2 text-2xs leading-relaxed text-fog/70">
          <span className="font-semibold text-fog">Avoids:</span> {pack.negative}
        </p>
      )}
    </div>
  );
}

export function PromptLibraryPanel({
  open,
  onClose,
  prompt,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  /** the current prompt — what "Save current prompt" persists */
  prompt: string;
  onPick: (preset: PromptPreset) => void;
}) {
  const lib = usePromptLibrary();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<PromptCategory | "all">("all");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [saveCategory, setSaveCategory] = useState<PromptCategory>("style");

  const q = search.trim().toLowerCase();
  const matches = (p: PromptPreset) =>
    !q ||
    p.title.toLowerCase().includes(q) ||
    p.text.toLowerCase().includes(q) ||
    p.tags.some((t) => t.toLowerCase().includes(q));

  const filtered = useMemo(
    () => lib.presets.filter((p) => (tab === "all" || p.category === tab) && matches(p)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lib.presets, tab, q],
  );
  /** packs only hide under search when nothing in them matches — a pack is a
   * unit, so it shows whole or not at all */
  const packs = lib.packs.filter(
    (pk) => !q && tab === "all" ? true : pk.presets.some((p) => (tab === "all" || p.category === tab) && matches(p)),
  );

  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    presets: filtered.filter((p) => p.category === cat),
  })).filter((g) => g.presets.length > 0);

  return (
    <Modal open={open} onClose={onClose} size="lg" labelledBy="prompt-library-title">
      <ModalHeader
        id="prompt-library-title"
        title="Prompt library"
        sub="Click a fragment to add it to your prompt — build in layers: style, subject, light, lens."
        onClose={onClose}
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search fragments…"
          className={cx(inputCls, "w-52")}
        />
      </ModalHeader>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b hairline px-5 py-2.5">
        {(["all", ...CATEGORY_ORDER] as const).map((c) => (
          <button
            key={c}
            onClick={() => setTab(c)}
            className={cx(
              "rounded-pill border px-2.5 py-1 text-2xs font-medium capitalize transition duration-[var(--dur)]",
              tab === c
                ? "border-gold/60 bg-gold/12 text-gold"
                : "border-cream/10 text-fog hover:border-gold/35 hover:text-cream",
            )}
          >
            {c === "all" ? "All" : CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        {packs.length > 0 && (
          <section className="space-y-2.5">
            <SectionLabel>Style packs</SectionLabel>
            {packs.map((pk) => (
              <PackSection key={pk.id} pack={pk} onPick={onPick} />
            ))}
          </section>
        )}

        {byCategory.map(({ cat, presets }) => (
          <section key={cat}>
            <SectionLabel right={<span className="text-2xs tabular-nums text-fog/60">{presets.length}</span>}>
              {CATEGORY_LABEL[cat]}
            </SectionLabel>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <PresetChip
                  key={p.id}
                  preset={p}
                  onPick={onPick}
                  onRemove={lib.remove}
                  removing={lib.removing}
                />
              ))}
            </div>
            {cat === "negative" && (
              <p className="mt-1.5 text-2xs leading-relaxed text-fog/60">
                Negatives ride along as dashed chips — they're kept out of this model's prompt and
                apply via style packs on video / bible flows.
              </p>
            )}
          </section>
        ))}

        {byCategory.length === 0 && packs.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <BookOpen size={20} className="text-gold/50" />
            <p className="text-sm text-cream/80">
              {lib.loading ? "Loading the library…" : "Nothing matches"}
            </p>
            {!lib.loading && (
              <p className="max-w-[320px] text-2xs leading-relaxed text-fog">
                Clear the search or switch category — or save the prompt you're working on below.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Save the working prompt as a reusable fragment — the return path that
          turns a good one-off into library material */}
      <footer className="shrink-0 border-t hairline px-5 py-3">
        {saveOpen ? (
          <div className="anim-fade flex flex-wrap items-center gap-2">
            <input
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value.slice(0, 80))}
              placeholder="Preset title…"
              className={cx(inputCls, "w-56 flex-none")}
            />
            <div className="flex items-center gap-1">
              {CATEGORY_ORDER.map((c) => (
                <button
                  key={c}
                  onClick={() => setSaveCategory(c)}
                  title={CATEGORY_LABEL[c]}
                  className={cx(
                    "rounded-pill border px-2 py-1 text-[9px] font-medium capitalize transition",
                    saveCategory === c
                      ? CATEGORY_CHIP[c]
                      : "border-cream/10 text-fog hover:text-cream",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
            <GoldButton
              disabled={!saveTitle.trim() || !prompt.trim() || lib.saving}
              onClick={() => {
                lib.save({
                  title: saveTitle.trim(),
                  category: saveCategory,
                  text: prompt.trim(),
                  projectId: lib.project,
                });
                setSaveTitle("");
                setSaveOpen(false);
              }}
            >
              {lib.saving ? "Saving…" : "Save"}
            </GoldButton>
            <button
              onClick={() => setSaveOpen(false)}
              className="text-2xs text-fog transition hover:text-cream"
            >
              Cancel
            </button>
            {!prompt.trim() && (
              <span className="text-2xs text-fog/70">Write a prompt first — this saves it.</span>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSaveOpen(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-gold transition hover:brightness-110"
            >
              <Plus size={12} /> Save current prompt…
            </button>
            {lib.saveError && <span className="text-2xs text-red-400">{lib.saveError}</span>}
          </div>
        )}
      </footer>
    </Modal>
  );
}
