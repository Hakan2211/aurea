import { useMemo } from "react";
import type { LibraryAsset as CoreAsset, LibraryKind, Settings } from "@aurea/shared";
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
  type LibraryAsset,
} from "@/data/sample";
import { FORMATS, STYLE_PACKS } from "@/data/formats";
import { useMediaBase } from "@/StudiodProvider";
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
  const utils = trpc.useUtils();
  const invalidate = { onSuccess: () => utils.projects.invalidate() };
  const { mutate: create } = trpc.projects.create.useMutation(invalidate);
  const { mutate: rename } = trpc.projects.rename.useMutation(invalidate);
  const list = query.data ?? projects;
  return {
    projects: list,
    activeId: list[0]?.id ?? "",
    createProject: (name: string) => create({ name }),
    renameProject: (id: string, name: string) => rename({ id, name }),
  };
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

/* ---------- asset library (LIVE) ---------- */

const KIND_SWATCH: Record<LibraryKind, string> = {
  image: "bg-gradient-to-br from-[#4a3a20] to-[#141008]",
  video: "bg-gradient-to-br from-[#2c3a4a] to-[#0a0e14]",
  audio: "bg-gradient-to-br from-[#3a2a1a] to-[#120d06]",
  music: "bg-gradient-to-br from-[#2a3a2e] to-[#0b110d]",
  model3d: "bg-gradient-to-br from-[#2f2a4a] to-[#0d0b16]",
};

const KIND_LABEL: Record<LibraryKind, string> = {
  image: "Image",
  video: "Video",
  audio: "Voice",
  music: "Music",
  model3d: "3D model",
};

const fmtBytes = (b: number) =>
  b >= 1024 ** 3
    ? `${(b / 1024 ** 3).toFixed(1)} GB`
    : b >= 1024 ** 2
      ? `${(b / 1024 ** 2).toFixed(1)} MB`
      : `${Math.max(1, Math.round(b / 1024))} KB`;

/** stable per-asset waveform shape for audio cards */
const waveSeed = (id: string) => {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return (Math.abs(h) % 900) + 100;
};

function toScreenAsset(a: CoreAsset, media: ((route: string) => string) | null): LibraryAsset {
  const audio = a.kind === "audio" || a.kind === "music";
  return {
    id: a.id,
    kind: a.kind,
    name: a.name,
    meta: fmtBytes(a.sizeBytes),
    swatch: KIND_SWATCH[a.kind],
    url: media ? media(a.url) : undefined,
    waveSeed: audio ? waveSeed(a.id) : undefined,
    info: [
      ["Type", KIND_LABEL[a.kind]],
      ["Project", a.projectName],
      ["Created", new Date(a.createdAt).toLocaleString("en-US", {
        month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
      })],
      ["File size", fmtBytes(a.sizeBytes)],
      ["Format", a.ext.toUpperCase()],
      ["Location", a.relPath],
    ],
    tags: [a.project, a.kind],
  };
}

/** LIVE — real files scanned from every project's assets tree, with /media
 * preview URLs. Sample data still stands in for a dead core (plain browser
 * tab), and for the smart collections the store doesn't own yet. */
export function useAssetLibrary() {
  const media = useMediaBase();
  const query = trpc.library.list.useQuery();
  const projectCount = trpc.projects.list.useQuery(undefined, { placeholderData: projects }).data
    ?.length;
  const disk = trpc.settings.storage.useQuery(undefined, { refetchInterval: 60_000 }).data;

  return useMemo(() => {
    if (!query.data) return assetLibrary;
    const live = query.data.assets.map((a) => toScreenAsset(a, media));
    const count = (k: LibraryKind) => live.filter((a) => a.kind === k).length;
    const usedGb =
      disk?.totalGb != null && disk.freeGb != null ? disk.totalGb - disk.freeGb : null;
    return {
      collections: [
        { id: "projects", label: "Projects", count: projectCount ?? 0 },
        { id: "image", label: "Images", count: count("image") },
        { id: "video", label: "Video takes", count: count("video") },
        { id: "audio", label: "Voices", count: count("audio") },
        { id: "music", label: "Music", count: count("music") },
        { id: "model3d", label: "3D models", count: count("model3d") },
      ],
      // smart collections need favorites/review state the store doesn't own yet
      smart: assetLibrary.smart.map((c) => ({ ...c, count: 0 })),
      storage: {
        usedPct:
          usedGb != null && disk?.totalGb ? Math.round((usedGb / disk.totalGb) * 100) : 0,
        label: usedGb != null && disk?.totalGb != null ? `${fmtGb(usedGb)} / ${fmtGb(disk.totalGb)}` : "—",
      },
      total: live.length,
      assets: live,
    };
  }, [query.data, media, projectCount, disk]);
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
