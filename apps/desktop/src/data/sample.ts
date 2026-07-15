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
  { id: "animal-sitcom", name: "Animal Sitcom", meta: "S01E03 · 12 shots", createdAt: "2026-07-01T12:00:00.000Z" },
  { id: "noir-ascend", name: "Noir Ascend", meta: "Motivation channel · 5 queued", createdAt: "2026-07-08T12:00:00.000Z" },
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

/* ---------- voice lab ---------- */

export interface Voice {
  id: string;
  name: string;
  /** cloned = locked character clone; preset = VoiceDesign reference, not yet locked */
  kind: "cloned" | "preset";
  engine: string;
  swatch: string;
}

export interface VoiceTake {
  id: string;
  label: string;
  duration: string;
  rating: number; // 0..5 stars
  waveSeed: number;
  /** the take loaded in the player */
  selected?: boolean;
  /** playable media URL once the take is a real asset */
  url?: string;
  /** still synthesizing (running/queued job) */
  generating?: boolean;
}

export const voiceLab = {
  engines: [
    { id: "chatterbox", label: "Chatterbox · local", note: "cloned voices · default" },
    { id: "fish", label: "Fish S2-Pro · local", note: "narration" },
    { id: "vibevoice", label: "VibeVoice · local", note: "long-form" },
    { id: "kokoro", label: "Kokoro · local", note: "fast drafts" },
  ],
  voices: [
    { id: "sterling", name: "Sterling", kind: "cloned", engine: "Chatterbox", swatch: s("from-[#5a4426]", "to-[#170f06]") },
    { id: "grant", name: "Grant", kind: "cloned", engine: "Chatterbox", swatch: s("from-[#3f3a26]", "to-[#12100a]") },
    { id: "milo", name: "Milo", kind: "cloned", engine: "Chatterbox", swatch: s("from-[#432f3a]", "to-[#140d11]") },
    { id: "barney", name: "Barney", kind: "preset", engine: "VoiceDesign ref", swatch: s("from-[#2a3a2e]", "to-[#0b110d]") },
    { id: "bruno", name: "Bruno", kind: "preset", engine: "VoiceDesign ref", swatch: s("from-[#33261c]", "to-[#100c08]") },
    { id: "jax", name: "Jax", kind: "preset", engine: "VoiceDesign ref", swatch: s("from-[#2c3a4a]", "to-[#0a0e14]") },
    { id: "narrator", name: "Narrator", kind: "preset", engine: "Kokoro", swatch: s("from-[#2f2a4a]", "to-[#0d0b16]") },
  ] as Voice[],
  script: "You call that a plan? I've seen pigeons with better exit strategies.",
  scriptMax: 5000,
  pace: 1.0,
  emotion: 0.65,
  takes: [
    { id: "t7", label: "Take 07", duration: "0:04.2", rating: 5, waveSeed: 41, selected: true },
    { id: "t6", label: "Take 06", duration: "0:04.1", rating: 4, waveSeed: 87 },
    { id: "t5", label: "Take 05", duration: "0:04.6", rating: 4, waveSeed: 19 },
    { id: "t4", label: "Take 04", duration: "0:03.9", rating: 2, waveSeed: 63 },
    { id: "t3", label: "Take 03", duration: "0:04.3", rating: 3, waveSeed: 28 },
    { id: "t2", label: "Take 02", duration: "0:04.8", rating: 2, waveSeed: 95 },
    { id: "t1", label: "Take 01", duration: "0:04.0", rating: 3, waveSeed: 52 },
  ] as VoiceTake[],
  playback: { position: "00:01.2", total: "00:04.2", played: 0.29 },
};

/* ---------- music lab ---------- */

export interface MusicStem {
  id: "vocals" | "drums" | "bass" | "other";
  label: string;
  on: boolean;
  gainDb: number;
}

export interface MusicTrack {
  id: string;
  title: string;
  bpm: number;
  key: string;
  duration: string;
  waveSeed: number;
  swatch: string;
  arrangement: "instrumental" | "vocals";
  starred?: boolean;
  /** the track loaded in the inspector */
  selected?: boolean;
  generating?: { progress: number; stage: string };
  /** playable media URL once the track is a real asset */
  url?: string;
}

