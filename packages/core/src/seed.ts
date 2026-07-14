/* Seed state for the P0 skeleton — the same fixtures the screens were designed
 * against (apps/desktop/src/data/sample.ts), now owned by studiod. Real state
 * comes from the project store + engine adapters later in P0. */

import type { Job, Project } from "@aurea/shared";

export const seedProjects: Project[] = [
  { id: "animal-sitcom", name: "Animal Sitcom", meta: "S01E03 · 12 shots" },
  { id: "noir-ascend", name: "Noir Ascend", meta: "Motivation channel · 5 queued" },
];

export const seedJobs: Job[] = [
  {
    id: "j1",
    title: "Loft push-in — Take 4",
    kind: "video",
    engine: "LTX-2 · local",
    status: "running",
    progress: 71,
    stage: "Upscaling",
    eta: "00:02:15",
    priority: "interactive",
    detail: "1080p → 4K · 6s · 25 fps",
    project: "/animal-sitcom/s01e03",
    elapsed: "00:04:12",
  },
  {
    id: "j2",
    title: "Sterling VO retakes ×3",
    kind: "tts",
    engine: "Chatterbox",
    status: "queued",
    progress: 0,
    priority: "preview",
    detail: "Sterling · cloned voice",
    project: "/animal-sitcom/s01e03",
  },
  {
    id: "j3",
    title: "Episode sting variations",
    kind: "music",
    engine: "ACE-Step",
    status: "queued",
    progress: 0,
    priority: "batch",
    detail: "4 takes · 12s each",
    project: "/animal-sitcom/audio",
  },
  {
    id: "j4",
    title: "Keyframes S03-015 ×4",
    kind: "image",
    engine: "Krea 2 · local",
    status: "completed",
    progress: 100,
    priority: "preview",
    detail: "4 stills · 1080×1920",
    project: "/animal-sitcom/s01e03",
    elapsed: "00:01:38",
  },
  {
    id: "j5",
    title: "Club establishing — night",
    kind: "video",
    engine: "LTX-2 · local",
    status: "failed",
    progress: 0,
    priority: "interactive",
    detail: "4K · high quality",
    project: "/animal-sitcom/s01e04",
    elapsed: "00:07:52",
    error: "Out of VRAM",
  },
];

/* Static fallbacks for fields SystemMonitor can't measure yet (cuda core count
 * isn't queryable via nvidia-smi; storage needs the settings store's data root). */
export const systemFallback = {
  gpu: "NVIDIA GeForce RTX 3090 Ti",
  driver: "566.36",
  cudaCores: "10 752",
  vram: "24 GB GDDR6X",
  ram: "64 GB",
  storage: "2.1 TB free",
  tempC: 62,
};

export const seedVram = { used: 18.2, allocated: 21.4, total: 24 };
