import { useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  Cpu,
  Database,
  Download,
  ExternalLink,
  Eye,
  Folder,
  FolderOpen,
  HardDriveDownload,
  Keyboard,
  Link2,
  MoreVertical,
  Pause,
  Play,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  SquareTerminal,
  Terminal,
  Trash2,
  Waypoints,
} from "lucide-react";
import type { ModelEntry } from "@aurea/shared";
import { useModels, useRootPreview, useSettings } from "@/hooks";
import type { Provider } from "@/data/sample";
import { Chip, GhostButton, GoldButton, Progress, cx } from "@/components/ui";
import { RuntimeCard } from "@/components/RuntimeCard";

/* Settings — UI-Design/settings.jpg. Sub-nav on the left (General, AI
 * Providers, Storage, Engines, Shortcuts, Advanced); AI Providers is the
 * heart: Claude via subscription, OpenRouter key, Ollama local — plus the
 * ComfyUI escape hatch under Advanced. Data flows through useSettings. */

const SECTIONS = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "providers", label: "AI Providers", icon: Bot },
  { id: "storage", label: "Storage", icon: Database },
  { id: "models", label: "Models", icon: HardDriveDownload },
  { id: "engines", label: "Engines", icon: Cpu },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "advanced", label: "Advanced", icon: SlidersHorizontal },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={cx(
        "relative h-5 w-9 shrink-0 rounded-full transition",
        on ? "bg-gradient-to-b from-gold to-gold-deep" : "bg-cream/12",
      )}
    >
      <span
        className={cx(
          "absolute top-0.5 h-4 w-4 rounded-full transition-all",
          on ? "left-[18px] bg-ink" : "left-0.5 bg-cream/70",
        )}
      />
    </button>
  );
}

function SectionHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <header>
      <h1 className="font-serif text-[22px] font-semibold tracking-wide text-gold">{title}</h1>
      <p className="mt-1 text-[12px] text-fog">{sub}</p>
    </header>
  );
}

function ToggleList({
  items,
  onToggle,
}: {
  items: { id: string; label: string; desc: string; on: boolean }[];
  onToggle: (id: string, on: boolean) => void;
}) {
  return (
    <div className="divide-y divide-cream/6 rounded-2xl border hairline bg-surface/50">
      {items.map((t) => (
        <div key={t.id} className="flex items-center gap-4 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-cream">{t.label}</div>
            <div className="mt-0.5 text-[11px] text-fog">{t.desc}</div>
          </div>
          <Toggle on={t.on} onChange={() => onToggle(t.id, !t.on)} />
        </div>
      ))}
    </div>
  );
}

/** Path field that commits on Enter/blur — the value is owned by studiod. */
/** a single opt-in render knob — denser than ToggleList, which owns its card */
function TuningToggle({
  label,
  hint,
  on,
  onChange,
}: {
  label: string;
  hint: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-cream/85">{label}</div>
        <div className="mt-0.5 text-[10px] leading-relaxed text-fog">{hint}</div>
      </div>
      <Toggle on={on} onChange={() => onChange(!on)} />
    </div>
  );
}

function PathInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <div className="flex min-w-0 flex-1 items-center rounded-lg border border-cream/10 bg-surface focus-within:border-gold/35">
      <input
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent px-3 py-2 text-[12px] tabular-nums text-cream/90 focus:outline-none"
      />
      <span className="px-2.5 text-fog">
        <Folder size={13} />
      </span>
    </div>
  );
}

/* ---------- AI providers ---------- */

const providerIcons: Record<string, typeof Sparkles> = {
  claude: Sparkles,
  openrouter: Waypoints,
  ollama: Terminal,
};

