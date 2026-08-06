import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, Bot, Cpu, Layers, Mic2, Palette, X } from "lucide-react";
import { useProjects, useVideofastAccounts, type FormatRuns } from "@/hooks";
import { STAGE_LABELS, asksFor, packById, type FormatCard } from "@/data/formats";
import { Chip, SectionLabel, cx, inputCls } from "@/components/ui";
import { trpc } from "@/trpc";
import {
  CreateFooter,
  Disclosure,
  DurationChips,
  ParadigmRow,
  Poster,
  QueuedNote,
  RecipeStack,
  RunLine,
  StackRow,
} from "./shared";

/* The create panel — formats-v2's recipe stack. Everything the run is made of
 * is three rows with their current values on them; the fields the format
 * actually asks for are titled; "Create now" is the primary. */

/** the message the Director chat opens with — enough context to advise AND
 * the exact create_video knobs to launch with once the topic is agreed */
function directorSeedText(
  format: FormatCard,
  packId: string,
  accountId: string,
  topic: string,
  extra: string,
  duration: number | null,
) {
  const ask = asksFor(format);
  const lines = [
    `Format brief from the Formats screen — ${format.name} (${format.id}), style pack ${packId}` +
      (accountId ? `, channel ${accountId}` : "") +
      (duration ? `, target ~${duration}s.` : "."),
    `The recipe: ${format.tagline}`,
    topic.trim()
      ? `My ${ask.label.toLowerCase()}: ${topic.trim()}`
      : "I don't have a topic yet — pitch me three strong ones for this format.",
  ];
  if (ask.extra && extra.trim()) lines.push(`${ask.extra.label}: ${extra.trim()}`);
  lines.push(
    `Help me sharpen this into one strong short (hook, turn, payoff), then launch create_video ` +
      `with format "${format.id}", stylePack "${packId}"` +
      (duration ? ` and durationSec ${duration}` : "") +
      ` once we agree.`,
  );
  return lines.join("\n");
}

type Layer = "format" | "pack" | "channel" | null;

