/* Director — the chat pane of the merged screen. Everything here was the old
 * DirectorChat centre column; what changed in the merge is the context chip
 * above the composer (the board's selected shot) and the loss of the asset
 * rail, which is now only the paperclip popover. */

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Check,
  ChevronDown,
  FileAudio,
  FileImage,
  FileMusic,
  FileVideo,
  Loader2,
  Paperclip,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import type { DirectorThread } from "@aurea/shared";
import {
  DIRECTOR_MODELS,
  useAssets,
  useChat,
  useDirectorModel,
  useDirectorThreads,
  type UiChatMessage,
  type UiToolCall,
} from "@/hooks";
import type { Asset, Job } from "@/data/sample";
import { composer } from "@/data/sample";
import { Chip, GhostButton, GoldButton, Progress, Waveform, cx } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import type { ShotContext } from "./shared";

const kindIcon = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  music: FileMusic,
} as const;

const attachmentIcon = (kind: string) =>
  kindIcon[kind as keyof typeof kindIcon] ?? Paperclip;

export interface AttachApi {
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

/** With a shot selected on the board the message says so out loud, rather than
 * carrying invisible state: the Director reads the same line the user sent. */
const withContext = (text: string, ctx: ShotContext | null) =>
  ctx ? `[Shot ${ctx.code} · ${ctx.scene}${ctx.title ? ` · ${ctx.title}` : ""}]\n${text}` : text;

export function ChatPane({
  attach,
  seed,
  context,
  clearContext,
}: {
  attach: AttachApi;
  seed: DirectorSeed | null;
  context: ShotContext | null;
  clearContext: () => void;
}) {
  const { messages, busy, send, stop, threads, blockedBy, error } = useChat();
  const endRef = useRef<HTMLDivElement>(null);
  const last = messages[messages.length - 1];
  const streamingNow = !!last?.streaming;
  const active = threads.threads.find((t) => t.id === threads.activeId);
  const activeTitle = active?.title ?? "this thread";
  // a closed thread is readable but not writable — say so instead of letting
  // the send fail on the server
  const readOnly = !!active?.closed;

  useEffect(() => {
    // instant follow while text streams; smooth glide for whole new messages
    endRef.current?.scrollIntoView({ behavior: streamingNow ? "auto" : "smooth", block: "end" });
  }, [messages.length, last?.text?.length, streamingNow, busy]);

  return (
    /* min-h-0: the pane is a column flex item now (the split wraps it), so
       without it the thread's auto minimum height pushes the composer and the
       header out of the layout entirely */
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2.5 border-b hairline px-5 py-3">
        <Sparkles size={15} className="shrink-0 text-gold" />
        <div className="min-w-0">
          <h1 className="font-serif text-[15px] leading-tight text-cream">Director</h1>
          <ThreadSwitcher threads={threads} />
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Sparkles size={20} className="text-gold/60" />
            <p className="font-serif text-[15px] text-cream/80">The set is quiet.</p>
            <p className="max-w-[380px] text-sm leading-relaxed text-fog">
              Ask the Director for keyframes, a voice take, a music cue, or a full videofast
              episode — boarded shots appear on the canvas beside this thread.
            </p>
            {threads.live && (
              <p className="text-xs text-fog">
                Fresh context in <span className="text-cream/80">{activeTitle}</span>.
              </p>
            )}
          </div>
        )}
        {messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
        {busy && !streamingNow && (
          <div className="flex items-center gap-2 text-xs text-fog">
            <Loader2 size={12} className="animate-spin text-gold/70" />
            The Director is thinking…
          </div>
        )}
        <div ref={endRef} />
      </div>

      {readOnly && (
        <div className="flex items-center gap-2 border-t hairline px-5 py-2 text-xs text-fog">
          <Archive size={11} className="shrink-0" />
          <span>
            <span className="text-cream/85">{activeTitle}</span> is closed — its context is freed.
          </span>
          <button
            onClick={() => threads.reopen(threads.activeId)}
            className="ml-auto shrink-0 text-gold/90 transition hover:text-gold"
          >
            Reopen
          </button>
        </div>
      )}

      {/* the run lock is per project: a sibling thread's run refuses this one's
          sends, so say which thread to go stop rather than failing silently */}
      {!readOnly && blockedBy && (
        <div className="flex items-center gap-2 border-t hairline px-5 py-2 text-xs text-fog">
          <Loader2 size={11} className="shrink-0 animate-spin text-gold/70" />
          The Director is working in <span className="text-cream/85">{blockedBy}</span>.
        </div>
      )}
      {error && !blockedBy && !readOnly && (
        <div className="flex items-start gap-2 border-t hairline px-5 py-2 text-xs text-ember/90">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <Composer
        key={seed ? seed.sentAt : "free"}
        initialText={seed?.text}
        busy={busy}
        readOnly={readOnly}
        attach={attach}
        context={context}
        clearContext={clearContext}
        onSend={(text) => {
          send(
            withContext(text, context),
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
      <div className="flex items-baseline gap-2 text-xs text-fog">
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
                className="flex items-center gap-1.5 rounded-lg border border-gold/25 bg-gold/8 px-2 py-1 text-xs text-cream/85"
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
          <p className="whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-gold/12 px-4 py-2.5 text-sm leading-relaxed text-cream">
            {message.text}
          </p>
        ) : (
          <div className="rounded-2xl rounded-tl-sm bg-surface px-4 py-2.5 text-sm leading-relaxed text-cream/90">
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
        <span className="truncate font-mono text-xs text-cream/85">{tool.name}</span>
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
      {tool.params ? (
        <div className="mt-2 border-t hairline pt-2">
          <div className="pb-1 text-2xs font-semibold uppercase tracking-[0.14em] text-fog">
            Parameters
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
            {Object.entries(tool.params).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-2xs text-fog">{k}</dt>
                <dd className="truncate text-right font-mono text-2xs text-cream/85">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        tool.summary && <p className="mt-1 truncate text-xs text-fog">{tool.summary}</p>
      )}
      {tool.job && (tool.job.status === "running" || tool.job.status === "queued") && (
        <>
          <Progress value={tool.job.progress} className="mt-2" />
          <div className="mt-1 flex justify-between text-2xs text-fog">
            <span>{tool.job.stage ?? tool.job.status}</span>
            <span>{tool.job.eta}</span>
          </div>
        </>
      )}
      {tool.job?.status === "failed" && (
        <p className="mt-1 text-xs text-ember">{tool.job.error ?? "job failed"}</p>
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
            <span className="absolute bottom-1.5 left-2 text-2xs text-cream/70">{it.name}</span>
            {i === 1 && (
              <span className="absolute right-1.5 top-1.5 rounded-full bg-gold px-1.5 py-0.5 text-2xs font-semibold text-ink">
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
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-ink/60">
            <Play size={16} className="ml-0.5 text-cream" />
          </div>
        </div>
        <span className="absolute left-2 top-2 rounded bg-ink/70 px-1.5 py-0.5 text-2xs text-cream/85">
          {job.engine}
        </span>
      </div>
      <div className="mt-2.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-cream/90">{job.title}</span>
          <span className="text-gold">{job.progress}%</span>
        </div>
        <Progress value={job.progress} className="mt-1.5" />
        <div className="mt-1.5 flex items-center justify-between text-xs text-fog">
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
        <p className="truncate text-sm italic text-cream/85">{card.title}</p>
        <Waveform seed={card.seed} bars={56} played={0.35} className="mt-1.5" />
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <Chip tone="gold">{card.voice}</Chip>
        <span className="text-xs text-fog">{card.duration}</span>
      </div>
    </div>
  );
}

/** The thread switcher. A new thread is a brand-new Claude Code session, which
 * is the whole point: it starts on an empty context window. Closing keeps the
 * transcript (read-only, collapsed below); only Delete destroys it. */
function ThreadSwitcher({ threads }: { threads: ReturnType<typeof useDirectorThreads> }) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const current = threads.threads.find((t) => t.id === threads.activeId);
  const openThreads = threads.threads.filter((t) => !t.closed);
  const closedThreads = threads.threads.filter((t) => t.closed);

  if (!threads.live) {
    return <p className="truncate text-xs text-fog">AI filmmaking copilot</p>;
  }

  const pick = (id: string) => {
    threads.setActive(id);
    setOpen(false);
  };

  const commitRename = (id: string) => {
    if (draft.trim()) threads.rename(id, draft);
    setRenaming(null);
  };

  const Row = ({ thread }: { thread: DirectorThread }) => {
    const active = thread.id === threads.activeId;
    const running = thread.id === threads.runningId;
    if (renaming === thread.id) {
      return (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commitRename(thread.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename(thread.id);
            if (e.key === "Escape") setRenaming(null);
          }}
          className="w-full rounded-lg border border-gold/40 bg-ink/60 px-2.5 py-1.5 text-sm text-cream outline-none"
        />
      );
    }
    return (
      <div
        className={cx(
          "group flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition hover:bg-cream/5",
          active && "bg-cream/5",
        )}
      >
        <button onClick={() => pick(thread.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className={cx("truncate text-sm", active ? "text-cream" : "text-cream/80")}>
            {thread.title}
          </span>
          {running && <Loader2 size={11} className="shrink-0 animate-spin text-gold/80" />}
          {active && !running && <Check size={12} className="shrink-0 text-gold" />}
        </button>
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
          <button
            title="Rename"
            onClick={() => {
              setDraft(thread.title);
              setRenaming(thread.id);
            }}
            className="rounded p-1 text-fog transition hover:text-cream"
          >
            <Pencil size={11} />
          </button>
          {thread.closed ? (
            <button
              title="Reopen"
              onClick={() => threads.reopen(thread.id)}
              className="rounded p-1 text-fog transition hover:text-cream"
            >
              <RotateCcw size={11} />
            </button>
          ) : (
            <button
              title="Close — keeps the transcript, frees the context"
              onClick={() => threads.close(thread.id)}
              className="rounded p-1 text-fog transition hover:text-cream"
            >
              <Archive size={11} />
            </button>
          )}
          <button
            title={confirmDelete === thread.id ? "Click again to delete for good" : "Delete"}
            onClick={() => {
              if (confirmDelete === thread.id) {
                threads.remove(thread.id);
                setConfirmDelete(null);
              } else {
                setConfirmDelete(thread.id);
              }
            }}
            className={cx(
              "rounded p-1 transition",
              confirmDelete === thread.id ? "text-ember" : "text-fog hover:text-ember",
            )}
          >
            <Trash2 size={11} />
          </button>
        </span>
      </div>
    );
  };

  return (
    <div className="relative">
      {open && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => {
            setOpen(false);
            setConfirmDelete(null);
          }}
        />
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-full items-center gap-1 text-xs text-fog transition hover:text-cream"
      >
        <span className="truncate">{current?.title ?? "Director"}</span>
        {threads.runningId && threads.runningId !== threads.activeId && (
          <Loader2 size={10} className="shrink-0 animate-spin text-gold/70" />
        )}
        <ChevronDown size={11} className={cx("shrink-0 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 w-[300px] rounded-xl border hairline bg-raised p-1 shadow-xl shadow-ink/60">
          <div className="max-h-[320px] overflow-y-auto">
            {openThreads.map((t) => (
              <Row key={t.id} thread={t} />
            ))}
            {closedThreads.length > 0 && (
              <>
                <p className="px-2.5 pb-1 pt-2 text-2xs uppercase tracking-wide text-fog">
                  Closed
                </p>
                {closedThreads.map((t) => (
                  <Row key={t.id} thread={t} />
                ))}
              </>
            )}
          </div>
          <button
            onClick={() => {
              threads.create();
              setOpen(false);
            }}
            className="mt-1 flex w-full items-center gap-2 border-t hairline px-2.5 py-2 text-left text-sm text-cream/85 transition hover:text-cream"
          >
            <Plus size={12} className="text-gold/80" />
            New thread
            <span className="ml-auto text-2xs text-fog">fresh context</span>
          </button>
          {threads.error && (
            <p className="px-2.5 pb-1.5 text-2xs leading-relaxed text-ember/90">{threads.error}</p>
          )}
        </div>
      )}
    </div>
  );
}

function ModelPicker() {
  const { model, live, setModel } = useDirectorModel();
  const [open, setOpen] = useState(false);
  const current = DIRECTOR_MODELS.find((m) => m.id === model) ?? DIRECTOR_MODELS[0];

  if (!live) {
    return (
      <span className="rounded-full border border-cream/10 px-2.5 py-1 text-xs text-fog">
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
          "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition",
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
                <div className="text-sm text-cream">{m.label}</div>
                <div className="text-2xs text-fog">{m.detail}</div>
              </div>
              {m.id === model && <Check size={13} className="shrink-0 text-gold" />}
            </button>
          ))}
          <p className="border-t hairline px-2.5 pb-1 pt-1.5 text-2xs text-fog">
            Runs on your Claude Code subscription
          </p>
        </div>
      )}
    </div>
  );
}

/** the paperclip popover — since the merge this is the only asset browser on
 * the screen, the board having taken the left rail's place */
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
            <p className="px-2.5 py-2 text-xs text-fog">The library is empty — generate something first.</p>
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
                <span className="min-w-0 flex-1 truncate text-sm text-cream/90">{a.name}</span>
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
  /** the thread is closed: writable-looking but inert. Distinct from busy —
   * "working…" with a stop button would be a lie here */
  readOnly = false,
  attach,
  context,
  clearContext,
  onSend,
  onStop,
  initialText,
}: {
  busy: boolean;
  readOnly?: boolean;
  attach: AttachApi;
  context: ShotContext | null;
  clearContext: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
  initialText?: string;
}) {
  const [text, setText] = useState(initialText ?? "");

  const submit = () => {
    if (busy || readOnly || !text.trim()) return;
    onSend(text);
    setText("");
  };

  return (
    <footer className="border-t hairline px-5 py-4">
      {context && (
        <div className="mb-2 flex">
          <span
            title={`Messages act on ${context.code}. Click × to talk about the episode instead.`}
            className="flex min-w-0 items-center gap-1.5 rounded-lg border border-gold/25 bg-gold/8 px-2 py-1 text-xs text-cream/85"
          >
            <span className="font-mono text-gold/90">{context.code}</span>
            <span className="text-fog">·</span>
            <span className="max-w-[220px] truncate">{context.title || context.scene}</span>
            <button
              onClick={clearContext}
              title="Drop the shot context"
              className="text-fog transition hover:text-ember"
            >
              <X size={11} />
            </button>
          </span>
        </div>
      )}
      <div className="rounded-2xl border border-cream/10 bg-surface px-4 py-3 transition focus-within:border-gold/40">
        {attach.pending.length > 0 && (
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {attach.pending.map((a) => {
              const Icon = kindIcon[a.kind];
              return (
                <span
                  key={a.id}
                  title={a.id}
                  className="flex items-center gap-1.5 rounded-lg border border-gold/25 bg-gold/8 px-2 py-1 text-xs text-cream/85"
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
            // Esc in the composer clears the shot context, not the selection's
            // slide-over — that one is handled on the screen
            if (e.key === "Escape" && context) {
              e.stopPropagation();
              clearContext();
            }
          }}
          placeholder={
            readOnly
              ? "This thread is closed — reopen it to keep talking."
              : busy
                ? "The Director is working…"
                : context
                  ? `Ask the Director about ${context.code}…`
                  : attach.pending.length
                    ? "What should the Director do with these?"
                    : "Ask Director anything…"
          }
          className="w-full resize-none bg-transparent text-sm text-cream placeholder:text-fog focus:outline-none"
        />
        <div className="mt-2.5 flex items-center gap-2">
          <ModelPicker />
          {busy && !readOnly && <Chip tone="muted">thinking…</Chip>}
          <div className="ml-auto flex items-center gap-1.5">
            <AttachPicker attach={attach} />
            {busy && !readOnly ? (
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
                disabled={!text.trim() || readOnly}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-b from-gold to-gold-deep text-ink transition hover:brightness-110 disabled:opacity-40"
              >
                <Send size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
      <p className="mt-2 text-center text-2xs text-fog">
        AI outputs can make mistakes. Review before use.
      </p>
    </footer>
  );
}