function ProviderAuth({ provider }: { provider: Provider }) {
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const auth = provider.auth;

  if (auth.kind === "connected")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 px-3 py-1.5 text-[11px] font-medium text-gold">
        <Check size={12} /> Connected
      </span>
    );

  if (auth.kind === "apiKey")
    return (
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-fog">API key</span>
        <div className="flex items-center rounded-lg border border-cream/10 bg-surface">
          <input
            readOnly
            value={revealed ? "sk-or-v1-8f2…d41a" : auth.masked}
            className="w-44 bg-transparent px-3 py-1.5 text-[11px] tracking-wider text-cream/85 focus:outline-none"
          />
          <button
            onClick={() => setRevealed((r) => !r)}
            className={cx(
              "px-2.5 transition",
              revealed ? "text-gold" : "text-fog hover:text-gold",
            )}
          >
            <Eye size={13} />
          </button>
        </div>
      </div>
    );

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-fog">Model</span>
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-56 items-center gap-2 rounded-lg border border-cream/10 bg-surface px-3 py-1.5 text-[11px] text-cream/85 transition hover:border-gold/35"
        >
          <span className="flex-1 truncate text-left">{auth.model}</span>
          <ChevronDown
            size={11}
            className={cx("shrink-0 text-fog transition-transform", open && "rotate-180")}
          />
        </button>
        {open && (
          <div className="absolute right-0 top-full z-10 mt-1 w-56 overflow-hidden rounded-lg border border-cream/12 bg-raised shadow-xl">
            {auth.options.map((m) => (
              <button
                key={m}
                onClick={() => setOpen(false)}
                className={cx(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] transition hover:bg-cream/5",
                  m === auth.model ? "text-gold" : "text-cream/85",
                )}
              >
                <span className="w-3">{m === auth.model && <Check size={11} />}</span>
                <span className="truncate">{m}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProvidersSection() {
  const {
    providers,
    defaultProvider,
    setDefaultProvider,
    falApiKey,
    setFalApiKey,
    replicateApiToken,
    setReplicateApiToken,
  } = useSettings();
  const [falDraft, setFalDraft] = useState<string | null>(null);
  const [replicateDraft, setReplicateDraft] = useState<string | null>(null);
  const active = defaultProvider;
  const setActive = (id: string) =>
    setDefaultProvider(id as Parameters<typeof setDefaultProvider>[0]);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="AI Providers"
        sub="Connect and manage AI providers. Choose a default provider for new conversations."
      />
      <div className="space-y-2.5">
        {providers.map((p) => {
          const Icon = providerIcons[p.id] ?? Bot;
          const selected = p.id === active;
          return (
            <div
              key={p.id}
              className={cx(
                "flex items-center gap-4 rounded-2xl border p-4 transition",
                selected ? "border-gold/40 bg-surface/70" : "border-cream/8 bg-surface/40",
              )}
            >
              <button
                onClick={() => setActive(p.id)}
                className={cx(
                  "flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border transition",
                  selected ? "border-gold" : "border-cream/25 hover:border-gold/50",
                )}
              >
                {selected && <span className="h-2 w-2 rounded-full bg-gold" />}
              </button>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cream/10 bg-raised text-cream/80">
                <Icon size={18} strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[14px] font-semibold text-cream">{p.name}</span>
                  {p.tag && <span className="truncate text-[10px] text-gold/80">· {p.tag}</span>}
                </div>
                <div className="mt-0.5 text-[11px] text-fog">{p.blurb}</div>
              </div>
              <ProviderAuth provider={p} />
              <button className="shrink-0 text-fog/60 transition hover:text-cream">
                <MoreVertical size={14} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="rounded-2xl border hairline bg-surface/50 p-4">
        <div className="text-[13px] font-medium text-cream">fal.ai API key</div>
        <div className="mt-0.5 text-[10px] text-fog">
          Unlocks the Seedance cloud video engine in the Video Lab and GPT Image 2 in the Image Lab —
          the one edit model that takes up to 16 references, where local Qwen-Edit stops at 3. Both
          bill to your fal account; the estimated cost shows before every render.
        </div>
        <input
          type="password"
          value={falDraft ?? falApiKey}
          onChange={(e) => setFalDraft(e.target.value)}
          onBlur={() => {
            if (falDraft !== null && falDraft !== falApiKey) setFalApiKey(falDraft);
            setFalDraft(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          spellCheck={false}
          placeholder="key id:key secret"
          className="mt-3 w-full rounded-lg border border-cream/10 bg-raised px-3 py-2 text-[12px] tabular-nums text-cream/90 focus:border-gold/35 focus:outline-none"
        />
      </div>
      <div className="rounded-2xl border hairline bg-surface/50 p-4">
        <div className="text-[13px] font-medium text-cream">Replicate API token</div>
        <div className="mt-0.5 text-[10px] text-fog">
          Unlocks RVC v2 voice training and conversion in the Voice Lab — the highest-quality
          cloned-singing path. Runs bill to your Replicate account; the estimated cost shows on every
          job card before it spends.
        </div>
        <input
          type="password"
          value={replicateDraft ?? replicateApiToken}
          onChange={(e) => setReplicateDraft(e.target.value)}
          onBlur={() => {
            if (replicateDraft !== null && replicateDraft !== replicateApiToken)
              setReplicateApiToken(replicateDraft);
            setReplicateDraft(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          spellCheck={false}
          placeholder="r8_…"
          className="mt-3 w-full rounded-lg border border-cream/10 bg-raised px-3 py-2 text-[12px] tabular-nums text-cream/90 focus:border-gold/35 focus:outline-none"
        />
      </div>
    </div>
  );
}

/* ---------- storage ---------- */

function StorageSection() {
  const { storage, setDataRoot, setVideofastDir } = useSettings();
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Storage"
        sub="Manage where models, projects, and cache files are stored."
      />
      <div className="grid grid-cols-[1fr_auto] gap-2.5">
        <div className="rounded-2xl border hairline bg-surface/50 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">
            Data root path
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <PathInput value={storage.root} onCommit={setDataRoot} />
          </div>
          <div className="mt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">
            Videofast pipeline root
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <PathInput value={storage.videofastDir ?? ""} onCommit={setVideofastDir} />
          </div>
          {!storage.videofastDir && (
            <div className="mt-1.5 text-[10px] text-fog/70">
              Not detected — point this at your videofast checkout to enable format renders.
            </div>
          )}
          <div className="mt-4 flex items-baseline justify-between text-[11px]">
            <span className="text-fog">Usage</span>
            <span className="tabular-nums text-cream/90">
              {storage.used} / {storage.total}
            </span>
          </div>
          <div className="mt-2 flex h-2 gap-px overflow-hidden rounded-full bg-cream/8">
            {storage.segments.map((seg) => (
              <span key={seg.label} className={cx("h-full", seg.dot)} style={{ width: `${seg.pct}%` }} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {storage.segments.map((seg) => (
              <span key={seg.label} className="flex items-center gap-1.5 text-[10px] text-fog">
                <i className={cx("h-1.5 w-1.5 rounded-full", seg.dot)} />
                {seg.label} {seg.size} ({seg.pct}%)
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center rounded-2xl border hairline bg-surface/50 p-4">
          <GhostButton className="px-4 py-2.5">
            <Trash2 size={13} /> Clear cache
          </GhostButton>
        </div>
      </div>
    </div>
  );
}

/* ---------- models ---------- */

const fmtSize = (b: number) =>
  b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`;

function ModelActions({ m }: { m: ModelEntry }) {
  const { download, cancel, remove } = useModels();
  const [confirmLicense, setConfirmLicense] = useState(false);
  const s = m.status;

  if (s.state === "downloading" || s.state === "verifying")
    return (
      <GhostButton onClick={() => cancel(m.id)}>
        <Pause size={12} /> Pause
      </GhostButton>
    );

  if (s.state === "installed")
    return (
      <div className="flex items-center gap-2">
        <Chip tone="sage" className="text-[10px]">
          <Check size={10} /> Installed
        </Chip>
        <button
          onClick={() => remove(m.id)}
          title="Remove from disk"
          className="text-fog/60 transition hover:text-[#e07a6b]"
        >
          <Trash2 size={13} />
        </button>
      </div>
    );

  // found in one of the user's own folders — usable, but not ours to manage
  if (s.state === "linked")
    return (
      <div className="flex min-w-0 items-center gap-2">
        <Chip tone="gold" className="shrink-0 text-[10px]">
          <Link2 size={10} /> Linked
        </Chip>
        <span className="min-w-0 truncate text-[10px] text-fog" title={s.linkedRoot ?? ""}>
          {s.linkedRoot}
        </span>
      </div>
    );

  // absent / error — offer download (resume when partial bytes exist)
  const resume = s.bytes > 0;
  if (m.license.gated && !s.licenseAccepted && !confirmLicense)
    return (
      <GhostButton onClick={() => setConfirmLicense(true)}>
        <Download size={12} /> {resume ? "Resume" : "Download"}
      </GhostButton>
    );
  if (m.license.gated && !s.licenseAccepted)
    return (
      <GoldButton onClick={() => download(m.id, true)}>
        <Check size={12} /> Accept license &amp; download
      </GoldButton>
    );
  return (
    <GhostButton onClick={() => download(m.id)}>
      {resume ? <Play size={12} /> : <Download size={12} />} {resume ? "Resume" : "Download"}
    </GhostButton>
  );
}

/** Point the studio at a model library the user already owns. Most people
 * arriving here have tens of gigabytes of these exact public files sitting in
 * a ComfyUI install; re-downloading them is the fastest way to lose someone
 * before they render a frame. */
function LinkedFoldersCard() {
  const { modelRoots, linkRoot, unlinkRoot, removeError } = useModels();
  const [draft, setDraft] = useState("");
  const preview = useRootPreview(draft);
  const alreadyLinked = modelRoots.includes(draft.replace(/[\\/]+$/, ""));

  return (
    <div className="rounded-2xl border hairline bg-surface/50 p-4">
      <div className="flex items-baseline gap-2">
        <Link2 size={13} className="translate-y-0.5 text-gold" />
        <h3 className="text-[13px] font-medium text-cream">Linked folders</h3>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-fog">
        Already have a ComfyUI model library? Point Aurea at it and those weights count as
        installed — no second download. Linked files are mounted read-only: never verified, never
        modified, never deleted. Expects the conventional layout
        (<span className="text-cream/70">unet/, diffusion_models/, text_encoders/, vae/, loras/</span>).
      </p>

      {modelRoots.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {modelRoots.map((root) => (
            <div
              key={root}
              className="flex items-center gap-2 rounded-xl border border-cream/10 bg-surface px-3 py-2"
            >
              <FolderOpen size={12} className="shrink-0 text-fog" />
              <span className="min-w-0 flex-1 truncate text-[11px] text-cream/85">{root}</span>
              <button
                onClick={() => void unlinkRoot(root)}
                title="Unlink (your files are not touched)"
                className="shrink-0 text-fog/60 transition hover:text-[#e07a6b]"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="D:\models"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-xl border border-cream/10 bg-surface px-3 py-2 text-[12px] text-cream placeholder:text-fog focus:border-gold/40 focus:outline-none"
        />
        <GoldButton
          disabled={preview.found.length === 0 || alreadyLinked}
          onClick={() => {
            void linkRoot(draft.replace(/[\\/]+$/, ""));
            setDraft("");
          }}
        >
          <Link2 size={12} /> Link folder
        </GoldButton>
      </div>

      {draft.trim().length > 2 && (
        <p className="mt-2 text-[11px] text-fog">
          {preview.checking
            ? "Scanning…"
            : alreadyLinked
              ? "Already linked."
              : preview.found.length === 0
                ? "No registry models found here — check the path and that it holds the category subfolders."
                : `Found ${preview.found.length} model${preview.found.length === 1 ? "" : "s"} · ${fmtSize(
                    preview.found.reduce((n, m) => n + m.sizeBytes, 0),
                  )} you won't need to download — ${preview.found.map((m) => m.name).join(", ")}`}
        </p>
      )}
      {removeError && <p className="mt-2 text-[11px] text-[#e07a6b]">{removeError}</p>}
    </div>
  );
}

function ModelsSection() {
  const { models, live } = useModels();
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Models"
        sub="Weights for the local engines — downloaded into your data root (resumable, checksum-verified) or linked from a library you already have."
      />
      {live && <LinkedFoldersCard />}
      {!live ? (
        <div className="rounded-2xl border hairline bg-surface/50 p-8 text-center text-[12px] text-fog">
          The studio core isn't reachable — model management needs a running studiod.
        </div>
      ) : (
        <div className="divide-y divide-cream/6 rounded-2xl border hairline bg-surface/50">
          {models.map((m) => {
            const s = m.status;
            const busy = s.state === "downloading" || s.state === "verifying";
            return (
              <div key={m.id} className="px-4 py-3.5">
                <div className="flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[13px] font-medium text-cream">{m.name}</span>
                      <span className="truncate text-[10px] text-fog">{m.engine}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-fog/85">{m.description}</div>
                    <a
                      href={m.license.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-fog/70 transition hover:text-gold"
                    >
                      {m.license.name} <ExternalLink size={8} />
                    </a>
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-fog">
                    {s.bytes > 0 && s.state !== "installed"
                      ? `${fmtSize(s.bytes)} of ${fmtSize(m.sizeBytes)}`
                      : fmtSize(m.sizeBytes)}
                  </span>
                  <div className="flex w-56 shrink-0 items-center justify-end">
                    <ModelActions m={m} />
                  </div>
                </div>
                {busy && (
                  <div className="mt-2.5 flex items-center gap-3">
                    <Progress value={s.progress} className="flex-1" />
                    <span className="shrink-0 text-[10px] tabular-nums text-fog">
                      {s.progress.toFixed(0)}%
                      {s.bytesPerSec ? ` · ${fmtSize(s.bytesPerSec)}/s` : ""}
                      {s.state === "verifying" ? " · verifying" : ""}
                      {s.file ? ` · ${s.file}` : ""}
                    </span>
                  </div>
                )}
                {s.state === "error" && (
                  <div className="mt-1.5 text-[10px] text-[#e07a6b]">{s.error}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- engines ---------- */

function EnginesSection() {
  const {
    engines,
    comfyMode,
    comfyUrl,
    setComfyMode,
    setComfyUrl,
    ttsMode,
    setTtsMode,
    musicMode,
    setMusicMode,
    videoMode,
    setVideoMode,
    videoTuning,
    setVideoTuning,
    minimaxUrl,
    setMinimaxUrl,
  } = useSettings();
  const [urlDraft, setUrlDraft] = useState<string | null>(null);
  const [h3Draft, setH3Draft] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Engines"
        sub="The generation stack behind every lab. Local engines run free on your GPU."
      />
      <RuntimeCard />
      <div className="rounded-2xl border hairline bg-surface/50 p-4">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-cream">ComfyUI source</div>
            <div className="mt-0.5 text-[10px] text-fog">
              Managed uses the runtime above; external talks to a ComfyUI you run yourself.
            </div>
          </div>
          <div className="flex overflow-hidden rounded-lg border border-cream/12 text-[11px]">
            {(["managed", "external"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setComfyMode(m)}
                className={cx(
                  "px-3 py-1.5 capitalize transition",
                  comfyMode === m ? "bg-gold text-ink" : "text-fog hover:text-cream",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        {comfyMode === "external" && (
          <input
            value={urlDraft ?? comfyUrl}
            onChange={(e) => setUrlDraft(e.target.value)}
            onBlur={() => {
              if (urlDraft !== null && urlDraft !== comfyUrl) setComfyUrl(urlDraft);
              setUrlDraft(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            spellCheck={false}
            placeholder="http://127.0.0.1:8000"
            className="mt-3 w-full rounded-lg border border-cream/10 bg-raised px-3 py-2 text-[12px] tabular-nums text-cream/90 focus:border-gold/35 focus:outline-none"
          />
        )}
      </div>
      <div className="rounded-2xl border hairline bg-surface/50 p-4">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-cream">Voice engine</div>
            <div className="mt-0.5 text-[10px] text-fog">
              Managed clones character voices in the runtime above; external uses your own
              Chatterbox venv.
            </div>
          </div>
          <div className="flex overflow-hidden rounded-lg border border-cream/12 text-[11px]">
            {(["managed", "external"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setTtsMode(m)}
                className={cx(
                  "px-3 py-1.5 capitalize transition",
                  ttsMode === m ? "bg-gold text-ink" : "text-fog hover:text-cream",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="rounded-2xl border hairline bg-surface/50 p-4">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-cream">Music engine</div>
            <div className="mt-0.5 text-[10px] text-fog">
              Managed composes with the runtime&apos;s own ACE-Step; external uses your own
              checkout.
            </div>
          </div>
          <div className="flex overflow-hidden rounded-lg border border-cream/12 text-[11px]">
            {(["managed", "external"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMusicMode(m)}
                className={cx(
                  "px-3 py-1.5 capitalize transition",
                  musicMode === m ? "bg-gold text-ink" : "text-fog hover:text-cream",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="rounded-2xl border hairline bg-surface/50 p-4">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-cream">Video engine</div>
            <div className="mt-0.5 text-[10px] text-fog">
              LTX 2.3 renders. Managed uses the runtime above with the LTX 2.3 22B weight set
              (Settings → Models, ~42 GB); external queues on your ComfyUI URL.
            </div>
          </div>
          <div className="flex overflow-hidden rounded-lg border border-cream/12 text-[11px]">
            {(["managed", "external"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setVideoMode(m)}
                className={cx(
                  "px-3 py-1.5 capitalize transition",
                  videoMode === m ? "bg-gold text-ink" : "text-fog hover:text-cream",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 space-y-2 border-t border-cream/8 pt-3">
          <div className="text-[11px] font-medium text-cream/90">Render tuning</div>
          <p className="text-[10px] leading-relaxed text-fog">
            Opt-in changes to how LTX renders. All of them need the KJNodes pack; defaults keep
            the render identical to the verified pipeline.
          </p>
          <TuningToggle
            label="Chunked feed-forward"
            hint="On by default: ~23% faster on large shots (10s at 896×1152), neutral on small ones. No extra dependencies."
            on={videoTuning.chunkFeedForward}
            onChange={(on) => setVideoTuning({ chunkFeedForward: on })}
          />
          <TuningToggle
            label="SageAttention"
            hint="Faster INT8 attention — needs `pip install sageattention` in ComfyUI's python, or the render fails."
            on={videoTuning.sageAttention}
            onChange={(on) => setVideoTuning({ sageAttention: on })}
          />
          <TuningToggle
            label="NAG (negative guidance)"
            hint="Makes the negative prompt bite at cfg 1, where classifier-free guidance does nothing."
            on={videoTuning.nag}
            onChange={(on) => setVideoTuning({ nag: on })}
          />
          <div className="flex items-center gap-4 pt-1">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-cream/85">Sampler</div>
              <div className="mt-0.5 text-[10px] leading-relaxed text-fog">
                cfg++ runs an ancestral base pass and a cfg++ refine — the official 2.3 pairing.
              </div>
            </div>
            <div className="flex overflow-hidden rounded-lg border border-cream/12 text-[11px]">
              {(["euler", "cfg_pp"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setVideoTuning({ sampler: s })}
                  className={cx(
                    "px-3 py-1.5 transition",
                    videoTuning.sampler === s ? "bg-gold text-ink" : "text-fog hover:text-cream",
                  )}
                >
                  {s === "euler" ? "euler" : "cfg++"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="rounded-2xl border hairline bg-surface/50 p-4">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-cream">MiniMax-H3 ComfyUI</div>
          <div className="mt-0.5 text-[10px] leading-relaxed text-fog">
            H3 renders dialogue, sound effects and music in the same pass as the picture, and
            needs ComfyUI 0.30.0 or newer — a separate install from the one LTX 2.3 runs on.
            Point this at that instance; leave it empty to keep the engine off.
          </div>
        </div>
        <input
          value={h3Draft ?? minimaxUrl}
          onChange={(e) => setH3Draft(e.target.value)}
          onBlur={() => {
            if (h3Draft !== null && h3Draft !== minimaxUrl) setMinimaxUrl(h3Draft);
            setH3Draft(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          spellCheck={false}
          placeholder="http://127.0.0.1:8189"
          className="mt-3 w-full rounded-lg border border-cream/10 bg-raised px-3 py-2 text-[12px] tabular-nums text-cream/90 focus:border-gold/35 focus:outline-none"
        />
      </div>
      <div className="divide-y divide-cream/6 rounded-2xl border hairline bg-surface/50">
        {engines.map((e) => (
          <div key={e.id} className="flex items-center gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-medium text-cream">{e.name}</span>
                <span className="text-[10px] text-fog">{e.note}</span>
              </div>
            </div>
            <Chip tone="muted" className="w-14 justify-center text-[9px] uppercase tracking-wider">
              {e.kind}
            </Chip>
            {e.status === "installed" ? (
              <Chip tone="sage" className="text-[10px]">
                <Check size={10} /> Installed
              </Chip>
            ) : (
              <Chip tone="violet" className="text-[10px]">
                API
              </Chip>
            )}
            <button className="shrink-0 text-fog/60 transition hover:text-cream">
              <MoreVertical size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- general / shortcuts / advanced ---------- */

function GeneralSection() {
  const { general, toggleGeneral } = useSettings();
  return (
    <div className="space-y-5">
      <SectionHeader title="General" sub="Application behavior and appearance." />
      <ToggleList items={general.toggles} onToggle={toggleGeneral} />
      <div className="divide-y divide-cream/6 rounded-2xl border hairline bg-surface/50">
        {(
          [
            ["Theme", general.theme],
            ["Language", general.language],
            ["Version", `Aurea Studio v${general.version}`],
          ] as [string, string][]
        ).map(([k, v]) => (
          <div key={k} className="flex items-center justify-between px-4 py-3.5 text-[12px]">
            <span className="text-fog">{k}</span>
            <span className="text-cream/90">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShortcutsSection() {
  const { shortcuts } = useSettings();
  return (
    <div className="space-y-5">
      <SectionHeader title="Shortcuts" sub="Keyboard shortcuts across the studio." />
      <div className="divide-y divide-cream/6 rounded-2xl border hairline bg-surface/50">
        {shortcuts.map(([label, keys]) => (
          <div key={label} className="flex items-center justify-between px-4 py-3">
            <span className="text-[12px] text-cream/90">{label}</span>
            <span className="flex gap-1">
              {keys.split(" + ").map((k) => (
                <kbd
                  key={k}
                  className="rounded-md border border-cream/15 bg-raised px-2 py-1 text-[10px] font-medium text-cream/85"
                >
                  {k}
                </kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdvancedSection() {
  const { advanced, toggleAdvanced } = useSettings();
  return (
    <div className="space-y-5">
      <SectionHeader title="Advanced" sub="Power-user options. Defaults are safe — these may not be." />
      <ToggleList items={advanced.toggles} onToggle={toggleAdvanced} />
      <button className="flex w-full flex-col items-center gap-1 rounded-2xl border border-dashed border-cream/15 px-4 py-6 transition hover:border-gold/40">
        <SquareTerminal size={20} strokeWidth={1.5} className="text-fog" />
        <span className="mt-1 text-[13px] font-medium text-cream/90">Open ComfyUI (advanced)</span>
        <span className="text-[11px] text-fog/70">For power users. You're on your own.</span>
      </button>
    </div>
  );
}

/* ---------- screen ---------- */

export function SettingsScreen() {
  const [section, setSection] = useState<SectionId>("providers");

  return (
    <div className="flex h-full">
      <aside className="flex w-[216px] shrink-0 flex-col border-r hairline bg-[#0e0e10] p-4">
        <h2 className="px-2 pb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-fog">
          Settings
        </h2>
        <nav className="space-y-1">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={cx(
                "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[12px] font-medium transition",
                section === id
                  ? "border-l-2 border-gold bg-gold/10 text-gold"
                  : "text-fog hover:bg-cream/5 hover:text-cream",
              )}
            >
              <Icon size={14} strokeWidth={1.75} />
              {label}
            </button>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-2.5 px-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-gold/30 font-serif text-[13px] font-semibold text-gold">
            A
          </span>
          <div>
            <div className="text-[11px] font-medium text-cream">Aurea Studio</div>
            <div className="text-[10px] text-gold/80">Pro plan</div>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-8">
          {section === "general" && <GeneralSection />}
          {section === "providers" && <ProvidersSection />}
          {section === "storage" && <StorageSection />}
          {section === "models" && <ModelsSection />}
          {section === "engines" && <EnginesSection />}
          {section === "shortcuts" && <ShortcutsSection />}
          {section === "advanced" && <AdvancedSection />}
        </div>
      </main>
    </div>
  );
}
