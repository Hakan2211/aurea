import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Bible,
  BibleCharacter,
  BibleLocation,
  BibleStyle,
  DirectorAttachment,
  DirectorRef,
  DirectorToolCall,
  Episode,
  ImageDeckGenerate,
  ImageGenerate,
  VoiceConvertGenerate,
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
import { castRef, characterRef, settingRef } from "@aurea/shared";
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
  type Voice,
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

/** LIVE — the queue plus the verbs that act on it. The snapshot itself is kept
 * fresh by the LiveSync subscriber, so every mutation here is fire-and-forget;
 * the invalidate is only insurance for a dropped stream. */
export function useJobs() {
  const jobsQuery = trpc.jobs.list.useQuery(undefined, { placeholderData: jobs });
  const vramQuery = trpc.system.vram.useQuery(undefined, { placeholderData: vram });
  const stateQuery = trpc.jobs.state.useQuery(undefined, { placeholderData: { paused: false } });
  const utils = trpc.useUtils();
  const invalidate = { onSuccess: () => void utils.jobs.invalidate() };
  const { mutate: cancel } = trpc.jobs.cancel.useMutation(invalidate);
  const { mutate: retry } = trpc.jobs.retry.useMutation(invalidate);
  const { mutate: dismiss } = trpc.jobs.dismiss.useMutation(invalidate);
  const { mutate: clearFinished } = trpc.jobs.clearFinished.useMutation(invalidate);
  const { mutate: setPaused } = trpc.jobs.setPaused.useMutation(invalidate);
  return {
    jobs: jobsQuery.data ?? jobs,
    vram: vramQuery.data ?? vram,
    paused: stateQuery.data?.paused ?? false,
    /** the core is answering. On sample data the verbs below do nothing, and a
     * button that does nothing should say so rather than pretend. */
    live: !!jobsQuery.data && !jobsQuery.isPlaceholderData,
    cancel: (id: string) => cancel({ id }),
    retry: (id: string) => retry({ id }),
    dismiss: (id: string) => dismiss({ id }),
    clearFinished: () => clearFinished(),
    setPaused: (paused: boolean) => setPaused({ paused }),
  };
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

/** LIVE — the channel presets in <videofastDir>/accounts the finished-video
 * pipeline renders as. Empty when the videofast path isn't configured. */
export function useVideofastAccounts() {
  const query = trpc.videofast.accounts.useQuery(undefined, { staleTime: 60_000 });
  return { accounts: query.data ?? [], live: !!query.data };
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
  // the latest export job for this project, straight off the live jobs stream;
  // an active run wins, otherwise the newest finished one (the stream lists
  // finished jobs oldest-first, so a bare find() would resurface the first
  // export forever)
  const jobsData = trpc.jobs.list.useQuery(undefined, { placeholderData: jobs }).data;
  const exportJobs = jobsData?.filter(
    (j) => j.payload?.type === "export" && j.payload.project === project,
  );
  const exportJob =
    exportJobs?.find((j) => j.status === "running" || j.status === "queued") ?? exportJobs?.at(-1);

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
  const removeMutation = trpc.models.remove.useMutation(refresh);
  const { mutate: remove } = removeMutation;
  // linking reshapes availability everywhere, so settle the whole cache
  const relink = {
    onSuccess: () => {
      void utils.models.list.invalidate();
      void utils.labs.invalidate();
      void utils.settings.invalidate();
    },
  };
  const { mutateAsync: linkRoot } = trpc.models.linkRoot.useMutation(relink);
  const { mutateAsync: unlinkRoot } = trpc.models.unlinkRoot.useMutation(relink);
  const settings = trpc.settings.get.useQuery().data;
  return {
    models: (query.data ?? []) as ModelEntry[],
    live: !!query.data,
    download: (id: string, acceptLicense = false) => download({ id, acceptLicense }),
    cancel: (id: string) => cancel({ id }),
    remove: (id: string) => remove({ id }),
    removeError: removeMutation.error?.message ?? null,
    /** folders the user pointed us at; weights inside them read as installed */
    modelRoots: settings?.storage.modelRoots ?? [],
    linkRoot: (root: string) => linkRoot({ root }),
    unlinkRoot: (root: string) => unlinkRoot({ root }),
  };
}

/** What a candidate folder would give us, before anything is saved. */
export function useRootPreview(root: string) {
  const query = trpc.models.previewRoot.useQuery(
    { root },
    { enabled: root.trim().length > 2, staleTime: 0 },
  );
  return {
    found: query.data?.models ?? [],
    checking: query.isFetching,
    checked: !!query.data,
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

/** last path segment, tolerant of Windows separators in job.output */
const pathBasename = (p?: string) => p?.split(/[\\/]/).pop();

const labJobs = <T extends JobPayload["type"]>(all: Job[] | undefined, ...types: T[]) =>
  (all ?? []).filter(
    (j): j is LabJob<T> =>
      types.includes(j.payload?.type as T) && (j.status === "running" || j.status === "queued"),
  );

/** A lab job that died. These carry the message that actually explains a
 * "nothing happened" — missing weights, a rejected graph, a cancel — and used
 * to be visible only in the Job Center, three screens away from the person
 * who pressed Generate. */
export interface LabFailure {
  id: string;
  title: string;
  engine: string;
  error: string;
}

const labFailures = (all: Job[] | undefined, ...types: JobPayload["type"][]): LabFailure[] =>
  (all ?? [])
    .filter((j) => types.includes(j.payload?.type as JobPayload["type"]) && j.status === "failed")
    // the jobs stream lists finished oldest-first — the failure that explains
    // "my render just vanished" is at the END, not the front
    .slice(-3)
    .reverse()
    .map((j) => ({
      id: j.id,
      title: j.title,
      engine: j.engine,
      error: j.error ?? "failed without a reason",
    }));

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

const IMAGE_ADVANCED_FALLBACK = {
  sizeMin: 512,
  sizeMax: 2048,
  sizeStep: 16,
  /** cloud models render off this GPU, so they aren't held to sizeMax */
  sizeMaxByModel: {} as Record<string, number>,
  stepsMax: 50,
  cfgMax: 15,
  defaults: {} as Record<string, { steps: number; cfg: number }>,
};

/** Ceiling on the stills the lab canvas will hold. This is a memory guard, not
 * a view: the canvas pages through the roll a screenful at a time, so the
 * number only has to be larger than any run of work you'd scroll back through.
 * It used to be 24, which silently hid everything older than a day or two. */
const IMAGE_ROLL_MAX = 600;

export function useImageLab() {
  const catalog = trpc.labs.image.catalog.useQuery().data;
  const { media, project, invalidate, jobsData, kindAssets } = useLabData("image");
  const mutation = trpc.labs.image.generate.useMutation(invalidate);
  const { mutate } = mutation;
  const addRefMutation = trpc.labs.image.addRef.useMutation();
  const { mutateAsync: addRefAsync } = addRefMutation;
  const deckMutation = trpc.labs.image.generateDeck.useMutation(invalidate);
  const { mutate: mutateDeck } = deckMutation;
  const upscaleMutation = trpc.labs.image.upscale.useMutation(invalidate);
  const { mutate: mutateUpscale } = upscaleMutation;
  const { mutate: retryJob } = trpc.jobs.retry.useMutation(invalidate);
  const remove = useRemoveAssets();
  // upscale jobs this session has watched run — lets a just-completed job keep
  // its placeholder tile until the library refetch actually delivers the file
  // (session-scoped, so stale history can never spawn phantom tiles)
  const seenUpscales = useRef(new Set<string>());

  return useMemo(() => {
    const generate = (input: Omit<ImageGenerate, "project">) => mutate({ ...input, project });
    const generateDeck = (input: Omit<ImageDeckGenerate, "project">) =>
      mutateDeck({ ...input, project });
    /** stage an uploaded reference; resolves to its dataRoot-relative path */
    const addRef = async (name: string, pngBase64: string) =>
      (await addRefAsync({ project, name, pngBase64 })).ref;
    /** enlarge an existing still in place — "fast" = Real-ESRGAN 4×,
     * "refine" = qwen-edit + Upscale2K LoRA re-render */
    const upscale = (source: string, mode: "fast" | "refine" = "fast") =>
      mutateUpscale({ source, mode, project });
    /** a failed enqueue used to vanish silently — surface it under the button */
    const error =
      mutation.error?.message ??
      deckMutation.error?.message ??
      upscaleMutation.error?.message ??
      remove.error?.message ??
      null;
    const extras = {
      addRef,
      addingRef: addRefMutation.isPending,
      generateDeck,
      upscale,
      remove: remove.remove,
      removing: remove.removing,
      error,
      /** jobs that died on the engine — surfaced in the lab, not just the
       * Job Center, because the message is the answer to "why nothing?" */
      failures: [] as LabFailure[],
      retry: (id: string) => retryJob({ id }),
      /** the enqueue round-trip itself — distinct from busy (= work on the
       * GPU). Only this blocks the button; the engine has a queue, so a
       * running deck must not stop you from queueing the next run. */
      sending: mutation.isPending || deckMutation.isPending || upscaleMutation.isPending,
      /** relPaths of stills with an upscale run in flight — tiles badge these */
      upscaling: [] as string[],
      decks: [] as DeckProgress[],
      refsMax: 3,
      /** per-model ref ceilings — local qwen-edit 3, cloud gpt-image-2 16 */
      refsMaxByModel: {} as Record<string, number>,
      cloudModels: [] as string[],
      /** models a bulk deck may use — cloud models are excluded on purpose */
      deckModels: [] as string[],
      modelNotes: {} as Record<string, string>,
      qualities: [] as string[],
      outputFormats: [] as string[],
      autoSizeModels: [] as string[],
      maskModels: [] as string[],
      countMax: 4,
      deckMax: 100,
      advancedCfg: IMAGE_ADVANCED_FALLBACK,
    };
    if (!catalog || !kindAssets) return { ...imageLab, ...extras, generate, busy: false };
    extras.refsMax = catalog.refsMax ?? 3;
    extras.refsMaxByModel = catalog.refsMaxByModel ?? {};
    extras.cloudModels = catalog.cloudModels ?? [];
    extras.deckModels = catalog.deckModels ?? [];
    extras.modelNotes = catalog.modelNotes ?? {};
    extras.qualities = catalog.qualities ?? [];
    extras.outputFormats = catalog.outputFormats ?? [];
    extras.autoSizeModels = catalog.autoSizeModels ?? [];
    extras.maskModels = catalog.maskModels ?? [];
    extras.countMax = catalog.countMax ?? 4;
    extras.advancedCfg = catalog.advanced ?? IMAGE_ADVANCED_FALLBACK;

    extras.failures = labFailures(jobsData, "image", "imageDeck", "imageUpscale");

    const active = labJobs(jobsData, "image", "imageDeck", "imageUpscale");
    // a deck is one job rendering N prompts — it gets its own progress card
    // rather than N phantom tiles, so a 40-prompt run doesn't bury the roll
    extras.decks = active
      .filter((j) => j.payload.type === "imageDeck")
      .map((j) => {
        const total = j.payload.type === "imageDeck" ? j.payload.prompts.length : 0;
        return {
          id: j.id,
          name: j.payload.type === "imageDeck" ? j.payload.deckName : j.title,
          total,
          // progress runs 0..100 across the whole deck; floor keeps "3 of 40"
          // from claiming an image that is still sampling
          done: Math.min(total, Math.floor((j.progress / 100) * total)),
          progress: j.progress,
          stage: j.stage ?? (j.status === "queued" ? "Queued" : "Working"),
          queued: j.status === "queued",
        };
      });

    extras.upscaling = active
      .filter((j) => j.payload.type === "imageUpscale")
      .map((j) => (j.payload.type === "imageUpscale" ? j.payload.source : ""))
      .filter(Boolean);

    // completion drops a job out of `active` instantly, but the library
    // refetch that carries its output is still in flight — without a bridge
    // the placeholder blinks out and "nothing" appears. Hold the tile at 100%
    // until the file shows up in the roll (or the job failed).
    for (const j of active) if (j.payload.type === "imageUpscale") seenUpscales.current.add(j.id);
    const settling = (jobsData ?? []).filter((j) => {
      if (j.payload?.type !== "imageUpscale" || !seenUpscales.current.has(j.id)) return false;
      if (j.status === "failed") {
        seenUpscales.current.delete(j.id);
        return false;
      }
      if (j.status !== "completed") return false;
      const name = pathBasename(j.output);
      if (name && kindAssets.some((a) => a.name === name)) {
        seenUpscales.current.delete(j.id);
        return false;
      }
      return true;
    });

    const tiles: ImageTile[] = [
      // an in-flight upscale used to render nothing — "Upscale" looked dead.
      // It gets a labeled progress tile like any other render.
      ...active
        .filter((j) => j.payload.type === "imageUpscale")
        .map((j) => ({
          id: j.id,
          swatch: labSwatch(j.id),
          generating: { progress: j.progress, label: j.title },
        })),
      ...settling.map((j) => ({
        id: j.id,
        swatch: labSwatch(j.id),
        generating: { progress: 100, label: "Saving…" },
      })),
      ...active
        .filter((j) => j.payload.type === "image")
        .flatMap((j) =>
          Array.from({ length: j.payload.type === "image" ? j.payload.count : 1 }, (_, i) => ({
            id: `${j.id}:${i}`,
            swatch: labSwatch(`${j.id}${i}`),
            generating: { progress: j.progress },
          })),
        ),
      ...kindAssets.map((a) => ({
        id: a.id,
        swatch: labSwatch(a.id),
        url: media ? media(a.url) : undefined,
        relPath: a.relPath,
        name: a.name,
        upscaled: a.meta?.origin === "imageUpscale",
        day: a.createdAt.slice(0, 10),
      })),
    ].slice(0, IMAGE_ROLL_MAX);

    // history = the image roll grouped by day, newest first. The same day keys
    // separate the canvas, so a row and its section always agree.
    const byDay = new Map<string, CoreAsset[]>();
    for (const a of kindAssets) {
      const day = a.createdAt.slice(0, 10);
      byDay.set(day, [...(byDay.get(day) ?? []), a]);
    }
    const history: ImageHistoryEntry[] = [...byDay.entries()].map(([day, group], i) => ({
      id: day,
      when: relTime(group[0].createdAt),
      count: group.length,
      aspect: "",
      swatches: group.slice(0, 4).map((a) => labSwatch(a.id)),
      urls: group.slice(0, 4).map((a) => (media ? media(a.url) : undefined)),
      current: i === 0,
      relPaths: group.map((a) => a.relPath),
    }));

    return {
      ...imageLab,
      ...extras,
      models: catalog.models.map((m) => (m.available ? m : { ...m, note: "not installed" })),
      aspects: catalog.aspects,
      presets: catalog.presets,
      batch: tiles,
      history,
      generate,
      busy: mutation.isPending || deckMutation.isPending || active.length > 0,
    };
  }, [
    catalog,
    kindAssets,
    jobsData,
    media,
    project,
    mutate,
    mutateDeck,
    mutation.isPending,
    mutation.error,
    deckMutation.isPending,
    deckMutation.error,
    mutateUpscale,
    retryJob,
    upscaleMutation.isPending,
    upscaleMutation.error,
    addRefAsync,
    addRefMutation.isPending,
    remove,
  ]);
}

/** a deck job in flight — one card, not one tile per prompt */
export interface DeckProgress {
  id: string;
  name: string;
  /** prompts in the deck */
  total: number;
  /** images finished so far, derived from job progress */
  done: number;
  progress: number;
  stage: string;
  queued: boolean;
}

/** Delete files from disk for good (assets + staged refs), then refetch the
 * library so every screen showing them drops them at once. */
export function useRemoveAssets() {
  const utils = trpc.useUtils();
  const mutation = trpc.library.remove.useMutation({
    onSuccess: () => void utils.library.invalidate(),
  });
  const { mutateAsync } = mutation;
  return useMemo(
    () => ({
      remove: (relPaths: string | string[]) =>
        mutateAsync({ relPaths: typeof relPaths === "string" ? [relPaths] : relPaths }),
      removing: mutation.isPending,
      error: mutation.error,
    }),
    [mutateAsync, mutation.isPending, mutation.error],
  );
}

/** Likes are a renderer-side bookmark: nothing on disk changes, so they live
 * in localStorage keyed by the asset's dataRoot-relative path. Swap for a real
 * store the day the library grows metadata. */
const LIKES_KEY = "aurea.likes";

export function useLikes() {
  const [liked, setLiked] = useState<Set<string>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(LIKES_KEY) ?? "[]");
      return new Set(Array.isArray(raw) ? (raw as string[]) : []);
    } catch {
      return new Set();
    }
  });
  return useMemo(
    () => ({
      isLiked: (relPath?: string) => !!relPath && liked.has(relPath),
      toggleLike: (relPath?: string) => {
        if (!relPath) return;
        setLiked((prev) => {
          const next = new Set(prev);
          if (!next.delete(relPath)) next.add(relPath);
          localStorage.setItem(LIKES_KEY, JSON.stringify([...next]));
          return next;
        });
      },
    }),
    [liked],
  );
}

