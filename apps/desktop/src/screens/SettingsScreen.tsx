import { useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  Cpu,
  Database,
  Eye,
  Folder,
  Keyboard,
  MoreVertical,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  SquareTerminal,
  Terminal,
  Trash2,
  Waypoints,
} from "lucide-react";
import { useSettings } from "@/hooks";
import type { Provider } from "@/data/sample";
import { Chip, GhostButton, cx } from "@/components/ui";

/* Settings — UI-Design/settings.jpg. Sub-nav on the left (General, AI
 * Providers, Storage, Engines, Shortcuts, Advanced); AI Providers is the
 * heart: Claude via subscription, OpenRouter key, Ollama local — plus the
 * ComfyUI escape hatch under Advanced. Data flows through useSettings. */

const SECTIONS = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "providers", label: "AI Providers", icon: Bot },
  { id: "storage", label: "Storage", icon: Database },
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
}: {
  items: { id: string; label: string; desc: string; on: boolean }[];
}) {
  const [state, setState] = useState(Object.fromEntries(items.map((t) => [t.id, t.on])));
  return (
    <div className="divide-y divide-cream/6 rounded-2xl border hairline bg-surface/50">
      {items.map((t) => (
        <div key={t.id} className="flex items-center gap-4 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-cream">{t.label}</div>
            <div className="mt-0.5 text-[11px] text-fog">{t.desc}</div>
          </div>
          <Toggle
            on={state[t.id]}
            onChange={() => setState((s) => ({ ...s, [t.id]: !s[t.id] }))}
          />
        </div>
      ))}
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
  const { providers, defaultProvider } = useSettings();
  const [active, setActive] = useState(defaultProvider);

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
    </div>
  );
}

/* ---------- storage ---------- */

function StorageSection() {
  const { storage } = useSettings();
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Storage"
        sub="Manage where models, projects, and cache files are stored."
      />
      <div className="grid grid-cols-[1fr_auto] gap-2.5">
        <div className="rounded-2xl border hairline bg-surface/50 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">
            Models root path
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center rounded-lg border border-cream/10 bg-surface">
              <input
                readOnly
                value={storage.root}
                className="min-w-0 flex-1 bg-transparent px-3 py-2 text-[12px] tabular-nums text-cream/90 focus:outline-none"
              />
              <button className="px-2.5 text-fog transition hover:text-gold">
                <Folder size={13} />
              </button>
            </div>
          </div>
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

/* ---------- engines ---------- */

function EnginesSection() {
  const { engines } = useSettings();
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Engines"
        sub="The generation stack behind every lab. Local engines run free on your GPU."
      />
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
  const { general } = useSettings();
  return (
    <div className="space-y-5">
      <SectionHeader title="General" sub="Application behavior and appearance." />
      <ToggleList items={general.toggles} />
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
  const { advanced } = useSettings();
  return (
    <div className="space-y-5">
      <SectionHeader title="Advanced" sub="Power-user options. Defaults are safe — these may not be." />
      <ToggleList items={advanced.toggles} />
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
          {section === "engines" && <EnginesSection />}
          {section === "shortcuts" && <ShortcutsSection />}
          {section === "advanced" && <AdvancedSection />}
        </div>
      </main>
    </div>
  );
}
