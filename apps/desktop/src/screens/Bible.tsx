/* Bible — the persistent cast & world memory (S-P1). Laid out after the
 * "Characters Bible" design frame: character avatar rail on the left, the
 * turnaround-sheet profile in the center, voice / personality / LoRA cards on
 * the right. Locations and the style bible live behind the rail tabs. Edits
 * are debounced whole-entity upserts (timeline precedent: renderer owns edit
 * state, bible.json is the truth). */

import { useRef, useState } from "react";
import { Expand, Play, Plus, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import type { BibleCharacter, BibleLocation, BibleStyle } from "@aurea/shared";
import { Chip, GhostButton, GoldButton, Waveform, cx } from "@/components/ui";
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
        refs: { turnaround: null, hero: null, sheet: null, frames: [], dataset: [], custom: [] },
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

  const sheetUrl = bible.refUrl(draft.refs.sheet ?? draft.refs.turnaround ?? draft.refs.hero);
  const strip = [
    ...(draft.refs.hero ? [draft.refs.hero] : []),
    ...(draft.refs.turnaround ? [draft.refs.turnaround] : []),
    ...draft.refs.frames,
    ...draft.refs.dataset,
    ...draft.refs.custom,
  ];

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

        {/* turnaround sheet viewer */}
        <div className={cx(card, "p-0")}>
          <div className="flex items-center justify-between px-3 py-2">
            <span className={sectionLabel}>Turnaround sheet</span>
            {sheetUrl && (
              <button
                onClick={() => setZoom(sheetUrl)}
                className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-fog transition hover:text-gold"
              >
                <Expand size={11} /> View full size
              </button>
            )}
          </div>
          {sheetUrl ? (
            <img src={sheetUrl} alt={`${draft.name} sheet`} className="max-h-[420px] w-full object-contain pb-2" />
          ) : (
            <div className="flex h-[220px] items-center justify-center bg-gradient-to-br from-[#241a10] to-[#0f0b06] text-[11px] text-fog">
              No reference sheet yet — run the character-sheet pipeline, then re-run the seed.
            </div>
          )}
        </div>

        {/* expressions / frames strip */}
        {strip.length > 0 && (
          <div className="mt-3">
            <span className={sectionLabel}>Reference frames</span>
            <div className="mt-1.5 flex gap-2 overflow-x-auto pb-1.5">
              {strip.map((relPath) => {
                const url = bible.refUrl(relPath);
                return (
                  <button
                    key={relPath}
                    onClick={() => url && setZoom(url)}
                    title={relPath.split("/").at(-1)}
                    className="h-[84px] w-[68px] shrink-0 overflow-hidden rounded-lg border hairline transition hover:border-gold/50"
                  >
                    {url ? (
                      <img src={url} alt="" className="h-full w-full object-cover object-top" />
                    ) : (
                      <span className="block h-full w-full bg-gradient-to-br from-[#2a2118] to-[#0f0b06]" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

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
            Frames <span className="text-cream/80">{strip.length}</span>
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

        {draft.refs.length > 0 && (
          <div>
            <span className={fieldLabel}>Reference stills</span>
            <div className="flex gap-2 overflow-x-auto pb-1.5">
              {draft.refs.map((relPath) => {
                const url = bible.refUrl(relPath);
                return (
                  <span key={relPath} className="h-[76px] w-[120px] shrink-0 overflow-hidden rounded-lg border hairline">
                    {url && <img src={url} alt="" className="h-full w-full object-cover" />}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        <p className="text-[10px] leading-relaxed text-fog/80">
          Location reference stills arrive with the storyboard step — generated keyframes can be
          pinned here as the set's canon.
        </p>
      </div>
    </section>
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
      </div>
    </section>
  );
}
