import { Slider } from "@/components/ui/Slider";
import { Checkbox } from "@/components/ui/Checkbox";
import { SelectBox } from "@/components/ui/SelectBox";
import {
  CircleAlert,
  LayoutPanelTop,
  Maximize2,
  Replace,
  Scissors,
  Sparkles,
  Type,
  Upload,
  X,
} from "lucide-react";
import { AdvancedButton, ComposerBar, GenerateButton, ModelSelect, cx } from "@/components/ui";
import { MIN_RETAKE_SEC, fmtTime, selectInput } from "./shared";
import type { VideoParams } from "./useVideoParams";

/* The composer — the Video lab's whole daily surface (UI simplify plan,
 * Stage 2): a start frame, the prompt, engine, length and size, Generate.
 * Everything else lives in the Advanced drawer, and the chip beside its
 * button says how many of those settings are not at their plain default, so
 * nothing changes a render without being visible from here. */

/** One frame slot — a still with its caption, or a dashed invitation to pick
 * one. Shared with the Advanced drawer's end frame. */
export function FrameTile({
  url,
  swatch,
  name,
  meta,
  onPick,
  onClear,
  emptyLabel,
}: {
  url?: string;
  swatch?: string;
  name?: string;
  meta?: string;
  onPick: () => void;
  /** end frames are optional — only those get a clear affordance */
  onClear?: () => void;
  emptyLabel?: string;
}) {
  if (!url && emptyLabel) {
    return (
      <button
        onClick={onPick}
        className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-cream/15 px-2 text-center transition hover:border-gold/50 hover:text-gold"
      >
        <Replace size={14} className="text-fog" />
        <span className="text-2xs leading-tight text-fog">{emptyLabel}</span>
      </button>
    );
  }
  return (
    <div className="group relative">
      <button
        onClick={onPick}
        title="Choose a different still"
        className="relative block aspect-video w-full overflow-hidden rounded-xl border border-cream/10 text-left transition hover:border-gold/40"
      >
        <div className={cx("absolute inset-0", swatch ?? "bg-raised")} />
        {url ? (
          <img
            src={url}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_30%,rgba(237,234,228,0.07),transparent_60%)]" />
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-ink/45 opacity-0 backdrop-blur-[1px] transition group-hover:opacity-100">
          <span className="inline-flex items-center gap-1 rounded-pill bg-cream/95 px-2 py-0.5 text-2xs font-medium text-ink">
            <Maximize2 size={10} /> Browse
          </span>
        </div>
        {(name || meta) && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/90 to-transparent px-1.5 pb-1 pt-4">
            {name && <div className="truncate text-2xs leading-tight text-cream/90">{name}</div>}
            {meta && <div className="truncate text-2xs leading-tight text-fog">{meta}</div>}
          </div>
        )}
      </button>
      {onClear && (
        <button
          onClick={onClear}
          title="Clear this frame"
          className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-cream/20 bg-ink text-fog opacity-0 transition hover:border-red-400/60 hover:text-red-400 group-hover:opacity-100"
        >
          <X size={10} />
        </button>
      )}
    </div>
  );
}

