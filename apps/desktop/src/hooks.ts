import { useMemo } from "react";
import type { Settings } from "@aurea/shared";
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

/* sample toggle ids ↔ persisted settings fields */
const GENERAL_KEY = {
  login: "launchAtLogin",
  hw: "hardwareAcceleration",
  tray: "keepInTray",
  telemetry: "telemetry",
} as const;
const ADVANCED_KEY = {
  prerelease: "prereleaseEngines",
  verbose: "verboseJobLogs",
  keepvram: "keepModelsWarm",
} as const;

const fmtGb = (gb: number) => (gb >= 1000 ? `${(gb / 1000).toFixed(2)} TB` : `${Math.round(gb)} GB`);

/** LIVE — persisted settings + real disk figures from studiod; sample data
 * fills anything the store doesn't own yet (providers list, engines, shortcuts). */
export function useSettings() {
  const live = trpc.settings.get.useQuery().data;
  const disk = trpc.settings.storage.useQuery(undefined, { refetchInterval: 30_000 }).data;
  const utils = trpc.useUtils();
  const { mutate: update } = trpc.settings.update.useMutation({
    onSuccess: (next) => utils.settings.get.setData(undefined, next),
  });

  return useMemo(() => {
    const merged = {
      ...settings,
      defaultProvider: live?.providers.default ?? settings.defaultProvider,
      storage: {
        ...settings.storage,
        root: live?.storage.dataRoot ?? settings.storage.root,
        videofastDir: live?.paths.videofastDir ?? null,
        used:
          disk?.freeGb != null && disk?.totalGb != null
            ? fmtGb(disk.totalGb - disk.freeGb)
            : settings.storage.used,
        total: disk?.totalGb != null ? fmtGb(disk.totalGb) : settings.storage.total,
      },
      general: {
        ...settings.general,
        toggles: settings.general.toggles.map((t) => ({
          ...t,
          on: live ? live.general[GENERAL_KEY[t.id as keyof typeof GENERAL_KEY]] : t.on,
        })),
      },
      advanced: {
        toggles: settings.advanced.toggles.map((t) => ({
          ...t,
          on: live ? live.advanced[ADVANCED_KEY[t.id as keyof typeof ADVANCED_KEY]] : t.on,
        })),
      },
    };
    return {
      ...merged,
      toggleGeneral(id: string, on: boolean) {
        const key = GENERAL_KEY[id as keyof typeof GENERAL_KEY];
        if (key) update({ general: { [key]: on } });
      },
      toggleAdvanced(id: string, on: boolean) {
        const key = ADVANCED_KEY[id as keyof typeof ADVANCED_KEY];
        if (key) update({ advanced: { [key]: on } });
      },
      setDataRoot(dataRoot: string) {
        if (dataRoot.trim()) update({ storage: { dataRoot: dataRoot.trim() } });
      },
      setVideofastDir(dir: string) {
        update({ paths: { videofastDir: dir.trim() || null } });
      },
      setDefaultProvider(id: Settings["providers"]["default"]) {
        update({ providers: { default: id } });
      },
    };
  }, [live, disk, update]);
}
