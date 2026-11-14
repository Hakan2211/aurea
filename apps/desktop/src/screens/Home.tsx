/* Home — where Aurea opens (UI-SIMPLIFY-PLAN.md Stage 1, decision A).
 *
 * One question answered first: what should I do next? The "continue" card
 * picks the active project's furthest-from-done episode and names ONE next
 * step from its shots' derived stages (shotStage): review rendered takes →
 * board unboarded shots → write the script → assemble. Below it: quick create,
 * latest renders, and the project list. Nothing here is new data — it is a
 * read of production, jobs and the library the other screens already use. */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, Box, Clapperboard, Image, Mic, Music, Plus } from "lucide-react";
import { shotStage, type ShotStage } from "@aurea/shared";
import { useAssets, useJobs, useProduction, useProjects } from "@/hooks";
import { cx } from "@/components/ui";
import { useDirector } from "@/components/DirectorPanel";

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? "Working late." : h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening.";
};

const STAGE_COLOR: Record<ShotStage, string> = {
  script: "bg-cream/10",
  voiced: "bg-cream/25",
  boarded: "bg-gold/40",
  rendered: "bg-gold",
  approved: "bg-sage",
};
const STAGE_LABEL: Record<ShotStage, string> = {
  script: "Script only",
  voiced: "Voiced",
  boarded: "Boarded",
  rendered: "Rendered, needs review",
  approved: "Approved",
};

const pad2 = (n: number) => String(n).padStart(2, "0");

const QUICK = [
  { tab: "image", label: "Image", hint: "Stills, characters, keyframes", icon: Image },
  { tab: "video", label: "Video", hint: "Animate a frame or a prompt", icon: Clapperboard },
  { tab: "voice", label: "Voice", hint: "Lines in a cast voice", icon: Mic },
  { tab: "music", label: "Music", hint: "Beds, stings, themes", icon: Music },
  { tab: "3d", label: "3D", hint: "Props and sets", icon: Box },
];

