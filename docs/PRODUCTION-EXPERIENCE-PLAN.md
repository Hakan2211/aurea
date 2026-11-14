# Aurea production experience plan — 2026-09-02

Status: P1 + P2 + P3 BUILT 2026-09-02 (253 core tests green, core + desktop typecheck
clean; P3's ffmpeg half verified live on synthetic takes, §8). P4–P6 still plan.
Build log in §8.

## 0. Why this plan exists

The acceptance pilot (`ZOOLOGIC-EPISODE-FACTORY.md` § "Acceptance pilot — run
2026-09-02") proved the factory makes a finished Field Note in two human decisions.
It also showed what the experience actually costs: 75 minutes of wall clock for 26
seconds of picture, five crew retakes, and seven traps the operator has to carry in
their head. The five blockers were fixed the same day. What's left is not an engine
problem. It is the gap between what a human decides and what the machine does, and
the pipeline's habit of failing quietly.

Ordering rule: P1 and P2 first, together, because they touch the same files
(`packages/shared/src/storyboard.ts`, `packages/shared/src/ia2v.ts`,
`packages/core/src/shot-director.ts`, `packages/core/src/qc.ts`) and share one
verification: a clean re-run of Field Note 15. P3–P6 follow in the order listed and
are each independent.

Constraints carried from memory:
- A core change is not delivered until Aurea is RESTARTED (`scripts/launch-aurea.ps1`).
  The "Update ready" pill is the tell.
- Crew is driven from the shell: `npx tsx scripts/tool.mts <tool> '<json>'`. MCP is
  off in most sessions.
- LTX 2.5 is the Zoo Logic default; 2.3 only for a Director timeline or full camera
  LoRA travel. Multi-shot prose renders with `enhance: false`.

## 1. P1 — Close the pilot's open defects

Open from the pilot list: #1, #2, #5 (board prompt), #7, #8, #4. #12 stays parked
until H3 reports `available: true`.

### 1.1 Board prompt — #1, #2, #5

Problem: `composeKeyframePrompt` (`packages/shared/src/storyboard.ts:250`) writes a
~90-word set block first and the camera phrase last, so `camera.shotSize` never wins;
the set plate's `deep focus, no bokeh` collides with the lens clause's `shallow depth
of field, bokeh`; and composition ids like `negative-space` expand to text that
contradicts `mcu`/`cu`.

Change:
- Reorder the composed keyframe prompt to **framing → subject → action → set → look**.
  Shot size and lens go in the first sentence. This is the same order the qwen-edit
  ref workflow honours in the character-sheet pipeline.
- Resolve the focus contradiction in one place: when the camera spec carries a lens
  clause with depth of field, strip the set plate's competing `deep focus` / `no
  bokeh` tokens from the location's `stylePrompt` before concatenation. Push a
  `notes[]` entry saying which token was dropped.
- Gate composition ids by shot size. A table in `cinematographyBank.ts`: each
  composition id lists the shot sizes it is valid for. An invalid pair drops the
  composition clause and adds a note, rather than emitting the contradiction.
- Because the qwen-edit character ref is full body, a `cu`/`mcu` board should pass a
  crop hint to the ref step (head-and-shoulders crop of the reference sheet) when the
  ref workflow supports an input crop. If it does not, record that in the note so
  the operator knows the board will run wide and can retake once, not four times.

Test: a unit test per rule on `composeKeyframePrompt` (framing first; no
`deep focus` + `bokeh` in one prompt; `negative-space` + `mcu` yields no
negative-space clause and one note).

### 1.2 Duration check — #7

Problem: `qc.ts:323` compares the take against a re-composed default length, not the
length actually requested, so every correct take warns.

Change: record `requestedDurationSec` on the take sidecar at render time. The
`renderShot` / `retakeShot` path in `shot-director.ts` already writes
`camera: { move, strength }` there; extend that record. `qc.shot` compares against the
sidecar value when present and falls back to the composed length, with a note
"compared against a recomposed default", only for takes older than this change.

### 1.3 Retake notes are instructions — #8

Problem: `retake_shot` folds the note into the prompt verbatim as `Direction: …`
(`tools.ts:1065`, `ia2v.ts:132`). A note that describes the failure ("he stood up and
the set vanished") injects the failure into the next render.

Change, two layers:
- **Lint at the tool boundary.** `retake_shot` rejects, with a helpful message, notes
  that read as diagnoses: past-tense verbs at the start, "didn't", "wrong", "failed",
  "instead of", or a leading "the take". The message shows the rewrite pattern:
  "write what to do: 'stay seated, hold the framing'". A non-blocking flag
  `allowDiagnosis` covers the rare case.
- **Fix vocabulary.** `retake_shot` gains an optional `fix` array with a small fixed
  vocabulary the composer turns into motion instructions: `hold-framing`,
  `stay-seated`, `hold-set`, `tighter`, `looser`, `slower`, `static`. These map to the
  phrases the pilot measured as working. Free-text `note` stays for everything else
  and goes through the lint.

Test: lint rejects "he stood up"; accepts "stay seated"; `fix: ["stay-seated"]`
yields the measured phrase in the prompt.

### 1.4 Re-board selects the new keyframe — #4

Problem: re-boarding appends a keyframe but `selectedKeyframe` stays on the rejected
one (`studio.ts:209` only sets it when empty).

Change: mirror the #9 fix for takes. A freshly delivered keyframe becomes
`selectedKeyframe` unless the shot is `approved`, in which case the human's pick
stays. Add the same rule to the Desk drawer copy so re-board behaves like
approve/retake already do.

### 1.5 Exit for P1

- All six defects have a test that fails on the old code.
- Field Note 15 re-run from scratch (voice → board → render → QC) on
  `zoo-interview-single`: the `mcu` board comes back as an MCU without a manual
  override, zero duration warns, zero retakes caused by the composer.

## 2. P2 — Put the craft rules into the composer

Every rule below is a measured fact that currently lives only in notes and memory.
The composer already has the right mechanism: `notes[]` in `composeIa2vShot` and
`composeShotFromBoard`, surfaced by the Desk drawer (`screens/desk/drawer.tsx:86`).
P2 turns that mechanism into a rule table so a rule is a row, not a paragraph.

### 2.1 The rule table

New file `packages/shared/src/craftRules.ts`. Each rule has `id`, an `engine`
filter, `applies(spec)`, `rewrite(prompt)` or `lint(prompt)`, and `why` (one
sentence plus the date it was measured). The composer runs the table last, after the
look line, and pushes a note per rule that fired: "Rule <id> changed the prompt:
<what>. Why: <why>."

Rules to seed, all already measured:

| id | Kind | Rule | Measured |
|---|---|---|---|
| `motion-only-i2v` | lint | An i2v/ia2v single's prompt must not contain set, wardrobe, lens or look tokens. Fires if the prompt repeats a `stylePrompt` sentence or a wardrobe term. | 2026-09-02 pilot |
| `background-hold-7s` | rewrite | Past 7s add one background-hold clause. Already in `ia2v.ts`; move it into the table. | FN15-3 |
| `stays-seated` | rewrite | "shifts in his chair" / "settles" / "adjusts" → append "stays seated". Both engines turn those into leaving the chair. | 2026-09-02 A/B |
| `named-beat-lipsync` | lint | An ia2v prompt must name the speaker at the beat, never a pronoun, or the mouth stays closed. | 2026-08-23 |
| `enhance-off-multishot` | rewrite | Multi-shot prose sets `enhance: false`. Already enforced in `multiShot.ts`; a table row makes it visible. | 2026-08-31 |
| `enhance-on-single` | rewrite | Single-take 2.5 prompts leave the enhancer ON. | 2026-09-02 |
| `no-camera-lora-25` | lint | `ltx25` never carries a camera LoRA or Director timeline; describe the move in prose. | 2026-09-02 |
| `push-in-strength` | rewrite | On 2.5 a prose push-in ends tighter than the lane's size at 8s. For `mcu` locked interviews default `move: static`; for a push-in cap the shot at 6s or note it. | FN15-2 verify |
| `silence-25` | lint | A 2.5 shot with no dialogue emits digital silence. Flag at compose time: "this take will be silent; add a room-tone slot or a sound cue." Ties to P3.2. | 2026-09-02 A/B |
| `no-text-objects` | lint | No named text-bearing objects in any Krea2 prompt (signs, screens, papers). | Krea2 guard rails |
| `coverage-180` | lint | Coverage bearings past 180° are continuity-safe for cast, not for the room. Note on any coverage pass that asks for them. | V3 measure |

### 2.2 Surfacing

- Desk drawer: notes already render. Group them under "Composer changed your prompt"
  and "Composer warnings", with the rule id as a chip. Clicking the chip shows `why`.
- `shot_from_storyboard` and `retake_shot` return `rulesFired: string[]` so the shell
  crew and the playbook skill see the same thing.
- `qc_shot` cross-checks: a rule that was linted at compose time but the take still
  shows the failure (silence, set drift past 7s) reads as "known rule, still broke",
  not as a novel finding.

### 2.3 Exit for P2

- Every row has a unit test (fires / does not fire / note text).
- Compose the pilot's original, drifting prompt through the table: the lint names
  `motion-only-i2v` and the rewrite produces the prompt the pilot fixed by hand.
- Re-run Field Note 15 with the operator ignoring the memory file. Zero rules have to
  be remembered; every rule that would have been forgotten shows as a note.

## 3. P3 — Trust signals

Two session-eating failures were both silent. The stale-build pill fixed one.

### 3.1 Hard take verification

`qc_shot` gains three failing (not warning) checks, and the take badge in the Desk and
Video lab turns red when any fails:
- **no video track** or zero decodable frames (ComfyUI `status=success` with no video).
- **digital silence**: mean below −80 dB on a take whose spec has placed lines or a
  sound cue.
- **duration mismatch** beyond 15% of `requestedDurationSec` (after P1.2).

Run these automatically on `attachTake`, before the take is selected, so a broken
take never becomes the thing `approve_shot` locks.

### 3.2 Room-tone fallback for 2.5

When `silence-25` fires and the operator does not add a cue, the render path lays a
room-tone bed for the location (one loopable file per location in the bible, seeded
from ACE-Step or a stock file) under the take at −40 dB. Per-project setting
`bible.style.roomTone: "auto" | "off"`, default `auto`.

### 3.3 Exit

A deliberately broken take (point the take at a PNG, as the LoadAudio bug once did)
shows red, cannot be approved without `force: true`, and says why in one line.

## 4. P4 — Project hygiene

`zoo-logic` still reads 1280×720 with FN15-4 ahead of FN15-3; canvas is adopted only
on an empty sequence and order only re-laid on the next approval.

- New tool `normalize_project` (and a Desk button "Normalize to lane"): adopts the
  lane's canvas, re-lays the base track via `orderVideoTrack` in script order, and
  re-exports at the project's `loudnessLufs`. Dry-run mode prints the diff first.
- The automatic adoption rule stays as is; this is the explicit override.

Exit: run it on `zoo-logic`, confirm 768×1344, script order, and −16 LUFS on the
export without ffmpeg by hand.

## 5. P5 — Time to first frame

A draft render is 2–4 minutes and the pilot's retakes were blocking checks, not
finish checks.

- New lane `preview` per engine: 2s, 480p-class (`640×1120` vertical, `1120×640`
  landscape, inside the 1MP draft guard), draft tier, enhancer off, same seed as the
  eventual draft. Target under 45s on 2.5.
- Desk gets "Preview" next to "Render". `qc_shot` on a preview runs only the
  board-hold check (first frame vs board SSIM) and the hard checks from P3.1.
- Approving a preview does nothing to the timeline; it only unlocks "Render" with the
  preview's seed carried.

Exit: FN15-2 preview under 45s, and one board-drift case caught at preview instead of
after a 4m17s render.

## 6. P6 — One console

The shell (`scripts/tool.mts`) and the Desk have already diverged once (#9 and #10
were only visible from one side).

- Make the Desk the crew console: every verb the tool registry exposes
  (`qc_shot`, `approve_shot`, `retake_shot` with `fix`, `shot_from_storyboard` with
  `preset` / `engine` / `multiShot`, `normalize_project`, preview) is one button with
  the same argument shape, calling the same registry function. No screen-local
  reimplementation.
- `scripts/tool.mts` stays as the headless path and gains parity tests: a fixture
  project run through both paths must produce the same project JSON.
- The `/zoologic-produce` playbook is rewritten against the verbs, not the traps.

Exit: parity test green; the playbook has no "remember to" sentences left.

## 7. Verification protocol (all phases)

1. `npm test` in `packages/core` green (baseline 215).
2. Restart Aurea; confirm `staleBuild: false`.
3. Re-run Field Note 15 through the Desk only, no shell, and log human decisions,
   crew retakes, and wall clock against the pilot's 2 / 5 / 75 min.
4. Then scene 1 of "The Fund", the first run to exercise coverage and B-roll lanes.

## 8. Build log

### 2026-09-02 — P1 + P2 built

Not yet render-verified: the P1/P2 exit runs (§1.5, §2.3, a Field Note 15 re-run through
the Desk) are the next session's first job, after a RESTART of Aurea.

**P1.1 board prompt** — `composeKeyframe()` in `packages/shared/src/storyboard.ts` now
returns `{ prompt, notes }`; `composeKeyframePrompt()` is its `.prompt` so every caller
(board mutation, Storyboard preview, `composeShotSpec`) got the new order for free.
Order is framing → subjects → action → set → light + composition → art direction, with
the bank's overlapping fragments deduped ("cu" and the "shallow" lens both said shallow
depth of field). The focus contradiction is resolved by stripping the set plate's tokens
that fight the lens (`deep focus` / `no bokeh` under a shallow lens; the shallow tokens
under a deep one, with `no bokeh` protected by a lookbehind). Composition ids are gated by
`COMPOSITION_SHOT_SIZES` in `cinematographyBank.ts` (negative-space, leading-lines,
frame-in-frame, depth-layers, triangle, v-formation, depth-line each list their sizes;
absent = any). A cu/mcu/ecu board notes that the character ref is full body. The crop
hint for the ref step was NOT built: the qwen-edit workflow takes whole reference images,
so the note is the deliverable there. Tests: `keyframe-prompt.test.ts`.

**P1.2 duration** — `shotTakeSchema.durationSec` (optional) is written by `attachTake`
from the job payload's requested length (server import hook). `qc.shot` compares against
it and only falls back to the recomposed default for takes that predate the field, with a
note saying so. The sidecar was left alone: the take record is the cleaner place.

**P1.3 retake direction** — `packages/shared/src/direction.ts`: `lintDirectionNote`
(past-tense openers, "didn't/wrong/failed/instead of/drifted/vanished…", "the take …")
and `FIX_VOCABULARY` (hold-framing, stay-seated, hold-set, tighter, looser, slower,
static). `productionRetakeShotSchema` takes `note` (now optional), `fix[]`,
`allowDiagnosis`; the router lints, then records each fix phrase and the note as separate
takeNotes. The schema's "note or fix" rule is enforced in the router, not as a zod
`refine`, because a refine turns the schema into a ZodEffects the tool registry cannot
`.omit()`. Desk drawer has the fixes as toggle chips above the note box. Tests:
`direction.test.ts`.

**P1.4 re-board** — `attachKeyframes` selects the delivered keyframe unless the shot is
approved (mirror of the #9 fix). Test in `factory-blockers.test.ts`.

**P2 craft rules** — `packages/shared/src/craftRules.ts`: 11 rows, each with `why` +
date. `applyCraftRules(ctx)` returns the rewritten prompt, `enhance`, drop flags,
`rulesFired[]` and one note per rule in the format `Rule <id>[ changed the prompt]:
<what>. Why: <why>` (`ruleOfNote()` parses it). Wiring: `composeIa2vShot` runs the table
itself (the 7s background hold moved out of ia2v.ts into the table; the exported
`BACKGROUND_HOLD_AFTER_SEC` now lives in craftRules.ts); `composeShotFromBoard` runs it
on every branch (h3, multi-shot, director; the ia2v branch only adds lane-level firings
so nothing is reported twice) and returns `rulesFired`; `composeKeyframe` runs the
keyframe rules; `coverage_pass` reports coverage-180 on its run. Router `renderShot`
and `retakeShot` return `rulesFired`; `shotSpec` returns the whole composed result.
`qc.shot` cross-references: a failing check whose rule fired at compose time is reported
as "known rule, still broke". Desk drawer groups the notes into "Composer changed your
prompt" / "Composer warnings" with the rule id as a chip whose title is the `why`.
Deviations from §2.1: `enhance-on-single` is a LINT, not a rewrite — a lane that turns
the enhancer off on a single is a deliberate setting, so it is warned about rather than
overridden. `push-in-strength` is a lint too (it needs the operator to choose 6s or
static). Tests: `craft-rules.test.ts`, incl. the pilot's own drifting prompt naming
`motion-only-i2v`.

**Gotchas met:** writing TS regexes through a Python heredoc turned `\b` into literal
backspace bytes in storyboard.ts (silently: the regexes just never matched). Use the
Write/Edit tools for anything with backslashes.

### 2026-09-02 — P3 built

Not yet verified in the running app: restart Aurea, render one no-dialogue shot on 2.5 and
one shot with placed lines, and watch the take strip in the Desk drawer.

**P3.1 hard verification** — `packages/core/src/take-verify.ts` (pure `judgeTake` over a
`TakeMeasurement`, `measureTake` = ffprobe + `-count_frames` + volumedetect, tests in
`take-verify.test.ts`) and `take-delivery.ts` (`verifyDeliveredTake`, the orchestration).
`shotTakeSchema.verify` = `{ status: pending|ok|broken, reasons[], checkedAt,
measuredDurationSec, meanDb, roomTone? }`. The server import hook calls `attachTake` with
`verify: true` (take lands `pending` and selected, same as before) and then runs the
verification async; `recordTakeVerify` writes the result and, if BROKEN and the take was the
selection on a non-approved shot, moves the pick back to the newest ok take. Broken =
no video track · zero frames · **one frame and no duration (a PNG probes as video — the
plan's "zero decodable frames" would have let it through)** · no audio or mean < −80 dB
under placed lines (`expectationOf(payload)`: `audio`, `director.audio`, `inpaintAudio`) ·
length > 15% off the requested duration. `approveShot` refuses a broken take with the
reasons in the message; `force: true` (schema field, Desk = a second deliberate click on
"Approve broken take…") overrides. `qc.shot` now reports a `verify` fail check from the
record (so the report and the badge never disagree), fails `duration` when the take carries
a requested length (the recomposed-default fallback stays a warn), and names digital
silence vs "effectively silent". Badges: Desk shot card + Studio board card get an ember
"broken" chip (title = reasons); the drawer has a `TakeVerifyStrip` under the player with a
Re-verify button and red take pills. New router `production.verifyTake` + MCP `verify_take`.
The Video lab was NOT touched — it lists jobs, not shot takes; the two shot-card surfaces
are where a take is judged.

**P3.2 room tone** — `bibleLocationSchema.roomTone` (library relPath of a loopable bed) +
`bibleStyleSchema.roomTone: auto|off` (default auto). `verifyDeliveredTake` lays the bed
only when the take is silent for the RIGHT reason — ok, silent, no placed audio — via
`bedRoomTone`: the bed's mean is measured and gained to a mean LEVEL of −40 dB (a level,
not a −40 dB gain: a −40 dB gain on a real bed measured −68 dB, under qc's own −50 "silent"
line), looped with `-stream_loop -1`, `amix … normalize=0` (or the bed alone when the take
has no audio stream), video copied, written as `<take>.tone.mp4` next to the original; the
take's asset is swapped to it and `verify.roomTone` names the bed. Seeding: `bible.seedRoomTone`
(MCP `seed_room_tone`) takes `source` (a library audio relPath, null clears) or seeds an
ACE-Step job with `musicPayloadSchema.roomTone: { location }` — the import hook attaches
the finished track to the location and skips the cover-art chain for it. Bible screen:
"Room tone" block on each location (player, clear, Seed with ACE-Step, Choose from library
over `useBible().libraryAudio`) and a select under the style textareas.

**§3.3 exit, live (synthetic files):** a PNG pointed at as a take → broken ("a single
still, not a take"; plus "no audio track under placed lines"); a 4s anullsrc take with no
lines → ok + silent; the same take with lines → broken "digital silence (mean −91 dB)";
6s asked / 4s delivered → broken "33% off"; bedded takes measure −43.2 dB (over a silent
stereo track) and −40.1 dB (no audio stream). Store rule and force refusal are pinned in
`take-verify.test.ts`.

**Gotcha met:** a bash heredoc holding a large Python edit script died with "unexpected EOF
while looking for matching `'`" — write the script to the scratchpad with the Write tool and
run the file.

### 2026-09-02 — P4 + P5 built

272 core tests green (19 new across `normalize.test.ts` and `preview.test.ts`), core and
desktop typechecks clean. Live measurements are in the section that follows this one.

**P4 normalize_project** — `packages/core/src/normalize.ts`: `planNormalize` (pure, over
`NormalizeFacts`) and `normalizeProject` (gathers, applies, exports). The canvas comes from the
named lane's `payload.resolution`, else the MAJORITY canvas of the approved takes by probe
(`majorityCanvas`); a lane that names no canvas or does not exist is said in the notes, never
silently replaced. Order is the production's own (`StudioStore.approvedTakes`, new — the
approved shots' picked takes in document order, previews excluded); the diff lists
`before`/`after` labels, approved takes MISSING from the sequence (normalize re-orders, it
does not invent clips — approve_shot lays them), and EXTRA hand-placed clips kept at the end.
`TimelineStore.setCanvas` is the new explicit override; `orderVideoTrack` is reused. The
export is the same ffmpeg job `timeline.export` enqueues, at `loudnessLufs` (default −16).
`dryRun` returns the plan and touches nothing. Router `studio.production.normalize`, MCP
`normalize_project`, Desk header button "Normalize to lane" → `desk/normalize.tsx` (dry run
on open, lane select, canvas from → to, order now vs script, notes, "Apply and export").

**P5 preview** — not a seeded lane per engine but a TRANSFORM on whatever lane the shot is
composed in (`shared/preview.ts`: `previewFields`): 2s (4s on H3 — its adapter refuses less),
`640 × 1120 (preview)` / `1120 × 640 (preview)` / `832 × 832 (preview)` by the lane's
orientation (0.72 MPx, inside the draft guard, on the /32 grid), `fast: true`, `minimaxTier:
draft`, `enhance: false`, and audio / the Director timeline / guide frames DROPPED — a 2s
window under an 8s voice bed would make the engine trim or refuse, and the preview asks
whether the board holds and the blocking reads, not whether the line lands.
`shotRenderSchema.preview`; the router assigns the seed UP FRONT (`randomSeed`) for every
render and retake so it lands on the take (`shotTakeSchema.seed`, `shotTakeSchema.preview`,
`videoPayload.board.preview`); a full render with no seed of its own rolls
`shot.approvedPreview.seed`. Store rules: `attachTake` flags the preview and leaves `status`
alone; `shotStage` counts only non-preview takes as "rendered"; `approveShot` on a preview (by
id) records `shot.approvedPreview = { takeId, seed }` and changes neither status nor pick — the
router lands nothing on the sequence; an unnamed approval skips previews; `approvedTakeAssets`
never lists one; the broken-take fallback stays within previews. `verifyDeliveredTake` never
beds a preview with room tone. `qc.shot` gains a `board-hold` check on every take (first frame
decoded to PNG vs the selected keyframe scaled to the take, ffmpeg `ssim`, pass ≥ 0.70 / fail
< 0.40) and on a preview stops there: no cut count, no audio, no articulation. MCP
`preview_shot`; Desk drawer gets a lane select + "Preview" / "Render" next to the verdicts, a
`pre` pill on preview takes (sage when approved), and "Preview approved · seed N rides the
next render".

### 2026-09-02 — P3 + P4 + P5 verified live (Aurea restarted, `staleBuild: false`)

**P4 exit (met):** `normalize_project` on `zoo-logic`, dry run then apply. Canvas 1280×720 →
768×1344 from the takes ("4 of 4 approved takes are 768×1344"); the base track already read
FN15-1…4 by START TIME (the earlier re-lay had fixed the starts and left the array order
1,2,4,3 — the plan compares by start, which is what the export uses); export queued at −16
LUFS. The export measured with `ebur128`: 768×1344, 24 fps, 25.67s, **I = −15.7 LUFS**, LRA
9.6 LU — single-pass `loudnorm` lands within 0.3 LU of the target.

**P5 exit (half met):** FN15-2 previewed in the Field Note lane on 2.5 (`engine: ltx25`
override → the ia2v composer, `640 × 1120 (preview)` → 2.5's draft renders the base pass at
HALF the canvas, so the file is 320×544 · 2.04s). The preview verified ok on delivery, the
seed landed on the take, the shot's status stayed put. Wall clock: **2m15s cold, 1m54s
warm** — of which the sampler is **4 seconds** (8 steps, 1.6 it/s). The rest is ComfyUI
0.32 re-staging the weights ("Model Initializing" ≈ 50s, then the 14.6 GB text encoder and
20 GB DiT swapping through a 24 GB card). Two things were done about it: (1) the 2.5 adapter
no longer clears VRAM when the last render on that server was 2.5 itself
(`ComfyClient.isWarm/markWarm`, cleared by any adapter's `freeMemory`) — measured 112.7s →
91.6s per prompt; (2) the number is written down here: **a 2.5 preview floors at ~90s on
this card, not 45s**, because TE + DiT together exceed VRAM and re-stage every prompt. The
preview is still 2.5–3× cheaper than the 4m17s draft the pilot paid for a blocking check.

**Board hold, calibrated:** full-size colour SSIM barely separated the true board (0.64)
from the three sibling Field Note boards (0.55–0.58) — same tiger, same loft. Both frames
reduced to 64-px grey thumbnails: **0.81 own board vs 0.64–0.68 siblings**; lines set at pass
≥ 0.76 / fail < 0.60. Live on the rebuilt app: the FN15-1 preview → `board-hold pass (SSIM
82%)`, verdict pass. The drift case is the sibling band (warn), which is what a re-boarded or
wrong-keyframe shot reads as; a reference sheet or another room falls under 0.60.

**Seed carry, live:** `approve_shot` on the preview take → `approvedPreview = { takeId,
seed: 730485328 }`, `clip: null`, status and selection untouched; the following
`shot_from_storyboard` (no seed given) went out at seed 730485328 with the note "Seed
730485328 carried from the approved preview."

**P3, live:** every delivered take since the restart carries a verify record (previews:
ok · 2.04s · −18.9 dB — 2.5 scores a no-audio preview itself, so no room-tone path was
exercised). The full render with placed lines is in the last section below.

**Full render with placed lines (P3 + P5 together):** FN15-1 in the Field Note lane on 2.5
at the carried seed — 5s · 768×1344 · voice bed under it — landed in **2m32s** (the pilot paid
4m17s for the same shape) and verified `ok · 5.04s · −26.1 dB`; the shot's approved status
and human pick were left alone, as the store rule says.

**Desk UI, checked in Chrome** (dev server + `#/desk?studiod=port:token`): the drawer shows
the lane select ("Interview single" by default) with Preview and Render beside the verdicts,
disabled until the shot is boarded; "Normalize to lane" opens on a dry run and prints the
canvas line and the now-vs-script order (on Playground: "no approved takes — canvas left as
it is", four hand-placed clips "kept at the end"). Two things learned on the way: the app has
NO project switcher — the active project is the OLDEST (`projects.list()[0]`, created-at
order), so the Desk in the app always shows Playground; the crew tools address `zoo-logic` by
id. And the vite dev server rewrites `dist-electron/studiod.js`, so the running app shows the
gold "Update ready" pill after a Chrome check — a restart clears it (done).

**Not done:** the protocol's Field Note 15 re-run through the Desk is the user's — it needs
their verdicts, and with the Desk pinned to Playground it needs the switcher first (P6's
"one console" is the natural home for it).

### 2026-09-02 — P6 built and verified live (292 core tests, core + desktop typecheck clean)

**The contract:** `packages/shared/src/crewVerbs.ts` — `CREW_VERBS`, one row per crew
verb: the tool id, the tRPC procedure its handler ends in, the argument keys a caller
may pass, and whether it is a human verdict / costs a render. Eight verbs:
`shot_from_storyboard`, `shot_from_storyboard:dryRun`, `preview_shot`, `qc_shot`,
`verify_take`, `approve_shot`, `retake_shot`, `normalize_project`.

**Parity test:** `packages/core/src/crew-parity.test.ts` (20 tests). Part 1 holds the
registry to the contract: every verb's tool exists, its schema covers the verb's keys,
its procedure exists on `appRouter`. Part 2 runs a fixture project (temp dataRoot, real
StudioStore / TimelineStore / PromptLibrary / ProjectStore, a recording engine in place
of the job engine, ComfyUI "offline") through BOTH paths — the tool handler over an
in-process caller, and the caller directly, which is what the Desk does — and asserts
the `production.json` + `timeline.json` they leave behind are identical (timestamps
and fresh ids blanked) and that they enqueued the same payload. Covered: approve
(preview → seed carried, nothing else; rendered take → locked + clip landed, with a
real 1s ffmpeg clip), retake (same two notes, same payload at seed 42; a diagnosis
refused with the same message on both sides), render in the interview lane, dryRun
(same spec, nothing enqueued), preview (2s, `board.preview`), verify (broken on a
missing file, recorded on the shot), normalize dry run (same plan), qc on an
unmeasurable take (same failure text). `trpc.ts` now exports `createCallerFactory`
and `router.ts` a `createCaller` — the first in-process router tests in the repo.

**The Desk as the console:** the drawer's verbs are a `Record<CrewVerbId, ReactNode>`
built from the contract (`verb.approve_shot`, `verb.qc_shot`, …), so a verb added to
`CREW_VERBS` without a button is a type error. New on the drawer: **QC take** (the
`qc.shot` report inline — verdict chip, every check with its detail, the notes, the
evidence directory), **Check spec** (`shotSpec` = `shot_from_storyboard` dryRun: engine,
length, canvas, lane, lines placed, the composed prompt), and the two composer
overrides beside the lane (**engine** ltx25 / ltx2 / minimax-h3, **multi-shot** on /
off / lane's), which ride Render, Preview, Check spec and Retake alike. Each button's
tooltip names its verb. `useProduction` gained `qcShot`, `checkSpec`, and a shared
`ShotLaneOpts` for the render-shaped verbs.

**The project switcher (the FN15 re-run's blocker):** the active project now lives in
studiod — `settings.general.activeProject`, `ProjectStore.activeId()/setActive()`,
`projects.active` / `projects.setActive` on the router, `list_projects` marks it and a
`set_active_project` tool switches it. Every screen already read one hook
(`useActiveProjectId`), which now reads `projects.active` (falls back to the oldest
project, the old behaviour); switching invalidates every query. The switcher is a
select on the rail's project card and one in the Desk header.

**Playbook:** `/zoologic-produce` rewritten against the verbs — a verb table with
arguments up top, each step names the verb and its args, the traps the tools now
enforce (diagnosis lint, enhancer-off by lane, canvas by lane, room tone, hard verify)
are gone from the prose. No "remember to" sentences left.

**Verified live** (Aurea rebuilt + restarted, then the Desk in Chrome against the new
studiod): the switcher moved the Desk and the rail from Playground to Zoo Logic
(`list_projects` shows `active` on both sides); on FN15-1 **QC take** returned
`review` inline (container 768×1344 @ 24 fps 6.04s · duration 21% off a recomposed
default because the take predates the requested-length record · board-hold SSIM 84% ·
single take no cuts · audio −29.9 dB mean · articulation present) with the evidence
path; **Check spec** in the interview lane composed ltx25 · 8s · 1280×704 · 1 line
placed with the shot's Direction folded in. One layout defect found and fixed on the
way (three selects in one 420-px row squeezed the lane select to a chevron — now two
rows).

**Exit:** parity test green; the playbook has no "remember to" sentences. Not done:
the protocol's FN15 Desk-only re-run — the user's verdicts; the switcher it needed now
exists.
