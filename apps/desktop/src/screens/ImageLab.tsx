import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
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
  HelpCircle,
  ImagePlus,
  Layers,
  Loader2,
  Maximize2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { downloadAsset, useImageLab, useLikes, useSystem, useJobs } from "@/hooks";
import type { ImageHistoryEntry, ImageTile } from "@/data/sample";
import { Chip, cx } from "@/components/ui";
import { fileToPngBase64 } from "@/components/imageFile";

/* Image lab — UI-Design/Image Lab.jpg. Prompt-to-image with the real engine
 * roster (Krea 2 default, z-image-turbo drafts, Qwen-Edit reference edits);
 * params and history flow through useImageLab (tRPC seam). Edit mode routes
 * through Qwen-Edit 2509 with up to 3 reference images (the QIE multi-ref
 * consistency stack — subject first, then scene/prop/style). */

const PROMPT_MAX = 1000;
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
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">{children}</h3>
      {hint && <HelpCircle size={12} className="text-fog/50" />}
    </div>
  );
}

/** sample-data models carry no role — infer it from the id for those */
const modelRole = (m: { id: string; role?: string }) =>
  m.role ?? (m.id === "qwen-edit" ? "edit" : "generate");

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

function ParamsPanel({ mode, setMode, refs }: {
  mode: LabMode;
  setMode: (m: LabMode) => void;
  refs: RefImage[];
}) {
  const lab = useImageLab();
  const [prompt, setPrompt] = useState(lab.prompt);
  const [modelId, setModelId] = useState(lab.models[0].id);
  const [modelOpen, setModelOpen] = useState(false);
  const [aspect, setAspect] = useState<Aspect>("3:2");
  /** no preset is the honest default — the prompt reaches the model unmodified
   * until you pick one, and clicking the active chip clears it again */
  const [preset, setPreset] = useState<string | null>(null);
  const [seed, setSeed] = useState(String(lab.seed));
  const [count, setCount] = useState(1);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [steps, setSteps] = useState("");
  const [cfg, setCfg] = useState("");
  const [deckName, setDeckName] = useState("");
  /** one entry per prompt — a prompt can span many lines (JSON, shot specs) */
  const [deckItems, setDeckItems] = useState<string[]>([""]);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");

  const deckLines = deckItems
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, lab.deckMax);
  const importParsed = importOpen ? parseDeckImport(importText) : [];

  const generators = lab.models.filter((m) => modelRole(m) === "generate");
  const editor = lab.models.find((m) => modelRole(m) === "edit");
  /** catalog says the edit model can't run — warn up front instead of letting
   * the job die in engine preflight with nothing visible in the lab */
  const editorMissing = mode === "edit" && !!editor && !modelAvailable(editor);
  const activeId = mode === "edit" ? (editor?.id ?? "qwen-edit") : modelId;
  const model =
    (mode === "edit" ? editor : generators.find((m) => m.id === modelId)) ?? generators[0];

  const adv = lab.advancedCfg;
  const defaults = adv.defaults[activeId];
  const num = (s: string) => (s.trim() !== "" && !Number.isNaN(Number(s)) ? Number(s) : undefined);
  /** free size only applies when both fields are set; snap into the valid grid */
  const snapSize = (v: number) =>
    Math.min(adv.sizeMax, Math.max(adv.sizeMin, Math.round(v / adv.sizeStep) * adv.sizeStep));
  const sizeOverride =
    num(width) !== undefined && num(height) !== undefined
      ? { width: snapSize(num(width)!), height: snapSize(num(height)!) }
      : {};

  const canGenerate =
    !lab.sending &&
    !editorMissing &&
    (mode === "deck"
      ? deckName.trim() !== "" && deckLines.length > 0
      : !!prompt.trim() && (mode === "generate" || refs.length > 0));

  return (
    <aside className="flex w-[264px] shrink-0 flex-col gap-5 overflow-y-auto border-r hairline bg-[#0e0e10] p-4">
      <section className="flex rounded-xl border border-cream/10 bg-surface p-1">
        {(["generate", "edit", "deck"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cx(
              "flex-1 rounded-lg py-1.5 text-[11px] font-semibold transition",
              mode === m ? "bg-gold/15 text-gold" : "text-fog hover:text-cream",
            )}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </section>

      {mode === "deck" ? (
        <section>
          <PanelLabel hint>Deck</PanelLabel>
          <input
            value={deckName}
            onChange={(e) => setDeckName(e.target.value.slice(0, 60))}
            placeholder="Deck name (folder name)"
            className="mt-2 w-full rounded-xl border border-cream/10 bg-surface px-3 py-2.5 text-[12px] text-cream placeholder:text-fog focus:border-gold/40 focus:outline-none"
          />
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
          <PanelLabel hint>Prompt</PanelLabel>
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
          <div className="mt-1 text-right text-[10px] text-fog/70">
            {prompt.length} / {PROMPT_MAX}
          </div>
        </section>
      )}

      <section className="relative">
        <PanelLabel>Model</PanelLabel>
        {mode === "edit" ? (
          <>
            <div
              className={cx(
                "mt-2 flex w-full items-center gap-2.5 rounded-xl border bg-surface px-3 py-2.5",
                editorMissing ? "border-amber-500/40" : "border-cream/10",
              )}
            >
              <Sparkles size={13} className={editorMissing ? "text-amber-400/80" : "text-gold/80"} />
              <span className="flex-1 truncate text-[12px] text-cream">
                {editor?.label ?? "Qwen Edit 2509 · local"}
              </span>
              <span className="text-[10px] text-fog">{refs.length}/{lab.refsMax} refs</span>
            </div>
            {editorMissing && (
              <p className="mt-1.5 rounded-lg border border-amber-500/25 bg-amber-500/8 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-300">
                This model isn't installed — download it under Settings → Models, or link a folder
                that already has the weights (Settings → Models → Linked folders).
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
              <span className="flex-1 truncate text-[12px] text-cream">{model.label}</span>
              <ChevronDown
                size={13}
                className={cx("text-fog transition-transform", modelOpen && "rotate-180")}
              />
            </button>
            {modelOpen && (
              <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-cream/12 bg-raised shadow-xl">
                {generators.map((m) => (
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
        <PanelLabel>Aspect ratio</PanelLabel>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(lab.aspects as Aspect[]).map((a) => (
            <button
              key={a}
              onClick={() => setAspect(a)}
              className={cx(
                "rounded-lg border px-2.5 py-1.5 text-[11px] tabular-nums transition",
                aspect === a
                  ? "border-gold/60 bg-gold/12 text-gold"
                  : "border-cream/10 text-cream/70 hover:border-gold/35 hover:text-cream",
              )}
            >
              {a}
            </button>
          ))}
        </div>
      </section>

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
              placeholder={`${aspect} auto`}
              min={adv.sizeMin}
              max={adv.sizeMax}
              step={adv.sizeStep}
            />
            <NumberField
              label="Height"
              value={height}
              onChange={setHeight}
              placeholder={`${aspect} auto`}
              min={adv.sizeMin}
              max={adv.sizeMax}
              step={adv.sizeStep}
            />
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
            <p className="pt-1 text-[10px] leading-relaxed text-fog/70">
              Width + height override the aspect bucket. Blank = the model's proven defaults.
            </p>
          </div>
        )}
      </section>

      <div className="mt-auto space-y-2 pt-2">
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
                model: modelId,
                ...shared,
              });
            } else {
              lab.generate({
                prompt,
                model: activeId,
                count,
                ...shared,
                ...(mode === "edit" ? { refs: refs.map((r) => r.rel) } : {}),
              });
            }
          }}
          className="flex flex-1 items-center justify-center gap-2 rounded-l-xl bg-gradient-to-b from-gold to-gold-deep py-2.5 text-[13px] font-semibold text-ink transition hover:brightness-110 active:brightness-95 disabled:pointer-events-none disabled:opacity-50"
        >
          <Sparkles size={13} />{" "}
          {lab.sending
            ? "Queuing…"
            : editorMissing
              ? "Model not installed"
              : mode === "edit" && refs.length === 0
                ? "Add a reference"
                : mode === "deck"
                  ? `Generate deck${deckLines.length ? ` · ${deckLines.length}` : ""}`
                  : "Generate"}
        </button>
        <button className="flex w-9 items-center justify-center rounded-r-xl bg-gradient-to-b from-gold to-gold-deep text-ink transition hover:brightness-110">
          <ChevronDown size={14} />
        </button>
        </div>
        {lab.error ? (
          <p className="rounded-lg border border-red-500/25 bg-red-500/8 px-2.5 py-1.5 text-[10px] leading-relaxed text-red-300">
            {lab.error}
          </p>
        ) : lab.busy ? (
          <p className="text-center text-[10px] text-fog">
            Rendering on the GPU — watch the canvas, or queue another run.
          </p>
        ) : null}
      </div>
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

function ResultTile({ tile, actions }: { tile: ImageTile; actions: TileActions }) {
  /** the tile's own modal layer: delete needs a confirm, upscale needs a
   * choice, and neither fits in the hover bar */
  const [overlay, setOverlay] = useState<null | "delete" | "upscale">(null);

  if (tile.generating)
    return (
      <div className="relative flex aspect-[3/2] items-center justify-center overflow-hidden rounded-xl border border-gold/40">
        <div className={cx("absolute inset-0", tile.swatch, "opacity-60")} />
        <div className="absolute inset-0 animate-pulse bg-gradient-to-tr from-transparent via-gold/10 to-transparent" />
        <div className="relative flex flex-col items-center gap-1.5 px-3 text-center">
          <Sparkles size={18} className="text-gold" />
          <span className="max-w-full truncate text-[12px] text-cream/90">
            {tile.generating.label ?? "Generating…"}
          </span>
          <span className="text-[12px] font-semibold tabular-nums text-gold">
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
    <div className="group relative aspect-[3/2] overflow-hidden rounded-xl">
      <div className={cx("absolute inset-0", tile.swatch)} />
      {tile.url ? (
        <button
          onClick={() => actions.onOpen(tile)}
          title="Open full size"
          className="absolute inset-0 cursor-zoom-in"
        >
          <img
            src={tile.url}
            alt={tile.name ?? ""}
            draggable={false}
            className="h-full w-full object-cover"
          />
        </button>
      ) : (
        /* stand-in composition lines until real thumbnails flow through the seam */
        <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_30%,rgba(237,234,228,0.07),transparent_60%)]" />
      )}

      {upscaling && (
        <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-ink/70 px-2.5 py-1 text-[10px] font-medium text-gold backdrop-blur">
          <Loader2 size={11} className="animate-spin" /> Upscaling…
        </span>
      )}

      {tile.upscaled && !upscaling && (
        <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-ink/70 px-2.5 py-1 text-[10px] font-medium text-gold backdrop-blur">
          <Maximize2 size={11} /> Upscaled
        </span>
      )}

      <button
        title={liked ? "Unlike" : "Like"}
        onClick={() => actions.onLike(tile)}
        className={cx(
          "absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-ink/50 backdrop-blur transition",
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
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-3 opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100">
          <div className="glass flex overflow-hidden rounded-xl">
            {[
              { icon: Expand, label: "Open", run: () => actions.onOpen(tile) },
              { icon: Maximize2, label: "Upscale", run: () => setOverlay("upscale") },
              { icon: Pencil, label: "Edit", run: () => actions.onEdit(tile) },
              { icon: Download, label: "Download", run: () => actions.onDownload(tile) },
              { icon: Trash2, label: "Delete", run: () => setOverlay("delete"), danger: true },
            ].map(({ icon: Icon, label, run, danger }) => (
              <button
                key={label}
                title={label}
                onClick={run}
                className={cx(
                  "flex flex-col items-center gap-1 px-3 py-2.5 text-[10px] text-cream/85 transition hover:bg-cream/8",
                  danger ? "hover:text-red-400" : "hover:text-gold",
                )}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
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
    <div
      className="fixed inset-0 z-50 flex flex-col bg-ink/92 backdrop-blur-sm"
      onClick={onClose}
    >
      <header className="flex shrink-0 items-center gap-3 px-5 py-3">
        <span className="min-w-0 truncate text-[12px] text-cream/90">{tile.name}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-fog">
          {index + 1} / {tiles.length}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title="Close (Esc)"
          className="ml-auto flex h-10 items-center gap-1.5 rounded-full bg-cream/6 px-3.5 text-[11px] text-cream/80 transition hover:bg-cream/12 hover:text-gold"
        >
          <X size={16} />
          Close
        </button>
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
        {tile.url && (
          <img
            src={tile.url}
            alt={tile.name ?? ""}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full min-w-0 flex-1 cursor-default object-contain"
          />
        )}
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

function RefsPanel({ refs, setRefs, onAdded }: {
  refs: RefImage[];
  setRefs: React.Dispatch<React.SetStateAction<RefImage[]>>;
  onAdded: () => void;
}) {
  const lab = useImageLab();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const full = refs.length >= lab.refsMax;

  const addFiles = async (files: FileList | File[]) => {
    setError(null);
    for (const file of Array.from(files)) {
      if (refs.length + 1 > lab.refsMax) break;
      if (!file.type.startsWith("image/")) continue;
      try {
        const pngBase64 = await fileToPngBase64(file);
        const rel = await lab.addRef(file.name.replace(/\.[^.]+$/, "") || "reference", pngBase64);
        setRefs((prev) =>
          prev.length < lab.refsMax
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
          {refs.length}/{lab.refsMax}
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
                <div className="text-[10px] text-fog">
                  {i === 0 ? "subject" : i === 1 ? "scene / prop" : "style"}
                </div>
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
        References route through Qwen-Edit 2509 — keeps characters on-model with no LoRA. Order
        matters: subject first, then scene/prop, then style.
      </p>
    </section>
  );
}

/** history days shown before "View all" opens the rest — the rail is a shortcut
 * into the roll, not a second copy of it */
const HISTORY_DAYS = 6;

function RightRail({ refs, setRefs, onRefAdded, dayFilter, setDayFilter }: {
  refs: RefImage[];
  setRefs: React.Dispatch<React.SetStateAction<RefImage[]>>;
  onRefAdded: () => void;
  dayFilter: string | null;
  setDayFilter: (day: string | null) => void;
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

      <RefsPanel refs={refs} setRefs={setRefs} onAdded={onRefAdded} />
    </aside>
  );
}

/* ---------- status bar ---------- */

function StatusBar() {
  const lab = useImageLab();
  const { system } = useSystem();
  const { vram } = useJobs();
  const pct = Math.min(100, (vram.used / vram.total) * 100);

  return (
    <footer className="flex items-center gap-4 border-t hairline px-5 py-2 text-[11px] text-fog">
      <span className="flex items-center gap-1.5">
        <i className="h-1.5 w-1.5 rounded-full bg-sage" />
        <span className="text-cream/80">{lab.models[0].label}</span>
        <span className="text-sage">Ready</span>
      </span>
      <span className="tabular-nums">{lab.resolution}</span>
      <span className="tabular-nums">
        {lab.batch.length} image{lab.batch.length === 1 ? "" : "s"}
      </span>
      <span className="flex items-center gap-1 tabular-nums">
        Seed: {lab.seed}
        <button className="text-fog/60 transition hover:text-gold">
          <Copy size={11} />
        </button>
      </span>

      <span className="ml-auto flex items-center gap-2">
        <span className="text-fog/70">GPU</span>
        <span className="text-cream/80">{system.gpu.replace("NVIDIA GeForce ", "")}</span>
      </span>
      <span className="flex items-center gap-2">
        <span className="text-fog/70">VRAM</span>
        <span className="h-1 w-24 overflow-hidden rounded-full bg-cream/8">
          <span
            className="block h-full rounded-full bg-gradient-to-r from-gold-deep to-gold"
            style={{ width: `${pct}%` }}
          />
        </span>
        <span className="tabular-nums text-cream/80">
          {vram.used} / {vram.total} GB
        </span>
      </span>
      <button className="text-fog/60 transition hover:text-gold">
        <Settings2 size={13} />
      </button>
    </footer>
  );
}

/* ---------- screen ---------- */

export function ImageLab() {
  const lab = useImageLab();
  const likes = useLikes();
  const [mode, setMode] = useState<LabMode>("generate");
  const [refs, setRefs] = useState<RefImage[]>([]);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  /** a day picked in the history rail — the roll narrows to it until cleared */
  const [dayFilter, setDayFilter] = useState<string | null>(null);
  const [visible, setVisible] = useState(ROLL_PAGE);

  // a filtered roll still shows work in flight — otherwise pressing Generate
  // while a past day is pinned looks like nothing happened
  const roll = dayFilter
    ? lab.batch.filter((t) => t.generating || t.day === dayFilter)
    : lab.batch;

  // a narrower roll must start from the top again, or "show older" state from
  // the full roll leaves a filtered day looking longer than it is
  useEffect(() => setVisible(ROLL_PAGE), [dayFilter]);

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
        prev.some((r) => r.rel === t.relPath) || prev.length >= lab.refsMax
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <ParamsPanel mode={mode} setMode={setMode} refs={refs} />

        <section className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
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

          {roll.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <Sparkles size={22} className="text-gold/60" />
              <p className="text-[12px] text-cream/80">
                {dayFilter ? "Nothing from that day" : "Nothing rendered yet"}
              </p>
              <p className="max-w-[280px] text-[11px] leading-relaxed text-fog">
                {dayFilter
                  ? "Those stills have been deleted since. Clear the filter to see the rest of the roll."
                  : "Describe an image on the left and hit Generate — every take lands here and in the asset library."}
              </p>
              {dayFilter && (
                <button
                  onClick={() => setDayFilter(null)}
                  className="mt-1 text-[11px] text-gold hover:underline"
                >
                  Clear filter
                </button>
              )}
            </div>
          ) : (
            <>
              {dayFilter && (
                <div className="flex items-center gap-2 rounded-xl bg-gold/8 px-3 py-2">
                  <span className="text-[11px] text-cream/85">
                    Showing {dayLabel(dayFilter)} only
                  </span>
                  <button
                    onClick={() => setDayFilter(null)}
                    className="ml-auto flex items-center gap-1 text-[11px] text-gold hover:underline"
                  >
                    <X size={11} /> Clear
                  </button>
                </div>
              )}
              {groupByDay(roll.slice(0, visible)).map((section) => (
                <div key={section.day} className="first:-mt-2">
                  {/* the roll used to run together as one undated wall — the
                      separator is what makes "a day's work" legible, so it
                      gets real weight, a rule, and air above it */}
                  <div className="sticky top-0 z-10 -mx-4 mb-3 mt-5 bg-ink/92 px-4 pb-2 pt-2 backdrop-blur-sm">
                    <div className="flex items-center gap-2.5 border-b border-cream/12 pb-2">
                      <span className="h-3.5 w-[3px] shrink-0 rounded-full bg-gold/70" />
                      <h3 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-cream">
                        {dayLabel(section.day)}
                      </h3>
                      <span className="rounded-full bg-cream/8 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-fog">
                        {section.tiles.length}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 2xl:grid-cols-3">
                    {section.tiles.map((tile) => (
                      <ResultTile key={tile.id} tile={tile} actions={actions} />
                    ))}
                  </div>
                </div>
              ))}
              {visible < roll.length && (
                <button
                  onClick={() => setVisible((v) => v + ROLL_PAGE)}
                  className="mx-auto rounded-xl border border-cream/12 px-4 py-2 text-[11px] text-cream/80 transition hover:border-gold/50 hover:text-gold"
                >
                  Show older — {roll.length - visible} more
                </button>
              )}
            </>
          )}
        </section>

        <RightRail
          refs={refs}
          setRefs={setRefs}
          onRefAdded={() => setMode("edit")}
          dayFilter={dayFilter}
          setDayFilter={setDayFilter}
        />
      </div>
      <StatusBar />

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
