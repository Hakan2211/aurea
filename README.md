# Aurea

The local-first AI creation platform — "Cursor for video." An AI director orchestrates
the best local + API models (images, voices, music, video) on your own GPU.

- **Blueprint:** `../videofast/docs/PLATFORM-PRD.md`
- **UI design set:** `../UI-Design/` (generated from `../videofast/docs/UI-DESIGN-PROMPTS.md`)

## Status

Frontend skeleton (design tokens, app shell, Director chat with stubbed data).
Runs as a Vite SPA for now; the Electron wrapper and `studiod` core land in P0.

## Structure

```
apps/desktop    React 19 + Tailwind v4 renderer (future Electron renderer)
packages/       (reserved: core = studiod, shared = zod schemas, remotion-kit)
```

## Run

```
npm install
npm run dev     # http://localhost:5173
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
