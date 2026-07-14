import { assets, chat, imageLab, jobs, preflight, projects, system, vram } from "@/data/sample";
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
