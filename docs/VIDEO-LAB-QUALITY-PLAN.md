# Video Lab quality plan — making generation better (2026-09-03)

Scope: the *output* of the Video lab (look, blocking, identity, sharpness, audio), not speed.
Every item below is anchored to a measured defect from the build logs, so the order is
"biggest visible defect per day of work", not novelty. Nothing here is implemented yet.

## 0. What the measurements say is wrong today

| defect | evidence | plan item |
|---|---|---|
| LTX 2.5 is soft at full quality (fur, mane) | 2.3-vs-2.5 head-to-head case F, 2026-09-02 | Q1 |
| Approved draft ≠ delivered full: full re-samples from scratch, blocking changes | draft = base pass only (`ltx25-graph.ts:88-90`, `:353`); full runs both passes fresh | Q2 |
| Cast goes off-model (Sterling loses the mane, t2v "neither on-model") | case C; 12 acceptance-pilot defects; identity check is still G8 | Q3, Q6 |
| Enhancer helps single takes, destroys multi-shot; today it is a manual toggle | cases A + multi-shot pilot | Q4 |
| Prompt wording flips blocking ("shifts in his chair" → leaves the chair) | cases A/F/G, both engines | Q4 |
| 2.5 ships digital silence on no-dialogue shots | -91 dB on every "Nobody speaks" take | Q5 |
| Best take is chosen by eye; seed spray exists but nothing ranks it | freeform F3 seed spray; QC has no identity/text checks | Q6 |
| H3 has no camera control; LTX camera LoRA is 2.3-only | G3; case H | Q7 |

## Q1 — Hero finish: LTX-2.5 Pixel Spatial Upscaler IC-LoRA (≈1 day)

The single biggest sharpness win, and the plan already ADOPTed it (upgrade plan §5.3, V4.3).
`Lightricks/LTX-2.5-22b-IC-LoRA-Pixel-Spatial-Upscaler`, x2, strength 1.0.

- Registry entry `ltx-25-spatial-upscaler-ic` under `loras/`, named to match `INFRA_LORA` so it stays out of user slots.
- Third `IcLoraKind = "upscale"` in `capabilities.ts`; a `finishGraph` in `ltx25-graph.ts` that takes an approved take's frames as the IC reference, low guidance, same seed.
- Surface: a **Finish** button on a Desk-approved take and a `finish_shot` crew verb. Never on the draft loop.
- Acceptance: same take, full ladder vs draft+finish, judged on mane/fur edge sharpness and time. Expect draft+finish to beat 2.3 full on both.

## Q2 — "What you approved is what you get": reuse the draft latent (≈0.5 day)

Draft stops after the base pass and decodes it; full re-runs the base pass. With the same seed the
base latent *should* match, but any tiling/offload difference or a seed collision breaks that,
and the operator cannot tell until the full render is done.

- Save the base-pass latent (`SaveLatent`) next to the draft MP4, keyed by job id.
- `fast=false` on a job that has a sibling draft loads that latent and runs the refine pass only.
- Payoff: full render drops to the refine cost alone (≈40% of the full ladder) AND blocking is
  guaranteed identical to the approved draft. Combine with Q1: draft → refine → finish is one
  cheap, deterministic promotion path.
- Guard: latent shape must match (w/h/frames/fps); on mismatch fall back to a fresh full render and say so in the job log.

## Q3 — Identity: per-character LoRAs for the ten-cast (≈2 days, GPU-heavy)

Cast refs through the Ingredients IC-LoRA animate the sheet and burn broadcast text (two
memories say so), and the board can only carry identity for the first frame. For a fixed cast of
ten a **character LoRA per animal** is the standard answer and 2.3 LoRAs load on 2.5 unchanged.