export function Composer({
  p,
  advancedOpen,
  onToggleAdvanced,
  onDetachShot,
}: {
  p: VideoParams;
  advancedOpen: boolean;
  onToggleAdvanced: () => void;
  /** unlink the board shot — the next take renders as a free one */
  onDetachShot: () => void;
}) {
  const { lab, retake, setRetake, prefill } = p;

  const generateBlocked =
    lab.busy ||
    !p.prompt.trim() ||
    (retake ? !p.retakeReady || retake.lengthSec < MIN_RETAKE_SEC : !p.canGenerate);

  /* the start-frame slot: a still, "text only", or an empty drop zone */
  const textOnly = p.t2vOn;
  const startSlot = (
    <div className="w-[176px] shrink-0">
      <div {...p.dropInto("start")}>
        {textOnly ? (
          <button
            onClick={() => (p.effectiveRel ? p.setNoStartFrame(false) : p.setPicking("start"))}
            title={
              p.effectiveRel
                ? "Rendering from the prompt alone — click to start from a still again"
                : "No stills yet — pick, drop or paste a picture"
            }
            className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-cream/15 px-2 text-center transition hover:border-gold/50 hover:text-gold"
          >
            {p.effectiveRel ? <Type size={15} className="text-fog" /> : <Upload size={15} className="text-fog" />}
            <span className="text-2xs leading-tight text-fog">
              {p.effectiveRel ? "Text only — no start frame" : "Drop or paste a still, or render from text"}
            </span>
          </button>
        ) : (
          <FrameTile
            url={p.startFrameUrl}
            swatch={p.frameSwatch}
            name={p.frameName}
            meta={`${p.frameMeta}${!p.frameRel ? " · default" : ""}`}
            onPick={() => p.setPicking("start")}
          />
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <label
          className={cx(
            "inline-flex cursor-pointer items-center gap-1 text-2xs text-fog transition hover:text-gold",
            lab.importingStill && "pointer-events-none opacity-60",
          )}
          title="Or drop / paste a picture on the frame"
        >
          <Upload size={11} />
          {lab.importingStill ? "Bringing it in…" : "From computer"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void p.importStillInto(e.target.files, "start");
              e.target.value = "";
            }}
          />
        </label>
        {p.t2vCapable && !retake && !p.directorOn && !p.refsOn && p.effectiveRel && (
          <button
            onClick={() => p.setNoStartFrame(!p.noStartFrame)}
            title="Render from the prompt alone. Nothing anchors identity — for an on-model character, start from a still."
            className={cx(
              "text-2xs transition",
              p.noStartFrame ? "text-gold hover:text-gold/80" : "text-fog hover:text-gold",
            )}
          >
            {p.noStartFrame ? "Use a still" : "Text only"}
          </button>
        )}
      </div>
      {p.stillImportError && (
        <p className="mt-1 flex items-start gap-1 text-2xs text-red-300">
          <CircleAlert size={11} className="mt-px shrink-0" /> {p.stillImportError}
        </p>
      )}
      {p.refsOn && (
        <p className="mt-1 text-2xs leading-snug text-gold/75">
          Not used — a reference shot conditions on its references.
        </p>
      )}
    </div>
  );

  /* the size notes the old Duration & Size row carried — only the ones that
   * apply right now, and only as long as they apply */
  const sizeNotes: { text: string; tone: "fog" | "gold" | "amber" }[] = [];
  if (retake)
    sizeNotes.push({
      text: `A retake follows the take it fixes — ${retake.label} sets the length, frame rate and size.`,
      tone: "gold",
    });
  if (p.engineId === "seedance")
    sizeNotes.push({
      text: `${p.durationSec > 7 && p.durationSec !== 10 ? "Seedance only renders 5s or 10s — this queues as a 10-second clip. " : ""}≈ $${p.seedanceEst} on your fal.ai account.`,
      tone: "fog",
    });
  if (p.isMinimax && p.durationSec < 4)
    sizeNotes.push({ text: "H3 renders 4–15 second shots — pick 4s or longer, or switch to LTX-2.3.", tone: "gold" });
  if (p.isMinimax && p.durationSec > 15)
    sizeNotes.push({
      text:
        "Past 15s H3 samples the shot in chunks — mark the cuts in the prompt ([Shot 1], then [Shot 2] At 00:10.000, …)." +
        (p.refCount === 0 ? " It also needs at least one reference still (Advanced → References)." : "") +
        (p.minimaxRefs.videos.length > 0 || p.minimaxRefs.audios.length > 0
          ? " Reference clips and sounds can't ride along on a chunked shot."
          : ""),
      tone: "gold",
    });
  if (p.engineId !== "seedance" && p.durationSec > 10)
    sizeNotes.push({
      text: `Long clips scale VRAM and render time roughly linearly — drop the size if a ${p.durationSec}s take runs out of memory.`,
      tone: "fog",
    });
  if (p.vramStack)
    sizeNotes.push({
      text: "48 fps at HD past 8 seconds stacks all three VRAM multipliers — expect this to fail on a 24 GB card.",
      tone: "amber",
    });

  return (
    <ComposerBar>
      {/* a shot sent over from the board */}
      {prefill && (
        <div className="mb-2.5 flex items-start gap-2 rounded-xl border border-gold/25 bg-gold/5 px-3 py-2">
          <LayoutPanelTop size={13} className="mt-0.5 shrink-0 text-gold" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-cream/90">
              <span className="font-semibold text-gold">From the storyboard · </span>
              {prefill.title || prefill.shotId}
              <span className="text-fog">
                {" "}— beats, cast and the audio lane are set under Advanced. The finished take lands
                back on the shot.
              </span>
            </p>
            {prefill.notes.map((n) => (
              <p key={n} className="mt-0.5 text-2xs leading-relaxed text-gold/75">
                {n}
              </p>
            ))}
          </div>
          <button
            onClick={onDetachShot}
            title="Detach from the storyboard shot. Settings stay; the next take won't land on the shot."
            className="shrink-0 rounded p-0.5 text-fog transition hover:text-gold"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* a marked window on the preview — the fix is described here */}
      {retake && (
        <div className="mb-2.5 rounded-xl border border-gold/30 bg-gold/6 px-3 py-2">
          <div className="flex items-center gap-2">
            <Scissors size={13} className="shrink-0 text-gold/80" />
            <span className="min-w-0 truncate text-xs font-medium text-cream/90">
              Fix a bit of {retake.label}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-gold">
              {fmtTime(retake.atSec)} → {fmtTime(retake.atSec + retake.lengthSec)}
            </span>
            <span className="flex-1" />
            <button
              title="Cancel the retake"
              onClick={() => setRetake(null)}
              className="shrink-0 text-fog transition hover:text-red-400"
            >
              <X size={13} />
            </button>
          </div>
          {p.directorBlocked ? (
            <p className="mt-1.5 text-2xs leading-relaxed text-fog">
              {p.surface.sections.director.reason ??
                "Needs a ComfyUI with the Director node pack — check Settings → Engines."}
            </p>
          ) : (
            <div className="mt-2 flex items-start gap-3">
              <textarea
                value={retake.prompt}
                onChange={(e) => setRetake({ ...retake, prompt: e.target.value })}
                rows={2}
                placeholder="What should happen in that window instead…"
                className="min-w-0 flex-1 resize-none rounded-lg border border-cream/10 bg-surface p-2 text-xs leading-relaxed text-cream placeholder:text-fog focus:border-gold/40 focus:outline-none"
              />
              <div className="w-[200px] shrink-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-2xs text-fog">Freedom</span>
                  <Slider
                    min={0.3}
                    max={1}
                    step={0.05}
                    value={retake.strength}
                    title={`How far from the original the window may go (${retake.strength.toFixed(2)})`}
                    onChange={(v) => setRetake({ ...retake, strength: v })}
                    className="min-w-0 flex-1"
                  />
                  <span className="w-8 shrink-0 text-right text-2xs tabular-nums text-gold">
                    {retake.strength.toFixed(2)}
                  </span>
                </div>
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={retake.regenerateAudio}
                    onCheckedChange={(v) => setRetake({ ...retake, regenerateAudio: v === true })}
                    className=""
                  />
                  <span className="text-2xs text-fog">Re-render the sound too</span>
                </label>
              </div>
            </div>
          )}
          {!p.directorBlocked && (
            <p className="mt-1 text-2xs leading-relaxed text-fog">
              {retake.lengthSec < MIN_RETAKE_SEC
                ? "Mark at least a third of a second — a shorter window rounds away and the take comes back unchanged."
                : retake.regenerateAudio
                  ? "LTX rewrites the window's audio as well — expect invented speech if the original had a line there."
                  : "The original audio, length and framing are kept; only the picture inside the window is re-rendered."}
            </p>
          )}
        </div>
      )}

      <div className="flex gap-3">
        {startSlot}

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* prompt — the enhance control sits in the box's top-right */}
          <div className="relative">
            <textarea
              value={p.prompt}
              onChange={(e) => p.setPrompt(e.target.value.slice(0, lab.promptMax))}
              rows={3}
              className="w-full resize-none rounded-xl border border-cream/10 bg-surface p-3 pb-6 pr-24 text-sm leading-relaxed text-cream transition-[border-color,box-shadow] placeholder:text-fog focus:border-gold/45 focus:shadow-[0_0_0_3px_rgba(201,169,110,0.1)] focus:outline-none"
              placeholder={
                p.t2vOn
                  ? "Describe the shot…"
                  : "Describe what moves — the start frame already carries the scene…"
              }
            />
            <span className="absolute right-2.5 top-2">{p.enhanceCtl.button}</span>
            <span className="pointer-events-none absolute bottom-2 right-3 text-2xs tabular-nums text-fog">
              {p.prompt.length} / {lab.promptMax}
            </span>
          </div>
          {p.enhanceCtl.card}

          {/* the settings that change every shot, then Generate */}
          <div className="flex flex-wrap items-center gap-2">
            <ModelSelect
              value={p.engineId}
              onChange={p.setEngineId}
              models={lab.engines}
              // the catalog says where each engine runs in `sub` ("cloud · paid")
              cloudIds={lab.engines
                .filter((e) => (e as { sub?: string }).sub?.includes("cloud"))
                .map((e) => e.id)}
              missingLabel={(_, cloud) => (cloud ? "Needs fal.ai key" : "Not set up")}
              className="max-w-[200px]"
            />

            <div
              className={cx("flex items-center gap-1", retake && "pointer-events-none opacity-40")}
              title={retake ? "A retake keeps the source take's length" : "Length"}
            >
              {p.surface.durations.map((d) => (
                <button
                  key={d}
                  onClick={() => p.setDuration(d)}
                  className={cx(
                    "rounded-pill border px-2 py-0.5 text-xs tabular-nums transition duration-[var(--dur-fast)]",
                    d === p.effectiveDuration
                      ? "border-gold/60 bg-gold/12 text-gold"
                      : "border-cream/10 text-cream/75 hover:border-cream/25",
                  )}
                >
                  {parseInt(d)}s
                </button>
              ))}
            </div>

            <SelectBox
              value={p.effectiveResolution}
              onChange={(e) => p.setResolution(e.target.value)}
              title="Size"
              disabled={!!retake}
              style={{ colorScheme: "dark" }}
              className={cx(selectInput, "w-auto max-w-[200px] text-xs disabled:opacity-40")}
            >
              {p.surface.resolutions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </SelectBox>

            {/* Advanced + Generate travel together, so a wrap never strands
                the button that matters on a line of its own */}
            <div className="ml-auto flex shrink-0 items-center gap-2">
            <AdvancedButton
              open={advancedOpen}
              onClick={onToggleAdvanced}
              customs={p.customs}
              hint="Frames, Shot Director, camera, quality, adapters, sound, references, A/B"
            />

            <GenerateButton onClick={p.generate} disabled={generateBlocked}>
              {retake ? <Scissors size={14} /> : <Sparkles size={14} />}{" "}
              {lab.busy
                ? "Generating…"
                : retake
                  ? retake.prompt.trim()
                    ? `Re-render ${fmtTime(retake.lengthSec)}`
                    : "Describe the fix"
                  : p.canGenerate
                    ? "Generate"
                    : "Needs a start frame"}
            </GenerateButton>
            </div>
          </div>

          {sizeNotes.map((n) => (
            <p
              key={n.text}
              className={cx(
                "text-2xs leading-relaxed",
                n.tone === "amber" ? "text-amber-300" : n.tone === "gold" ? "text-gold/80" : "text-fog",
              )}
            >
              {n.text}
            </p>
          ))}

          {lab.error && (
            <p className="rounded-lg border border-red-500/25 bg-red-500/8 px-2.5 py-1.5 text-2xs leading-relaxed text-red-300">
              {lab.error}
            </p>
          )}
          {lab.failures.slice(0, 1).map((f) => (
            <div key={f.id} className="rounded-lg border border-red-500/25 bg-red-500/8 px-2.5 py-1.5">
              <div className="flex items-center gap-1.5">
                <CircleAlert size={12} className="shrink-0 text-red-400" />
                <span className="min-w-0 flex-1 truncate text-2xs font-medium text-cream/90">
                  {f.title} · {f.engine}
                </span>
                <button onClick={() => lab.retry(f.id)} className="shrink-0 text-2xs text-gold hover:underline">
                  Retry
                </button>
              </div>
              {/* ComfyUI's rejection lists every model file it knows — scroll
                * inside the card rather than pushing the composer off screen */}
              <p className="mt-1 max-h-16 overflow-y-auto text-2xs leading-relaxed text-red-300">{f.error}</p>
            </div>
          ))}
        </div>
      </div>
    </ComposerBar>
  );
}
