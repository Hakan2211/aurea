import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Bible,
  BibleCharacter,
  BibleLocation,
  BibleStyle,
  DirectorAttachment,
  DirectorToolCall,
  Episode,
  ImageGenerate,
  Job,
  JobPayload,
  LibraryAsset as CoreAsset,
  LibraryKind,
  ModelEntry,
  MusicGenerate,
  Production,
  ProductionAddEpisode,
  ProductionAddScene,
  ProductionAddShot,
  RuntimeStatus,
  Scene,
  Settings,
  Shot,
  StoryboardGenerate,
  TtsGenerate,
  VideoGenerate,
} from "@aurea/shared";
import type { Asset, AssetKind, ChatMessage } from "@/data/sample";
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
  type ImageHistoryEntry,
  type ImageTile,
  type LibraryAsset,
  type MusicTrack,
  type VideoTake,
  type VoiceTake,
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

/** LIVE — the Director rail shows the real library, newest first. Sample data
 * stands in for a dead core (plain browser tab). */
export function useAssets() {
  const media = useMediaBase();
  const live = trpc.library.list.useQuery().data?.assets;
  return useMemo(() => {
    if (!live) return { assets };
    const mapped: Asset[] = live
      .filter((a) => a.kind !== "model3d")
      .slice(0, 24)
      .map((a) => ({
        id: a.id,
        kind: a.kind as AssetKind,
        name: a.name,
        swatch: KIND_SWATCH[a.kind],
        url: media ? media(a.url) : undefined,
      }));
    return { assets: mapped };
  }, [live, media]);
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

/* ---------- director chat (LIVE) ---------- */

export interface UiToolCall extends Omit<DirectorToolCall, "jobId"> {
  /** the live job behind this tool call, when it enqueued one */
  job?: Job;
}

export interface UiChatMessage extends ChatMessage {
  toolCall?: UiToolCall;
  /** assets the user pinned to this message */
  attachments?: DirectorAttachment[];
  /** this director reply is still arriving token by token */
  streaming?: boolean;
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

/** LIVE — the Director thread for the active project. director.onUpdate
 * streams every turn (text, tool calls, tool results) into the query cache;
 * tool calls that enqueued jobs get their live Job attached from the jobs
 * stream. Sample data stands in for a dead core. */
export function useChat() {
  const project = useActiveProjectId();
  const utils = trpc.useUtils();
  const query = trpc.director.get.useQuery({ project }, { enabled: !!project });
  trpc.director.onUpdate.useSubscription(
    { project },
    {
      enabled: !!project,
      onData: (state) => utils.director.get.setData({ project }, state),
    },
  );
  const jobsData = trpc.jobs.list.useQuery(undefined, { placeholderData: jobs }).data;
  const mutation = trpc.director.send.useMutation({
    onSuccess: (state) => utils.director.get.setData({ project }, state),
  });
  const stopMutation = trpc.director.stop.useMutation({
    onSuccess: (state) => utils.director.get.setData({ project }, state),
  });
  const { mutate } = mutation;
  const { mutate: stopMutate } = stopMutation;

  return useMemo(() => {
    const state = query.data;
    if (!state) {
      return {
        messages: chat as UiChatMessage[],
        busy: false,
        live: false,
        send: (_text: string, _attachments?: DirectorAttachment[]) => {},
        stop: () => {},
      };
    }
    const messages: UiChatMessage[] = state.messages.map((m) => ({
      id: m.id,
      role: m.role,
      time: fmtTime(m.at),
      text: m.text,
      attachments: m.attachments,
      streaming: m.streaming,
      toolCall: m.tool
        ? {
            name: m.tool.name,
            summary: m.tool.summary,
            status: m.tool.status,
            job: m.tool.jobId ? jobsData?.find((j) => j.id === m.tool!.jobId) : undefined,
          }
        : undefined,
    }));
    return {
      messages,
      busy: state.status === "thinking" || mutation.isPending,
      live: true,
      send: (text: string, attachments: DirectorAttachment[] = []) => {
        if (text.trim()) mutate({ project, text, attachments });
      },
      stop: () => stopMutate({ project }),
    };
  }, [query.data, jobsData, project, mutate, stopMutate, mutation.isPending]);
}

/* ---------- director model picker (LIVE) ---------- */

export type DirectorModel = Settings["providers"]["claudeModel"];

/** what the composer offers — aliases the local Claude Code resolves itself */
export const DIRECTOR_MODELS: Array<{ id: DirectorModel; label: string; detail: string }> = [
  { id: "sonnet", label: "Claude Sonnet", detail: "fast, everyday directing" },
  { id: "opus", label: "Claude Opus", detail: "deepest reasoning, slower" },
  { id: "haiku", label: "Claude Haiku", detail: "instant, lightweight" },
];

/** LIVE — persisted in ~/.aurea/settings.json; the next Director run picks it up. */
export function useDirectorModel() {
  const live = trpc.settings.get.useQuery().data;
  const utils = trpc.useUtils();
  const { mutate } = trpc.settings.update.useMutation({
    onSuccess: (next) => utils.settings.get.setData(undefined, next),
  });
  return {
    model: live?.providers.claudeModel ?? ("sonnet" as DirectorModel),
    live: !!live,
    setModel: (m: DirectorModel) => mutate({ providers: { claudeModel: m } }),
  };
}

export function useFormats() {
  return { formats: FORMATS, packs: STYLE_PACKS };
}

/* ---------- timeline (LIVE) ---------- */

/** LIVE — the project's sequence. The screen edits a local copy and saves the
 * whole document, debounced; timeline.json in the project folder is the truth. */
export function useTimeline() {
  const project = useActiveProjectId();
  const media = useMediaBase();
  const query = trpc.timeline.get.useQuery({ project }, { enabled: !!project, staleTime: Infinity });
  const library = trpc.library.list.useQuery().data?.assets;
  const utils = trpc.useUtils();
  // keep the cache in lockstep with saves — a remounted screen must re-init
  // from the latest cut, never from the first fetch of the session
  const { mutate, mutateAsync: saveAsync } = trpc.timeline.update.useMutation({
    onSuccess: (tl) => utils.timeline.get.setData({ project }, tl),
  });
  const exportMutation = trpc.timeline.export.useMutation({
    onSuccess: () => void utils.jobs.invalidate(),
  });
  const { mutateAsync: exportAsync } = exportMutation;
  // the latest export job for this project, straight off the live jobs stream
  const jobsData = trpc.jobs.list.useQuery(undefined, { placeholderData: jobs }).data;
  const exportJob = jobsData?.find(
    (j) => j.payload?.type === "export" && j.payload.project === project,
  );

  const assetByRel = useMemo(() => {
    const map = new Map<string, { url?: string; kind: LibraryKind; name: string }>();
    for (const a of library ?? []) {
      map.set(a.relPath, { url: media ? media(a.url) : undefined, kind: a.kind, name: a.name });
    }
    return map;
  }, [library, media]);

  return {
    project,
    initial: query.data,
    live: !!query.data,
    /** media candidates for the shot rail, newest first */
    pool: useMemo(
      () =>
        (library ?? [])
          .filter((a) => a.kind !== "model3d")
          .map((a) => ({
            relPath: a.relPath,
            name: a.name,
            kind: a.kind,
            url: media ? media(a.url) : undefined,
          })),
      [library, media],
    ),
    resolve: (relPath: string) => assetByRel.get(relPath),
    save: (timeline: NonNullable<typeof query.data>) => mutate({ project, timeline }),
    /** flush the current cut, then hand it to the ffmpeg export job */
    exportCut: async (timeline: NonNullable<typeof query.data>) => {
      await saveAsync({ project, timeline });
      await exportAsync({ project });
    },
    /** the project's latest export job (live progress / done / failed) */
    exportJob,
    exporting:
      exportMutation.isPending ||
      exportJob?.status === "running" ||
      exportJob?.status === "queued",
  };
}

/** LIVE — place a library asset on the active project's sequence from any
 * screen (Music lab, Asset library). Uses the server-side addClip so the
 * real duration is ffprobe'd and the kind picks the track; keeps the
 * timeline.get cache in lockstep so a later Timeline mount sees the clip. */
export function useSendToTimeline() {
  const project = useActiveProjectId();
  const utils = trpc.useUtils();
  const mutation = trpc.timeline.addClip.useMutation({
    onSuccess: (res) => utils.timeline.get.setData({ project }, res.timeline),
  });
  const { mutateAsync } = mutation;
  return {
    live: !!project,
    sending: mutation.isPending,
    send: (relPath: string) => mutateAsync({ project, asset: relPath }),
  };
}

/* ---------- model manager (LIVE) ---------- */

/** LIVE — the downloadable-weights registry with per-model install status.
 * models.onUpdate (mounted in LiveSync) streams progress while downloads run.
 * No sample fallback: without a core the Models UI shows its empty state. */
export function useModels() {
  const query = trpc.models.list.useQuery();
  const utils = trpc.useUtils();
  const refresh = {
    onSuccess: () => void utils.models.list.invalidate(),
    onError: () => void utils.models.list.invalidate(),
  };
  const { mutate: download } = trpc.models.download.useMutation(refresh);
  const { mutate: cancel } = trpc.models.cancel.useMutation(refresh);
  const { mutate: remove } = trpc.models.remove.useMutation(refresh);
  return {
    models: (query.data ?? []) as ModelEntry[],
    live: !!query.data,
    download: (id: string, acceptLicense = false) => download({ id, acceptLicense }),
    cancel: (id: string) => cancel({ id }),
    remove: (id: string) => remove({ id }),
  };
}

/** LIVE — the managed engine substrate (portable Python + headless ComfyUI);
 * status streams over runtime.onUpdate while an install runs */
export function useRuntime() {
  const query = trpc.runtime.status.useQuery();
  const utils = trpc.useUtils();
  const refresh = {
    onSuccess: (s: RuntimeStatus) => utils.runtime.status.setData(undefined, s),
    onError: () => void utils.runtime.status.invalidate(),
  };
  const { mutate: install } = trpc.runtime.install.useMutation(refresh);
  const { mutate: cancel } = trpc.runtime.cancel.useMutation(refresh);
  return {
    status: (query.data ?? null) as RuntimeStatus | null,
    live: !!query.data,
    install: () => install(),
    cancel: () => cancel(),
  };
}

/** whether the first-run wizard should be on screen (live core, not onboarded) */
export function useOnboarding() {
  const live = trpc.settings.get.useQuery().data;
  const utils = trpc.useUtils();
  const { mutate } = trpc.settings.update.useMutation({
    onSuccess: (next) => utils.settings.get.setData(undefined, next),
  });
  return {
    showWizard: !!live && !live.general.onboarded,
    settings: live,
    finish: () => mutate({ general: { onboarded: true } }),
  };
}

/* ---------- labs (LIVE) ----------
 *
 * A lab's results are just two live streams the app already has: its running
 * jobs (generating tiles, progress pushed by the snapshot subscription) and
 * its finished assets (the library scan, invalidated when a job completes).
 * The lab routers only add catalogs + generate mutations. Sample data still
 * stands in for a dead core, and for knobs no store owns yet (stems, rating). */

const LAB_SWATCHES = [
  "bg-gradient-to-br from-[#5a4426] to-[#170f06]",
  "bg-gradient-to-br from-[#2c3a4a] to-[#0a0e14]",
  "bg-gradient-to-br from-[#2a3a2e] to-[#0b110d]",
  "bg-gradient-to-br from-[#2f2a4a] to-[#0d0b16]",
  "bg-gradient-to-br from-[#432f3a] to-[#140d11]",
  "bg-gradient-to-br from-[#3a2a1a] to-[#120d06]",
];
const labSwatch = (id: string) => LAB_SWATCHES[waveSeed(id) % LAB_SWATCHES.length];

const strip = (name: string) => name.replace(/\.[^.]+$/, "");

function relTime(iso: string): string {
  const mins = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 2) return "Just now";
  if (mins < 60) return `${Math.round(mins)}m ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h ago`;
  if (mins < 48 * 60) return "Yesterday";
  return `${Math.round(mins / (24 * 60))} days ago`;
}

type LabJob<T extends JobPayload["type"]> = Job & { payload: Extract<JobPayload, { type: T }> };

const labJobs = <T extends JobPayload["type"]>(all: Job[] | undefined, type: T) =>
  (all ?? []).filter(
    (j): j is LabJob<T> =>
      j.payload?.type === type && (j.status === "running" || j.status === "queued"),
  );

/** the project new lab takes land in — the switcher's active (first) project */
function useActiveProjectId(): string {
  const list = trpc.projects.list.useQuery(undefined, { placeholderData: projects }).data;
  return list?.[0]?.id ?? "";
}

/** shared per-lab live inputs: catalog + assets of the lab's kind + its jobs */
function useLabData(kind: LibraryKind) {
  const media = useMediaBase();
  const assets = trpc.library.list.useQuery().data?.assets;
  const jobsData = trpc.jobs.list.useQuery(undefined, { placeholderData: jobs }).data;
  const project = useActiveProjectId();
  const utils = trpc.useUtils();
  const invalidate = { onSuccess: () => void utils.jobs.invalidate() };
  return {
    media,
    project,
    invalidate,
    jobsData,
    kindAssets: useMemo(() => assets?.filter((a) => a.kind === kind), [assets, kind]),
  };
}

export function useImageLab() {
  const catalog = trpc.labs.image.catalog.useQuery().data;
  const { media, project, invalidate, jobsData, kindAssets } = useLabData("image");
  const mutation = trpc.labs.image.generate.useMutation(invalidate);
  const { mutate } = mutation;

  return useMemo(() => {
    const generate = (input: Omit<ImageGenerate, "project">) => mutate({ ...input, project });
    if (!catalog || !kindAssets) return { ...imageLab, generate, busy: false };

    const active = labJobs(jobsData, "image");
    const tiles: ImageTile[] = [
      ...active.flatMap((j) =>
        Array.from({ length: j.payload.count }, (_, i) => ({
          id: `${j.id}:${i}`,
          swatch: labSwatch(`${j.id}${i}`),
          generating: { progress: j.progress },
        })),
      ),
      ...kindAssets.map((a) => ({
        id: a.id,
        swatch: labSwatch(a.id),
        url: media ? media(a.url) : undefined,
      })),
    ].slice(0, 4);

    // history = the image roll grouped by day, newest first
    const byDay = new Map<string, CoreAsset[]>();
    for (const a of kindAssets) {
      const day = a.createdAt.slice(0, 10);
      byDay.set(day, [...(byDay.get(day) ?? []), a]);
    }
    const history: ImageHistoryEntry[] = [...byDay.entries()].slice(0, 6).map(([day, group], i) => ({
      id: day,
      when: relTime(group[0].createdAt),
      count: group.length,
      aspect: "",
      swatches: group.slice(0, 4).map((a) => labSwatch(a.id)),
      urls: group.slice(0, 4).map((a) => (media ? media(a.url) : undefined)),
      current: i === 0,
    }));

    return {
      ...imageLab,
      models: catalog.models.map(({ available, ...m }) =>
        available ? m : { ...m, note: "not installed" },
      ),
      aspects: catalog.aspects,
      presets: catalog.presets,
      batch: tiles,
      history,
      generate,
      busy: mutation.isPending || active.length > 0,
    };
  }, [catalog, kindAssets, jobsData, media, project, mutate, mutation.isPending]);
}

export function useVoiceLab() {
  const catalog = trpc.labs.voice.catalog.useQuery().data;
  const { media, project, invalidate, jobsData, kindAssets } = useLabData("audio");
  const mutation = trpc.labs.voice.generate.useMutation(invalidate);
  const { mutate } = mutation;
  const utils = trpc.useUtils();
  // adding/removing a voice reshapes every lab catalog that lists voices
  const refreshVoices = { onSuccess: () => void utils.labs.invalidate() };
  const addMutation = trpc.labs.voice.add.useMutation(refreshVoices);
  const removeMutation = trpc.labs.voice.remove.useMutation(refreshVoices);
  const { mutateAsync: addAsync } = addMutation;
  const { mutateAsync: removeAsync } = removeMutation;

  return useMemo(() => {
    const generate = (input: Omit<TtsGenerate, "project">) => mutate({ ...input, project });
    const addVoice = (name: string, wavBase64: string) => addAsync({ name, wavBase64 });
    const removeVoice = (id: string) => removeAsync({ id });
    const cloning = { addVoice, removeVoice, adding: addMutation.isPending };
    if (!catalog || !kindAssets) return { ...voiceLab, ...cloning, generate, busy: false };

    const active = labJobs(jobsData, "tts");
    const takes: VoiceTake[] = [
      ...active.map((j) => ({
        id: j.id,
        label: j.title,
        duration: j.stage ?? "Queued",
        rating: 0,
        waveSeed: waveSeed(j.id),
        generating: true,
      })),
      ...kindAssets.map((a, i) => ({
        id: a.id,
        label: strip(a.name),
        duration: fmtBytes(a.sizeBytes),
        rating: 0,
        waveSeed: waveSeed(a.id),
        url: media ? media(a.url) : undefined,
        selected: i === 0,
      })),
    ].slice(0, 14);

    return {
      ...voiceLab,
      ...cloning,
      engines: catalog.engines.map(({ available, ...e }) =>
        available ? e : { ...e, note: "not installed" },
      ),
      voices: catalog.voices.map((v) => ({ ...v, swatch: labSwatch(v.id) })),
      scriptMax: catalog.scriptMax,
      takes,
      playback: { position: "00:00.0", total: "", played: 0 },
      generate,
      busy: mutation.isPending || active.length > 0,
    };
  }, [catalog, kindAssets, jobsData, media, project, mutate, mutation.isPending, addAsync, removeAsync, addMutation.isPending]);
}

const fmtClock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

export function useMusicLab() {
  const catalog = trpc.labs.music.catalog.useQuery().data;
  const { media, project, invalidate, jobsData, kindAssets } = useLabData("music");
  const mutation = trpc.labs.music.generate.useMutation(invalidate);
  const { mutate } = mutation;

  return useMemo(() => {
    const generate = (input: Omit<MusicGenerate, "project">) => mutate({ ...input, project });
    if (!catalog || !kindAssets) return { ...musicLab, generate, busy: false };

    const active = labJobs(jobsData, "music");
    const tracks: MusicTrack[] = [
      ...active.map((j) => ({
        id: j.id,
        title: j.title,
        bpm: 0,
        key: "",
        duration: fmtClock(j.payload.durationSec),
        waveSeed: waveSeed(j.id),
        swatch: labSwatch(j.id),
        arrangement: j.payload.arrangement,
        generating: { progress: j.progress, stage: j.stage ?? "Queued" },
      })),
      ...kindAssets.map((a, i) => ({
        id: a.id,
        title: strip(a.name),
        bpm: 0,
        key: "",
        duration: fmtBytes(a.sizeBytes),
        waveSeed: waveSeed(a.id),
        swatch: labSwatch(a.id),
        arrangement: "instrumental" as const,
        url: media ? media(a.url) : undefined,
        relPath: a.relPath,
        selected: i === 0,
      })),
    ].slice(0, 12);

    return {
      ...musicLab,
      engine: {
        label: catalog.engine.label,
        note: catalog.engine.available ? catalog.engine.note : "not installed",
      },
      styleLibrary: catalog.styleLibrary,
      durationMin: catalog.durationMin,
      durationMax: catalog.durationMax,
      descriptionMax: catalog.descriptionMax,
      singVoices: catalog.singVoices,
      tracks,
      generate,
      busy: mutation.isPending || active.length > 0,
    };
  }, [catalog, kindAssets, jobsData, media, project, mutate, mutation.isPending]);
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
    relPath: a.relPath,
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
  const catalog = trpc.labs.video.catalog.useQuery().data;
  const { media, project, invalidate, jobsData, kindAssets } = useLabData("video");
  const images = trpc.library.list.useQuery().data?.assets.filter((a) => a.kind === "image");
  const mutation = trpc.labs.video.generate.useMutation(invalidate);
  const { mutate } = mutation;

  return useMemo(() => {
    if (!catalog || !kindAssets) {
      return {
        ...videoLab,
        generate: (_: Omit<VideoGenerate, "project">) => {},
        busy: false,
        canGenerate: true,
      };
    }

    // newest image in the library anchors identity (LTX i2v start frame)
    const frame = images?.[0];
    const startFrame = frame
      ? {
          name: frame.name,
          meta: `${fmtBytes(frame.sizeBytes)} · ${frame.ext.toUpperCase()}`,
          swatch: labSwatch(frame.id),
          url: media ? media(frame.url) : undefined,
          relPath: frame.relPath,
        }
      : { ...videoLab.startFrame, url: undefined, relPath: undefined };

    const generate = (input: Omit<VideoGenerate, "project" | "startFrame">) =>
      mutate({ ...input, startFrame: startFrame.relPath, project });

    const takes: VideoTake[] = kindAssets.slice(0, 8).map((a, i) => ({
      id: a.id,
      label: strip(a.name),
      swatch: labSwatch(a.id),
      url: media ? media(a.url) : undefined,
      selected: i === 0,
    }));

    // the job rail mirrors the lab's most relevant video job
    const active = labJobs(jobsData, "video");
    const j = active[0] ?? (jobsData ?? []).find((x) => x.payload?.type === "video");
    const stageStatus = (mine: "queued" | "running", after: boolean) =>
      j!.status === mine ? ("running" as const) : after ? ("completed" as const) : ("pending" as const);
    const job = j
      ? {
          id: j.id,
          status: j.status.charAt(0).toUpperCase() + j.status.slice(1),
          elapsed: j.elapsed ?? "",
          stages: [
            {
              id: "queue",
              label: "Queued",
              detail: `${j.priority} priority`,
              status: stageStatus("queued", j.status !== "queued"),
            },
            {
              id: "render",
              label: j.stage ?? "Rendering",
              detail: j.detail ?? "",
              status: stageStatus("running", j.status === "completed" || j.status === "failed"),
              progress: j.status === "running" ? j.progress : undefined,
            },
            {
              id: "deliver",
              label: "Save to assets",
              detail: j.status === "failed" ? (j.error ?? "failed") : "",
              status: j.status === "completed" ? ("completed" as const) : ("pending" as const),
            },
          ],
        }
      : { id: "—", status: "Idle", elapsed: "", stages: [] };

    return {
      ...videoLab,
      engines: catalog.engines.map(({ available, ...e }) =>
        available ? e : { ...e, note: "not installed" },
      ),
      engineNotes: catalog.engineNotes,
      durations: catalog.durations,
      duration: "5 seconds",
      resolutions: catalog.resolutions,
      resolution: catalog.resolutions[0],
      promptMax: catalog.promptMax,
      tip: catalog.tip,
      startFrame,
      takes,
      job,
      playback: { position: "", total: "", played: 0 },
      generate,
      canGenerate: !!frame,
      busy: mutation.isPending || active.length > 0,
    };
  }, [catalog, kindAssets, images, jobsData, media, project, mutate, mutation.isPending]);
}

/* ---------- studio: bible + production (LIVE) ---------- */

/** Debounced entity editing: local draft + whole-entity save after the user
 * stops typing (timeline precedent). External updates (seed, Director edits)
 * replace the draft unless keystrokes are still unsaved. */
export function useDraft<T>(source: T, save: (next: T) => void, delayMs = 700) {
  const [draft, setDraft] = useState<T>(source);
  const timer = useRef<number | undefined>(undefined);
  const dirty = useRef(false);

  useEffect(() => {
    if (!dirty.current) setDraft(source);
  }, [source]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const patch = (p: Partial<T>) => {
    setDraft((d) => {
      const next = { ...d, ...p };
      dirty.current = true;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        dirty.current = false;
        save(next);
      }, delayMs);
      return next;
    });
  };
  return { draft, patch };
}