export function CreatePanel({
  format,
  runs,
  onClose,
}: {
  format: FormatCard;
  runs?: FormatRuns;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { activeId } = useProjects();
  const { accounts, live } = useVideofastAccounts();
  const utils = trpc.useUtils();

  const [topic, setTopic] = useState("");
  const [extra, setExtra] = useState("");
  const [packId, setPackId] = useState(format.packs[0]);
  const [duration, setDuration] = useState<number | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [open, setOpen] = useState<Layer>(null);
  const [queued, setQueued] = useState<{ id: string; title: string } | null>(null);

  // channels built for this format lead; the strategist channel is the fallback
  const ordered = useMemo(() => {
    const match = accounts.filter((a) => a.format === format.id);
    const rest = accounts.filter((a) => a.format !== format.id);
    return [...match, ...rest];
  }, [accounts, format.id]);
  const account = accountId ?? ordered[0]?.id ?? "";

  const enqueue = trpc.jobs.enqueue.useMutation({
    onSuccess: (job) => {
      utils.jobs.list.invalidate();
      setQueued({ id: job.id, title: job.title });
    },
  });

  const ask = asksFor(format);
  const pack = packById(packId);
  const trimmed = topic.trim();
  const active = runs?.active ?? [];
  // the ack stands only until the queue itself starts reporting the run
  const acking = queued && !active.some((r) => r.id === queued.id) ? queued : null;

  const toggle = (layer: Exclude<Layer, null>) => setOpen((v) => (v === layer ? null : layer));

  const chatWithDirector = () => {
    navigate("/", {
      state: {
        seed: {
          text: directorSeedText(format, packId, account, topic, extra, duration),
          sentAt: Date.now(),
        },
      },
    });
  };

  const createNow = () => {
    if (!trimmed || !account || enqueue.isPending) return;
    setQueued(null);
    enqueue.mutate({
      title: trimmed.length > 44 ? `${trimmed.slice(0, 43)}…` : trimmed,
      kind: "video",
      engine: "videofast",
      priority: "batch",
      detail:
        `${account} · ${format.id} · ${packId}` +
        (duration ? ` · ~${duration}s` : "") +
        " · full pipeline",
      project: activeId ? `/${activeId}` : undefined,
      payload: {
        type: "videofast",
        account,
        topic: trimmed,
        titleHint: ask.extra && extra.trim() ? extra.trim() : undefined,
        format: format.id,
        stylePack: packId,
        durationSec: duration ?? undefined,
      },
    });
  };

  return (
    <aside className="anim-slide-over flex w-panel-lg shrink-0 flex-col border-l hairline bg-[#0e0e10]">
      <div className="relative shrink-0">
        <Poster format={format} className="aspect-[16/9]">
          <div className="absolute inset-x-0 bottom-0 p-4">
            <div className="mb-1.5 h-px w-7 bg-gold" />
            <h2 className="font-serif text-[22px] leading-tight text-[#f6f2ea]">{format.name}</h2>
          </div>
        </Poster>
        <button
          onClick={onClose}
          title="Close"
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-pill bg-ink/60 text-cream/80 backdrop-blur transition hover:text-cream"
        >
          <X size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <section className="space-y-2">
          <SectionLabel>Recipe stack</SectionLabel>
          <RecipeStack>
            <StackRow
              icon={<Layers size={14} />}
              layer="Format"
              contributes="structure & pacing"
              value={format.name}
              open={open === "format"}
              onToggle={() => toggle("format")}
            >
              <p className="px-1 text-xs leading-relaxed text-cream/75">{format.recipe}</p>
              <div className="mt-2 flex flex-wrap items-center gap-y-1.5 px-1">
                {format.stages.map((s, i) => (
                  <span key={s} className="flex items-center">
                    {i > 0 && <ArrowRight size={9} className="mx-1 text-fog/50" />}
                    <span
                      className={cx(
                        "rounded px-1.5 py-0.5 text-2xs",
                        s === "assets" ? "bg-gold/15 text-gold" : "bg-cream/6 text-cream/70",
                      )}
                    >
                      {STAGE_LABELS[s] ?? s}
                    </span>
                  </span>
                ))}
              </div>
              <p className="mt-1.5 px-1 text-2xs leading-relaxed text-fog">
                All of it on your GPU — a finished vertical short typically takes 10–30 minutes and
                lands in your library.
              </p>
            </StackRow>

            <StackRow
              icon={<Palette size={14} />}
              layer="Style pack"
              contributes="the look"
              value={pack.label}
              swatch={`linear-gradient(135deg, ${pack.bg} 55%, ${pack.accent})`}
              open={open === "pack"}
              onToggle={() => toggle("pack")}
            >
              <div className="space-y-1">
                {format.packs.map((id) => {
                  const p = packById(id);
                  return (
                    <button
                      key={id}
                      onClick={() => {
                        setPackId(id);
                        setOpen(null);
                      }}
                      className={cx(
                        "flex w-full items-center gap-2.5 rounded-card border px-2.5 py-1.5 text-left transition",
                        id === packId
                          ? "border-gold/50 bg-gold/8"
                          : "border-transparent bg-surface hover:border-cream/15",
                      )}
                    >
                      <span
                        className="h-5 w-5 shrink-0 rounded-[5px] border border-cream/10"
                        style={{ background: `linear-gradient(135deg, ${p.bg} 55%, ${p.accent})` }}
                      />
                      <span className="flex-1 text-xs text-cream/85">{p.label}</span>
                      <span className="text-2xs text-fog">{p.mode}</span>
                    </button>
                  );
                })}
              </div>
            </StackRow>

            <StackRow
              icon={<Mic2 size={14} />}
              layer="Channel preset"
              contributes="voice & branding"
              value={
                account || (
                  <span className="text-fog">
                    {live ? "None in videofast/accounts" : "Not configured"}
                  </span>
                )
              }
              open={open === "channel"}
              onToggle={() => toggle("channel")}
            >
              {ordered.length > 0 ? (
                <>
                  <select
                    value={account}
                    onChange={(e) => setAccountId(e.target.value)}
                    className={inputCls}
                  >
                    {ordered.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.id}
                        {a.format === format.id ? " · built for this format" : ""} · {a.voice}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-2xs leading-relaxed text-fog">
                    Voice, music bed, prompt tone and CTA come from the channel; the two layers
                    above override its own format and look for this run.
                  </p>
                </>
              ) : (
                <p className="text-xs leading-relaxed text-fog">
                  {live
                    ? "No channel presets found in videofast/accounts."
                    : "Point Settings → Storage at your videofast checkout to load channel presets."}
                </p>
              )}
            </StackRow>
          </RecipeStack>
        </section>

        <section className="space-y-2">
          <SectionLabel>This format asks for:</SectionLabel>
          <div>
            <label className="mb-1 block text-xs text-cream/80">{ask.label}</label>
            <textarea
              rows={3}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={ask.placeholder}
              className={cx(inputCls, "resize-none leading-relaxed")}
            />
          </div>
          {ask.extra && (
            <div>
              <label className="mb-1 block text-xs text-cream/80">{ask.extra.label}</label>
              <input
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                placeholder={ask.extra.placeholder}
                className={inputCls}
              />
            </div>
          )}
          <div className="pt-1">
            <label className="mb-1.5 block text-xs text-cream/80">Duration</label>
            <DurationChips value={duration} onChange={setDuration} />
          </div>
        </section>

        <Disclosure label="How it's built">
          {format.paradigms?.length ? (
            format.paradigms.map((p) => <ParadigmRow key={p} id={p} />)
          ) : (
            <p className="px-1 pt-1 text-xs leading-relaxed text-fog">
              {format.generate === "llm"
                ? "No paradigm menu — the writer composes every scene itself against the style pack."
                : "No writer at all — a deterministic builder lays the video out from your input."}
            </p>
          )}
          <div className="flex items-center gap-2 px-1 pt-1">
            <Chip tone={format.generate === "llm" ? "violet" : "sage"}>
              {format.generate === "llm" ? (
                <>
                  <Bot size={10} /> LLM-written
                </>
              ) : (
                <>
                  <Cpu size={10} /> Deterministic
                </>
              )}
            </Chip>
          </div>
        </Disclosure>

        {active.length > 0 && (
          <section className="space-y-2">
            <SectionLabel right={<span className="text-2xs text-fog">{active.length}</span>}>
              In flight
            </SectionLabel>
            {active.map((run) => (
              <div key={run.id} className="rounded-card border border-cream/10 bg-surface p-2.5">
                <p className="mb-1.5 truncate text-xs text-cream/85">{run.title}</p>
                <RunLine run={run} />
              </div>
            ))}
          </section>
        )}
        {acking && <QueuedNote title={acking.title} />}
        {enqueue.isError && (
          <div className="rounded-card border border-ember/40 bg-ember/8 p-3 text-xs leading-relaxed text-ember">
            {enqueue.error.message}
          </div>
        )}
      </div>

      <CreateFooter
        onCreate={createNow}
        onRefine={chatWithDirector}
        pending={enqueue.isPending}
        disabled={!trimmed || !account}
        disabledReason={
          !account ? "No channel preset configured" : `${ask.label} is empty — the run needs one`
        }
      />
    </aside>
  );
}
