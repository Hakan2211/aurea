import { useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronDown,
  CircleAlert,
  ImagePlus,
  Layers,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  AdvancedButton,
  ChoiceChips,
  ComposerBar,
  GenerateButton,
  Segmented,
  cx,
} from "@/components/ui";
import { fileToPngBase64 } from "@/components/imageFile";
import { PromptBuilder } from "./PromptBuilder";
import { PROMPT_MAX } from "./promptState";
import { MODE_LABEL, type Aspect, type ImageParams, type LabMode, type RefImage } from "./useImageParams";

/* The Image lab's composer (UI simplify plan, Stage 3): mode, prompt (or the
 * deck's prompt list), references when editing, model, shape, how many, then
 * Advanced + Generate. Style preset, seed, quality, format and exact pixels
 * live in the Advanced drawer; the prompt library and history are drawers too. */

const selectCls =
  "rounded-xl border border-cream/10 bg-surface px-2.5 py-1.5 text-xs text-cream transition hover:border-gold/35 focus:border-gold/40 focus:outline-none";

/** What each slot is for. The local 3-ref stack has fixed roles because
 * Qwen encodes them positionally; the cloud model just takes a list, so past
 * the third every slot is simply another reference in priority order. */
function refSlotLabel(i: number, refsMax: number): string {
  if (refsMax <= 3) return i === 0 ? "subject" : i === 1 ? "scene / prop" : "style";
  return i === 0 ? "subject" : `ref ${i + 1}`;
}

/** The references for an edit, as one row of thumbnails: order matters
 * (subject first), so each can move left/right; the dashed tile adds more. */
function RefStrip({
  p,
  setRefs,
}: {
  p: ImageParams;
  setRefs: React.Dispatch<React.SetStateAction<RefImage[]>>;
}) {
  const { lab, refs, refsMax } = p;
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const full = refs.length >= refsMax;

  const addFiles = async (files: FileList | File[]) => {
    setError(null);
    for (const file of Array.from(files)) {
      if (refs.length + 1 > refsMax) break;
      if (!file.type.startsWith("image/")) continue;
      try {
        const pngBase64 = await fileToPngBase64(file);
        const rel = await lab.addRef(file.name.replace(/\.[^.]+$/, "") || "reference", pngBase64);
        setRefs((prev) =>
          prev.length < refsMax
            ? [...prev, { rel, url: URL.createObjectURL(file), name: file.name, staged: true }]
            : prev,
        );
      } catch (err) {
        setError(String((err as Error).message ?? err));
      }
    }
  };

  const move = (i: number, dir: -1 | 1) =>
    setRefs((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <div className="mb-2.5">
      <div className="flex items-start gap-2 overflow-x-auto pb-1">
        {refs.map((r, i) => (
          <div key={r.rel} className="group relative w-[72px] shrink-0">
            <img
              src={r.url}
              alt=""
              title={r.name}
              className="h-[72px] w-[72px] rounded-lg border border-cream/10 object-cover"
            />
            <div className="mt-0.5 truncate text-center text-xs text-fog">{refSlotLabel(i, refsMax)}</div>
            <div className="absolute inset-x-0 top-0 flex h-[72px] items-end justify-between rounded-lg bg-ink/55 p-1 opacity-0 transition group-hover:opacity-100">
              <button
                title="Move earlier"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="rounded bg-ink/70 p-0.5 text-cream/80 hover:text-gold disabled:opacity-30"
              >
                <ArrowLeft size={11} />
              </button>
              <button
                title="Move later"
                onClick={() => move(i, 1)}
                disabled={i === refs.length - 1}
                className="rounded bg-ink/70 p-0.5 text-cream/80 hover:text-gold disabled:opacity-30"
              >
                <ArrowRight size={11} />
              </button>
            </div>
            <button
              title="Remove"
              onClick={() => {
                setRefs((prev) => prev.filter((_, j) => j !== i));
                URL.revokeObjectURL(r.url);
                // uploads are staged in the project's refs/ folder — dropping
                // one from the stack deletes the staged copy too. Library
                // assets picked via "Edit" live in assets/ and are untouched.
                if (r.staged) void lab.remove(r.rel);
              }}
              className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-cream/20 bg-ink text-fog opacity-0 transition hover:border-red-400/60 hover:text-red-400 group-hover:opacity-100"
            >
              <X size={10} />
            </button>
          </div>
        ))}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) {
              void addFiles(e.target.files);
              e.target.value = "";
            }
          }}
        />
        {!full && (
          <button
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
            }}
            title="Drop or click to add a reference — JPG or PNG up to 20 MB"
            className="flex h-[72px] w-[72px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gold/35 text-center transition hover:border-gold/60 hover:bg-gold/4"
          >
            <ImagePlus size={16} strokeWidth={1.5} className="text-gold/80" />
            <span className="text-xs leading-tight text-fog">
              {lab.addingRef ? "Uploading…" : refs.length ? "Add" : "Add a reference"}
            </span>
          </button>
        )}
        <p className="min-w-[180px] max-w-[340px] self-center pl-1 text-2xs leading-relaxed text-fog">
          {refs.length}/{refsMax} ·{" "}
          {refsMax <= 3
            ? "Order matters: subject first, then scene/prop, then style. Keeps characters on-model with no LoRA."
            : `Up to ${refsMax} references — most important first. Or use Edit on any still above.`}
        </p>
      </div>
      {error && <p className="mt-1 text-2xs text-red-400">{error}</p>}
    </div>
  );
}

