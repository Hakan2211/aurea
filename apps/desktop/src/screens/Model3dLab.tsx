import { useMemo, useState } from "react";
import { useDraft } from "@/useDraft";
import { Box, Grid3x3, Image as ImageIcon, RotateCw, Sparkles, Trash2, X } from "lucide-react";
import { useModel3dLab, type Model3dItem } from "@/hooks";
import { GlbViewer } from "@/components/GlbViewer";
import {
  AdvancedButton,
  ChoiceChips,
  ComposerBar,
  DrawerSection,
  GenerateButton,
  GhostButton,
  LabDrawer,
  Progress,
  ScreenHeader,
  Segmented,
  Toggle,
  customsSummary,
  cx,
  useLabDrawer,
} from "@/components/ui";

/* 3D lab — a concept still becomes a mesh you can turn.
 *
 * Two ways in, and they are genuinely different tasks rather than two skins
 * on one form. FROM A PROMPT is the exploratory one: you describe a thing and
 * the lab draws the clean, centred, white-background plate the shape model
 * wants before lifting it, so the framing that decides whether the run works
 * at all is never left to the operator. FROM AN IMAGE is the production one:
 * a keyframe or a photo you already trust, lifted as-is.
 *
 * The mesh settings are shared because the mesh stage is identical either
 * way — only the source differs. Layout follows the other labs (UI simplify
 * plan, Stage 3): shelf and viewport on top, composer underneath, Detail /
 * Texture / plate model in the Advanced drawer. The viewport is the biggest
 * thing on screen, because a mesh is the one thing here that a thumbnail
 * cannot tell you the truth about. */

type Mode = "prompt" | "image";

/** The UI is English, so pin the separator: on a European locale
 * `(60000).toLocaleString()` renders "60.000", which reads as sixty. */
const faces = (n: number) => n.toLocaleString("en-US");

const fmtBytes = (b?: number) =>
  b === undefined ? "" : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;

