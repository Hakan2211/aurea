import { contextBridge } from "electron";

// Minimal bridge for v1. studiod is reached over localhost tRPC (HTTP+WS),
// not IPC, so the renderer only needs to know it's inside the shell.
const aurea = {
  isElectron: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
} as const;

contextBridge.exposeInMainWorld("aurea", aurea);

export type AureaBridge = typeof aurea;
