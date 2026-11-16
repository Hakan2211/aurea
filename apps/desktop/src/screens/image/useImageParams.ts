import { useEffect, useRef, useState } from "react";
import { falImageEstimate, falSizeError } from "@aurea/shared";
import { useImageLab } from "@/hooks";
import { useDraft } from "@/useDraft";
import type { PromptState } from "./promptState";
import { useEnhanceControl } from "./EnhanceButton";
import { useActivePromptProject, usePromptDecks } from "./promptHooks";

/* Every Image-lab render setting, its gating and the payload (UI simplify
 * plan, Stage 3). Moved verbatim out of the old left-hand params panel so the
 * composer and the Advanced drawer read one state: opening or closing the
 * drawer can never change what Generate sends. `customs` lists the Advanced
 * settings that are off their defaults, read off what the payload carries. */

/** seed of the batch on the canvas — what the refresh button restores */
export const LAST_SEED = 746583928;

export type Aspect = "1:1" | "3:2" | "16:9" | "4:3" | "9:16";
export type LabMode = "generate" | "edit" | "deck";

export const MODE_LABEL: Record<LabMode, string> = {
  generate: "Generate",
  edit: "Edit with refs",
  deck: "Deck",
};

/** what the Model picker starts on in generate/deck mode */
const DEFAULT_GENERATOR = "krea2";

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
export const modelAvailable = (m: { id: string; available?: boolean }) => m.available !== false;

export function useImageParams({
  mode,
  refs,
  editorId,
  setEditorId,
  refsMax,
  ps,
}: {
  mode: LabMode;
  refs: RefImage[];
  /** the chosen edit model lives in the screen — the refs strip enforces its
   * per-model reference ceiling */
  editorId: string;
  setEditorId: (id: string) => void;
  refsMax: number;
  ps: PromptState;
}) {
  const lab = useImageLab();
  const { prompt, setPrompt, chips, commitChips, rawMode, toggleRaw } = ps;
  /** Krea 2 is the house generator (photoreal heroes) — the catalog lists
   * z-image first because it's the fast drafting model, but that is not what
   * anyone wants pre-selected. Falls back to whatever IS runnable below. */
  const [modelId, setModelId] = useDraft("image:modelId", DEFAULT_GENERATOR);
  const [aspect, setAspect] = useDraft<Aspect>("image:aspect", "3:2");
  /** no preset is the honest default — the prompt reaches the model unmodified
   * until you pick one, and clicking the active chip clears it again */
  const [preset, setPreset] = useDraft<string | null>("image:preset", null);
  const [seed, setSeed] = useDraft("image:seed", String(lab.seed));
  const [count, setCount] = useDraft("image:count", 1);
  const [width, setWidth] = useDraft("image:width", "");
  const [height, setHeight] = useDraft("image:height", "");
  const [steps, setSteps] = useDraft("image:steps", "");
  const [cfg, setCfg] = useDraft("image:cfg", "");
  /** cloud-model knobs — inert for the local graphs, which use steps/cfg */
  const [quality, setQuality] = useDraft("image:quality", "high");
  const [outputFormat, setOutputFormat] = useDraft("image:outputFormat", "png");
  /** "auto" = let the model take its size from the references, which is the
   * right default for an edit; picking an aspect chip switches this off */
  const [autoSize, setAutoSize] = useDraft("image:autoSize", true);
  const [deckName, setDeckName] = useState("");
  /** one entry per prompt — a prompt can span many lines (JSON, shot specs) */
  const [deckItems, setDeckItems] = useState<string[]>([""]);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");

  /* ---- prompt builder + library (Track B3) ---- */
  const promptProject = useActivePromptProject();
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
  /** "Auto" = take the size from the references: any edit on a model that
   * can (local h3-image sizes from <Picture 1>), plus cloud runs */
  const supportsAutoSize =
    mode !== "deck" && lab.autoSizeModels.includes(activeId) && (isCloud || mode === "edit");
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

  /** the seed field starts on the lab's seed; only a change counts as custom */
  const [seedDefault] = useState(String(lab.seed));

  /** what a plain run would not send — the composer's "N custom" chip */
  const customs: string[] = [];
  if (preset) customs.push(`Style: ${preset}`);
  if (seed !== seedDefault) customs.push(/^\d+$/.test(seed) ? `Seed ${seed}` : "Seed: random");
  if (sizeOverride.width) customs.push(`Size ${sizeOverride.width}×${sizeOverride.height}`);
  if (num(steps) !== undefined) customs.push(`Steps ${steps}`);
  if (num(cfg) !== undefined) customs.push(`CFG ${cfg}`);
  if (isCloud && quality !== "high") customs.push(`Quality: ${quality}`);
  if (isCloud && outputFormat !== "png") customs.push(`Format: ${outputFormat.toUpperCase()}`);

  const generate = () => {
    if (!canGenerate) return;
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
        const sentPrompt = prompt;
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
            : sizeIsAuto
              ? { sizeMode: "auto" as const }
              : {}),
        }, () => ps.sent(sentPrompt));
      }
  };

  const generateLabel = lab.sending
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
            : "Generate";

  return {
    lab, mode, refs, refsMax, editorId, setEditorId, ps,
    prompt, setPrompt, chips, commitChips, rawMode, toggleRaw,
    modelId, setModelId, aspect, setAspect, preset, setPreset, seed, setSeed,
    count, setCount, width, setWidth, height, setHeight, steps, setSteps, cfg, setCfg,
    quality, setQuality, outputFormat, setOutputFormat, autoSize, setAutoSize,
    deckName, setDeckName, deckItems, setDeckItems, importOpen, setImportOpen,
    importText, setImportText, importParsed, deckLines,
    enhanceCtl, deckStore, deckId, setDeckId, deckPickOpen, setDeckPickOpen,
    deckArmed, setDeckArmed, deckSavedRef, loadDeck, newDeck,
    generators, deckable, deckModel, editors, editor, pickable, model, activeId,
    editorMissing, isCloud, supportsAutoSize, sizeIsAuto, adv, defaults, sizeMax,
    sizeOverride, estimate, sizeIssue, canGenerate, customs, generate, generateLabel,
  };
}

export type ImageParams = ReturnType<typeof useImageParams>;