export const musicLab = {
  engine: { label: "ACE-Step · local", note: "songs + stems · $0.00" },
  description:
    "A punchy sitcom sting — retro funk brass over tight drums, walking bassline, warm analog keys, ends on a comedic button.",
  descriptionMax: 500,
  styles: ["Retro funk", "Sitcom brass", "Upbeat"],
  styleLibrary: ["Lo-fi", "Orchestral", "Synthwave", "Jazz combo", "Cinematic", "Disco"],
  durationSec: 12,
  durationMin: 5,
  durationMax: 180,
  arrangement: "instrumental" as "instrumental" | "vocals",
  /** cloned character voices available for sung vocals (voice conversion) */
  singVoices: [
    { id: "sterling", label: "Sterling — dry baritone" },
    { id: "grant", label: "Grant — smooth tenor" },
    { id: "milo", label: "Milo — bright and manic" },
  ],
  tracks: [
    {
      id: "mt1",
      title: "Sitcom sting v2",
      bpm: 112,
      key: "F Major",
      duration: "0:12",
      waveSeed: 34,
      swatch: s("from-[#2a3a2e]", "to-[#0b110d]"),
      arrangement: "instrumental",
      starred: true,
      selected: true,
    },
    {
      id: "mt2",
      title: "Club neon groove",
      bpm: 122,
      key: "A Minor",
      duration: "0:45",
      waveSeed: 76,
      swatch: s("from-[#2f2a4a]", "to-[#0d0b16]"),
      arrangement: "instrumental",
      generating: { progress: 62, stage: "Composing arrangement and mixing…" },
    },
    {
      id: "mt3",
      title: "Loft theme — dusk",
      bpm: 92,
      key: "D Major",
      duration: "1:24",
      waveSeed: 58,
      swatch: s("from-[#54422a]", "to-[#171008]"),
      arrangement: "instrumental",
      starred: true,
    },
    {
      id: "mt4",
      title: "Milo's kitchen chase",
      bpm: 138,
      key: "E Minor",
      duration: "0:31",
      waveSeed: 91,
      swatch: s("from-[#432f3a]", "to-[#140d11]"),
      arrangement: "instrumental",
    },
    {
      id: "mt5",
      title: "Sitcom sting v1",
      bpm: 108,
      key: "F Major",
      duration: "0:12",
      waveSeed: 22,
      swatch: s("from-[#3a2a1a]", "to-[#120d06]"),
      arrangement: "instrumental",
    },
    {
      id: "mt6",
      title: "Noir Ascend score bed",
      bpm: 74,
      key: "C Minor",
      duration: "2:05",
      waveSeed: 67,
      swatch: s("from-[#2c3a4a]", "to-[#0a0e14]"),
      arrangement: "vocals",
    },
  ] as MusicTrack[],
  stems: [
    { id: "vocals", label: "Vocals", on: false, gainDb: 0 },
    { id: "drums", label: "Drums", on: true, gainDb: 0 },
    { id: "bass", label: "Bass", on: true, gainDb: -1.5 },
    { id: "other", label: "Other", on: true, gainDb: 0 },
  ] as MusicStem[],
};

/* ---------- asset library ---------- */

export type LibraryKind = "image" | "video" | "audio" | "music" | "model3d";

export interface LibraryAsset {
  id: string;
  kind: LibraryKind;
  name: string;
  /** second line on the card: resolution, sample rate… */
  meta: string;
  duration?: string;
  swatch: string;
  /** absolute studiod /media URL — real thumbnail/preview when present */
  url?: string;
  waveSeed?: number;
  favorite?: boolean;
  /** part of the current multi-selection */
  checked?: boolean;
  /** inspector metadata rows */
  info: [string, string][];
  tags: string[];
}

