/* Bible — the persistent cast & world memory (S-P1). Laid out after the
 * "Characters Bible" design frame: character avatar rail on the left, the
 * turnaround-sheet profile in the center, voice / personality / LoRA cards on
 * the right. Locations and the style bible live behind the rail tabs. Edits
 * are debounced whole-entity upserts (timeline precedent: renderer owns edit
 * state, bible.json is the truth). */

import { useEffect, useRef, useState } from "react";
import {
  Crosshair,
  Expand,
  ImagePlus,
  Images,
  Loader2,
  Pencil,
  Pause,
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

/** The gold "+" that sits beside a section heading (bible-v2 adopt). Every
 * addable list on this screen gets the same affordance in the same place, so
 * "how do I add one of these?" has one answer. */
function AddButton({
  title,
  onClick,
  active,
  busy,
  className,
}: {
  title: string;
  onClick: () => void;
  /** the add form below is open — hold the gold so the two read as one control */
  active?: boolean;
  busy?: boolean;
  className?: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cx(
        "flex h-5 w-5 items-center justify-center rounded-md border transition",
        active
          ? "border-gold/50 bg-gold/15 text-gold"
          : "border-gold/25 text-gold/70 hover:border-gold/60 hover:bg-gold/10 hover:text-gold",
        className,
      )}
    >
      {busy ? <Loader2 size={11} className="animate-spin" /> : <Plus size={12} />}
    </button>
  );
}

/** The gold CANON tag pinned on the still that is a character's / a location's
 * canonical image (bible-v2 adopt) — for a character that is the key ref, the
 * one picture every keyframe and shot prompt is actually built from. */
function CanonTag({ className }: { className?: string }) {
  return (
    <span
      title="Canon — the reference every keyframe and shot prompt is built from"
      className={cx(
        "rounded-full bg-gold/90 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-ink",
        className,
      )}
    >
      Canon
    </span>
  );
}

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
        id, name, species: "", role: "", build: "", face: "", wardrobe: "", props: "", colors: "",
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
          <AddButton
            title={tab === "cast" ? "New character" : "New location"}
            active={adding}
            onClick={() => setAdding((a) => !a)}
          />
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
            /* the rail portrait is whatever picture this character actually
             * has, in the same precedence the reference strip uses (canon key
             * ref first). Reading only hero/turnaround/sheet meant a cast
             * seeded with keyframeRef + frames — i.e. all of them — showed a
             * rail of letter initials, and bible-v1 draws portraits. */
            const url = bible.refUrl(refEntries(c.refs)[0]?.rel);
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
                    /* the cast's references are full-body S1 frames — dropped
                     * into a 40px circle unzoomed they're an unreadable
                     * figure-in-a-room. Magnify around the head band so the
                     * circle reads as a portrait, the way bible-v1 draws it. */
                    <img
                      src={url}
                      alt=""
                      className="h-full w-full origin-[50%_14%] scale-[2] object-cover object-top"
                    />
                  ) : (
                    <span className="font-serif text-sm text-gold">{c.name.charAt(0)}</span>
                  )}
                </span>
                <span className="min-w-0">
                  <span className={cx("block truncate text-[12px] font-medium", active ? "text-gold" : "text-cream")}>
                    {c.name}
                  </span>
                  {/* role first — what they do in the story orients faster
                      than what animal they are (bible-v2 adopt) */}
                  <span className="block truncate text-[10px] text-fog">
                    {c.role && (
                      <span className="uppercase tracking-[0.1em] text-cream/55">{c.role}</span>
                    )}
                    {c.role && c.species && <span className="text-fog/50"> · </span>}
                    {c.species || (c.role ? "" : "—")}
                  </span>
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
  /* while the core is unreachable the rail is empty for a reason that has
     nothing to do with seeding — don't offer the seed as the way out of it */
  if (!bible.live)
    return (
      <div className="border-t hairline p-3 text-[10px] leading-relaxed text-fog">
        Studio core offline — the bible on disk is untouched.
      </div>
    );
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

/** Two different nothings, and they must never look alike: an empty bible (add
 * or seed one) versus a bible we can't read because the core is down. Saying
 * "The bible is empty" for the second reads as data loss — the characters are
 * still sitting in bible.json, we just can't see them. */
