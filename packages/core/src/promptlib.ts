/* PromptLibrary — the Image lab's persisted prompt system (Track B of the
 * 2026-08 upgrade). Folder-is-the-database, like everything else under
 * dataRoot:
 *
 *   <dataRoot>/promptlib/presets/<id>.json   one preset per file
 *   <dataRoot>/promptlib/packs/<id>.json     one style pack per file
 *   <dataRoot>/promptlib/decks/<id>.json     one saved deck per file
 *
 * Builtin presets and the shipped packs are seeded on first read and are
 * ordinary files afterwards — the user may edit or delete them, and a
 * deleted builtin stays deleted (a tombstone in .seeded.json remembers the
 * seed ran, so reseeding never resurrects an intentional delete).
 *
 * The per-project "from the bible" pack is NOT a file: it is derived live
 * from bible.style.artDirection every time packs() is called, so editing the
 * bible edits the pack. */

import fs from "node:fs";
import path from "node:path";
import {
  promptDeckSchema,
  promptPresetSchema,
  stylePackSchema,
  type Bible,
  type PromptDeck,
  type PromptDeckSave,
  type PromptPreset,
  type PromptPresetSave,
  type StylePack,
} from "@aurea/shared";
import type { SettingsStore } from "./settings.js";

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "preset";

/** The 7 strings that used to BE the whole preset system (labs.ts imageCatalog
 * `presets`), kept word-for-word so old jobs reproduce, plus the fragments a
 * one-word style could never carry. */
const BUILTIN_PRESETS: Array<Omit<PromptPreset, "id" | "createdAt" | "builtin">> = [
  // the legacy seven — their text is what the adapters have always appended
  { title: "Cinematic", category: "style", text: "cinematic style", tags: ["legacy"] },
  { title: "Photographic", category: "style", text: "photographic style", tags: ["legacy"] },
  { title: "Concept Art", category: "style", text: "concept art style", tags: ["legacy"] },
  { title: "Minimal", category: "style", text: "minimal style", tags: ["legacy"] },
  { title: "Moody", category: "style", text: "moody style", tags: ["legacy"] },
  { title: "Vintage", category: "style", text: "vintage style", tags: ["legacy"] },
  { title: "Fantasy", category: "style", text: "fantasy style", tags: ["legacy"] },
  // styles with an opinion
  {
    title: "Editorial photo",
    category: "style",
    text: "editorial magazine photography, medium format, natural color grading, crisp detail",
    tags: ["photo"],
  },
  {
    title: "Stylized 3D",
    category: "style",
    text: "stylized 3D animated render, Pixar-quality, soft subsurface scattering, appealing rounded shapes, physically-based materials",
    tags: ["3d", "character"],
  },
  {
    title: "Film still",
    category: "style",
    text: "film still, anamorphic lens, shallow depth of field, subtle film grain, cinematic color grade",
    tags: ["photo", "cinematic"],
  },
  // lighting
  {
    title: "Golden hour",
    category: "lighting",
    text: "golden hour sunlight, long soft shadows, warm rim light",
    tags: [],
  },
  {
    title: "Soft window light",
    category: "lighting",
    text: "soft window light from camera left, gentle falloff, no harsh shadows",
    tags: [],
  },
  {
    title: "Neon night",
    category: "lighting",
    text: "neon signage as the key light, wet reflective surfaces, deep teal shadows",
    tags: [],
  },
  {
    title: "Overcast diffuse",
    category: "lighting",
    text: "overcast daylight, big soft diffuse light, muted contrast, true-to-life color",
    tags: [],
  },
  // camera
  {
    title: "85mm portrait",
    category: "camera",
    text: "85mm lens, f/1.8, eye-level, subject fills the frame, creamy background blur",
    tags: [],
  },
  {
    title: "Wide establishing",
    category: "camera",
    text: "wide-angle establishing shot, deep focus, strong leading lines, room to breathe",
    tags: [],
  },
  {
    title: "Macro detail",
    category: "camera",
    text: "macro close-up, razor-thin focus plane, texture-forward",
    tags: [],
  },
  {
    title: "Low hero angle",
    category: "camera",
    text: "low angle looking up, subject towers, mild wide-angle drama",
    tags: [],
  },
  // mood
  {
    title: "Quiet morning",
    category: "mood",
    text: "calm, unhurried, morning stillness, gentle optimism",
    tags: [],
  },
  {
    title: "High energy",
    category: "mood",
    text: "kinetic, vivid, mid-action, caught motion with light blur",
    tags: [],
  },
  // the negative everything photoreal wants
  {
    title: "Clean render",
    category: "negative",
    text: "blurry, deformed, extra limbs, mutated hands, text, watermark, signature, low detail, jpeg artifacts",
    tags: ["legacy"],
  },
];

