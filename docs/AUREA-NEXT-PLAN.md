# AUREA — Next Round Plan (2026-08-07)

A ranked improvement plan for Aurea, grounded in a full survey of the current codebase
(routes, tRPC surface, data model, docs) plus the two docs that still carry open work:
`H3-TURBO-LORA-PLAN.md` Part B and the tail of `design-refs/2026-08-05-ui-mockups/DECISIONS.md`
(Home screen, Image-lab composer pass).

**Status key:** each item gets an ID (`N1.x` etc.) so sessions can log progress against it.
Nothing here is started. This doc is the backlog; strike items through as they ship.

---

## Where Aurea stands

Every planned round to date is complete: P0–P3, S-P1/S-P2, Shot Director V0–V7, the
2026-08-06 six-screen route-merge round, the labs-v2 upgrades, H3 Turbo draft mode, and
(as of 2026-08-07) managed ComfyUI for video with LTX + H3 on one server at :8000 and all
7 LTX camera LoRAs installed on disk. The app covers the full span — write → board →
render → voice → score → cut → export — but the span is traversed *manually*, screen by
screen. The biggest wins now are (1) workflows that chain the existing machinery,
(2) exposing quality controls the backend already supports, and (3) paying down the
UI-consistency and type-hygiene debt before it calcifies.

Five themes, ordered by impact:

| # | Theme | One-liner |
|---|-------|-----------|
| N1 | **The Assembly Line** | One-click scene → dailies → rough cut. The workflow that makes Aurea "Cursor for video" instead of five labs in a trenchcoat. |
| N2 | **Quality controls & engine depth** | Ship the H3-plan Part B backlog: LTX sliders, camera LoRA weights, hero tier, reference decks, music vocal conversion. |
| N3 | **Home, projects & review** | The never-built Home screen, a real project switcher + delete/archive, and a Dailies review surface with take comparison. |
| N4 | **UI/UX consistency pass** | One lab grammar, one job-progress renderer, one shot inspector, engineSurface-style gating everywhere, command palette. |
| N5 | **Platform hygiene** | Kill the sample.ts type fork, decompose the giant screens, live Formats registry, renderer tests, README. |

---

## N1 — The Assembly Line (highest impact)

The machinery for every step already exists behind tRPC; nothing chains it. Today a
20-shot scene means ~60 manual round-trips (board each shot, render each shot, TTS each
line, drag each take to the timeline). The Assembly Line makes that one decision + one
progress screen.

### N1.1 `scene.assemble` orchestrator (core)

