# Aurea UI simplification plan — 2026-11-14

Status: PLAN. Nothing built yet. We work one stage at a time; each stage ends
with you trying it in the real app before the next one starts.

Clickable mockup: https://claude.ai/artifact/UpsCCyQ7j6qJFpWLipoH1B

## 0. Why

Aurea feels overwhelming. The visual style (dark, warm gold, Fraunces + Inter)
is already good and stays. The problem is structure and density:

| Problem | Evidence |
| --- | --- |
| Too many places | 15 sidebar destinations in 5 groups, icon-only when collapsed (`components/AppShell.tsx`) |
| Overlapping screens | Director, Studio, Desk and Bible all hold parts of the same episode |
| No starting point | The app opens on the Director chat; nothing says "here is your next step" |
| Too many controls at once | Image lab shows 4 columns; Video gen shows ~12 controls before Generate (`video/ParamsPanel.tsx`, 2,323 lines) |
| Text too small | 893 uses of 8–11px text across 68 files |
| Duplicated status | GPU/VRAM in the top strip and again in the labs; the queue in 3 places |
| Dead-end screens | Studio, Desk and Timeline show only "Waiting for the studio core…" |

## 1. Target structure

Four areas in the sidebar, always labelled:

| Area | Contains (today's screens) | Route |
| --- | --- | --- |
| **Home** | New. Continue card, next action, quick create, projects | `/` |
| **Story** | Studio (Script), Director board, Desk (Episodes), Bible (Cast & places) as tabs | `/story/:tab` |
| **Create** | Image, Voice, Music, Video, 3D labs as tabs | `/create/:tab` |
| **Edit** | Timeline, Formats | `/edit/:tab` |

Everywhere:
- **Director panel**: the chat opens as a side panel from any area (like Cursor's
  chat), toggled by a button and a shortcut. Not a separate destination.
- **Ctrl K palette**: jump to any screen, shot, asset or command; Assets, Jobs and
  Settings live here and in the queue pill.
- **One queue pill** in the top bar: GPU, VRAM, running/queued, click for detail.
  Replaces the duplicated readouts.

Rule: **no feature is removed.** Every existing screen stays reachable, just
nested. All old routes (`/studio`, `/desk`, `/bible`, `/images`, `/voice`,
`/music`, `/video`, `/3d`, `/timeline`, `/formats`, `/assets`, `/jobs`,
`/settings`) keep working as redirects, so deep links and crew tools don't break.

## 2. Decision needed before Stage 1

**Is Home a dashboard, or the Director?**
- A) Dashboard Home (as in the mockup), with the Director as a side panel. Best if
  you mostly work the labs and board by hand.
- B) Home opens into the Director chat, with the "continue" card pinned on top.
  Best if you mostly make things by talking to the Director / Claude crew.

Recommendation: A, unless you mostly drive Aurea through chat.

## 3. Stages

### Stage 1 — Navigation, Home, palette, queue pill

Biggest relief, lowest risk. No lab internals change.

- `components/AppShell.tsx`: replace `navSections` with the 4 areas; labelled
  rail (optional "show descriptions" toggle); keep pin/collapse.
- `App.tsx`: new routes `/`, `/story/:tab`, `/create/:tab`, `/edit/:tab`;
  old routes become `<Navigate>` redirects.
- New `screens/Home.tsx`: continue card (active project + episode, approval
  progress, one primary "next step" button), quick-create tiles, projects grid.
  Data from existing hooks (`useProjects`, production/episode hooks, jobs).
- New `components/AreaTabs.tsx`: shared tab strip; each area screen renders the
  existing screen component for the active tab (no rewrite of those screens).
- New `components/CommandPalette.tsx`: Ctrl K, fuzzy list of destinations,
  projects, recent assets and actions.
