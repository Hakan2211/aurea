import {
  assetLibrary,
  assets,
  chat,
  imageLab,
  jobs,
  musicLab,
  preflight,
  projects,
  settings,
  system,
  videoLab,
  voiceLab,
  vram,
} from "@/data/sample";
import { FORMATS, STYLE_PACKS } from "@/data/formats";

/* Stub hooks — the seam where the typed tRPC client plugs in (PRD Part 2:
 * studiod over localhost HTTP+WS). Screens only ever import from here. */

export function useProjects() {
  return { projects, activeId: projects[0].id };
}

export function useAssets() {
  return { assets };
}

export function useJobs() {
  return { jobs, vram };
}

export function useSystem() {
  return { system, preflight };
}

export function useChat() {
  return { messages: chat };
}

export function useFormats() {
  return { formats: FORMATS, packs: STYLE_PACKS };
}

export function useImageLab() {
  return imageLab;
}

export function useVoiceLab() {
  return voiceLab;
}

export function useMusicLab() {
  return musicLab;
}

export function useAssetLibrary() {
  return assetLibrary;
}

export function useVideoLab() {
  return videoLab;
}

export function useSettings() {
  return settings;
}
