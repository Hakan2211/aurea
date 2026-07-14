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
import { trpc } from "@/trpc";

/* The studiod seam. Screens only ever import from here.
 *
 * useProjects/useJobs/useSystem are LIVE — tRPC queries against studiod, kept
 * streaming by the LiveSync subscriber in StudiodProvider. Sample data remains
 * as placeholderData so a plain browser tab (or a dead core) still renders.
 * The lab hooks below are still stubs; they convert the same way as their
 * routers land in packages/core. */

export function useProjects() {
  const query = trpc.projects.list.useQuery(undefined, { placeholderData: projects });
  const list = query.data ?? projects;
  return { projects: list, activeId: list[0]?.id ?? "" };
}

export function useAssets() {
  return { assets };
}

export function useJobs() {
  const jobsQuery = trpc.jobs.list.useQuery(undefined, { placeholderData: jobs });
  const vramQuery = trpc.system.vram.useQuery(undefined, { placeholderData: vram });
  return { jobs: jobsQuery.data ?? jobs, vram: vramQuery.data ?? vram };
}

export function useSystem() {
  const query = trpc.system.overview.useQuery(undefined, {
    placeholderData: { system, preflight },
    // temp + preflight strip drift slowly; no subscription for these yet
    refetchInterval: 5_000,
    staleTime: 4_000,
  });
  return query.data ?? { system, preflight };
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
