import { useDraft } from "@/useDraft";
import { AudioLines, Loader2, Pause, Play, Repeat, Sparkles, Trash2, X } from "lucide-react";
import { useSfxLab, type SfxTake } from "@/hooks";
import { useAudioPlayer, type AudioPlayer } from "@/components/useAudioPlayer";
import { SendToTimeline } from "@/components/SendToTimeline";
import { ChoiceChips, ComposerBar, GenerateButton, ModelSelect, Slider, Toggle, cx } from "@/components/ui";

/* Sound FX lab — text → one-shot sound effects and ambience beds.
 *
 * Built for the way sound design actually goes: you rarely want ONE take of
 * a whoosh, you want three and pick the one that sits. So the composer asks
 * for a prompt, a length and how many variations, and every variation lands
 * as its own take on the project's sfx shelf (and on the timeline's SFX lane
 * from the take row). Two engines: ElevenLabs on fal (cloud, priced per
 * second — the estimate is on the button) and MOSS-SoundEffect on the local
 * GPU (free). */

const LENGTH_PRESETS = [1, 2, 4, 8, 15] as const;

export function SfxLab() {
  const lab = useSfxLab();
  const player = useAudioPlayer();
  const [engine, setEngine] = useDraft<"elevenlabs" | "moss">("sfx:engine", "elevenlabs");
  const [prompt, setPrompt] = useDraft("sfx:prompt", "");
  /** seconds; 0 = auto (ElevenLabs picks the natural length, MOSS its default) */
  const [duration, setDuration] = useDraft("sfx:duration", 0);
  const [count, setCount] = useDraft("sfx:count", 2);
  const [influence, setInfluence] = useDraft("sfx:influence", 0.45);
  const [loop, setLoop] = useDraft("sfx:loop", false);

  const picked = lab.engines.find((e) => e.id === engine);
  const cloud = lab.cloudEngines.includes(engine);
  const seconds = duration || (engine === "moss" ? lab.mossDefaultSeconds : 5);
  const cost = cloud ? lab.ratePerSecond.elevenlabs * seconds * count : 0;
  const costLabel = cloud ? `≈ $${cost < 0.1 ? cost.toFixed(3).replace(/0$/, "") : cost.toFixed(2)}` : "free";
  const canGenerate = !!prompt.trim() && !!picked?.available && !lab.submitting;

  const generate = () => {
    if (!canGenerate) return;
    void lab.generate(
      {
        engine,
        prompt: prompt.trim(),
        ...(duration ? { durationSec: duration } : engine === "moss" ? { durationSec: lab.mossDefaultSeconds } : {}),
        ...(engine === "elevenlabs" ? { promptInfluence: influence, loop } : {}),
      },
      count,
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-4 flex items-baseline justify-between">
          <h1 className="font-display text-lg text-cream">Sound FX</h1>
          <span className="text-xs text-fog">
            {lab.takes.filter((t) => !t.generating).length} takes on this project's SFX shelf
          </span>
        </div>

        {lab.failures.length > 0 && (
          <div className="mb-3 space-y-1">
            {lab.failures.map((f) => (
              <p key={f.id} className="rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-1.5 text-xs text-red-200/90">
                <span className="text-red-200">{f.title}</span> — {f.error}
              </p>
            ))}
          </div>
        )}

        {lab.takes.length === 0 ? (
          <EmptyState starters={lab.starters} onPick={setPrompt} />
        ) : (
          <ul className="space-y-1.5">
            {lab.takes.map((t) => (
              <TakeRow
                key={t.id}
                take={t}
                player={player}
                onCancel={lab.cancel}
                onRemove={(rel) => void lab.remove(rel)}
                onReuse={(p) => p && setPrompt(p)}
              />
            ))}
          </ul>
        )}
      </div>

      <ComposerBar>
        <div className="mb-2 flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-fog">
            <AudioLines size={13} /> Describe the source, the action and the space
          </span>
          <span className="flex-1" />
          <ModelSelect
            value={engine}
            onChange={(v) => setEngine(v as "elevenlabs" | "moss")}
            models={lab.engines}
            cloudIds={lab.cloudEngines}
            disableUnavailable
          />
        </div>
        <div className="relative">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value.slice(0, lab.promptMax))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) generate();
            }}
            rows={2}
            className="w-full resize-none rounded-xl border border-cream/10 bg-surface p-3 pb-6 text-sm leading-relaxed text-cream placeholder:text-fog focus:border-gold/45 focus:outline-none"
            placeholder="e.g. One heavy elephant footstep on soft earth and grass, close, no reverb"
          />
          <span className="pointer-events-none absolute bottom-2 right-3 text-2xs tabular-nums text-fog">
            {prompt.length} / {lab.promptMax}
          </span>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-1.5">
            <span className="text-2xs uppercase tracking-wider text-fog">Length</span>
            <ChoiceChips
              value={duration}
              onChange={setDuration}
              options={[
                {
                  value: 0,
                  label: "Auto",
                  title: engine === "moss" ? `MOSS renders ${lab.mossDefaultSeconds}s` : "ElevenLabs picks the natural length",
                },
                ...LENGTH_PRESETS.map((d) => ({ value: d as number, label: `${d}s` })),
              ]}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-2xs uppercase tracking-wider text-fog">Variations</span>
            <ChoiceChips
              value={count}
              onChange={setCount}
              options={Array.from({ length: lab.countMax }, (_, i) => ({ value: i + 1, label: String(i + 1) }))}
            />
          </div>
          {engine === "elevenlabs" && (
            <>
              <label className="flex items-center gap-2 text-xs text-cream/80" title="How literally to follow the prompt">
                Literal
                <Slider value={influence} onChange={setInfluence} min={0} max={1} step={0.05} size="sm" className="w-24" />
                <span className="w-7 tabular-nums text-fog">{influence.toFixed(2)}</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-cream/80" title="Render a seamless loop — for ambience beds">
                <Repeat size={12} /> Loop
                <Toggle on={loop} onChange={() => setLoop((l) => !l)} aria-label="Loop" />
              </label>
            </>
          )}
          <div className="ml-auto">
            <GenerateButton
              onClick={generate}
              disabled={!canGenerate}
              title={!picked?.available ? "This engine isn't available — see its note" : prompt.trim() ? "Generate (Ctrl+Enter)" : "Describe the sound first"}
            >
              <Sparkles size={14} /> Generate {count > 1 ? `${count} takes` : ""} · {costLabel}
            </GenerateButton>
          </div>
        </div>
        {picked?.note && <p className="mt-1.5 text-2xs text-fog">{picked.note}</p>}
      </ComposerBar>
    </div>
  );
}

