import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  FileAudio,
  FileImage,
  FileMusic,
  FileVideo,
  Loader2,
  Paperclip,
  Pause,
  Play,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Square,
  Wrench,
  X,
} from "lucide-react";
import {
  DIRECTOR_MODELS,
  useAssets,
  useChat,
  useDirectorModel,
  useJobs,
  useProjects,
  type UiChatMessage,
  type UiToolCall,
} from "@/hooks";
import type { Asset, Job } from "@/data/sample";
import { composer } from "@/data/sample";
import { Chip, GhostButton, GoldButton, Progress, Waveform, cx } from "@/components/ui";
import { Markdown } from "@/components/Markdown";

const kindIcon = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  music: FileMusic,
} as const;

const attachmentIcon = (kind: string) =>
  kindIcon[kind as keyof typeof kindIcon] ?? Paperclip;

/* ---------- left rail: project + assets ---------- */

function AssetRail({ onAttach }: { onAttach: (asset: Asset) => void }) {
  const { projects } = useProjects();
  const { assets } = useAssets();
  const active = projects[0];

  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-r hairline bg-[#0e0e10]">
      <button className="m-3 flex items-center justify-between rounded-xl bg-surface p-3 text-left transition hover:bg-raised">
        <div>
          <div className="font-serif text-[15px] text-cream">{active.name}</div>
          <div className="mt-0.5 text-[11px] text-fog">{active.meta}</div>
        </div>
        <ChevronDown size={14} className="text-fog" />
      </button>

      <div className="flex items-center justify-between px-4 pb-2 pt-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fog">
          Assets
        </span>
        <Search size={13} className="text-fog" />
      </div>

      <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto px-3 pb-3">
        {assets.map((a) => (
          <AssetThumb key={a.id} asset={a} onAttach={onAttach} />
        ))}
      </div>
    </aside>
  );
}

function AssetThumb({ asset, onAttach }: { asset: Asset; onAttach: (asset: Asset) => void }) {
  const Icon = kindIcon[asset.kind];
  return (
    <button
      title={`Attach ${asset.name} to your next message`}
      onClick={() => onAttach(asset)}
      className="group relative aspect-square overflow-hidden rounded-lg border border-cream/5 transition hover:border-gold/40"
    >
      <div className={cx("absolute inset-0", asset.swatch)} />
      {asset.url && asset.kind === "image" && (
        <img src={asset.url} alt={asset.name} className="absolute inset-0 h-full w-full object-cover" />
      )}
      {asset.url && asset.kind === "video" && (
        <video src={asset.url} preload="metadata" muted className="absolute inset-0 h-full w-full object-cover" />
      )}
      {(asset.kind === "audio" || asset.kind === "music") && (
        <Waveform seed={asset.id.length * 5} bars={14} played={0} className="absolute inset-x-2 top-1/2 h-5 -translate-y-1/2" />
      )}
      <Icon size={13} className="absolute left-1.5 top-1.5 text-cream/70" />
      {asset.duration && (
        <span className="absolute bottom-1 right-1 rounded bg-ink/70 px-1 text-[10px] text-cream/80">
          {asset.duration}
        </span>
      )}
      <span className="absolute inset-0 hidden items-center justify-center bg-ink/55 group-hover:flex">
        <Paperclip size={14} className="text-gold" />
      </span>
    </button>
  );
}

/* ---------- center: chat thread ---------- */

interface AttachApi {
  pending: Asset[];
  onAttach: (asset: Asset) => void;
  onDetach: (id: string) => void;
  onClear: () => void;
}

/** composer prefill handed over by another screen (Formats "Chat with Director");
 * sentAt keys the remount so a second send re-seeds a dirty composer */
export interface DirectorSeed {
  text: string;
  sentAt: number;
}