function ContinueCard() {
  const navigate = useNavigate();
  const director = useDirector();
  const prod = useProduction();
  const { active } = useProjects();

  const summary = useMemo(() => {
    const eps = (prod.production?.seasons ?? []).flatMap((season) =>
      season.episodes.map((episode) => {
        const shots = episode.scenes.flatMap((s) => s.shots);
        const stages = shots.map((s) => shotStage(s));
        const count = (st: ShotStage) => stages.filter((x) => x === st).length;
        return {
          season,
          episode,
          stages,
          total: shots.length,
          approved: count("approved"),
          review: count("rendered"),
          unboarded: count("script") + count("voiced"),
        };
      }),
    );
    // the episode to continue: first one that isn't fully approved, else the last
    return eps.find((e) => e.total === 0 || e.approved < e.total) ?? eps[eps.length - 1] ?? null;
  }, [prod.production]);

  if (!prod.production) {
    return (
      <section className="rounded-[18px] border border-cream/8 bg-surface p-7">
        <p className="text-sm text-fog">
          The studio core is starting. Your episodes appear here as soon as it answers.
        </p>
      </section>
    );
  }

  if (!summary) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-6 rounded-[18px] border border-cream/10 bg-surface p-7">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gold">Start</p>
          <h2 className="mt-1 font-serif text-2xl text-cream">
            {active?.name ?? "This project"} has no episodes yet
          </h2>
          <p className="mt-1 text-base text-fog">
            Write one yourself, or describe the idea and let the Director draft it.
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <PrimaryButton
            onClick={() =>
              director.openWith("Help me plan a new episode: logline, scenes, and a shot list.")
            }
          >
            Plan an episode with the Director
          </PrimaryButton>
          <SecondaryButton onClick={() => navigate("/story/script")}>Write the script</SecondaryButton>
        </div>
      </section>
    );
  }

  const { season, episode, stages, total, approved, review, unboarded } = summary;
  const code = `S${pad2(season.number)}E${pad2(episode.number)}`;
  const next =
    total === 0
      ? { label: "Write the script", to: "/story/script" }
      : review > 0
        ? { label: `Review ${review} new take${review === 1 ? "" : "s"}`, to: `/story/episodes/${episode.id}` }
        : unboarded > 0
          ? { label: `Board ${unboarded} shot${unboarded === 1 ? "" : "s"}`, to: "/story/board" }
          : approved < total
            ? { label: "Render the boarded shots", to: `/story/episodes/${episode.id}` }
            : { label: "Assemble in the timeline", to: "/edit/timeline" };
  const pct = total ? Math.round((approved / total) * 100) : 0;

  return (
    <section className="flex flex-col gap-6 rounded-[18px] border border-cream/10 bg-surface p-7">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gold">Continue</p>
          <h2 className="mt-1 truncate font-serif text-[28px] leading-tight text-cream">
            {code} — {episode.title || "Untitled"}
          </h2>
          <p className="mt-1 text-base text-fog">
            {total === 0
              ? "No shots yet"
              : `${approved} of ${total} shots approved${review ? ` · ${review} waiting for you` : ""}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <PrimaryButton onClick={() => navigate(next.to)}>
            {next.label} <ArrowRight size={16} />
          </PrimaryButton>
          <SecondaryButton onClick={() => navigate("/story/board")}>Open the board</SecondaryButton>
        </div>
      </div>

      {total > 0 && (
        <div className="flex flex-col gap-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-cream/8">
            <div className="h-full rounded-full bg-sage" style={{ width: `${pct}%` }} />
          </div>
          {/* the episode at a glance: one tick per shot, coloured by stage */}
          <div className="flex flex-wrap gap-1" aria-label="Shots by stage">
            {stages.map((st, i) => (
              <span
                key={i}
                title={`Shot ${i + 1}: ${STAGE_LABEL[st]}`}
                className={cx("h-3 w-5 rounded-sm", STAGE_COLOR[st])}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fog">
            {(["script", "boarded", "rendered", "approved"] as ShotStage[]).map((st) => (
              <span key={st} className="flex items-center gap-1.5">
                <span className={cx("h-2 w-3 rounded-sm", STAGE_COLOR[st])} />
                {STAGE_LABEL[st]}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function PrimaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-11 items-center gap-2 rounded-xl bg-gold px-5 text-[15px] font-semibold text-ink transition hover:bg-[#d8b97f]"
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-11 items-center gap-2 rounded-xl border border-cream/15 px-5 text-[15px] text-cream transition hover:bg-cream/5"
    >
      {children}
    </button>
  );
}

function RenderingNow() {
  const { jobs } = useJobs();
  const running = jobs.filter((j) => j.status === "running").slice(0, 3);
  if (running.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-cream">Rendering now</h2>
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3">
        {running.map((j) => (
          <li key={j.id} className="flex flex-col gap-2 rounded-xl border border-cream/8 bg-surface p-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm font-medium text-cream">{j.title}</span>
              <span className="shrink-0 text-xs tabular-nums text-fog">{Math.round(j.progress)}%</span>
            </div>
            <span className="text-xs text-fog">
              {j.stage ?? "Rendering"}
              {j.eta ? ` · ${j.eta} left` : ""}
            </span>
            <span className="h-1 overflow-hidden rounded-full bg-cream/10">
              <span className="block h-full rounded-full bg-gold" style={{ width: `${j.progress}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LatestRenders() {
  const navigate = useNavigate();
  const { assets } = useAssets();
  const recent = assets.filter((a) => a.kind === "image" || a.kind === "video").slice(0, 8);
  if (recent.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-cream">Latest renders</h2>
        <button onClick={() => navigate("/assets")} className="text-sm text-gold hover:underline">
          Open library
        </button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
        {recent.map((a) => (
          <figure key={a.id} className="flex flex-col gap-1.5" title={a.name}>
            <div className={cx("aspect-video overflow-hidden rounded-lg", a.swatch)}>
              {a.url &&
                (a.kind === "video" ? (
                  <video src={a.url} muted preload="metadata" className="h-full w-full object-cover" />
                ) : (
                  <img src={a.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                ))}
            </div>
            <figcaption className="truncate text-xs text-fog">{a.name}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

function Projects() {
  const { projects, activeId, setActive, createProject } = useProjects();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const submit = () => {
    if (!name.trim()) return;
    createProject(name.trim());
    setName("");
    setAdding(false);
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-cream">Projects</h2>
        {adding ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label className="sr-only" htmlFor="new-project">
              Project name
            </label>
            <input
              id="new-project"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
              placeholder="Project name"
              className="h-9 w-56 rounded-lg border border-cream/15 bg-surface px-3 text-sm text-cream outline-none focus:border-gold/50"
            />
            <button type="submit" className="h-9 rounded-lg bg-gold px-3 text-sm font-semibold text-ink">
              Create
            </button>
          </form>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-cream/15 px-3 text-sm text-cream transition hover:bg-cream/5"
          >
            <Plus size={14} /> New project
          </button>
        )}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
        {projects.map((p) => {
          const isActive = p.id === activeId;
          return (
            <button
              key={p.id}
              onClick={() => setActive(p.id)}
              aria-current={isActive}
              className={cx(
                "flex flex-col gap-1 rounded-xl border p-4 text-left transition-colors",
                isActive
                  ? "border-gold/40 bg-gold/8"
                  : "border-cream/8 bg-surface hover:border-cream/20",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-[15px] font-semibold text-cream">{p.name}</span>
                {isActive && <span className="text-xs font-medium text-gold">Open</span>}
              </span>
              <span className="truncate text-sm text-fog">{p.meta}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function HomeScreen() {
  const navigate = useNavigate();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1160px] flex-col gap-10 px-10 pb-16 pt-10">
        <header>
          <h1 className="font-serif text-[40px] font-medium leading-tight tracking-[-0.01em] text-cream">
            {greeting()}
          </h1>
          <p className="mt-1 text-base text-fog">Pick up where you left off, or make something new.</p>
        </header>

        <ContinueCard />

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-cream">Make something</h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
            {QUICK.map(({ tab, label, hint, icon: Icon }) => (
              <button
                key={tab}
                onClick={() => navigate(`/create/${tab}`)}
                className="group flex min-h-[104px] flex-col items-start gap-2 rounded-xl border border-cream/8 bg-surface p-4 text-left transition-colors hover:border-gold/30"
              >
                <Icon size={20} className="text-gold" />
                <span className="text-base font-semibold text-cream">{label}</span>
                <span className="text-sm text-fog">{hint}</span>
              </button>
            ))}
          </div>
        </section>

        <RenderingNow />
        <LatestRenders />
        <Projects />
      </div>
    </div>
  );
}
