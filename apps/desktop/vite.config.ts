import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import electron from "vite-plugin-electron";
import path from "node:path";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    tailwindcss(),
    electron([
      {
        // studiod bundle for utilityProcess.fork — built first so main.ts can
        // fork it; no onstart (the main entry below owns the electron launch,
        // so core changes need a dev-server restart to re-fork)
        onstart: () => {},
        entry: "electron/studiod.ts",
        vite: {
          build: {
            // runs inside Electron's utilityProcess (Node 22), not a page
            target: "node22",
            rollupOptions: {
              // optional native accelerators probed by ws — not installed.
              // The agent SDK must stay external: it spawns its bundled
              // Claude Code cli.js via paths relative to its own package dir,
              // which inlining would break.
              external: ["bufferutil", "utf-8-validate", "@anthropic-ai/claude-agent-sdk"],
            },
          },
        },
      },
      {
        // Main process — plugin defaults to ESM output (package is "type": "module")
        entry: "electron/main.ts",
      },
      {
        // Preload — must be real CJS to run inside Electron's sandbox, so we
        // bypass the plugin's ESM default and spell out the lib config
        onstart: ({ reload }) => reload(),
        vite: {
          build: {
            outDir: "dist-electron",
            lib: {
              entry: "electron/preload.ts",
              formats: ["cjs"],
              fileName: () => "preload.cjs",
            },
          },
        },
      },
    ]),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