function Thread({ attach, seed }: { attach: AttachApi; seed: DirectorSeed | null }) {
  const { messages, busy, send, stop } = useChat();
  const endRef = useRef<HTMLDivElement>(null);
  const last = messages[messages.length - 1];
  const streamingNow = !!last?.streaming;

  useEffect(() => {
    // instant follow while text streams; smooth glide for whole new messages
    endRef.current?.scrollIntoView({ behavior: streamingNow ? "auto" : "smooth", block: "end" });
  }, [messages.length, last?.text?.length, streamingNow, busy]);

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2.5 border-b hairline px-6 py-3.5">
        <Sparkles size={16} className="text-gold" />
        <div>
          <h1 className="font-serif text-[17px] leading-tight text-cream">AI Director</h1>
          <p className="text-[11px] text-fog">Your creative partner in previsualization and production</p>
        </div>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Sparkles size={20} className="text-gold/60" />
            <p className="font-serif text-[15px] text-cream/80">The set is quiet.</p>
            <p className="max-w-[380px] text-[12px] leading-relaxed text-fog">
              Ask the Director for keyframes, a voice take, a music cue, or a full videofast episode —
              every job lands in the rail on the right and finishes in your library.
            </p>
          </div>
        )}
        {messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
        {busy && !streamingNow && (
          <div className="flex items-center gap-2 text-[11px] text-fog">
            <Loader2 size={12} className="animate-spin text-gold/70" />
            The Director is thinking…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <Composer
        key={seed ? seed.sentAt : "free"}
        initialText={seed?.text}
        busy={busy}
        attach={attach}
        onSend={(text) => {
          send(
            text,
            attach.pending.map((a) => ({ kind: a.kind, name: a.name, relPath: a.id })),
          );
          attach.onClear();
        }}
        onStop={stop}
      />
    </section>
  );
}

function Message({ message }: { message: UiChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cx("flex max-w-[720px] flex-col gap-2", isUser && "ml-auto items-end")}>
      <div className="flex items-baseline gap-2 text-[11px] text-fog">
        <span className={cx("font-semibold uppercase tracking-wide", !isUser && "text-gold/80")}>
          {isUser ? "You" : "Director"}
        </span>
        <span>{message.time}</span>
      </div>
      {message.attachments && message.attachments.length > 0 && (
        <div className={cx("flex flex-wrap gap-1.5", isUser && "justify-end")}>
          {message.attachments.map((a, i) => {
            const Icon = attachmentIcon(a.kind);
            return (
              <span
                key={`${a.relPath}:${i}`}
                title={a.relPath}
                className="flex items-center gap-1.5 rounded-lg border border-gold/25 bg-gold/8 px-2 py-1 text-[11px] text-cream/85"
              >
                <Icon size={11} className="text-gold/70" />
                <span className="max-w-[180px] truncate">{a.name}</span>
              </span>
            );
          })}
        </div>
      )}
      {message.text &&
        (isUser ? (
          <p className="whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-gold/12 px-4 py-2.5 text-[13px] leading-relaxed text-cream">
            {message.text}
          </p>
        ) : (
          <div className="rounded-2xl rounded-tl-sm bg-surface px-4 py-2.5 text-[13px] leading-relaxed text-cream/90">
            <Markdown>{message.text}</Markdown>
            {message.streaming && (
              <span className="ml-0.5 inline-block h-3.5 w-[3px] animate-pulse rounded-sm bg-gold/80 align-text-bottom" />
            )}
          </div>
        ))}
      {message.toolCall && <ToolCallCard tool={message.toolCall} />}
      {message.card?.type === "images" && <ImageResultCard items={message.card.items} />}
      {message.card?.type === "video" && (
        <VideoJobCard job={message.card.job} swatch={message.card.thumbSwatch} />
      )}
      {message.card?.type === "audio" && <AudioTakeCard card={message.card} />}
    </div>
  );
}

