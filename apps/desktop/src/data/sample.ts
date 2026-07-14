/* Realistic sample data for the skeleton. These shapes anticipate the studiod
 * tRPC surface (PRD Part 2): when the core lands, the hooks in src/hooks.ts swap
 * their return values for live queries without touching the screens. */

export type AssetKind = "image" | "video" | "audio" | "music";

export interface Asset {
  id: string;
  kind: AssetKind;
  name: string;
  duration?: string;
  /** tailwind gradient classes standing in for real thumbnails */
  swatch: string;
}

export type JobStatus = "running" | "queued" | "completed" | "failed";

export interface Job {
  id: string;
  title: string;
  kind: "video" | "image" | "tts" | "music";
  engine: string;
  status: JobStatus;
  progress: number;
  stage?: string;
  eta?: string;
  priority: "interactive" | "preview" | "batch";
  /** second line in the job table: resolution, counts, voice… */
  detail?: string;
  /** project path shown under the title */
  project?: string;
  elapsed?: string;
  /** failure reason (status === "failed") */
  error?: string;
}

export type ChatCard =
  | { type: "images"; items: Asset[] }
  | { type: "video"; job: Job; thumbSwatch: string }
  | { type: "audio"; title: string; voice: string; duration: string; seed: number };

export interface ChatMessage {
  id: string;
  role: "user" | "director";
  time: string;
  text?: string;
  card?: ChatCard;
}

const s = (from: string, to: string) => `bg-gradient-to-br ${from} ${to}`;

export const projects = [
  { id: "animal-sitcom", name: "Animal Sitcom", meta: "S01E03 · 12 shots" },
  { id: "noir-ascend", name: "Noir Ascend", meta: "Motivation channel · 5 queued" },
];

export const assets: Asset[] = [
  { id: "a1", kind: "image", name: "sterling_keyframe_04.png", swatch: s("from-[#4a3a20]", "to-[#141008]") },
  { id: "a2", kind: "video", name: "loft_push_in_t3.mp4", duration: "0:06", swatch: s("from-[#2c3a4a]", "to-[#0a0e14]") },
  { id: "a3", kind: "audio", name: "sterling_line_012.wav", duration: "0:04", swatch: s("from-[#3a2a1a]", "to-[#120d06]") },
  { id: "a4", kind: "image", name: "loft_wide_dusk.png", swatch: s("from-[#54422a]", "to-[#171008]") },
  { id: "a5", kind: "music", name: "sitcom_sting_v2.mp3", duration: "0:12", swatch: s("from-[#2a3a2e]", "to-[#0b110d]") },
  { id: "a6", kind: "video", name: "milo_reaction_t1.mp4", duration: "0:04", swatch: s("from-[#432f3a]", "to-[#140d11]") },
  { id: "a7", kind: "image", name: "grant_closeup_07.png", swatch: s("from-[#3f3a26]", "to-[#12100a]") },
  { id: "a8", kind: "image", name: "club_neon_est.png", swatch: s("from-[#2f2a4a]", "to-[#0d0b16]") },
  { id: "a9", kind: "audio", name: "grant_line_003.wav", duration: "0:03", swatch: s("from-[#33261c]", "to-[#100c08]") },
];