export function Model3dLab() {
  const lab = useModel3dLab();
  const [mode, setMode] = useDraft<Mode>("model3d:mode", "prompt");
  const [subject, setSubject] = useDraft("model3d:subject", "");
  const [source, setSource] = useDraft<string>("model3d:source", "");
  const [textured, setTextured] = useDraft("model3d:textured", true);
  const [octree, setOctree] = useDraft("model3d:octree", lab.defaults.octree as number);
  const [textureSize, setTextureSize] = useDraft("model3d:textureSize", lab.defaults.textureSize as number);
  const [conceptModel, setConceptModel] = useDraft<string | null>("model3d:conceptModel", null);
  const [selectedId, setSelectedId] = useDraft<string | null>("model3d:selectedId", null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [wireframe, setWireframe] = useState(false);

  const { drawer, setDrawer, toggle } = useLabDrawer("3d", ["advanced"] as const);

  const engine = lab.engines[0];
  const selected: Model3dItem | undefined = useMemo(
    () => lab.items.find((i) => i.id === selectedId) ?? lab.items.find((i) => i.url),
    [lab.items, selectedId],
  );

  // photoreal beats fast for a plate a shape model has to read detail off,
  // so prefer Krea 2 when it is installed rather than the roster's first entry
  const defaultDrawer =
    lab.conceptModels.find((m) => m.id === "krea2")?.id ?? lab.conceptModels[0]?.id ?? "z-image";
  const drawnBy = conceptModel ?? defaultDrawer;
  /** what a plain run would not send — the composer's "N custom" chip */
  const customs: string[] = [];
  if (mode === "prompt" && conceptModel && conceptModel !== defaultDrawer)
    customs.push(`Drawn by ${lab.conceptModels.find((m) => m.id === conceptModel)?.label ?? conceptModel}`);
  if (octree !== lab.defaults.octree)
    customs.push(`Detail: ${lab.octreeChoices.find((c) => c.value === octree)?.label ?? octree}`);
  if (!textured) customs.push("Untextured");
  else if (textureSize !== lab.defaults.textureSize) customs.push(`Texture ${textureSize}px`);

  const ready =
    mode === "prompt"
      ? subject.trim().length > 0 && lab.conceptModels.length > 0
      : source.length > 0;
  const submit = () => {
    if (!ready) return;
    const shape = { textured, octree, ...(textured ? { textureSize } : {}) };
    if (mode === "prompt")
      lab.fromPrompt({ subject: subject.trim(), model: drawnBy, ...shape });
    else lab.fromImage({ source, ...shape });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScreenHeader
        title="3D"
        // the catalog's note says which half is missing when it isn't there;
        // this engine has no managed install to point anyone at
        sub={engine ? `${engine.label} · ${engine.note}` : "No 3D engine"}
      >
        <span className="text-xs text-fog">
          {lab.items.filter((i) => i.url).length} model
          {lab.items.filter((i) => i.url).length === 1 ? "" : "s"}
        </span>
      </ScreenHeader>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
        {/* --------------------------------------------------------- shelf */}
        <section className="flex w-[280px] shrink-0 flex-col border-r hairline">
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {lab.failures.map((f) => (
              <div key={f.id} className="mb-2 rounded-lg border border-ember/40 bg-ember/10 p-2.5">
                <p className="text-xs font-medium text-cream">{f.title}</p>
                <p className="mt-0.5 text-xs leading-snug text-fog">{f.error}</p>
              </div>
            ))}
            {lab.items.length === 0 && (
              <p className="p-4 text-center text-xs text-fog">
                Nothing here yet. Describe an object below.
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              {lab.items.map((item) => (
                <ShelfRow
                  key={item.id}
                  item={item}
                  selected={item.id === selected?.id}
                  onSelect={() => setSelectedId(item.id)}
                  onCancel={() => item.generating && lab.cancel(item.generating.jobId)}
                  onRemove={() => item.relPath && lab.remove([item.relPath])}
                />
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- viewport */}
        <section className="flex min-w-0 flex-1 flex-col">
          {selected?.url ? (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b hairline px-4 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-cream">{selected.name}</p>
                  <p className="text-xs text-fog">
                    {[
                      selected.faces !== undefined
                        ? `${faces(selected.faces)} faces`
                        : "",
                      selected.textured ? "PBR textured" : "untextured",
                      fmtBytes(selected.sizeBytes),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  <GhostButton
                    onClick={() => setAutoRotate((v) => !v)}
                    className={autoRotate ? "text-gold" : undefined}
                    title="Turntable"
                  >
                    <RotateCw className="size-4" />
                  </GhostButton>
                  <GhostButton
                    onClick={() => setWireframe((v) => !v)}
                    className={wireframe ? "text-gold" : undefined}
                    title="Wireframe"
                  >
                    <Grid3x3 className="size-4" />
                  </GhostButton>
                </div>
              </div>
              <GlbViewer
                key={selected.id}
                url={selected.url}
                autoRotate={autoRotate}
                wireframe={wireframe}
                className="flex-1"
              />
              {selected.sourceUrl && (
                <div className="flex shrink-0 items-center gap-3 border-t hairline px-4 py-2.5">
                  <img
                    src={selected.sourceUrl}
                    alt=""
                    className="size-12 shrink-0 rounded-lg object-cover"
                  />
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide text-fog">Lifted from</p>
                    <p className="truncate text-xs text-cream">the concept still</p>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="grid flex-1 place-items-center">
              <div className="text-center">
                <Box className="mx-auto size-8 text-fog/50" />
                <p className="mt-2 text-xs text-fog">
                  {lab.items.some((i) => i.generating)
                    ? "Your model is being made…"
                    : "Select a model to turn it"}
                </p>
              </div>
            </div>
          )}
        </section>
        </div>

        <ComposerBar>
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: "prompt", label: "From a prompt", title: "Describe a thing; Aurea draws a clean plate first, then lifts it" },
                { value: "image", label: "From an image", title: "Lift a still you already trust, as-is" },
              ]}
            />
            <span className="min-w-0 flex-1 truncate text-2xs text-fog">
              {mode === "prompt"
                ? "Name the object, not the photo. Aurea draws it centred on white with even light first — the framing the shape model expects — then lifts it into a mesh."
                : "A single subject on a plain background works best. Anything else has its background removed first."}
            </span>
          </div>

          {mode === "prompt" ? (
            lab.conceptModels.length === 0 ? (
              <p className="rounded-xl border border-ember/30 bg-ember/8 px-3 py-2.5 text-xs leading-snug text-ember">
                No image engine installed, so there is nothing to draw the plate with. Use “From an
                image” instead.
              </p>
            ) : (
              <textarea
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
                }}
                rows={2}
                maxLength={400}
                placeholder="a dented brass kettle with a wooden handle"
                className="w-full resize-none rounded-xl border border-cream/10 bg-surface p-3 text-sm leading-relaxed text-cream transition-[border-color,box-shadow] placeholder:text-fog focus:border-gold/45 focus:shadow-[0_0_0_3px_rgba(201,169,110,0.1)] focus:outline-none"
              />
            )
          ) : lab.stills.length === 0 ? (
            <p className="rounded-xl border border-cream/10 px-3 py-2.5 text-xs text-fog">
              No stills in this project yet. Make one in Create › Image, or switch to “From a prompt”.
            </p>
          ) : (
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {lab.stills.map((st) => (
                <button
                  key={st.relPath}
                  onClick={() => setSource(st.relPath)}
                  title={st.name}
                  className={cx(
                    "h-16 w-16 shrink-0 overflow-hidden rounded-lg border transition duration-[var(--dur-fast)]",
                    st.relPath === source ? "border-gold ring-1 ring-gold/60" : "border-cream/10 hover:border-cream/30",
                  )}
                >
                  <img src={st.url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-2xs text-fog" title={lab.license}>
              {lab.license}
            </span>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <AdvancedButton
                open={drawer === "advanced"}
                onClick={() => toggle("advanced")}
                customs={customs}
                hint="Detail, textures, which model draws the plate"
              />
              <GenerateButton
                onClick={submit}
                disabled={!ready || !engine?.available || lab.sending}
                title={!engine?.available ? "No 3D engine available" : undefined}
              >
                <Sparkles className="size-4" />
                {lab.sending
                  ? "Queueing…"
                  : ready
                    ? "Generate model"
                    : mode === "prompt"
                      ? "Name an object"
                      : "Pick a still"}
              </GenerateButton>
            </div>
          </div>
        </ComposerBar>
        </div>

        {drawer === "advanced" && (
          <LabDrawer title="Advanced" summary={customsSummary(customs)} onClose={() => setDrawer(null)} width={320}>
            {mode === "prompt" && lab.conceptModels.length > 1 && (
              <DrawerSection title="Plate drawn by" note="Photoreal models give the shape model more detail to read.">
                <ChoiceChips
                  value={drawnBy}
                  onChange={setConceptModel}
                  options={lab.conceptModels.map((m) => ({ value: m.id, label: m.label, title: m.note }))}
                />
              </DrawerSection>
            )}
            <DrawerSection title="Detail" note={lab.octreeChoices.find((c) => c.value === octree)?.note}>
              <ChoiceChips
                value={octree}
                onChange={setOctree}
                options={lab.octreeChoices.map((c) => ({ value: c.value, label: c.label, title: c.note }))}
              />
            </DrawerSection>
            <DrawerSection
              title="Texture"
              note={
                textured
                  ? undefined
                  : "Grey geometry only, in about a third of the time. Right while you are still deciding the silhouette."
              }
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-cream">Paint PBR textures</span>
                <Toggle on={textured} onChange={() => setTextured((v) => !v)} />
              </div>
              {textured && (
                <ChoiceChips
                  className="mt-2.5"
                  value={textureSize}
                  onChange={setTextureSize}
                  options={lab.textureSizes.map((size) => ({ value: size, label: `${size}px` }))}
                />
              )}
            </DrawerSection>
          </LabDrawer>
        )}
      </div>
    </div>
  );
}

function ShelfRow({
  item,
  selected,
  onSelect,
  onCancel,
  onRemove,
}: {
  item: Model3dItem;
  selected: boolean;
  onSelect: () => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const gen = item.generating;
  return (
    <div
      onClick={gen ? undefined : onSelect}
      className={cx(
        "group flex items-center gap-2.5 rounded-lg border p-2 transition duration-[var(--dur-fast)]",
        gen
          ? "border-cream/10"
          : selected
            ? "cursor-pointer border-gold bg-gold/5"
            : "cursor-pointer border-transparent hover:bg-raised",
      )}
    >
      <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-gradient-to-br from-[#2f2a4a] to-[#0d0b16]">
        {item.sourceUrl ? (
          <img src={item.sourceUrl} alt="" className="h-full w-full object-cover" />
        ) : gen ? (
          <ImageIcon className="size-4 text-fog" />
        ) : (
          <Box className="size-4 text-fog" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-cream">{item.name}</p>
        {gen ? (
          <>
            <p className="truncate text-xs text-fog">{gen.stage}</p>
            <Progress value={gen.progress} className="mt-1" />
          </>
        ) : (
          <p className="truncate text-xs text-fog">
            {[
              item.faces !== undefined ? `${faces(item.faces)} faces` : "",
              item.textured ? "textured" : "untextured",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </div>
      {gen ? (
        <span onClick={(e) => e.stopPropagation()}>
          <GhostButton onClick={onCancel} title="Cancel">
            <X className="size-3.5" />
          </GhostButton>
        </span>
      ) : (
        <span onClick={(e) => e.stopPropagation()}>
        <GhostButton
          className="opacity-0 transition group-hover:opacity-100"
          onClick={onRemove}
          title="Delete"
        >
          <Trash2 className="size-3.5" />
        </GhostButton>
        </span>
      )}
    </div>
  );
}