/** Deck mode: a named list of prompts that render as one long run. Autosaves. */
function DeckEditor({ p }: { p: ImageParams }) {
  const {
    lab, deckName, setDeckName, deckItems, setDeckItems, importOpen, setImportOpen,
    importText, setImportText, importParsed, deckLines, deckStore, deckId, setDeckId,
    deckPickOpen, setDeckPickOpen, deckArmed, setDeckArmed, deckSavedRef, loadDeck, newDeck,
  } = p;
  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <input
          value={deckName}
          onChange={(e) => setDeckName(e.target.value.slice(0, 60))}
          placeholder="Deck name (folder name)"
          className="min-w-0 flex-1 rounded-xl border border-cream/10 bg-surface px-3 py-2 text-sm text-cream placeholder:text-fog focus:border-gold/40 focus:outline-none"
        />
        {deckStore.decks.length > 0 ? (
          <button
            onClick={() => {
              setDeckPickOpen(!deckPickOpen);
              setDeckArmed(null);
            }}
            className={cx(
              "flex shrink-0 items-center gap-1 text-2xs transition",
              deckPickOpen ? "text-gold" : "text-fog hover:text-gold",
            )}
          >
            <Layers size={11} />
            {deckStore.decks.length} saved deck{deckStore.decks.length === 1 ? "" : "s"}
            <ChevronDown size={11} className={cx("transition-transform", deckPickOpen && "rotate-180")} />
          </button>
        ) : (
          <button onClick={newDeck} className="shrink-0 text-2xs text-fog transition hover:text-gold">
            New deck
          </button>
        )}
        <span className="shrink-0 text-2xs text-fog">
          {deckStore.saving
            ? "Saving…"
            : deckStore.saveError
              ? "Save failed — edits retry it"
              : deckId
                ? "Saved"
                : "Autosaves once it has a title + prompt"}
        </span>
      </div>
      {deckPickOpen && (
        <div className="absolute right-0 z-30 mt-1 w-[320px] overflow-hidden rounded-xl border border-cream/12 bg-raised shadow-xl">
          <button
            onClick={newDeck}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gold transition hover:bg-cream/5"
          >
            + New deck
          </button>
          {deckStore.decks.map((d) => (
            <div
              key={d.id}
              className={cx(
                "flex w-full items-center gap-1.5 px-3 py-2 transition hover:bg-cream/5",
                d.id === deckId ? "text-gold" : "text-cream/85",
              )}
            >
              <button onClick={() => loadDeck(d)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-xs">{d.title}</span>
                <span className="block text-xs text-fog">
                  {d.prompts.length} prompt{d.prompts.length === 1 ? "" : "s"} · {d.model}
                </span>
              </button>
              {deckArmed === d.id ? (
                <button
                  onClick={() => {
                    deckStore.remove(d.id);
                    setDeckArmed(null);
                    // deleting the deck under your feet → keep the text
                    // on screen but detach it, so the next edit saves a
                    // fresh file instead of resurrecting the dead id
                    if (d.id === deckId) {
                      setDeckId(null);
                      deckSavedRef.current = "";
                    }
                  }}
                  className="shrink-0 rounded-lg bg-red-500/85 px-1.5 py-0.5 text-xs font-semibold text-cream transition hover:bg-red-500"
                >
                  Sure?
                </button>
              ) : (
                <button
                  title="Delete deck"
                  onClick={() => setDeckArmed(d.id)}
                  className="shrink-0 text-fog/50 transition hover:text-red-400"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 max-h-[34vh] space-y-1.5 overflow-y-auto pr-1">
        {deckItems.map((text, i) => (
          <div
            key={i}
            className="relative rounded-xl border border-cream/10 bg-surface transition focus-within:border-gold/40"
          >
            <textarea
              value={text}
              onChange={(e) =>
                setDeckItems((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
              }
              rows={Math.min(6, Math.max(1, text.split("\n").length))}
              placeholder={`Prompt ${i + 1} — plain text or JSON, any length…`}
              className="w-full resize-none bg-transparent p-2.5 pr-12 text-xs leading-relaxed text-cream placeholder:text-fog focus:outline-none"
            />
            <span className="pointer-events-none absolute bottom-1.5 right-2 text-xs tabular-nums text-fog/50">
              {i + 1}
            </span>
            <button
              title="Remove prompt"
              onClick={() =>
                setDeckItems((prev) => (prev.length === 1 ? [""] : prev.filter((_, j) => j !== i)))
              }
              className="absolute right-1.5 top-1.5 text-fog/50 transition hover:text-red-400"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <button
          onClick={() => setDeckItems((prev) => [...prev, ""])}
          disabled={deckItems.length >= lab.deckMax}
          className="rounded-lg border border-dashed border-cream/15 px-3 py-1 text-xs text-cream/70 transition hover:border-gold/40 hover:text-gold disabled:opacity-40"
        >
          + Add prompt
        </button>
        <button
          onClick={() => setImportOpen(!importOpen)}
          className={cx(
            "rounded-lg border px-3 py-1 text-xs transition",
            importOpen
              ? "border-gold/60 bg-gold/12 text-gold"
              : "border-cream/15 text-cream/70 hover:border-gold/40 hover:text-gold",
          )}
        >
          Paste many
        </button>
        <span className="ml-auto text-2xs tabular-nums text-fog">
          {deckLines.length} / {lab.deckMax} prompts
        </span>
      </div>
      {importOpen && (
        <div className="mt-1.5 rounded-xl border border-cream/10 bg-surface p-2">
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={4}
            placeholder="Paste a JSON array, prompts separated by blank lines, or one per line…"
            className="w-full resize-none bg-transparent text-xs leading-relaxed text-cream placeholder:text-fog focus:outline-none"
          />
          <div className="mt-1 flex items-center justify-between">
            <span className="text-2xs tabular-nums text-fog">
              {importParsed.length} prompt{importParsed.length === 1 ? "" : "s"} detected
            </span>
            <button
              disabled={importParsed.length === 0}
              onClick={() => {
                setDeckItems((prev) =>
                  [...prev.filter((x) => x.trim() !== ""), ...importParsed].slice(0, lab.deckMax),
                );
                setImportText("");
                setImportOpen(false);
              }}
              className="rounded-lg bg-gold/15 px-2.5 py-1 text-xs font-semibold text-gold transition hover:bg-gold/25 disabled:opacity-40"
            >
              Add to deck
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ImageComposer({
  p,
  setMode,
  setRefs,
  drawer,
  toggleDrawer,
}: {
  p: ImageParams;
  setMode: (m: LabMode) => void;
  setRefs: React.Dispatch<React.SetStateAction<RefImage[]>>;
  drawer: string | null;
  toggleDrawer: (k: "advanced" | "library") => void;
}) {
  const {
    lab, mode, prompt, setPrompt, chips, commitChips, rawMode, toggleRaw, enhanceCtl,
    pickable, model, deckable, modelId, setModelId, editor, setEditorId,
    supportsAutoSize, sizeIsAuto, setAutoSize, aspect, setAspect, count, setCount,
    isCloud, editorMissing, estimate, canGenerate, customs, generate, generateLabel,
  } = p;

  /** the model the select shows — edit and deck mode resolve it their own way */
  const shownModel =
    mode === "edit"
      ? editor
      : mode === "deck"
        ? (deckable.find((m) => m.id === modelId) ?? deckable[0])
        : model;

  const libraryOpen = drawer === "library";

  return (
    <ComposerBar>
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <Segmented
          value={mode}
          onChange={setMode}
          options={(["generate", "edit", "deck"] as const).map((m) => ({
            value: m,
            label: MODE_LABEL[m],
            title:
              m === "generate"
                ? "Draw a new image from the prompt"
                : m === "edit"
                  ? "Change or re-stage reference images"
                  : "Render a whole list of prompts as one run",
          }))}
        />
        <span className="flex-1" />
        {mode !== "deck" && enhanceCtl.button}
        <button
          onClick={() => toggleDrawer("library")}
          title="Saved prompt fragments and style packs — one click appends"
          className={cx(
            "flex items-center gap-1 rounded-pill border px-2.5 py-1 text-xs font-medium transition duration-[var(--dur)]",
            libraryOpen
              ? "border-gold/50 bg-gold/12 text-gold"
              : "border-cream/12 text-cream/75 hover:border-gold/40 hover:text-gold",
          )}
        >
          <BookOpen size={12} /> Library
        </button>
      </div>

      {mode === "edit" && <RefStrip p={p} setRefs={setRefs} />}

      {mode === "deck" ? (
        <DeckEditor p={p} />
      ) : (
        <div>
          {rawMode ? (
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value.slice(0, PROMPT_MAX))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate();
              }}
              rows={3}
              className="w-full resize-none rounded-xl border border-cream/10 bg-surface p-3 text-sm leading-relaxed text-cream transition-[border-color,box-shadow] placeholder:text-fog focus:border-gold/45 focus:shadow-[0_0_0_3px_rgba(201,169,110,0.1)] focus:outline-none"
              placeholder={
                mode === "edit"
                  ? "Describe the new scene for the referenced subject…"
                  : "Describe the image…"
              }
            />
          ) : (
            <PromptBuilder chips={chips} onChips={commitChips} />
          )}
          <div className="mt-1 flex items-center gap-2">
            <Segmented
              value={rawMode ? "text" : "chips"}
              onChange={(v) => {
                if ((v === "text") !== rawMode) toggleRaw();
              }}
              options={[
                { value: "text", label: "Text", title: "Write the prompt as free text" },
                {
                  value: "chips",
                  label: "Chips",
                  title: "Edit the prompt as reorderable chips, split on commas",
                },
              ]}
            />
            <span className="ml-auto text-2xs tabular-nums text-fog">
              {prompt.length} / {PROMPT_MAX} · Ctrl + ↵ to generate
            </span>
          </div>
          {enhanceCtl.card}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <select
          value={shownModel?.id ?? ""}
          onChange={(e) => (mode === "edit" ? setEditorId(e.target.value) : setModelId(e.target.value))}
          title={shownModel?.note ?? "Model"}
          style={{ colorScheme: "dark" }}
          className={cx(selectCls, "max-w-[240px]", editorMissing && "border-amber-500/40")}
        >
          {pickable.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
              {m.note ? ` — ${m.note}` : ""}
            </option>
          ))}
        </select>

        <ChoiceChips<Aspect | "auto">
          value={sizeIsAuto ? "auto" : aspect}
          onChange={(v) => {
            if (v === "auto") setAutoSize(true);
            else {
              setAspect(v);
              setAutoSize(false);
            }
          }}
          options={[
            ...(supportsAutoSize
              ? [
                  {
                    value: "auto" as const,
                    label: "Auto",
                    title:
                      mode === "edit"
                        ? "Output matches your references' shape — usually right for an edit"
                        : "The model picks the size that best fits your prompt",
                  },
                ]
              : []),
            ...(lab.aspects as Aspect[]).map((a) => ({ value: a, label: a })),
          ]}
        />

        {mode !== "deck" && (
          <ChoiceChips
            value={count}
            onChange={setCount}
            options={Array.from({ length: lab.countMax }, (_, i) => ({
              value: i + 1,
              label: `×${i + 1}`,
              title: `${i + 1} image${i === 0 ? "" : "s"} per run`,
            }))}
          />
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <AdvancedButton
            open={drawer === "advanced"}
            onClick={() => toggleDrawer("advanced")}
            customs={customs}
            hint="Style preset, seed, exact size, steps, CFG, quality, format"
          />
          <GenerateButton onClick={generate} disabled={!canGenerate}>
            <Sparkles size={14} /> {generateLabel}
          </GenerateButton>
        </div>
      </div>

      {/* notes that apply right now, and only while they apply */}
      {mode === "edit" && lab.modelNotes[p.activeId] && (
        <p className="mt-1.5 text-2xs leading-relaxed text-fog">{lab.modelNotes[p.activeId]}</p>
      )}
      {editorMissing && (
        <p className="mt-1.5 rounded-lg border border-amber-500/25 bg-amber-500/8 px-2.5 py-1.5 text-2xs leading-relaxed text-amber-300">
          {isCloud
            ? "This model runs on fal.ai — add your API key under Settings → AI Providers to enable it."
            : "This model isn't installed — download it under Settings → Models, or link a folder that already has the weights (Settings → Models → Linked folders)."}
        </p>
      )}
      {isCloud && !editorMissing && (
        <p className="mt-1.5 text-2xs text-fog">
          {estimate} for {count} image{count === 1 ? "" : "s"} · billed to your fal.ai account
        </p>
      )}
      {lab.error ? (
        <p className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-red-500/25 bg-red-500/8 px-2.5 py-1.5 text-2xs leading-relaxed text-red-300">
          <CircleAlert size={12} className="mt-px shrink-0" /> {lab.error}
        </p>
      ) : lab.busy ? (
        <p className="mt-1.5 text-2xs text-fog">
          {isCloud
            ? "Rendering at fal.ai — watch the results, or queue another run."
            : "Rendering on the GPU — watch the results, or queue another run."}
        </p>
      ) : null}
    </ComposerBar>
  );
}
