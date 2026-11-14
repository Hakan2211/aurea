import { Dices, RefreshCw } from "lucide-react";
import {
  ChoiceChips,
  DrawerField,
  DrawerSection,
  LabDrawer,
  customsSummary,
  cx,
  drawerInput,
} from "@/components/ui";
import { LAST_SEED, type ImageParams } from "./useImageParams";

/* The Image lab's Advanced drawer (UI simplify plan, Stage 3): every setting
 * a plain run doesn't need — style preset, seed, the cloud model's quality and
 * format, exact pixels and the local sampler's steps/CFG. Same state as the
 * composer (useImageParams), so the drawer never changes what Generate sends. */

export function ImageAdvanced({ p, onClose }: { p: ImageParams; onClose: () => void }) {
  const {
    lab, mode, preset, setPreset, seed, setSeed, isCloud, quality, setQuality,
    outputFormat, setOutputFormat, width, setWidth, height, setHeight, steps, setSteps,
    cfg, setCfg, adv, defaults, sizeMax, sizeIsAuto, aspect, sizeIssue, customs,
  } = p;

  return (
    <LabDrawer title="Advanced" summary={customsSummary(customs)} onClose={onClose}>
      <DrawerSection
        title="Style preset"
        note={
          preset
            ? `Appends “${preset.toLowerCase()} style”. Click again to clear.`
            : "None — your prompt goes to the model as written."
        }
      >
        <div className="flex flex-wrap gap-1.5">
          {lab.presets.map((x) => (
            <button
              key={x}
              onClick={() => setPreset(preset === x ? null : x)}
              className={cx(
                "rounded-full border px-2.5 py-1 text-xs transition",
                preset === x
                  ? "border-gold/60 bg-gold/12 text-gold"
                  : "border-cream/10 text-cream/70 hover:border-gold/35 hover:text-cream",
              )}
            >
              {x}
            </button>
          ))}
        </div>
      </DrawerSection>

      <DrawerSection title="Seed" note="Same seed + same settings = the same image.">
        <div className="flex items-center gap-1.5">
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))}
            placeholder="random"
            className="min-w-0 flex-1 rounded-lg border border-cream/10 bg-surface px-3 py-2 text-sm tabular-nums text-cream placeholder:text-fog/50 focus:border-gold/40 focus:outline-none"
          />
          <button
            title="Random seed"
            onClick={() => setSeed(String(Math.floor(Math.random() * 1_000_000_000)))}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cream/10 text-cream/70 transition hover:border-gold/40 hover:text-gold"
          >
            <Dices size={14} />
          </button>
          <button
            title="Reuse last seed"
            onClick={() => setSeed(String(LAST_SEED))}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cream/10 text-cream/70 transition hover:border-gold/40 hover:text-gold"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </DrawerSection>

      {isCloud && (
        <DrawerSection
          title="Quality"
          note="Quality drives the bill — low is roughly a cent an image, high is ~15× that."
        >
          <ChoiceChips
            value={quality}
            onChange={setQuality}
            options={lab.qualities.map((q) => ({ value: q, label: <span className="capitalize">{q}</span> }))}
          />
        </DrawerSection>
      )}

      {isCloud && (
        <DrawerSection title="Output format">
          <ChoiceChips
            value={outputFormat}
            onChange={setOutputFormat}
            options={lab.outputFormats.map((f) => ({ value: f, label: f.toUpperCase() }))}
          />
        </DrawerSection>
      )}

      <DrawerSection
        title={isCloud ? "Exact size" : "Exact size & sampler"}
        note={
          sizeIsAuto
            ? "Size is set to Auto in the composer — pick an aspect there to use width and height."
            : isCloud
              ? `Width + height override the aspect: multiples of 16, no edge over ${sizeMax}px, at least ~0.66 MP, aspect within 3:1.`
              : "Width + height override the aspect. Blank = the model's proven defaults."
        }
      >
        <DrawerField label="Width">
          <input
            type="number"
            value={width}
            min={adv.sizeMin}
            max={sizeMax}
            step={adv.sizeStep}
            placeholder={sizeIsAuto ? (mode === "edit" ? "matches refs" : "auto") : `${aspect} auto`}
            onChange={(e) => setWidth(e.target.value)}
            className={drawerInput}
          />
        </DrawerField>
        <DrawerField label="Height">
          <input
            type="number"
            value={height}
            min={adv.sizeMin}
            max={sizeMax}
            step={adv.sizeStep}
            placeholder={sizeIsAuto ? (mode === "edit" ? "matches refs" : "auto") : `${aspect} auto`}
            onChange={(e) => setHeight(e.target.value)}
            className={drawerInput}
          />
        </DrawerField>
        {/* steps/cfg are sampler knobs on the local graphs — the cloud
            endpoint exposes quality instead, so showing them would be a
            pair of controls that silently do nothing */}
        {!isCloud && (
          <>
            <DrawerField label="Steps">
              <input
                type="number"
                value={steps}
                min={1}
                max={adv.stepsMax}
                placeholder={String(defaults?.steps ?? "auto")}
                onChange={(e) => setSteps(e.target.value)}
                className={drawerInput}
              />
            </DrawerField>
            <DrawerField label="CFG">
              <input
                type="number"
                value={cfg}
                min={0}
                max={adv.cfgMax}
                step={0.5}
                placeholder={String(defaults?.cfg ?? "auto")}
                onChange={(e) => setCfg(e.target.value)}
                className={drawerInput}
              />
            </DrawerField>
          </>
        )}
        {sizeIssue && (
          <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/8 px-2.5 py-1.5 text-2xs leading-relaxed text-amber-300">
            fal won't accept that size — {sizeIssue}.
          </p>
        )}
      </DrawerSection>
    </LabDrawer>
  );
}
