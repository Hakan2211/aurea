import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Cpu,
  Database,
  Download,
  ExternalLink,
  HardDriveDownload,
  Pause,
  Sparkles,
} from "lucide-react";
import type { ModelEntry, Settings } from "@aurea/shared";
import { useModels, useOnboarding, useSettings } from "@/hooks";
import { Chip, GhostButton, GoldButton, Progress, cx } from "@/components/ui";

/* First-run wizard — PLATFORM-PRD P1. Shown once over the whole app while
 * settings.general.onboarded is false: storage location, detected engines,
 * and the model registry with license gates. Downloads run inside studiod,
 * so closing the wizard (or the app) never loses progress. */

const STEPS = ["Welcome", "Storage", "Engines", "Models", "Ready"] as const;

const fmtSize = (b: number) =>
  b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`;

const fmtRate = (b: number) => `${fmtSize(b)}/s`;

/* ---------- steps ---------- */

function WelcomeStep() {
  return (
    <div className="flex flex-col items-center py-10 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-gold/35 bg-raised font-serif text-[28px] font-semibold text-gold">
        A
      </span>
      <h1 className="mt-6 font-serif text-[26px] font-semibold tracking-wide text-cream">
        Welcome to <span className="text-gold">Aurea</span>
      </h1>
      <p className="mt-3 max-w-md text-[13px] leading-relaxed text-fog">
        Your studio runs entirely on this machine — images, voices, music and video are
        generated on your own GPU, and your work never leaves your disk. A few quick steps
        set up storage and the local engines.
      </p>
    </div>
  );
}

function StorageStep() {
  const { storage, setDataRoot } = useSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft.trim() && draft !== storage.root) setDataRoot(draft);
    setDraft(null);
  };
  return (
    <div className="space-y-4 py-2">
      <StepHeader
        icon={Database}
        title="Where should your studio live?"
        sub="Projects, generated assets and downloaded models are stored under one folder."
      />
      <div className="rounded-2xl border hairline bg-raised/50 p-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">
          Data root
        </div>
        <input
          value={draft ?? storage.root}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          spellCheck={false}
          className="mt-2 w-full rounded-lg border border-cream/10 bg-surface px-3 py-2 text-[12px] tabular-nums text-cream/90 focus:border-gold/35 focus:outline-none"
        />
        <div className="mt-3 flex items-baseline justify-between text-[11px]">
          <span className="text-fog">Free on this volume</span>
          <span className="tabular-nums text-cream/90">
            {storage.used} used / {storage.total}
          </span>
        </div>
      </div>
      <p className="text-[11px] text-fog/80">
        Large video models need room — 60 GB free is a comfortable start. You can move this
        later under Settings → Storage.
      </p>
    </div>
  );
}

function EnginesStep({ settings }: { settings: Settings }) {
  const rows: Array<{ label: string; note: string; value: string | null }> = [
    {
      label: "ComfyUI",
      note: "image + video generation backend",
      value: settings.engines.comfyUrl,
    },
    {
      label: "Videofast pipeline",
      note: "formats: quote, motivational, whiteboard…",
      value: settings.paths.videofastDir,
    },
    {
      label: "Chatterbox TTS",
      note: "character voices venv",
      value: settings.engines.chatterboxPython,
    },
    {
      label: "Qwen3 TTS",
      note: "narrator voices venv",
      value: settings.engines.qwenTtsPython,
    },
    {
      label: "ACE-Step 1.5",
      note: "music generation",
      value: settings.engines.acestepDir,
    },
  ];
  return (
    <div className="space-y-4 py-2">
      <StepHeader
        icon={Cpu}
        title="Local engines"
        sub="Aurea probed this machine for known installs. Missing engines just mean the matching lab waits until you add them."
      />
      <div className="divide-y divide-cream/6 rounded-2xl border hairline bg-raised/50">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-cream">{r.label}</div>
              <div className="mt-0.5 truncate text-[10px] tabular-nums text-fog">
                {r.value ?? r.note}
              </div>
            </div>
            {r.value ? (
              <Chip tone="sage" className="text-[10px]">
                <Check size={10} /> Detected
              </Chip>
            ) : (
              <Chip tone="muted" className="text-[10px]">
                Not found
              </Chip>
            )}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-fog/80">
        Paths are editable any time under Settings → Storage &amp; Engines.
      </p>
    </div>
  );
}

function ModelRow({
  m,
  selected,
  onSelect,
  accepted,
  onAccept,
}: {
  m: ModelEntry;
  selected: boolean;
  onSelect: (on: boolean) => void;
  accepted: boolean;
  onAccept: (on: boolean) => void;
}) {
  const s = m.status;
  const busy = s.state === "downloading" || s.state === "verifying";
  const done = s.state === "installed";
  const needsLicense = m.license.gated && !s.licenseAccepted;
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <button
          onClick={() => !done && !busy && onSelect(!selected)}
          disabled={done || busy}
          className={cx(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition",
            done || busy
              ? "border-cream/15 bg-cream/5"
              : selected
                ? "border-gold bg-gold text-ink"
                : "border-cream/25 hover:border-gold/50",
          )}
        >
          {(selected || done) && <Check size={11} strokeWidth={3} className={done ? "text-fog" : ""} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-medium text-cream">{m.name}</span>
            <span className="truncate text-[10px] text-fog">{m.engine}</span>
          </div>
          <div className="mt-0.5 truncate text-[11px] text-fog/85">{m.description}</div>
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-fog">{fmtSize(m.sizeBytes)}</span>
        {done && (
          <Chip tone="sage" className="shrink-0 text-[10px]">
            <Check size={10} /> Installed
          </Chip>
        )}
      </div>
      {busy && (
        <div className="mt-2 flex items-center gap-3 pl-7">
          <Progress value={s.progress} className="flex-1" />
          <span className="shrink-0 text-[10px] tabular-nums text-fog">
            {s.progress.toFixed(0)}%{s.bytesPerSec ? ` · ${fmtRate(s.bytesPerSec)}` : ""}
            {s.state === "verifying" ? " · verifying" : ""}
          </span>
        </div>
      )}
      {s.state === "error" && (
        <div className="mt-1.5 pl-7 text-[10px] text-[#e07a6b]">{s.error}</div>
      )}
      {needsLicense && selected && !busy && !done && (
        <label className="mt-2 flex cursor-pointer items-center gap-2 pl-7 text-[11px] text-fog">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => onAccept(e.target.checked)}
            className="h-3.5 w-3.5 accent-[#c9a96e]"
          />
          <span>
            I accept the{" "}
            <a
              href={m.license.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-gold hover:underline"
            >
              {m.license.name} <ExternalLink size={9} />
            </a>
          </span>
        </label>
      )}
    </div>
  );
}

function ModelsStep() {
  const { models, live, download, cancel } = useModels();
  const [selected, setSelected] = useState<Record<string, boolean> | null>(null);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});

  // preselect the essentials once the registry arrives
  const sel = useMemo(() => {
    if (selected) return selected;
    return Object.fromEntries(models.map((m) => [m.id, m.essential]));
  }, [selected, models]);

  const pending = models.filter(
    (m) => sel[m.id] && m.status.state !== "installed" && m.status.state !== "downloading" && m.status.state !== "verifying",
  );
  const startable = pending.filter(
    (m) => !m.license.gated || m.status.licenseAccepted || accepted[m.id],
  );
  const blocked = pending.length - startable.length;
  const busy = models.some(
    (m) => m.status.state === "downloading" || m.status.state === "verifying",
  );
  const totalBytes = startable.reduce((sum, m) => sum + m.sizeBytes - m.status.bytes, 0);

  return (
    <div className="space-y-4 py-2">
      <StepHeader
        icon={HardDriveDownload}
        title="Download the engine models"
        sub="Weights install into your data root, resume if interrupted, and are checksum-verified. You can keep going — downloads run in the background."
      />
      {!live ? (
        <div className="rounded-2xl border hairline bg-raised/50 p-6 text-center text-[12px] text-fog">
          Waiting for the studio core…
        </div>
      ) : (
        <>
          <div className="max-h-[300px] divide-y divide-cream/6 overflow-y-auto rounded-2xl border hairline bg-raised/50">
            {models.map((m) => (
              <ModelRow
                key={m.id}
                m={m}
                selected={!!sel[m.id]}
                onSelect={(on) => setSelected({ ...sel, [m.id]: on })}
                accepted={!!accepted[m.id]}
                onAccept={(on) => setAccepted((a) => ({ ...a, [m.id]: on }))}
              />
            ))}
          </div>
          <div className="flex items-center gap-3">
            {startable.length > 0 && (
              <GoldButton
                onClick={() =>
                  startable.forEach((m) =>
                    download(m.id, m.license.gated && !m.status.licenseAccepted),
                  )
                }
              >
                <Download size={13} /> Download {startable.length}{" "}
                {startable.length === 1 ? "model" : "models"} · {fmtSize(totalBytes)}
              </GoldButton>
            )}
            {busy && (
              <GhostButton
                onClick={() =>
                  models
                    .filter((m) => m.status.state === "downloading" || m.status.state === "verifying")
                    .forEach((m) => cancel(m.id))
                }
              >
                <Pause size={13} /> Pause all
              </GhostButton>
            )}
            {blocked > 0 && (
              <span className="text-[11px] text-fog">
                {blocked} selected {blocked === 1 ? "model needs" : "models need"} a license
                acceptance above
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ReadyStep({ downloading }: { downloading: number }) {
  return (
    <div className="flex flex-col items-center py-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full border border-gold/40 text-gold">
        <Sparkles size={22} strokeWidth={1.5} />
      </span>
      <h2 className="mt-5 font-serif text-[22px] font-semibold tracking-wide text-cream">
        The studio is yours
      </h2>
      <p className="mt-3 max-w-md text-[13px] leading-relaxed text-fog">
        {downloading > 0
          ? `${downloading} ${downloading === 1 ? "download is" : "downloads are"} still running — watch them under Settings → Models. `
          : ""}
        Start in the Director chat and describe what you want to make, or head straight
        into a lab.
      </p>
    </div>
  );
}

/* ---------- shell ---------- */

function StepHeader({
  icon: Icon,
  title,
  sub,
}: {
  icon: typeof Database;
  title: string;
  sub: string;
}) {
  return (
    <header className="flex items-start gap-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cream/10 bg-raised text-gold">
        <Icon size={16} strokeWidth={1.75} />
      </span>
      <div>
        <h2 className="font-serif text-[18px] font-semibold tracking-wide text-cream">{title}</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-fog">{sub}</p>
      </div>
    </header>
  );
}

export function FirstRunWizard() {
  const { showWizard, settings, finish } = useOnboarding();
  const { models } = useModels();
  const [step, setStep] = useState(0);

  if (!showWizard || !settings) return null;

  const downloading = models.filter(
    (m) => m.status.state === "downloading" || m.status.state === "verifying",
  ).length;
  const last = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/85 backdrop-blur-sm">
      <div className="mx-4 flex w-full max-w-[620px] flex-col rounded-3xl border hairline bg-surface shadow-2xl">
        <div className="min-h-[380px] px-8 pt-8">
          {step === 0 && <WelcomeStep />}
          {step === 1 && <StorageStep />}
          {step === 2 && <EnginesStep settings={settings} />}
          {step === 3 && <ModelsStep />}
          {step === 4 && <ReadyStep downloading={downloading} />}
        </div>
        <footer className="flex items-center gap-3 px-8 pb-6 pt-4">
          {step > 0 ? (
            <GhostButton onClick={() => setStep(step - 1)}>
              <ArrowLeft size={13} /> Back
            </GhostButton>
          ) : (
            <GhostButton onClick={finish}>Skip setup</GhostButton>
          )}
          <div className="flex flex-1 items-center justify-center gap-1.5">
            {STEPS.map((s, i) => (
              <span
                key={s}
                className={cx(
                  "h-1.5 rounded-full transition-all",
                  i === step ? "w-5 bg-gold" : "w-1.5 bg-cream/15",
                )}
              />
            ))}
          </div>
          {last ? (
            <GoldButton onClick={finish}>
              Enter the studio <ArrowRight size={13} />
            </GoldButton>
          ) : (
            <GoldButton onClick={() => setStep(step + 1)}>
              {step === 0 ? "Begin setup" : "Continue"} <ArrowRight size={13} />
            </GoldButton>
          )}
        </footer>
      </div>
    </div>
  );
}