/** one Director tool call — spinner while running, live job progress when it enqueued one */
function ToolCallCard({ tool }: { tool: UiToolCall }) {
  const running = tool.status === "running" || tool.job?.status === "running" || tool.job?.status === "queued";
  const failed = tool.status === "error" || tool.job?.status === "failed";
  return (
    <div className="w-full max-w-[520px] rounded-2xl rounded-tl-sm border hairline bg-surface px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <Wrench size={12} className="shrink-0 text-gold/60" />
        <span className="truncate font-mono text-[11px] text-cream/85">{tool.name}</span>
        <span className="ml-auto shrink-0">
          {failed ? (
            <AlertTriangle size={13} className="text-ember" />
          ) : running ? (
            <Loader2 size={13} className="animate-spin text-gold" />
          ) : (
            <Check size={13} className="text-sage" />
          )}
        </span>
      </div>
      {tool.summary && <p className="mt-1 truncate text-[11px] text-fog">{tool.summary}</p>}
      {tool.job && (tool.job.status === "running" || tool.job.status === "queued") && (
        <>
          <Progress value={tool.job.progress} className="mt-2" />
          <div className="mt-1 flex justify-between text-[10px] text-fog">
            <span>{tool.job.stage ?? tool.job.status}</span>
            <span>{tool.job.eta}</span>
          </div>
        </>
      )}
      {tool.job?.status === "failed" && (
        <p className="mt-1 text-[11px] text-ember">{tool.job.error ?? "job failed"}</p>
      )}
    </div>
  );
}