/** Save a media-route file to disk. Electron shows its native Save dialog for
 * anchor-triggered downloads; fetching to a blob first keeps the studiod token
 * out of the saved filename and lets us name the file properly. */
export async function downloadAsset(url: string, filename: string): Promise<void> {
  const blob = await (await fetch(url)).blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoke once the download has had a chance to start
  setTimeout(() => URL.revokeObjectURL(href), 30_000);
}

export function useVoiceLab() {
  const catalog = trpc.labs.voice.catalog.useQuery().data;
  const { media, project, invalidate, jobsData, kindAssets } = useLabData("audio");
  const allAssets = trpc.library.list.useQuery().data?.assets;
  const mutation = trpc.labs.voice.generate.useMutation(invalidate);
  const { mutate } = mutation;
  const utils = trpc.useUtils();
  // adding/removing a voice reshapes every lab catalog that lists voices
  const refreshVoices = { onSuccess: () => void utils.labs.invalidate() };
  const addMutation = trpc.labs.voice.add.useMutation(refreshVoices);
  const removeMutation = trpc.labs.voice.remove.useMutation(refreshVoices);
  const renameMutation = trpc.labs.voice.rename.useMutation(refreshVoices);
  const hideMutation = trpc.labs.voice.setHidden.useMutation(refreshVoices);
  const { mutateAsync: addAsync } = addMutation;
  const { mutateAsync: removeAsync } = removeMutation;
  const { mutateAsync: renameAsync } = renameMutation;
  const { mutateAsync: hideAsync } = hideMutation;
  const convertMutation = trpc.labs.voice.convert.useMutation(invalidate);
  const { mutate: mutateConvert } = convertMutation;
  const addSourceMutation = trpc.labs.voice.addSource.useMutation();
  const { mutateAsync: addSourceAsync } = addSourceMutation;
  const trainRvcMutation = trpc.labs.voice.trainRvc.useMutation(invalidate);
  const { mutate: mutateTrainRvc } = trainRvcMutation;
  const { mutate: retryJob } = trpc.jobs.retry.useMutation(invalidate);
  const removeAssets = useRemoveAssets();

  return useMemo(() => {
    const generate = (input: Omit<TtsGenerate, "project">) => mutate({ ...input, project });
    const addVoice = (name: string, wavBase64: string) => addAsync({ name, wavBase64 });
    const removeVoice = (id: string) => removeAsync({ id });
    const cloning = {
      addVoice,
      removeVoice,
      /** display-only rename — the voice id (and everything referencing it) stays */
      renameVoice: (id: string, name: string) => renameAsync({ id, name }),
      /** how read-only voices leave the roster: nothing on disk is touched */
      hideVoice: (id: string, hidden: boolean) => hideAsync({ id, hidden }),
      adding: addMutation.isPending,
    };
    /** delete a generated take (a real library file) from disk */
    const takeOps = {
      removeTake: removeAssets.remove,
      removingTake: removeAssets.removing,
      failures: [] as LabFailure[],
      retry: (id: string) => retryJob({ id }),
    };
    const convert = (input: Omit<VoiceConvertGenerate, "project">) =>
      mutateConvert({ ...input, project });
    /** upload a conversion source; resolves to its dataRoot-relative path */
    const addSource = async (name: string, wavBase64: string) =>
      (await addSourceAsync({ project, name, wavBase64 })).source;
    const conversion = {
      convert,
      addSource,
      addingSource: addSourceMutation.isPending,
      convertAvailable: catalog?.convert?.available ?? false,
      convertStepsDefault: catalog?.convert?.stepsDefault ?? { speak: 25, sing: 30 },
      /** Replicate RVC v2 — token present; per-voice readiness is Voice.rvcTrained */
      rvcAvailable: catalog?.rvc?.available ?? false,
      rvcTrainEstimate: catalog?.rvc?.trainEstimate ?? "≈ $1 · ~15 min",
      rvcConvertEstimate: catalog?.rvc?.convertEstimate ?? "≈ $0.10",
      /** kick off cloud training of this voice's RVC model (paid) */
      trainRvc: (voiceId: string) => mutateTrainRvc({ voice: voiceId, project }),
      /** recent audio/music library assets usable as conversion sources */
      convertSources: (allAssets ?? [])
        .filter((a) => a.kind === "audio" || a.kind === "music")
        .slice(0, 30)
        .map((a) => ({ relPath: a.relPath, name: a.name, kind: a.kind })),
    };
    if (!catalog || !kindAssets) {
      return {
        ...voiceLab,
        ...cloning,
        ...takeOps,
        ...conversion,
        hiddenVoices: [] as Voice[],
        generate,
        busy: false,
      };
    }

    // conversions chained off a Music-lab track (context "music") belong to
    // the Music lab — here only the Voice lab's own work shows
    const voiceJobs = (jobsData ?? []).filter(
      (j) => !(j.payload?.type === "voiceConvert" && j.payload.context === "music"),
    );
    takeOps.failures = labFailures(voiceJobs, "tts", "voiceConvert", "rvcTrain");
    const active = labJobs(voiceJobs, "tts", "voiceConvert", "rvcTrain");
    const decorateVoice = (v: (typeof catalog.voices)[number]): Voice => ({
      ...v,
      swatch: labSwatch(v.id),
      // cloned voices carry a playable reference clip — /voiceref/ streams it
      sampleUrl: v.kind === "cloned" && media ? media(`/voiceref/${v.id}`) : undefined,
      rvcTrained: v.rvcTrained ?? false,
      // training in flight for this voice — the row shows a spinner state
      rvcTraining: active.some((j) => j.payload.type === "rvcTrain" && j.payload.voice === v.id),
    });
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
        relPath: a.relPath,
        selected: i === 0,
      })),
    ].slice(0, 14);

    return {
      ...voiceLab,
      ...cloning,
      ...takeOps,
      ...conversion,
      engines: catalog.engines.map(({ available, ...e }) =>
        available ? e : { ...e, note: "not installed" },
      ),
      voices: catalog.voices.map(decorateVoice),
      /** hidden from the pickers; the Voice lab lists them for restore */
      hiddenVoices: (catalog.hiddenVoices ?? []).map(decorateVoice),
      scriptMax: catalog.scriptMax,
      takes,
      playback: { position: "00:00.0", total: "", played: 0 },
      generate,
      busy: mutation.isPending || convertMutation.isPending || active.length > 0,
    };
  }, [
    catalog,
    kindAssets,
    allAssets,
    jobsData,
    media,
    project,
    mutate,
    mutateConvert,
    mutation.isPending,
    convertMutation.isPending,
    addAsync,
    removeAsync,
    addMutation.isPending,
    addSourceAsync,
    addSourceMutation.isPending,
    mutateTrainRvc,
    retryJob,
    removeAssets,
    renameAsync,
    hideAsync,
  ]);
}

