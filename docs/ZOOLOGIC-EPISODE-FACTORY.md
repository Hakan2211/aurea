# The Zoo Logic Episode Factory (plan, 2026-09-01)

What to build so producing Zoo Logic episodes feels like directing a crew instead of
operating a render farm. Written against the locked production shape (documentary hybrid:
interview singles + multi-shot room coverage + 1–2 wordless B-roll inserts per episode)
and against what Aurea already has — which is more than it looks.

---

## 0. What already exists (build on it, don't rebuild it)

The per-shot unit is **complete** today:

| Piece | Where |
|---|---|
| Episode → scene → shot → line data spine | `studio.production` (production.json per project); "The Fund" is already in it as 7 scenes / 55 shots / 235 lines |
| Character/location bible with refs | `studio.bible` (bible.json), `seed_animal_sitcom` |
| Boarding: shot → qwen-edit keyframe from bible refs | `studio.board.generate` / `generate_keyframe` (auto-attaches the still to the shot) |
| Shot composition: board + script lines + measured voice takes → renderable spec | `shot-director.ts` `composeShotFromBoard`; `shot_from_storyboard` |
| Voice: per-character TTS + cloned voices + RVC | `labs.tts`, `generate_speech`; shots carry `voTakes` |
| Render: LTX 2.5 ia2v (3:34/4s draft cold), H3 native-audio (2:30/4s draft warm), retry ladder, draft guards | verified through the app 2026-09-01 |
| Assembly: per-project timeline → ffmpeg export | `timeline_*`, `timeline_export` |
| **An agent-facing tool surface** | `tools.ts` — ~40 MCP tools covering all of the above, incl. `wait_for_job`, `shot_retake` |

So the "Director telling agents step by step" fantasy is not a new system — it's a thin
orchestration + review layer on top of tools that already exist. The real gaps are below.

## 1. The gap: from 55 boarded shots to a cut episode

Walking one scene of "The Fund" through today's surface, a human must: TTS each line one
at a time and attach takes to shots by hand; board each shot and eyeball it; render;
watch every take and judge it with no checklist; retake with a hand-edited prompt; drag
approved takes onto the timeline; pick music separately. That's ~250 manual decisions per
episode, most of which are mechanical. The factory closes exactly those.

---

## P0 — Unblockers (small diffs, everything depends on them) — **DONE 2026-09-01**

All three shipped in one session (typecheck + 151 core tests green). Deltas from the
plan as written:
- P0.1: `enhance` is tri-state (`undefined` = historical "on when installed", only
  `false` is ever sent) so pre-existing queued jobs reparse unchanged. Shot composition
  detects multi-shot prose via `isMultiShotProse()` (shared) — the named-transition
  grammar ("A hard cut transitions to…") is the signature. Toggle lives in the Video
  lab's Quality row, shown only when the Gemma weights are installed
  (`catalog.ltx.enhancer25`).
- P0.2: landed as `studio.voice.tableRead` (tRPC) + `table_read` (MCP tool). TTS
  payloads gained the same `board: {shotId, lineId}` delivery field as video/image;
  takes attach via the existing server import hook (`attachVoTake`) tagged with
  `lineId` on `shotTakeSchema`. UI = per-scene "Table read · voiced/total" pill in the
  Script view + per-line play/retake chip. Cast knob mapping: bible `exaggeration` is
  inverted through the adapter's `emotion` mapping; DramaBox gets delivery notes as a
  stage direction prefix.
- P0.3: `stage` is DERIVED, not stored — `shotStage(shot)` in shared (furthest
  milestone wins; `approved` stays on the persisted `status`). Only `takeNotes[]` was
  added to `shotSchema`.