const SHIPPED_PACKS: Array<Omit<StylePack, "fromBible">> = [
  {
    id: "zoo-logic",
    title: "Zoo Logic",
    description:
      "The Zoo Logic house look — stylized-3D animal cast on grounded sets. Night scenes " +
      "shift hue, never just exposure.",
    presets: [
      {
        id: "zoo-logic-cast",
        title: "Zoo Logic cast",
        category: "style",
        text: "stylized 3D animated animal character, Pixar / Illumination quality, soft subsurface scattering, appealing rounded shapes, detailed fur and fabric, physically-based materials, cinematic 3D render",
        tags: ["character"],
        builtin: true,
        createdAt: "seed",
      },
      {
        id: "zoo-logic-set",
        title: "Zoo Logic set plate",
        category: "style",
        text: "empty environment plate matching a stylized-3D animated series, warm practical lighting, believable clutter, no characters, no text or signage",
        tags: ["set"],
        builtin: true,
        createdAt: "seed",
      },
      {
        id: "zoo-logic-night",
        title: "Zoo Logic night",
        category: "lighting",
        text: "night interior read as a HUE shift — cool blue-violet ambience with warm practical pools — not an exposure drop; detail stays readable everywhere",
        tags: ["set", "night"],
        builtin: true,
        createdAt: "seed",
      },
    ],
    negative:
      "blurry, deformed, extra limbs, off-model, different character, text, labels, watermark, " +
      "flat lighting, harsh shadows, low detail",
  },
  {
    id: "animal-sitcom",
    title: "Animal Sitcom",
    description:
      "The doc-23 locked look for the sitcom pipeline — Lane B stylized 3D, sitcom warm-home " +
      "lighting, keyframes that stay on-model.",
    presets: [
      {
        id: "animal-sitcom-hero",
        title: "Sitcom hero frame",
        category: "style",
        text: "stylized 3D animated character, Pixar / Illumination quality, soft subsurface scattering, appealing rounded shapes, detailed fur and fabric, physically-based materials, cinematic 3D render",
        tags: ["character"],
        builtin: true,
        createdAt: "seed",
      },
      {
        id: "animal-sitcom-warmhome",
        title: "Sitcom warm home",
        category: "lighting",
        text: "warm tungsten key with soft fill, lived-in home interior, gentle window daylight mixing in, inviting sitcom lighting",
        tags: ["set"],
        builtin: true,
        createdAt: "seed",
      },
      {
        id: "animal-sitcom-twoshot",
        title: "Sitcom two-shot",
        category: "camera",
        text: "eye-level medium two-shot, both characters fully in frame with headroom, 35mm, television staging",
        tags: [],
        builtin: true,
        createdAt: "seed",
      },
    ],
    negative:
      "blurry, deformed, extra limbs, extra fingers, mutated hands, fused fingers, inconsistent " +
      "design, different character, off-model, text, labels, watermark, signature, low detail, " +
      "duplicated face, flat lighting, harsh shadows, nsfw",
  },
];

export class PromptLibrary {
  constructor(private settings: SettingsStore) {}

  private root(): string {
    return path.join(this.settings.get().storage.dataRoot, "promptlib");
  }
  private dir(kind: "presets" | "packs" | "decks"): string {
    return path.join(this.root(), kind);
  }