export const assetLibrary = {
  collections: [
    { id: "projects", label: "Projects", count: 2 },
    { id: "image", label: "Images", count: 128 },
    { id: "video", label: "Video takes", count: 46 },
    { id: "audio", label: "Voices", count: 38 },
    { id: "music", label: "Music", count: 12 },
    { id: "model3d", label: "3D models", count: 3 },
  ],
  smart: [
    { id: "favorites", label: "Favorites", count: 21 },
    { id: "recent", label: "Recently used", count: 17 },
    { id: "unsorted", label: "Unsorted", count: 9 },
    { id: "review", label: "Needs review", count: 6 },
  ],
  storage: { usedPct: 34, label: "0.7 TB / 2.1 TB" },
  total: 227,
  assets: [
    {
      id: "la1",
      kind: "image",
      name: "sterling_keyframe_04.png",
      meta: "1024 × 1536",
      swatch: s("from-[#5a4426]", "to-[#170f06]"),
      favorite: true,
      checked: true,
      info: [
        ["Type", "Image"],
        ["Resolution", "1024 × 1536"],
        ["Seed", "746583928"],
        ["Model used", "Krea 2 · local"],
        ["Created", "Jul 13, 2026 at 6:41 PM"],
        ["File size", "2.4 MB"],
        ["Format", "PNG · 8-bit"],
        ["Aspect ratio", "2:3"],
      ],
      tags: ["sterling", "loft", "keyframe", "dusk", "s01e03"],
    },
    {
      id: "la2",
      kind: "video",
      name: "loft_push_in_t3.mp4",
      meta: "1920 × 1080",
      duration: "0:06",
      swatch: s("from-[#2c3a4a]", "to-[#0a0e14]"),
      favorite: true,
      info: [
        ["Type", "Video"],
        ["Resolution", "1920 × 1080"],
        ["Frame rate", "25 fps"],
        ["Duration", "0:06"],
        ["Seed", "118203457"],
        ["Model used", "LTX-2 · local"],
        ["Created", "Jul 13, 2026 at 7:02 PM"],
        ["File size", "38.1 MB"],
        ["Format", "MP4 · H.264 · 8-bit"],
        ["Aspect ratio", "16:9"],
      ],
      tags: ["loft", "push-in", "take 3", "s01e03"],
    },
    {
      id: "la3",
      kind: "audio",
      name: "sterling_line_012.wav",
      meta: "48 kHz · WAV",
      duration: "0:04",
      waveSeed: 41,
      swatch: s("from-[#3a2a1a]", "to-[#120d06]"),
      info: [
        ["Type", "Voice take"],
        ["Sample rate", "48 kHz · 24-bit"],
        ["Duration", "0:04.2"],
        ["Voice", "Sterling · cloned"],
        ["Model used", "Chatterbox · local"],
        ["Created", "Jul 13, 2026 at 5:18 PM"],
        ["File size", "1.1 MB"],
        ["Format", "WAV"],
      ],
      tags: ["sterling", "dialogue", "s01e03"],
    },
    {
      id: "la4",
      kind: "image",
      name: "loft_wide_dusk.png",
      meta: "1536 × 1024",
      swatch: s("from-[#54422a]", "to-[#171008]"),
      checked: true,
      info: [
        ["Type", "Image"],
        ["Resolution", "1536 × 1024"],
        ["Seed", "90211843"],
        ["Model used", "GPT-Image · API"],
        ["Created", "Jul 12, 2026 at 9:55 PM"],
        ["File size", "3.0 MB"],
        ["Format", "PNG · 8-bit"],
        ["Aspect ratio", "3:2"],
      ],
      tags: ["loft", "establishing", "dusk"],
    },
    {
      id: "la5",
      kind: "music",
      name: "sitcom_sting_v2.mp3",
      meta: "112 BPM · F Major",
      duration: "0:12",
      waveSeed: 34,
      swatch: s("from-[#2a3a2e]", "to-[#0b110d]"),
      favorite: true,
      info: [
        ["Type", "Music"],
        ["Tempo", "112 BPM"],
        ["Key", "F Major"],
        ["Duration", "0:12"],
        ["Model used", "ACE-Step · local"],
        ["Created", "Jul 12, 2026 at 8:04 PM"],
        ["File size", "0.5 MB"],
        ["Format", "MP3 · 320 kbps"],
      ],
      tags: ["sting", "brass", "episode"],
    },
    {
      id: "la6",
      kind: "video",
      name: "milo_reaction_t1.mp4",
      meta: "1920 × 1080",
      duration: "0:04",
      swatch: s("from-[#432f3a]", "to-[#140d11]"),
      info: [
        ["Type", "Video"],
        ["Resolution", "1920 × 1080"],
        ["Frame rate", "25 fps"],
        ["Duration", "0:04"],
        ["Seed", "55830912"],
        ["Model used", "LTX-2 · local"],
        ["Created", "Jul 13, 2026 at 4:47 PM"],
        ["File size", "24.6 MB"],
        ["Format", "MP4 · H.264 · 8-bit"],
        ["Aspect ratio", "16:9"],
      ],
      tags: ["milo", "reaction", "take 1"],
    },
    {
      id: "la7",
      kind: "model3d",
      name: "padlock_v01.glb",
      meta: "18k tris",
      swatch: s("from-[#3f3a26]", "to-[#12100a]"),
      info: [
        ["Type", "3D model"],
        ["Geometry", "18 240 tris"],
        ["Textures", "2K PBR"],
        ["Model used", "Hunyuan3D-2.1 · local"],
        ["Created", "Jul 11, 2026 at 3:12 PM"],
        ["File size", "11.8 MB"],
        ["Format", "GLB"],
        ["License", "Tencent community"],
      ],
      tags: ["prop", "padlock", "mind-cinema"],
    },
    {
      id: "la8",
      kind: "image",
      name: "grant_closeup_07.png",
      meta: "1024 × 1536",
      swatch: s("from-[#3f3a26]", "to-[#12100a]"),
      info: [
        ["Type", "Image"],
        ["Resolution", "1024 × 1536"],
        ["Seed", "33471209"],
        ["Model used", "Qwen-Edit 2509 · local"],
        ["Created", "Jul 12, 2026 at 6:30 PM"],
        ["File size", "2.2 MB"],
        ["Format", "PNG · 8-bit"],
        ["Aspect ratio", "2:3"],
      ],
      tags: ["grant", "closeup", "reference"],
    },
    {
      id: "la9",
      kind: "audio",
      name: "grant_line_003.wav",
      meta: "48 kHz · WAV",
      duration: "0:03",
      waveSeed: 87,
      swatch: s("from-[#33261c]", "to-[#100c08]"),
      info: [
        ["Type", "Voice take"],
        ["Sample rate", "48 kHz · 24-bit"],
        ["Duration", "0:03.4"],
        ["Voice", "Grant · cloned"],
        ["Model used", "Chatterbox · local"],
        ["Created", "Jul 13, 2026 at 5:31 PM"],
        ["File size", "0.9 MB"],
        ["Format", "WAV"],
      ],
      tags: ["grant", "dialogue", "s01e03"],
    },
    {
      id: "la10",
      kind: "image",
      name: "club_neon_est.png",
      meta: "1536 × 1024",
      swatch: s("from-[#2f2a4a]", "to-[#0d0b16]"),
      info: [
        ["Type", "Image"],
        ["Resolution", "1536 × 1024"],
        ["Seed", "60918327"],
        ["Model used", "Krea 2 · local"],
        ["Created", "Jul 12, 2026 at 10:12 PM"],
        ["File size", "2.9 MB"],
        ["Format", "PNG · 8-bit"],
        ["Aspect ratio", "3:2"],
      ],
      tags: ["club", "neon", "establishing", "s01e04"],
    },
    {
      id: "la11",
      kind: "music",
      name: "noir_score_bed.mp3",
      meta: "74 BPM · C Minor",
      duration: "2:05",
      waveSeed: 67,
      swatch: s("from-[#2c3a4a]", "to-[#0a0e14]"),
      info: [
        ["Type", "Music"],
        ["Tempo", "74 BPM"],
        ["Key", "C Minor"],
        ["Duration", "2:05"],
        ["Model used", "ACE-Step · local"],
        ["Created", "Jul 10, 2026 at 11:40 PM"],
        ["File size", "4.8 MB"],
        ["Format", "MP3 · 320 kbps"],
      ],
      tags: ["noir ascend", "score", "moody"],
    },
    {
      id: "la12",
      kind: "model3d",
      name: "door_hero_v02.glb",
      meta: "26k tris",
      swatch: s("from-[#4a3a20]", "to-[#141008]"),
      info: [
        ["Type", "3D model"],
        ["Geometry", "26 011 tris"],
        ["Textures", "2K PBR"],
        ["Model used", "Hunyuan3D-2.1 · local"],
        ["Created", "Jul 11, 2026 at 4:55 PM"],
        ["File size", "15.2 MB"],
        ["Format", "GLB"],
        ["License", "Tencent community"],
      ],
      tags: ["prop", "door", "mind-cinema"],
    },
  ] as LibraryAsset[],
};

