import { useState } from "react";
import {
  Bookmark,
  Check,
  ChevronDown,
  Copy,
  Dices,
  Expand,
  Heart,
  HelpCircle,
  ImagePlus,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Settings2,
  Sparkles,
} from "lucide-react";
import { useImageLab, useSystem, useJobs } from "@/hooks";
import type { ImageHistoryEntry, ImageTile } from "@/data/sample";
import { Chip, cx } from "@/components/ui";

/* Image lab — UI-Design/Image Lab.jpg. Prompt-to-image with the real engine
 * roster (Krea 2 default, z-image-turbo drafts, Qwen-Edit reference edits,
 * GPT-Image heroes); params and history flow through useImageLab (tRPC seam). */

const PROMPT_MAX = 1000;
/** seed of the batch on the canvas — what the refresh button restores */
const LAST_SEED = 746583928;

/* ---------- left panel ---------- */

function PanelLabel({ children, hint }: { children: React.ReactNode; hint?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">{children}</h3>
      {hint && <HelpCircle size={12} className="text-fog/50" />}
    </div>
  );
}

function ParamsPanel() {
  const lab = useImageLab();
  const [prompt, setPrompt] = useState(lab.prompt);
  const [modelId, setModelId] = useState(lab.models[0].id);
  const [modelOpen, setModelOpen] = useState(false);
  const [aspect, setAspect] = useState("3:2");
  const [preset, setPreset] = useState("Cinematic");
  const [seed, setSeed] = useState(String(lab.seed));
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const model = lab.models.find((m) => m.id === modelId) ?? lab.models[0];

  return (
    <aside className="flex w-[264px] shrink-0 flex-col gap-5 overflow-y-auto border-r hairline bg-[#0e0e10] p-4">
      <section>
        <PanelLabel hint>Prompt</PanelLabel>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value.slice(0, PROMPT_MAX))}
          rows={7}
          className="mt-2 w-full resize-none rounded-xl border border-cream/10 bg-surface p-3 text-[12px] leading-relaxed text-cream placeholder:text-fog focus:border-gold/40 focus:outline-none"
          placeholder="Describe the image…"
        />
        <div className="mt-1 text-right text-[10px] text-fog/70">
          {prompt.length} / {PROMPT_MAX}
        </div>
      </section>

      <section className="relative">
        <PanelLabel>Model</PanelLabel>
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
            {lab.models.map((m) => (
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
      </section>

      <section>
        <PanelLabel>Aspect ratio</PanelLabel>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {lab.aspects.map((a) => (
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
          <button className="rounded-lg border border-cream/10 px-2.5 py-1.5 text-[11px] text-fog transition hover:border-gold/35 hover:text-cream">
            <MoreHorizontal size={12} />
          </button>
        </div>
      </section>

      <section>
        <PanelLabel>Style preset</PanelLabel>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {lab.presets.map((p) => (
            <button
              key={p}
              onClick={() => setPreset(p)}
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
          <dl className="mt-2.5 space-y-1.5 rounded-xl bg-surface p-3">
            {lab.advanced.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between text-[11px]">
                <dt className="text-fog">{k}</dt>
                <dd className="tabular-nums text-cream/85">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <div className="mt-auto flex gap-px pt-2">
        <button className="flex flex-1 items-center justify-center gap-2 rounded-l-xl bg-gradient-to-b from-gold to-gold-deep py-2.5 text-[13px] font-semibold text-ink transition hover:brightness-110 active:brightness-95">
          <Sparkles size={13} /> Generate
        </button>
        <button className="flex w-9 items-center justify-center rounded-r-xl bg-gradient-to-b from-gold to-gold-deep text-ink transition hover:brightness-110">
          <ChevronDown size={14} />
        </button>
      </div>
    </aside>
  );
}

/* ---------- canvas ---------- */

function ResultTile({ tile }: { tile: ImageTile }) {
  if (tile.generating)
    return (
      <div className="relative flex items-center justify-center overflow-hidden rounded-xl border border-gold/40">
        <div className={cx("absolute inset-0", tile.swatch, "opacity-60")} />
        <div className="absolute inset-0 animate-pulse bg-gradient-to-tr from-transparent via-gold/10 to-transparent" />
        <div className="relative flex flex-col items-center gap-1.5">
          <Sparkles size={18} className="text-gold" />
          <span className="text-[12px] text-cream/90">Generating…</span>
          <span className="text-[12px] font-semibold tabular-nums text-gold">
            {tile.generating.progress}%
          </span>
        </div>
      </div>
    );

  return (
    <div className="group relative overflow-hidden rounded-xl">
      <div className={cx("absolute inset-0", tile.swatch)} />
      {/* stand-in composition lines until real thumbnails flow through the seam */}
      <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_30%,rgba(237,234,228,0.07),transparent_60%)]" />

      <button
        className={cx(
          "absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-ink/50 backdrop-blur transition",
          tile.liked
            ? "text-gold"
            : "text-cream/70 opacity-0 hover:text-cream group-hover:opacity-100",
        )}
      >
        <Heart size={14} fill={tile.liked ? "currentColor" : "none"} />
      </button>

      <div className="absolute inset-x-0 bottom-0 flex justify-center pb-4 opacity-0 transition group-hover:opacity-100">
        <div className="glass flex overflow-hidden rounded-xl">
          {[
            { icon: Expand, label: "Upscale" },
            { icon: Pencil, label: "Edit" },
            { icon: Bookmark, label: "Save to Assets" },
          ].map(({ icon: Icon, label }) => (
            <button
              key={label}
              className="flex flex-col items-center gap-1 px-4 py-2.5 text-[10px] text-cream/85 transition hover:bg-cream/8 hover:text-gold"
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- right rail ---------- */

function HistoryRow({ entry }: { entry: ImageHistoryEntry }) {
  return (
    <button
      className={cx(
        "flex w-full items-center gap-2.5 rounded-xl border p-2 text-left transition",
        entry.current
          ? "border-gold/50 bg-surface"
          : "border-transparent bg-surface/60 hover:border-cream/15",
      )}
    >
      <div className="flex gap-1">
        {entry.swatches.map((sw, i) => (
          <span key={i} className={cx("h-10 w-10 rounded-md", sw)} />
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-cream/85">{entry.when}</div>
        <div className="text-[10px] text-fog">{entry.count} images</div>
        <Chip tone="muted" className="mt-1 tabular-nums">
          {entry.aspect}
        </Chip>
      </div>
      <MoreHorizontal size={14} className="shrink-0 text-fog/60" />
    </button>
  );
}

function RightRail() {
  const lab = useImageLab();
  return (
    <aside className="flex w-[316px] shrink-0 flex-col gap-3 overflow-y-auto border-l hairline bg-[#0e0e10] p-3">
      <section className="rounded-xl bg-surface/40 p-2.5">
        <div className="flex items-center justify-between px-1 pb-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">
            Generation history
          </h3>
          <button className="text-[11px] text-gold hover:underline">View all</button>
        </div>
        <div className="space-y-1.5">
          {lab.history.map((h) => (
            <HistoryRow key={h.id} entry={h} />
          ))}
        </div>
      </section>

      <section className="rounded-xl bg-surface/40 p-2.5">
        <div className="flex items-center justify-between px-1 pb-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">
            Edit with reference
          </h3>
          <HelpCircle size={12} className="text-fog/50" />
        </div>
        <button className="flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed border-gold/35 px-4 py-8 transition hover:border-gold/60 hover:bg-gold/4">
          <ImagePlus size={22} strokeWidth={1.5} className="text-gold/80" />
          <span className="mt-1 text-[12px] font-medium text-cream/90">Drop image here</span>
          <span className="text-[11px] text-fog">or click to upload</span>
          <span className="mt-1 text-[10px] text-fog/60">JPG, PNG up to 20 MB</span>
        </button>
        <p className="mt-2 px-1 text-[10px] leading-relaxed text-fog">
          References route through Qwen-Edit 2509 — keeps characters on-model with no LoRA.
        </p>
      </section>
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
      <span>4 images</span>
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <ParamsPanel />

        <section className="grid min-w-0 flex-1 grid-cols-2 grid-rows-2 gap-3 p-4">
          {lab.batch.map((tile) => (
            <ResultTile key={tile.id} tile={tile} />
          ))}
        </section>

        <RightRail />
      </div>
      <StatusBar />
    </div>
  );
}