  /** Seed once per dataRoot. The marker file keeps a deleted builtin deleted —
   * reseeding on every boot would resurrect what the user threw away. */
  private seed(): void {
    const marker = path.join(this.root(), ".seeded.json");
    if (fs.existsSync(marker)) return;
    for (const kind of ["presets", "packs", "decks"] as const) {
      fs.mkdirSync(this.dir(kind), { recursive: true });
    }
    const now = new Date().toISOString();
    for (const preset of BUILTIN_PRESETS) {
      const id = slugify(preset.title);
      this.writeJson(path.join(this.dir("presets"), `${id}.json`), {
        ...preset,
        id,
        builtin: true,
        createdAt: now,
      });
    }
    for (const pack of SHIPPED_PACKS) {
      this.writeJson(path.join(this.dir("packs"), `${pack.id}.json`), {
        ...pack,
        fromBible: false,
      });
    }
    this.writeJson(marker, { seededAt: now, presets: BUILTIN_PRESETS.length });
  }

  /* ---------- presets ---------- */

  presets(projectId?: string): PromptPreset[] {
    this.seed();
    const all = this.readAll(this.dir("presets"), promptPresetSchema);
    return all
      .filter((p) => !p.projectId || p.projectId === projectId)
      .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
  }

  savePreset(input: PromptPresetSave): PromptPreset {
    this.seed();
    const id = input.id ?? this.freshId(this.dir("presets"), slugify(input.title));
    const existing = input.id
      ? this.readAll(this.dir("presets"), promptPresetSchema).find((p) => p.id === input.id)
      : undefined;
    const preset = promptPresetSchema.parse({
      ...input,
      id,
      builtin: existing?.builtin ?? false,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    });
    this.writeJson(path.join(this.dir("presets"), `${id}.json`), preset);
    return preset;
  }

  removePreset(id: string): void {
    fs.rmSync(path.join(this.dir("presets"), `${id}.json`), { force: true });
  }

  /* ---------- packs ---------- */

  /** shipped packs (files) + the live per-project pack derived from the bible */
  packs(projectId?: string, bible?: Bible | null): StylePack[] {
    this.seed();
    const packs = this.readAll(this.dir("packs"), stylePackSchema).filter(
      (p) => !p.projectId || p.projectId === projectId,
    );
    const derived = bible ? deriveStylePack(bible, projectId) : null;
    return derived ? [derived, ...packs] : packs;
  }

  /* ---------- decks ---------- */

  decks(): PromptDeck[] {
    this.seed();
    return this.readAll(this.dir("decks"), promptDeckSchema).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  saveDeck(input: PromptDeckSave): PromptDeck {
    this.seed();
    const id = input.id ?? this.freshId(this.dir("decks"), slugify(input.title));
    const deck = promptDeckSchema.parse({ ...input, id, updatedAt: new Date().toISOString() });
    this.writeJson(path.join(this.dir("decks"), `${id}.json`), deck);
    return deck;
  }

  removeDeck(id: string): void {
    fs.rmSync(path.join(this.dir("decks"), `${id}.json`), { force: true });
  }

  /* ---------- plumbing ---------- */

  private freshId(dir: string, base: string): string {
    let id = base;
    for (let n = 2; fs.existsSync(path.join(dir, `${id}.json`)); n++) id = `${base}-${n}`;
    return id;
  }

  private readAll<T>(dir: string, schema: { parse(v: unknown): T }): T[] {
    if (!fs.existsSync(dir)) return [];
    const out: T[] = [];
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith(".json") || entry.startsWith(".")) continue;
      try {
        out.push(schema.parse(JSON.parse(fs.readFileSync(path.join(dir, entry), "utf8"))));
      } catch {
        // a hand-edited file that stopped parsing is skipped, not fatal
      }
    }
    return out;
  }

  private writeJson(target: string, value: unknown): void {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, target);
  }
}

/** The project's own style, read off its bible — computed, never stored, so
 * editing the bible edits the pack. */
export function deriveStylePack(bible: Bible, projectId?: string): StylePack | null {
  const art = bible.style.artDirection.trim();
  if (!art) return null;
  return stylePackSchema.parse({
    id: `bible-${projectId ?? "project"}`,
    title: "This project — from the bible",
    description: "Derived live from the story bible's art direction. Edit the bible to change it.",
    projectId,
    fromBible: true,
    presets: [
      {
        id: `bible-${projectId ?? "project"}-art`,
        title: "Art direction",
        category: "style",
        text: art,
        tags: ["bible"],
        builtin: false,
        createdAt: "derived",
      },
    ],
    negative: bible.style.negativePrompt.trim() || undefined,
  });
}
