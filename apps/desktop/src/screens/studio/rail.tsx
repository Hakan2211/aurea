/* Studio left rail — the two old left columns stacked. Writers Room's episode
 * outline on top, Studio's cast & locations below: both are navigation into
 * the same document, so they belong in one rail rather than one per route.
 *
 * Clicking a scene means "take me there" in whichever view is showing —
 * the parent scrolls the screenplay or flips the board's scene tab. */

import { Plus } from "lucide-react";
import type { Episode } from "@aurea/shared";
import { cx } from "@/components/ui";
import type { useBible, useProduction } from "@/hooks";
import { characterBlurb, pad2, sectionLabel } from "./shared";

export function StudioRail({
  prod,
  bible,
  episode,
  activeSceneId,
  selectScene,
}: {
  prod: ReturnType<typeof useProduction>;
  bible: ReturnType<typeof useBible>;
  episode: Episode | null;
  activeSceneId: string | null;
  selectScene: (id: string) => void;
}) {
  return (
    /* below lg the document needs the width more than the rail does — nav +
       outline + right rail are 748 fixed px before the page gets any */
    <aside className="hidden w-[220px] shrink-0 flex-col overflow-y-auto border-r hairline bg-[#0e0e10] px-3 py-3 lg:flex">
      <span className={sectionLabel}>Episode outline</span>
      <div className="mt-2 space-y-1">
        {(episode?.scenes ?? []).map((scene, i) => (
          <button
            key={scene.id}
            onClick={() => selectScene(scene.id)}
            className={cx(
              "w-full rounded-lg border px-2 py-1.5 text-left transition",
              scene.id === activeSceneId
                ? "border-gold/30 bg-gold/8"
                : "border-transparent hover:border-cream/10 hover:bg-cream/5",
            )}
          >
            <span className="flex items-baseline gap-1.5">
              <span className="shrink-0 font-mono text-[10px] font-semibold text-gold/80">
                {pad2(i + 1)}
              </span>
              <span className="line-clamp-2 min-w-0 flex-1 font-mono text-[10px] uppercase leading-snug text-cream/90">
                {scene.slugline}
              </span>
              {/* shot-count badge — adopted from studio-v2 */}
              <span className="shrink-0 rounded-full bg-cream/8 px-1.5 text-[9px] tabular-nums text-fog">
                {scene.shots.length}
              </span>
            </span>
            {scene.summary && (
              <span className="mt-0.5 line-clamp-2 pl-[22px] text-[10px] leading-snug text-fog">
                {scene.summary}
              </span>
            )}
          </button>
        ))}
        {episode && episode.scenes.length === 0 && (
          <p className="px-2 text-[10px] leading-relaxed text-fog/80">
            No scenes yet — outline by hand, or let the Director draft one.
          </p>
        )}
      </div>
      {episode && (
        <button
          onClick={() =>
            prod.addScene({
              episodeId: episode.id,
              slugline: `INT. THE LOFT — SCENE ${episode.scenes.length + 1}`,
            })
          }
          className="mt-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fog transition hover:text-gold"
        >
          <Plus size={11} /> Add scene
        </button>
      )}

      <span className={cx(sectionLabel, "mt-5")}>Cast</span>
      <div className="mt-2 space-y-0.5">
        {bible.bible.characters.map((c) => {
          const url = bible.refUrl(c.refs.hero ?? c.refs.turnaround ?? c.refs.sheet);
          return (
            <div key={c.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-cream/10">
                {url ? (
                  <img src={url} alt="" className="h-full w-full object-cover object-top" />
                ) : (
                  <span className="font-serif text-[11px] text-gold">{c.name.charAt(0)}</span>
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-medium text-cream">{c.name}</span>
                {/* one-line description under the name — adopted from studio-v2 */}
                <span
                  title={c.personality || undefined}
                  className="block truncate text-[9px] leading-snug text-fog"
                >
                  {characterBlurb(c.personality, c.species)}
                </span>
              </span>
            </div>
          );
        })}
        {bible.bible.characters.length === 0 && (
          <p className="px-1.5 text-[10px] leading-relaxed text-fog/80">
            Empty — seed the cast on the Bible screen.
          </p>
        )}
      </div>

      <span className={cx(sectionLabel, "mt-5")}>Locations</span>
      <div className="mt-2 space-y-0.5 pb-2">
        {bible.bible.locations.map((l) => (
          <div key={l.id} className="rounded-lg px-1.5 py-1">
            <span className="block truncate text-[11px] font-medium text-cream">{l.name}</span>
            <span className="block truncate text-[9px] text-fog">{l.description || "—"}</span>
          </div>
        ))}
        {bible.bible.locations.length === 0 && (
          <p className="px-1.5 text-[10px] leading-relaxed text-fog/80">No locations yet.</p>
        )}
      </div>
    </aside>
  );
}