export const jobs: Job[] = [
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

export const vram = { used: 18.2, allocated: 21.4, total: 24 };

export const system = {
  gpu: "NVIDIA GeForce RTX 3090 Ti",
  driver: "566.36",
  cudaCores: "10 752",
  vram: "24 GB GDDR6X",
  ram: "64 GB",
  storage: "2.1 TB free",
  tempC: 62,
  queuePaused: false,
};

export const preflight = {
  message: "Next job needs 18 GB — will unload the voice model.",
  after: "16.1 / 24 GB",
};

export const chat: ChatMessage[] = [
  {
    id: "m1",
    role: "user",
    time: "10:21",
    text: "Give me keyframe options for S03-014 — Sterling at the loft table, medium shot, low angle, sitcom lighting, dusk through the windows.",
  },
  {
    id: "m2",
    role: "director",
    time: "10:22",
    text: "Four options with the sitcom lighting bank, dusk key from camera left. Frame 2 keeps Sterling's amber-eye identity anchor sharpest.",
    card: {
      type: "images",
      items: [
        { id: "g1", kind: "image", name: "S03-014 · v1", swatch: s("from-[#5a4426]", "to-[#170f06]") },
        { id: "g2", kind: "image", name: "S03-014 · v2", swatch: s("from-[#63492a]", "to-[#1a1208]") },
        { id: "g3", kind: "image", name: "S03-014 · v3", swatch: s("from-[#4f3d24]", "to-[#140e07]") },
        { id: "g4", kind: "image", name: "S03-014 · v4", swatch: s("from-[#57432c]", "to-[#150f09]") },
      ],
    },
  },
  {
    id: "m3",
    role: "user",
    time: "10:24",
    text: "Frame 2. Turn it into a 6-second push-in, and read me Sterling's first line over it.",
  },
  {
    id: "m4",
    role: "director",
    time: "10:25",
    text: "Rendering the push-in on LTX-2 locally — no API cost. Voice take below; say the word for a more sarcastic read.",
    card: { type: "video", job: jobs[0], thumbSwatch: s("from-[#5e482c]", "to-[#181008]") },
  },
  {
    id: "m5",
    role: "director",
    time: "10:25",
    card: {
      type: "audio",
      title: "“You call that a plan? I've seen pigeons with better exit strategies.”",
      voice: "Sterling · cloned",
      duration: "0:04",
      seed: 12,
    },
  },
];

export const composer = {
  model: "Claude · subscription",
  estimate: "est. 1.2 GB VRAM · $0.00",
};

/* ---------- image lab ---------- */

export interface ImageTile {
  id: string;
  swatch: string;
  /** present while the tile is still rendering */
  generating?: { progress: number };
  liked?: boolean;
}

export interface ImageHistoryEntry {
  id: string;
  when: string;
  count: number;
  aspect: string;
  swatches: string[];
  /** the batch currently shown on the canvas */
  current?: boolean;
}

export const imageLab = {
  models: [
    { id: "krea2", label: "Krea 2 · local", note: "photoreal · free" },
    { id: "z-image", label: "z-image-turbo · local", note: "fast drafts" },
    { id: "qwen-edit", label: "Qwen-Edit 2509 · local", note: "reference edit" },
    { id: "gpt-image", label: "GPT-Image · API", note: "hero frames · $" },
  ],
  aspects: ["1:1", "3:2", "16:9", "4:3", "9:16"],
  presets: ["Cinematic", "Photographic", "Concept Art", "Minimal", "Moody", "Vintage", "Fantasy"],
  prompt:
    "Sterling the silver fox at the loft table, medium shot, low angle, sitcom three-point lighting, dusk through the industrial windows, amber key from camera left, photoreal, 35mm, warm cinematic grade",
  seed: 746583928,
  resolution: "1024 × 1536 px",
  advanced: [
    ["Steps", "28"],
    ["Guidance", "4.5"],
    ["Images per run", "4"],
    ["Sampler", "Euler a"],
  ] as [string, string][],
  batch: [
    { id: "b1", swatch: s("from-[#5a4426]", "to-[#170f06]"), liked: true },
    { id: "b2", swatch: s("from-[#63492a]", "to-[#1a1208]") },
    { id: "b3", swatch: s("from-[#4f3d24]", "to-[#140e07]") },
    { id: "b4", swatch: s("from-[#57432c]", "to-[#150f09]"), generating: { progress: 72 } },
  ] as ImageTile[],
  history: [
    {
      id: "h1",
      when: "Just now",
      count: 4,
      aspect: "3:2",
      current: true,
      swatches: [
        s("from-[#5a4426]", "to-[#170f06]"),
        s("from-[#63492a]", "to-[#1a1208]"),
        s("from-[#4f3d24]", "to-[#140e07]"),
        s("from-[#57432c]", "to-[#150f09]"),
      ],
    },
    {
      id: "h2",
      when: "2h ago",
      count: 4,
      aspect: "16:9",
      swatches: [
        s("from-[#2c3a4a]", "to-[#0a0e14]"),
        s("from-[#33404f]", "to-[#0c1016]"),
        s("from-[#28343f]", "to-[#090d12]"),
        s("from-[#303c48]", "to-[#0b0f14]"),
      ],
    },
    {
      id: "h3",
      when: "Yesterday",
      count: 4,
      aspect: "3:2",
      swatches: [
        s("from-[#2f2a4a]", "to-[#0d0b16]"),
        s("from-[#363050]", "to-[#0e0c18]"),
        s("from-[#2b2744]", "to-[#0c0a14]"),
        s("from-[#332e4c]", "to-[#0d0b15]"),
      ],
    },
    {
      id: "h4",
      when: "2 days ago",
      count: 4,
      aspect: "9:16",
      swatches: [
        s("from-[#2a3a2e]", "to-[#0b110d]"),
        s("from-[#304034]", "to-[#0c120e]"),
        s("from-[#273529]", "to-[#0a100c]"),
        s("from-[#2d3d31]", "to-[#0b110d]"),
      ],
    },
    {
      id: "h5",
      when: "3 days ago",
      count: 4,
      aspect: "4:3",
      swatches: [
        s("from-[#432f3a]", "to-[#140d11]"),
        s("from-[#4a3540]", "to-[#150e12]"),
        s("from-[#3e2b35]", "to-[#130c10]"),
        s("from-[#46323d]", "to-[#140d11]"),
      ],
    },
  ] as ImageHistoryEntry[],
};