const fmtClock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

export function useMusicLab() {
  const catalog = trpc.labs.music.catalog.useQuery().data;
  const { media, project, invalidate, jobsData, kindAssets } = useLabData("music");
  const mutation = trpc.labs.music.generate.useMutation(invalidate);
  const { mutate } = mutation;
  const { mutate: cancelJob } = trpc.jobs.cancel.useMutation(invalidate);
  const { mutate: retryJob } = trpc.jobs.retry.useMutation(invalidate);
  const removeAssets = useRemoveAssets();

  return useMemo(() => {
    const generate = (input: Omit<MusicGenerate, "project">) => mutate({ ...input, project });
    const trackOps = {
      /** stop a generating track's job */
      cancel: (jobId: string) => cancelJob({ id: jobId }),
      retry: (jobId: string) => retryJob({ id: jobId }),
      /** delete a finished track from disk */
      remove: removeAssets.remove,
      removing: removeAssets.removing,
      failures: [] as LabFailure[],
    };
    const advanced = {
      lyricsMax: 4096,
      bpmRange: [30, 300] as [number, number],
      timesignatures: ["2", "3", "4", "6"],
      languages: ["unknown", "en"],
      stepsDefault: 8,
      shiftDefault: 3.0,
      metadataManagedOnly: false,
    };
    if (!catalog || !kindAssets) return { ...musicLab, ...advanced, ...trackOps, generate, busy: false };
    // the Music lab owns its own jobs plus the Seed-VC conversions chained off
    // its tracks (context "music") — plain Voice-lab conversions stay out
    const musicJobs = (jobsData ?? []).filter(
      (j) => j.payload?.type !== "voiceConvert" || j.payload.context === "music",
    );
    trackOps.failures = labFailures(musicJobs, "music", "voiceConvert");
    advanced.lyricsMax = catalog.lyricsMax ?? 4096;
    advanced.bpmRange = catalog.bpmRange ?? advanced.bpmRange;
    advanced.timesignatures = catalog.timesignatures ?? advanced.timesignatures;
    advanced.languages = catalog.languages ?? advanced.languages;
    advanced.stepsDefault = catalog.stepsDefault ?? 8;
    advanced.shiftDefault = catalog.shiftDefault ?? 3.0;
    advanced.metadataManagedOnly = catalog.metadataManagedOnly ?? false;

    const active = labJobs(musicJobs, "music", "voiceConvert");
    const tracks: MusicTrack[] = [
      ...active.map((j) => ({
        id: j.id,
        title: j.title,
        bpm: 0,
        key: "",
        duration: j.payload.type === "music" ? fmtClock(j.payload.durationSec) : "",
        waveSeed: waveSeed(j.id),
        swatch: labSwatch(j.id),
        // a chained conversion is by definition re-voicing sung vocals
        arrangement: j.payload.type === "music" ? j.payload.arrangement : ("vocals" as const),
        generating: { progress: j.progress, stage: j.stage ?? "Queued" },
      })),
      ...kindAssets.map((a, i) => ({
        id: a.id,
        title: strip(a.name),
        // the sidecar carries what the take was actually sung to — tempo and
        // key included, whether you asked for them or the model chose
        bpm: a.meta?.bpm ?? 0,
        key: a.meta?.keyscale ?? "",
        // real length is probed client-side from the file (useMediaDuration);
        // "" here means "unknown yet", never the file size
        duration: "",
        waveSeed: waveSeed(a.id),
        swatch: labSwatch(a.id),
        // provenance sidecar knows; files without one predate it → default old label
        arrangement: a.meta?.arrangement ?? ("instrumental" as const),
        lyrics: a.meta?.lyrics,
        prompt: a.meta?.prompt,
        origin: a.meta?.origin,
        url: media ? media(a.url) : undefined,
        relPath: a.relPath,
        selected: i === 0,
      })),
    ].slice(0, 12);

    return {
      ...musicLab,
      ...advanced,
      ...trackOps,
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
  }, [catalog, kindAssets, jobsData, media, project, mutate, mutation.isPending, cancelJob, retryJob, removeAssets]);
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
  // which LTX features this machine's ComfyUI can reach — gates Director mode
  const capabilities = trpc.labs.video.capabilities.useQuery(undefined, {
    staleTime: 60_000,
  }).data;
  const { media, project, invalidate, jobsData, kindAssets } = useLabData("video");
  // the doc-26 camera bank, so a prompt beat can say "ws" and mean the clause
  const bible = trpc.studio.bible.get.useQuery(
    { project },
    { enabled: !!project, staleTime: 60_000 },
  ).data;
  const cinematography = bible?.cinematography;
  const allAssets = trpc.library.list.useQuery().data?.assets;
  const images = allAssets?.filter((a) => a.kind === "image");
  const mutation = trpc.labs.video.generate.useMutation(invalidate);
  const { mutate } = mutation;
  const { mutate: retryJob } = trpc.jobs.retry.useMutation(invalidate);

  return useMemo(() => {
    const extras = {
      /** every library still, newest first — the Replace-frame picker's roll */
      frames: (images ?? []).slice(0, 60).map((a) => ({
        relPath: a.relPath,
        name: a.name,
        meta: `${fmtBytes(a.sizeBytes)} · ${a.ext.toUpperCase()}`,
        swatch: labSwatch(a.id),
        url: media ? media(a.url) : undefined,
      })),
      /** voice takes usable as ia2v dialogue audio (lip-sync). The url is what
       * the Director's audio lane measures: nothing on disk records a take's
       * length, and the lane can't draw a block without one, so it loads the
       * metadata in the browser rather than making the core ffprobe every
       * asset in the library on every list. */
      audioSources: (allAssets ?? [])
        .filter((a) => a.kind === "audio")
        .slice(0, 30)
        .map((a) => ({ relPath: a.relPath, name: a.name, url: media ? media(a.url) : undefined })),
      /** The preview url of ANY library still by relPath — the panel's roll is
       * the newest 60 images, and a shot sent from the storyboard may name a
       * keyframe older than that. */
      stillUrl: (rel: string | null | undefined) => {
        const a = rel ? (allAssets ?? []).find((x) => x.relPath === rel) : undefined;
        return a && media ? media(a.url) : undefined;
      },
      /** every video take in the library — what a motion reference is picked
       * from. Wider than `takes` (which is this lab's newest eight) because the
       * clip whose movement you want is often an old one, or an import. */
      videoSources: (allAssets ?? [])
        .filter((a) => a.kind === "video")
        .slice(0, 40)
        .map((a) => ({ relPath: a.relPath, name: a.name, url: media ? media(a.url) : undefined })),
      failures: labFailures(jobsData, "video"),
      retry: (id: string) => retryJob({ id }),
      /** a rejected enqueue — surfaced under the Generate button */
      error: mutation.error?.message ?? null,
      /** null while the probe is in flight; the panel treats that as "unknown"
       * rather than "unsupported" so Director doesn't flicker off on load */
      capabilities: capabilities ?? null,
      /** shot sizes and moves for the prompt-beat camera pickers; empty until
       * the project's bible has the cinematography bank imported */
      cinematography: cinematography ?? EMPTY_CINEMATOGRAPHY,
      /** The cast a Director shot can reference, already turned into sheet cells
       * — a character with a locked storyboard reference fills a ref slot with
       * its own image AND the wardrobe/anchor prose from the bible, which is the
       * whole point of having a bible. Characters with no reference still are
       * skipped: a cell needs a picture. */
      cast: (bible?.characters ?? [])
        .map((c) => {
          const image = characterRef(c);
          return image ? { id: c.id, name: c.name, ref: castRef(c, image) } : null;
        })
        .filter((c): c is { id: string; name: string; ref: DirectorRef } => c !== null),
      /** the show's sets, same deal — a location with a still can be a cell */
      sets: (bible?.locations ?? [])
        .filter((l) => l.refs.length > 0)
        .map((l) => ({ id: l.id, name: l.name, ref: settingRef(l, l.refs[0]) })),
    };
    if (!catalog || !kindAssets) {
      return {
        ...videoLab,
        ...extras,
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

    /** callers may override startFrame (Replace picker) and attach audio (ia2v) */
    const generate = (input: Omit<VideoGenerate, "project">) =>
      mutate({ ...input, startFrame: input.startFrame ?? startFrame.relPath, project });

    const takes: VideoTake[] = kindAssets.slice(0, 8).map((a, i) => ({
      id: a.id,
      label: strip(a.name),
      swatch: labSwatch(a.id),
      url: media ? media(a.url) : undefined,
      relPath: a.relPath,
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
      ...extras,
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
  }, [catalog, capabilities, bible, cinematography, kindAssets, images, allAssets, jobsData, media, project, mutate, mutation.isPending, mutation.error, retryJob]);
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

const EMPTY_CINEMATOGRAPHY: Bible["cinematography"] = {
  shotSizes: [], angles: [], moves: [], lenses: [], compositions: [], lighting: [],
  danceSignatures: [], formations: [],
  templates: { keyframe: "", ltxCoverage: "", transitionMorph: "", seedanceHero: "" },
  rules: "", negativePrompt: "",
};
const EMPTY_BIBLE: Bible = { version: 1, characters: [], locations: [], style: { artDirection: "", negativePrompt: "", cinematographyNotes: "", notes: "" }, cinematography: EMPTY_CINEMATOGRAPHY, updatedAt: "" };

/** LIVE — the production bible (characters / locations / style) for the active
 * project, plus the cloned-voice roster the character voice picker feeds from.
 * No sample fallback: without a core the Bible screen shows its empty state. */
export function useBible() {
  const project = useActiveProjectId();
  const media = useMediaBase();
  const utils = trpc.useUtils();
  const query = trpc.studio.bible.get.useQuery({ project }, { enabled: !!project });
  const voices = trpc.labs.voice.catalog.useQuery().data?.voices;
  // the project's own generated stills, newest first — so a set plate boarded in
  // the Image lab can be attached as a reference without a round-trip through
  // the filesystem. These stay library paths, never staged copies.
  const libraryAssets = trpc.library.list.useQuery().data?.assets;

  const sync = { onSuccess: (b: Bible) => utils.studio.bible.get.setData({ project }, b) };
  const upsertCharMutation = trpc.studio.bible.upsertCharacter.useMutation(sync);
  const removeCharMutation = trpc.studio.bible.removeCharacter.useMutation(sync);
  const upsertLocMutation = trpc.studio.bible.upsertLocation.useMutation(sync);
  const removeLocMutation = trpc.studio.bible.removeLocation.useMutation(sync);
  const styleMutation = trpc.studio.bible.updateStyle.useMutation(sync);
  const cineMutation = trpc.studio.bible.importCinematography.useMutation(sync);
  // the Bible manages its own reference images: uploads land in the project's
  // refs/ folder (same staging the image lab uses), and a ref the user drops
  // that came from there is deleted for good rather than left orphaned
  const addRefMutation = trpc.labs.image.addRef.useMutation();
  const removeAssets = useRemoveAssets();
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
  const { mutate: importCine } = cineMutation;
  const { mutateAsync: seedAsync } = seedMutation;
  const { mutateAsync: addRefAsync } = addRefMutation;
  const { remove: removeFiles } = removeAssets;

  return useMemo(
    () => ({
      project,
      live: !!query.data,
      bible: query.data ?? EMPTY_BIBLE,
      /** preview URL for a bible ref relPath (null without a live core) */
      refUrl: (relPath: string | null | undefined) =>
        relPath && media ? media(mediaRoute(relPath)) : undefined,
      /** every generated still in this project, newest first — the source list
       * for "Choose from library" on a character's or location's references */
      libraryImages: (libraryAssets ?? [])
        .filter((a) => a.kind === "image" && a.project === project)
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
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
      /** stage an uploaded reference image; resolves to its dataRoot-relative
       * path, ready to drop into a character's or location's refs */
      uploadRef: async (name: string, pngBase64: string) =>
        (await addRefAsync({ project, name, pngBase64 })).ref,
      uploadingRef: addRefMutation.isPending,
      /** delete a staged upload from disk — only ever called for files under
       * the project's own refs/ folder, never for library assets */
      deleteRefFile: (relPath: string) => removeFiles(relPath),
      /** install the curated doc-26 cinematography bank */
      importCinematography: () => importCine({ project }),
      importingCinematography: cineMutation.isPending,
      seed: (overwrite = false) => seedAsync({ project, overwrite }),
      seeding: seedMutation.isPending,
      seedResult: seedMutation.data,
      seedError: seedMutation.error?.message,
    }),
    [project, query.data, voices, libraryAssets, media, upsertChar, removeChar, upsertLoc, removeLoc, saveStyle, importCine, cineMutation.isPending, addRefAsync, addRefMutation.isPending, removeFiles, seedAsync, seedMutation.isPending, seedMutation.data, seedMutation.error],
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
      /** A boarded shot as a Director timeline — beats composed from the script
       * lines, cast refs from the bible, voice takes measured and placed. The
       * core does the composing (it can measure a take and probe the engine),
       * so "Send to Director" and the shot_from_storyboard tool hand the Video
       * lab the same shot. */
      composeShot: (shotId: string) => utils.studio.board.shotSpec.fetch({ project, shotId }),
    };
  }, [project, jobsData, utils, mutate, mutation.isPending, mutation.error]);
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
      videoTuning: live?.engines.videoTuning ?? {
        chunkFeedForward: true,
        sageAttention: false,
        sampler: "euler" as const,
        nag: false,
      },
      setVideoTuning(patch: Partial<Settings["engines"]["videoTuning"]>) {
        update({ engines: { videoTuning: patch } });
      },
      setDefaultProvider(id: Settings["providers"]["default"]) {
        update({ providers: { default: id } });
      },
      falApiKey: live?.providers.falApiKey ?? "",
      setFalApiKey(key: string) {
        update({ providers: { falApiKey: key.trim() } });
      },
      replicateApiToken: live?.providers.replicateApiToken ?? "",
      setReplicateApiToken(key: string) {
        update({ providers: { replicateApiToken: key.trim() } });
      },
    };
  }, [live, disk, update]);
}
