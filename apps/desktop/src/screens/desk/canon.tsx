/* Canon library — the project's visual memory in one panel: set plates
 * (location refs, the identity anchors since cast refs burn broadcast text),
 * every boarded keyframe grouped by location, the coverage angles shot off
 * those plates, and the cast sheets. Continuity AND cost: the Boarder reuses
 * the Lounge plate instead of regenerating it. */

import { useMemo, useState } from "react";
import { Aperture, Loader2 } from "lucide-react";
import type { CoverageRun, Production } from "@aurea/shared";
import { COVERAGE_ANGLES } from "@aurea/shared";
import { Modal, ModalHeader, cx } from "@/components/ui";
import type { useBible } from "@/hooks";
import { useCoverage } from "@/hooks";
import { pad2, sectionLabel, shotCode } from "../studio/shared";

/** angle id → the label under its thumbnail */
const ANGLE_LABEL = new Map(COVERAGE_ANGLES.map((a) => [a.id, `${a.deg}°`]));

interface CanonItem {
  url?: string;
  label: string;
  sub?: string;
}

export function CanonLibrary({
  open,
  onClose,
  production,
  bible,
}: {
  open: boolean;
  onClose: () => void;
  production: Production | null;
  bible: ReturnType<typeof useBible>;
}) {
  const [zoom, setZoom] = useState<CanonItem | null>(null);
  const coverage = useCoverage();
  /** the location whose coverage pass is being set up, and the line the
   * render will be given. Held here rather than per-section so only one form
   * is ever open — a coverage pass is a GPU render, not a checkbox. */
  const [shooting, setShooting] = useState<{
    location: string;
    source: string;
    subject: string;
  } | null>(null);

  /* every coverage run, grouped the same way the boards are — by location id,
   * "" for a run that was never told where it belongs */
  const coverageByLocation = useMemo(() => {
    const map = new Map<string, CoverageRun[]>();
    for (const run of coverage.runs) {
      const list = map.get(run.location) ?? [];
      list.push(run);
      map.set(run.location, list);
    }
    return map;
  }, [coverage.runs]);

  /* every boarded keyframe in the whole production, grouped by location id
   * (the shot's own, else its scene's; "" = unplaced) */
  const boardsByLocation = useMemo(() => {
    const map = new Map<string, CanonItem[]>();
    if (!production) return map;
    for (const season of production.seasons) {
      for (const episode of season.episodes) {
        for (const [sceneIdx, scene] of episode.scenes.entries()) {
          for (const [shotIdx, shot] of scene.shots.entries()) {
            const loc = shot.location ?? scene.location ?? "";
            for (const k of shot.keyframes) {
              const list = map.get(loc) ?? [];
              list.push({
                url: bible.refUrl(k.asset),
                label: `E${pad2(episode.number)} ${shotCode(sceneIdx, shotIdx)}`,
                sub: shot.title || scene.slugline,
              });
              map.set(loc, list);
            }
          }
        }
      }
    }
    return map;
  }, [production, bible]);

  const orphans = boardsByLocation.get("") ?? [];
  /* A coverage pass started from the lab, or off a plate whose location was
   * never set, has no location id — it still has to be visible somewhere. */
  const orphanRuns = coverageByLocation.get("") ?? [];

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <ModalHeader
        title="Canon library"
        sub="Set plates, boarded keyframes and cast sheets — reuse before regenerating"
        onClose={onClose}
      />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto px-5 py-4">
          {bible.bible.locations.map((loc) => {
            const plates: CanonItem[] = loc.refs.map((r, i) => ({
              url: bible.refUrl(r),
              label: loc.refs.length === 1 ? "canon plate" : `plate ${i + 1}`,
              sub: loc.name,
            }));
            const boards = boardsByLocation.get(loc.id) ?? [];
            const runs = coverageByLocation.get(loc.id) ?? [];
            if (plates.length === 0 && boards.length === 0 && runs.length === 0) return null;
            return (
              <section key={loc.id} className="mb-5">
                <p className={cx(sectionLabel, "flex items-center gap-2")}>
                  <span>
                    {loc.name}
                    <span className="ml-2 normal-case tracking-normal text-fog">
                      {plates.length} plate{plates.length === 1 ? "" : "s"} · {boards.length} board
                      {boards.length === 1 ? "" : "s"}
                      {runs.length ? ` · ${runs.length} coverage` : ""}
                    </span>
                  </span>
                  {loc.refs[0] && (
                    <button
                      onClick={() =>
                        setShooting(
                          shooting?.location === loc.id
                            ? null
                            : { location: loc.id, source: loc.refs[0], subject: loc.name },
                        )
                      }
                      className="ml-auto flex items-center gap-1 rounded border border-cream/15 px-1.5 py-0.5 text-2xs normal-case tracking-normal text-fog transition hover:border-gold/40 hover:text-cream"
                    >
                      <Aperture className="h-3 w-3" />
                      Coverage pass
                    </button>
                  )}
                </p>

                {shooting?.location === loc.id && (
                  <CoverageForm
                    subject={shooting.subject}
                    onSubject={(subject) => setShooting({ ...shooting, subject })}
                    busy={coverage.starting}
                    error={coverage.error}
                    onStart={() => {
                      coverage.start({
                        source: shooting.source,
                        subject: shooting.subject,
                        location: loc.id,
                      });
                      setShooting(null);
                    }}
                    onCancel={() => setShooting(null)}
                  />
                )}

                <div className="mt-2 flex flex-wrap gap-2">
                  {plates.map((item, i) => (
                    <Thumb key={`p${i}`} item={item} plate onZoom={setZoom} />
                  ))}
                  {boards.map((item, i) => (
                    <Thumb key={`b${i}`} item={item} onZoom={setZoom} />
                  ))}
                </div>

                {runs.map((run) => (
                  <Angles key={run.id} run={run} url={coverage.angleUrl} onZoom={setZoom} />
                ))}
              </section>
            );
          })}

          {(orphans.length > 0 || orphanRuns.length > 0) && (
            <section className="mb-5">
              <p className={sectionLabel}>Unplaced</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {orphans.map((item, i) => (
                  <Thumb key={i} item={item} onZoom={setZoom} />
                ))}
              </div>
              {orphanRuns.map((run) => (
                <Angles key={run.id} run={run} url={coverage.angleUrl} onZoom={setZoom} />
              ))}
            </section>
          )}

          <section className="mb-2">
            <p className={sectionLabel}>Cast sheets</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {bible.bible.characters.map((c) => {
                const ref = c.refs.sheet ?? c.refs.keyframeRef ?? c.refs.hero ?? c.refs.frames[0];
                return (
                  <Thumb
                    key={c.id}
                    item={{
                      url: ref ? bible.refUrl(ref) : undefined,
                      label: c.name,
                      sub: c.species,
                    }}
                    onZoom={setZoom}
                  />
                );
              })}
            </div>
          </section>
        </div>

        {zoom && (
          <div
            onClick={() => setZoom(null)}
            className="absolute inset-0 z-10 flex cursor-zoom-out flex-col items-center justify-center gap-2 bg-ink/95 p-6"
          >
            {zoom.url && (
              <img
                src={zoom.url}
                alt=""
                className="min-h-0 max-w-full flex-1 rounded-lg object-contain"
              />
            )}
            <p className="text-xs text-fog">
              {zoom.label}
              {zoom.sub ? ` — ${zoom.sub}` : ""}
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** The one thing a coverage pass needs from a human: a line saying what must
 * survive the orbit. Defaulted to the location's name, which is right often
 * enough to be a starting point and never right enough to send unread. */
function CoverageForm({
  subject,
  onSubject,
  busy,
  error,
  onStart,
  onCancel,
}: {
  subject: string;
  onSubject: (v: string) => void;
  busy: boolean;
  error: string | null;
  onStart: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-2 rounded-lg border border-gold/20 bg-surface/60 p-2">
      <p className="text-2xs text-fog">
        Eight angles of this plate in one render — what has to stay identical?
      </p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <input
          autoFocus
          value={subject}
          onChange={(e) => onSubject(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && subject.trim()) onStart();
            if (e.key === "Escape") onCancel();
          }}
          placeholder="the lion at the desk; keep this exact lion, blazer and room"
          className="min-w-0 flex-1 rounded border border-cream/15 bg-ink px-2 py-1 text-xs text-cream outline-none focus:border-gold/40"
        />
        <button
          disabled={busy || !subject.trim()}
          onClick={onStart}
          className="flex items-center gap-1 rounded bg-gold/20 px-2 py-1 text-2xs text-cream transition hover:bg-gold/30 disabled:opacity-40"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          Shoot
        </button>
        <button
          onClick={onCancel}
          className="rounded px-1.5 py-1 text-2xs text-fog transition hover:text-cream"
        >
          Cancel
        </button>
      </div>
      {error && <p className="mt-1 text-2xs text-red-300">{error}</p>}
    </div>
  );
}

/** One coverage run: the contact sheet, then the eight angles in orbit order.
 *
 * A run that is still rendering shows its bearings as empty slots rather than
 * nothing at all — the shape of what is coming is the useful thing to see
 * while a five-minute render runs. */
function Angles({
  run,
  url,
  onZoom,
}: {
  run: CoverageRun;
  url: (rel: string | undefined) => string | undefined;
  onZoom: (i: CanonItem) => void;
}) {
  const pending = run.status !== "completed" && run.status !== "failed";
  return (
    <div className="mt-2 rounded-lg border border-cream/10 bg-surface/40 p-2">
      <p className="flex items-center gap-1.5 text-2xs text-fog">
        <Aperture className="h-3 w-3" />
        <span className="truncate">{run.subject}</span>
        <span className={cx("ml-auto shrink-0", run.status === "failed" && "text-red-300")}>
          {pending ? "rendering…" : run.status === "failed" ? (run.error ?? "failed") : "8 angles"}
        </span>
      </p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {run.sheet && (
          <Thumb
            item={{ url: url(run.sheet), label: "contact sheet", sub: run.subject }}
            onZoom={onZoom}
          />
        )}
        {run.angles.map((a) => (
          <Thumb
            key={a.id}
            item={{
              url: url(a.asset),
              label: ANGLE_LABEL.get(a.id) ?? a.id,
              sub: run.subject,
            }}
            onZoom={onZoom}
          />
        ))}
      </div>
    </div>
  );
}

function Thumb({
  item,
  plate,
  onZoom,
}: {
  item: CanonItem;
  /** a location's canon plate — ringed, so the anchor stands out from boards */
  plate?: boolean;
  onZoom: (i: CanonItem) => void;
}) {
  return (
    <button
      onClick={() => onZoom(item)}
      title={item.sub ? `${item.label} — ${item.sub}` : item.label}
      className={cx(
        "w-[132px] overflow-hidden rounded-lg border text-left transition hover:border-gold/40",
        plate ? "border-gold/25" : "border-cream/10",
      )}
    >
      <div className="aspect-video w-full bg-gradient-to-br from-[#241c10] to-[#0d0a06]">
        {item.url && (
          <img src={item.url} alt="" loading="lazy" className="h-full w-full object-cover" />
        )}
      </div>
      <p className="truncate bg-surface px-1.5 py-1 text-2xs text-fog">
        {plate ? "★ " : ""}
        {item.label}
      </p>
    </button>
  );
}