/** /media route for a bare relPath (library assets carry theirs precomputed) */
const mediaRoute = (relPath: string) =>
  "/media/" + relPath.split("/").map(encodeURIComponent).join("/");

const EMPTY_BIBLE: Bible = { version: 1, characters: [], locations: [], style: { artDirection: "", negativePrompt: "", cinematographyNotes: "", notes: "" }, updatedAt: "" };

/** LIVE — the production bible (characters / locations / style) for the active
 * project, plus the cloned-voice roster the character voice picker feeds from.
 * No sample fallback: without a core the Bible screen shows its empty state. */
export function useBible() {
  const project = useActiveProjectId();
  const media = useMediaBase();
  const utils = trpc.useUtils();
  const query = trpc.studio.bible.get.useQuery({ project }, { enabled: !!project });
  const voices = trpc.labs.voice.catalog.useQuery().data?.voices;

  const sync = { onSuccess: (b: Bible) => utils.studio.bible.get.setData({ project }, b) };
  const upsertCharMutation = trpc.studio.bible.upsertCharacter.useMutation(sync);
  const removeCharMutation = trpc.studio.bible.removeCharacter.useMutation(sync);
  const upsertLocMutation = trpc.studio.bible.upsertLocation.useMutation(sync);
  const removeLocMutation = trpc.studio.bible.removeLocation.useMutation(sync);
  const styleMutation = trpc.studio.bible.updateStyle.useMutation(sync);
  const seedMutation = trpc.studio.seedAnimalSitcom.useMutation({
    // the seed touches the bible, production.json, project assets AND the voice roster
    onSuccess: () => {
      void utils.studio.invalidate();
      void utils.library.invalidate();
      void utils.labs.invalidate();
    },
  });

  const { mutate: upsertChar } = upsertCharMutation;
  const { mutate: removeChar } = removeCharMutation;
  const { mutate: upsertLoc } = upsertLocMutation;
  const { mutate: removeLoc } = removeLocMutation;
  const { mutate: saveStyle } = styleMutation;
  const { mutateAsync: seedAsync } = seedMutation;

  return useMemo(
    () => ({
      project,
      live: !!query.data,
      bible: query.data ?? EMPTY_BIBLE,
      /** preview URL for a bible ref relPath (null without a live core) */
      refUrl: (relPath: string | null | undefined) =>
        relPath && media ? media(mediaRoute(relPath)) : undefined,
      /** cloned-voice roster for the voice picker */
      voices: voices ?? [],
      /** playable ref-clip URL for a roster voice (studio-owned clips only) */
      voiceUrl: (voiceId: string | null) => {
        const v = voices?.find((x) => x.id === voiceId);
        return v?.kind === "cloned" && v.source === "studio" && media
          ? media(mediaRoute(`voices/${v.id}.wav`))
          : undefined;
      },
      upsertCharacter: (character: BibleCharacter) => upsertChar({ project, character }),
      removeCharacter: (id: string) => removeChar({ project, id }),
      upsertLocation: (location: BibleLocation) => upsertLoc({ project, location }),
      removeLocation: (id: string) => removeLoc({ project, id }),
      updateStyle: (style: BibleStyle) => saveStyle({ project, style }),
      seed: (overwrite = false) => seedAsync({ project, overwrite }),
      seeding: seedMutation.isPending,
      seedResult: seedMutation.data,
      seedError: seedMutation.error?.message,
    }),
    [project, query.data, voices, media, upsertChar, removeChar, upsertLoc, removeLoc, saveStyle, seedAsync, seedMutation.isPending, seedMutation.data, seedMutation.error],
  );
}

