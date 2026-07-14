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
