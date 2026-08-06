import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Copy,
  Dices,
  Download,
  Expand,
  Heart,
  ImagePlus,
  Layers,
  Loader2,
  Maximize2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { falImageEstimate, falSizeError } from "@aurea/shared";
import { downloadAsset, useImageLab, useLikes, useSystem, useJobs } from "@/hooks";
import type { ImageHistoryEntry, ImageTile } from "@/data/sample";
import { Chip, SectionLabel, Segmented, StatusBar, cx } from "@/components/ui";
import { fileToPngBase64 } from "@/components/imageFile";
import { PromptBuilder } from "@/screens/image/PromptBuilder";
import { PromptLibraryPanel } from "@/screens/image/PromptLibraryPanel";
import { PromptLibraryRail } from "@/screens/image/PromptLibraryRail";
import { LabHeader, type RollScope, type RollView } from "@/screens/image/LabHeader";
import { PROMPT_MAX, usePromptState, type PromptState } from "@/screens/image/promptState";
import { useEnhanceControl } from "@/screens/image/EnhanceButton";
import { useActivePromptProject, usePromptDecks } from "@/screens/image/promptHooks";

/* Image lab — UI-Design/Image Lab.jpg. Prompt-to-image with the real engine
 * roster (Krea 2 default, z-image-turbo drafts, Qwen-Edit reference edits);
 * params and history flow through useImageLab (tRPC seam). Edit mode routes
 * through Qwen-Edit 2509 with up to 3 reference images (the QIE multi-ref
 * consistency stack — subject first, then scene/prop/style). */

/** seed of the batch on the canvas — what the refresh button restores */
const LAST_SEED = 746583928;

type Aspect = "1:1" | "3:2" | "16:9" | "4:3" | "9:16";
type LabMode = "generate" | "edit" | "deck";

const MODE_LABEL: Record<LabMode, string> = {
  generate: "Generate",
  edit: "Edit with refs",
  deck: "Deck",
};

/** stills the canvas renders before the "Show older" button takes over — the
 * roll can be hundreds deep, and mounting all of them costs a visible beat */
const ROLL_PAGE = 60;

/** what the Model picker starts on in generate/deck mode */
const DEFAULT_GENERATOR = "krea2";

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "Today" / "Yesterday" / "Mon, 21 Jul" — the roll's date separators. Days
 * come in as local ISO (YYYY-MM-DD), so compare them as strings, not as
 * Dates: parsing "2026-07-27" gives UTC midnight and shifts the label. */
