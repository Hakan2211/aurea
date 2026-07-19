/* StudioStore — the V2 Studio data spine. Two documents per project, siblings
 * of timeline.json under <dataRoot>/projects/<id>/ (folder-is-the-database):
 *
 *   production.json  Production → Season → Episode → Scene → Shot
 *   bible.json       characters / locations / style — the persistent memory
 *                    that makes episode 12 look and sound like episode 1
 *
 * Same contract as TimelineStore: the renderer edits optimistically and saves
 * whole documents; the granular ops below read-modify-write the same files so
 * the Director's tools and the UI stay interchangeable. */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import {
  bibleSchema,
  productionSchema,
  shotSchema,
  type Bible,
  type BibleCharacter,
  type BibleLocation,
  type BibleStyle,
  type Episode,
  type Production,
  type ProductionAddEpisode,
  type ProductionAddScene,
  type ProductionAddShot,
  type Scene,
  type Shot,
  type StudioSeedResult,
  type StudioUpdateEvent,
} from "@aurea/shared";
import type { SettingsStore } from "./settings.js";
import type { ProjectStore } from "./projects.js";
import {
  ANIMAL_SITCOM_CHARACTERS,
  ANIMAL_SITCOM_LOCATIONS,
  ANIMAL_SITCOM_STYLE,
  importAnimalSitcomFiles,
} from "./animalSitcomSeed.js";

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "item";

export class StudioStore extends EventEmitter {
  constructor(
    private settings: SettingsStore,
    private projects: ProjectStore,
  ) {
    super();
  }

  private file(project: string, name: "production.json" | "bible.json"): string {
    return path.join(this.settings.get().storage.dataRoot, "projects", project, name);
  }

