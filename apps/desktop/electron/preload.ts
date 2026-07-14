import { contextBridge, ipcRenderer } from "electron";

// Minimal bridge for v1. studiod is reached over localhost tRPC (HTTP+WS),
// not IPC — the bridge only hands the renderer the connection coordinates.
const aurea = {
  isElectron: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  /** {port, token} of the running studiod, or null if it failed to boot */
  studiod: (): Promise<{ port: number; token: string } | null> =>
    ipcRenderer.invoke("aurea:studiod"),
} as const;

contextBridge.exposeInMainWorld("aurea", aurea);

export type AureaBridge = typeof aurea;