function dayLabel(day: string): string {
  const now = new Date();
  if (day === isoDay(now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day === isoDay(yesterday)) return "Yesterday";
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(y === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** the roll in render order, split into dated sections. Renders in flight have
 * no file yet and so no day — they belong at the top, under today. */
function groupByDay(tiles: ImageTile[]): { day: string; tiles: ImageTile[] }[] {
  const today = isoDay(new Date());
  const out: { day: string; tiles: ImageTile[] }[] = [];
  for (const tile of tiles) {
    const day = tile.day ?? today;
    const last = out[out.length - 1];
    if (last?.day === day) last.tiles.push(tile);
    else out.push({ day, tiles: [tile] });
  }
  return out;
}

/** a staged reference: server path (job payload) + local preview */
export interface RefImage {
  rel: string;
  url: string;
  name: string;
  /** true for a file this panel uploaded into <project>/refs/ — removing it
   * from the stack deletes it. False when the ref is an existing library
   * asset the user sent here with the tile's Edit action. */
  staged?: boolean;
}

/** Bulk deck input → prompts. Three shapes, tried in order: a JSON array
 * (strings, or objects re-stringified so structured prompts survive whole),
 * blank-line-separated blocks (multi-line prompts stay one prompt), and
 * plain one-per-line as the fallback when neither applies. */
export function parseDeckImport(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  try {
    const arr: unknown = JSON.parse(t);
    if (Array.isArray(arr)) {
      return arr
        .map((p) => (typeof p === "string" ? p : JSON.stringify(p, null, 2)))
        .map((s) => s.trim())
        .filter(Boolean);
    }
  } catch {
    /* not JSON */
  }
  const blocks = /\n\s*\n/.test(t) ? t.split(/\n\s*\n+/) : t.split("\n");
  return blocks.map((s) => s.trim()).filter(Boolean);
}

/* ---------- left panel ---------- */

function PanelLabel({ children, hint }: { children: React.ReactNode; hint?: boolean }) {
  return <SectionLabel hint={hint}>{children}</SectionLabel>;
}

/** sample-data models carry no role — infer it from the id for those */
const modelRole = (m: { id: string; role?: string }) =>
  m.role ?? (m.id === "qwen-edit" ? "edit" : "generate");

/** a model can serve both tabs — GPT Image 2 does, since fal routes a
 * prompt-only run and a referenced one to two endpoints of the same model */
const modelDoes = (m: { id: string; role?: string }, want: "generate" | "edit") => {
  const role = modelRole(m);
  return role === want || role === "both";
};

/** sample-data models carry no availability — treat absent as runnable */
const modelAvailable = (m: { id: string; available?: boolean }) => m.available !== false;

function NumberField({
  label,
  value,
  onChange,
  placeholder,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px]">
      <span className="text-fog">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-20 rounded-lg border border-cream/10 bg-surface px-2 py-1.5 text-right text-[11px] tabular-nums text-cream placeholder:text-fog/50 focus:border-gold/40 focus:outline-none"
      />
    </label>
  );
}

function ParamsPanel({
  mode,
  setMode,
  refs,
  editorId,
  setEditorId,
  refsMax,
  ps,
  libraryDocked,
  setLibraryDocked,
  libraryOpen,
  setLibraryOpen,
}: {
  mode: LabMode;
  setMode: (m: LabMode) => void;
  refs: RefImage[];
  /** the chosen edit model lives in the parent — RefsPanel enforces its
   * per-model reference ceiling, and that panel is a sibling of this one */
  editorId: string;
  setEditorId: (id: string) => void;
  refsMax: number;
  /** the prompt is owned by the screen — the docked library rail is a sibling
   * column that composes into the same prompt */
  ps: PromptState;
  libraryDocked: boolean;
  setLibraryDocked: (o: boolean) => void;
  /** the full library modal — managing presets, not composing with them */
  libraryOpen: boolean;
  setLibraryOpen: (o: boolean) => void;
}) {
  const lab = useImageLab();
  const { prompt, setPrompt, chips, commitChips, rawMode, toggleRaw } = ps;
  /** Krea 2 is the house generator (photoreal heroes) — the catalog lists
   * z-image first because it's the fast drafting model, but that is not what
   * anyone wants pre-selected. Falls back to whatever IS runnable below. */
  const [modelId, setModelId] = useState(DEFAULT_GENERATOR);
  const [modelOpen, setModelOpen] = useState(false);
  const [aspect, setAspect] = useState<Aspect>("3:2");
  /** no preset is the honest default — the prompt reaches the model unmodified
   * until you pick one, and clicking the active chip clears it again */
  const [preset, setPreset] = useState<string | null>(null);
  const [seed, setSeed] = useState(String(lab.seed));
  const [count, setCount] = useState(1);
  const [advancedOpen, setAdvancedOpen] = useState(true);
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [steps, setSteps] = useState("");
  const [cfg, setCfg] = useState("");
  /** cloud-model knobs — inert for the local graphs, which use steps/cfg */
  const [quality, setQuality] = useState("high");
  const [outputFormat, setOutputFormat] = useState("png");
  /** "auto" = let the model take its size from the references, which is the
   * right default for an edit; picking an aspect chip switches this off */
  const [autoSize, setAutoSize] = useState(true);
  const [deckName, setDeckName] = useState("");
  /** one entry per prompt — a prompt can span many lines (JSON, shot specs) */
  const [deckItems, setDeckItems] = useState<string[]>([""]);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");

  /* ---- prompt builder + library (Track B3) ---- */
  const promptProject = useActivePromptProject();
  /** shows/hides the docked library column — rendered in whichever section
   * heads the panel for the current mode */
  const libraryToggle = (
    <button
      onClick={() => setLibraryDocked(!libraryDocked)}
      title={
        libraryDocked
          ? "Hide the prompt library column"
          : "Show the prompt library column — saved fragments and style packs"
      }
      className={cx(
        "flex items-center gap-1 rounded-pill border px-2 py-0.5 text-2xs font-medium transition duration-[var(--dur)]",
        libraryDocked
          ? "border-gold/50 bg-gold/12 text-gold"
          : "border-cream/12 text-cream/75 hover:border-gold/40 hover:text-gold",
      )}
    >
      <BookOpen size={10} /> Library
    </button>
  );

  const enhanceCtl = useEnhanceControl({
    prompt,
    projectId: promptProject,
    // collapse the accepted text back into chips on comma boundaries so the
    // builder stays usable after an enhance
    onAccept: ps.acceptText,
  });

  /* ---- deck persistence (prompts.deck*) ---- */
  const deckStore = usePromptDecks();
  const [deckId, setDeckId] = useState<string | null>(null);
  const [deckPickOpen, setDeckPickOpen] = useState(false);
  /** deck id armed for delete inside the picker — inline confirm, no dialogs */
  const [deckArmed, setDeckArmed] = useState<string | null>(null);
  /** load-newest runs once per screen visit, not on every deckList refetch */
  const deckLoadedRef = useRef(false);
  /** JSON of the last payload written — the autosave's "anything changed?" */
  const deckSavedRef = useRef("");
  /** serializes the FIRST save — two debounce fires before the server hands
   * back an id would otherwise mint two deck files */
  const deckCreatingRef = useRef(false);

  const deckLines = deckItems
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, lab.deckMax);
  const importParsed = importOpen ? parseDeckImport(importText) : [];

  const generators = lab.models.filter((m) => modelDoes(m, "generate"));
  /** decks are a Comfy-only path, and a 40-prompt run on a paid model would
   * be a very expensive button — so the deck picker stays local */
  const deckable = generators.filter((m) =>
    lab.deckModels.length ? lab.deckModels.includes(m.id) : true,
  );
  /** the model a deck run (and the persisted deck) actually uses — a cloud
   * model left selected on the generate tab can't run a deck, so fall back */
  const deckModel = deckable.some((m) => m.id === modelId)
    ? modelId
    : (deckable[0]?.id ?? "z-image");

  const loadDeck = (d: { id: string; title: string; prompts: string[]; model: string }) => {
    setDeckId(d.id);
    setDeckName(d.title);
    setDeckItems(d.prompts.length ? d.prompts : [""]);
    if (deckable.some((m) => m.id === d.model)) setModelId(d.model);
    // mark the just-loaded state as saved, or the autosave would immediately
    // rewrite the file it came from
    deckSavedRef.current = JSON.stringify({ title: d.title, prompts: d.prompts, model: d.model });
    setDeckPickOpen(false);
    setDeckArmed(null);
  };
  const newDeck = () => {
    setDeckId(null);
    setDeckName(
      `Deck — ${new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" })}`,
    );
    setDeckItems([""]);
    deckSavedRef.current = "";
    setDeckPickOpen(false);
    setDeckArmed(null);
  };

  // first visit to Deck mode: pick up the newest persisted deck, or start a
  // fresh one titled by date — the deck used to be ephemeral component state
  // and vanished with the screen
  useEffect(() => {
    if (mode !== "deck" || deckLoadedRef.current || !deckStore.ready) return;
    deckLoadedRef.current = true;
    const newest = deckStore.decks[0];
    if (newest) loadDeck(newest);
    else newDeck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, deckStore.ready, deckStore.decks]);

  // debounced autosave — every edit lands on disk ~800ms after typing stops.
  // Empty untitled decks are never minted; the trimmed-prompt payload is what
  // persists, matching what Generate would run.
  useEffect(() => {
    if (mode !== "deck" || !deckLoadedRef.current) return;
    const title = deckName.trim();
    const prompts = deckItems.map((s) => s.trim()).filter(Boolean);
    if (!title) return;
    if (!deckId && prompts.length === 0) return;
    if (!deckId && deckCreatingRef.current) return; // first save still in flight
    const key = JSON.stringify({ title, prompts, model: deckModel });
    if (key === deckSavedRef.current) return;
    const t = setTimeout(() => {
      deckSavedRef.current = key;
      if (!deckId) deckCreatingRef.current = true;
      deckStore
        .save({ id: deckId ?? undefined, title, prompts, model: deckModel })
        .then((d) => {
          deckCreatingRef.current = false;
          setDeckId(d.id);
        })
        .catch(() => {
          // failed write ≠ saved — clear the marker so the next edit retries
          deckCreatingRef.current = false;
          deckSavedRef.current = "";
        });
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, deckName, deckItems, deckModel, deckId]);
  /** more than one edit model now (local qwen-edit, cloud gpt-image-2), so
   * edit mode gets the same picker generate mode has */
  const editors = lab.models.filter((m) => modelDoes(m, "edit"));
  const editor = editors.find((m) => m.id === editorId) ?? editors[0];
  const pickable = mode === "edit" ? editors : mode === "deck" ? deckable : generators;
  /** catalog says the model can't run — warn up front instead of letting the
   * job die in engine preflight with nothing visible in the lab */
  const model =
    (mode === "edit" ? editor : generators.find((m) => m.id === modelId)) ?? generators[0];
  /** resolved through `model`, never the raw state: the default id is a
   * preference, and a catalog that doesn't offer it must not be sent it */
  const activeId = mode === "edit" ? (editor?.id ?? "qwen-edit") : (model?.id ?? modelId);
  const editorMissing = mode !== "deck" && !!model && !modelAvailable(model);

  /** paid-per-image model — everything that can spend money shows a number.
   * Decks never route to the cloud, so its knobs stay hidden there. */
  const isCloud = mode !== "deck" && lab.cloudModels.includes(activeId);
  const supportsAutoSize = isCloud && lab.autoSizeModels.includes(activeId);
  const sizeIsAuto = supportsAutoSize && autoSize;

  const adv = lab.advancedCfg;
  const defaults = adv.defaults[activeId];
  /** cloud renders aren't bounded by this GPU's VRAM, so they get a bigger
   * ceiling than the local 2048 */
  const sizeMax = adv.sizeMaxByModel?.[activeId] ?? adv.sizeMax;
  const num = (s: string) => (s.trim() !== "" && !Number.isNaN(Number(s)) ? Number(s) : undefined);
  /** free size only applies when both fields are set; snap into the valid grid */
  const snapSize = (v: number) =>
    Math.min(sizeMax, Math.max(adv.sizeMin, Math.round(v / adv.sizeStep) * adv.sizeStep));
  const sizeOverride =
    !sizeIsAuto && num(width) !== undefined && num(height) !== undefined
      ? { width: snapSize(num(width)!), height: snapSize(num(height)!) }
      : {};
  /** what this run will cost, live — same rate table the adapter bills from */
  const estimate = falImageEstimate(quality, count, sizeOverride.width, sizeOverride.height);
  /** fal rejects sizes the local engines accept (min total pixels, max edge,
   * 3:1 aspect) — catch it here rather than after the upload round-trip */
  const sizeIssue =
    isCloud && sizeOverride.width && sizeOverride.height
      ? falSizeError(sizeOverride.width, sizeOverride.height)
      : null;

  const canGenerate =
    !lab.sending &&
    !editorMissing &&
    !sizeIssue &&
    (mode === "deck"
      ? deckName.trim() !== "" && deckLines.length > 0
      : !!prompt.trim() && (mode === "generate" || refs.length > 0));

  return (
    <aside className="flex w-[284px] shrink-0 flex-col border-r hairline bg-[#0e0e10]">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
      {/* mode switch — the slider is a real element so the change reads as
          movement, not a repaint */}
      <section className="relative flex rounded-xl border border-cream/10 bg-surface p-1">
        <span
          className="absolute inset-y-1 w-[calc((100%-0.5rem)/3)] rounded-lg bg-gradient-to-b from-gold/22 to-gold/10 ring-1 ring-gold/35 transition-transform duration-[var(--dur)] ease-[var(--ease-spring)]"
          style={{
            transform: `translateX(${(["generate", "edit", "deck"] as const).indexOf(mode) * 100}%)`,
          }}
        />
        {(["generate", "edit", "deck"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cx(
              "relative flex-1 rounded-lg py-1.5 text-[11px] font-semibold transition duration-[var(--dur)]",
              mode === m ? "text-gold" : "text-fog hover:text-cream",
            )}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </section>

      {mode === "deck" ? (
        <section className="relative">
          {/* the toggle rides along here too — Deck mode replaces the Prompt
              section, and that used to be the only place it lived */}
          <SectionLabel right={libraryToggle}>Deck</SectionLabel>
          <input
            value={deckName}
            onChange={(e) => setDeckName(e.target.value.slice(0, 60))}
            placeholder="Deck name (folder name)"
            className="mt-2 w-full rounded-xl border border-cream/10 bg-surface px-3 py-2.5 text-[12px] text-cream placeholder:text-fog focus:border-gold/40 focus:outline-none"
          />
          {/* persistence strip — which saved deck this is, and its save state */}
          <div className="mt-1.5 flex items-center justify-between gap-2">
            {deckStore.decks.length > 0 ? (
              <button
                onClick={() => {
                  setDeckPickOpen((o) => !o);
                  setDeckArmed(null);
                }}
                className={cx(
                  "flex items-center gap-1 text-[10px] transition",
                  deckPickOpen ? "text-gold" : "text-fog/80 hover:text-gold",
                )}
              >
                <Layers size={10} />
                {deckStore.decks.length} saved deck{deckStore.decks.length === 1 ? "" : "s"}
                <ChevronDown
                  size={10}
                  className={cx("transition-transform", deckPickOpen && "rotate-180")}
                />
              </button>
            ) : (
              <button
                onClick={newDeck}
                className="text-[10px] text-fog/80 transition hover:text-gold"
              >
                New deck
              </button>
            )}
            <span className="text-[10px] text-fog/60">
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
            <div className="absolute inset-x-0 z-10 mt-1 overflow-hidden rounded-xl border border-cream/12 bg-raised shadow-xl">
              <button
                onClick={newDeck}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-gold transition hover:bg-cream/5"
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
                    <span className="block truncate text-[11px]">{d.title}</span>
                    <span className="block text-[9px] text-fog">
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
                      className="shrink-0 rounded-lg bg-red-500/85 px-1.5 py-0.5 text-[9px] font-semibold text-cream transition hover:bg-red-500"
                    >
                      Sure?
                    </button>
                  ) : (
                    <button
                      title="Delete deck"
                      onClick={() => setDeckArmed(d.id)}
                      className="shrink-0 text-fog/50 transition hover:text-red-400"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 space-y-1.5">
            {deckItems.map((text, i) => (
              <div
                key={i}
                className="relative rounded-xl border border-cream/10 bg-surface transition focus-within:border-gold/40"
              >
                <textarea
                  value={text}
                  onChange={(e) =>
                    setDeckItems((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))
                  }
                  rows={Math.min(8, Math.max(2, text.split("\n").length))}
                  placeholder={`Prompt ${i + 1} — plain text or JSON, any length…`}
                  className="w-full resize-none bg-transparent p-2.5 pr-7 text-[11px] leading-relaxed text-cream placeholder:text-fog/60 focus:outline-none"
                />
                <span className="pointer-events-none absolute bottom-1.5 right-2 text-[9px] tabular-nums text-fog/50">
                  {i + 1}
                </span>
                <button
                  title="Remove prompt"
                  onClick={() =>
                    setDeckItems((prev) =>
                      prev.length === 1 ? [""] : prev.filter((_, j) => j !== i),
                    )
                  }
                  className="absolute right-1.5 top-1.5 text-fog/50 transition hover:text-red-400"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-1.5">
            <button
              onClick={() => setDeckItems((prev) => [...prev, ""])}
              disabled={deckItems.length >= lab.deckMax}
              className="flex-1 rounded-lg border border-dashed border-cream/15 py-1.5 text-[11px] text-cream/70 transition hover:border-gold/40 hover:text-gold disabled:opacity-40"
            >
              + Add prompt
            </button>
            <button
              onClick={() => setImportOpen((o) => !o)}
              className={cx(
                "rounded-lg border px-2.5 py-1.5 text-[11px] transition",
                importOpen
                  ? "border-gold/60 bg-gold/12 text-gold"
                  : "border-cream/15 text-cream/70 hover:border-gold/40 hover:text-gold",
              )}
            >
              Paste many
            </button>
          </div>
          {importOpen && (
            <div className="mt-1.5 rounded-xl border border-cream/10 bg-surface p-2">
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={5}
                placeholder={
                  "Paste a JSON array, prompts separated by blank lines, or one per line…"
                }
                className="w-full resize-none bg-transparent text-[11px] leading-relaxed text-cream placeholder:text-fog/60 focus:outline-none"
              />
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[10px] tabular-nums text-fog/70">
                  {importParsed.length} prompt{importParsed.length === 1 ? "" : "s"} detected
                </span>
                <button
                  disabled={importParsed.length === 0}
                  onClick={() => {
                    setDeckItems((prev) =>
                      [...prev.filter((p) => p.trim() !== ""), ...importParsed].slice(
                        0,
                        lab.deckMax,
                      ),
                    );
                    setImportText("");
                    setImportOpen(false);
                  }}
                  className="rounded-lg bg-gold/15 px-2.5 py-1 text-[11px] font-semibold text-gold transition hover:bg-gold/25 disabled:opacity-40"
                >
                  Add to deck
                </button>
              </div>
            </div>
          )}
          <div className="mt-1 text-right text-[10px] tabular-nums text-fog/70">
            {deckLines.length} / {lab.deckMax} prompts
          </div>
        </section>
      ) : (
        <section>
          <div className="flex items-center justify-between">
            <h3 className="text-2xs font-semibold uppercase tracking-[0.14em] text-fog">Prompt</h3>
            <div className="flex items-center gap-1.5">
              {enhanceCtl.button}
              {libraryToggle}
            </div>
          </div>
          {rawMode ? (
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value.slice(0, PROMPT_MAX))}
              rows={7}
              className="mt-2 w-full resize-none rounded-xl border border-cream/10 bg-surface p-3 text-[12px] leading-relaxed text-cream placeholder:text-fog focus:border-gold/40 focus:outline-none"
              placeholder={
                mode === "edit"
                  ? "Describe the new scene for the referenced subject…"
                  : "Describe the image…"
              }
            />
          ) : (
            <div className="mt-2">
              <PromptBuilder chips={chips} onChips={commitChips} />
            </div>
          )}
          {/* the editor switch used to be a 10px text link that read as a
              caption; it's a control, so it looks like one */}
          <div className="mt-1.5 flex items-center justify-between">
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
            <span className="text-[10px] tabular-nums text-fog/70">
              {prompt.length} / {PROMPT_MAX}
            </span>
          </div>
          {enhanceCtl.card}
        </section>
      )}

      <section className="relative">
        <PanelLabel>Model</PanelLabel>
        {mode === "edit" ? (
          <>
            <button
              onClick={() => setModelOpen((o) => !o)}
              className={cx(
                "mt-2 flex w-full items-center gap-2.5 rounded-xl border bg-surface px-3 py-2.5 text-left transition hover:border-gold/35",
                editorMissing ? "border-amber-500/40" : "border-cream/10",
              )}
            >
              <Sparkles size={13} className={editorMissing ? "text-amber-400/80" : "text-gold/80"} />
              <span className="flex-1 truncate text-[12px] text-cream">
                {editor?.label ?? "Qwen Edit 2509 · local"}
              </span>
              <span className="text-[10px] text-fog">
                {refs.length}/{refsMax} refs
              </span>
              <ChevronDown
                size={13}
                className={cx("text-fog transition-transform", modelOpen && "rotate-180")}
              />
            </button>
            {modelOpen && (
              <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-cream/12 bg-raised shadow-xl">
                {editors.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      setEditorId(m.id);
                      setModelOpen(false);
                    }}
                    className={cx(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition hover:bg-cream/5",
                      m.id === editorId ? "text-gold" : "text-cream/85",
                    )}
                  >
                    <span className="w-3.5">{m.id === editorId && <Check size={12} />}</span>
                    <span className="flex-1">{m.label}</span>
                    <span className="text-[10px] text-fog">{m.note}</span>
                  </button>
                ))}
              </div>
            )}
            {lab.modelNotes[activeId] && (
              <p className="mt-1.5 text-[10px] leading-relaxed text-fog/80">
                {lab.modelNotes[activeId]}
              </p>
            )}
            {editorMissing && (
              <p className="mt-1.5 rounded-lg border border-amber-500/25 bg-amber-500/8 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-300">
                {isCloud
                  ? "This model runs on fal.ai — add your API key under Settings → AI Providers to enable it."
                  : "This model isn't installed — download it under Settings → Models, or link a folder that already has the weights (Settings → Models → Linked folders)."}
              </p>
            )}
          </>
        ) : (
          <>
            <button
              onClick={() => setModelOpen((o) => !o)}
              className="mt-2 flex w-full items-center gap-2.5 rounded-xl border border-cream/10 bg-surface px-3 py-2.5 text-left transition hover:border-gold/35"
            >
              <Sparkles size={13} className="text-gold/80" />
              <span className="flex-1 truncate text-[12px] text-cream">
                {(mode === "deck"
                  ? (deckable.find((m) => m.id === modelId) ?? deckable[0])
                  : model
                )?.label}
              </span>
              <ChevronDown
                size={13}
                className={cx("text-fog transition-transform", modelOpen && "rotate-180")}
              />
            </button>
            {modelOpen && (
              <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-cream/12 bg-raised shadow-xl">
                {pickable.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      setModelId(m.id);
                      setModelOpen(false);
                    }}
                    className={cx(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition hover:bg-cream/5",
                      m.id === modelId ? "text-gold" : "text-cream/85",
                    )}
                  >
                    <span className="w-3.5">{m.id === modelId && <Check size={12} />}</span>
                    <span className="flex-1">{m.label}</span>
                    <span className="text-[10px] text-fog">{m.note}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section>
        <PanelLabel>{supportsAutoSize ? "Dimensions" : "Aspect ratio"}</PanelLabel>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {supportsAutoSize && (
            <button
              onClick={() => setAutoSize(true)}
              className={cx(
                "rounded-lg border px-2.5 py-1.5 text-[11px] transition",
                sizeIsAuto
                  ? "border-gold/60 bg-gold/12 text-gold"
                  : "border-cream/10 text-cream/70 hover:border-gold/35 hover:text-cream",
              )}
            >
              Auto
            </button>
          )}
          {(lab.aspects as Aspect[]).map((a) => (
            <button
              key={a}
              onClick={() => {
                setAspect(a);
                setAutoSize(false);
              }}
              className={cx(
                "rounded-lg border px-2.5 py-1.5 text-[11px] tabular-nums transition",
                aspect === a && !sizeIsAuto
                  ? "border-gold/60 bg-gold/12 text-gold"
                  : "border-cream/10 text-cream/70 hover:border-gold/35 hover:text-cream",
              )}
            >
              {a}
            </button>
          ))}
        </div>
        {supportsAutoSize && (
          <p className="mt-1.5 text-[10px] leading-relaxed text-fog/70">
            {sizeIsAuto
              ? mode === "edit"
                ? "Output matches your references' shape — usually right for an edit."
                : "The model picks the size that best fits your prompt."
              : `Forces ${aspect}. Set exact pixels under Advanced (up to ${sizeMax}).`}
          </p>
        )}
      </section>

      {isCloud && (
        <section>
          <PanelLabel>Quality</PanelLabel>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {lab.qualities.map((q) => (
              <button
                key={q}
                onClick={() => setQuality(q)}
                className={cx(
                  "rounded-lg border px-2.5 py-1.5 text-[11px] capitalize transition",
                  quality === q
                    ? "border-gold/60 bg-gold/12 text-gold"
                    : "border-cream/10 text-cream/70 hover:border-gold/35 hover:text-cream",
                )}
              >
                {q}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-fog/70">
            Quality drives the bill — low is roughly a cent an image, high is ~15× that.
          </p>
        </section>
      )}

      {isCloud && (
        <section>
          <PanelLabel>Output format</PanelLabel>
          <div className="mt-2 flex gap-1.5">
            {lab.outputFormats.map((f) => (
              <button
                key={f}
                onClick={() => setOutputFormat(f)}
                className={cx(
                  "flex-1 rounded-lg border py-1.5 text-[11px] uppercase transition",
                  outputFormat === f
                    ? "border-gold/60 bg-gold/12 text-gold"
                    : "border-cream/10 text-cream/70 hover:border-gold/35 hover:text-cream",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <PanelLabel>Style preset</PanelLabel>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {lab.presets.map((p) => (
            <button
              key={p}
              onClick={() => setPreset((cur) => (cur === p ? null : p))}
              className={cx(
                "rounded-full border px-2.5 py-1 text-[11px] transition",
                preset === p
                  ? "border-gold/60 bg-gold/12 text-gold"
                  : "border-cream/10 text-cream/70 hover:border-gold/35 hover:text-cream",
              )}
            >
              {p}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] text-fog/70">
          {preset ? `Appends “${preset.toLowerCase()} style”. Click again to clear.` : "None — your prompt goes to the model as written."}
        </p>
      </section>

      <section>
        <PanelLabel>Seed (optional)</PanelLabel>
        <div className="mt-2 flex items-center gap-1.5">
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))}
            className="min-w-0 flex-1 rounded-lg border border-cream/10 bg-surface px-3 py-2 text-[12px] tabular-nums text-cream focus:border-gold/40 focus:outline-none"
          />
          <button
            title="Random seed"
            onClick={() => setSeed(String(Math.floor(Math.random() * 1_000_000_000)))}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cream/10 text-cream/70 transition hover:border-gold/40 hover:text-gold"
          >
            <Dices size={13} />
          </button>
          <button
            title="Reuse last seed"
            onClick={() => setSeed(String(LAST_SEED))}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cream/10 text-cream/70 transition hover:border-gold/40 hover:text-gold"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </section>

      {mode !== "deck" && (
        <section>
          <PanelLabel>Images per run</PanelLabel>
          <div className="mt-2 flex gap-1.5">
            {Array.from({ length: lab.countMax }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() => setCount(n)}
                className={cx(
                  "flex-1 rounded-lg border py-1.5 text-[11px] tabular-nums transition",
                  count === n
                    ? "border-gold/60 bg-gold/12 text-gold"
                    : "border-cream/10 text-cream/70 hover:border-gold/35 hover:text-cream",
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <button
          onClick={() => setAdvancedOpen((o) => !o)}
          className="flex w-full items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-fog transition hover:text-cream"
        >
          Advanced settings
          <ChevronDown
            size={13}
            className={cx("transition-transform", advancedOpen && "rotate-180")}
          />
        </button>
        {advancedOpen && (
          <div className="mt-2.5 space-y-2 rounded-xl bg-surface p-3">
            <NumberField
              label="Width"
              value={width}
              onChange={setWidth}
              placeholder={sizeIsAuto ? "matches refs" : `${aspect} auto`}
              min={adv.sizeMin}
              max={sizeMax}
              step={adv.sizeStep}
            />
            <NumberField
              label="Height"
              value={height}
              onChange={setHeight}
              placeholder={sizeIsAuto ? "matches refs" : `${aspect} auto`}
              min={adv.sizeMin}
              max={sizeMax}
              step={adv.sizeStep}
            />
            {/* steps/cfg are sampler knobs on the local graphs — the cloud
                endpoint exposes quality instead, so showing them would be a
                pair of controls that silently do nothing */}
            {!isCloud && (
              <>
                <NumberField
                  label="Steps"
                  value={steps}
                  onChange={setSteps}
                  placeholder={String(defaults?.steps ?? "auto")}
                  min={1}
                  max={adv.stepsMax}
                />
                <NumberField
                  label="CFG"
                  value={cfg}
                  onChange={setCfg}
                  placeholder={String(defaults?.cfg ?? "auto")}
                  min={0}
                  max={adv.cfgMax}
                  step={0.5}
                />
              </>
            )}
            {sizeIssue && (
              <p className="rounded-lg border border-amber-500/25 bg-amber-500/8 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-300">
                fal won't accept that size — {sizeIssue}.
              </p>
            )}
            <p className="pt-1 text-[10px] leading-relaxed text-fog/70">
              {sizeIsAuto
                ? "Dimensions is set to Auto — pick an aspect above to use these."
                : isCloud
                  ? `Width + height override the aspect bucket: multiples of 16, no edge over ${sizeMax}px, at least ~0.66 MP, aspect within 3:1.`
                  : "Width + height override the aspect bucket. Blank = the model's proven defaults."}
            </p>
          </div>
        )}
      </section>

      </div>

      {/* The commit bar. It used to sit at the end of the scrolling column, so
          on a tall panel the one button that spends money scrolled out of
          sight — it is pinned now, with the cost line docked to it. */}
      <div className="shrink-0 space-y-2 border-t hairline bg-[#0e0e10]/95 p-3 backdrop-blur">
        <div className="flex gap-px">
        <button
          disabled={!canGenerate}
          onClick={() => {
            const shared = {
              aspect,
              preset: preset ?? undefined,
              seed: /^\d+$/.test(seed) ? Number(seed) : undefined,
              ...sizeOverride,
              steps:
                num(steps) !== undefined
                  ? Math.min(adv.stepsMax, Math.max(1, Math.round(num(steps)!)))
                  : undefined,
              cfg: num(cfg) !== undefined ? Math.min(adv.cfgMax, Math.max(0, num(cfg)!)) : undefined,
            };
            if (mode === "deck") {
              lab.generateDeck({
                deckName: deckName.trim(),
                prompts: deckLines,
                // same fallback the persisted deck stores — see deckModel
                model: deckModel,
                ...shared,
              });
            } else {
              lab.generate({
                prompt,
                model: activeId,
                count,
                ...shared,
                ...(mode === "edit" ? { refs: refs.map((r) => r.rel) } : {}),
                // cloud-only knobs; sending them to a local graph would be
                // dead weight in the payload and a lie on the job card
                ...(isCloud
                  ? {
                      quality: quality as "auto" | "low" | "medium" | "high",
                      outputFormat: outputFormat as "png" | "jpeg" | "webp",
                      sizeMode: sizeIsAuto ? ("auto" as const) : ("aspect" as const),
                    }
                  : {}),
              });
            }
          }}
          className={cx(
            "flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-semibold text-ink",
            "bg-gradient-to-b from-[#dcc08e] via-gold to-gold-deep transition duration-[var(--dur)]",
            "shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_12px_rgba(201,169,110,0.2)]",
            "hover:brightness-110 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_6px_24px_rgba(201,169,110,0.4)]",
            "active:brightness-95 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none",
          )}
        >
          <Sparkles size={13} />{" "}
          {lab.sending
            ? "Queuing…"
            : editorMissing
              ? isCloud
                ? "Add a fal.ai key"
                : "Model not installed"
              : sizeIssue
                ? "Fix the dimensions"
                : mode === "edit" && refs.length === 0
                  ? "Add a reference"
                  : mode === "deck"
                  ? `Generate deck${deckLines.length ? ` · ${deckLines.length}` : ""}`
                  : "Generate"}
        </button>
        </div>
        {/* cost lands above the error slot so it is visible while you set up
            the run, not only after something goes wrong */}
        {isCloud && !editorMissing && (
          <p className="text-center text-[10px] text-fog">
            {estimate} for {count} image{count === 1 ? "" : "s"} · billed to your fal.ai account
          </p>
        )}
        {lab.error ? (
          <p className="rounded-lg border border-red-500/25 bg-red-500/8 px-2.5 py-1.5 text-[10px] leading-relaxed text-red-300">
            {lab.error}
          </p>
        ) : lab.busy ? (
          <p className="text-center text-[10px] text-fog">
            {isCloud
              ? "Rendering at fal.ai — watch the canvas, or queue another run."
              : "Rendering on the GPU — watch the canvas, or queue another run."}
          </p>
        ) : null}
      </div>

      <PromptLibraryPanel
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        prompt={prompt}
        onPick={ps.pickPreset}
      />
    </aside>
  );
}

/* ---------- canvas ---------- */

/** every verb a finished still supports; the tile bar and the lightbox render
 * the same set so an action is never available in only one of them */
interface TileActions {
  liked: (tile: ImageTile) => boolean;
  /** this still has an upscale run in flight — badge it, don't queue another */
  upscaling: (tile: ImageTile) => boolean;
  onLike: (tile: ImageTile) => void;
  onOpen: (tile: ImageTile) => void;
  onEdit: (tile: ImageTile) => void;
  onDownload: (tile: ImageTile) => void;
  onDelete: (tile: ImageTile) => void;
  onUpscale: (tile: ImageTile, mode: "fast" | "refine") => void;
}

/** The two upscale rungs, described the way they actually differ — one
 * interpolates, the other invents. Shown wherever Upscale is offered. */
const UPSCALE_MODES = [
  {
    id: "fast" as const,
    label: "Fast · 4×",
    note: "Real-ESRGAN. Seconds, faithful, no new detail.",
  },
  {
    id: "refine" as const,
    label: "Refine · 2K",
    note: "Qwen-Edit + Upscale2K LoRA. Minutes, sharper, invents detail.",
  },
];

/** a deck job in flight — a 40-prompt run is one long render, so it gets a
 * progress card of its own instead of 40 phantom tiles */
function DeckCard({ deck }: { deck: { id: string; name: string; total: number; done: number; progress: number; stage: string; queued: boolean } }) {
  return (
    <div className="rounded-xl border border-gold/35 bg-surface/70 p-3">
      <div className="flex items-center gap-2">
        <Layers size={14} className="shrink-0 text-gold" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-cream">
          {deck.name}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-fog">
          {deck.queued ? `${deck.total} prompts` : `${deck.done} / ${deck.total}`}
        </span>
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-gold">
          {Math.round(deck.progress)}%
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-cream/8">
        <div
          className="h-full rounded-full bg-gradient-to-r from-gold-deep to-gold transition-[width] duration-500"
          style={{ width: `${Math.max(2, deck.progress)}%` }}
        />
      </div>
      <p className="mt-1.5 text-[10px] text-fog">
        {deck.stage} · finished images appear below as they land
      </p>
    </div>
  );
}

/** A job that died on the engine. The message is almost always actionable
 * ("weights are not installed — Settings → Models → …"), so it belongs in
 * front of whoever pressed Generate, not buried in the Job Center. */
function FailureCard({
  failure,
  onRetry,
  onDismiss,
}: {
  failure: { id: string; title: string; engine: string; error: string };
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/6 p-3">
      <div className="flex items-center gap-2">
        <CircleAlert size={14} className="shrink-0 text-red-400" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-cream">
          {failure.title}
        </span>
        <span className="shrink-0 text-[10px] text-fog">{failure.engine}</span>
        <button
          onClick={onRetry}
          className="shrink-0 rounded-lg border border-cream/15 px-2 py-1 text-[10px] text-cream/85 transition hover:border-gold/45 hover:text-gold"
        >
          Retry
        </button>
        <button
          onClick={onDismiss}
          title="Dismiss"
          className="shrink-0 text-fog/60 transition hover:text-cream"
        >
          <X size={13} />
        </button>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-red-300">{failure.error}</p>
    </div>
  );
}

function ResultTile({
  tile,
  actions,
  view,
  index,
}: {
  tile: ImageTile;
  actions: TileActions;
  /** masonry keeps the true aspect; grid crops to a uniform contact sheet */
  view: "masonry" | "grid";
  /** position in the roll — drives the entrance stagger */
  index: number;
}) {
  /** the tile's own modal layer: delete needs a confirm, upscale needs a
   * choice, and neither fits in the hover bar */
  const [overlay, setOverlay] = useState<null | "delete" | "upscale">(null);
  const masonry = view === "masonry";
  /** the wave: tiles land one after another instead of all at once. Capped so
   * a 60-image roll doesn't spend two seconds assembling itself. */
  const stagger = { animationDelay: `${Math.min(index, 14) * 26}ms` };

  if (tile.generating)
    return (
      <div
        style={stagger}
        className={cx(
          "anim-rise relative flex aspect-[3/2] items-center justify-center overflow-hidden rounded-panel border border-gold/40",
          masonry && "mb-3 break-inside-avoid",
        )}
      >
        <div className={cx("absolute inset-0", tile.swatch, "opacity-60")} />
        {/* a sweep, not a blink — the pulse read as a broken image */}
        <div className="absolute inset-0 animate-[aurea-sweep_1.8s_var(--ease-out-quart)_infinite] bg-[linear-gradient(105deg,transparent_35%,rgba(201,169,110,0.16)_50%,transparent_65%)]" />
        <div className="relative flex flex-col items-center gap-1.5 px-3 text-center">
          <Sparkles size={18} className="animate-pulse text-gold" />
          <span className="max-w-full truncate text-[12px] text-cream/90">
            {tile.generating.label ?? "Generating…"}
          </span>
          <span className="font-serif text-lg font-semibold tabular-nums text-gold">
            {Math.round(tile.generating.progress)}%
          </span>
          {tile.generating.label && (
            <span className="text-[10px] text-fog">appears at the top of the roll when done</span>
          )}
        </div>
      </div>
    );

  const liked = actions.liked(tile);
  const upscaling = actions.upscaling(tile);

  return (
    <div
      style={stagger}
      className={cx(
        "anim-rise group relative overflow-hidden rounded-panel ring-1 ring-cream/6",
        "transition-[box-shadow,transform,--tw-ring-color] duration-[var(--dur-slow)] ease-[var(--ease-out-quart)]",
        "hover:z-10 hover:-translate-y-0.5 hover:shadow-[0_20px_50px_-12px_rgba(0,0,0,0.75)] hover:ring-gold/45",
        masonry ? "mb-3 break-inside-avoid" : "aspect-[4/3]",
        masonry && !tile.url && "aspect-[3/2]",
      )}
    >
      <div className={cx("absolute inset-0", tile.swatch)} />
      {tile.url ? (
        /* in-flow image at its natural aspect — this is what makes the masonry.
           In grid view it fills a uniform cell instead. */
        <button
          onClick={() => actions.onOpen(tile)}
          title="Open full size"
          /* `relative` is load-bearing: the swatch behind is absolutely
             positioned, so a static button would let the placeholder paint
             OVER the loaded still */
          className={cx("relative block cursor-zoom-in", masonry ? "w-full" : "h-full w-full")}
        >
          <img
            src={tile.url}
            alt={tile.name ?? ""}
            draggable={false}
            className={cx(
              "block transition-transform duration-[900ms] ease-[var(--ease-out-quart)] group-hover:scale-[1.04]",
              masonry ? "h-auto w-full" : "h-full w-full object-cover",
            )}
          />
        </button>
      ) : (
        /* stand-in composition lines until real thumbnails flow through the seam */
        <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_30%,rgba(237,234,228,0.07),transparent_60%)]" />
      )}

      {/* the scrim that makes overlaid chrome legible on a bright still */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-ink/85 via-ink/25 to-transparent opacity-0 transition-opacity duration-[var(--dur-slow)] group-hover:opacity-100" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-ink/70 to-transparent opacity-0 transition-opacity duration-[var(--dur-slow)] group-hover:opacity-100" />

      {upscaling && (
        <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-pill bg-ink/70 px-2.5 py-1 text-[10px] font-medium text-gold backdrop-blur">
          <Loader2 size={11} className="animate-spin" /> Upscaling…
        </span>
      )}

      {tile.upscaled && !upscaling && (
        <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-pill bg-ink/70 px-2.5 py-1 text-[10px] font-medium text-gold backdrop-blur">
          <Maximize2 size={11} /> Upscaled
        </span>
      )}

      <button
        title={liked ? "Unlike" : "Like"}
        onClick={() => actions.onLike(tile)}
        className={cx(
          "absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-ink/50 backdrop-blur",
          "transition duration-[var(--dur)] ease-[var(--ease-spring)] hover:scale-110",
          liked ? "text-gold" : "text-cream/70 opacity-0 hover:text-cream group-hover:opacity-100",
        )}
      >
        <Heart size={14} fill={liked ? "currentColor" : "none"} />
      </button>

      {overlay === "delete" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-ink/80 backdrop-blur-sm">
          <p className="px-4 text-center text-[11px] leading-relaxed text-cream/90">
            Delete <span className="text-cream">{tile.name}</span> from disk?
            <br />
            <span className="text-fog">This cannot be undone.</span>
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                setOverlay(null);
                actions.onDelete(tile);
              }}
              className="rounded-lg bg-red-500/85 px-3 py-1.5 text-[11px] font-semibold text-cream transition hover:bg-red-500"
            >
              Delete
            </button>
            <button
              onClick={() => setOverlay(null)}
              className="rounded-lg border border-cream/15 px-3 py-1.5 text-[11px] text-cream/85 transition hover:border-cream/30"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {overlay === "upscale" && (
        <div className="absolute inset-0 flex flex-col justify-center gap-1.5 bg-ink/85 p-4 backdrop-blur-sm">
          {UPSCALE_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setOverlay(null);
                actions.onUpscale(tile, m.id);
              }}
              className="rounded-lg border border-cream/12 px-3 py-2 text-left transition hover:border-gold/50 hover:bg-gold/6"
            >
              <div className="text-[11px] font-semibold text-cream">{m.label}</div>
              <div className="text-[10px] leading-snug text-fog">{m.note}</div>
            </button>
          ))}
          <button
            onClick={() => setOverlay(null)}
            className="mt-0.5 text-[10px] text-fog transition hover:text-cream"
          >
            Cancel
          </button>
        </div>
      )}

      {overlay === null && (
        <div
          className={cx(
            "pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-1.5 px-3 pb-3",
            "translate-y-1.5 opacity-0 transition duration-[var(--dur-slow)] ease-[var(--ease-out-quart)]",
            "group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100",
          )}
        >
          {tile.name && (
            <span className="max-w-full truncate text-[10px] text-cream/90 drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]">
              {tile.name}
            </span>
          )}
          {/* icon-only: five labelled buttons were wider than a masonry column
              and got clipped by the tile's own overflow */}
          <div className="glass flex max-w-full overflow-hidden rounded-pill shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
            {[
              { icon: Expand, label: "Open full size", run: () => actions.onOpen(tile) },
              { icon: Maximize2, label: "Upscale", run: () => setOverlay("upscale") },
              { icon: Pencil, label: "Use as reference", run: () => actions.onEdit(tile) },
              { icon: Download, label: "Download", run: () => actions.onDownload(tile) },
              { icon: Trash2, label: "Delete", run: () => setOverlay("delete"), danger: true },
            ].map(({ icon: Icon, label, run, danger }) => (
              <button
                key={label}
                title={label}
                onClick={run}
                className={cx(
                  "flex h-9 w-9 shrink-0 items-center justify-center text-cream/85",
                  "transition duration-[var(--dur-fast)] hover:bg-cream/10",
                  danger ? "hover:text-red-400" : "hover:text-gold",
                )}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** List view — the roll as a table of stills. Same verbs as the tile bar, laid
 * out for scanning names and dates rather than looking at pictures. */
function ResultRow({
  tile,
  actions,
  index,
}: {
  tile: ImageTile;
  actions: TileActions;
  index: number;
}) {
  const [armed, setArmed] = useState(false);
  const liked = actions.liked(tile);
  const upscaling = actions.upscaling(tile);

  return (
    <div
      style={{ animationDelay: `${Math.min(index, 14) * 18}ms` }}
      className={cx(
        "anim-rise group flex items-center gap-3 rounded-card border border-cream/8 bg-surface/40 p-2",
        "transition duration-[var(--dur)] hover:border-gold/30 hover:bg-surface/70",
      )}
    >
      <button
        onClick={() => actions.onOpen(tile)}
        title="Open full size"
        className="relative h-11 w-16 shrink-0 cursor-zoom-in overflow-hidden rounded-md"
      >
        <span className={cx("absolute inset-0", tile.swatch)} />
        {tile.url && (
          <img src={tile.url} alt="" className="relative h-full w-full object-cover" />
        )}
        {tile.generating && (
          <span className="absolute inset-0 flex items-center justify-center bg-ink/60 text-[10px] font-semibold tabular-nums text-gold">
            {Math.round(tile.generating.progress)}%
          </span>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-cream/90">
          {tile.name ?? tile.generating?.label ?? "Rendering…"}
        </div>
        <div className="flex items-center gap-2 text-2xs text-fog">
          <span>{tile.day ? dayLabel(tile.day) : "in flight"}</span>
          {tile.upscaled && !upscaling && <span className="text-gold/80">· upscaled</span>}
          {upscaling && <span className="text-gold/80">· upscaling…</span>}
        </div>
      </div>

      {!tile.generating && (
        <div className="flex shrink-0 items-center gap-0.5 text-fog/70">
          {[
            {
              icon: Heart,
              label: liked ? "Unlike" : "Like",
              run: () => actions.onLike(tile),
              on: liked,
            },
            { icon: Pencil, label: "Edit", run: () => actions.onEdit(tile) },
            { icon: Download, label: "Download", run: () => actions.onDownload(tile) },
          ].map(({ icon: Icon, label, run, on }) => (
            <button
              key={label}
              title={label}
              onClick={run}
              className={cx(
                "rounded-md p-1.5 transition duration-[var(--dur-fast)] hover:bg-cream/8 hover:text-gold",
                on && "text-gold",
              )}
            >
              <Icon size={13} fill={on ? "currentColor" : "none"} />
            </button>
          ))}
          <button
            title={armed ? "Click again to delete" : "Delete"}
            onClick={() => {
              if (!armed) {
                setArmed(true);
                return;
              }
              setArmed(false);
              actions.onDelete(tile);
            }}
            onBlur={() => setArmed(false)}
            className={cx(
              "rounded-md p-1.5 transition duration-[var(--dur-fast)] hover:bg-cream/8 hover:text-red-400",
              armed && "bg-red-500/15 text-red-400",
            )}
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- lightbox ---------- */

/** Full-view overlay: the whole image uncropped, arrow-key paging through the
 * roll, and the same action set as the tile bar. */
function Lightbox({
  tiles,
  index,
  setIndex,
  onClose,
  actions,
}: {
  tiles: ImageTile[];
  index: number;
  setIndex: (i: number) => void;
  onClose: () => void;
  actions: TileActions;
}) {
  const tile = tiles[index];
  /** delete is two-click here — there is no room for the tile's confirm panel */
  const [armed, setArmed] = useState(false);
  const [upscaleOpen, setUpscaleOpen] = useState(false);
  const step = useCallback(
    (dir: -1 | 1) => {
      setArmed(false);
      setUpscaleOpen(false);
      setIndex((index + dir + tiles.length) % tiles.length);
    },
    [index, tiles.length, setIndex],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, onClose]);

  if (!tile) return null;
  const liked = actions.liked(tile);

  return (
    /* Under Electron the overlay starts BELOW the 36px frameless title strip.
       Full-bleed put our Close pill directly under the OS window buttons,
       where it was invisible and unclickable — and it swallowed the drag
       region while open. */
    <div
      className={cx(
        "fixed inset-x-0 bottom-0 z-[var(--z-modal)] flex flex-col bg-ink/92 backdrop-blur-sm",
        window.aurea?.isElectron ? "top-9" : "top-0",
      )}
      onClick={onClose}
    >
      <header className="flex shrink-0 items-center gap-3 px-5 py-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title="Close (Esc)"
          className={cx(
            "flex h-9 shrink-0 items-center gap-1.5 rounded-pill border border-cream/15 bg-raised px-3.5",
            "text-xs font-medium text-cream/90 shadow-[0_6px_20px_rgba(0,0,0,0.5)]",
            "transition duration-[var(--dur)] hover:border-gold/50 hover:text-gold",
          )}
        >
          <X size={15} />
          Close
        </button>
        <span className="min-w-0 truncate text-[12px] text-cream/90">{tile.name}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-fog">
          {index + 1} / {tiles.length}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 items-center gap-2 px-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            step(-1);
          }}
          title="Previous (←)"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cream/6 text-cream/80 transition hover:bg-cream/12 hover:text-gold"
        >
          <ChevronLeft size={18} />
        </button>
        {/* the img sizes to its own picture (max-w/max-h, no flex-1) so the
            radius hugs the image instead of a letterboxed element box */}
        {/* self-stretch, not the row's items-center default: an auto-height
            wrapper gives `max-h-full` nothing to resolve against and the
            picture spills past the header and action bar */}
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center self-stretch">
          {tile.url && (
            <img
              src={tile.url}
              alt={tile.name ?? ""}
              onClick={(e) => e.stopPropagation()}
              className="max-h-full max-w-full cursor-default rounded-panel object-contain shadow-[0_30px_80px_rgba(0,0,0,0.6)]"
            />
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            step(1);
          }}
          title="Next (→)"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cream/6 text-cream/80 transition hover:bg-cream/12 hover:text-gold"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <footer
        className="flex shrink-0 flex-col items-center gap-2 py-4"
        onClick={(e) => e.stopPropagation()}
      >
        {upscaleOpen && (
          <div className="glass flex gap-1 rounded-xl p-1">
            {UPSCALE_MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setUpscaleOpen(false);
                  actions.onUpscale(tile, m.id);
                }}
                className="max-w-[220px] rounded-lg px-3 py-1.5 text-left transition hover:bg-cream/8"
              >
                <div className="text-[11px] font-semibold text-cream">{m.label}</div>
                <div className="text-[10px] leading-snug text-fog">{m.note}</div>
              </button>
            ))}
          </div>
        )}
        <div className="glass flex overflow-hidden rounded-xl">
          {[
            {
              icon: Heart,
              label: liked ? "Liked" : "Like",
              run: () => actions.onLike(tile),
              on: liked,
            },
            {
              icon: Maximize2,
              label: actions.upscaling(tile) ? "Upscaling…" : "Upscale",
              run: () => setUpscaleOpen((o) => !o),
              on: upscaleOpen || actions.upscaling(tile),
            },
            {
              icon: Pencil,
              label: "Edit",
              run: () => {
                actions.onEdit(tile);
                onClose();
              },
            },
            { icon: Download, label: "Download", run: () => actions.onDownload(tile) },
            {
              icon: Trash2,
              label: armed ? "Sure? Delete" : "Delete",
              run: () => {
                if (!armed) {
                  setArmed(true);
                  return;
                }
                setArmed(false);
                actions.onDelete(tile);
                // the roll shrinks under us — step back so the view stays valid
                if (tiles.length <= 1) onClose();
                else setIndex(Math.min(index, tiles.length - 2));
              },
              danger: true,
              on: armed,
            },
          ].map(({ icon: Icon, label, run, danger, on }) => (
            <button
              key={label}
              onClick={run}
              className={cx(
                "flex flex-col items-center gap-1 px-5 py-2.5 text-[10px] transition hover:bg-cream/8",
                danger
                  ? cx(on ? "text-red-400" : "text-cream/85", "hover:text-red-400")
                  : cx(on ? "text-gold" : "text-cream/85", "hover:text-gold"),
              )}
            >
              <Icon size={15} fill={on && !danger ? "currentColor" : "none"} />
              {label}
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
}

/* ---------- right rail ---------- */

function HistoryRow({ entry, active, onToggle }: {
  entry: ImageHistoryEntry;
  active: boolean;
  onToggle: () => void;
}) {
  const lab = useImageLab();
  const [menu, setMenu] = useState(false);
  /** deleting a whole day is two clicks — the row is small and the act is final */
  const [armed, setArmed] = useState(false);
  const rels = entry.relPaths ?? [];

  const close = () => {
    setMenu(false);
    setArmed(false);
  };

  return (
    <div
      className={cx(
        "relative rounded-xl border transition",
        active
          ? "border-gold/50 bg-surface"
          : "border-transparent bg-surface/60 hover:border-cream/15",
      )}
    >
      <button
        onClick={onToggle}
        title={active ? "Show the whole roll again" : `Show only ${dayLabel(entry.id)}`}
        className="flex w-full items-center gap-2.5 p-2 text-left"
      >
        <div className="flex gap-1">
          {entry.swatches.map((sw, i) =>
            entry.urls?.[i] ? (
              <img key={i} src={entry.urls[i]} alt="" className="h-10 w-10 rounded-md object-cover" />
            ) : (
              <span key={i} className={cx("h-10 w-10 rounded-md", sw)} />
            ),
          )}
        </div>
        {/* pr-5 keeps the text clear of the absolutely-placed kebab above it */}
        <div className="min-w-0 flex-1 pr-5">
          <div className="truncate text-[11px] text-cream/85">{dayLabel(entry.id)}</div>
          <div className="truncate text-[10px] text-fog">
            {entry.count} image{entry.count === 1 ? "" : "s"} · {entry.when}
          </div>
          {active && (
            <Chip tone="gold" className="mt-1">
              Filtering
            </Chip>
          )}
        </div>
      </button>

      <button
        onClick={() => (menu ? close() : setMenu(true))}
        title="Actions for this day"
        className="absolute right-1.5 top-2 p-1 text-fog/60 transition hover:text-gold"
      >
        <MoreHorizontal size={14} />
      </button>

      {menu && (
        <>
          {/* click-away — a menu that only closes via its own items strands you */}
          <div className="fixed inset-0 z-20" onClick={close} />
          <div className="glass absolute right-1.5 top-8 z-30 w-[188px] overflow-hidden rounded-xl py-1">
            <button
              onClick={() => {
                onToggle();
                close();
              }}
              className="block w-full px-3 py-1.5 text-left text-[11px] text-cream/85 transition hover:bg-cream/8 hover:text-gold"
            >
              {active ? "Clear day filter" : "Show only this day"}
            </button>
            <button
              onClick={() => {
                if (!armed) {
                  setArmed(true);
                  return;
                }
                close();
                if (rels.length) void lab.remove(rels);
              }}
              disabled={!rels.length || lab.removing}
              className={cx(
                "block w-full px-3 py-1.5 text-left text-[11px] transition hover:bg-cream/8 disabled:opacity-40",
                armed ? "text-red-400" : "text-cream/85 hover:text-red-400",
              )}
            >
              {armed ? `Sure? Delete ${rels.length}` : `Delete all ${rels.length}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** What each slot is for. The local 3-ref stack has fixed roles because
 * Qwen encodes them positionally; the cloud model just takes a list, so past
 * the third every slot is simply another reference in priority order. */
function refSlotLabel(i: number, refsMax: number): string {
  if (refsMax <= 3) return i === 0 ? "subject" : i === 1 ? "scene / prop" : "style";
  return i === 0 ? "subject" : `reference ${i + 1}`;
}

function RefsPanel({ refs, setRefs, onAdded, refsMax }: {
  refs: RefImage[];
  setRefs: React.Dispatch<React.SetStateAction<RefImage[]>>;
  onAdded: () => void;
  /** ceiling for the selected edit model, not the lab-wide outer bound */
  refsMax: number;
}) {
  const lab = useImageLab();
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
    <section className="rounded-xl bg-surface/40 p-2.5">
      <div className="flex items-center justify-between px-1 pb-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">
          Edit with reference
        </h3>
        <span className="text-[10px] tabular-nums text-fog/70">
          {refs.length}/{refsMax}
        </span>
      </div>

      {refs.length > 0 && (
        <div className="mb-2 space-y-1.5">
          {refs.map((r, i) => (
            <div
              key={r.rel}
              className="flex items-center gap-2 rounded-xl border border-cream/10 bg-surface p-1.5"
            >
              <img src={r.url} alt="" className="h-10 w-10 rounded-md object-cover" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] text-cream/85">{r.name}</div>
                <div className="text-[10px] text-fog">{refSlotLabel(i, refsMax)}</div>
              </div>
              <button
                title="Move up"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="text-fog/60 transition hover:text-gold disabled:opacity-30"
              >
                <ArrowLeft size={12} className="rotate-90" />
              </button>
              <button
                title="Move down"
                onClick={() => move(i, 1)}
                disabled={i === refs.length - 1}
                className="text-fog/60 transition hover:text-gold disabled:opacity-30"
              >
                <ArrowRight size={12} className="rotate-90" />
              </button>
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
                className="mr-1 text-fog/60 transition hover:text-red-400"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            void addFiles(e.target.files).then(onAdded);
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
            if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files).then(onAdded);
          }}
          className="flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed border-gold/35 px-4 py-8 transition hover:border-gold/60 hover:bg-gold/4"
        >
          <ImagePlus size={22} strokeWidth={1.5} className="text-gold/80" />
          <span className="mt-1 text-[12px] font-medium text-cream/90">
            {lab.addingRef ? "Uploading…" : "Drop image here"}
          </span>
          <span className="text-[11px] text-fog">or click to upload</span>
          <span className="mt-1 text-[10px] text-fog/60">JPG, PNG up to 20 MB</span>
        </button>
      )}
      {error && <p className="mt-2 px-1 text-[10px] text-red-400">{error}</p>}
      <p className="mt-2 px-1 text-[10px] leading-relaxed text-fog">
        {refsMax <= 3
          ? "References route through Qwen-Edit 2509 — keeps characters on-model with no LoRA. Order matters: subject first, then scene/prop, then style."
          : `Up to ${refsMax} references on this model — a whole cast plus a location plate and style frames in one edit. Order still matters: most important first.`}
      </p>
    </section>
  );
}

/** history days shown before "View all" opens the rest — the rail is a shortcut
 * into the roll, not a second copy of it */
const HISTORY_DAYS = 6;

function RightRail({ refs, setRefs, onRefAdded, dayFilter, setDayFilter, refsMax }: {
  refs: RefImage[];
  setRefs: React.Dispatch<React.SetStateAction<RefImage[]>>;
  onRefAdded: () => void;
  dayFilter: string | null;
  setDayFilter: (day: string | null) => void;
  refsMax: number;
}) {
  const lab = useImageLab();
  const [all, setAll] = useState(false);
  const shown = all ? lab.history : lab.history.slice(0, HISTORY_DAYS);

  return (
    <aside className="flex w-[316px] shrink-0 flex-col gap-3 overflow-y-auto border-l hairline bg-[#0e0e10] p-3">
      <section className="rounded-xl bg-surface/40 p-2.5">
        <div className="flex items-center justify-between px-1 pb-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">
            Generation history
          </h3>
          {lab.history.length > HISTORY_DAYS && (
            <button
              onClick={() => setAll((v) => !v)}
              className="text-[11px] text-gold hover:underline"
            >
              {all ? "Show less" : `View all ${lab.history.length}`}
            </button>
          )}
        </div>
        {shown.length === 0 ? (
          <p className="px-1 pb-1 text-[11px] leading-relaxed text-fog">
            No stills yet — finished renders group here by day.
          </p>
        ) : (
          <div className="space-y-1.5">
            {shown.map((h) => (
              <HistoryRow
                key={h.id}
                entry={h}
                active={dayFilter === h.id}
                onToggle={() => setDayFilter(dayFilter === h.id ? null : h.id)}
              />
            ))}
          </div>
        )}
      </section>

      <RefsPanel refs={refs} setRefs={setRefs} onAdded={onRefAdded} refsMax={refsMax} />
    </aside>
  );
}

/* ---------- status bar ---------- */

function LabStatusBar() {
  const lab = useImageLab();
  const { system } = useSystem();
  const { vram } = useJobs();
  const pct = Math.min(100, (vram.used / vram.total) * 100);
  const [copied, setCopied] = useState(false);

  return (
    <StatusBar
      left={
        <>
          <span className="flex items-center gap-1.5">
            <i className="h-1.5 w-1.5 rounded-full bg-sage shadow-[0_0_6px_1px_rgba(111,160,124,0.6)]" />
            <span className="text-cream/80">{lab.models[0].label}</span>
            <span className="text-sage">Ready</span>
          </span>
          <span className="tabular-nums">{lab.resolution}</span>
          <span className="tabular-nums">
            {lab.batch.length} image{lab.batch.length === 1 ? "" : "s"}
          </span>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(String(lab.seed));
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            }}
            title="Copy the seed"
            className="flex items-center gap-1 tabular-nums transition hover:text-gold"
          >
            Seed: {lab.seed}
            {copied ? <Check size={11} className="text-sage" /> : <Copy size={11} />}
          </button>
        </>
      }
      right={
        <>
          <span className="flex items-center gap-2">
            <span className="text-fog/70">GPU</span>
            <span className="text-cream/80">{system.gpu.replace("NVIDIA GeForce ", "")}</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="text-fog/70">VRAM</span>
            <span className="h-1 w-24 overflow-hidden rounded-full bg-cream/8">
              <span
                className="block h-full rounded-full bg-gradient-to-r from-gold-deep to-gold transition-[width] duration-[var(--dur-slow)]"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="tabular-nums text-cream/80">
              {vram.used} / {vram.total} GB
            </span>
          </span>
        </>
      }
    />
  );
}

/* ---------- screen ---------- */

/** Layout choices are muscle memory — they survive the screen. */
const PREF_KEY = "aurea:imagelab:prefs";
interface LabPrefs {
  view: RollView;
  railOpen: boolean;
  libraryDocked: boolean;
}
/* The library column is open out of the box — it is half of what the composer
 * is for, and a panel nobody knows to unhide may as well not exist. The
 * Library button in the Prompt header (and the rail's own ✕) toggles it. */
const PREF_DEFAULTS: LabPrefs = { view: "masonry", railOpen: true, libraryDocked: true };

function loadPrefs(): LabPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}");
    return { ...PREF_DEFAULTS, ...(raw && typeof raw === "object" ? raw : {}) };
  } catch {
    return PREF_DEFAULTS;
  }
}

export function ImageLab() {
  const lab = useImageLab();
  const likes = useLikes();
  /** the prompt is shared by the composer and the docked library column */
  const ps = usePromptState(lab.prompt);
  const [mode, setMode] = useState<LabMode>("generate");
  const [refs, setRefs] = useState<RefImage[]>([]);
  /** which edit model is selected. It lives here because the params panel
   * picks it but the refs panel (a sibling) enforces its reference ceiling. */
  const [editorId, setEditorId] = useState("qwen-edit");
  const refsMax = lab.refsMaxByModel[editorId] ?? lab.refsMax;
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  /** a day picked in the history rail — the roll narrows to it until cleared */
  const [dayFilter, setDayFilter] = useState<string | null>(null);
  const [visible, setVisible] = useState(ROLL_PAGE);

  /* ---- the roll's own chrome: scope, search, layout (all sticky) ---- */
  const [prefs, setPrefs] = useState<LabPrefs>(loadPrefs);
  const setPref = <K extends keyof LabPrefs>(key: K, value: LabPrefs[K]) =>
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      localStorage.setItem(PREF_KEY, JSON.stringify(next));
      return next;
    });
  const [scope, setScope] = useState<RollScope>("all");
  const [scopeOpen, setScopeOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  /** the canvas scroller — "New generation" returns you to the top of the roll */
  const canvasRef = useRef<HTMLElement>(null);

  const q = search.trim().toLowerCase();
  const filtering = !!dayFilter || scope !== "all" || !!q;

  // Work in flight is never filtered out — pressing Generate with a past day
  // pinned (or a search typed) otherwise looks like nothing happened.
  const roll = lab.batch.filter((t) => {
    if (t.generating) return true;
    if (dayFilter && t.day !== dayFilter) return false;
    if (scope === "favorites" && !likes.isLiked(t.relPath)) return false;
    if (scope === "upscaled" && !t.upscaled) return false;
    if (q && !(t.name ?? "").toLowerCase().includes(q)) return false;
    return true;
  });

  // a narrower roll must start from the top again, or "show older" state from
  // the full roll leaves a filtered day looking longer than it is
  useEffect(() => setVisible(ROLL_PAGE), [dayFilter, scope, q]);

  // the references live in the right rail — switching to Edit with the rail
  // hidden would put the mode's only real control off screen
  useEffect(() => {
    if (mode === "edit") setPref("railOpen", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // dropping from the cloud model's 16 refs back to qwen-edit's 3 has to trim
  // the list here — otherwise the extras stay on screen and the run dies in
  // the adapter with a limit the panel was still showing as fine
  useEffect(() => {
    setRefs((prev) => (prev.length > refsMax ? prev.slice(0, refsMax) : prev));
  }, [refsMax]);

  /** only finished stills are openable/actionable — generating tiles have no file */
  const openable = roll.filter((t) => t.url && t.relPath);

  const actions: TileActions = {
    liked: (t) => likes.isLiked(t.relPath),
    upscaling: (t) => !!t.relPath && lab.upscaling.includes(t.relPath),
    onLike: (t) => likes.toggleLike(t.relPath),
    onOpen: (t) => {
      const i = openable.findIndex((o) => o.id === t.id);
      if (i >= 0) setLightbox(i);
    },
    onEdit: (t) => {
      if (!t.relPath || !t.url) return;
      setMode("edit");
      setRefs((prev) =>
        prev.some((r) => r.rel === t.relPath) || prev.length >= refsMax
          ? prev
          : [...prev, { rel: t.relPath!, url: t.url!, name: t.name ?? "reference" }],
      );
    },
    onDownload: (t) => {
      if (t.url) void downloadAsset(t.url, t.name ?? "image.png");
    },
    onDelete: (t) => {
      if (!t.relPath) return;
      // a deleted asset must not linger as a stale reference
      setRefs((prev) => prev.filter((r) => r.rel !== t.relPath));
      void lab.remove(t.relPath);
    },
    onUpscale: (t, mode) => {
      if (t.relPath) lab.upscale(t.relPath, mode);
    },
  };

  const finished = roll.filter((t) => !t.generating).length;
  const rendering = roll.length - finished;
  const subtitle =
    `${finished} generation${finished === 1 ? "" : "s"}` +
    (rendering ? ` · ${rendering} rendering` : "") +
    (filtering ? " · filtered" : "");

  const clearFilters = () => {
    setDayFilter(null);
    setScope("all");
    setSearch("");
  };

  return (
    <div className="flex h-full flex-col">
      <LabHeader
        scope={scope}
        setScope={setScope}
        scopeOpen={scopeOpen}
        setScopeOpen={setScopeOpen}
        search={search}
        setSearch={setSearch}
        view={prefs.view}
        setView={(v) => setPref("view", v)}
        railOpen={prefs.railOpen}
        setRailOpen={(o) => setPref("railOpen", o)}
        subtitle={subtitle}
        onNewGeneration={() => {
          // a fresh sheet: empty composer, unfiltered roll, back at the top
          ps.clear();
          setMode("generate");
          clearFilters();
          canvasRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />

      <div className="flex min-h-0 flex-1">
        <ParamsPanel
          mode={mode}
          setMode={setMode}
          refs={refs}
          editorId={editorId}
          setEditorId={setEditorId}
          refsMax={refsMax}
          ps={ps}
          libraryDocked={prefs.libraryDocked}
          setLibraryDocked={(o) => setPref("libraryDocked", o)}
          libraryOpen={libraryOpen}
          setLibraryOpen={setLibraryOpen}
        />

        {prefs.libraryDocked && (
          <PromptLibraryRail
            onPick={ps.pickPreset}
            onClose={() => setPref("libraryDocked", false)}
            onManage={() => setLibraryOpen(true)}
          />
        )}

        <section ref={canvasRef} className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {lab.failures
            .filter((f) => !dismissed.includes(f.id))
            .map((f) => (
              <FailureCard
                key={f.id}
                failure={f}
                onRetry={() => lab.retry(f.id)}
                onDismiss={() => setDismissed((prev) => [...prev, f.id])}
              />
            ))}

          {lab.decks.map((deck) => (
            <DeckCard key={deck.id} deck={deck} />
          ))}

          {/* what is currently narrowing the roll, and one click off each */}
          {filtering && roll.length > 0 && (
            <div className="anim-fade flex flex-wrap items-center gap-1.5">
              {dayFilter && (
                <Chip tone="gold" onClick={() => setDayFilter(null)} title="Clear the day filter">
                  {dayLabel(dayFilter)} <X size={10} />
                </Chip>
              )}
              {scope !== "all" && (
                <Chip tone="gold" onClick={() => setScope("all")} title="Clear the scope filter">
                  {scope === "favorites" ? "Favorites" : "Upscaled"} <X size={10} />
                </Chip>
              )}
              {q && (
                <Chip tone="gold" onClick={() => setSearch("")} title="Clear the search">
                  “{search.trim()}” <X size={10} />
                </Chip>
              )}
              <button
                onClick={clearFilters}
                className="text-2xs text-fog transition hover:text-gold"
              >
                Clear all
              </button>
            </div>
          )}

          {roll.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2.5 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full border border-gold/25 bg-gold/6">
                <Sparkles size={22} className="text-gold/70" />
              </span>
              <p className="font-serif text-lg text-cream/90">
                {filtering ? "Nothing matches" : "Nothing rendered yet"}
              </p>
              <p className="max-w-[300px] text-xs leading-relaxed text-fog">
                {filtering
                  ? "No still on the roll matches those filters — widen them, or clear them to see everything."
                  : "Describe an image on the left and hit Generate — every take lands here and in the asset library."}
              </p>
              {filtering && (
                <button
                  onClick={clearFilters}
                  className="mt-1 rounded-pill border border-cream/12 px-3 py-1.5 text-xs text-cream/80 transition hover:border-gold/50 hover:text-gold"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <>
              {groupByDay(roll.slice(0, visible)).map((section, si) => (
                <div key={section.day} className="first:-mt-2">
                  {/* the roll used to run together as one undated wall — the
                      separator is what makes "a day's work" legible, so it
                      gets real weight, a rule, and air above it */}
                  <div className="sticky top-0 z-20 -mx-4 mb-3 mt-5 bg-ink/85 px-4 pb-2 pt-2 backdrop-blur-md">
                    <div className="flex items-center gap-2.5 border-b border-cream/12 pb-2">
                      <span className="h-3.5 w-[3px] shrink-0 rounded-full bg-gold/70 shadow-[0_0_8px_rgba(201,169,110,0.5)]" />
                      <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-cream">
                        {dayLabel(section.day)}
                      </h3>
                      <span className="rounded-pill bg-cream/8 px-2 py-0.5 text-2xs font-semibold tabular-nums text-fog">
                        {section.tiles.length}
                      </span>
                    </div>
                  </div>
                  {prefs.view === "list" ? (
                    <div className="space-y-1.5">
                      {section.tiles.map((tile, i) => (
                        <ResultRow key={tile.id} tile={tile} actions={actions} index={i} />
                      ))}
                    </div>
                  ) : (
                    <div
                      className={
                        prefs.view === "masonry"
                          ? /* tiles keep their real aspect and pack tight */
                            "columns-2 gap-3 lg:columns-3 2xl:columns-4"
                          : /* contact sheet — uniform cells, easier to scan */
                            "grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-4"
                      }
                    >
                      {section.tiles.map((tile, i) => (
                        <ResultTile
                          key={tile.id}
                          tile={tile}
                          actions={actions}
                          view={prefs.view === "grid" ? "grid" : "masonry"}
                          // only the first screenful earns the entrance wave
                          index={si === 0 ? i : 99}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {visible < roll.length && (
                <button
                  onClick={() => setVisible((v) => v + ROLL_PAGE)}
                  className="mx-auto rounded-pill border border-cream/12 px-4 py-2 text-xs text-cream/80 transition hover:border-gold/50 hover:text-gold"
                >
                  Show older — {roll.length - visible} more
                </button>
              )}
            </>
          )}
        </section>

        {prefs.railOpen && (
          <RightRail
            refs={refs}
            setRefs={setRefs}
            onRefAdded={() => setMode("edit")}
            dayFilter={dayFilter}
            setDayFilter={setDayFilter}
            refsMax={refsMax}
          />
        )}
      </div>
      <LabStatusBar />

      {lightbox !== null && openable.length > 0 && (
        <Lightbox
          tiles={openable}
          index={Math.min(lightbox, Math.max(0, openable.length - 1))}
          setIndex={setLightbox}
          onClose={() => setLightbox(null)}
          actions={actions}
        />
      )}
    </div>
  );
}