/** LIVE — the show structure (seasons → episodes → scenes → shots) for the
 * active project. Granular mutations keep the cache in lockstep so the board,
 * the inspector, and a Director edit all converge on production.json. */
export function useProduction() {
  const project = useActiveProjectId();
  const utils = trpc.useUtils();
  const query = trpc.studio.production.get.useQuery({ project }, { enabled: !!project });

  const syncProd = (p: Production) => utils.studio.production.get.setData({ project }, p);
  const prodSync = { onSuccess: syncProd };
  const nodeSync = { onSuccess: (r: { production: Production }) => syncProd(r.production) };

  const saveMutation = trpc.studio.production.update.useMutation(prodSync);
  const addEpisodeMutation = trpc.studio.production.addEpisode.useMutation(nodeSync);
  const addSceneMutation = trpc.studio.production.addScene.useMutation(nodeSync);
  const addShotMutation = trpc.studio.production.addShot.useMutation(nodeSync);
  const updateEpisodeMutation = trpc.studio.production.updateEpisode.useMutation(prodSync);
  const updateSceneMutation = trpc.studio.production.updateScene.useMutation(prodSync);
  const updateShotMutation = trpc.studio.production.updateShot.useMutation(nodeSync);
  const removeEpisodeMutation = trpc.studio.production.removeEpisode.useMutation(prodSync);
  const removeSceneMutation = trpc.studio.production.removeScene.useMutation(prodSync);
  const removeShotMutation = trpc.studio.production.removeShot.useMutation(prodSync);

  const { mutate: save } = saveMutation;
  const { mutate: addEpisode } = addEpisodeMutation;
  const { mutate: addScene } = addSceneMutation;
  const { mutate: addShot } = addShotMutation;
  const { mutate: updateEpisode } = updateEpisodeMutation;
  const { mutate: updateScene } = updateSceneMutation;
  const { mutate: updateShot } = updateShotMutation;
  const { mutate: removeEpisode } = removeEpisodeMutation;
  const { mutate: removeScene } = removeSceneMutation;
  const { mutate: removeShot } = removeShotMutation;

  return useMemo(
    () => ({
      project,
      live: !!query.data,
      production: query.data ?? null,
      save: (production: Production) => save({ project, production }),
      addEpisode: (input: Omit<ProductionAddEpisode, "project">) =>
        addEpisode({ project, ...input }),
      addScene: (input: Omit<ProductionAddScene, "project">) => addScene({ project, ...input }),
      addShot: (input: Omit<ProductionAddShot, "project">) => addShot({ project, ...input }),
      updateEpisode: (episodeId: string, patch: Partial<Omit<Episode, "id" | "number" | "scenes">>) =>
        updateEpisode({ project, episodeId, patch }),
      updateScene: (sceneId: string, patch: Partial<Omit<Scene, "id" | "shots">>) =>
        updateScene({ project, sceneId, patch }),
      updateShot: (shotId: string, patch: Partial<Omit<Shot, "id">>) =>
        updateShot({ project, shotId, patch }),
      removeEpisode: (id: string) => removeEpisode({ project, id }),
      removeScene: (id: string) => removeScene({ project, id }),
      removeShot: (id: string) => removeShot({ project, id }),
    }),
    [project, query.data, save, addEpisode, addScene, addShot, updateEpisode, updateScene, updateShot, removeEpisode, removeScene, removeShot],
  );
}