function ImageResultCard({ items }: { items: Asset[] }) {
  return (
    <div className="w-full rounded-2xl rounded-tl-sm border hairline bg-surface p-3">
      <div className="grid grid-cols-2 gap-2">
        {items.map((it, i) => (
          <div
            key={it.id}
            className={cx(
              "group relative aspect-video overflow-hidden rounded-lg border",
              i === 1 ? "border-gold/60" : "border-cream/5",
            )}
          >
            <div className={cx("absolute inset-0", it.swatch)} />
            <span className="absolute bottom-1.5 left-2 text-[10px] text-cream/70">{it.name}</span>
            {i === 1 && (
              <span className="absolute right-1.5 top-1.5 rounded-full bg-gold px-1.5 py-0.5 text-[10px] font-semibold text-ink">
                picked
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex gap-2">
        <GhostButton>
          <RefreshCw size={12} /> Regenerate
        </GhostButton>
        <GoldButton>
          <Check size={12} /> Approve & save
        </GoldButton>
      </div>
    </div>
  );
}

function VideoJobCard({ job, swatch }: { job: Job; swatch: string }) {
  return (
    <div className="w-full rounded-2xl rounded-tl-sm border hairline bg-surface p-3">
      <div className="relative aspect-video overflow-hidden rounded-lg">
        <div className={cx("absolute inset-0", swatch)} />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-ink/60 backdrop-blur">
            <Play size={16} className="ml-0.5 text-cream" />
          </div>
        </div>
        <span className="absolute left-2 top-2 rounded bg-ink/70 px-1.5 py-0.5 text-[10px] text-cream/85">
          {job.engine}
        </span>
      </div>
      <div className="mt-2.5">
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-cream/90">{job.title}</span>
          <span className="text-gold">{job.progress}%</span>
        </div>
        <Progress value={job.progress} className="mt-1.5" />
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-fog">
          <span>
            {job.stage} · ETA {job.eta}
          </span>
          <button className="flex items-center gap-1 text-fog transition hover:text-ember">
            <X size={11} /> Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function AudioTakeCard({
  card,
}: {
  card: { title: string; voice: string; duration: string; seed: number };
}) {
  return (
    <div className="flex w-full items-center gap-3 rounded-2xl rounded-tl-sm border hairline bg-surface p-3">
      <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold text-ink transition hover:brightness-110">
        <Play size={15} className="ml-0.5" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] italic text-cream/85">{card.title}</p>
        <Waveform seed={card.seed} bars={56} played={0.35} className="mt-1.5" />
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <Chip tone="gold">{card.voice}</Chip>
        <span className="text-[11px] text-fog">{card.duration}</span>
      </div>
    </div>
  );
}

function ModelPicker() {
  const { model, live, setModel } = useDirectorModel();
  const [open, setOpen] = useState(false);
  const current = DIRECTOR_MODELS.find((m) => m.id === model) ?? DIRECTOR_MODELS[0];

  if (!live) {
    return (
      <span className="rounded-full border border-cream/10 px-2.5 py-1 text-[11px] text-fog">
        {composer.model}
      </span>
    );
  }

  return (
    <div className="relative">
      {open && <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cx(
          "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition",
          open ? "border-gold/40 text-cream" : "border-cream/10 text-cream/80 hover:border-gold/40",
        )}
      >
        {current.label} <ChevronDown size={11} className={cx("transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-[240px] rounded-xl border hairline bg-raised p-1 shadow-xl shadow-ink/60">
          {DIRECTOR_MODELS.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setModel(m.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-cream/5"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-cream">{m.label}</div>
                <div className="text-[10px] text-fog">{m.detail}</div>
              </div>
              {m.id === model && <Check size={13} className="shrink-0 text-gold" />}
            </button>
          ))}
          <p className="border-t hairline px-2.5 pb-1 pt-1.5 text-[10px] text-fog/70">
            Runs on your Claude Code subscription
          </p>
        </div>
      )}
    </div>
  );
}

/** the paperclip popover — the same library the left rail shows, as a compact list */
function AttachPicker({ attach }: { attach: AttachApi }) {
  const { assets } = useAssets();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      {open && <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Attach an asset"
        className={cx(
          "flex h-8 w-8 items-center justify-center rounded-lg transition",
          open ? "bg-cream/5 text-cream" : "text-fog hover:bg-cream/5 hover:text-cream",
        )}
      >
        <Paperclip size={15} />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-20 mb-2 max-h-[280px] w-[260px] overflow-y-auto rounded-xl border hairline bg-raised p-1 shadow-xl shadow-ink/60">
          {assets.length === 0 && (
            <p className="px-2.5 py-2 text-[11px] text-fog">The library is empty — generate something first.</p>
          )}
          {assets.map((a) => {
            const Icon = kindIcon[a.kind];
            const attached = attach.pending.some((p) => p.id === a.id);
            return (
              <button
                key={a.id}
                onClick={() => {
                  attach.onAttach(a);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition hover:bg-cream/5"
              >
                <Icon size={13} className="shrink-0 text-gold/70" />
                <span className="min-w-0 flex-1 truncate text-[12px] text-cream/90">{a.name}</span>
                {attached && <Check size={12} className="shrink-0 text-gold" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Composer({
  busy,
  attach,
  onSend,
  onStop,
  initialText,
}: {
  busy: boolean;
  attach: AttachApi;
  onSend: (text: string) => void;
  onStop: () => void;
  initialText?: string;
}) {
  const [text, setText] = useState(initialText ?? "");

  const submit = () => {
    if (busy || !text.trim()) return;
    onSend(text);
    setText("");
  };

  return (
    <footer className="border-t hairline px-6 py-4">
      <div className="rounded-2xl border border-cream/10 bg-surface px-4 py-3 transition focus-within:border-gold/40">
        {attach.pending.length > 0 && (
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {attach.pending.map((a) => {
              const Icon = kindIcon[a.kind];
              return (
                <span
                  key={a.id}
                  title={a.id}
                  className="flex items-center gap-1.5 rounded-lg border border-gold/25 bg-gold/8 px-2 py-1 text-[11px] text-cream/85"
                >
                  <Icon size={11} className="text-gold/70" />
                  <span className="max-w-[160px] truncate">{a.name}</span>
                  <button
                    onClick={() => attach.onDetach(a.id)}
                    title="Remove attachment"
                    className="text-fog transition hover:text-ember"
                  >
                    <X size={11} />
                  </button>
                </span>
              );
            })}
          </div>
        )}
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            busy
              ? "The Director is working…"
              : attach.pending.length
                ? "What should the Director do with these?"
                : "Message the Director…"
          }
          className="w-full resize-none bg-transparent text-[13px] text-cream placeholder:text-fog focus:outline-none"
        />
        <div className="mt-2.5 flex items-center gap-2">
          <ModelPicker />
          {busy && <Chip tone="muted">thinking…</Chip>}
          <div className="ml-auto flex items-center gap-1.5">
            <AttachPicker attach={attach} />
            {busy ? (
              <button
                onClick={onStop}
                title="Stop the Director"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-cream/15 text-cream/80 transition hover:border-ember/60 hover:text-ember"
              >
                <Square size={11} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={!text.trim()}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-b from-gold to-gold-deep text-ink transition hover:brightness-110 disabled:opacity-40"
              >
                <Send size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
      <p className="mt-2 text-center text-[10px] text-fog/60">
        AI outputs can make mistakes. Review before use.
      </p>
    </footer>
  );
}

/* ---------- right rail: job center ---------- */

const statusChip: Record<Job["status"], { tone: "gold" | "muted" | "sage" | "ember"; label: string }> = {
  running: { tone: "gold", label: "Running" },
  queued: { tone: "muted", label: "Queued" },
  completed: { tone: "sage", label: "Done" },
  failed: { tone: "ember", label: "Failed" },
};

function JobRail() {
  const { jobs, vram } = useJobs();
  const usedPct = (vram.used / vram.total) * 100;
  const allocPct = ((vram.allocated - vram.used) / vram.total) * 100;

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l hairline bg-[#0e0e10]">
      <header className="flex items-center justify-between px-4 py-3.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fog">
          Job center
        </span>
        <button
          title="Pause queue"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-fog transition hover:bg-cream/5 hover:text-cream"
        >
          <Pause size={13} />
        </button>
      </header>

      <div className="mx-3 rounded-xl bg-surface p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] text-fog">VRAM</span>
          <span className="text-[13px] text-cream">
            <span className="font-semibold text-gold">{vram.used}</span>
            <span className="text-fog"> / {vram.total} GB</span>
          </span>
        </div>
        <div className="mt-2 flex h-1.5 gap-px overflow-hidden rounded-full bg-cream/8">
          <div className="bg-gold" style={{ width: `${usedPct}%` }} />
          <div className="bg-gold/35" style={{ width: `${allocPct}%` }} />
        </div>
        <div className="mt-1.5 flex gap-3 text-[10px] text-fog">
          <span className="flex items-center gap-1">
            <i className="h-1.5 w-1.5 rounded-full bg-gold" /> used
          </span>
          <span className="flex items-center gap-1">
            <i className="h-1.5 w-1.5 rounded-full bg-gold/35" /> allocated
          </span>
          <span className="flex items-center gap-1">
            <i className="h-1.5 w-1.5 rounded-full bg-cream/15" /> free
          </span>
        </div>
      </div>

      <div className="mt-3 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        {jobs.map((j) => (
          <JobRow key={j.id} job={j} />
        ))}
      </div>
    </aside>
  );
}

function JobRow({ job }: { job: Job }) {
  const chip = statusChip[job.status];
  const Icon = kindIcon[job.kind === "tts" ? "audio" : job.kind === "music" ? "music" : job.kind];
  return (
    <div className="rounded-xl bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon size={14} className="shrink-0 text-gold/70" />
          <span className="truncate text-[12px] text-cream/90">{job.title}</span>
        </div>
        <Chip tone={chip.tone}>{chip.label}</Chip>
      </div>
      <div className="mt-1.5 text-[11px] text-fog">
        {job.engine} · {job.priority}
      </div>
      {job.status === "running" && (
        <>
          <Progress value={job.progress} className="mt-2" />
          <div className="mt-1 flex justify-between text-[10px] text-fog">
            <span>{job.stage}</span>
            <span>{job.eta}</span>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- screen ---------- */

export function DirectorChat() {
  const seed = (useLocation().state as { seed?: DirectorSeed } | null)?.seed ?? null;
  const [pending, setPending] = useState<Asset[]>([]);
  const attach: AttachApi = {
    pending,
    onAttach: (asset) =>
      setPending((prev) =>
        prev.some((p) => p.id === asset.id) || prev.length >= 8 ? prev : [...prev, asset],
      ),
    onDetach: (id) => setPending((prev) => prev.filter((p) => p.id !== id)),
    onClear: () => setPending([]),
  };
  return (
    <div className="flex h-full">
      <AssetRail onAttach={attach.onAttach} />
      <Thread attach={attach} seed={seed} />
      <JobRail />
    </div>
  );
}