function EmptyState({ starters, onPick }: { starters: string[]; onPick: (p: string) => void }) {
  return (
    <div className="mx-auto mt-10 max-w-xl text-center">
      <AudioLines className="mx-auto mb-3 text-gold/70" size={28} />
      <p className="text-sm text-cream/85">No sound effects in this project yet.</p>
      <p className="mt-1 text-xs text-fog">Start from one of these, or describe your own.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-1.5">
        {starters.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-full border border-cream/10 px-3 py-1 text-xs text-cream/75 transition hover:border-gold/40 hover:text-gold"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function TakeRow({
  take,
  player,
  onCancel,
  onRemove,
  onReuse,
}: {
  take: SfxTake;
  player: AudioPlayer;
  onCancel: (jobId: string) => void;
  onRemove: (relPath: string) => void;
  onReuse: (prompt?: string) => void;
}) {
  const playing = !!take.url && player.src === take.url && player.playing;
  const engineLabel = take.engine?.startsWith("moss") ? "MOSS" : take.engine ? "ElevenLabs" : "";
  return (
    <li
      className={cx(
        "group flex items-center gap-3 rounded-xl border border-cream/5 bg-surface/60 px-3 py-2",
        playing && "border-gold/30",
      )}
    >
      {take.generating ? (
        <span className="grid size-8 place-items-center rounded-full bg-cream/5 text-gold">
          <Loader2 size={15} className="animate-spin" />
        </span>
      ) : (
        <button
          onClick={() => player.toggle(take.url)}
          className="grid size-8 place-items-center rounded-full bg-gold/15 text-gold transition hover:bg-gold/25"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
        </button>
      )}
      <button className="min-w-0 flex-1 text-left" onClick={() => onReuse(take.prompt)} title="Use this prompt again">
        <p className="truncate text-sm text-cream">{take.title}</p>
        <p className="truncate text-2xs text-fog">
          {take.generating
            ? `${take.generating.stage} · ${Math.round(take.generating.progress)}%`
            : [engineLabel, take.loop ? "loop" : "", take.prompt && take.prompt !== take.title ? take.prompt : ""]
                .filter(Boolean)
                .join(" · ")}
        </p>
        {playing && (
          <div className="mt-1 h-0.5 w-full overflow-hidden rounded bg-cream/10">
            <div className="h-full bg-gold" style={{ width: `${player.played * 100}%` }} />
          </div>
        )}
      </button>
      {take.generating ? (
        <button onClick={() => onCancel(take.id)} className="text-fog transition hover:text-red-300" aria-label="Cancel">
          <X size={14} />
        </button>
      ) : (
        <div className="flex items-center gap-1.5 opacity-70 transition group-hover:opacity-100">
          <SendToTimeline relPath={take.relPath} tone="ghost" />
          {take.relPath && (
            <button
              onClick={() => onRemove(take.relPath!)}
              className="p-1 text-fog transition hover:text-red-300"
              aria-label="Delete take"
              title="Delete this take from disk"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      )}
    </li>
  );
}
