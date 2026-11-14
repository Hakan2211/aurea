/* The app's map — four areas, each a set of tabs (UI-SIMPLIFY-PLAN.md §1).
 *
 * One table drives the sidebar, each area's tab strip and the Ctrl K palette,
 * so a screen can never be reachable from one and missing from another. The
 * tab components themselves are the pre-2026-11 screens, mounted unchanged. */

import { House, BookOpen, Sparkles, Film, type LucideIcon } from "lucide-react";

export type AreaKey = "home" | "story" | "create" | "edit";

export interface AreaTab {
  /** url segment under the area: /story/board */
  key: string;
  label: string;
  /** one line for the palette — what you'd do here */
  hint: string;
}

export interface Area {
  key: AreaKey;
  label: string;
  /** shown under the label in the sidebar (hideable) */
  blurb: string;
  icon: LucideIcon;
  /** the area's root route */
  path: string;
  tabs: AreaTab[];
}

export const AREAS: Area[] = [
  {
    key: "home",
    label: "Home",
    blurb: "Your next step",
    icon: House,
    path: "/",
    tabs: [],
  },
  {
    key: "story",
    label: "Story",
    blurb: "Board, script, cast",
    icon: BookOpen,
    path: "/story",
    tabs: [
      { key: "board", label: "Board", hint: "Storyboard every shot of an episode" },
      { key: "script", label: "Script", hint: "Write the screenplay and shot list" },
      { key: "episodes", label: "Episodes", hint: "Review, approve and retake shots" },
      { key: "cast", label: "Cast & places", hint: "Characters, voices and locations" },
    ],
  },
  {
    key: "create",
    label: "Create",
    blurb: "Images, video, audio",
    icon: Sparkles,
    path: "/create",
    tabs: [
      { key: "image", label: "Image", hint: "Stills, characters, keyframes" },
      { key: "video", label: "Video", hint: "Animate a frame or a prompt" },
      { key: "voice", label: "Voice", hint: "Lines in a cast voice" },
      { key: "music", label: "Music", hint: "Beds, stings and themes" },
      { key: "3d", label: "3D", hint: "Props and sets as 3D models" },
    ],
  },
  {
    key: "edit",
    label: "Edit",
    blurb: "Timeline & export",
    icon: Film,
    path: "/edit",
    tabs: [
      { key: "timeline", label: "Timeline", hint: "Cut the episode and export" },
      { key: "formats", label: "Formats", hint: "Social-video recipes (videofast)" },
    ],
  },
];

export const tabPath = (area: AreaKey, tab: string) => `/${area}/${tab}`;

/** Every pre-2026-11 route and where it lives now. Old deep links, crew tools
 * and muscle memory keep working through these redirects. */
export const LEGACY_ROUTES: Record<string, string> = {
  studio: "/story/script",
  script: "/story/script",
  storyboard: "/story/board",
  desk: "/story/episodes",
  bible: "/story/cast",
  images: "/create/image",
  voice: "/create/voice",
  music: "/create/music",
  video: "/create/video",
  "3d": "/create/3d",
  timeline: "/edit/timeline",
  formats: "/edit/formats",
};

/** the rarely-visited utilities — reachable from the sidebar foot, the palette
 * and (Jobs) the queue pill, not as peers of the four areas */
export const UTILITIES = [
  { path: "/assets", label: "Library", hint: "Every image, clip, voice and track" },
  { path: "/jobs", label: "Jobs", hint: "The full render queue and history" },
  { path: "/settings", label: "Settings", hint: "Models, keys, runtime" },
] as const;