- Training data exists: the 9-frame char sheets + coverage sheets + every Desk-approved take (frames sampled by QC).
- Train with `ltx-trainer` (Lightricks' own repo) at low rank (16–32) per character, trigger = the canon name already used by the named-beat wording.
- Wire into the existing LoRA slots as an "infra" cast LoRA selected automatically from `cast[]` in the shot (max 2 stacked; multi-cast room shots keep the board for the rest).
- Measure with Q6's identity score before/after; ship only characters that beat the board-only baseline (the style-LoRA lesson: only 2 of 5 beat prose).

## Q4 — Prompt intelligence in the composer (≈1 day, no GPU)

Cheap and already measured:

1. **Enhancer auto-mode**: `enhance` defaults to `!isMultiShotProse(prompt)` instead of a manual toggle; the toggle becomes an override.
2. **Blocking guard clauses**: port the joeygambino PROMPTING.md rules into `composeFreeform`/lanes — verbatim character + room description in every shot, ~2 s airlock at each open, a settled hold at the end, dialogue never straddles a cut, line budgets (10 s ≈ 15 words).
3. **Anti-patterns list**: a small table of phrasings that measurably misfire ("shifts in his chair", "leans toward his microphone") rewritten to the safe form ("stays seated", "turns his head toward…"). Lint the prompt in the UI, don't silently rewrite.
4. **Room-tone clause** for 2.5 no-dialogue shots (see Q5).

## Q5 — Audio floor (≈0.5 day)

2.5 obeys "Nobody speaks" with -91 dB silence. Two paths, do both:
- Composer adds "quiet room tone, [set-specific ambience]" to any 2.5 shot with no dialogue (unverified — A/B it once).
- Desk export lays a per-set ambience bed (ACE-Step or a stock file) under any take whose QC mean level is below -60 dB, so a silent take never reaches the cut.

## Q6 — Automated best-of-N (≈1.5 days)

Seed spray already renders N drafts; nothing ranks them. Build the ranking the upgrade plan
calls G8 and use it to pick:
- **Identity drift**: DINOv2/CLIP cosine between the cast-sheet crop and 6 sampled frames (CPU lane).
- **Burned-in text**: rapidocr on the same frames; any box >2% of frame → review.
- Existing: articulation score for dialogue shots, motion-magnitude for camera moves.
- Composite score → the lane auto-selects the best draft and marks the rest as alternates; the Desk shows why. Pairs with Q2: the winner promotes to full without re-sampling.

## Q7 — Camera (≈1 day incl. renders)

- H3: run queued experiment 3 (Jojocodex camera-motion LoRA, 0.8 / 1.0, stacked with turbo). Push-in/pull-back/handheld first; pan is known weakest.
- LTX 2.5: the camera LoRA refusal is by design, but case H shows 2.5 prose gives x1.26. Add the bank's move verbs to the 2.5 composer with the measured strengths so the lane knows which moves are "prose-only OK" and which need 2.3 + LoRA.

## Q8 — Smaller bets (queue through the A/B panel, one evening)

- Refine-pass sampler pair: ancestral base + cfg++ refine (the graph already leaves the hook at `ltx25-graph.ts:383`); REFINE_SIGMAS variants.
- DFR temporal x2 upsample (RuneXX) for smoother motion on 24 fps hero takes.
- Krea2-H3 style LoRA for wordless B-roll so t2v inserts sit with the boarded shots.
- H3 latent upscaler (experiment 4) for the 2K tier.

## Order

Q1 → Q2 → Q4 → Q6 → Q5 → Q7 → Q3 → Q8. Q1+Q2+Q4 are three days and remove the three
defects an audience actually sees (soft, off-blocking, mis-worded). Q3 is the biggest payoff but
the biggest bet, so it waits for Q6's score to judge it.

---

## Build log

### 2026-09-03 — Q1 (×2 finish) + Q2 (refine from draft) BUILT and render-verified

**What shipped** (326 core tests green, desktop tsc clean, not committed):

- `videoPayloadSchema.finish` `{ source, mode: refine|upscale, strength }`; `AssetMeta.draftLatents` (kept base-pass latents + the draft's own request) and `AssetMeta.finish`.
- `ltx25-graph.ts`: `keepLatents` (two `SaveLatent`s on the pre-crop AV halves), `refineFrom` (two `LoadLatent`s replace the base pass; a voice take's noise-mask lock is re-pinned; guides rebuilt and cropped against the loaded latent), and `ltx25UpscaleGraph` — the Pixel Spatial Upscaler on **ComfyUI 0.32 core nodes** (`LoraLoaderModelOnly` → `GetICLoRAParameters` → `LTXVAddGuide.iclora_parameters`; no Lightricks pack needed), plain euler on the base ladder, `upscaleSigmas(strength)` for partial denoise, `upscaleCanvas` = ×2 on the 64 grid fitted to a 1920×1088 cap.
- `ltx25-video.ts`: every non-preview 2.5 draft keeps its latents; `finish.refine` re-parses the draft's request off the sidecar; `finish.upscale` ffprobes the source, trims off-grid frame counts (H3's 107 → 105) and locks the source audio.
- `projects.ts` moves the latents to `assets/video/.latents/<take>-{video,audio}.latent`; `library.ts` deletes them with the take.
- Registry `ltx-25-spatial-upscaler-ic` (327 MB, downloaded with the local HF token, sha recorded); `capabilities.finishUpscale`.
- Surface: `labs.video.finish` procedure, `finish_take` crew verb + MCP tool (parity test passes), Desk drawer "Full from draft" / "Finish ×2", Video-lab take menu "Full render from draft" / "Finish ×2 (upscaler)".

**Measured** (playground, the red-fox t2v draft 640×352 → 1280×704, 5 s, enhancer on, warm engine):

| pass | wall | result |
|---|---|---|
| draft (base only) | 2m41s | 640×352, latents kept (1.8 MB + 69 KB) |
| finish refine | 3m06s | 1280×704, **bit-identical (SSIM 1.000) to a fresh full render at the draft's seed** |
| fresh full render, same seed | 3m07s | baseline |
| finish ×2 upscale | 2m59s | 1280×704, Laplacian sharpness 36.4 vs 18.4 at frame 60 (×2), 72.5 vs 35.0 at frame 96; SSIM vs the draft 0.73–0.81 (it reinvents, framing drifts a little); AAC stereo carried |

**Findings**

- **Q2 buys certainty, not time.** The base pass is ~25 s of a ~190 s render; the rest is fixed per job (Gemma 12B int8 text encode, the E2B enhancer re-run, VAE decode at full size, weight staging). Refine-from-latents and a same-seed full render land on the same file to the bit. Keep it as the one-click promotion path (no inputs to re-supply), and drop the "~40%" claim — done in the copy.
- **The real speed lever is the fixed cost**, not sampling: the enhancer re-runs on the refine (its output is a string no core node saves), the encoders re-stage every job. Next candidates: keep the text encoders resident across consecutive 2.5 jobs, cache the enhanced prompt text in the sidecar, skip enhance on a refine (would need the cached text to keep cond identical).
- **Q1 works on core nodes and is the sharpness answer** the 2.3-vs-2.5 head-to-head asked for. At strength 1 it re-blocks slightly; try 0.7–0.85 on a keeper before judging the framing.
- The upscale of a 1280×704 full take fits the cap at 1920×1024 (×1.5); verify that shape's VRAM before relying on it.
- Gotcha: running `vite --port 5188` for a Chrome check rebuilds `dist-electron/` and lights the "Update ready — restart Aurea" pill on the running app even though the source is unchanged.