  /** every save announces itself, so open screens converge on any writer
   * (renderer, Director tools, external MCP session) without polling */
  private write<T>(project: string, name: "production.json" | "bible.json", doc: T): T {
    const file = this.file(project, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
    fs.renameSync(tmp, file);
    const event: StudioUpdateEvent = {
      project,
      doc: name === "production.json" ? "production" : "bible",
    };
    this.emit("update", event);
    return doc;
  }

  /* ---------- production ---------- */

  getProduction(project: string): Production {
    try {
      return productionSchema.parse(
        JSON.parse(fs.readFileSync(this.file(project, "production.json"), "utf8")),
      );
    } catch {
      const name = this.projects.list().find((p) => p.id === project)?.name ?? project;
      return productionSchema.parse({ title: name });
    }
  }

  updateProduction(project: string, production: Production): Production {
    production.updatedAt = new Date().toISOString();
    return this.write(project, "production.json", production);
  }

  addEpisode(project: string, input: Omit<ProductionAddEpisode, "project">): { episode: Episode; production: Production } {
    const prod = this.getProduction(project);
    const seasonNumber = input.seasonNumber ?? 1;
    let season = prod.seasons.find((s) => s.number === seasonNumber);
    if (!season) {
      season = { id: randomUUID().slice(0, 8), number: seasonNumber, title: "", episodes: [] };
      prod.seasons.push(season);
      prod.seasons.sort((a, b) => a.number - b.number);
    }
    const episode: Episode = {
      id: this.nodeId(prod, slugify(input.title)),
      number: season.episodes.reduce((m, e) => Math.max(m, e.number), 0) + 1,
      title: input.title.trim(),
      logline: input.logline ?? "",
      synopsis: "",
      scenes: [],
    };
    season.episodes.push(episode);
    return { episode, production: this.updateProduction(project, prod) };
  }

  addScene(project: string, input: Omit<ProductionAddScene, "project">): { scene: Scene; production: Production } {
    const prod = this.getProduction(project);
    const episode = this.allEpisodes(prod).find((e) => e.id === input.episodeId);
    if (!episode) throw new Error(`unknown episode "${input.episodeId}" — production_get lists episode ids`);
    const scene: Scene = {
      id: this.nodeId(prod, slugify(input.slugline)),
      slugline: input.slugline.trim(),
      summary: input.summary ?? "",
      location: input.location ?? null,
      shots: [],
    };
    episode.scenes.push(scene);
    return { scene, production: this.updateProduction(project, prod) };
  }

  addShot(project: string, input: Omit<ProductionAddShot, "project">): { shot: Shot; production: Production } {
    const prod = this.getProduction(project);
    const scene = this.allScenes(prod).find((s) => s.id === input.sceneId);
    if (!scene) throw new Error(`unknown scene "${input.sceneId}" — production_get lists scene ids`);
    const { sceneId: _sceneId, ...rest } = input;
    const parsed = shotSchema.parse({
      ...rest,
      id: this.nodeId(prod, `shot-${randomUUID().slice(0, 6)}`),
      location: input.location ?? scene.location,
    });
    scene.shots.push(parsed);
    return { shot: parsed, production: this.updateProduction(project, prod) };
  }

  updateEpisode(
    project: string,
    episodeId: string,
    patch: Partial<Omit<Episode, "id" | "number" | "scenes">>,
  ): Production {
    const prod = this.getProduction(project);
    const episode = this.allEpisodes(prod).find((e) => e.id === episodeId);
    if (!episode) throw new Error(`unknown episode "${episodeId}" — production_get lists episode ids`);
    Object.assign(episode, patch);
    return this.updateProduction(project, prod);
  }

  updateScene(project: string, sceneId: string, patch: Partial<Omit<Scene, "id" | "shots">>): Production {
    const prod = this.getProduction(project);
    const scene = this.allScenes(prod).find((s) => s.id === sceneId);
    if (!scene) throw new Error(`unknown scene "${sceneId}" — production_get lists scene ids`);
    Object.assign(scene, patch);
    return this.updateProduction(project, prod);
  }

  updateShot(project: string, shotId: string, patch: Partial<Omit<Shot, "id">>): { shot: Shot; production: Production } {
    const prod = this.getProduction(project);
    const shot = this.allShots(prod).find((s) => s.id === shotId);
    if (!shot) throw new Error(`unknown shot "${shotId}" — production_get lists shot ids`);
    Object.assign(shot, patch);
    return { shot, production: this.updateProduction(project, prod) };
  }

  /** a shot plus its enclosing scene — what prompt composition needs */
  getShotContext(project: string, shotId: string): { shot: Shot; scene: Scene } {
    const prod = this.getProduction(project);
    for (const scene of this.allScenes(prod)) {
      const shot = scene.shots.find((s) => s.id === shotId);
      if (shot) return { shot, scene };
    }
    throw new Error(`unknown shot "${shotId}" — production_get lists shot ids`);
  }

  /** Storyboard delivery: append finished stills as keyframes. Called from
   * the job-completion import hook, so it tolerates a shot that was deleted
   * while the render ran (throws; the caller swallows). */
  attachKeyframes(project: string, shotId: string, assets: string[]): { shot: Shot; production: Production } {
    const prod = this.getProduction(project);
    const shot = this.allShots(prod).find((s) => s.id === shotId);
    if (!shot) throw new Error(`unknown shot "${shotId}"`);
    const fresh = assets.map((asset) => ({
      id: randomUUID().slice(0, 8),
      asset,
      approved: false,
    }));
    shot.keyframes.push(...fresh);
    if (!shot.selectedKeyframe && fresh.length) shot.selectedKeyframe = fresh[0].id;
    if (shot.status === "draft") shot.status = "boarded";
    return { shot, production: this.updateProduction(project, prod) };
  }

  removeEpisode(project: string, id: string): Production {
    const prod = this.getProduction(project);
    for (const season of prod.seasons) {
      const i = season.episodes.findIndex((e) => e.id === id);
      if (i !== -1) {
        season.episodes.splice(i, 1);
        return this.updateProduction(project, prod);
      }
    }
    throw new Error(`unknown episode "${id}"`);
  }

  removeScene(project: string, id: string): Production {
    const prod = this.getProduction(project);
    for (const episode of this.allEpisodes(prod)) {
      const i = episode.scenes.findIndex((s) => s.id === id);
      if (i !== -1) {
        episode.scenes.splice(i, 1);
        return this.updateProduction(project, prod);
      }
    }
    throw new Error(`unknown scene "${id}"`);
  }

  removeShot(project: string, id: string): Production {
    const prod = this.getProduction(project);
    for (const scene of this.allScenes(prod)) {
      const i = scene.shots.findIndex((s) => s.id === id);
      if (i !== -1) {
        scene.shots.splice(i, 1);
        return this.updateProduction(project, prod);
      }
    }
    throw new Error(`unknown shot "${id}"`);
  }

  private allEpisodes(prod: Production): Episode[] {
    return prod.seasons.flatMap((s) => s.episodes);
  }
  private allScenes(prod: Production): Scene[] {
    return this.allEpisodes(prod).flatMap((e) => e.scenes);
  }
  private allShots(prod: Production): Shot[] {
    return this.allScenes(prod).flatMap((s) => s.shots);
  }

  /** ids are unique across the whole document (episodes/scenes/shots share the
   * namespace so tools can address any node by one id) */
  private nodeId(prod: Production, base: string): string {
    const taken = new Set([
      ...this.allEpisodes(prod).map((e) => e.id),
      ...this.allScenes(prod).map((s) => s.id),
      ...this.allShots(prod).map((s) => s.id),
    ]);
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  /* ---------- bible ---------- */

  getBible(project: string): Bible {
    try {
      return bibleSchema.parse(JSON.parse(fs.readFileSync(this.file(project, "bible.json"), "utf8")));
    } catch {
      return bibleSchema.parse({});
    }
  }

  updateBible(project: string, bible: Bible): Bible {
    bible.updatedAt = new Date().toISOString();
    return this.write(project, "bible.json", bible);
  }

  upsertCharacter(project: string, character: BibleCharacter): Bible {
    const bible = this.getBible(project);
    const i = bible.characters.findIndex((c) => c.id === character.id);
    if (i === -1) bible.characters.push(character);
    else bible.characters[i] = character;
    return this.updateBible(project, bible);
  }

  removeCharacter(project: string, id: string): Bible {
    const bible = this.getBible(project);
    bible.characters = bible.characters.filter((c) => c.id !== id);
    return this.updateBible(project, bible);
  }

  upsertLocation(project: string, location: BibleLocation): Bible {
    const bible = this.getBible(project);
    const i = bible.locations.findIndex((l) => l.id === location.id);
    if (i === -1) bible.locations.push(location);
    else bible.locations[i] = location;
    return this.updateBible(project, bible);
  }

  removeLocation(project: string, id: string): Bible {
    const bible = this.getBible(project);
    bible.locations = bible.locations.filter((l) => l.id !== id);
    return this.updateBible(project, bible);
  }

  updateStyle(project: string, style: BibleStyle): Bible {
    const bible = this.getBible(project);
    bible.style = style;
    return this.updateBible(project, bible);
  }

  /* ---------- Animal Sitcom seed ---------- */

  /** Populate the bible (and an empty season 1) from the videofast repo.
   * Copies reference art into the project's assets tree and voice ref clips
   * into the cloned-voice roster; re-running is idempotent and picks up
   * character-sheet frames generated since the last run. */
  seedAnimalSitcom(project: string, overwrite: boolean): StudioSeedResult {
    const settings = this.settings.get();
    const videofastDir = settings.paths.videofastDir;
    if (!videofastDir || !fs.existsSync(videofastDir)) {
      throw new Error("videofast folder not found — set it in Settings → Storage first");
    }

    const { refs, customVoices, copiedFiles, warnings } = importAnimalSitcomFiles({
      videofastDir,
      dataRoot: settings.storage.dataRoot,
      projectId: project,
    });

    const bible = this.getBible(project);
    for (const seed of ANIMAL_SITCOM_CHARACTERS) {
      const existing = bible.characters.find((c) => c.id === seed.id);
      const freshRefs = refs.get(seed.id)!;
      // the VoiceDesign custom voice outranks the bake-off ref clip when it landed
      const voiceId = customVoices.has(seed.id) ? `${seed.id}-custom` : seed.voice.voiceId;
      const voice = { ...seed.voice, voiceId };
      if (!existing) {
        bible.characters.push({ ...seed, voice, refs: freshRefs, lora: null });
      } else if (overwrite) {
        Object.assign(existing, seed, { voice, refs: { ...freshRefs, custom: existing.refs.custom } });
      } else {
        // keep the user's edits; refresh what's on disk so new sheet frames land
        existing.refs = { ...freshRefs, custom: existing.refs.custom };
        // upgrade the default casting to the custom voice, but never a recast
        if (existing.voice.voiceId === seed.id && customVoices.has(seed.id)) {
          existing.voice.voiceId = `${seed.id}-custom`;
        }
      }
    }
    for (const seed of ANIMAL_SITCOM_LOCATIONS) {
      const existing = bible.locations.find((l) => l.id === seed.id);
      if (!existing) bible.locations.push({ ...seed });
      else if (overwrite) Object.assign(existing, seed, { refs: existing.refs });
    }
    const styleEmpty = !bible.style.artDirection && !bible.style.negativePrompt;
    if (styleEmpty || overwrite) bible.style = { ...ANIMAL_SITCOM_STYLE };
    this.updateBible(project, bible);

    let prod = this.getProduction(project);
    if (!fs.existsSync(this.file(project, "production.json"))) {
      prod = productionSchema.parse({
        title: "Animal Sitcom",
        logline: "Six animal roommates chase dance-crew glory while surviving day jobs, snack politics, and each other.",
        seasons: [{ id: randomUUID().slice(0, 8), number: 1, title: "", episodes: [] }],
      });
      this.updateProduction(project, prod);
      prod = this.getProduction(project);
    }

    return { bible, production: prod, copiedFiles, warnings };
  }
}