/* ---------- video lab ---------- */

export interface VideoTake {
  id: string;
  label: string;
  swatch: string;
  starred?: boolean;
  /** the take loaded in the preview player */
  selected?: boolean;
  /** playable media URL once the take is a real asset */
  url?: string;
}

export interface VideoStage {
  id: string;
  label: string;
  detail: string;
  status: "completed" | "running" | "pending";
  time?: string;
  progress?: number;
}

export const videoLab = {
  prompt:
    "Slow push-in on Sterling at the loft table, medium shot, low angle, sitcom three-point lighting, dusk through the industrial windows, dust motes in the amber key, highly detailed, warm cinematic grade.",
  promptMax: 1000,
  startFrame: {
    name: "sterling_keyframe_04.png",
    meta: "1024 × 1536 · Krea 2",
    swatch: s("from-[#5a4426]", "to-[#170f06]"),
  },
  engines: [
    { id: "ltx2", label: "LTX-2", sub: "local · free", note: "Best for local runs" },
    { id: "seedance", label: "Seedance", sub: "API · est. $0.42", note: "Highest quality, fast" },
  ],
  engineNotes: {
    ltx2: "Renders on your GPU — $0.00",
    seedance: "Cost is estimated before every API run",
  } as Record<string, string>,
  durations: ["3 seconds", "5 seconds", "6 seconds", "8 seconds", "10 seconds"],
  duration: "5 seconds",
  resolutions: ["1280 × 720 (16:9)", "1920 × 1080 (16:9)", "3840 × 2160 (16:9)"],
  resolution: "1920 × 1080 (16:9)",
  motionStrength: 0.72,
  takes: [
    { id: "vt1", label: "Take 1", swatch: s("from-[#4f3d24]", "to-[#140e07]") },
    { id: "vt2", label: "Take 2", swatch: s("from-[#57432c]", "to-[#150f09]") },
    { id: "vt3", label: "Take 3", swatch: s("from-[#5e482c]", "to-[#181008]"), starred: true, selected: true },
    { id: "vt4", label: "Take 4", swatch: s("from-[#63492a]", "to-[#1a1208]") },
  ] as VideoTake[],
  playback: { position: "00:02.18", total: "00:05.00", played: 0.44 },
  job: {
    id: "a7f2…c9b1",
    status: "Running",
    elapsed: "00:01:34",
    stages: [
      { id: "sampling", label: "Sampling", detail: "25 / 25 steps", status: "completed", time: "00:00:48" },
      { id: "upscaling", label: "Upscaling", detail: "Real-ESRGAN 4×", status: "running", time: "00:00:36", progress: 63 },
      { id: "encoding", label: "Encoding", detail: "H.264 · High quality", status: "pending" },
    ] as VideoStage[],
  },
  tip: "Higher motion strength increases creativity but may reduce temporal stability.",
};