function EmptyState({ bible }: { bible: ReturnType<typeof useBible> }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <span className="font-serif text-xl text-cream">
        {bible.live ? "The bible is empty" : "Not connected to the studio core"}
      </span>
      <p className="max-w-[360px] text-[12px] leading-relaxed text-fog">
        {bible.live
          ? "Seed the Animal Sitcom cast from your videofast character sheets, or add a character with the + button."
          : "Nothing has been lost — your cast, locations and style live in this project's " +
            "bible.json on disk. Reopening Aurea restarts the core and they come straight back."}
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

/* ---------- character detail ---------- */

/** Laid out after `bible-v1`: breadcrumb, a hero portrait card carrying the
 * name and the ROLE · SPECIES line, turnaround + reference grid beside it, then
 * the character's prose as full-width edit-in-place cards. The prose used to be
 * two cramped textareas in the right rail — which is backwards, since
 * personality and speech are what you actually come here to read. The rail now
 * holds only what's about production: the voice and the LoRA. */
function CharacterDetail({
  character,
  bible,
}: {
  character: BibleCharacter;
  bible: ReturnType<typeof useBible>;
}) {
  const { draft, patch } = useDraft(character, bible.upsertCharacter);
  const [zoom, setZoom] = useState<string | null>(null);
  const [selRel, setSelRel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const entries = refEntries(draft.refs);
  const selected = entries.find((e) => e.rel === selRel) ?? entries[0] ?? null;
  /** what the hero card shows: the picked reference, else the canon key ref.
   * The grid's whole job is "is this the right animal?" — a thumbnail click
   * has to land in the big frame, or the selection only moves a gold border. */
  const shownRel = selected?.rel ?? draft.refs.keyframeRef ?? null;

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
    <>
      <section
        className="@container flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-5"
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
      >
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

        <div className="flex items-center justify-between gap-3">
          <nav className="flex min-w-0 items-center gap-1.5 text-[11px] text-fog">
            <span>Bible</span>
            <span className="text-fog/40">/</span>
            <span>Cast</span>
            <span className="text-fog/40">/</span>
            <span className="truncate text-cream">{draft.name}</span>
          </nav>
          <button
            title="Remove character"
            onClick={() => bible.removeCharacter(draft.id)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fog transition hover:bg-ember/20 hover:text-[#e07a6b]"
          >
            <Trash2 size={14} />
          </button>
        </div>

        {/* hero portrait beside turnaround + references — one column until the
            pane is wide enough that a 300px portrait still leaves a usable grid */}
        <div className="grid gap-3 @3xl:grid-cols-[300px_minmax(0,1fr)]">
          <HeroCard
            draft={draft}
            url={bible.refUrl(shownRel)}
            isCanon={!!shownRel && shownRel === draft.refs.keyframeRef}
            onZoom={setZoom}
            onPick={pickFiles}
          />
          <div className="flex min-w-0 flex-col gap-3">
            <TurnaroundCard draft={draft} bible={bible} onZoom={setZoom} />
            <ReferenceGrid
              draft={draft}
              bible={bible}
              entries={entries}
              selected={selected}
              onSelect={setSelRel}
              onZoom={setZoom}
              onPick={pickFiles}
              setSlot={setSlot}
              detach={detach}
              dragging={dragging}
              error={error}
            />
          </div>
        </div>

        <ProseCard
          title="Personality"
          value={draft.personality}
          maxLength={600}
          placeholder="What are they like? This paragraph is what the Director writes them with."
          onChange={(v) => patch({ personality: v })}
        />
        <ProseCard
          title="Speech pattern"
          value={draft.speechPattern}
          placeholder="How do they sound — accent, rhythm, verbal tics?"
          onChange={(v) => patch({ speechPattern: v })}
        />
        <ProseCard
          title="Delivery notes"
          value={draft.voice.deliveryNotes}
          placeholder="How the takes should be performed — pace, weight, what to never do."
          onChange={(v) => patch({ voice: { ...draft.voice, deliveryNotes: v } })}
        />

        <AppearanceCard draft={draft} patch={patch} />

        <footer className="mt-1 flex items-center gap-6 border-t hairline pt-3 text-[10px] uppercase tracking-[0.12em] text-fog">
          <span>
            Updated <span className="text-cream/80">{fmtDay(bible.bible.updatedAt)}</span>
          </span>
          <span>
            Seed <span className="text-cream/80">{draft.seed ?? "—"}</span>
          </span>
          <span>
            References <span className="text-cream/80">{entries.length}</span>
          </span>
        </footer>
      </section>

      {/* right column — production state, not description */}
      <aside className="w-[300px] shrink-0 space-y-3 overflow-y-auto border-l hairline p-3">
        <VoiceCard draft={draft} patch={patch} bible={bible} />
        <LoraCard draft={draft} />
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

/** The character as a lookbook plate: the canon picture, their name over it,
 * and the ROLE · SPECIES line the cast rail echoes. */
function HeroCard({
  draft,
  url,
  isCanon,
  onZoom,
  onPick,
}: {
  draft: BibleCharacter;
  url: string | undefined;
  /** the shown picture is the key ref — only then does the CANON tag belong */
  isCanon: boolean;
  onZoom: (url: string) => void;
  onPick: () => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border hairline bg-surface">
      {url ? (
        <img
          src={url}
          alt={draft.name}
          onClick={() => onZoom(url)}
          className="aspect-[3/4] w-full cursor-zoom-in object-cover object-top"
        />
      ) : (
        <button
          onClick={onPick}
          className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-1.5 px-4 text-center transition hover:bg-gold/5"
        >
          <ImagePlus size={22} strokeWidth={1.5} className="text-gold/80" />
          <span className="text-[12px] font-medium text-cream/90">No picture yet</span>
          <span className="text-[11px] leading-relaxed text-fog">
            Drop a reference anywhere on this page, or click to upload
          </span>
        </button>
      )}
      {url && isCanon && <CanonTag className="absolute left-2 top-2" />}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink/85 to-transparent px-3 pb-3 pt-10">
        <h1 className="truncate font-serif text-[26px] font-semibold leading-tight tracking-wide text-cream">
          {draft.name}
        </h1>
        <p className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-[0.22em] text-gold/85">
          {[draft.role, draft.species].filter(Boolean).join(" · ") || "Character profile"}
        </p>
      </div>
    </div>
  );
}

/** The turnaround slot, given its own titled panel like the mockup. Empty is
 * the normal state for a seeded cast (the char-sheet pipeline fills S1 frames,
 * not turnarounds) — so the empty state says which slot to set rather than
 * pretending the section doesn't exist. */
function TurnaroundCard({
  draft,
  bible,
  onZoom,
}: {
  draft: BibleCharacter;
  bible: ReturnType<typeof useBible>;
  onZoom: (url: string) => void;
}) {
  const url = bible.refUrl(draft.refs.turnaround ?? draft.refs.sheet);
  const isSheet = !draft.refs.turnaround && !!draft.refs.sheet;
  return (
    <div className={cx(card, "p-0")}>
      <div className="flex items-center gap-2 border-b hairline px-3 py-2">
        <span className={sectionLabel}>Turnaround</span>
        {isSheet && <span className="text-[10px] text-fog/70">contact sheet</span>}
      </div>
      {url ? (
        <img
          src={url}
          alt={`${draft.name} turnaround`}
          onClick={() => onZoom(url)}
          className="max-h-[150px] w-full cursor-zoom-in bg-ink/40 object-contain p-2"
        />
      ) : (
        <p className="px-3 py-4 text-[11px] leading-relaxed text-fog">
          No turnaround yet — pick a reference below and press{" "}
          <span className="text-cream/80">Set turnaround</span>. Front / side / back views keep a
          character on-model when a shot needs an angle the key ref doesn't show.
        </p>
      )}
    </div>
  );
}

/** Every picture attached to the character as a grid (the mockup's References
 * 6/9 block). Selecting one exposes the slot buttons — which slot a picture
 * holds is the only thing on this screen that changes what gets rendered. */
function ReferenceGrid({
  draft,
  bible,
  entries,
  selected,
  onSelect,
  onZoom,
  onPick,
  setSlot,
  detach,
  dragging,
  error,
}: {
  draft: BibleCharacter;
  bible: ReturnType<typeof useBible>;
  entries: RefEntry[];
  selected: RefEntry | null;
  onSelect: (rel: string) => void;
  onZoom: (url: string) => void;
  onPick: () => void;
  setSlot: (slot: RefSlot, rel: string | null) => void;
  detach: (rel: string) => void;
  dragging: boolean;
  error: string | null;
}) {
  const selUrl = bible.refUrl(selected?.rel);
  return (
    <div className={cx(card, "p-0", dragging && "ring-1 ring-inset ring-gold/40")}>
      <div className="flex items-center justify-between gap-3 border-b hairline px-3 py-2">
        <div className="flex items-center gap-2">
          <span className={sectionLabel}>References</span>
          <span className="text-[10px] tabular-nums text-fog/70">{entries.length}</span>
          <AddButton
            title={bible.uploadingRef ? "Uploading…" : "Upload reference images"}
            busy={bible.uploadingRef}
            onClick={onPick}
          />
        </div>
        {selUrl && (
          <button
            onClick={() => onZoom(selUrl)}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-fog transition hover:text-gold"
          >
            <Expand size={11} /> Full size
          </button>
        )}
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2 p-3">
        {entries.map((entry) => {
          const thumb = bible.refUrl(entry.rel);
          const active = entry.rel === selected?.rel;
          const isKey = draft.refs.keyframeRef === entry.rel;
          return (
            <button
              key={entry.rel}
              onClick={() => onSelect(entry.rel)}
              title={`${fileName(entry.rel)} — ${entry.roles.join(" · ")}`}
              className={cx(
                "group relative aspect-[3/4] overflow-hidden rounded-lg border transition",
                active ? "border-gold" : "border-cream/10 hover:border-gold/50",
              )}
            >
              {thumb ? (
                <img src={thumb} alt="" className="h-full w-full object-cover object-top" />
              ) : (
                <span className="block h-full w-full bg-gradient-to-br from-[#2a2118] to-[#0f0b06]" />
              )}
              {isKey && <CanonTag className="absolute left-1 top-1" />}
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
          onClick={onPick}
          title="Upload more references"
          className="flex aspect-[3/4] flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-cream/15 text-fog transition hover:border-gold/50 hover:text-gold"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-gold/30 text-gold">
            {bible.uploadingRef ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
          </span>
          <span className="text-[9px] leading-tight">Upload<br />reference</span>
        </button>
      </div>

      {selected && (
        <div className="flex flex-wrap items-center gap-1.5 border-t hairline px-3 py-2">
          {selected.roles.map((r) => (
            <Chip key={r} tone={r === "Key ref" ? "gold" : "muted"} className="text-[10px]">
              {r}
            </Chip>
          ))}
          <span className="min-w-0 truncate text-[10px] text-fog" title={selected.rel}>
            {fileName(selected.rel)}
          </span>
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
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
              className="inline-flex items-center gap-1 rounded-lg border border-cream/10 px-2 py-1 text-[10px] font-medium text-fog transition hover:border-[#e07a6b]/50 hover:text-[#e07a6b]"
            >
              <Trash2 size={11} /> {isStaged(selected.rel) ? "Delete" : "Remove"}
            </button>
          </span>
        </div>
      )}
      {error && <p className="px-3 pb-2 text-[10px] text-[#e07a6b]">{error}</p>}
    </div>
  );
}

/** A prose section as the mockup draws it: serif heading, the text set to be
 * read, an Edit affordance that swaps in the textarea. Reading is the common
 * case here — the seeded prose is already right — so it gets the calm state. */
function ProseCard({
  title,
  value,
  onChange,
  placeholder,
  maxLength,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  maxLength?: number;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className={cx(card, "p-4")}>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <h2 className="font-serif text-[17px] font-semibold text-cream">{title}</h2>
        <div className="flex items-center gap-2">
          {maxLength && editing && (
            <span className="text-[10px] tabular-nums text-fog">
              {value.length} / {maxLength}
            </span>
          )}
          <button
            onClick={() => setEditing((e) => !e)}
            className="flex items-center gap-1 rounded-md px-1 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-fog transition hover:text-gold"
          >
            <Pencil size={11} />
            {editing ? "Done" : "Edit"}
          </button>
        </div>
      </div>
      {editing ? (
        <textarea
          autoFocus
          maxLength={maxLength}
          className={cx(textArea, "min-h-[96px]")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
        />
      ) : value ? (
        <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-cream/85">{value}</p>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="text-left text-[12px] italic leading-relaxed text-fog transition hover:text-cream/80"
        >
          {placeholder}
        </button>
      )}
    </div>
  );
}

/** The structured slots the prompt composer actually reads. The mockup drops
 * them; they stay, because `composeKeyframePrompt` is built out of exactly
 * these strings — they just sit below the prose now instead of above it.
 * Role and species get real inputs here: species had no editor at all. */
function AppearanceCard({
  draft,
  patch,
}: {
  draft: BibleCharacter;
  patch: (p: Partial<BibleCharacter>) => void;
}) {
  return (
    <div className={cx(card, "p-4")}>
      <h2 className="mb-2.5 font-serif text-[17px] font-semibold text-cream">
        Appearance &amp; identity anchors
      </h2>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={fieldLabel}>Role</span>
          <input
            className={textInput}
            value={draft.role}
            placeholder="Lead, Antagonist, Comic engine…"
            onChange={(e) => patch({ role: e.target.value })}
          />
        </label>
        <label className="block">
          <span className={fieldLabel}>Species</span>
          <input
            className={textInput}
            value={draft.species}
            placeholder="lion, emperor penguin…"
            onChange={(e) => patch({ species: e.target.value })}
          />
        </label>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        {(
          [
            ["Build", "build"],
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
    </div>
  );
}

const fmtClock = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** One reference clip, with the transport state the UI has to reflect: is it
 * playing (so the button can say Pause), and how far in (so the waveform can
 * act as the playhead). The element is owned by the hook — a fresh `new Audio`
 * per click, as before, left the old one playing underneath and made "playing"
 * unknowable. Rebuilds when the cast voice changes; pauses on unmount so
 * switching character mid-clip doesn't leave audio running. */
function useAudioClip(url: string | undefined) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    setPlaying(false);
    setElapsed(0);
    setDuration(0);
    if (!url) {
      audioRef.current = null;
      return;
    }
    const a = new Audio(url);
    audioRef.current = a;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setElapsed(a.currentTime);
    const onMeta = () => setDuration(Number.isFinite(a.duration) ? a.duration : 0);
    const onEnd = () => {
      setPlaying(false);
      setElapsed(0);
      a.currentTime = 0;
    };
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    /* duration can arrive late (or only once decoding starts) — without this
       the clock and the playhead would sit at zero for the whole clip */
    a.addEventListener("durationchange", onMeta);
    a.addEventListener("ended", onEnd);
    return () => {
      a.pause();
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("durationchange", onMeta);
      a.removeEventListener("ended", onEnd);
      audioRef.current = null;
    };
  }, [url]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };

  return { playing, elapsed, duration, toggle, progress: duration ? elapsed / duration : 0 };
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
  const url = bible.voiceUrl(draft.voice.voiceId);
  const cast = bible.voices.find((v) => v.id === draft.voice.voiceId) ?? null;
  const setVoice = (p: Partial<BibleCharacter["voice"]>) => patch({ voice: { ...draft.voice, ...p } });
  const clip = useAudioClip(url);

  return (
    <div className={cx(card, "p-4")}>
      <h2 className="font-serif text-[19px] font-semibold text-cream">Voice</h2>
      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-fog">
        {draft.name} — main voice
      </p>

      {/* the waveform is the playhead — bars fill gold as the clip runs */}
      <Waveform
        seed={(draft.voice.voiceId ?? draft.id).length * 131}
        bars={44}
        played={clip.progress}
        className="mt-3 w-full"
      />
      {clip.duration > 0 && (
        <p className="mt-1 text-right text-[10px] tabular-nums text-fog">
          {fmtClock(clip.elapsed)} / {fmtClock(clip.duration)}
        </p>
      )}

      <span className={cx(fieldLabel, "mt-3")}>Voice engine</span>
      <select
        value={draft.voice.voiceId ?? ""}
        onChange={(e) => setVoice({ voiceId: e.target.value || null })}
        className="w-full rounded-lg border border-cream/10 bg-ink px-2 py-1.5 text-[11px] text-cream outline-none focus:border-gold/40"
      >
        <option value="">— not cast yet —</option>
        {bible.voices.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name} ({v.kind}
            {v.source ? ` · ${v.source}` : ""})
          </option>
        ))}
      </select>

      <button
        title={
          url
            ? clip.playing
              ? "Pause the reference clip"
              : "Play the reference clip"
            : "This voice has no playable reference clip"
        }
        disabled={!url}
        onClick={clip.toggle}
        className={cx(
          "mt-2.5 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-semibold transition",
          url
            ? "bg-gradient-to-b from-gold to-gold-deep text-ink hover:brightness-110"
            : "border border-cream/10 text-fog",
        )}
      >
        <span
          className={cx(
            "flex h-6 w-6 items-center justify-center rounded-full",
            url ? "bg-ink/20" : "border border-cream/10",
          )}
        >
          {clip.playing ? <Pause size={12} /> : <Play size={12} className="ml-0.5" />}
        </span>
        {clip.playing ? "Pause" : "Play voice"}
      </button>

      <div className="mt-2.5 flex items-center gap-2">
        <Chip tone={cast ? "sage" : "muted"}>{cast ? `${cast.kind} voice` : "not cast"}</Chip>
        {cast && <Chip tone="gold">{draft.voice.engine}</Chip>}
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
    </div>
  );
}

/** The mockup's LoRA card, minus its invented telemetry: there is no training
 * run to report a percentage for until S-P2 ships, and a fake 87% bar is the
 * same lie the Director's "Confidence 87%" was rejected for. */
function LoraCard({ draft }: { draft: BibleCharacter }) {
  const lora = draft.lora;
  return (
    <div className={cx(card, "p-4")}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-serif text-[19px] font-semibold text-cream">LoRA</h2>
        <Chip tone={lora ? "sage" : "muted"}>{lora ? "ready" : "S-P2"}</Chip>
      </div>
      <p className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-fog">
        {lora ? lora.trigger || lora.asset : `${draft.id}_lora`}
      </p>
      <div className="mt-2.5 rounded-lg border border-cream/10 bg-ink/50 px-2.5 py-2 text-[11px] text-fog">
        {lora ? "Trained — used automatically when this character is boarded." : "Not trained"}
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-fog/80">
        Character LoRA training lands with shot generation — the reference grid becomes the
        training set.
      </p>
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
  const [picking, setPicking] = useState(false);
  /** already-attached stills are hidden so the grid can't add a duplicate */
  const unused = bible.libraryImages.filter((a) => !draft.refs.includes(a.relPath));

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
      <div className="mb-1 flex items-center gap-2">
        <span className={cx(fieldLabel, "mb-0")}>Reference stills</span>
        <span className="text-[10px] tabular-nums text-fog/70">{draft.refs.length}</span>
        <AddButton
          title={bible.uploadingRef ? "Uploading…" : "Upload reference stills"}
          busy={bible.uploadingRef}
          onClick={() => fileInput.current?.click()}
        />
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
              {i === 0 && <CanonTag className="absolute left-1 top-1" />}
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
        <button
          onClick={() => setPicking((p) => !p)}
          title="Attach a still already generated in the Image lab"
          className={cx(
            "flex h-[76px] w-[120px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed transition",
            picking
              ? "border-gold/50 text-gold"
              : "border-cream/15 text-fog hover:border-gold/50 hover:text-gold",
          )}
        >
          <Images size={14} />
          <span className="text-[10px]">From library</span>
        </button>
      </div>
      {picking && (
        <div className="mt-2 rounded-lg border hairline p-2">
          {unused.length === 0 ? (
            <p className="px-1 py-3 text-center text-[10px] text-fog/70">
              No unused stills in this project yet — generate a set plate in the Image lab.
            </p>
          ) : (
            <div className="grid max-h-[220px] grid-cols-4 gap-1.5 overflow-y-auto">
              {unused.map((a) => (
                <button
                  key={a.relPath}
                  title={a.name}
                  onClick={() => {
                    patch({ refs: [...draft.refs, a.relPath] });
                    setPicking(false);
                  }}
                  className="group relative aspect-[4/3] overflow-hidden rounded-md border hairline transition hover:border-gold/60"
                >
                  <img
                    src={bible.refUrl(a.relPath)}
                    alt=""
                    className="h-full w-full object-cover transition group-hover:opacity-80"
                  />
                </button>
              ))}
            </div>
          )}
          <p className="mt-1.5 px-1 text-[9px] leading-relaxed text-fog/70">
            Library stills are referenced in place — removing one here detaches it, it never
            deletes the file.
          </p>
        </div>
      )}
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
