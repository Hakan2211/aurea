import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Blend, Mic2, Palette, X } from "lucide-react";
import { useProjects, useVideofastAccounts, type FormatRuns } from "@/hooks";
import {
  BLEND_PARADIGMS,
  FORMATS,
  NARRATIVE_ARCS,
  /* the full pack roster — a blend isn't bound to one format's shortlist */
  STYLE_PACKS,
  blendParadigmById,
  packById,
} from "@/data/formats";
import { SectionLabel, Slider, cx, inputCls } from "@/components/ui";
import { trpc } from "@/trpc";
import {
  CreateFooter,
  Disclosure,
  DurationChips,
  ParadigmRow,
  PillButton,
  QueuedNote,
  RecipeStack,
  RunLine,
  StackRow,
} from "./shared";

/* Blend — one video, two (or more) visual languages. Same panel grammar as
 * the format create panel: a recipe stack whose top layer is the mix itself,
 * a titled ask block, "Create now" as the primary. Reached from the header
 * action, which is why it no longer needs a tile that vanishes when you
 * filter the gallery. */

type Layer = "mix" | "pack" | "channel" | null;

export function BlendPanel({ runs, onClose }: { runs?: FormatRuns; onClose: () => void }) {
  const navigate = useNavigate();
  const { activeId } = useProjects();
  const { accounts, live } = useVideofastAccounts();
  const utils = trpc.useUtils();

  const [topic, setTopic] = useState("");
  const [dominant, setDominant] = useState("d3Data");
  /** contrasts are uncapped — one is the tuned sweet spot, each extra is
   * busier; the engine accepts any number */
  const [contrasts, setContrasts] = useState<string[]>(["jsx2d"]);
  /** relative weight per contrast (1-10) — splits the non-dominant share */
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [share, setShare] = useState(60);
  const [duration, setDuration] = useState<number | null>(null);
  const [arc, setArc] = useState<(typeof NARRATIVE_ARCS)[number]>("problem-shift-payoff");
  const [metaphor, setMetaphor] = useState("");
  const [hook, setHook] = useState("");
  const [avoidText, setAvoidText] = useState("");
  const [packChoice, setPackChoice] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [open, setOpen] = useState<Layer>("mix");
  const [queued, setQueued] = useState<{ id: string; title: string } | null>(null);

  const domP = blendParadigmById(dominant);
  const conPs = contrasts.map(blendParadigmById);
  // the dominant's home format suggests the pack until the user picks one
  const packId =
    packChoice ?? FORMATS.find((f) => f.id === domP.format)?.packs[0] ?? "noirLuxury";
  const pack = packById(packId);

  const ordered = useMemo(() => {
    const strategist = accounts.filter((a) => a.format === "strategist");
    const rest = accounts.filter((a) => a.format !== "strategist");
    return [...strategist, ...rest];
  }, [accounts]);
  const account = accountId ?? ordered[0]?.id ?? "";

  const enqueue = trpc.jobs.enqueue.useMutation({
    onSuccess: (job) => {
      utils.jobs.list.invalidate();
      setQueued({ id: job.id, title: job.title });
    },
  });

  // contrasts split the non-dominant share by their relative weights (default
  // 1 = equal); adapter renormalizes anyway
  const weightOf = (id: string) => weights[id] ?? 1;
  const weightSum = contrasts.reduce((s, c) => s + weightOf(c), 0);
  const contrastPct = (id: string) =>
    weightSum > 0 ? ((100 - share) * weightOf(id)) / weightSum : 0;
  const mix: Record<string, number> =
    contrasts.length > 0
      ? {
          [dominant]: share / 100,
          ...Object.fromEntries(contrasts.map((c) => [c, contrastPct(c) / 100])),
        }
      : { [dominant]: 1 };
  const avoid = avoidText
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const trimmed = topic.trim();
  const active = runs?.active ?? [];
  const acking = queued && !active.some((r) => r.id === queued.id) ? queued : null;

  const toggle = (layer: Exclude<Layer, null>) => setOpen((v) => (v === layer ? null : layer));

  const pickDominant = (id: string) => {
    setDominant(id);
    setContrasts((prev) => prev.filter((c) => c !== id));
  };

  const toggleContrast = (id: string) => {
    setContrasts((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  /** the mix as the stack row prints it — percentages with plain names */
  const mixSummary =
    contrasts.length > 0
      ? [`${share}% ${domP.label}`, ...conPs.map((p) => `${Math.round(contrastPct(p.id))}% ${p.label}`)].join(
          " · ",
        )
      : `100% ${domP.label}`;

  const mixLabel = (sep: string) =>
    contrasts.length > 0
      ? [
          `${share}% ${domP.label} (${dominant})`,
          ...conPs.map((p) => `${Math.round(contrastPct(p.id))}% ${p.label} (${p.id})`),
        ].join(sep)
      : `100% ${domP.label} (${dominant})`;

  const chatWithDirector = () => {
    const lines = [
      "Format brief from the Formats screen — a custom blend.",
      `Mix: ${mixLabel(" + ")} · style pack ${packId} · channel ${account} · arc ${arc}` +
        (duration ? ` · target ~${duration}s.` : "."),
      ...(metaphor.trim() ? [`Visual metaphor: ${metaphor.trim()}`] : []),
      ...(hook.trim() ? [`Hook: ${hook.trim()}`] : []),
      ...(avoid.length ? [`Avoid: ${avoid.join("; ")}`] : []),
      trimmed
        ? `My topic idea: ${trimmed}`
        : "I don't have a topic yet — pitch me three that suit this blend.",
      `Help me sharpen it (hook, turn, payoff), then launch create_video with paradigmMix ` +
        `${JSON.stringify(mix)}, stylePack "${packId}"` +
        (duration ? `, durationSec ${duration}` : "") +
        ` and narrativeArc "${arc}" once we agree.`,
    ];
    navigate("/", { state: { seed: { text: lines.join("\n"), sentAt: Date.now() } } });
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
        `${account} · blend ${[dominant, ...contrasts].join("+")} · ${packId}` +
        (duration ? ` · ~${duration}s` : ""),
      project: activeId ? `/${activeId}` : undefined,
      payload: {
        type: "videofast",
        account,
        topic: trimmed,
        format: "strategist",
        stylePack: packId,
        durationSec: duration ?? undefined,
        brief: {
          paradigmMix: mix,
          narrativeArc: arc,
          visualMetaphor: metaphor.trim() || undefined,
          hookStrategy: hook.trim() || undefined,
          avoid: avoid.length ? avoid : undefined,
        },
      },
    });
  };

  return (
    <aside className="anim-slide-over flex w-panel-lg shrink-0 flex-col border-l hairline bg-[#0e0e10]">
      <div
        className="relative aspect-[16/7] shrink-0 overflow-hidden"
        style={{ background: "linear-gradient(105deg, #0a0908 0%, #0a0908 46%, #070812 54%, #070812 100%)" }}
      >
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(110% 80% at 12% 100%, ${pack.accent}3a 0%, transparent 55%),
              radial-gradient(100% 80% at 90% 0%, #4fd8ff30 0%, transparent 55%),
              radial-gradient(70% 60% at 85% 90%, #ff4fd824 0%, transparent 55%)`,
          }}
        />
        <Blend
          size={72}
          strokeWidth={0.9}
          className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 text-cream/25"
        />
        <div className="absolute inset-x-0 bottom-0 p-4">
          <div className="mb-1.5 h-px w-7 bg-gold" />
          <h2 className="font-serif text-[22px] leading-tight text-[#f6f2ea]">Blend</h2>
          <p className="mt-1 truncate text-2xs text-cream/70">
            {conPs.length > 0 ? [domP, ...conPs].map((p) => p.label).join(" × ") : domP.label}
          </p>
        </div>
        <button
          onClick={onClose}
          title="Close"
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-pill bg-ink/60 text-cream/80 backdrop-blur transition hover:text-cream"
        >
          <X size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <p className="text-xs leading-relaxed text-cream/75">
          Mix two visual languages inside one video. The dominant owns the recipe and the emotional
          peaks; the contrast breathes between them. Your mix is written into the creative brief the
          scene-writer must obey.
        </p>

        <section className="space-y-2">
          <SectionLabel>Recipe stack</SectionLabel>
          <RecipeStack>
            <StackRow
              icon={<Blend size={14} />}
              layer="Mix"
              contributes="structure & peaks"
              value={mixSummary}
              open={open === "mix"}
              onToggle={() => toggle("mix")}
            >
              <div className="space-y-3 px-1">
                <div>
                  <p className="mb-1.5 text-2xs uppercase tracking-[0.14em] text-fog">Dominant</p>
                  <div className="flex flex-wrap gap-1.5">
                    {BLEND_PARADIGMS.map((p) => (
                      <PillButton
                        key={p.id}
                        title={p.desc}
                        active={p.id === dominant}
                        onClick={() => pickDominant(p.id)}
                      >
                        {p.label}
                      </PillButton>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-1.5 text-2xs uppercase tracking-[0.14em] text-fog">
                    Contrast — any number
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <PillButton active={contrasts.length === 0} onClick={() => setContrasts([])}>
                      None — pure
                    </PillButton>
                    {BLEND_PARADIGMS.filter((p) => p.id !== dominant).map((p) => (
                      <PillButton
                        key={p.id}
                        title={p.desc}
                        active={contrasts.includes(p.id)}
                        onClick={() => toggleContrast(p.id)}
                      >
                        {p.label}
                      </PillButton>
                    ))}
                  </div>
                </div>

                {contrasts.length > 0 && (
                  <div>
                    <Slider min={50} max={90} step={5} value={share} onChange={setShare} />
                    <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-pill">
                      <div className="bg-gold" style={{ width: `${share}%` }} />
                      {contrasts.map((c, i) => (
                        <div
                          key={c}
                          className={i % 2 === 0 ? "bg-cream/30" : "bg-cream/15"}
                          style={{ width: `${contrastPct(c)}%` }}
                        />
                      ))}
                    </div>
                    {contrasts.length >= 2 && (
                      <div className="mt-2.5 space-y-1.5">
                        {conPs.map((p) => (
                          <div key={p.id} className="flex items-center gap-2">
                            <span className="w-24 shrink-0 truncate text-2xs text-cream/70">
                              {p.label}
                            </span>
                            <Slider
                              min={1}
                              max={10}
                              step={1}
                              value={weightOf(p.id)}
                              onChange={(v) => setWeights((prev) => ({ ...prev, [p.id]: v }))}
                              className="min-w-0 flex-1"
                            />
                            <span className="w-8 shrink-0 text-right text-2xs tabular-nums text-fog">
                              {Math.round(contrastPct(p.id))}%
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {contrasts.length === 2 && (
                      <p className="mt-1.5 text-2xs leading-relaxed text-[#e07a6b]">
                        Three-way mixes are experimental — the engine was tuned for two visual
                        languages per short. The first one held together, but it proved the same
                        number three times over. Give each paradigm its own claim.
                      </p>
                    )}
                    {contrasts.length >= 3 && (
                      <p className="mt-1.5 text-2xs leading-relaxed text-[#e07a6b]">
                        {contrasts.length + 1} visual languages in one short: each gets only a scene
                        or two, so it reads as a montage. A longer target duration helps; for real
                        variety, make a series — one mix per video.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </StackRow>

            <StackRow
              icon={<Palette size={14} />}
              layer="Style pack"
              contributes="the look"
              value={
                <>
                  {pack.label}
                  {!packChoice && <span className="text-fog"> · suggested by the dominant</span>}
                </>
              }
              swatch={`linear-gradient(135deg, ${pack.bg} 55%, ${pack.accent})`}
              open={open === "pack"}
              onToggle={() => toggle("pack")}
            >
              <div className="grid grid-cols-6 gap-1.5 px-1">
                {STYLE_PACKS.map((p) => (
                  <button
                    key={p.id}
                    title={p.label}
                    onClick={() => setPackChoice(p.id)}
                    className={cx(
                      "aspect-square rounded-[5px] border transition",
                      p.id === packId
                        ? "border-gold shadow-[0_0_0_1px_rgba(201,169,110,0.5)]"
                        : "border-cream/10 hover:border-cream/30",
                    )}
                    style={{ background: `linear-gradient(135deg, ${p.bg} 55%, ${p.accent})` }}
                  />
                ))}
              </div>
              <p className="mt-1.5 px-1 text-2xs text-fog">
                {pack.label} · {pack.mode}
              </p>
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
                <select
                  value={account}
                  onChange={(e) => setAccountId(e.target.value)}
                  className={inputCls}
                >
                  {ordered.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.id}
                      {a.format === "strategist" ? " · built for blends" : ""} · {a.voice}
                    </option>
                  ))}
                </select>
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
          <SectionLabel>This blend asks for:</SectionLabel>
          <div>
            <label className="mb-1 block text-xs text-cream/80">Topic</label>
            <textarea
              rows={3}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="What should this video be about? Leave empty and the Director will pitch ideas."
              className={cx(inputCls, "resize-none leading-relaxed")}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-cream/80">Narrative arc</label>
            <div className="flex flex-wrap gap-1.5">
              {NARRATIVE_ARCS.map((a) => (
                <PillButton key={a} active={arc === a} onClick={() => setArc(a)}>
                  {a}
                </PillButton>
              ))}
            </div>
          </div>
          <div className="pt-1">
            <label className="mb-1.5 block text-xs text-cream/80">Duration</label>
            <DurationChips value={duration} onChange={setDuration} />
          </div>
        </section>

        <Disclosure label="Art direction — optional">
          <div className="space-y-2 pt-1">
            <input
              value={metaphor}
              onChange={(e) => setMetaphor(e.target.value)}
              placeholder="Visual metaphor — e.g. a rusted padlock snapping open"
              className={inputCls}
            />
            <input
              value={hook}
              onChange={(e) => setHook(e.target.value)}
              placeholder="Hook strategy — how the first two seconds grab"
              className={inputCls}
            />
            <input
              value={avoidText}
              onChange={(e) => setAvoidText(e.target.value)}
              placeholder="Avoid — comma-separated worn-out images"
              className={inputCls}
            />
            <p className="text-2xs leading-relaxed text-fog">
              Anything left blank the AI decides at write time.
            </p>
          </div>
        </Disclosure>

        <Disclosure label="How it's built">
          {[dominant, ...contrasts].map((p) => (
            <ParadigmRow key={p} id={p} />
          ))}
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
          !account ? "No channel preset configured" : "The blend needs a topic to write about"
        }
      />
    </aside>
  );
}
