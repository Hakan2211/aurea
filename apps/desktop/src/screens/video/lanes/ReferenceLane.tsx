import { useRef, useState } from "react";
import { AudioLines, Film, ListPlus, Upload, X } from "lucide-react";
import { minimaxRefLabels, unknownMinimaxRefTags, type DirectorRef, type MinimaxRefs } from "@aurea/shared";
import { cx } from "@/components/ui";
import { PickerHeading, selectInput } from "../shared";

/** MiniMax-H3's reference lane — the things a shot must carry, rather than the
 * frame it starts on.
 *
 * H3's other head (ref2va) takes stills, clips and sound as conditioning, and
 * the prompt addresses each one by a TAG: <Picture 1>, <Video 1>, <Audio 1>.
 * So this lane's real job is not the picker, it's showing the tag beside every
 * row — the numbers are per type, and a clip's own soundtrack takes an <Audio>
 * number of its own before any standalone sound, which is not a thing anyone
 * guesses right. The panel writes them where you can copy them — and clicking
 * one drops it straight into the prompt, because retyping "<Picture 1>" is
 * exactly the kind of transcription the tags exist to avoid.
 *
 * Referencing a CLIP is also the edit path: point at a take, describe what
 * should be different, and H3 re-performs it. */
export function ReferenceLane({
  refs,
  setRefs,
  prompt,
  frames,
  videoSources,
  audioSources,
  cast,
  durationSec,
  importImages,
  imported,
  importing,
  importError,
  onUseTag,
}: {
  refs: MinimaxRefs;
  setRefs: (fn: (r: MinimaxRefs) => MinimaxRefs) => void;
  /** checked for tags that name references this shot doesn't have */
  prompt: string;
  frames: { relPath: string; name: string; url?: string }[];
  videoSources: { relPath: string; name: string }[];
  audioSources: { relPath: string; name: string }[];
  cast: { id: string; name: string; ref: DirectorRef }[];
  durationSec: number;
  /** stage files from outside the library and attach them as stills */
  importImages: (files: FileList | File[]) => void;
  /** name + preview for a staged file, keyed by the path it came back as —
   * staged refs live in projects/<id>/refs, which the library never scans */
  imported: Record<string, { name: string; url: string }>;
  importing: boolean;
  importError: string | null;
  /** put a tag into the prompt (no-op when it's already there) */
  onUseTag: (tag: string) => void;
}) {
  const [picking, setPicking] = useState<"image" | "video" | "audio" | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const labels = minimaxRefLabels(refs);
  const count = refs.images.length + refs.videos.length + refs.audios.length;
  const missing = count ? unknownMinimaxRefTags(prompt, refs) : [];
  const nameOf = (list: { relPath: string; name: string }[], rel: string) =>
    imported[rel]?.name ?? list.find((s) => s.relPath === rel)?.name ?? (rel.split("/").pop() ?? rel);
  const thumb = (rel: string) => imported[rel]?.url ?? frames.find((f) => f.relPath === rel)?.url;

  const Tag = ({ children }: { children: React.ReactNode }) => (
    <button
      onClick={() => typeof children === "string" && onUseTag(children)}
      title="Click to write this tag into the prompt"
      className="shrink-0 rounded bg-gold/15 px-1.5 py-0.5 font-mono text-[9px] text-gold transition hover:bg-gold/25"
    >
      {children}
    </button>
  );

  return (
    <section
      className="relative"
      /* Dropping a file straight onto the lane is the shortest path from "this
       * picture on my desktop" to a reference — no library round-trip. */
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        importImages(e.dataTransfer.files);
      }}
    >
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) importImages(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="flex items-center justify-end gap-2">
        {count > 0 && (
          <button
            onClick={() => setRefs(() => ({ ...refs, images: [], videos: [], audios: [] }))}
            className="inline-flex items-center gap-1 text-2xs text-fog transition hover:text-red-400"
          >
            <X size={10} /> Clear
          </button>
        )}
        {/* Only worth a quiet text link once the lane already has content and
         * the empty-state button below is gone. */}
        {count > 0 && (
          <button
            onClick={() => setPicking((p) => (p ? null : "image"))}
            className="inline-flex items-center gap-1 rounded-lg border border-cream/15 px-2 py-1 text-2xs text-cream/80 transition hover:border-gold/50 hover:text-gold"
          >
            <ListPlus size={10} /> Add
          </button>
        )}
      </div>

      {count === 0 ? (
        /* The empty state IS the affordance. A muted 10px "Add" in the corner
         * was the only way in, and it read as a caption rather than a control —
         * references are H3's headline feature, so the way to start one should
         * look like a button and cover the whole lane you can also drop onto. */
        <button
          onClick={() => setPicking((p) => (p ? null : "image"))}
          className="mt-1.5 flex w-full flex-col items-start gap-1 rounded-xl border border-dashed border-cream/20 bg-surface/40 px-3 py-2.5 text-left transition hover:border-gold/50 hover:bg-surface"
        >
          <span className="inline-flex items-center gap-1.5 text-2xs font-medium text-cream">
            <ListPlus size={12} /> Add references
          </span>
          <span className="text-2xs leading-relaxed text-fog/70">
            Hand H3 up to 9 stills, 3 clips and 3 sound clips to keep — a character, a set, a
            voice, a camera move. Drop an image here to use one straight off your computer.
            Reference a clip and describe the change and it re-performs it: that is the edit path.
            A shot with references has no start frame.
          </span>
        </button>
      ) : (
        <div className="mt-2 space-y-1.5">
          {refs.images.map((rel, i) => (
            <div
              key={`${rel}-${i}`}
              className="flex items-center gap-2 rounded-xl border border-cream/10 bg-surface px-2 py-1.5"
            >
              {thumb(rel) ? (
                <img
                  src={thumb(rel)}
                  alt=""
                  draggable={false}
                  className="h-7 w-7 shrink-0 rounded-md object-cover"
                />
              ) : (
                <div className="h-7 w-7 shrink-0 rounded-md bg-cream/5" />
              )}
              <Tag>{labels.images[i]}</Tag>
              <span className="min-w-0 flex-1 truncate text-xs text-cream/85">
                {nameOf(frames, rel)}
              </span>
              <button
                onClick={() => setRefs((r) => ({ ...r, images: r.images.filter((_, j) => j !== i) }))}
                title="Remove"
                className="shrink-0 text-fog transition hover:text-red-300"
              >
                <X size={11} />
              </button>
            </div>
          ))}

          {refs.videos.map((v, i) => (
            <div
              key={`${v.video}-${i}`}
              className="space-y-1.5 rounded-xl border border-cream/10 bg-surface p-2"
            >
              <div className="flex items-center gap-2">
                <Film size={13} className="shrink-0 text-fog" />
                <Tag>{labels.videos[i]?.video}</Tag>
                <span className="min-w-0 flex-1 truncate text-xs text-cream/85">
                  {nameOf(videoSources, v.video)}
                </span>
                <button
                  onClick={() =>
                    setRefs((r) => ({ ...r, videos: r.videos.filter((_, j) => j !== i) }))
                  }
                  title="Remove"
                  className="shrink-0 text-fog transition hover:text-red-300"
                >
                  <X size={11} />
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                {(
                  [
                    ["from", "startSec", "Skip this far into the clip"],
                    ["len", "lengthSec", "How much of it H3 is shown"],
                  ] as const
                ).map(([label, key, title]) => (
                  <div
                    key={key}
                    title={title}
                    className="flex min-w-0 flex-1 items-center gap-1 rounded-md border border-cream/10 bg-ink px-1.5 py-1"
                  >
                    <span className="shrink-0 text-[9px] uppercase tracking-wider text-fog/60">
                      {label}
                    </span>
                    <input
                      type="number"
                      min={key === "lengthSec" ? 0.3 : 0}
                      step={0.5}
                      value={v[key]}
                      onChange={(e) => {
                        const n = Math.max(key === "lengthSec" ? 0.3 : 0, Number(e.target.value) || 0);
                        setRefs((r) => ({
                          ...r,
                          videos: r.videos.map((x, j) => (j === i ? { ...x, [key]: n } : x)),
                        }));
                      }}
                      className="w-full min-w-0 bg-transparent text-2xs tabular-nums text-gold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                ))}
              </div>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={v.useItsAudio}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setRefs((r) => ({
                      ...r,
                      videos: r.videos.map((x, j) => (j === i ? { ...x, useItsAudio: on } : x)),
                    }));
                  }}
                  className="accent-gold"
                />
                <span className="text-2xs text-fog">
                  Reference its sound too
                  {labels.videos[i]?.audio ? ` — ${labels.videos[i]!.audio}` : ""}
                </span>
              </label>
              {v.lengthSec > durationSec && (
                <p className="text-2xs leading-relaxed text-gold/75">
                  Longer than the take itself — H3 crops a reference clip to the shot's length, so
                  the last {(v.lengthSec - durationSec).toFixed(1)}s is decoded and thrown away.
                </p>
              )}
            </div>
          ))}

          {refs.audios.map((rel, i) => (
            <div
              key={`${rel}-${i}`}
              className="flex items-center gap-2 rounded-xl border border-cream/10 bg-surface px-2 py-1.5"
            >
              <AudioLines size={13} className="shrink-0 text-fog" />
              <Tag>{labels.audios[i]}</Tag>
              <span className="min-w-0 flex-1 truncate text-xs text-cream/85">
                {nameOf(audioSources, rel)}
              </span>
              <button
                onClick={() => setRefs((r) => ({ ...r, audios: r.audios.filter((_, j) => j !== i) }))}
                title="Remove"
                className="shrink-0 text-fog transition hover:text-red-300"
              >
                <X size={11} />
              </button>
            </div>
          ))}

          {refs.images.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-2xs text-fog">Stills</span>
              <select
                value={refs.imageSize}
                onChange={(e) =>
                  setRefs((r) => ({ ...r, imageSize: e.target.value as MinimaxRefs["imageSize"] }))
                }
                style={{ colorScheme: "dark" }}
                className={cx(selectInput, "min-w-0 flex-1")}
              >
                <option value="match">Match the render (faster)</option>
                <option value="max">Full 2048px (holds identity harder)</option>
              </select>
            </div>
          )}

          {refs.videos.length > 0 && (
            <p className="text-2xs leading-relaxed text-fog/70">
              A reference clip costs a few GB of VRAM more than stills do, so the render clears
              the card first and the weights reload — add a minute or two.
            </p>
          )}

          {missing.length > 0 ? (
            <p className="text-2xs leading-relaxed text-red-300">
              The prompt names {missing.join(", ")}, which this shot doesn't have. Its tags are{" "}
              {labels.all.join(", ")}.
            </p>
          ) : (
            <p className="text-2xs leading-relaxed text-fog/70">
              Name them in the prompt — {labels.all.join(", ")}. An unnamed reference still colours
              the shot, but nothing tells H3 what part it plays. Click a tag to write it in.
            </p>
          )}
        </div>
      )}

      {(importing || importError) && (
        <p
          className={cx(
            "mt-1.5 text-2xs leading-relaxed",
            importError ? "text-red-300" : "text-fog/70",
          )}
        >
          {importError ?? "Copying the image into this project…"}
        </p>
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl border border-dashed border-gold/60 bg-ink/70">
          <span className="text-xs text-gold">Drop to add as a reference still</span>
        </div>
      )}

      {picking && (
        <div className="absolute inset-x-0 top-7 z-10 max-h-64 overflow-y-auto rounded-xl border border-cream/12 bg-raised shadow-xl">
          <div className="sticky top-0 flex gap-1 bg-raised px-2 py-1.5">
            {(
              [
                ["image", "Stills", refs.images.length, 9],
                ["video", "Clips", refs.videos.length, 3],
                ["audio", "Sound", refs.audios.length, 3],
              ] as const
            ).map(([id, label, used, max]) => (
              <button
                key={id}
                onClick={() => setPicking(id)}
                className={cx(
                  "rounded-md px-2 py-0.5 text-2xs transition",
                  picking === id ? "bg-gold/15 text-gold" : "text-fog hover:text-cream/85",
                )}
              >
                {label} {used}/{max}
              </button>
            ))}
          </div>

          {picking === "image" &&
            (refs.images.length >= 9 ? (
              <p className="px-3 py-2 text-xs text-fog">Nine stills is H3's ceiling.</p>
            ) : (
              <>
                <PickerHeading>From your computer</PickerHeading>
                <button
                  onClick={() => {
                    setPicking(null);
                    fileInput.current?.click();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-cream/85 transition hover:bg-cream/5"
                >
                  <Upload size={12} className="shrink-0 text-fog" />
                  <span className="min-w-0 flex-1 truncate">Choose an image file…</span>
                </button>
                {cast.length > 0 && <PickerHeading>From the Bible</PickerHeading>}
                {cast.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setRefs((r) => ({ ...r, images: [...r.images, c.ref.image] }));
                      setPicking(null);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-cream/85 transition hover:bg-cream/5"
                  >
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="shrink-0 text-[9px] uppercase tracking-wider text-fog/60">
                      cast
                    </span>
                  </button>
                ))}
                <PickerHeading>From the library</PickerHeading>
                {frames.length === 0 && (
                  <p className="px-3 py-2 text-xs text-fog">No stills in the library yet.</p>
                )}
                {frames.slice(0, 30).map((f) => (
                  <button
                    key={f.relPath}
                    onClick={() => {
                      setRefs((r) => ({ ...r, images: [...r.images, f.relPath] }));
                      setPicking(null);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-cream/85 transition hover:bg-cream/5"
                  >
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  </button>
                ))}
              </>
            ))}

          {picking === "video" &&
            (refs.videos.length >= 3 ? (
              <p className="px-3 py-2 text-xs text-fog">Three clips is H3's ceiling.</p>
            ) : videoSources.length === 0 ? (
              <p className="px-3 py-2 text-xs text-fog">
                No video in the library yet — render a take first.
              </p>
            ) : (
              videoSources.map((s) => (
                <button
                  key={s.relPath}
                  onClick={() => {
                    setRefs((r) => ({
                      ...r,
                      videos: [
                        ...r.videos,
                        {
                          video: s.relPath,
                          startSec: 0,
                          // a few seconds is a reference; the whole take is a
                          // second render's worth of tokens
                          lengthSec: Math.min(3, durationSec),
                          useItsAudio: false,
                        },
                      ],
                    }));
                    setPicking(null);
                  }}
                  className="flex w-full items-center px-3 py-2 text-left text-xs text-cream/85 transition hover:bg-cream/5"
                >
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                </button>
              ))
            ))}

          {picking === "audio" &&
            (refs.audios.length >= 3 ? (
              <p className="px-3 py-2 text-xs text-fog">Three sound clips is H3's ceiling.</p>
            ) : audioSources.length === 0 ? (
              <p className="px-3 py-2 text-xs text-fog">
                No audio in the library yet — generate a voice take or a track first.
              </p>
            ) : (
              audioSources.map((a) => (
                <button
                  key={a.relPath}
                  onClick={() => {
                    setRefs((r) => ({ ...r, audios: [...r.audios, a.relPath] }));
                    setPicking(null);
                  }}
                  className="flex w-full items-center px-3 py-2 text-left text-xs text-cream/85 transition hover:bg-cream/5"
                >
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                </button>
              ))
            ))}
        </div>
      )}
    </section>
  );
}
