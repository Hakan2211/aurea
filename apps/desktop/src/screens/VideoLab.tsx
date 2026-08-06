/* The Video lab moved to screens/video/ (VideoLab.tsx orchestrator +
 * ParamsPanel/PreviewPanel/JobRail/lanes). This shim keeps the import path
 * App.tsx and Storyboard.tsx already use. */
export { VideoLab } from "./video/VideoLab";
export type { ShotPrefill } from "./video/shared";