type BoardJob = Job & { payload: Extract<JobPayload, { type: "image" }> };

/** LIVE — storyboard keyframe generation: enqueue qwen-edit board jobs for a
 * shot and watch the ones in flight (payload.board carries the shotId).
 * Finished stills attach server-side and arrive over studio.onUpdate. */
export function useStoryboard() {
  const project = useActiveProjectId();
  const utils = trpc.useUtils();
  const jobsData = trpc.jobs.list.useQuery(undefined, { placeholderData: jobs }).data;
  const mutation = trpc.studio.board.generate.useMutation({
    onSuccess: () => void utils.jobs.invalidate(),
  });
  const { mutate } = mutation;

  return useMemo(() => {
    const active = (jobsData ?? []).filter(
      (j): j is BoardJob =>
        j.payload?.type === "image" &&
        !!j.payload.board &&
        (j.status === "running" || j.status === "queued"),
    );
    return {
      project,
      generate: (input: Omit<StoryboardGenerate, "project">) => mutate({ ...input, project }),
      pending: mutation.isPending,
      error: mutation.error?.message,
      active,
      /** queued/running board jobs for one shot */
      shotJobs: (shotId: string) => active.filter((j) => j.payload.board?.shotId === shotId),
    };
  }, [project, jobsData, mutate, mutation.isPending, mutation.error]);
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
      comfyMode: live?.engines.comfyMode ?? "managed",
      comfyUrl: live?.engines.comfyUrl ?? "",
      setComfyMode(mode: Settings["engines"]["comfyMode"]) {
        update({ engines: { comfyMode: mode } });
      },
      setComfyUrl(url: string) {
        if (url.trim()) update({ engines: { comfyUrl: url.trim() } });
      },
      ttsMode: live?.engines.ttsMode ?? "managed",
      setTtsMode(mode: Settings["engines"]["ttsMode"]) {
        update({ engines: { ttsMode: mode } });
      },
      musicMode: live?.engines.musicMode ?? "managed",
      setMusicMode(mode: Settings["engines"]["musicMode"]) {
        update({ engines: { musicMode: mode } });
      },
      videoMode: live?.engines.videoMode ?? "external",
      setVideoMode(mode: Settings["engines"]["videoMode"]) {
        update({ engines: { videoMode: mode } });
      },
      setDefaultProvider(id: Settings["providers"]["default"]) {
        update({ providers: { default: id } });
      },
      falApiKey: live?.providers.falApiKey ?? "",
      setFalApiKey(key: string) {
        update({ providers: { falApiKey: key.trim() } });
      },
    };
  }, [live, disk, update]);
}
