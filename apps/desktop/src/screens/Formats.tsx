import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  ArrowRight,
  Blend,
  Bot,
  CheckCircle2,
  Cpu,
  Loader2,
  MessagesSquare,
  Play,
  Rocket,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useFormats, useProjects, useVideofastAccounts } from "@/hooks";
import {
  BLEND_PARADIGMS,
  CATEGORIES,
  FORMATS,
  NARRATIVE_ARCS,
  STAGE_LABELS,
  STYLE_PACKS,
  blendParadigmById,
  packById,
  type FormatCard,
} from "@/data/formats";
import { Chip, GhostButton, GoldButton, cx } from "@/components/ui";
import { trpc } from "@/trpc";

/* Formats gallery — the videofast recipes, live. Pick a format, give it a
 * topic, pin a style pack and channel preset, then either hand the brief to
 * the Director chat (it sharpens the idea and launches create_video) or
 * enqueue the full pipeline directly. */

/* ---------- poster ---------- */

/** Poster art: a real still from public/formats/<id>.jpg when present,
 * otherwise the format's first style pack paints a palette poster. */
function Poster({ format, className }: { format: FormatCard; className?: string }) {
  const pack = packById(format.packs[0]);
  const dark = pack.mode === "dark";
  const [art, setArt] = useState(true);
  return (
    <div
      className={cx("relative overflow-hidden", className)}
      style={{ backgroundColor: pack.bg }}
    >
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(120% 90% at 20% 110%, ${pack.accent}33 0%, transparent 55%),
            radial-gradient(90% 70% at 85% -10%, ${pack.accentAlt}26 0%, transparent 50%)`,
        }}
      />
      {art && (
        <img
          src={`formats/${format.id}.jpg`}
          alt=""
          onError={() => setArt(false)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {art && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
      )}
      <div className="absolute inset-0 flex flex-col justify-end p-4">
        <div className="mb-2 h-px w-8" style={{ backgroundColor: pack.accent }} />
        <p
          className="font-serif text-[19px] leading-snug"
          style={{ color: art || dark ? "#f3efe7" : "#1c1914" }}
        >
          {format.poster}
        </p>
      </div>
      <span
        className="absolute left-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide"
        style={{
          backgroundColor: art || dark ? "#00000055" : "#ffffff88",
          color: art || dark ? "#f3efe7cc" : "#1c1914cc",
        }}
      >
        {pack.label}
      </span>
    </div>
  );
}

/* ---------- card ---------- */

function FormatTile({
  format,
  selected,
  onSelect,
}: {
  format: FormatCard;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cx(
        "group flex flex-col overflow-hidden rounded-2xl border text-left transition",
        selected
          ? "border-gold/70 shadow-[0_0_0_1px_rgba(201,169,110,0.35)]"
          : "border-cream/8 hover:border-gold/35",
      )}
    >
      <div className="relative">
        <Poster format={format} className="aspect-[4/5]" />
        <div
          className={cx(
            "absolute inset-x-0 bottom-0 flex justify-center pb-4 transition",
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-gold to-gold-deep px-3 py-1.5 text-[12px] font-semibold text-ink">
            Use format
          </span>
        </div>
        {format.featured && (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-gold px-2 py-0.5 text-[10px] font-semibold text-ink">
            <Sparkles size={10} /> Meta
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 bg-surface px-3.5 py-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-cream">{format.name}</div>
          <div className="mt-0.5 truncate text-[11px] text-fog">{format.tagline}</div>
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cream/12 text-cream/70 transition group-hover:border-gold/50 group-hover:text-gold">
          <Play size={12} className="ml-0.5" />
        </span>
      </div>
    </button>
  );
}

/* ---------- blend ---------- */

const BLEND_ID = "__blend";

/** gallery card for the custom blend — split-palette art, no poster file */
function BlendTile({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={cx(
        "group flex flex-col overflow-hidden rounded-2xl border text-left transition",
        selected
          ? "border-gold/70 shadow-[0_0_0_1px_rgba(201,169,110,0.35)]"
          : "border-cream/8 hover:border-gold/35",
      )}
    >
      <div className="relative">
        <div
          className="relative aspect-[4/5] overflow-hidden"
          style={{ background: "linear-gradient(105deg, #0a0908 0%, #0a0908 46%, #070812 54%, #070812 100%)" }}
        >
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(110% 80% at 12% 100%, #d4af6a3a 0%, transparent 55%),
                radial-gradient(100% 80% at 90% 0%, #4fd8ff30 0%, transparent 55%),
                radial-gradient(70% 60% at 85% 90%, #ff4fd824 0%, transparent 55%)`,
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <Blend size={44} className="text-cream/80" strokeWidth={1.25} />
          </div>
          <div className="absolute inset-x-0 bottom-0 flex flex-col p-4">
            <div className="mb-2 h-px w-8 bg-gold" />
            <p className="font-serif text-[19px] leading-snug text-[#f3efe7]">
              One video. Two formats.
            </p>
          </div>
          <div
            className={cx(
              "absolute inset-x-0 bottom-0 flex justify-center pb-4 transition",
              selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-gold to-gold-deep px-3 py-1.5 text-[12px] font-semibold text-ink">
              Mix formats
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 bg-surface px-3.5 py-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-cream">Blend</div>
          <div className="mt-0.5 truncate text-[11px] text-fog">
            Pick a dominant + a contrast — your mix becomes law.
          </div>
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cream/12 text-cream/70 transition group-hover:border-gold/50 group-hover:text-gold">
          <Blend size={13} />
        </span>
      </div>
    </button>
  );
}

function ParadigmChip({
  id,
  active,
  dim,
  onClick,
}: {
  id: string;
  active: boolean;
  dim?: boolean;
  onClick: () => void;
}) {
  const p = blendParadigmById(id);
  return (
    <button
      onClick={onClick}
      title={p.desc}
      disabled={dim}
      className={cx(
        "rounded-full border px-2.5 py-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-30",
        active
          ? "border-gold/60 bg-gold/12 text-gold"
          : "border-cream/10 text-cream/70 hover:border-gold/35 hover:text-cream",
      )}
    >
      {p.label}
    </button>
  );
}

/** target-runtime picker — Auto defers to the channel preset (else the
 * writer's natural 25-45s); a number scales word budget + scene count */
const DURATIONS = [30, 45, 60, 90, 180, 300] as const;

/** chips read as minutes once a target passes a minute — "180s" scans slower */
const durationLabel = (d: number) => (d >= 120 ? `${d / 60}m` : `${d}s`);

function DurationChips({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {[null, ...DURATIONS].map((d) => (
          <button
            key={d ?? "auto"}
            onClick={() => onChange(d)}
            className={cx(
              "rounded-full border px-2.5 py-1 text-[11px] transition",
              value === d
                ? "border-gold/60 bg-gold/12 text-gold"
                : "border-cream/10 text-cream/70 hover:border-gold/35 hover:text-cream",
            )}
          >
            {d === null ? "Auto" : durationLabel(d)}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-fog">
        {value === null
          ? "Auto — the channel preset decides, else the writer's natural 25-45s."
          : `Script and scene count scale to ~${durationLabel(value)}; the render lands within ~±15% (narration rules the clock).` +
            (value >= 180 ? " Long-form: expect a proportionally longer write and render." : "")}
      </p>
    </>
  );
}

function BlendPanel({ onClose }: { onClose: () => void }) {
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

  const pickDominant = (id: string) => {
    setDominant(id);
    setContrasts((prev) => prev.filter((c) => c !== id));
  };

  const toggleContrast = (id: string) => {
    setContrasts((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  const mixLabel = (sep: string) =>
    contrasts.length > 0
      ? [
          `${share}% ${domP.label} (${dominant})`,
          ...conPs.map((p) => `${Math.round(contrastPct(p.id))}% ${p.label} (${p.id})`),
        ].join(sep)
      : `100% ${domP.label} (${dominant})`;

  const chatWithDirector = () => {
    const mixLine = mixLabel(" + ");
    const lines = [
      "Format brief from the Formats screen — a custom blend.",
      `Mix: ${mixLine} · style pack ${packId} · channel ${account} · arc ${arc}` +
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
    <aside className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-l hairline bg-[#0e0e10]">
      <div
        className="relative aspect-[16/7] shrink-0 overflow-hidden"
        style={{ backgroundColor: pack.bg }}
      >
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(120% 90% at 15% 110%, ${pack.accent}40 0%, transparent 55%),
              radial-gradient(90% 70% at 88% -10%, ${pack.accentAlt}30 0%, transparent 50%)`,
          }}
        />
        <div className="absolute inset-0 flex items-end p-4">
          <div>
            <div className="mb-2 h-px w-8" style={{ backgroundColor: pack.accent }} />
            <p
              className="font-serif text-[19px] leading-snug"
              style={{ color: pack.mode === "dark" ? "#f3efe7" : "#1c1914" }}
            >
              {conPs.length > 0 ? [domP, ...conPs].map((p) => p.label).join(" × ") : domP.label}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-ink/60 text-cream/80 backdrop-blur transition hover:text-cream"
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex-1 space-y-5 p-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-serif text-[20px] text-cream">Blend</h2>
            <Chip tone="violet">
              <Blend size={10} /> Custom mix
            </Chip>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-cream/75">
            Mix two formats inside one video. The dominant owns the recipe and the emotional
            peaks; the contrast breathes between them. Your mix is written into the creative
            brief the scene-writer must obey.
          </p>
        </div>

        <section>
          <SectionLabel>Topic</SectionLabel>
          <textarea
            rows={3}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="What should this video be about? Leave empty and the Director will pitch ideas."
            className="mt-2 w-full resize-none rounded-xl border border-cream/10 bg-surface px-3 py-2.5 text-[12px] leading-relaxed text-cream placeholder:text-fog/70 transition focus:border-gold/40 focus:outline-none"
          />
        </section>

        <section>
          <SectionLabel>Dominant</SectionLabel>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {BLEND_PARADIGMS.map((p) => (
              <ParadigmChip
                key={p.id}
                id={p.id}
                active={p.id === dominant}
                onClick={() => pickDominant(p.id)}
              />
            ))}
          </div>
        </section>

        <section>
          <SectionLabel>Contrast — any number</SectionLabel>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              onClick={() => setContrasts([])}
              className={cx(
                "rounded-full border px-2.5 py-1 text-[11px] transition",
                contrasts.length === 0
                  ? "border-gold/60 bg-gold/12 text-gold"
                  : "border-cream/10 text-cream/70 hover:border-gold/35 hover:text-cream",
              )}
            >
              None — pure
            </button>
            {BLEND_PARADIGMS.filter((p) => p.id !== dominant).map((p) => (
              <ParadigmChip
                key={p.id}
                id={p.id}
                active={contrasts.includes(p.id)}
                onClick={() => toggleContrast(p.id)}
              />
            ))}
          </div>
          {contrasts.length > 0 && (
            <div className="mt-3">
              <input
                type="range"
                min={50}
                max={90}
                step={5}
                value={share}
                onChange={(e) => setShare(Number(e.target.value))}
                className="w-full accent-[#c9a96e]"
              />
              <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full">
                <div className="bg-gold" style={{ width: `${share}%` }} />
                {contrasts.map((c, i) => (
                  <div
                    key={c}
                    className={i % 2 === 0 ? "bg-cream/30" : "bg-cream/15"}
                    style={{ width: `${contrastPct(c)}%` }}
                  />
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-fog">
                <span className="text-gold">{share}% {domP.label}</span>
                {conPs.map((p) => (
                  <span key={p.id} className="text-cream/70">
                    {" · "}
                    {Math.round(contrastPct(p.id))}% {p.label}
                  </span>
                ))}
              </p>
              {contrasts.length >= 2 && (
                <div className="mt-2.5 space-y-1.5">
                  {conPs.map((p) => (
                    <div key={p.id} className="flex items-center gap-2">
                      <span className="w-24 shrink-0 truncate text-[10px] text-cream/70">
                        {p.label}
                      </span>
                      <input
                        type="range"
                        min={1}
                        max={10}
                        step={1}
                        value={weightOf(p.id)}
                        onChange={(e) =>
                          setWeights((prev) => ({ ...prev, [p.id]: Number(e.target.value) }))
                        }
                        className="min-w-0 flex-1 accent-[#c9a96e]"
                      />
                      <span className="w-8 shrink-0 text-right text-[10px] text-fog">
                        {Math.round(contrastPct(p.id))}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {contrasts.length === 2 && (
                <p className="mt-1.5 text-[10px] leading-relaxed text-ember/80">
                  Three-way mixes are experimental — the engine was tuned for two visual
                  languages per short. The first one held together, but it proved the same
                  number three times over. Give each paradigm its own claim below.
                </p>
              )}
              {contrasts.length >= 3 && (
                <p className="mt-1.5 text-[10px] leading-relaxed text-ember/80">
                  {contrasts.length + 1} visual languages in one short: each gets only a scene
                  or two, so it reads as a montage. A longer target duration helps; for real
                  variety, make a series — one mix per video.
                </p>
              )}
            </div>
          )}
        </section>

        <section>
          <SectionLabel>Narrative arc</SectionLabel>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {NARRATIVE_ARCS.map((a) => (
              <button
                key={a}
                onClick={() => setArc(a)}
                className={cx(
                  "rounded-full border px-2.5 py-1 text-[11px] transition",
                  arc === a
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
          <SectionLabel>Duration</SectionLabel>
          <DurationChips value={duration} onChange={setDuration} />
        </section>

        <section>
          <SectionLabel>Art direction — optional</SectionLabel>
          <input
            value={metaphor}
            onChange={(e) => setMetaphor(e.target.value)}
            placeholder="Visual metaphor — e.g. a rusted padlock snapping open"
            className="mt-2 w-full rounded-xl border border-cream/10 bg-surface px-3 py-2 text-[12px] text-cream placeholder:text-fog/70 transition focus:border-gold/40 focus:outline-none"
          />
          <input
            value={hook}
            onChange={(e) => setHook(e.target.value)}
            placeholder="Hook strategy — how the first two seconds grab"
            className="mt-2 w-full rounded-xl border border-cream/10 bg-surface px-3 py-2 text-[12px] text-cream placeholder:text-fog/70 transition focus:border-gold/40 focus:outline-none"
          />
          <input
            value={avoidText}
            onChange={(e) => setAvoidText(e.target.value)}
            placeholder="Avoid — comma-separated worn-out images"
            className="mt-2 w-full rounded-xl border border-cream/10 bg-surface px-3 py-2 text-[12px] text-cream placeholder:text-fog/70 transition focus:border-gold/40 focus:outline-none"
          />
          <p className="mt-1.5 text-[10px] leading-relaxed text-fog">
            Anything left blank the AI decides at write time.
          </p>
        </section>

        <section>
          <SectionLabel>Style pack</SectionLabel>
          <div className="mt-2 grid grid-cols-6 gap-1.5">
            {STYLE_PACKS.map((p) => (
              <button
                key={p.id}
                title={p.label}
                onClick={() => setPackChoice(p.id)}
                className={cx(
                  "aspect-square rounded-lg border transition",
                  p.id === packId
                    ? "border-gold shadow-[0_0_0_1px_rgba(201,169,110,0.5)]"
                    : "border-cream/10 hover:border-cream/30",
                )}
                style={{ background: `linear-gradient(135deg, ${p.bg} 55%, ${p.accent})` }}
              />
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-fog">
            {pack.label} · {pack.mode}
            {!packChoice && " · suggested by the dominant"}
          </p>
        </section>

        <section>
          <SectionLabel>Channel preset</SectionLabel>
          {ordered.length > 0 ? (
            <select
              value={account}
              onChange={(e) => setAccountId(e.target.value)}
              className="mt-2 w-full rounded-xl border border-cream/10 bg-surface px-3 py-2 text-[12px] text-cream transition focus:border-gold/40 focus:outline-none"
            >
              {ordered.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id}
                  {a.format === "strategist" ? " · built for blends" : ""} · {a.voice}
                </option>
              ))}
            </select>
          ) : (
            <p className="mt-2 text-[11px] leading-relaxed text-fog">
              {live
                ? "No channel presets found in videofast/accounts."
                : "Point Settings → Storage at your videofast checkout to load channel presets."}
            </p>
          )}
        </section>

        {queued && (
          <div className="rounded-xl border border-gold/40 bg-gold/8 p-3">
            <div className="flex items-center gap-2 text-[12px] text-cream">
              <CheckCircle2 size={14} className="shrink-0 text-gold" />
              <span className="min-w-0 flex-1 truncate">“{queued.title}” is in the queue.</span>
            </div>
            <button
              onClick={() => navigate("/jobs")}
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-gold transition hover:brightness-110"
            >
              Watch it in Jobs <ArrowRight size={11} />
            </button>
          </div>
        )}
        {enqueue.isError && (
          <div className="rounded-xl border border-ember/40 bg-ember/8 p-3 text-[11px] leading-relaxed text-ember">
            {enqueue.error.message}
          </div>
        )}
      </div>

      <div className="space-y-2 border-t hairline p-4">
        <GoldButton onClick={chatWithDirector} className="w-full justify-center">
          <MessagesSquare size={12} /> Chat with the Director
        </GoldButton>
        <GhostButton
          onClick={createNow}
          disabled={!trimmed || !account || enqueue.isPending}
          className="w-full justify-center"
        >
          {enqueue.isPending ? (
            <>
              <Loader2 size={12} className="animate-spin" /> Queueing…
            </>
          ) : (
            <>
              <Rocket size={12} /> Create now — skip the chat
            </>
          )}
        </GhostButton>
      </div>
    </aside>
  );
}

/* ---------- create panel ---------- */

/** the message the Director chat opens with — enough context to advise AND
 * the exact create_video knobs to launch with once the topic is agreed */
function directorSeedText(
  format: FormatCard,
  packId: string,
  accountId: string,
  topic: string,
  attribution: string,
  duration: number | null,
) {
  const lines = [
    `Format brief from the Formats screen — ${format.name} (${format.id}), style pack ${packId}` +
      (accountId ? `, channel ${accountId}` : "") +
      (duration ? `, target ~${duration}s.` : "."),
    `The recipe: ${format.tagline}`,
    topic.trim()
      ? `My topic idea: ${topic.trim()}`
      : "I don't have a topic yet — pitch me three strong ones for this format.",
  ];
  if (format.id === "quote" && attribution.trim()) {
    lines.push(`Attribution: ${attribution.trim()}`);
  }
  lines.push(
    `Help me sharpen this into one strong short (hook, turn, payoff), then launch create_video ` +
      `with format "${format.id}", stylePack "${packId}"` +
      (duration ? ` and durationSec ${duration}` : "") +
      ` once we agree.`,
  );
  return lines.join("\n");
}

function CreatePanel({ format, onClose }: { format: FormatCard; onClose: () => void }) {
  const navigate = useNavigate();
  const { activeId } = useProjects();
  const { accounts, live } = useVideofastAccounts();
  const utils = trpc.useUtils();

  const [topic, setTopic] = useState("");
  const [attribution, setAttribution] = useState("");
  const [packId, setPackId] = useState(format.packs[0]);
  const [duration, setDuration] = useState<number | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
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

  const isQuote = format.id === "quote";
  const trimmed = topic.trim();

  const chatWithDirector = () => {
    navigate("/", {
      state: {
        seed: {
          text: directorSeedText(format, packId, account, topic, attribution, duration),
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
        titleHint: isQuote && attribution.trim() ? attribution.trim() : undefined,
        format: format.id,
        stylePack: packId,
        durationSec: duration ?? undefined,
      },
    });
  };

  return (
    <aside className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-l hairline bg-[#0e0e10]">
      <div className="relative">
        <Poster format={format} className="aspect-[16/10]" />
        <button
          onClick={onClose}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-ink/60 text-cream/80 backdrop-blur transition hover:text-cream"
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex-1 space-y-5 p-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-serif text-[20px] text-cream">{format.name}</h2>
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
          <p className="mt-2 text-[12px] leading-relaxed text-cream/75">{format.recipe}</p>
        </div>

        <section>
          <SectionLabel>{isQuote ? "The quote" : "Topic"}</SectionLabel>
          <textarea
            rows={3}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={
              isQuote
                ? "“We suffer more in imagination than in reality.”"
                : "What should this video be about? Leave empty and the Director will pitch ideas."
            }
            className="mt-2 w-full resize-none rounded-xl border border-cream/10 bg-surface px-3 py-2.5 text-[12px] leading-relaxed text-cream placeholder:text-fog/70 transition focus:border-gold/40 focus:outline-none"
          />
          {isQuote && (
            <input
              value={attribution}
              onChange={(e) => setAttribution(e.target.value)}
              placeholder="Attribution — Seneca"
              className="mt-2 w-full rounded-xl border border-cream/10 bg-surface px-3 py-2 text-[12px] text-cream placeholder:text-fog/70 transition focus:border-gold/40 focus:outline-none"
            />
          )}
        </section>

        <section>
          <SectionLabel>Style pack</SectionLabel>
          <div className="mt-2 space-y-1.5">
            {format.packs.map((id) => {
              const pack = packById(id);
              const active = id === packId;
              return (
                <button
                  key={id}
                  onClick={() => setPackId(id)}
                  className={cx(
                    "flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition",
                    active
                      ? "border-gold/60 bg-gold/8"
                      : "border-transparent bg-surface hover:border-cream/15",
                  )}
                >
                  <span
                    className="h-5 w-5 shrink-0 rounded-md border border-cream/10"
                    style={{
                      background: `linear-gradient(135deg, ${pack.bg} 55%, ${pack.accent})`,
                    }}
                  />
                  <span className="flex-1 text-[12px] text-cream/85">{pack.label}</span>
                  <span className="text-[10px] text-fog">{pack.mode}</span>
                  {active && <CheckCircle2 size={13} className="text-gold" />}
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <SectionLabel>Duration</SectionLabel>
          <DurationChips value={duration} onChange={setDuration} />
        </section>

        <section>
          <SectionLabel>Channel preset</SectionLabel>
          {ordered.length > 0 ? (
            <>
              <select
                value={account}
                onChange={(e) => setAccountId(e.target.value)}
                className="mt-2 w-full rounded-xl border border-cream/10 bg-surface px-3 py-2 text-[12px] text-cream transition focus:border-gold/40 focus:outline-none"
              >
                {ordered.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.id}
                    {a.format === format.id ? " · built for this format" : ""} · {a.voice}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[10px] leading-relaxed text-fog">
                Voice, music bed, prompt tone and CTA come from the channel; this format and style
                pack override its recipe for the run.
              </p>
            </>
          ) : (
            <p className="mt-2 text-[11px] leading-relaxed text-fog">
              {live
                ? "No channel presets found in videofast/accounts."
                : "Point Settings → Storage at your videofast checkout to load channel presets."}
            </p>
          )}
        </section>

        {format.paradigms && (
          <section>
            <SectionLabel>Paradigms</SectionLabel>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {format.paradigms.map((p) => (
                <Chip key={p} tone="muted">
                  {p}
                </Chip>
              ))}
            </div>
          </section>
        )}

        <section>
          <SectionLabel>Pipeline</SectionLabel>
          <div className="mt-2 flex flex-wrap items-center gap-y-1.5">
            {format.stages.map((s, i) => (
              <span key={s} className="flex items-center">
                {i > 0 && <ArrowRight size={9} className="mx-1 text-fog/50" />}
                <span
                  className={cx(
                    "rounded px-1.5 py-0.5 text-[10px]",
                    s === "assets" ? "bg-gold/15 text-gold" : "bg-cream/6 text-cream/70",
                  )}
                >
                  {STAGE_LABELS[s] ?? s}
                </span>
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-fog">
            Script → voiceover → music → render → covers, all on your GPU. A finished vertical
            short typically takes 10–30 minutes and lands in your library.
          </p>
        </section>

        {queued && (
          <div className="rounded-xl border border-gold/40 bg-gold/8 p-3">
            <div className="flex items-center gap-2 text-[12px] text-cream">
              <CheckCircle2 size={14} className="shrink-0 text-gold" />
              <span className="min-w-0 flex-1 truncate">“{queued.title}” is in the queue.</span>
            </div>
            <button
              onClick={() => navigate("/jobs")}
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-gold transition hover:brightness-110"
            >
              Watch it in Jobs <ArrowRight size={11} />
            </button>
          </div>
        )}
        {enqueue.isError && (
          <div className="rounded-xl border border-ember/40 bg-ember/8 p-3 text-[11px] leading-relaxed text-ember">
            {enqueue.error.message}
          </div>
        )}
      </div>

      <div className="space-y-2 border-t hairline p-4">
        <GoldButton onClick={chatWithDirector} className="w-full justify-center">
          <MessagesSquare size={12} /> Chat with the Director
        </GoldButton>
        <GhostButton
          onClick={createNow}
          disabled={!trimmed || !account || enqueue.isPending}
          className="w-full justify-center"
        >
          {enqueue.isPending ? (
            <>
              <Loader2 size={12} className="animate-spin" /> Queueing…
            </>
          ) : (
            <>
              <Rocket size={12} /> Create now — skip the chat
            </>
          )}
        </GhostButton>
      </div>
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">{children}</h3>
  );
}

/* ---------- screen ---------- */

export function Formats() {
  const navigate = useNavigate();
  const { formats } = useFormats();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]["id"]>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return formats.filter(
      (f) =>
        (category === "all" || f.category === category) &&
        (!q ||
          f.name.toLowerCase().includes(q) ||
          f.tagline.toLowerCase().includes(q) ||
          f.recipe.toLowerCase().includes(q)),
    );
  }, [formats, category, query]);

  const selected = formats.find((f) => f.id === selectedId) ?? null;

  const createWithAi = () => {
    navigate("/", {
      state: {
        seed: {
          text:
            "I want to make a social-media short but haven't picked a format yet. " +
            "Walk me through the videofast formats, help me match one to my idea, " +
            "then launch create_video once we've agreed on a topic and style pack.",
          sentAt: Date.now(),
        },
      },
    });
  };

  return (
    <div className="flex h-full">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b hairline px-6 py-4">
          <h1 className="font-serif text-[26px] text-cream">Formats</h1>
          <span className="text-[11px] text-fog">
            {formats.length} recipes · 12 style packs
          </span>

          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-2 rounded-lg border border-cream/10 bg-surface px-3 py-1.5 transition focus-within:border-gold/40">
              <Search size={13} className="text-fog" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search formats…"
                className="w-44 bg-transparent text-[12px] text-cream placeholder:text-fog focus:outline-none"
              />
            </label>
            <GoldButton onClick={createWithAi}>
              <Sparkles size={12} /> Create with AI
            </GoldButton>
          </div>
        </header>

        <div className="flex items-center gap-2 px-6 py-3">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={cx(
                "rounded-full border px-3 py-1 text-[12px] transition",
                category === c.id
                  ? "border-gold/60 bg-gold/12 text-gold"
                  : "border-cream/10 text-cream/70 hover:border-gold/35 hover:text-cream",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {visible.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <p className="text-[13px] text-cream/70">No formats match “{query}”.</p>
              <p className="text-[11px] text-fog">Try a paradigm — “manim”, “parallax”, “chart”.</p>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
              {category === "all" && !query.trim() && (
                <BlendTile
                  selected={selectedId === BLEND_ID}
                  onSelect={() => setSelectedId(selectedId === BLEND_ID ? null : BLEND_ID)}
                />
              )}
              {visible.map((f) => (
                <FormatTile
                  key={f.id}
                  format={f}
                  selected={f.id === selectedId}
                  onSelect={() => setSelectedId(f.id === selectedId ? null : f.id)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {selectedId === BLEND_ID ? (
        <BlendPanel onClose={() => setSelectedId(null)} />
      ) : (
        selected && (
          <CreatePanel key={selected.id} format={selected} onClose={() => setSelectedId(null)} />
        )
      )}
    </div>
  );
}