**P0.1 `enhance` toggle on the video payload.** The Gemma prompt enhancer — on by
default whenever its weights are present (`ltx25-video.ts`) — is proven to destroy
multi-shot prose and drop lines (MULTI-SHOT-PODCAST-PILOT.md). Add
`enhance: boolean | undefined` to `videoPayloadSchema` (undefined = today's behavior),
thread it to `enhanceClipName`, expose in the Video lab panel, and have shot composition
set `enhance: false` whenever the prompt is multi-shot. *Without this, the room-coverage
third of the format can't ship through the product path.*

**P0.2 Scene table read.** One mutation: `studio.voice.tableRead(project, sceneId)` —
walks the scene's lines in order, queues TTS per line with each character's cast voice,
attaches finished takes to the owning shot's `voTakes` tagged with the line id, and the
existing auto-attach/broadcast machinery does the rest. UI: a play-through strip on the
scene (line, character, waveform, retake button). This converts 235 manual TTS runs into
7 button presses, and it's the input the ia2v lane needs anyway.

**P0.3 Shot pipeline status.** One field on the shot: `stage: "script" | "voiced" |
"boarded" | "rendered" | "approved"` + `takeNotes[]`. Derivable almost entirely from
data already on the shot (has voTakes? has keyframe? has attached video?) — persist only
`approved` and notes. This is the field every dashboard, agent, and batch query keys on.

## P1 — The Production Desk (the UI you direct from) — **DONE 2026-09-01**

Shipped in one session (typecheck + 158 core tests green; verdicts verified
end-to-end against the live studiod, UI verified in Chrome). Deltas from the
plan as written:
- Route is `/desk` (falls back to the first episode) + `/desk/:episodeId`;
  "Desk" sits in the rail's Story section. The desk follows the active (first)
  project — there is still no project switcher anywhere in the app.
- The two mutations landed as `studio.production.approveShot`
  (`{project, shotId, takeId?}` — locks `selectedTake`, flips status to
  approved, and drops the take on the sequence's video track via the
  server-side `timelines.addClip`, so clips land in approve order = script
  order when you approve in order; returns shot+production+clip+timeline so
  both caches sync) and `studio.production.retakeShot` (`shotRenderSchema` +
  `note` — appends to `takeNotes` FIRST, then composes + renders so the note
  rides this very render; a shot with no keyframe keeps the note and skips the
  render, `job: null`).
- **`takeNotes` actually ride the prompt now**: `composeShotSpec` folds them
  into the anchor as `…. Direction: <note>; <note>.` — P0 had only stored them.
- Canon library is a Modal (not a docked panel): locations → set plates
  (starred) + boarded keyframes grouped by shot/scene location across ALL
  episodes, an Unplaced section, cast sheets; click = zoom overlay.
- Est. render remaining is a flat 3.5 min/unrendered shot (LTX 2.5 draft
  measured), not the per-engine estimators; the strip also shows the first
  in-flight job title off the new `useDeskJobs()` hook (any job kind with
  `payload.board`, filtered to the active project).
- Drawer extras: A/B compare (any take as B), star = the locked take, per-line
  newest-voTake playback, accumulated "Direction so far" list.
- Tests: `desk-p1.test.ts` is the first StudioStore-on-disk test (temp
  dataRoot, duck-typed settings/projects); 2 new shot-spec tests pin the
  Direction folding; `factory-p0.test.ts` fixture typing fixed (patches are
  schema input, not parsed output — tsc was red on it).
- Repeatable scripts: `scripts/test-desk-verdicts.mts` (both verdicts e2e in
  the playground sandbox, self-cleaning), `scripts/seed-desk-demo.mts` [clean]
  (a drawer-exercisable shot), `scripts/cancel-live-jobs.mts`.

Plan as written:

A per-episode route (`/desk/:episode`) — the missing management surface:

- **Shot board**: scenes as rows, shots as cards in stage columns
  (script → voiced → boarded → rendered → approved). Card = keyframe thumb, characters,
  line count, engine chip, latest take. Click = detail drawer.
- **Take review**: the drawer plays takes newest-first with A/B compare, and the two
  verdict buttons that matter: **Approve** (locks the take, advances stage, drops it on
  the scene's timeline slot) and **Retake with note** — the note is appended to the
  prompt/spec and rides `shot_retake`, so direction accumulates on the shot instead of
  living in your head.
- **Canon library**: project-level panel of set plates, boarded keyframes and character
  sheets tagged by location/scene, so the Boarder reuses the Lounge plate instead of
  regenerating it (continuity AND cost — plates are the identity anchor since cast refs
  burn broadcast text).
- **Episode progress strip**: N/55 approved, est. render time remaining (the estimators
  exist per engine), what the crew is doing now.

Everything here reads/writes tRPC procedures that exist; the desk is a view + two small
mutations (approve, retake-with-note).

## P2 — The crew (agents you direct) — **DONE 2026-09-01**

Shipped in one session (typecheck + 166 core tests green; both QC procedures
verified against real takes via a source-built studiod). Deltas from the plan
as written:
- QC landed as a top-level `qc` tRPC router (`qc.shot`, `qc.sceneVoices`) over
  `packages/core/src/qc.ts` — ffmpeg/ffprobe only, no new dependencies, no
  Python: the `voice_check.py` autocorrelation f0 estimator is PORTED to TS
  (verified on synthesized tones ±8 Hz) and runs on ffmpeg-decoded PCM.
- The five planned checks split honestly into measured vs vision. Measured:
  cut count vs intent (intent = `isMultiShotProse` on today's composed prompt),
  duration vs composed length, audio integrity (missing/silent/clipping), an
  articulation heuristic (motion energy per speech window vs the clip's own
  median — warns, never fails), and the voice suite (chars/sec sanity,
  silence/clipping, per-character f0 consistency ±20% of the scene median).
  CLIP identity drift and OCR text burn shipped as a **vision pass by the
  reviewing agent instead of models**: `qc.shot` emits the evidence (contact
  sheet, cut-straddling frames, the shot's keyframe and cast bible refs as
  absolute paths, under `<dataRoot>/qc/` which the scanner doesn't walk) and
  the tool description + playbook make looking at it mandatory.
- `qc.sceneVoices` returns `retakeLineIds` shaped to feed straight back into
  `table_read({lineIds})` — the retake loop is two tool calls.
- New MCP tools: `qc_shot`, `qc_scene_voices`, plus the P1 desk verdicts
  finally exposed to agents as `approve_shot` (description forbids calling it
  without an explicit human verdict) and `retake_shot` (the note-accumulating
  desk retake — distinct from `shot_retake`, the window inpaint).
- Crew playbook landed at `videoproduction/.claude/skills/zoologic-produce/`
  (the root, not aurea/ — skills resolve from the session's working dir):
  5 roles in order, the two hard gates, one-retake-maximum, lane selection per
  shot type, and a mandated end-of-run report shape.
- Repeatable scripts: `scripts/test-qc.mts` + `scripts/test-qc-voices.mts` —
  both boot their OWN studiod from source (port 0, no port file) so fresh qc
  code is testable while the stale app runs; the voice smoke seeds and removes
  a playground shot. Real-take verification caught real facts: a genuine
  0.4 dB clipping peak, and two different voices on one character flagged at
  235 vs 100 Hz.

Plan as written:

Claude Code **is** the crew — studiod's MCP tools are the hands. What's needed is not a
new agent runtime but (a) automated QC so agents can judge their own output, and (b) a
crew playbook so "produce scene 3" is one instruction. Roles:

1. **Voice agent** — runs the table read, then checks every take: duration sanity,
   f0 consistency per character across the scene (the `voice_check.py` logic, promoted
   from `scripts/podcast/` into a `qc.voiceTake` procedure), silence/clipping. Flags
   retakes; doesn't ask you to listen to 235 lines.
2. **Boarder agent** — per shot: pick the canon plate for the location, compose the
   qwen-edit keyframe with the shot's cast (≤3 per board; contact-sheet trick for
   crowded boards), verify the board with a vision pass against the character sheets
   before advancing.
3. **Cinematographer agent** — chooses the lane per shot type: interview single →
   LTX 2.5 ia2v with named-beat wording; room coverage → multi-shot prose
   (`enhance: false`), 2–4 shots per generation; wordless B-roll → H3 draft with native
   ambience. Composes via `shot_from_storyboard`, renders drafts first.
4. **QC agent** — the piece that makes autonomy safe, all automatable today:
   - **cut count** vs intended (scene-detect, as in `03-judge.mts`) — multi-shot shots
     must cut, singles must not;
   - **lipsync articulation** (mouth-motion energy during the take window — catches the
     closed-mouth pronoun failure);
   - **identity drift**: CLIP/embedding similarity of sampled frames vs the character
     sheet;
   - **text burn**: OCR pass — any legible text = automatic retake (known LTX failure);
   - **audio integrity**: the H3 >1MPx corruption signature, dropouts, loudness.
   Verdict + one automatic retake with adjusted seed/prompt; second failure goes to your
   review queue with the evidence attached.
5. **Editor agent** — approved takes → scene timeline in script order, room-tone gaps,
   an ACE-Step cue per the episode's music slots, loudness-normalized export; hands you
   a cut to watch, never assembles over your head.

Ship this as a **crew playbook skill** (`.claude/skills/zoologic-produce/`): given
"produce S1E01 scene 3", it runs voice → board → render → QC in order, parallelizes
across shots where the single GPU allows (the job queue already serializes renders;
boarding/TTS/QC interleave), and stops at the two human gates: **boards approved before
rendering** (cheap to fix there) and **takes approved before the cut**. The QC checks
(the only new backend code in P2) land as `qc.*` procedures + a `qc_shot` tool, ~1
session of work since three of five checks exist as pilot scripts.

## P3 — Models that raise the ceiling (after the factory runs)

- **Cast identity LoRAs for LTX 2.5** — train per main character on sheet + approved-take
  frames. Attacks the residual identity drift and could eventually relax the
  board-every-shot rule for B-roll. Needs a trainer path; do it for 2–3 characters first
  and measure drift before committing to ten.
- **Foley/ambience pass for LTX dialogue shots** — LTX self-scores; a dedicated
  audio-from-video model (MMAudio-class) or an H3 ambience pass would give the interview
  lane the room tone H3 B-roll already gets. Evaluate before adopting.
- **Finishing chain** — approved cut → per-shot full-quality re-render (same seed/spec),
  upscale, optional 48fps interpolation, loudness master, 9:16 crop presets for Field
  Notes. Mostly wiring existing pieces into one `finish_episode` job.
- **Captions** — Whisper alignment for burned-in subtitles on the vertical cuts
  (Field Notes live on phones); timing comes free from the known line audio.

## Order & acceptance

1. **P0** (one session): enhance toggle + table read + stage field.
2. **P1 desk** (1–2 sessions): board + review drawer first; canon library second.
3. **P2** (1–2 sessions): `qc.*` procedures, then the crew playbook.
4. **Acceptance pilot**: produce **one Field Note** end-to-end by telling the crew to do
   it, then **scene 1 of "The Fund"** the same way. Count human interventions; the
   factory is working when an episode's manual decisions are the ~60 approve/retake
   verdicts and nothing else.
5. **P3** items individually, each behind its own measurement.

Not building: a new agent runtime (Claude Code + MCP is the runtime), a script editor
(Writers Room exists), per-episode fine-tunes, or any cloud dependency — the whole loop
stays on the 3090 Ti at $0 marginal cost.

## Acceptance pilot — run 2026-09-02 (Field Note 15, Silas)

**Verdict: the factory produces a finished Field Note, and it took 2 human decisions.**
Deliverable: `<dataRoot>/projects/zoo-logic/assets/video/field-note-15-let-the-mud-settle.mp4`
— 768×1344, 25.7s, four beats, Silas's Chatterbox voice lip-synced through LTX 2.3 ia2v,
loudness-normalised to −16 LUFS. Production nodes: episode `field-note-15-let-the-mud-settle`,
scene `int-the-loft-dusk`, shots `shot-9a8448` / `shot-9fa05c` / `shot-78b149` / `shot-a6c76b`.

Material: the bible's own worked example (§7.1, verse 15) so the run tested the pipeline
rather than new writing. Cost: 4 TTS + 6 boards + 9 renders ≈ 75 min wall clock, 2 human
verdicts (the two gates), 5 crew-automatic retakes.

### What worked first time

Table read (4/4 lines, `qc_scene_voices` pass, no flags, median F0 134 Hz), board continuity
across four separate generations (same sofa, same window, same sconce), no burned-in text
anywhere, `qc_shot`'s container/cuts/audio/articulation checks, and the desk verdict flow.

### The craft finding — i2v prompts must be motion-only

Every take on the composer's own prompt abandoned its board within half a second: Silas stood
up, the camera pulled back to a full-body wide, and the loft re-invented itself. The cause is
that `composeShotSpec` sends the location's whole `stylePrompt` plus a head-to-toe wardrobe
list — a description of a wide standing shot — which overrides the start frame. The bank
already states the rule being broken: *"In i2v the locked still already decided composition
and lighting — the video prompt's only job is motion."* Replacing the global prompt with a
motion-only paragraph fixed the drift outright **and** delivered the tight framing the boarder
could not produce. Past ~7s a motion-only prompt needs one short background-hold clause too,
or the set dissolves into grey limbo (FN15-3 failed exactly this way at 8s and held at 6s).

### Defects found (none previously known)

1. `camera.shotSize` never reaches the board — `composeKeyframePrompt`
   (`packages/shared/src/storyboard.ts:274`) appends the camera phrase after a ~90-word set
   block. Every board came back medium-wide regardless of `mcu`/`cu`, and a hand-written
   framing-led override didn't beat it either (the qwen-edit character ref is full-body).
2. The composed prompt self-contradicts: the set plate's `deep focus, no bokeh` sits in the
   same sentence as the lens clause's `shallow depth of field, bokeh`.
3. `resolution` precedence is broken both ways (`packages/core/src/shot-director.ts:186,219,256`
   vs `router.ts:913`) — the dry run reports the lane's canvas while the render applies the
   caller's, and because `shotRenderSchema.resolution` carries a *default*, a caller who omits
   it silently stamps `896 × 704 (landscape)` over a lane's canvas. The Field Note lane's own
   9:16 could never survive that path.
4. Re-boarding appends a keyframe but leaves `selectedKeyframe` on the rejected one.
5. Composition ids can contradict the shot size (`negative-space` expanded to "small figure in
   the corner of the frame" directly after `medium close-up`).
6. **`zoo-interview-single` cannot render at all** — it declares `engine: "ltx25"`, the
   single-shot composer emits a Director timeline *and* a camera LoRA, and the 2.5 adapter
   hard-errors on both (`packages/core/src/adapters/ltx25-video.ts:72,79`). The documentary
   spine has never worked. Ran the pilot on `engine: "ltx2"` instead.
7. `qc_shot`'s duration check compares the take against a re-composed default length, not the
   length actually requested — all four takes warned while being exactly the length asked for.
8. `retake_shot` appends its note to the prompt verbatim as `Direction: …`, so a note that
   *describes a failure* injects that failure's words into the next render. Notes must be
   written as instructions, never as diagnoses.
9. `retake_shot` doesn't make the new take `selectedTake` — so `qc_shot` re-measures the
   rejected take and `approve_shot` would **lock** it. Pass `takeId` explicitly until fixed.
10. `approve_shot` lays clips in approve order, so approving out of script order builds the
    cut in the wrong order, silently.
11. `timeline_export` has a fixed 16:9 canvas and no loudness pass — the vertical Field Note
    came out pillarboxed into 1280×720 at mean −28.3 dB. The shipped master was rebuilt with
    ffmpeg instead.
12. `zoo-field-note` (the lane named for this format) is unusable on this machine: it's built
    on MiniMax-H3, which `lab_catalog` reports `available: false`. It would also have discarded
    the Chatterbox cast voice and let H3 invent its own — the wrong trade for a format whose
    stated purpose is a casting test.

### Fix order suggested by the pilot

**Blockers before the next Field Note:** #6 (point the lane at `ltx2`, or teach the composer a
plain ia2v payload for singles), #9, #11, the motion-only prompt rule for i2v singles, #3.
**Then:** #1/#2/#5 (the board prompt), #10, #7, #8, #4.
**Not blocking:** #12 — until H3 is available, Field Notes shoot on the interview lane vertical.

### Still unmeasured after this run

Room coverage and B-roll lanes (only the interview lane was exercised), the look line, music
slots (a Field Note has none), the end card — nothing in the stack burns `FIELD NOTE 15` onto
the tail, so the format's signature card is still a manual step.

## Blocker fixes — 2026-09-02, after the pilot

Everything the pilot called a blocker is fixed, plus the two "with teeth" from the
second tier. 215 core tests green; new coverage in `packages/core/src/ia2v.test.ts`
and `packages/core/src/factory-blockers.test.ts`.

**#6 + the motion-only rule — the interview lane renders.** New composer
`composeIa2vShot` (`packages/shared/src/ia2v.ts`) and a fourth branch in
`composeShotFromBoard` for `engine: "ltx25"` singles. It emits a plain ia2v payload —
board as the start frame, one flattened voice bed as the audio, no Director timeline
and no camera LoRA, the two things the 2.5 adapter refuses. The prompt is MOTION ONLY:
the named-beat lip-sync wording, the camera move, accumulated desk direction, and past
7s one background-hold clause. The set, the wardrobe, the lens and the look are
deliberately absent — the start frame decided all four, and repeating them is what made
every pilot take abandon its board. The voice bed is `packages/core/src/voice-bed.ts`:
takes laid at their planned seconds into one file under `<dataRoot>/beds` (content-
addressed, reused, and skipped entirely for a single take starting at 0). The carried
`director` spec keeps the *placed lines* even though it is never rendered, because
`qc.shot` reads the speech windows off it to measure articulation.

The same fix removes a latent version of #6 on the coverage lane: multi-shot prose
promotes an `ltx2` lane to `ltx25`, and the camera LoRA used to ride along with it.

**#9 — a retake is what you judge.** `attachTake` now makes a delivered take the
selected one, so `qc_shot` measures the retake and `approve_shot` locks it. A shot
already `approved` keeps its picked take: that selection is a human's.

**#10 — the cut is in script order.** `TimelineStore.orderVideoTrack` re-lays the base
video track against a running order and re-butts the clips; `approveShot` calls it with
`studio.approvedTakeAssets(project)` (season → episode → scene → shot). Clips the
production doesn't own — a hand-placed cutaway — keep their relative position at the end.

**#11 — the master is delivered, not rebuilt.** `addClip` adopts the canvas from the
first video clip laid on an empty sequence, so a 768×1344 take stops being pillarboxed
into 1280×720. The export gains one loudness pass over the finished mix
(`loudnessLufs`, default −16 LUFS, `TP=-1.5`), applied after `amix` so per-clip levels
stay relative and skipped when nothing is audible.

**#3 — the lane's canvas survives.** `shotRenderSchema.resolution` lost its
`"896 × 704 (landscape)"` default and is optional; `renderShot` and `retakeShot` apply
the caller's canvas only when they named one. The dry run and the render now agree.

Still open, in the pilot's own order: #1/#2/#5 (the board prompt), #7 (the duration
check needs the length actually requested, which nothing records on the take yet), #8
(retake notes are still appended verbatim — the playbook now says write instructions,
not diagnoses), #4, and #12 (H3 unavailable).

Next acceptance step, unchanged: scene 1 of "The Fund" — the first run that exercises
the room-coverage and B-roll lanes.

**2026-09-02, later:** the "still open" list above (#1/#2/#5, #7, #8, #4) is closed by
`PRODUCTION-EXPERIENCE-PLAN.md` P1, and the craft rules the pilot made you remember are
now a table the composer runs (P2). Build log in that doc's §8.

### Verified on the GPU — 2026-09-02, same day

The fixes were smoke-tested against the pilot's own material, on a restarted app
(`staleBuild: false`).

**The interview lane rendered for the first time.** FN15-2 ("The crack"), the pilot's
boarded and voiced shot, recomposed on `zoo-interview-single` and rendered on LTX 2.5:
768×1344, 8s, **4m17s**, take `dbb181b0`. The dry run confirmed the shape the adapter
used to refuse — no `director`, no `cameraLora`, `audio: beds/bed-19fd441519b9.wav`.

`qc_shot`: container pass, cuts pass (single take), audio pass (mean −25.7 dB), and
**articulation pass at 1.84× the clip median** — which is the carried spec's audio lane
doing its job, since the bed is one file and the windows come from the placed lines.
The only warn is #7 (recomposed 6s vs the 8s actually asked for), which is the known
defect, not a failure of the take.

Vision pass on the contact sheet — the three things the pilot lost, all held:
- **the board holds.** He stays seated in the boarded framing for the whole take. This
  is the exact failure the motion-only rule was written against;
- **the move works as prose.** A clean monotonic push-in with the 2.3 camera LoRA
  dropped — the open question when 2.5 lanes stopped carrying one. It is *strong*: by
  the last third the shot is a CU, tighter than the lane's `mcu`. Shorten the shot or
  set `move: static` for a locked confessional;
- **the set survives 8s.** Window, brick, string lights and sconce all present in the
  last frame. No grey limbo, at the length that killed FN15-3.
On model throughout, no burned-in text.

**#9 confirmed on real data:** the shot was `approved`, and the new take did *not* steal
`selectedTake` — the shipped master is untouched.

**#11 verified end to end** on a scratch project: a 768×1344 take laid on an empty
sequence set the canvas to 768×1344 (no pillarbox in the export), and the mix went from
**−19.6 LUFS at source to −15.8 LUFS delivered** against the −16 target, true peak
−4.4 dBTP. Single-pass loudnorm lands within 0.2 LU; that is close enough for a draft
master and it removes the ffmpeg rebuild step entirely.

**One thing the fixes do not do retroactively.** `zoo-logic`'s existing timeline still
reads `1280 × 720`, and its clip array is the #10 bug frozen in place — `FN15-4` sits
ahead of `FN15-3` (the cut played correctly only because the export sorts by `start`).
The canvas is only adopted on an empty sequence and the order is only re-laid on the
next approval, both deliberately: an existing canvas is a human's choice. Approve
anything in that episode again, or reset the canvas by hand, and it corrects itself.
