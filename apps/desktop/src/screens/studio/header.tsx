/* Studio header — one header for both views. The old Studio board and the old
 * Writers Room each carried their own episode picker and their own stats; the
 * merge keeps a single row: picker + logline, the script stats the room used,
 * the approval ring the board used, and the SCRIPT | BOARD toggle that swaps
 * the centre pane underneath. */

import { useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import type { Episode } from "@aurea/shared";
import { Segmented, cx } from "@/components/ui";
import type { useProduction } from "@/hooks";
import { pad2, scriptStats } from "./shared";

export type StudioView = "script" | "board";

export interface EpisodeEntry {
  season: { number: number };
  episode: Episode;
}

export function StudioHeader({
  prod,
  episodes,
  current,
  selectEpisode,
  view,
  setView,
}: {
  prod: ReturnType<typeof useProduction>;
  episodes: EpisodeEntry[];
  current: EpisodeEntry | null;
  selectEpisode: (id: string) => void;
  view: StudioView;
  setView: (v: StudioView) => void;
}) {
  const [open, setOpen] = useState(false);
  const stats = scriptStats(current?.episode ?? null);
  const pct = stats.shots ? Math.round((stats.approved / stats.shots) * 100) : 0;

  return (
    /* Wide pane: three columns, not a flex row — the toggle is the header's
       centre of gravity (studio-v1 draws it dead centre) and a plain flex row
       would let it drift every time the episode title changes length.
       Narrow pane: the readout column is empty, and an empty 1fr track would
       still claim half the leftover width and starve the title, so it falls
       back to flex — title left, toggle right.
       Every threshold is a *container* query: readouts drop out one tier at a
       time as the pane narrows, because `min-w-0` alone only lets the track
       shrink — the shrink-0 readouts inside it then overflow leftward, right
       across the toggle. */
    <header className="flex items-center gap-4 border-b hairline px-5 py-3 @2xl:grid @2xl:grid-cols-[1fr_auto_1fr]">
      <div className="relative min-w-0 flex-1">
        <button
          onClick={() => episodes.length > 0 && setOpen((o) => !o)}
          className="group flex w-full min-w-0 items-center gap-2 text-left"
        >
          {/* min-w-0 as well as truncate: a flex item's implicit
              `min-width:auto` refuses to shrink below the title's min-content,
              so without it a long title overruns its grid column and the
              centred toggle draws on top of it in a narrow window */}
          <h1 className="min-w-0 truncate font-serif text-[22px] font-semibold text-cream">
            {current
              ? `S${pad2(current.season.number)}E${pad2(current.episode.number)} — ${current.episode.title}`
              : (prod.production?.title ?? "Production")}
          </h1>
          {episodes.length > 0 && (
            <ChevronDown size={16} className="shrink-0 text-fog transition group-hover:text-gold" />
          )}
        </button>
        {open && (
          <>
            <button className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
            <div className="absolute left-0 top-full z-20 mt-1 w-[300px] rounded-xl border hairline bg-raised p-1 shadow-xl">
              {/* row, not a button: the remove control is a button of its own
                  and buttons don't nest */}
              {episodes.map(({ season, episode }) => (
                <div
                  key={episode.id}
                  className={cx(
                    "flex w-full items-center rounded-lg pr-2 text-[12px] transition",
                    episode.id === current?.episode.id
                      ? "bg-gold/10 text-gold"
                      : "text-cream hover:bg-cream/5",
                  )}
                >
                  <button
                    onClick={() => {
                      selectEpisode(episode.id);
                      setOpen(false);
                    }}
                    className="min-w-0 flex-1 truncate px-2.5 py-1.5 text-left"
                  >
                    S{pad2(season.number)}E{pad2(episode.number)} — {episode.title}
                  </button>
                  <button
                    title="Remove episode"
                    onClick={() => prod.removeEpisode(episode.id)}
                    className="ml-2 shrink-0 text-fog transition hover:text-[#e07a6b]"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => {
                  prod.addEpisode({ title: `Episode ${episodes.length + 1}` });
                  setOpen(false);
                }}
                className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-fog transition hover:bg-cream/5 hover:text-gold"
              >
                <Plus size={12} /> New episode
              </button>
            </div>
          </>
        )}
        {current?.episode.logline && (
          <p className="mt-0.5 truncate font-serif text-[12px] italic text-fog">
            {current.episode.logline}
          </p>
        )}
      </div>

      {/* the view switch — the two halves of the screen, so it gets the centre
          and the loudest label treatment in the row */}
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: "script", label: <ViewLabel>Script</ViewLabel>, title: "The episode as a screenplay" },
          { value: "board", label: <ViewLabel>Board</ViewLabel>, title: "The episode as a status board" },
        ]}
      />

      {/* readouts, kept together on the right so nothing interactive hides
          among them. overflow-hidden is the belt-and-braces: if a tier's
          arithmetic is ever off, the numbers clip instead of painting over
          the toggle */}
      <div className="hidden min-w-0 items-center justify-end gap-4 overflow-hidden @2xl:flex">
        {current && (
          <>
            <div className="hidden shrink-0 items-center gap-4 text-right @4xl:flex">
              {(
                [
                  [String(stats.scenes), "scenes"],
                  [String(stats.shots), "shots"],
                  [String(stats.dialogueLines), "lines"],
                  [`~${stats.runtime}`, "runtime"],
                ] as const
              ).map(([value, label]) => (
                <div key={label}>
                  <p className="font-serif text-[16px] font-semibold text-cream">{value}</p>
                  <p className="text-[9px] uppercase tracking-[0.14em] text-fog">{label}</p>
                </div>
              ))}
            </div>

            <div
              className="flex shrink-0 items-center gap-2"
              title={`${stats.approved} of ${stats.shots} shots approved`}
            >
              <ProgressRing pct={pct} />
              <span className="hidden text-[11px] text-cream/80 @6xl:block">
                {stats.approved}/{stats.shots} approved
              </span>
            </div>
          </>
        )}
      </div>
    </header>
  );
}

/** SCRIPT / BOARD — letterspaced caps, a size up from the Segmented default,
 * so the control reads as a view switch rather than a minor option */
function ViewLabel({ children }: { children: string }) {
  return (
    <span className="block py-0.5 text-[11px] font-semibold uppercase tracking-normal @2xl:px-1.5 @2xl:tracking-[0.16em]">
      {children}
    </span>
  );
}

function ProgressRing({ pct }: { pct: number }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" className="-rotate-90">
      <circle cx="22" cy="22" r={r} fill="none" stroke="rgba(237,234,228,0.08)" strokeWidth="4" />
      <circle
        cx="22"
        cy="22"
        r={r}
        fill="none"
        stroke="#c9a96e"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct / 100)}
      />
      <text
        x="22"
        y="22"
        textAnchor="middle"
        dominantBaseline="central"
        transform="rotate(90 22 22)"
        fill="#edeae4"
        fontSize="10"
        fontWeight="600"
      >
        {pct}%
      </text>
    </svg>
  );
}