- `components/GlobalStatus.tsx` → queue pill + popover; keep the stale-build
  warning (it matters, see the file's header comment).
- Director: move out of `/` into a toggleable right panel mounted in `AppShell`.

Done when: the sidebar shows 4 areas; every old screen is reachable in ≤2
clicks or via Ctrl K; old routes redirect; desktop typecheck passes; you've
clicked through it in the app.

### Stage 2 — Simple-by-default Video

- Split `video/ParamsPanel.tsx` into a **composer** (prompt, reference/start
  frame, engine, duration & size, Generate) and an **Advanced drawer** (seed,
  steps, CFG, motion strength, adapters, shot director, sound, A/B, seed spray).
- Advanced open/closed state persists per lab in localStorage.
- Layout: big preview + takes strip (keep what works today), composer at the
  bottom, render progress inline on the take, not in a separate rail.
- Any non-default advanced value shows a small "3 custom settings" chip on the
  composer so nothing is hidden silently.

Done when: a default video run needs only prompt + Generate; every current
control is still reachable under Advanced; generated jobs are identical to
today's for the same settings.

### Stage 3 — Same pattern for Image, Voice, Music, 3D

- Image lab: 4 columns → results grid + composer; prompt library and history
  become drawers (`ImageLab.tsx`, `image/*`).
- Voice lab: cast list as a dropdown/side list, one script box, takes list
  (`VoiceLab.tsx`).
- Music and 3D: same composer + Advanced drawer.
- Extract the shared composer/drawer into `components/ui/` so all five tabs
  match.

### Stage 4 — Readability and polish

- Raise the type scale in `styles/index.css` (`--text-2xs` 10→12px,
  `--text-xs` 11→13px, `--text-sm` 12.5→14px), then codemod the arbitrary
  `text-[8–11px]` classes onto the scale. Check contrast of `fog` text at the
  new sizes (target 4.5:1).
- Replace "Waiting for the studio core…" dead ends with real empty states:
  what this screen is for, and one button to start ("Create an episode",
  "Send shots to the timeline").
- Remove the remaining duplicated GPU/VRAM/queue readouts inside the labs.
- Consistent page header per area (title, project/episode context, one primary
  action on the right).

### Stage 5 (optional) — Onboarding

- Revisit `FirstRunWizard.tsx` to end on Home with a sample project.
- A short "what's where" tour of the 4 areas, dismissible, shown once.

## 4. Working rules

- One stage at a time; you review in the app before the next.
- No commits unless you ask (the repo has uncommitted work of yours).
- Each stage: `npx tsc --noEmit -p apps/desktop` clean, then a click-through
  (and screenshots) in the dev build.
- Core/studiod are not touched in Stages 1–4; this is renderer-only work.

## 5. Build log

### 2026-11-14 — Stage 1 built (decision: A, dashboard Home)

New:
- `src/nav.ts` — the area/tab table + legacy route map; drives sidebar, tab strips, palette.
- `src/components/AreaLayout.tsx` — per-area tab strip; remembers the last tab per area.
- `src/components/TopBar.tsx` — one 48px bar: project switcher, Ctrl K search, Director
  toggle, queue pill with popover (GPU/VRAM inside). Carries the stale-build chip.
  Is the Electron drag region; `electron/main.ts` titleBarOverlay height 36 → 48.
- `src/components/CommandPalette.tsx` — Ctrl K: every tab, Library/Jobs/Settings,
  actions, project switching; "Ask the Director instead" when nothing matches.
- `src/components/DirectorPanel.tsx` — Director chat as a resizable right panel on
  every screen (Ctrl J); open state and width persist. `openWith(text)` replaces the
  old `navigate("/", { state: { seed } })` hand-off.
- `src/screens/Home.tsx` — continue card (one next step derived from `shotStage`),
  per-shot stage strip, quick create, rendering now, latest renders, projects + inline
  "New project".

Changed:
- `AppShell.tsx` rewritten: 4 labelled areas, Library/Jobs/Settings small at the foot,
  collapsible to icons, "Hide descriptions" toggle.
- `App.tsx`: new route tree; all old routes redirect with router state preserved.
- `screens/Director.tsx` → `BoardScreen` (board only; shot selection feeds the panel's
  context chip).
- Route strings updated in `formats/blend.tsx`, `formats/create.tsx`, `Formats.tsx`,
  `studio/writers.tsx`, `Studio.tsx`, `director/board.tsx`, `director/inspector.tsx`,
  `desk/DeskScreen.tsx`. `styles/index.css`: select/label opt out of the drag region.
- `components/GlobalStatus.tsx` is no longer mounted (TopBar replaces it); left in place.

Verified: `tsc --noEmit` clean for renderer and electron configs. Clicked through in
a browser tab on sample data: Home, queue popover, Ctrl K → Create › Video, Ctrl J
panel, `#/bible` → `#/story/cast`, `#/desk/<id>` → `#/story/episodes/<id>`, `#/story`
→ last tab. NOT yet verified in the Electron window with a live studio core (window
controls overlay, live Home data).

### 2026-11-14 — Stage 2 built (Video lab, simple by default)

New (`src/screens/video/`):
- `useVideoParams.ts` — all Video render state, gating and the payload, moved
  **verbatim** out of `ParamsPanel.tsx` (checked byte-for-byte), plus `customs`: the
  list of non-default Advanced settings, read off what the payload actually carries.
- `Composer.tsx` — bar under the preview: start frame (drop/paste/browse, "Text only"),
  prompt + Enhance, engine select, duration chips, size, `Advanced (N custom)`,
  Generate. Retake ("Fix this bit") is described here; the size/VRAM warnings,
  errors and the last failure with Retry sit under it.
- `AdvancedDrawer.tsx` — right drawer: lanes/looks, end frame + loop + mid-shot
  keyframes, Shot Director (beats, audio/cast/motion lanes), camera, quality, frame
  rate, adapters, sound, references, shot picks, motion strength, A/B, seed spray, tip.
  Open/closed persists in `localStorage["aurea.lab.video.advanced"]`.

Changed:
- `VideoLab.tsx`: preview + takes on top, composer below, drawer on the right. The
  workbench is keyed on a storyboard send as before.
- `PreviewPanel.tsx`: renders in flight are cards at the head of the takes strip
  (progress ring, stage, ETA, cancel); "N rendering" beside the Takes heading.
- Picking a start still in the frame picker now also turns "Text only" off.

No longer mounted (left in place, they hold uncommitted edits of yours):
`ParamsPanel.tsx`, `JobRail.tsx`, `EnginePicker.tsx`. VRAM lives in the top-bar
queue pill; "Clear completed" lives on the Jobs screen.

Verified: `tsc --noEmit` clean (renderer + electron). Browser tab on sample data:
composer, drawer open/close, the custom chip (motion 0.72 → 0.39 gives "1 custom"),
inline render cards, no console errors. NOT yet verified: the Electron window with a
live core (real presets/looks, H3 rows, a real Generate).

### 2026-11-14 — Stage 3 built (Image, Voice, Music, 3D)

Shared kit, new `src/components/ui/Lab.tsx` (exported through `components/ui.tsx`):
`ComposerBar`, `AdvancedButton` (with the "N custom" chip), `GenerateButton`, `LabDrawer`,
`DrawerSection`, `DrawerField`/`drawerInput`, `ChoiceChips`, `customsSummary`, and
`useLabDrawer(lab, keys)`. That hook keeps one open drawer per lab in
`localStorage["aurea.lab.<lab>.drawer"]`. Video's composer and drawer now use the same parts.

Image (`ImageLab.tsx`, `image/*`):
- `useImageParams.ts`: all render state, deck autosave and the payload, moved verbatim
  from the old left `ParamsPanel`, plus `customs`, `generate()` and the button label.
- `ImageComposer.tsx`: mode (Generate / Edit with refs / Deck), Enhance, Library,
  prompt (Text/Chips) or the deck editor, a refs strip in Edit (reorder, remove, drop to
  add), model select, aspect (+ Auto), ×1–×4, Advanced, Generate, cost and errors.
- `ImageAdvanced.tsx`: style preset, seed, quality/format (cloud), exact size, steps/CFG.
- The library column and the history/refs rail are now the Library and History drawers.
  The header's rail toggle is now a History button. Old `railOpen`/`libraryDocked` prefs
  are ignored.

Voice (`VoiceLab.tsx`): 3 columns become 2. The cast list stays on the left; the takes list
moved from the right rail into the centre (the hero player is gone; the bottom player
bar and each take row play/download). Composer: Speak/Convert, engine select (Speak) or
Speech/Singing + Seed-VC/RVC (Convert), the line or the source picker, Advanced,
Speak/Convert. Drawer: pace/emotion, DramaBox knobs, or steps/semitones/pitch.

Music (`MusicLab.tsx`, `music/create.tsx`): `useMusicParams` (state + payload moved
verbatim from the Create rail). Track list + inspector on top; composer: instrumental/vocals,
engine, description (+ lyrics side by side when singing), style tags, length chips,
Compose. Drawer: duet, cloned voice, exact length, BPM, seed, language, key, time
signature, steps, shift.

3D (`Model3dLab.tsx`): shelf + viewport on top; composer: prompt/image source, subject or
a strip of stills, Generate. Drawer: plate model, detail, texture.

Verified: `tsc --noEmit` clean (renderer + electron). Browser tab on sample data: every
Create tab renders composer + drawer; Image Edit mode/refs strip, Deck editor, all three
Image drawers, "1 custom" after picking a preset; Voice/Music/3D/Video drawers; no
console errors or warnings. NOT yet verified: the Electron window with a live core (real
uploads, a real Generate per lab).

### 2026-11-14 — Stage 4 built (readability and polish)

Type scale (`styles/index.css`): `--text-2xs` 10→12px, `xs` 11→13, `sm` 12.5→14,
`base` 14→15, `lg` 17→18; `.step-numeral` 10→12. Body stays 14px. Codemod (backup of
the pre-codemod `src/` was taken in the session scratchpad): 710 arbitrary sizes across 67
files moved onto the scale (≤10.5px → `text-2xs`, 11–11.5 → `xs`, 12–13 → `sm`, 14 →
`base`). Sizes of 15px and up (headings, display numbers) were left alone. Nothing renders under 12px now
(except the SVG % label in the Studio header ring).

Contrast: `fog` (#8e8a82) is 5.7:1 on ink and 5.0:1 on raised, but `text-fog/60…/80` fell to
2.7–4:1. 293 uses of `text-fog/55…/95` became plain `text-fog`. `fog/50` and below is left
for disabled and decorative marks (noted in the CSS comment).

Empty states:
- New `components/ui/EmptyState.tsx` (icon, title, what the screen is for, one primary +
  one secondary button) and `components/CoreGate.tsx` with three distinct states: core not
  answering (Try again / Settings, "nothing is lost"), no project (Create a project), and
  loading (spinner).
- Script, Episodes, Board, Timeline and Cast & places use them. Episodes with no episodes →
  "Write an episode"; Board with none → "Write an episode" + "Plan it with the Director".
- Fixed: Timeline showed "Loading sequence…" forever against a dead core.

Duplicated readouts: the Image lab status bar's GPU name + VRAM bar are removed (they live
in the top-bar queue pill). No other lab still had one after Stages 2–3; Jobs keeps its
VRAM gauge (it is the detail screen).

Headers: page titles now match the tab names (Image lab → Image, Video gen → Video,
Production Desk → Episodes, Bible → Cast & places). Voice and Music have no separate page
header on purpose. Their cast/track list already names the screen, and another 56px bar
would cost the vertical room Stage 3 won back.

Verified: `tsc --noEmit` clean (renderer + electron). Browser tab on sample data: Home,
all five Create tabs, Formats, the offline states of Board/Script/Episodes/Cast/Timeline;
no overflow or clipping seen at the new sizes; no console errors. NOT verified: the Electron window with a live core, including the
"no episodes" and empty-cut states, which need a real project. Timeline with zero clips
still has no "Send shots to the timeline" empty state; that is left for review with a live core.