/* ---------- settings ---------- */

export interface Provider {
  id: string;
  name: string;
  tag?: string;
  blurb: string;
  /** how the right side of the card authenticates */
  auth:
    | { kind: "connected" }
    | { kind: "apiKey"; masked: string }
    | { kind: "model"; model: string; options: string[] };
}

export interface EngineEntry {
  id: string;
  name: string;
  kind: "Video" | "Image" | "Voice" | "Music" | "3D";
  status: "installed" | "api";
  note: string;
}

export const settings = {
  providers: [
    {
      id: "claude",
      name: "Claude",
      tag: "connected via subscription",
      blurb: "Anthropic's most capable models.",
      auth: { kind: "connected" },
    },
    {
      id: "openrouter",
      name: "OpenRouter",
      blurb: "Access 300+ models from multiple providers.",
      auth: { kind: "apiKey", masked: "••••••••••••••••••" },
    },
    {
      id: "ollama",
      name: "Ollama",
      tag: "local",
      blurb: "Run models locally on your machine.",
      auth: {
        kind: "model",
        model: "llama3.1:8b-instruct-q4_K_M",
        options: ["llama3.1:8b-instruct-q4_K_M", "qwen2.5:14b-instruct", "mistral-nemo:12b"],
      },
    },
  ] as Provider[],
  defaultProvider: "claude",
  storage: {
    root: "D:\\Studio",
    used: "287 GB",
    total: "1.00 TB",
    segments: [
      { label: "Models", size: "152 GB", pct: 53, dot: "bg-gold" },
      { label: "Projects", size: "78 GB", pct: 27, dot: "bg-sage" },
      { label: "Cache", size: "57 GB", pct: 20, dot: "bg-[#7b93d8]" },
    ],
  },
  general: {
    toggles: [
      { id: "login", label: "Launch at login", desc: "Start Aurea when you sign in to Windows.", on: false },
      { id: "hw", label: "Hardware acceleration", desc: "Use the GPU for UI rendering and video playback.", on: true },
      { id: "tray", label: "Keep running in tray", desc: "Jobs continue when the window is closed.", on: true },
      { id: "telemetry", label: "Anonymous usage stats", desc: "Never includes prompts, assets, or file paths.", on: false },
    ],
    theme: "Aurea Dark",
    language: "English (US)",
    version: "0.1.0",
  },
  engines: [
    { id: "ltx2", name: "LTX-2", kind: "Video", status: "installed", note: "i2v + ia2v lipsync" },
    { id: "seedance", name: "Seedance", kind: "Video", status: "api", note: "API key required" },
    { id: "krea2", name: "Krea 2", kind: "Image", status: "installed", note: "photoreal default" },
    { id: "qwen-edit", name: "Qwen-Edit 2509", kind: "Image", status: "installed", note: "reference edits" },
    { id: "chatterbox", name: "Chatterbox", kind: "Voice", status: "installed", note: "cloned voices" },
    { id: "fish", name: "Fish S2-Pro", kind: "Voice", status: "installed", note: "narration" },
    { id: "ace-step", name: "ACE-Step", kind: "Music", status: "installed", note: "songs + stems" },
    { id: "hunyuan3d", name: "Hunyuan3D-2.1", kind: "3D", status: "installed", note: "concept → GLB" },
  ] as EngineEntry[],
  shortcuts: [
    ["Open Director", "Ctrl + 1"],
    ["Command palette", "Ctrl + K"],
    ["Quick generate", "Ctrl + Enter"],
    ["Toggle job center", "Ctrl + J"],
    ["Save to assets", "Ctrl + S"],
    ["New take", "Ctrl + R"],
  ] as [string, string][],
  advanced: {
    toggles: [
      { id: "prerelease", label: "Pre-release engine builds", desc: "Get new engine versions before they're stable.", on: false },
      { id: "verbose", label: "Verbose job logs", desc: "Keep full sampler traces for every job.", on: false },
      { id: "keepvram", label: "Keep models warm", desc: "Skip VRAM unloads between jobs — faster, riskier.", on: false },
    ],
  },
};

/* ---------- image lab ---------- */

export interface ImageTile {
  id: string;
  swatch: string;
  /** present while the tile is still rendering */
  generating?: { progress: number };
  liked?: boolean;
  /** real thumbnail URL once the tile is a real asset */
  url?: string;
}

export interface ImageHistoryEntry {
  id: string;
  when: string;
  count: number;
  aspect: string;
  swatches: string[];
  /** real thumbnail URLs paired with swatches, once the entries are assets */
  urls?: (string | undefined)[];
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
