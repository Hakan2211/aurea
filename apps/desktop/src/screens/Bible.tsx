/* Bible — the persistent cast & world memory (S-P1). Laid out after the
 * "Characters Bible" design frame: character avatar rail on the left, the
 * turnaround-sheet profile in the center, voice / personality / LoRA cards on
 * the right. Locations and the style bible live behind the rail tabs. Edits
 * are debounced whole-entity upserts (timeline precedent: renderer owns edit
 * state, bible.json is the truth). */

import { useRef, useState } from "react";
import {
  Crosshair,
  Expand,
  ImagePlus,
  Images,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import type { BibleCharacter, BibleLocation, BibleStyle } from "@aurea/shared";
import { Chip, GhostButton, GoldButton, Waveform, cx } from "@/components/ui";
import { fileToPngBase64 } from "@/components/imageFile";
import { useBible, useDraft } from "@/hooks";

const sectionLabel = "text-[10px] font-semibold uppercase tracking-[0.16em] text-fog";
const card = "rounded-xl border hairline bg-surface p-3";
const fieldLabel = "mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-fog";
const textInput =
  "w-full rounded-lg border border-cream/10 bg-ink/60 px-2.5 py-1.5 text-[12px] text-cream " +
  "outline-none placeholder:text-fog/60 focus:border-gold/40";
const textArea = cx(textInput, "min-h-[64px] resize-y leading-relaxed");

const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

const fmtDay = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

type Tab = "cast" | "locations" | "style";

export function BibleScreen() {
  const bible = useBible();
  const [tab, setTab] = useState<Tab>("cast");
  const [charId, setCharId] = useState<string | null>(null);
  const [locId, setLocId] = useState<string | null>(null);

  const selectedChar =
    bible.bible.characters.find((c) => c.id === charId) ?? bible.bible.characters[0] ?? null;
  const selectedLoc =
    bible.bible.locations.find((l) => l.id === locId) ?? bible.bible.locations[0] ?? null;

  return (
    <div className="flex h-full">
      <Rail
        bible={bible}
        tab={tab}
        setTab={setTab}
        selectedCharId={selectedChar?.id ?? null}
        selectCharacter={setCharId}
        selectedLocId={selectedLoc?.id ?? null}
        selectLocation={setLocId}
      />

      {tab === "cast" &&
        (selectedChar ? (
          <CharacterDetail key={selectedChar.id} character={selectedChar} bible={bible} />
        ) : (
          <EmptyState bible={bible} />
        ))}
      {tab === "locations" &&
        (selectedLoc ? (
          <LocationDetail key={selectedLoc.id} location={selectedLoc} bible={bible} />
        ) : (
          <EmptyState bible={bible} />
        ))}
      {tab === "style" && <StyleDetail key={bible.project} bible={bible} />}
    </div>
  );
}

/* ---------- left rail ---------- */

function Rail({
  bible,
  tab,
  setTab,
  selectedCharId,
  selectCharacter,
  selectedLocId,
  selectLocation,
}: {
  bible: ReturnType<typeof useBible>;
  tab: Tab;
  setTab: (t: Tab) => void;
  selectedCharId: string | null;
  selectCharacter: (id: string) => void;
  selectedLocId: string | null;
  selectLocation: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const addEntity = () => {
    const name = newName.trim();
    if (!name) return;
    const id = slugify(name) || "new";
    if (tab === "cast") {
      bible.upsertCharacter({
        id, name, species: "", build: "", face: "", wardrobe: "", props: "", colors: "",
        signatureFeature: "", anchors: { body: "", face: "", macro: "" }, personality: "",
        speechPattern: "",
        voice: { voiceId: null, engine: "chatterbox", exaggeration: 0.5, cfgWeight: 0.4, deliveryNotes: "" },
        refs: { keyframeRef: null, turnaround: null, hero: null, sheet: null, frames: [], dataset: [], custom: [] },
        lora: null,
      });
      selectCharacter(id);
    } else if (tab === "locations") {
      bible.upsertLocation({ id, name, description: "", stylePrompt: "", refs: [] });
      selectLocation(id);
    }
    setNewName("");
    setAdding(false);
  };

  return (
    <aside className="flex w-[232px] shrink-0 flex-col border-r hairline bg-[#0e0e10]">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <span className="font-serif text-[15px] font-semibold text-cream">Bible</span>
        {tab !== "style" && (
          <button
            title={tab === "cast" ? "New character" : "New location"}
            onClick={() => setAdding((a) => !a)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-fog transition hover:bg-cream/5 hover:text-cream"
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      <div className="mx-4 mb-3 flex gap-1 rounded-lg border hairline bg-ink/40 p-0.5">
        {(["cast", "locations", "style"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cx(
              "flex-1 rounded-md px-1 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] transition",
              tab === t ? "bg-gold/15 text-gold" : "text-fog hover:text-cream",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {adding && tab !== "style" && (
        <div className="mx-4 mb-2 flex gap-1.5">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addEntity()}
            placeholder={tab === "cast" ? "Character name" : "Location name"}
            className={textInput}
          />
          <GoldButton onClick={addEntity}>Add</GoldButton>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {tab === "cast" &&
          bible.bible.characters.map((c) => {
            const url = bible.refUrl(c.refs.hero ?? c.refs.turnaround ?? c.refs.sheet);
            const active = c.id === selectedCharId;
            return (
              <button
                key={c.id}
                onClick={() => selectCharacter(c.id)}
                className={cx(
                  "flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition",
                  active ? "bg-gold/10" : "hover:bg-cream/5",
                )}
              >
                <span
                  className={cx(
                    "flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border",
                    active ? "border-gold/70" : "border-cream/10",
                  )}
                >
                  {url ? (
                    <img src={url} alt="" className="h-full w-full object-cover object-top" />
                  ) : (
                    <span className="font-serif text-sm text-gold">{c.name.charAt(0)}</span>
                  )}
                </span>
                <span className="min-w-0">
                  <span className={cx("block truncate text-[12px] font-medium", active ? "text-gold" : "text-cream")}>
                    {c.name}
                  </span>
                  <span className="block truncate text-[10px] text-fog">{c.species || "—"}</span>
                </span>
              </button>
            );
          })}

        {tab === "locations" &&
          bible.bible.locations.map((l) => {
            const url = bible.refUrl(l.refs[0]);
            const active = l.id === selectedLocId;
            return (
              <button
                key={l.id}
                onClick={() => selectLocation(l.id)}
                className={cx(
                  "flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition",
                  active ? "bg-gold/10" : "hover:bg-cream/5",
                )}
              >
                <span
                  className={cx(
                    "h-9 w-12 shrink-0 overflow-hidden rounded-lg border",
                    active ? "border-gold/70" : "border-cream/10",
                    !url && "bg-gradient-to-br from-[#2c3a4a] to-[#0a0e14]",
                  )}
                >
                  {url && <img src={url} alt="" className="h-full w-full object-cover" />}
                </span>
                <span className="min-w-0">
                  <span className={cx("block truncate text-[12px] font-medium", active ? "text-gold" : "text-cream")}>
                    {l.name}
                  </span>
                  <span className="block truncate text-[10px] text-fog">{l.description || "—"}</span>
                </span>
              </button>
            );
          })}

        {tab === "style" && (
          <p className="px-2 pt-1 text-[11px] leading-relaxed text-fog">
            Art direction, negative prompt and cinematography notes — the global look every
            keyframe and shot prompt inherits.
          </p>
        )}
      </div>

      <SeedBlock bible={bible} />
    </aside>
  );
}

function SeedBlock({ bible }: { bible: ReturnType<typeof useBible> }) {
  const empty = bible.bible.characters.length === 0;
  return (
    <div className="border-t hairline p-3">
      {empty ? (
        <GoldButton className="w-full justify-center" onClick={() => void bible.seed()}>
          <Sparkles size={13} />
          {bible.seeding ? "Seeding…" : "Seed Animal Sitcom"}
        </GoldButton>
      ) : (
        <GhostButton className="w-full justify-center" onClick={() => void bible.seed()}>
          <RefreshCw size={12} className={bible.seeding ? "animate-spin" : undefined} />
          {bible.seeding ? "Re-seeding…" : "Re-run seed"}
        </GhostButton>
      )}
      {bible.seedError && <p className="mt-2 text-[10px] leading-snug text-[#e07a6b]">{bible.seedError}</p>}
      {bible.seedResult && !bible.seeding && (
        <p className="mt-2 text-[10px] leading-snug text-fog">
          {bible.seedResult.copiedFiles} files copied
          {bible.seedResult.warnings.length > 0 && ` · ${bible.seedResult.warnings.length} warnings`}
        </p>
      )}
      {(bible.seedResult?.warnings ?? []).slice(0, 3).map((w, i) => (
        <p key={i} className="mt-1 truncate text-[9px] text-fog/70" title={w}>
          {w}
        </p>
      ))}
    </div>
  );
}

function EmptyState({ bible }: { bible: ReturnType<typeof useBible> }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <span className="font-serif text-xl text-cream">The bible is empty</span>
      <p className="max-w-[340px] text-[12px] leading-relaxed text-fog">
        {bible.live
          ? "Seed the Animal Sitcom cast from your videofast character sheets, or add a character with the + button."
          : "Waiting for the studio core…"}
      </p>
      {bible.live && (
        <GoldButton onClick={() => void bible.seed()}>
          <Sparkles size={13} />
          {bible.seeding ? "Seeding…" : "Seed Animal Sitcom"}
        </GoldButton>
      )}
    </div>
  );
}

/* ---------- character detail ---------- */

function CharacterDetail({
  character,
  bible,
}: {
  character: BibleCharacter;
  bible: ReturnType<typeof useBible>;
}) {
  const { draft, patch } = useDraft(character, bible.upsertCharacter);
  const [zoom, setZoom] = useState<string | null>(null);

  const strip = refEntries(draft.refs);

  return (
    <>
      <section className="flex min-w-0 flex-1 flex-col overflow-y-auto px-6 py-5">
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-[32px] font-semibold leading-tight tracking-wide text-cream">
              {draft.name}
            </h1>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-fog">
              Character profile
            </p>
          </div>
          <div className="flex items-center gap-2">
            {draft.species && <Chip tone="gold">{draft.species}</Chip>}
            <button
              title="Remove character"
              onClick={() => bible.removeCharacter(draft.id)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-fog transition hover:bg-ember/20 hover:text-[#e07a6b]"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </header>

        <ReferenceManager draft={draft} patch={patch} bible={bible} onZoom={setZoom} />

        {/* structured appearance slots */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          {(
            [
              ["Species / build", "build"],
              ["Face", "face"],
              ["Wardrobe", "wardrobe"],
              ["Props", "props"],
              ["Colors", "colors"],
              ["Signature feature", "signatureFeature"],
            ] as const
          ).map(([label, key]) => (
            <label key={key} className="block">
              <span className={fieldLabel}>{label}</span>
              <textarea
                className={textArea}
                value={draft[key]}
                onChange={(e) => patch({ [key]: e.target.value } as Partial<BibleCharacter>)}
              />
            </label>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-3 gap-3">
          {(
            [
              ["Anchor — body", "body"],
              ["Anchor — face", "face"],
              ["Anchor — macro", "macro"],
            ] as const
          ).map(([label, key]) => (
            <label key={key} className="block">
              <span className={fieldLabel}>{label}</span>
              <textarea
                className={textArea}
                value={draft.anchors[key]}
                onChange={(e) => patch({ anchors: { ...draft.anchors, [key]: e.target.value } })}
              />
            </label>
          ))}
        </div>

        <footer className="mt-5 flex items-center gap-6 border-t hairline pt-3 text-[10px] uppercase tracking-[0.12em] text-fog">
          <span>
            Updated <span className="text-cream/80">{fmtDay(bible.bible.updatedAt)}</span>
          </span>
          <span>
            Seed <span className="text-cream/80">{draft.seed ?? "—"}</span>
          </span>
          <span>
            References <span className="text-cream/80">{strip.length}</span>
          </span>
        </footer>
      </section>

      {/* right column */}
      <aside className="w-[300px] shrink-0 space-y-3 overflow-y-auto border-l hairline p-3">
        <VoiceCard draft={draft} patch={patch} bible={bible} />

        <div className={card}>
          <div className="mb-1.5 flex items-center justify-between">
            <span className={sectionLabel}>Personality prompt</span>
            <span className="text-[10px] text-fog">{draft.personality.length} / 600</span>
          </div>
          <textarea
            className={cx(textArea, "min-h-[110px]")}
            maxLength={600}
            value={draft.personality}
            onChange={(e) => patch({ personality: e.target.value })}
          />
          <span className={cx(fieldLabel, "mt-2.5")}>Speech pattern</span>
          <textarea
            className={textArea}
            value={draft.speechPattern}
            onChange={(e) => patch({ speechPattern: e.target.value })}
          />
        </div>

        <div className={card}>
          <span className={sectionLabel}>LoRA status</span>
          <div className="mt-2 flex items-center justify-between rounded-lg border border-cream/10 bg-ink/50 px-2.5 py-2">
            <span className="text-[11px] text-fog">
              {draft.lora ? `Trained · ${draft.lora.trigger || draft.lora.asset}` : "Not trained"}
            </span>
            <Chip tone={draft.lora ? "sage" : "muted"}>{draft.lora ? "ready" : "S-P2"}</Chip>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-fog/80">
            Character LoRA training lands with shot generation — reference frames above become the
            training set.
          </p>
        </div>
      </aside>

      {zoom && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-ink/90 backdrop-blur-sm"
          onClick={() => setZoom(null)}
        >
          <button className="absolute right-4 top-4 text-fog transition hover:text-cream">
            <X size={18} />
          </button>
          <img src={zoom} alt="" className="max-h-[92vh] max-w-[92vw] rounded-xl object-contain" />
        </div>
      )}
    </>
  );
}

/* ---------- reference images ---------- */

type RefSlot = "keyframeRef" | "hero" | "turnaround" | "sheet";

/** The four named slots, in the order they matter. `keyframeRef` is the one
 * with teeth: composeKeyframePrompt / composeShotSpec feed it to qwen-edit as
 * the subject image, so a wrong picture here puts a wrong character on screen. */
const SLOTS: { slot: RefSlot; label: string; icon: typeof Star; hint: string }[] = [
  {
    slot: "keyframeRef",
    label: "Key ref",
    icon: Crosshair,
    hint: "The subject image every storyboard keyframe and shot prompt is built from",
  },
  { slot: "hero", label: "Hero", icon: Star, hint: "The clean full-body hero frame" },
  { slot: "turnaround", label: "Turnaround", icon: RotateCw, hint: "Front / side / back views" },
  { slot: "sheet", label: "Sheet", icon: Images, hint: "Composite contact sheet" },
];

const SLOT_LABEL: Record<RefSlot, string> = {
  keyframeRef: "Key ref",
  hero: "Hero",
  turnaround: "Turnaround",
  sheet: "Sheet",
};

type RefEntry = { rel: string; roles: string[] };

/** Every image attached to a character, de-duplicated (one picture can hold
 * several roles), most important first. */
function refEntries(refs: BibleCharacter["refs"]): RefEntry[] {
  const roles = new Map<string, string[]>();
  const push = (rel: string | null | undefined, role: string) => {
    if (!rel) return;
    const at = roles.get(rel);
    if (at) {
      if (!at.includes(role)) at.push(role);
    } else roles.set(rel, [role]);
  };
  for (const { slot } of SLOTS) push(refs[slot], SLOT_LABEL[slot]);
  refs.frames.forEach((r) => push(r, "Frame"));
  refs.dataset.forEach((r) => push(r, "Dataset"));
  refs.custom.forEach((r) => push(r, "Upload"));
  return [...roles].map(([rel, r]) => ({ rel, roles: r }));
}

const fileName = (rel: string) => rel.split("/").at(-1) ?? rel;

/** A reference the user staged here (or in the image lab) rather than one the
 * seed copied in — those are ours to delete outright when they're dropped. */
const isStaged = (rel: string) => rel.includes("/refs/");

/** The character's picture library: pick one to inspect, promote it into a
 * slot, drop it, or upload replacements. Before this the Bible was read-only —
 * a wrong seeded image was stuck on the character for good. */
function ReferenceManager({
  draft,
  patch,
  bible,
  onZoom,
}: {
  draft: BibleCharacter;
  patch: (p: Partial<BibleCharacter>) => void;
  bible: ReturnType<typeof useBible>;
  onZoom: (url: string) => void;
}) {
  const entries = refEntries(draft.refs);
  const [selRel, setSelRel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const selected = entries.find((e) => e.rel === selRel) ?? entries[0] ?? null;
  const url = bible.refUrl(selected?.rel);

  const setSlot = (slot: RefSlot, rel: string | null) =>
    patch({ refs: { ...draft.refs, [slot]: rel } });

  /** unlink from every slot and list — plus delete the file when it was one of
   * ours (a staged upload), so dropping it doesn't leave litter behind */
  const detach = (rel: string) => {
    const r = draft.refs;
    patch({
      refs: {
        keyframeRef: r.keyframeRef === rel ? null : r.keyframeRef,
        turnaround: r.turnaround === rel ? null : r.turnaround,
        hero: r.hero === rel ? null : r.hero,
        sheet: r.sheet === rel ? null : r.sheet,
        frames: r.frames.filter((x) => x !== rel),
        dataset: r.dataset.filter((x) => x !== rel),
        custom: r.custom.filter((x) => x !== rel),
      },
    });
    if (selRel === rel) setSelRel(null);
    if (isStaged(rel)) void bible.deleteRefFile(rel).catch(() => {});
  };

  /** upload → project refs/ → the character's custom list. The first picture a
   * character ever gets also becomes its key ref: an unassigned slot is the
   * commonest reason a boarded shot comes back off-model. */
  const upload = async (files: FileList | File[]) => {
    setError(null);
    const added: string[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const png = await fileToPngBase64(file);
        added.push(await bible.uploadRef(file.name.replace(/\.[^.]+$/, "") || draft.id, png));
      } catch (err) {
        setError(String((err as Error).message ?? err));
      }
    }
    if (added.length === 0) return;
    const hadNone = entries.length === 0;
    patch({
      refs: {
        ...draft.refs,
        custom: [...draft.refs.custom, ...added],
        ...(hadNone ? { keyframeRef: added[0], hero: draft.refs.hero ?? added[0] } : {}),
      },
    });
    setSelRel(added[0]);
  };

  const pickFiles = () => fileInput.current?.click();

  return (
    <div className={cx(card, "p-0")}>
      <div className="flex items-center justify-between gap-3 border-b hairline px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span className={sectionLabel}>References</span>
          <span className="text-[10px] tabular-nums text-fog/70">{entries.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {url && (
            <button
              onClick={() => onZoom(url)}
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-fog transition hover:text-gold"
            >
              <Expand size={11} /> Full size
            </button>
          )}
          <GhostButton onClick={pickFiles} disabled={bible.uploadingRef} className="py-1">
            {bible.uploadingRef ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <ImagePlus size={12} />
            )}
            {bible.uploadingRef ? "Uploading…" : "Upload"}
          </GhostButton>
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void upload(e.target.files);
          e.target.value = "";
        }}
      />

      {/* the picture under inspection — big, because "is this the right animal?"
          is the question this screen exists to answer */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
        }}
        className={cx("p-3", dragging && "bg-gold/6 ring-1 ring-inset ring-gold/40")}
      >
        {selected && url ? (
          <>
            <div className="flex items-center justify-center rounded-lg bg-ink/40">
              <img
                src={url}
                alt={`${draft.name} reference`}
                onClick={() => onZoom(url)}
                className="max-h-[360px] w-full cursor-zoom-in object-contain"
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {selected.roles.map((r) => (
                <Chip key={r} tone={r === "Key ref" ? "gold" : "muted"} className="text-[10px]">
                  {r}
                </Chip>
              ))}
              <span className="ml-1 min-w-0 truncate text-[10px] text-fog" title={selected.rel}>
                {fileName(selected.rel)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {SLOTS.map(({ slot, label, icon: Icon, hint }) => {
                const active = draft.refs[slot] === selected.rel;
                return (
                  <button
                    key={slot}
                    title={active ? `Clear the ${label.toLowerCase()} slot` : hint}
                    onClick={() => setSlot(slot, active ? null : selected.rel)}
                    className={cx(
                      "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium transition",
                      active
                        ? "border-gold/50 bg-gold/12 text-gold"
                        : "border-cream/10 text-cream/70 hover:border-gold/40 hover:text-gold",
                    )}
                  >
                    <Icon size={11} />
                    {active ? label : `Set ${label.toLowerCase()}`}
                  </button>
                );
              })}
              <button
                title={
                  isStaged(selected.rel)
                    ? "Delete this upload — it lives in this project's refs folder"
                    : "Remove from this character (the file stays in the library)"
                }
                onClick={() => detach(selected.rel)}
                className="ml-auto inline-flex items-center gap-1 rounded-lg border border-cream/10 px-2 py-1 text-[10px] font-medium text-fog transition hover:border-[#e07a6b]/50 hover:text-[#e07a6b]"
              >
                <Trash2 size={11} /> {isStaged(selected.rel) ? "Delete" : "Remove"}
              </button>
            </div>
          </>
        ) : (
          <button
            onClick={pickFiles}
            className="flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed border-gold/35 px-4 py-10 transition hover:border-gold/60 hover:bg-gold/4"
          >
            <ImagePlus size={22} strokeWidth={1.5} className="text-gold/80" />
            <span className="mt-1 text-[12px] font-medium text-cream/90">
              {bible.uploadingRef ? "Uploading…" : "Drop reference images here"}
            </span>
            <span className="text-[11px] text-fog">
              or click to upload — run the character-sheet pipeline and re-seed for the full set
            </span>
          </button>
        )}
        {error && <p className="mt-2 text-[10px] text-[#e07a6b]">{error}</p>}
      </div>

      {entries.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-3 pb-3">
          {entries.map((entry) => {
            const thumb = bible.refUrl(entry.rel);
            const active = entry.rel === selected?.rel;
            const isKey = draft.refs.keyframeRef === entry.rel;
            return (
              <button
                key={entry.rel}
                onClick={() => setSelRel(entry.rel)}
                title={`${fileName(entry.rel)} — ${entry.roles.join(" · ")}`}
                className={cx(
                  "group relative h-[84px] w-[68px] shrink-0 overflow-hidden rounded-lg border transition",
                  active ? "border-gold" : "border-cream/10 hover:border-gold/50",
                )}
              >
                {thumb ? (
                  <img src={thumb} alt="" className="h-full w-full object-cover object-top" />
                ) : (
                  <span className="block h-full w-full bg-gradient-to-br from-[#2a2118] to-[#0f0b06]" />
                )}
                {isKey && (
                  <span className="absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-gold text-ink">
                    <Crosshair size={9} strokeWidth={3} />
                  </span>
                )}
                <span
                  role="button"
                  title="Remove from this character"
                  onClick={(e) => {
                    e.stopPropagation();
                    detach(entry.rel);
                  }}
                  className="absolute right-1 top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-ink/80 text-fog transition hover:text-[#e07a6b] group-hover:flex"
                >
                  <X size={10} />
                </span>
              </button>
            );
          })}
          <button
            onClick={pickFiles}
            title="Upload more references"
            className="flex h-[84px] w-[68px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-cream/15 text-fog transition hover:border-gold/50 hover:text-gold"
          >
            <Plus size={14} />
            <span className="text-[9px]">Add</span>
          </button>
        </div>
      )}
    </div>
  );
}

function VoiceCard({
  draft,
  patch,
  bible,
}: {
  draft: BibleCharacter;
  patch: (p: Partial<BibleCharacter>) => void;
  bible: ReturnType<typeof useBible>;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const url = bible.voiceUrl(draft.voice.voiceId);
  const setVoice = (p: Partial<BibleCharacter["voice"]>) => patch({ voice: { ...draft.voice, ...p } });

  return (
    <div className={card}>
      <span className={sectionLabel}>Voice</span>
      <div className="mt-2 flex items-center gap-2">
        <Waveform seed={(draft.voice.voiceId ?? draft.id).length * 131} bars={34} className="min-w-0 flex-1" />
        <button
          title={url ? "Play reference clip" : "No playable reference clip"}
          onClick={() => {
            if (!url) return;
            audioRef.current?.pause();
            audioRef.current = new Audio(url);
            void audioRef.current.play();
          }}
          className={cx(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition",
            url
              ? "bg-gradient-to-b from-gold to-gold-deep text-ink hover:brightness-110"
              : "border border-cream/10 text-fog",
          )}
        >
          <Play size={13} className="ml-0.5" />
        </button>
      </div>

      <div className="mt-2 rounded-lg border border-cream/10 bg-ink/50 px-2.5 py-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-cream">
            {draft.voice.voiceId ? `Locked · cloned voice` : "Not cast yet"}
          </span>
          {draft.voice.voiceId && <Chip tone="gold">{draft.voice.engine}</Chip>}
        </div>
        <select
          value={draft.voice.voiceId ?? ""}
          onChange={(e) => setVoice({ voiceId: e.target.value || null })}
          className="mt-1.5 w-full rounded-md border border-cream/10 bg-ink px-2 py-1 text-[11px] text-cream outline-none focus:border-gold/40"
        >
          <option value="">— pick a voice —</option>
          {bible.voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} ({v.kind}
              {v.source ? ` · ${v.source}` : ""})
            </option>
          ))}
        </select>
      </div>

      {(
        [
          ["Exaggeration", "exaggeration"],
          ["CFG weight", "cfgWeight"],
        ] as const
      ).map(([label, key]) => (
        <label key={key} className="mt-2.5 block">
          <span className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-fog">
            {label}
            <span className="text-cream/80">{draft.voice[key].toFixed(2)}</span>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={draft.voice[key]}
            onChange={(e) => setVoice({ [key]: Number(e.target.value) } as Partial<BibleCharacter["voice"]>)}
            className="mt-1 w-full accent-[#c9a96e]"
          />
        </label>
      ))}

      <span className={cx(fieldLabel, "mt-2.5")}>Delivery notes</span>
      <textarea
        className={cx(textArea, "min-h-[48px]")}
        value={draft.voice.deliveryNotes}
        onChange={(e) => setVoice({ deliveryNotes: e.target.value })}
      />
    </div>
  );
}

/* ---------- location detail ---------- */

function LocationDetail({
  location,
  bible,
}: {
  location: BibleLocation;
  bible: ReturnType<typeof useBible>;
}) {
  const { draft, patch } = useDraft(location, bible.upsertLocation);
  return (
    <section className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-[32px] font-semibold leading-tight tracking-wide text-cream">
            {draft.name}
          </h1>
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-fog">Location</p>
        </div>
        <button
          title="Remove location"
          onClick={() => bible.removeLocation(draft.id)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-fog transition hover:bg-ember/20 hover:text-[#e07a6b]"
        >
          <Trash2 size={14} />
        </button>
      </header>

      <div className="max-w-[640px] space-y-3">
        <label className="block">
          <span className={fieldLabel}>Description</span>
          <textarea
            className={cx(textArea, "min-h-[80px]")}
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </label>
        <label className="block">
          <span className={fieldLabel}>Style prompt (pasted into keyframe generation)</span>
          <textarea
            className={cx(textArea, "min-h-[100px]")}
            value={draft.stylePrompt}
            onChange={(e) => patch({ stylePrompt: e.target.value })}
          />
        </label>

        <LocationRefs draft={draft} patch={patch} bible={bible} />
        <p className="text-[10px] leading-relaxed text-fog/80">
          The first still is the set's canon — it goes to qwen-edit as the scene reference when a
          shot here is boarded.
        </p>
      </div>
    </section>
  );
}

/** Location stills — a flat list, so the whole editor is upload / reorder-to-
 * front / remove. Same staging path as the character references. */
function LocationRefs({
  draft,
  patch,
  bible,
}: {
  draft: BibleLocation;
  patch: (p: Partial<BibleLocation>) => void;
  bible: ReturnType<typeof useBible>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async (files: FileList | File[]) => {
    setError(null);
    const added: string[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const png = await fileToPngBase64(file);
        added.push(await bible.uploadRef(file.name.replace(/\.[^.]+$/, "") || draft.id, png));
      } catch (err) {
        setError(String((err as Error).message ?? err));
      }
    }
    if (added.length) patch({ refs: [...draft.refs, ...added] });
  };

  const remove = (rel: string) => {
    patch({ refs: draft.refs.filter((r) => r !== rel) });
    if (isStaged(rel)) void bible.deleteRefFile(rel).catch(() => {});
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className={fieldLabel}>Reference stills</span>
        <span className="text-[10px] tabular-nums text-fog/70">{draft.refs.length}</span>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void upload(e.target.files);
          e.target.value = "";
        }}
      />
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
        }}
        className="flex gap-2 overflow-x-auto pb-1.5"
      >
        {draft.refs.map((rel, i) => {
          const url = bible.refUrl(rel);
          return (
            <div
              key={rel}
              className="group relative h-[76px] w-[120px] shrink-0 overflow-hidden rounded-lg border hairline"
            >
              {url && <img src={url} alt="" className="h-full w-full object-cover" />}
              {i === 0 && (
                <span className="absolute left-1 top-1 rounded-full bg-gold/90 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-ink">
                  Canon
                </span>
              )}
              <div className="absolute inset-x-1 bottom-1 hidden justify-end gap-1 group-hover:flex">
                {i > 0 && (
                  <button
                    title="Make this the canon still"
                    onClick={() => patch({ refs: [rel, ...draft.refs.filter((r) => r !== rel)] })}
                    className="flex h-5 w-5 items-center justify-center rounded-full bg-ink/85 text-fog transition hover:text-gold"
                  >
                    <Star size={10} />
                  </button>
                )}
                <button
                  title={isStaged(rel) ? "Delete this upload" : "Remove from this location"}
                  onClick={() => remove(rel)}
                  className="flex h-5 w-5 items-center justify-center rounded-full bg-ink/85 text-fog transition hover:text-[#e07a6b]"
                >
                  <X size={10} />
                </button>
              </div>
            </div>
          );
        })}
        <button
          onClick={() => fileInput.current?.click()}
          title="Upload reference stills"
          className="flex h-[76px] w-[120px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-cream/15 text-fog transition hover:border-gold/50 hover:text-gold"
        >
          {bible.uploadingRef ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
          <span className="text-[10px]">{bible.uploadingRef ? "Uploading…" : "Add stills"}</span>
        </button>
      </div>
      {error && <p className="mt-1 text-[10px] text-[#e07a6b]">{error}</p>}
    </div>
  );
}

/* ---------- style detail ---------- */

function StyleDetail({ bible }: { bible: ReturnType<typeof useBible> }) {
  const { draft, patch } = useDraft<BibleStyle>(bible.bible.style, bible.updateStyle);
  return (
    <section className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
      <header className="mb-4">
        <h1 className="font-serif text-[32px] font-semibold leading-tight tracking-wide text-cream">
          Style bible
        </h1>
        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-fog">
          Global look &amp; language
        </p>
      </header>

      <div className="max-w-[720px] space-y-3">
        {(
          [
            ["Art direction", "artDirection", "min-h-[120px]"],
            ["Negative prompt", "negativePrompt", "min-h-[80px]"],
            ["Cinematography notes", "cinematographyNotes", "min-h-[80px]"],
            ["Notes", "notes", "min-h-[64px]"],
          ] as const
        ).map(([label, key, h]) => (
          <label key={key} className="block">
            <span className={fieldLabel}>{label}</span>
            <textarea
              className={cx(textArea, h)}
              value={draft[key]}
              onChange={(e) => patch({ [key]: e.target.value } as Partial<BibleStyle>)}
            />
          </label>
        ))}

        <CinematographyBank bible={bible} />
      </div>
    </section>
  );
}

/* ---------- cinematography bank ---------- */

function CinematographyBank({ bible }: { bible: ReturnType<typeof useBible> }) {
  const cine = bible.bible.cinematography;
  const installed = cine.shotSizes.length > 0 || cine.moves.length > 0;
  const busy = bible.importingCinematography;
  return (
    <div className="rounded-xl border hairline p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className={fieldLabel}>Cinematography bank</span>
          <p className="text-[11px] leading-relaxed text-fog">
            {installed
              ? "The doc-26 prompt bible as structured banks — shot specs written in its " +
                "vocabulary (“ws”, “low”, “push-in”, “sitcom.warm-home”) expand to full clauses in " +
                "every composed prompt."
              : "Import the cinematography prompt bible (doc 26) as structured clause banks the " +
                "storyboard and Director draw from when speccing shots."}
          </p>
        </div>
        {installed ? (
          <GhostButton className="shrink-0" onClick={() => bible.importCinematography()}>
            <RefreshCw size={12} className={busy ? "animate-spin" : undefined} />
            {busy ? "Importing…" : "Re-import"}
          </GhostButton>
        ) : (
          <GoldButton className="shrink-0" onClick={() => bible.importCinematography()}>
            <Sparkles size={13} />
            {busy ? "Importing…" : "Import doc-26 bank"}
          </GoldButton>
        )}
      </div>
      {installed && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(
            [
              [`${cine.shotSizes.length} shot sizes`, cine.shotSizes.map((c) => c.id)],
              [`${cine.angles.length} angles`, cine.angles.map((c) => c.id)],
              [`${cine.moves.length} moves`, cine.moves.map((c) => c.id)],
              [`${cine.lenses.length} lenses`, cine.lenses.map((c) => c.id)],
              [`${cine.compositions.length} compositions`, cine.compositions.map((c) => c.id)],
              ...cine.lighting.map(
                (b) => [`${b.id} lighting ×${b.entries.length}`, b.entries.map((e) => `${b.id}.${e.id}`)] as const,
              ),
              [`${cine.danceSignatures.length} dance signatures`, cine.danceSignatures.map((d) => d.character)],
              [`${cine.formations.length} formations`, cine.formations.map((f) => f.id)],
            ] as ReadonlyArray<readonly [string, readonly string[]]>
          ).map(([label, ids]) => (
            <span
              key={label}
              title={ids.join(" · ")}
              className="cursor-default rounded-full border hairline px-2.5 py-1 text-[10px] text-cream/80"
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
