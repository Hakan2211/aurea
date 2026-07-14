# Aurea

The local-first AI creation platform — "Cursor for video." An AI director orchestrates
the best local + API models (images, voices, music, video) on your own GPU.

- **Blueprint:** `../videofast/docs/PLATFORM-PRD.md`
- **UI design set:** `../UI-Design/` (generated from `../videofast/docs/UI-DESIGN-PROMPTS.md`)

## Status

Electron desktop app: all 9 v1 screens (stubbed data) inside a frameless shell
(hidden title bar + native overlay controls, sandboxed preload bridge on
`window.aurea`). Next up: `studiod` tRPC core.

## Structure

```
apps/desktop            React 19 + Tailwind v4 renderer + Electron shell
apps/desktop/electron   main.ts (window/lifecycle) + preload.ts (context bridge)
packages/               (reserved: core = studiod, shared = zod schemas, remotion-kit)
```

## Run

```
npm install
npm run dev                          # Vite + Electron window, HMR
npm run build                        # typecheck + renderer/main/preload bundles
npm run package -w @aurea/desktop    # NSIS installer → apps/desktop/release/
```

## Design tokens (from the design-system sheet)

| Token   | Value     |
|---------|-----------|
| ink     | `#0A0A0B` |
| surface | `#141416` |
| gold    | `#C9A96E` |
| ember   | `#B33A2B` |
| cream   | `#EDEAE4` |

Type: Fraunces (serif, headings) + Inter (UI). Radius 12px. Subtle film grain overlay.
