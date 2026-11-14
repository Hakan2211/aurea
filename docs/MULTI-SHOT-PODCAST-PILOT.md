# Multi-shot podcast pilot — LTX 2.5 cuts inside one generation (2026-08-31)

The Phase 3.1 experiment from `VIDEO-SPEED-RELIABILITY-2026-08-31.md`: can LTX 2.5 be
made to **cut** inside a single render by writing the prompt as multi-shot prose, so one
boarded keyframe + one prompt yields real coverage (wide → single → reaction) with held
identities and continuous audio?

**Yes — decisively, and for free.** No new nodes, no new weights, no graph change. But
the shipping product path silently destroys it (§4), which is the thing to fix.

Scripts: `aurea/scripts/podcast/` (`01-board.mts`, `02-render.mts`, `03-judge.mts`,
`voice_check.py`). Takes and contact sheets: `scripts/podcast/out/`.

---

## 1. Method

One board, one prompt, one 8s generation per arm — everything else held constant
(seed 7, 1280×704, 24 fps, LTX 2.5 draft, same negative, no voice take, no refs).

**Board** — GPT-Image-2 plate of an empty recording booth → qwen-edit staging of
Sterling and Milo from their bible keyframeRefs (the debate recipe, 3 refs max).
Identity has to be nailed at t=0, or "it cut" and "the lion changed" look the same.

**Prompt** — one chronological prose paragraph following the LTX/Runware multi-shot
rules: transitions named in prose ("A hard cut transitions to…"), framing re-established
at each cut (scale, angle, who is in frame, lighting), the same visual tag for each
character at every mention, audio continuity stated. Two quoted lines of dialogue.

**Judging** — nothing by eye alone:
- cuts: ffmpeg scene scores (`03-judge.mts`); a hard cut lands ≈0.43, a handheld settle
  stays under 0.1
- dialogue: faster-whisper large-v3 transcript with timings
- voices: median f0 per shot over voiced frames (`voice_check.py`) — same speaker across
  a cut lands within a few Hz, a different speaker moves tens of Hz

## 2. Results

| arm | prompt | enhancer | cuts (score) | dialogue | render |
|---|---|---|---|---|---|
| **multi3** (draft) | 3-shot prose | off | **2** — 2.54s (0.43), 4.58s (0.43) | both lines, verbatim | 141s |
| **multi3 (full)** | 3-shot prose | off | **2** — 2.54s (0.43), 4.58s (0.44) | both lines, verbatim | 197s |
| single | same scene, one continuous take | off | **0** | both lines, verbatim | 141s |
| multi3-enh | 3-shot prose | **on** | **0** (slow dissolve ≈3s) | **Sterling only**; Milo's line gone | 220s |

The full-quality pass (base + ×2 upscale + refine, 1280×704) reproduces the draft's
structure exactly — same two cuts to the frame, same two lines, same voice split
(104 Hz → 108 Hz across cut 1, 175 Hz in shot 3). Draft is a truthful preview of the
edit here, which makes the 141s rung the right one for iterating a scene.

### The winning take, shot by shot
1. **0.00–2.54s** — wide two-shot across the table, as boarded.
2. **2.54–4.58s** — tight single of Sterling, low ¾, mic large in foreground.
3. **4.58–8.02s** — matching single of Milo, opposite ¾ angle.

Frames straddling both cuts (`*.cuts.jpg`) show identity holding: Sterling keeps blazer,
waistcoat and bow tie; Milo keeps beanie, striped sweater and pack straps.

### Audio is the strongest part of the result
- Sterling's line runs **0.00–4.10s** — it plays straight **through** the cut at 2.54s.
  One sentence, two shots. That is the audio-continuity claim, measured.
- Milo's reply starts at **4.56s**, effectively on the 4.58s cut: the model cut to the
  new speaker's single as the new speaker began.
- f0 per shot: **117 Hz → 125 Hz** across cut 1 (Sterling, same voice), **163 Hz** in
  shot 3 (Milo, a different voice). The voices held across the cuts.

### What the control proves
The single-take arm delivers the *same two lines in the same two voices* — it just never
cuts. So the prose structure doesn't buy the performance; it buys the **coverage**. Cuts
are a prompt-level control, not a lucky seed.

## 3. Rules that earned their place

Carry these into any multi-shot prompt (they are the generalisation of the named-beat
lipsync rule already in the notes):

1. One chronological paragraph. Never a shot list, never sluglines.
2. Name the transition in prose: "A hard cut transitions to…".
3. Re-establish scale, angle, who is in frame and lighting at every cut.
4. Tag each character identically at every mention ("Sterling, the golden-maned lion in
   the royal-blue velvet blazer") — a pronoun after a cut is a new character.
5. State audio continuity across the cut.
6. 2–4 shots per generation; ~2.5s per shot at 8s is where this landed.
7. Start from a board with the whole cast staged and on-model.

## 4. The finding that needs a fix: the enhancer eats the structure

`ltx25-video.ts:193` switches the Gemma 4 E2B enhancer on whenever those weights are
present — and they are (linked from `D:\models`). So **every** LTX 2.5 render from the
lab today has its prompt rewritten before it reaches the encoder.

On a short prompt that is a gain. On a hand-authored multi-shot paragraph it is a
regression, measured above: same seed, same board, the cuts became a dissolve, the third
shot never happened, and a whole character's line disappeared. It also cost 79s of extra
render time (220s vs 141s).

**Recommendation** (not implemented — this was a judgement pilot):
- add `enhance` to the video payload, default true, and thread it to
  `enhanceClipName` in the adapter;
- have the multi-shot path set it false — a prompt written to a structure must not be
  rewritten;
- a cheap heuristic in the meantime: skip enhancement above ~150 words, since the
  enhancer exists to expand *short* prompts.

## 5. What this unlocks for Zoo Logic

A podcast/two-hander scene no longer needs one render per shot plus an edit. One board
plus one paragraph gives wide → single → reaction with matched voices, at draft cost
(141s for 8s). The pieces to build on it, in order:

1. `enhance` toggle (§4) — nothing else is safe until a prompt survives to the encoder.
2. A `multiShot` formatter in shotSpec/Director prompt assembly: take the beats we
   already have (who speaks, what they say, what everyone else does) and emit the prose
   paragraph in §3's shape rather than a zone list.
3. Then test the combination the plan predicted: multi-shot prose **plus** ia2v, so
   measured voice takes drive a shot that also cuts. Nothing here contradicts it — the
   take is already lip-syncing to its own invented audio — but it is untested.
4. Open questions worth one render each: does a 4th shot hold? does the cut land on a
   named time ("three seconds in")? does 2-shot prose reliably give exactly one cut?