> **Built 2026-11-10** (core + tools + Desk dialog; GPU end-to-end run still pending). Deltas from
> the text below: procedures are `studio.assembly.{plan,start,get,list,cancel}`; tools
> `scene_assemble_plan`, `scene_assemble`, `scene_assemble_status` (also crew verbs). The planner is
> pure (`packages/shared/src/assembly.ts`), the runner is `packages/core/src/assembly.ts` and drives
> the existing table-read / board / renderShot procedures, so there is still one path to every job.
> `through: "board" | "render" | "cut"` (default `board`) keeps the playbook's two human gates;
> the cut pass lays **approved** takes only and never approves. Lanes are picked by who speaks
> (nobody → `zoo-broll-insert`, one voice → `zoo-interview-single`, several → `zoo-room-coverage`),
> overridable per run or per shot. Dialogue renders stay on the LTX ia2v path with cast TTS, not
> H3 ref2va, because H3 replaces the cast voice with its own (pilot #12). Jobs carry `job.batch`.
> Batches are in memory; re-running is the resume (done = done, queued = inflight, waited on).
> Read-only check against real data: `npx tsx scripts/plan-assembly.mts zoo-logic render [sceneId]`.
A new tRPC procedure + job type that, for a target scene:
1. **Board pass** — for every shot without a keyframe: `studio.board.generate` (qwen-edit
   + bible refs). Shots that already have keyframes are skipped.
2. **Voice pass** — for every `scriptLine` with a cast character that has a bible voice:
   TTS via the character's voice (chatterbox clone / qwen preset per the bible entry).
3. **Render pass** — for every boarded shot: `studio.board.renderShot`. Dialogue shots
   route through **LTX native ia2v** with the TTS wav as the audio input (this is the
   locked lipsync path — *not* Director timeline audio); non-dialogue shots render
   normally. Draft/final tier is a parameter.
4. **Cut pass** — place the best take of each shot on the timeline in script order,
   dialogue audio on the voice track, honoring existing clips (append after playhead or
   into a fresh "Scene N" region — parameter).

Implementation notes:
- Model it as a **plan → execute** pair: `scene.assemblePlan` returns the concrete step
  list (what will be boarded/voiced/rendered, estimated GPU time using the measured
  timings from `MINIMAX-H3.md` + LTX history), the UI shows it, the user confirms, then
  `scene.assemble` enqueues. The plan step is what keeps this from being a scary
  black box, and it gives the Director agent the same preview for free.
- Steps enqueue as ordinary jobs with a shared `batchId` in the payload so the Job
  Center can group them; a failed step pauses the batch, doesn't kill it. Resume =
  re-run assemble (idempotent because each pass skips already-done shots).
- Everything through `tools.ts` too (`scene_assemble_plan`, `scene_assemble`) so the
  Director can drive it: "assemble scene 3 in draft" becomes one tool call.

**Acceptance:** from a written scene with cast + voices in the bible, one confirm click
produces a watchable rough cut on the timeline with synced dialogue, no manual steps.
Draft tier on the 3090 Ti; a failed shot render leaves the rest of the batch intact.

### N1.2 Assembly progress UI (desktop)
A batch card in Studio (and mirrored in Job Center) showing the pass pipeline
(board → voice → render → cut) with per-shot rows, live thumbnails as keyframes/takes
land, retry-this-step buttons, and a "jump to timeline" affordance when the cut pass
completes. Reuse `Progress`/`ProgressRing`/`StatusBar`; do **not** invent a fourth job
renderer (see N4.2 — build the shared one first or concurrently).

### N1.3 Dialogue-shot fast path in the shot inspector
Even outside full assembly: a shot whose `script[]` has lines from a voiced character
gets a **"Voice + render"** button in the (unified, N4.3) shot inspector — TTS the lines,
then ia2v render, as one chained job. This is the single most common loop in episode
production and today it's two labs and a file-picker apart.

### N1.4 Overnight batch mode
`assemble` accepts `tier: 'final'` + multiple scenes (or a whole episode). Combined with
the existing queue pause/priority bands: queue the episode at `batch` priority before
bed, `interactive` work still preempts in the morning if anything's left. Add a
completion **desktop notification** (Electron `Notification`) for any batch ≥ 3 jobs.

---

## N2 — Quality controls & engine depth

The ranked shortlist from `H3-TURBO-LORA-PLAN.md` Part B, plus the two "later rung"
items whose prerequisites have since landed. All of these are **backend-supported
already** — the work is exposure, not research.

### N2.1 LTX Director sliders: `image_attention_strength` + `img_compression`
The two highest-leverage constants in `comfy/director-graph.ts`. Surface in the Video
lab params panel (and shot inspector render options) via `engineSurface.ts` with
sensible ranges + the current values as defaults. Per-shot override persists on the
shot's render spec.

### N2.2 Camera LoRA weights — unhide the section
The 7 camera LoRAs are installed (verified compatible; "19b" names are 22b-compatible,
480/480 keys). `capabilities.ts` already probes for them; `engineSurface.ts` already has
the section built but `hidden`. Flip it to shown-when-probed, add a per-LoRA strength
slider (default from the LoRA card recs), and a "camera move" picker in the shot
inspector's camera block so `cameraSpec` can map to a LoRA choice.

### N2.3 "Hero quality" tier
A third tier beyond draft/final: the sampler/sigma ladder + CFG combination from Part B's
table, tiled encode on, for money shots. One segmented control (Draft / Final / Hero) in
render options; Hero shows an honest time estimate next to it.

### N2.4 `global_prompt` = per-project style line
Wire the deliberately-empty `global_prompt` to `bible.style.artDirection` (with a
per-render override field). This makes the style bible actually steer LTX renders
instead of only image gen.

### N2.5 Reference decks (image lab)
Decks are t2i-only today (`shared/index.ts:111`). Add the i2i/ref variant: a deck run
that carries a ref image (or a bible character's refs) through qwen-edit per card. This
is the character-consistency bulk tool the Bible has been waiting for — "12 poses of
Sterling in the Lounge" as one deck.

### N2.6 Music vocal conversion rung
`adapters/music.ts` marks cloned-voice conversion over ACE-Step vocals as a later rung —
the Seed-VC + pitch-match adapters have existed since labs-v2. Chain them: generate with
ACE-Step native singing → optional `convertVoice: <voiceId>` step using the existing
`pitch` f0-matching adapter. Surface as a voice picker on the Music create rail
("Sing as…"), gated on a cloned voice existing.

### N2.7 Take-aware retakes
`shot_retake` exists for the Director; give humans the same power: on any take in the
Video lab / inspector, a "Retake with changes" action that pre-fills the exact spec that
produced it (from the provenance sidecar) and lets you tweak one thing. Provenance
sidecars already store everything needed.

---

## N3 — Home, projects & review

### N3.1 Home screen (`/home`, becomes the index; Director moves to `/director`)
The last unbuilt item from the 2026-08-05 rollout. Contents, all from existing queries:
- **Now**: running/queued jobs (shared job renderer, N4.2), GPU/VRAM, engine health
  (the preflight strip from Job Center).
- **Resume**: active project card — last-touched shots, latest takes strip, "continue in
  Studio/Director" actions.
- **Recent output**: a small masonry of the newest assets across kinds, each with
  jump-to-lab / send-to-timeline.
- First-run state: if no projects, the wizard's "render your first shot" golden path.

Decision needed at build time: keep `/` = Director for muscle memory, or make Home the
index. Recommendation: Home as index — Director is one click away and Home is where
"what was I doing?" gets answered, which is the actual cold-start question.

### N3.2 Real project switcher + lifecycle
`AppShell` hardcodes `projects[0]`. Build: a project menu on the shell's ProjectCard
(switch persists to settings as `activeProjectId`, all hooks read it), plus
`projects.archive` (moves the folder to `<dataRoot>/archive/` — the folder-is-the-database
answer to delete) and `projects.delete` behind a typed-name confirm. No trash
infrastructure needed; archive **is** the trash.

### N3.3 Dailies / review surface
A review mode for a scene or episode: plays every shot's selected take in script order
(pre-timeline — this is "watch dailies", not editing), with per-take
**A/B compare** (two takes side-by-side or flip-on-hold), star/approve marking that sets
`shotTake` selection and shot `status`, and a reject-with-note that seeds N2.7's retake.
Lives as a mode inside Studio's board (a "Review" toggle next to SCRIPT/BOARD), not a new
route — the selection model is already there.

### N3.4 Library trash-lite
`library.remove` is a hard delete. Cheap fix consistent with folder-is-the-database:
move to `<dataRoot>/.trash/<date>/` with the sidecar, purge on a 7-day timer at startup.
Undo toast in the UI for 10s after a delete.

---

## N4 — UI/UX consistency pass

The primitives exist; the older screens predate them. This round makes the app feel like
one hand built it, and adds the two navigation features power users expect.

### N4.1 One lab grammar
Define a shared `LabShell` layout (left: create/params rail · center: results ·
right/overlay: inspector · bottom: transport if audio) and migrate Image and Voice to it
(Video and Music already effectively match). While migrating, replace every hand-rolled
input class string with `Field`/`inputCls` (VoiceLab ×2, ImageLab ×3, Settings ×1 plus
variants).

### N4.2 One job-progress renderer
Job progress is currently rendered three independent ways (video JobRail, GlobalStatus,
JobCenter). Extract one `JobCard`/`JobRow` pair with size variants; all three surfaces —
plus N1.2's batch card and N3.1's Home — consume it. Do this **before or with** N1.2 so
the Assembly Line doesn't become renderer #4.

### N4.3 One shot inspector
`director/inspector.tsx` (slide-over) and `studio/inspector.tsx` (right-rail) duplicate
the same Shot editing surface. Extract the shared body (`shot/InspectorBody.tsx`) with
the two hosts as thin containers. N1.3's "Voice + render" button lands here once, not
twice.

### N4.4 engineSurface-style gating for all labs
The Video lab's declarative shown/locked-with-reason/hidden model is the house style
("visible gating, never silent absence") — Image, Voice, Music do it inline per-branch.
Generalize `engineSurface.ts` into a small shared helper and port the three labs. This
is also what makes N2.6's "Sing as…" gate and future engine adds cheap.

### N4.5 Command palette (Ctrl+K)
Navigation (screens, projects), actions (new shot, enqueue render, pause queue), and
search over assets/prompts/characters by name. The tRPC surface already exposes
everything needed; this is a renderer-only feature and disproportionately loved.
Include a "jump to job" and "jump to latest take" verb.

### N4.6 Completion toasts with jump
On job completion while you're on a different screen: a toast (using the existing
z-layer/motion tokens) with thumbnail + "View" that deep-links to the producing lab with
the take selected. Wire from the existing `jobs.onSnapshot` subscription; suppress when
the producing screen is already focused.

---

## N5 — Platform hygiene

Cheap now, expensive later. Interleave these with the feature rounds (each is a good
"first task of the session" while models download).

- **N5.1 Kill the sample.ts type fork.** 12 screen files import view-model types from
  `@/data/sample` instead of `@aurea/shared` (`Job` in JobCenter, `LibraryAsset` in
  AssetLibrary, etc.). Re-point every import, delete drifted duplicates, keep sample.ts
  only as `placeholderData` values typed *by* shared. Prevents a silent renderer/core
  schema drift bug class.
- **N5.2 Live Formats registry.** Replace the hand-mirrored `data/formats.ts` with the
  tRPC query its own header promises (`videofast.formats` reading the real registry from
  `videofastDir`), with the static file demoted to offline fallback. Same for
  `STYLE_PACKS`.
- **N5.3 Decompose the remaining giant screens** as they're touched (ImageLab 2426 and
  VoiceLab 1879 fall out of N4.1; Bible 1538 and Settings 976 get folders when next
  edited — don't do a big-bang refactor).
- **N5.4 Repo-wide `typecheck` script + renderer smoke tests.** Add `typecheck` covering
  desktop; add a first Vitest + React Testing Library harness in `apps/desktop` with
  smoke tests for the shared primitives and one per merged screen (render + hooks mocked).
  Renderer coverage is currently zero.
- **N5.5 README refresh.** It still describes the stubbed-screens era and calls
  `packages/` "reserved." Rewrite against reality; link the external PRDs it references.
- **N5.6 Snapshot-subscription note.** `jobs.onSnapshot` / `studio.onUpdate` /
  `director.onUpdate` send full snapshots. Fine at current N — explicitly **deferred**,
  revisit only if a profiler says so. Recorded here so it isn't re-litigated.
- **N5.7 Commit the in-flight work.** The H3 Turbo LoRA round (13 files) +
  `H3-TURBO-LORA-PLAN.md` + the 6 `scripts/*.mts` helpers are dirty/untracked in the
  `aurea` repo. Commit before starting this round.

---

## Explicitly parked (decided, don't re-open without cause)

- **Timeline compositing/transforms** — cuts-first is a deliberate cap; Aurea's editor is
  for assembly, finishing happens elsewhere. Revisit only if rough cuts start dying for
  want of a crop.
- **OpenRouter/Ollama Director backends** — settings enum + UI fields exist but the
  Director is Claude-Agent-SDK-only. Either wire them or (recommended) hide the fields
  via N4.4-style gating until there's a real need.
- **Delta protocol for subscriptions** — see N5.6.
- **Delete for projects without archive** — archive-first (N3.2).

---

## Suggested order

1. **N5.7** commit in-flight work → **N5.1** type fork (half a day, de-risks everything).
2. **N2.1 + N2.2 + N2.4** — the three cheap quality exposures; immediately better renders.
3. **N4.2** shared job renderer → **N1.1 + N1.2** the Assembly Line (the round's
   centerpiece; verify with a real Zoo Logic scene end-to-end in draft tier).
4. **N1.3** dialogue fast path + **N4.3** unified inspector (they share a home).
5. **N3.1** Home screen + **N3.2** project switcher.
6. **N3.3** Dailies review + **N2.7** retakes (they feed each other).
7. **N2.3 / N2.5 / N2.6** hero tier, ref decks, sung-as voice — one per session.
8. **N4.5 / N4.6** palette + toasts; **N5.2–N5.5** hygiene interleaved throughout.

Each numbered step is roughly one focused session on the 3090 Ti, with N1 likely two.
