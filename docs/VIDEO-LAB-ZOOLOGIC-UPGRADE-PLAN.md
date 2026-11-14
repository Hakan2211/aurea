# Video Lab upgrade plan for Zoo Logic — styles, director's edit, speed, reliability

Date: 2026-09-02. Status: **V4.1, V1 and V2 BUILT (2026-09-02) — see §9 for what shipped.**
V3, V4.2-V4.5 and V5 are still plan.
Scope: Aurea Video Lab (`apps/desktop/src/screens/video`, `packages/core/src/adapters/*`, `packages/shared/src/shotSpec.ts`) as used by the Zoo Logic factory (`docs/ZOOLOGIC-EPISODE-FACTORY.md`).
Hardware assumption: one RTX 3090 Ti (24 GB, Ampere). Every model recommendation below was checked against that card.

Related docs: `VIDEO-SPEED-RELIABILITY-2026-08-31.md` (§2.3 A/B queue is still open), `MULTI-SHOT-PODCAST-PILOT.md`, `H3-SPEED-AND-LONG-FORM.md`, `AUREA-NEXT-PLAN.md` (N1.4, N2.2, N2.4).

---

## 0. Where we are (audit summary)

What already exists and works:

- Four engines behind one `videoPayloadSchema` (`ltx2`, `ltx25`, `minimax-h3`, `seedance`), per-engine UI gating via `engineSurface.ts`.
- Cinematography vocabulary is already enumerated in `packages/shared/src/cinematographyBank.ts` (7 shot sizes, 6 angles, 16 moves, 7 lenses, 10 compositions, 5 lighting packs incl. `sitcom`) and expanded to prose by `storyboard.ts` (`cineClause`, `composeKeyframePrompt`).
- `shotSpec.ts` turns a boarded shot into a `DirectorSpec` with the measured named-beat lip-sync wording.
- H3 speed levers are in: SageAttention on, w4a8 weights, LightX2V 4/8-step distills as Draft/Standard tiers, draft canvas guard, VRAM eviction before every render, one automatic infrastructure retry.
- LTX 2.5 multi-shot prose is proven (`MULTI-SHOT-PODCAST-PILOT.md`) but only *detected* (`isMultiShotProse`), never *composed*.
- Production Desk (`/desk`) with approve / retake-with-note, canon library, ffmpeg QC.

The concrete gaps this plan closes:

| # | Gap | Evidence |
|---|-----|----------|
| G1 | No styles / presets / project "look" in the Video lab. `promptlib` is wired into the Image lab only (zero references under `screens/video/`). | `packages/core/src/promptlib.ts`, N2.4 in `AUREA-NEXT-PLAN.md` |
| G2 | No director's shot picker in the Video lab. The bank exists but the lab exposes only a free prompt plus the LTX camera-LoRA row, which is *hidden* unless the 19b files are installed. | `engineSurface.ts:215-216`, N2.2 |
| G3 | H3 has no camera control at all: the adapter rejects `cameraLora` and nothing composes H3's `Timeline: / Camera: / Audio:` blocks; the rules live only as text. | `minimax-video.ts:338-353`, `labs.ts:850-862` |
| G4 | Multi-shot prose is hand-written by the crew agent each time; no composer, no rules enforcement. | `VIDEO-SPEED-RELIABILITY-2026-08-31.md:155-158` |
| G5 | H3 Standard tier for ref2v runs the 4-step v0.1 LoRA at 8 steps — not any publisher's recipe. | `minimax-graphs.ts:366-401` |
| G6 | No A/B render queue and no batch/overnight mode; ETA is a linear tick projection and the Desk uses a flat 3.5 min/shot. | `jobs.ts:400`, `desk/shared.ts` |
| G7 | LTX 2.3/2.5 timeouts are a flat 45 min while H3 derives its own. | `ltx25-video.ts:218` |
| G8 | QC has no identity-drift or burned-in-text check; the crew agent must look at contact sheets by eye. | `qc.ts:442`, SKILL.md §4.2 |

---

## 1. Hugging Face triage

Everything you linked, plus what turned up around it. Verdict scale: **ADOPT** (plan work below), **A/B** (download, run through the A/B queue, decide on evidence), **MINE** (don't run it, take its ideas), **SKIP**.

### 1.1 Your links

| Repo | What it actually is | Verdict | Why |
|------|---------------------|---------|-----|
| `javawock7618/comfy-MiniMax-H3-workflows` | Five INT8 ComfyUI workflows: I2V (fl2va), R2V (ref2va, rank-256 ref LoRA), **Bridge** (generates a transition clip between two existing clips), **Face Refine** (second pass on faces), TTS-only. Plus two LLM *system prompts* that define the exact prompt shape H3 was trained to read. | **MINE** + one **ADOPT** | We already run fl2va/ref2va natively with w4a8 (better fit than INT8 on 24 GB). Take: (a) the fl2va system-prompt structure (`subject_definitions / summary / detailed_description / overall_soundscape / non_diegetic_music`, `<d>…</d>` dialogue tags, `[10-15s]` interval stamps) as the spec for the H3 prompt composer in §3; (b) the tip "if audio breaks, lower `shift_audio` 4→3" (we already run 3 in both tiers — keep); (c) **Bridge** is worth adopting as a `bridge_takes` tool for stitching two approved takes with a generated 1–2 s join (see §5.4). Face Refine is for photoreal humans; the cast is stylized animals — skip. |
| `ethanfel/H3_Cinematic_Multishot_Coverage` | Not a LoRA. A workflow that makes H3 produce **8 camera angles of one still in a single 124-frame pass** (0°, 45°, 90°, 135°, 180°, 225°, 270°, 315°), then pulls one stable frame per shot into a 4×2 contact sheet. Needs only the official ref2va weights we already have. | **ADOPT** | This is the missing "coverage sheet" for the canon library: one approved keyframe → eight on-model angles of the same room and cast, for free. Feeds §4 (Coverage pass). Cost ≈ one 5 s draft render. |
| `lightx2v/Minimax-h3-Turbo` | The distill LoRAs we already run. Repo now holds fl2v 4-step v0.1/v1.0/v1.1, fl2v 8-step v1.0, ref2v 4-step v0.1 (still no ref2v 8-step). | Already installed | Nothing new for fl2v. The ref2v gap (G5) is closed by the Alibaba Acc LoRA below, not by this repo. Watch for a ref2v v1.x. |
| `RuneXX/Minimax-H3-Workflows` | Two workflows: "Music-Video Multi-Scene Shot-by-Shot" and "V2V Extend Any Video Latent Masking". | **MINE** | Shot-by-shot music video = the same multi-shot idea as §3.3, nothing we lack. V2V latent-mask extend overlaps `shot_retake` window inpaint. No download needed. |
| `RuneXX/LTX-2.5-Workflows` | Two reference pipelines: Distilled (fast) and DFR (detail-fidelity + optional 2×/4× temporal upsample). README confirms LTX 2.3 LoRAs run on 2.5 unchanged. | **MINE** | Our `ltx25-graph.ts` already mirrors the official two-stage ladder. Take the DFR idea as the "hero finish" tier in §5.3 via Lightricks' own IC-LoRA (next table). |

### 1.2 Found while checking those (recommended)

| Repo | What | Verdict | Notes for this card |
|------|------|---------|---------------------|
| `Jojocodex/minimax-h3-Camera-Motion-lora` | Camera-motion LoRA for H3 (two pruned files, ~1000 and ~3000 step versions). Trigger word **`camera motion`** must open the prompt; moves: push-in, pull-back, orbit, handheld tracking, crane, pan, tilt, macro, aerial. Strength 0.8 gentle → 1.0 pronounced, >1.2 unstable. Author rates push-in / pull-back / handheld most stable, **pan weakest**. Apache-2.0. | **ADOPT** | Closes G3 for H3. Trained on the pruned-int8-convrot base; same architecture as our GGUF / w4a8 weights, so the LoRA keys should load — verify with the combo-list check the way the turbo LoRAs are validated (`minimax-video.ts:119`). Stack with the turbo distill at Draft; if quality drops, run it at Standard only. |
| `alibaba-pai/MiniMax-H3-Acc-LoRAs` | **8-step** acceleration LoRAs (Parallel Decoding Distillation) for **both** FL2VA and **Ref2VA**, rank 64, BF16, weight 1.0. | **ADOPT → A/B** | Gives the ref2v head a real 8-step recipe (G5). Ships in diffusers/PEFT key layout; may need Kijai-style key conversion for ComfyUI (`Kijai/MiniMax-H3_comfy/loras` should be checked first for a converted copy). This is A/B experiment #2 in the speed doc, now with a concrete file. |
| `lightx2v/Minimax-h3-Turbo-SLA` | 4-step fl2v distill trained with 85% sparse attention; 2.5× on an RTX 5090 with the `sage2` operator. Already downloaded as `minimax-h3-sla-lora`, deliberately unwired. | **A/B (low)** | Sparsity needs the SageAttention-2 dynamic-sparse kernel; Ampere support is unconfirmed. One experiment through the A/B queue; if it falls back to dense attention it is just another 4-step LoRA and we keep v1.1. |
| `tutututututu/Tutu-MiniMax-H3-AudioVideo-20to8-NFE-LoRA` | 20→8 NFE distill that claims to keep stereo audio and lip-sync. | **A/B** | Lip-sync retention matters more for Zoo Logic interview singles than raw speed. Candidate for the Standard tier vs LightX2V 8-step v1.0. |
| `Lightricks/LTX-2.5-22b-IC-LoRA-Pixel-Spatial-Upscaler` | Official 2× generative upscaler IC-LoRA: draft at very low res (~280p) → 2× with synthesized detail. Strength 1.0. | **ADOPT (P3 finish)** | This is the "hero finish" path for approved shots (§5.3): render Draft cheap, upscale once at the end. Replaces the flat `fast=false` 2× refine on the hero pass. |
| `joeygambino/MiniMax-H3-Multishot-Workflow` | Node pack `ComfyUI-H3-Multishot`: chains shots into one master video + one master audio, `first_frame` or `context_pin` (last 22 frames re-injected as latents) continuity, 40 ms audio weld, per-subject voice anchors. Defaults 736×1280 · 192 frames · 14 steps. Needs ComfyUI **0.34**; we pin 0.32. | **MINE now, A/B later** | The PROMPTING.md rules are the best written multi-shot spec I found and are engine-agnostic: **verbatim character + room descriptions in every shot; ~2 s "airlock" at each shot open; land settled with ~2 s hold; dialogue never straddles shots; line budgets (10 s shot ≈ 15 words, 15 s ≈ 27 words, a 5 s shot cannot hold a line plus airlock); every shot changes the world irreversibly.** Port these into the composer (§3.3). The node pack itself is a later experiment after a COMFY_PIN bump. |
| `LBH-123-AI/Minimax_h3_latent_Upscaler` | Latent-space spatial upscaler for H3 (~80k paired samples). Generate low-res, upscale latents before decode. | **A/B** | Potential Final-tier speedup: 1344×768 draft → 2K latent upscale instead of a native 2K render (currently the slowest legal shape). Custom node required — check it against 0.32 first. |
| `TenStrip/Krea2-H3-Style-Lora` | Brings the Krea 2 look to H3 t2v. | **A/B (style)** | Zoo Logic cast sheets are Krea2→Qwen-edit; a matching look LoRA might make wordless B-roll inserts (t2v, no board) sit closer to the boarded shots. Experiment only. |

### 1.3 Skip, with reasons

- `fal/MiniMax-H3-Realism-People-LoRA` — human skin/face realism; the cast are stylized animals.
- `mvp-lab/MiniMax-H3-RAVEN-Streaming-LoRA` — undertrained preview, "texture details remain limited"; not production-ready.
- `lightx2v/MiniMax-H3-Prompt-Rewriter-LoRA-8B` — we learned on LTX that an enhancer rewrites away cut structure; we compose prompts ourselves.
- `Abiray/MiniMax-H3-Turbo-Lora-Pruned-ComfyUI`, `joyfox/MiniMax-H3-Turbo` — repacks of the LightX2V files we already have. One useful line from Abiray: "reduce steps by raising LoRA strength" is exactly the Draft 1.3-vs-1.2 experiment already on the list.
- `Lightricks/LTX-2-19b-IC-LoRA-Detailer` — 19b-era detailer; the 2.5 spatial upscaler supersedes it for our purpose.
- Anime / 1930s / wushu / physics LoRAs — off-style or off-brief.

---

## 2. Phase V1 — Styles and lane presets (closes G1)

Goal: a Zoo Logic shot is one click away from the right engine, size, duration, tier, enhancer state, lens and lighting. Today the crew agent re-types all of that per shot.

### 2.1 Video presets (new schema)

`packages/shared/src/index.ts` — add `videoPresetSchema`:

```
{ id, label, description, lane: "interview" | "coverage" | "broll" | "fieldnote" | "custom",
  payload: Partial<VideoPayload>          // engine, resolution, durationSec, fps, fast, enhance, minimaxTier, loras, cameraLora
  cine:   { shotSize?, angle?, move?, lens?, lighting? }   // bank ids, expanded by cineClause at compose time
  look:   string | null                    // free "look line" appended once (see 2.2)
  rules:  { multiShot?: boolean, namedBeats?: boolean, verbatimSubjects?: boolean } }
```

Stored under `<dataRoot>/promptlib/video-presets/*.json` beside the existing packs (`promptlib.ts` already has the loader shape). Four shipped Zoo Logic presets, matching the lanes in the crew skill:

| Preset | Engine | Shape | Tier / flags | Cine defaults |
|--------|--------|-------|--------------|---------------|
| Interview single | `ltx25` | 1280×720 · 6–10 s · 24 fps | `enhance:false`, named beats | `mcu`, `eye`, `static`, `shallow`, `sitcom/three-point` |
| Room coverage | `ltx25` | 1280×720 · 10–15 s | `enhance:false`, `multiShot:true` | `ws → mcu → cu` pattern, `sitcom/warm-home` |
| B-roll insert | `minimax-h3` | 1344×768 · 4–6 s | `minimaxTier:"draft"`, Camera Motion LoRA 0.9 | `ms`, `handheld` or `push-in` |
| Field Note (vertical) | `minimax-h3` | 768×1344 · 5 s | `draft` | `mcu`, `static` |

### 2.2 Project look line (N2.4)

One line per project, stored on the bible (`bible.style.lookLine`), defaulting to a compression of `artDirection`. Injected **once** at the end of the prompt by `composeShotSpec` and the H3 composer — never by the adapters, so it can't stack (same rule as `storyboard.ts:152-158`).

### 2.3 Video lab UI

- Preset rail at the top of `ParamsPanel.tsx` (reuse `PromptLibraryRail.tsx` from the Image lab).
- Applying a preset writes the payload fields and marks them "from preset"; editing any field detaches with a small "customised" chip.
- The Desk's retake drawer shows which preset the take used and lets a retake switch preset.

Files: `shared/index.ts`, `core/promptlib.ts`, `core/router.ts` (`promptlib.videoPresets.*`), `screens/video/ParamsPanel.tsx`, `screens/video/presetState.ts` (new).

Verify: dry-run `shot_from_storyboard` with each preset; assert payload + prompt tail in a new `video-presets.test.ts`; one real render per lane.

---

## 3. Phase V2 — Director's edit: shots, angles, moves (closes G2, G3, G4)

### 3.1 Shot picker in the Video lab

A "Shot" row above the prompt: shot size · angle · move · lens · lighting chips, all from `CINEMATOGRAPHY_BANK`. Selecting writes `payload.cine` (new optional field, same shape as the preset `cine`). The prompt textarea shows the expanded clause greyed in so the user sees what is added. Storyboard shots that already carry `camera` are pre-filled.

### 3.2 Camera control per engine

| Engine | Mechanism | Change |
|--------|-----------|--------|
| `ltx25` / `ltx2` | Existing 7 Lightricks camera LoRAs (`capabilities.ts:81-109`) | Unhide the section (N2.2); extend `cameraMoveToLora` so `tracking`, `orbit`, `handheld` map to prose-only with a visible "prose" badge. |
| `minimax-h3` | **Jojocodex Camera Motion LoRA** (new) | New `MINIMAX_CAMERA_LORA` in `minimax-graphs.ts`, second `LoraLoaderModelOnly` after the turbo LoRA; adapter accepts `cameraLora` for H3, prepends `camera motion, ` and the move phrase, clamps strength 0.6–1.1. Board moves → LoRA vocab: push-in, pull-back, orbit, handheld tracking, crane-up/down, pan (flag pan as weak). |
| `seedance` | prose only | unchanged |

### 3.3 Prompt composers (the real work)

Today only LTX named-beat composition exists. Add two:

**a) H3 composer** — `packages/shared/src/h3Prompt.ts`: from a `DirectorSpec`-shaped input produce the block form H3 was trained on (from the javawock system prompt): subject definitions (verbatim identity anchors), a one-line summary, interval-stamped detailed description `[0-2s] …`, dialogue wrapped as `<d>…</d>` with the speaker named, soundscape, music `N/A`. Replaces the free-text rules in `labs.ts:850-862`; the adapter error messages stay as a last line of defence.

**b) Multi-shot composer** — `composeShotSpec({ multiShot: true })`: turns beats into cut prose using the pilot's 6 rules plus the five joeygambino rules (verbatim subject + room in every shot, 2 s airlock, land settled, no line straddles a cut, irreversible progression). Emits a warning list (`lineBudget`, `cutTooEarly`) the Desk shows before render. Forces `enhance:false` on LTX 2.5.

Verify: extend `shot-spec.test.ts` and add `h3-prompt.test.ts`; re-run the podcast pilot scene through the composer and confirm the same two measured cuts (`qc.shot` `cuts` check).

---

## 4. Phase V3 — Coverage pass (new capability)

Port the ethanfel workflow as a core graph builder, `comfy/minimax-coverage-graph.ts`, exposed as `studio.canon.coverage` and MCP `coverage_pass`:

1. Input: one approved keyframe (or set plate) + a one-line coverage target ("the lion at the desk; keep this exact lion…").
2. One ref2va Draft render, 124 frames, fixed 8-angle prompt block.
3. Extract the eight stable frames at the documented offsets (2, 15, 31, 46, 62, 77, 92, 108), save each as a `shotKeyframe` candidate tagged with its angle, build the 4×2 sheet.
4. Canon library (`desk/canon.tsx`) gets an "Angles" tab per location; boarding a new shot can pick an angle instead of regenerating a keyframe.

Why this matters for Zoo Logic: the room-coverage lane needs a wide, a single and a reaction of the *same* room; today each is a fresh keyframe generation with drift risk. This makes them one render.

Verify: run on the Lounge canon plate; QC contact sheet by eye for identity + geometry; cost ≤ one Draft render.

---

## 5. Phase V4 — Speed (closes G5, G7; builds the A/B queue from G6)

### 5.1 A/B queue first (prerequisite for every experiment below)

Implement §2.3 of `VIDEO-SPEED-RELIABILITY-2026-08-31.md`: `labs.video.ab` takes one base payload + N variant overrides, queues them back-to-back at `batch` priority with a shared seed, and writes one comparison record (timings, `qc.shot` reports, contact sheets) to `<dataRoot>/ab/<id>/`. Desk gets an "A/B" tab that plays variants side by side (extend `drawer.tsx`'s existing compare).

### 5.2 Experiments to queue (in order)

| # | Experiment | Success metric |
|---|-----------|----------------|
| 1 | ~~Ref2v Standard: Alibaba Acc Ref2VA-8Step @1.0 vs current 4-step-file-at-8-steps~~ | **NOT RUNNABLE — see §5.2.1** |
| 2 | Fl2v Standard: Tutu 20→8 NFE vs LightX2V 8-step v1.0 | articulation score + audio peak/mean, time |
| 3 | Camera LoRA stacked with turbo at Draft, strengths 0.8 / 1.0 | visible move in contact sheet, no face distortion |
| 4 | Final tier: 1344×768 + LBH latent upscaler vs native 2K | time (expect >2× faster), sharpness by eye |
| 5 | SLA 4-step on Ampere | time vs v1.1; discard if not ≥1.3× |
| 6 | The five experiments already listed in the speed doc (shift 12/3→6/3, Draft strength 1.3, sage `allow_compile`, LTX truncated draft ladder) | as listed there |

### 5.2.1 Experiment 1 — Alibaba Acc LoRAs: withdrawn, not deferred (2026-09-02)

Checked before downloading 2.7 GB, and the check settled it: **these are not ComfyUI LoRAs and
cannot be A/B'd against our 8-step recipe.** Three independent pieces of evidence, all from the
weight itself:

- The safetensors header (read over a Range request, no download) carries 728 tensors whose
  names are *diffusers* module paths — `token_refiner.refiner_blocks.0.attn.to_k.lora_down` —
  with no `diffusion_model.` prefix ComfyUI's key mapper expects.
- Two of those tensors are not a LoRA pair at all: `proj_out.weight` is `[32, 96, 5376]` and
  `audio_proj_out.weight` is `[32, 32, 5376]`. The metadata explains them —
  `pdd_num_steps: 32`, `pdd_block_size: 4` — they are the **Parallel Decoding Distillation**
  step-projection heads, and 32/4 is where the "8 steps" actually comes from.
- The card's usage instruction is `apply_pdd_lora`, which "derive[s] the required number of
  inference steps from its configuration", inside Diffusers' `ModularPipeline` (>= 0.40.0).
  ComfyUI is not mentioned.

`Kijai/MiniMax-H3_comfy/loras` has converted LightX2V's weights but **not** these — checked.

So the 8 NFE is a property of a parallel decoder, not of the weight. Loading it as an ordinary
LoRA and sampling 8 plain steps would drop the projection heads and run a schedule it was never
distilled against; whatever came out would be an off-label render, and reporting it as "the Acc
recipe" would be a confident wrong answer. **Closing G5 through this route means porting PDD to
ComfyUI as a sampler node** — a project, not an experiment. Logged as such; the ref2v head keeps
its 4-step-at-8-steps Standard until either a ref2v 8-step lands from LightX2V or someone ports
PDD.

### 5.2.2 Experiment 2 — Tutu 20→8 NFE vs LightX2V 8-step (RUN 2026-09-02)

Runnable, and run: Tutu ships ComfyUI-format weights AND a `sampling_contract.json`, and the
contract is the interesting part — euler (not res_multistep), strength 0.8, shift 12/3, and
**nine fixed sigmas** taken from boundaries `[0,3,5,8,10,13,15,18,20]` of its 20-step teacher,
with the card explicit: "do not replace these sigmas with a generic uniform 8-step schedule."

That contract is now expressible. `MinimaxTurboSpec` grew `sampler`, `sigmas` and `modelId`; the
graph swaps `BasicScheduler` for KJNodes' `CustomSigmas` when a distill publishes a ladder (and
the adapter refuses if that node is missing, rather than sampling the wrong one); and
`payload.minimaxDistill` selects a candidate, which is a payload field and not a setting because
a bake-off is per-render. The take's sidecar records which distill made it. Tests:
`minimax-distill.test.ts` (5) — including one that pins the DEFAULT path to res_multistep +
BasicScheduler, since everything here is machinery for not being the default.

**Result — the shipped LightX2V 8-step stays.** Run `2026090209414-a26232`, one seed, the same
interview single (Milo, one line, 5s, 1344x768, Standard), all three of the author's checkpoints
against the control:

| variant | time | audio mean / peak | voiced | articulation |
| --- | --- | --- | --- | --- |
| LightX2V 8-step (shipped) | 303s | **-24.7 / -7.8 dB** | **47%** | 1.93x |
| Tutu step100 | 290s | -34.2 / -16.6 dB | 41% | 1.50x |
| Tutu step200 | 289s | -33.2 / -15.3 dB | 40% | 1.69x |
| Tutu step300 | 284s | -34.5 / -16.4 dB | 38% | 1.40x |

Picture quality is comparable — step200's strip shows the mouth opening and closing cleanly, and
none of the three showed the ghosting the card warns about on this shot. But the claim under
test was that this distill KEEPS the audio and the lip-sync, and the audio is where it loses:
**every checkpoint lands 9-10 dB quieter** than the control, consistently, with voiced share
down 47% -> 38-41%. Quieter dialogue is not corruption, but it is worse — it costs gain and
brings noise up with it. Against that, ~5% of wall clock (284-303s) is not a trade worth making.

Keep the default. The mechanism stays, because it is what let this be answered in one run and
what the next candidate will need; `minimaxDistill` is a live payload field with all three
checkpoints selectable.

Two honest limits on this: one seed and one shot, and the articulation column is a screen rather
than a verdict — scene-change energy cannot separate a moving mouth from a moving camera (the
first pass of this experiment scored Tutu 3.25x on exactly that mistake). The frame strips
`scripts/ab-h3-distill.mts` writes are the evidence that settled it.

### 5.3 Hero finish for LTX (P3 `finish_episode` piece)

Approved LTX shots: re-render at Draft ladder, then one pass with the LTX-2.5 Pixel Spatial Upscaler IC-LoRA (2×, strength 1.0, low guidance to stay faithful). Wire into the IC-LoRA slot already supported by `capabilities.ts:111-143` (needs a third `IcLoraKind = "upscale"`).

### 5.4 Bridge joins

Port javawock's Bridge as `bridge_takes(takeA, takeB, seconds)`: renders a 1–2 s H3 transition between two approved takes for room-coverage scenes assembled from separate LTX renders. Optional; only if the cut-on-action between takes reads badly in the acceptance pilot.

### 5.5 Timeouts and ETA

- LTX 2.5: derive timeout from a per-engine estimator (`estimateRenderMinutes` shape, fitted from `jobs.json` history) instead of the flat 45 min.
- Persist per-render `{engine, tier, w, h, frames, seconds}` into `<dataRoot>/timing.jsonl`; the Desk's `EST_RENDER_MIN` and the job ETA read the median for the matching shape.

---

## 6. Phase V5 — Reliability (closes G6 batch, G8)

- **Overnight batch** (N1.4): `episode.renderAll` walks every boarded-but-unrendered shot in an episode, one GPU job at a time, `batch` priority, stops on the second `InfrastructureError`, writes a morning report (`<dataRoot>/reports/<episode>.md`) with QC verdicts and the contact sheets.
- **Identity drift check** in `qc.shot`: DINOv2 or CLIP-image cosine between the shot's cast-sheet crop and 6 sampled frames; `review` below 0.75, `fail` below 0.6 (thresholds to calibrate on the approved takes we already have). Small model, runs on CPU in the `cpu` lane so it never blocks the GPU.
- **Burned-in text check**: a tiny OCR pass (rapidocr-onnx, CPU) on the same 6 frames; any text box larger than 2% of frame → `review`. This is the failure mode noted in the "cast refs burn broadcast text" memory.
- **Preset-aware retake**: `retakeShot` note can carry `{ preset, cine, cameraLora }` overrides so a "wider, slower push-in" retake is data, not prose.

---

## 7. Downloads (all to `D:\models`, registered in `models/registry.ts`)

| Registry id (new) | Source | File(s) | Size | Dest |
|---|---|---|---|---|
| `minimax-h3-camera-lora` | `Jojocodex/minimax-h3-Camera-Motion-lora` | `camera_motion_h3_lora_v1_3000_pruned.safetensors` (+ the 1000 variant for A/B) | small (LoRA) | `loras/` |
| `minimax-h3-acc-lora` | `alibaba-pai/MiniMax-H3-Acc-LoRAs` | `MiniMax-H3-FL2VA-Acc-8Step.safetensors`, `MiniMax-H3-Ref2VA-Acc-8Step.safetensors` | rank-64 bf16 | `loras/` (check `Kijai/MiniMax-H3_comfy/loras` for a ComfyUI-key copy first) |
| `minimax-h3-av-8nfe-lora` | `tutututututu/Tutu-MiniMax-H3-AudioVideo-20to8-NFE-LoRA` | main safetensors | LoRA | `loras/` |
| `minimax-h3-latent-upscaler` | `LBH-123-AI/Minimax_h3_latent_Upscaler` | model + its custom node | TBD | `upscale_models/` + `custom_nodes/` |
| `ltx-25-spatial-upscaler-ic` | `Lightricks/LTX-2.5-22b-IC-LoRA-Pixel-Spatial-Upscaler` | `ltx-2.5-22b-ic-lora-pixel-spatial-upscaler-x2-1.0.safetensors` | IC-LoRA | `loras/` (must match `INFRA_LORA` regex so it stays out of the user slots) |
| workflow refs (no weights) | `ethanfel/H3_Cinematic_Multishot_Coverage`, `javawock7618/…` Bridge, `joeygambino/…` PROMPTING.md | JSON + md | — | `aurea/docs/refs/hf/` for reading, not loading |

Already installed and reused: LightX2V turbo (3 files), w4a8 weights, SLA LoRA (unwired), Lightricks camera LoRAs, LTX-2.5 int8 + Gemma enhancer.

Download gotcha (from memory): big pulls must run as a detached `Start-Process`, not a 10-min background command.

---

## 8. Order and effort

| Phase | Effort | Depends on | Unblocks |
|-------|--------|-----------|----------|
| V4.1 A/B queue | 1 day | — | every experiment |
| V1 presets + look line | 1 day | — | crew skill simplification |
| V2 shot picker + H3 camera LoRA + composers | 2–3 days | camera LoRA download | director's edit |
| V4.2 experiments 1–3 | GPU time, ~half a day of attention | V4.1, downloads | tier recipes |
| V3 coverage pass | 1 day | — | canon angles |
| V5 batch + QC checks | 1–2 days | V4.5 timing log | overnight production |
| V4.3 hero finish, V4.4 bridge | 1 day each | IC-LoRA download; acceptance pilot verdict | `finish_episode` |

Recommended start: **V4.1 → V1 → V2**, then run the acceptance pilot (one Field Note through the crew) before V3/V5, since the pilot will tell us whether bridge joins and identity QC are needed at all.

Standing gotchas that apply to every phase: restart Aurea after any core change (the gold "Update ready" pill); kill a stale studiod by port-file pid before verifying in-app; H3 stays at 24 fps or voices distort; free VRAM on both :8000 and :8188 before A/B runs.


---

## 9. Build log

### 2026-09-02 — V4.1 (A/B queue), V1 (lanes + look line), V2 (director's edit)

All three phases the plan recommended starting with, in its recommended order.
187 core tests pass (was 169); `typecheck:core`, the desktop `tsc` and `vite build` are clean.
**Not yet run on the GPU** — nothing below has been through a real render.

**V4.1 — A/B queue (closes the G6 half the experiments depend on)**

- `packages/core/src/ab.ts` — `AbStore`. One base payload + N overrides → N video jobs at
  `batch` priority on ONE shared seed, and a record under `<dataRoot>/ab/<id>/run.json`.
  Timings are written as they happen, not derived on read: job history is capped at 100, so a
  run read back next month could not otherwise be reconstructed. Folds the live queue into
  unsettled runs on every snapshot; a settled run is never touched again.
- Schemas: `videoAbSchema`, `abRunSchema`, `abOverridesSchema` (which deliberately cannot move
  prompt / startFrame / board / director — an override that did would be a different shot).
- Routes: `labs.video.ab | abList | abGet | abRemove`.
- UI: **Video lab → "A/B this shot"** (`screens/video/AbModal.tsx`) queues from whatever the
  panel is configured for; **Desk → "A/B"** (`screens/desk/ab.tsx`) plays the variants side by
  side with wall clocks and a "+x% / fastest" column.
- Tests: `ab.test.ts` — shared seed, batch priority, overrides reaching their own job, and the
  record surviving `clearFinished()`.

**V1 — lanes and the look line (closes G1)**

- `videoPresetSchema` + four shipped Zoo Logic lanes seeded to
  `<dataRoot>/promptlib/video-presets/` under their OWN marker (every existing dataRoot already
  has the Image lab's `.seeded.json`, so hanging them off that one would mean nobody ever gets
  them). Lanes: Interview single, Room coverage, B-roll insert, Field Note — at the shapes that
  were measured safe (2.5 with the enhancer OFF; H3 native canvas, ≤6s, draft tier).
- A lane carries three separable things because they are consumed at three different moments:
  the **payload**, the **cine ids**, and the **composer rules**.
- `bible.style.lookLine` (+ a field in /bible), `projectLook()` and `withLook()`. Appended ONCE
  by the composer, never by an adapter, and never repeated when the prompt already carries it —
  which is the ordinary case, since a keyframe-composed prompt ends with the art direction the
  default look is derived from.
- Routes `prompts.videoPresets | videoPresetSave | videoPresetRemove`; lanes are also returned
  by `lab_catalog('video').lanes` for the crew agent.
- UI: the lane rail at the top of the params panel, with an honest "customised" chip (measured
  against what the lane actually SET, so undoing an edit re-attaches it).
- Tests: `video-presets.test.ts` — lane shapes, disk round-trip, and five look-line cases.

**V2 — the director's edit (closes G2, G3, G4)**

- **Shot picker** (`screens/video/ShotPicker.tsx`): shot size · angle · move · lens · light from
  the bank, with the expanded clause shown greyed under it. `payload.cine` carries the ids as
  provenance; the panel expands them to prose itself, so no adapter can stack a second copy.
- **H3 camera control (G3)** — registry entry `minimax-h3-camera-lora` (Jojocodex, both
  checkpoints, sha256 verified against the HF API), a second `LoraLoaderModelOnly` after the
  distill (node **61**, not 20 — ref2va's loaders start at 20 and a collision would overwrite
  `<Picture 1>`), the adapter's blanket refusal narrowed to style LoRAs only, strength clamped
  to 0.6–1.1, and the `camera motion` trigger prepended to the prompt (including each long-form
  chunk). The panel's Camera row now appears on H3 too. **Weights installed and measured
  2026-09-02 - see experiment #3 below.**
- **Composers (G4)** — `packages/shared/h3Prompt.ts` writes H3's block form (subject definitions
  / summary / interval-stamped description with `<d>…</d>` dialogue / soundscape / music), and
  `packages/shared/multiShot.ts` writes LTX 2.5 cutting prose with the pooled rule set and real
  budget arithmetic (airlock 2s, ~1.8 words per spoken second, >4 framings warned).
  `planDialogue()` was extracted from `composeShotSpec` so all three composers place lines
  identically.
- `composeShotFromBoard` now picks the composer: lane → engine → H3 block / multi-shot prose /
  the Director timeline. `shotComposeSchema` takes `preset`, `engine` and `multiShot`, so
  `shot_from_storyboard` reaches all of it.
- Tests: `h3-prompt.test.ts` (7) and `minimax-camera.test.ts` (4).

**Experiment #3 - H3 camera LoRA (RUN 2026-09-02, the A/B queue's first real use)**

Weights downloaded (`minimax-h3-camera-lora`, 310 MB, both checkpoints, sha256 verified).
Run `ab/2026090208424-5c4256`, seed 1569503741, project `zoo-logic`: the recording-booth
two-shot plate, H3 draft, 4 s, 1344x768 (the 1 MP draft guard renders it 1120x640), three
variants at one seed - prose-only control, LoRA 0.8, LoRA 1.0. All three completed.

The push was measured, not eyeballed: each take's frames were fitted back to their own first
frame as a zoom about a searched centre, scored on the MEDIAN absolute difference so the two
characters (who move on their own) drop out and the set carries the estimate
(`scripts/ab-h3-camera.mts` queues it; the fit is a throwaway).

| variant | zoom curve over 4 s | final | wall clock |
| --- | --- | --- | --- |
| prose only (control) | 1.02 1.04 1.07 1.08 1.12 1.13 1.18 1.30 | **x1.30** | 157 s |
| LoRA 0.8 (gentle) | 1.02 1.04 1.07 1.10 1.13 1.17 1.35 1.40 | **x1.40** | 130 s |
| LoRA 1.0 (pronounced) | 1.02 1.04 1.07 1.10 1.14 1.23 1.36 1.41 | **x1.41** | 134 s |

Verdict: **the weight loads and steers - but G3 overstated the problem.** On this plate H3
already honours a push-in asked for in prose (x1.30 unaided). The LoRA buys about a third more
travel and starts the ramp about half a second earlier; it does not turn a static take into a
moving one. No face distortion or identity drift at either strength, and 0.8 vs 1.0 is inside
the noise on a single seed - so **0.8 is the default worth carrying**, with 1.0 held for a
shot that has to read as a move. The pass/fail bar in the table below ("visible move, no face
distortion") is met.

Two cautions for anyone reading the numbers: the wall clocks are NOT a speed result - the
control ran first and absorbed the managed engine's cold start - and one seed on one plate is
one data point, not a curve. The 1000-step checkpoint is installed and untested.

Side effect: the take's sidecar now records `camera: { move, strength }`, because a render
whose whole point is a judgement call about the move has to say what steered it.

**V3 - the coverage pass (SHIPPED and render-verified 2026-09-02)**

One approved plate -> eight on-model angles of the same room and cast in ONE ref2va generation,
plus a 4x2 contact sheet. The problem it solves is drift, not cost: the room-coverage lane needs
a wide, a single and a reaction of the *same* room, and three separate keyframe generations are
three chances for the lamp to move.

- `packages/shared/src/coverage.ts` - the eight bearings with their frame offsets, the prompt
  block, the filename rule. Two numbers carry the technique and neither is a preference: 124
  frames is H3's trained block (`frameLength(5)` lands on it exactly, asserted in the tests),
  and the offsets are the MIDDLE of each dwell - a naive `length / 8` slice lands on the swing
  between bearings, which is the motion-blurred frame.
- `comfy/minimax-coverage-graph.ts` - deliberately thin. It delegates to `minimaxH3RefGraph` and
  swaps the tail: the video mux and the audio decode come out, and eight `ImageFromBatch` ->
  `SaveImage` pairs go in at nodes 70-87 (clear of the base graph's 1-19/60/61 and the reference
  loaders' 20-57). Selecting inside the graph is why the render returns 8 files rather than 124.
- `adapters/minimax-coverage.ts` - its own adapter, because the video adapter's whole contract is
  "a take, with its soundtrack, attached to a shot". It duplicates nothing that was expensive:
  the weight resolution moved out of `MinimaxVideoAdapter` into exported `minimaxModelNames` /
  `minimaxRefModelNames`, and `findLora` is now exported too.
- `coverage.ts` (CoverageStore) + `studio.canon.coverage|coverageList|coverageGet|coverageRemove`
  + MCP `coverage_pass` / `coverage_get`. The record at `<dataRoot>/coverage/<id>/run.json`
  outlives the queue, same reasoning as the A/B one.
- Import: coverage output lands in `assets/image/coverage/<slug>/` keeping its filenames, the way
  a deck does - the names carry the orbit order and the angle id, which is what both the record
  and the tab read back by.
- UI: the canon library grows an Angles block per location (contact sheet + eight labelled
  bearings) and a "Coverage pass" button on any location that has a plate. A run with no location
  shows under Unplaced.
- Tests: `minimax-coverage.test.ts` (10) - 197 core tests pass.

**Verified by two real renders, 2026-09-02.** Zoo Logic's recording-booth two-shot and a
playground plate, both **2m32s at Draft on the H3 native canvas** - well inside "cost <= one
Draft render". Read on the sheet: the front bearings (0-180 degrees) are strong and immediately
usable - a wide, both profiles, and an over-shoulder single on each character with wardrobe,
mane, beanie, table, mics and lamplight all holding. 315 degrees comes back as a clean mirrored
reverse two-shot, which is exactly the reverse angle the lane wants. **The caveat is the SET, not
the cast:** past ~180 degrees the model invents the wall the plate never showed (the booth's
acoustic panels become a curtained window), so the far bearings are continuity-safe for
characters and not for the room. Treat 0-180 as coverage and the rest as candidates.

Not built, and deliberately: boarding a shot cannot yet PICK an angle from the tab - the angles
are ordinary library assets, so they are already selectable everywhere the library is, but the
Boarder has no "use this angle" affordance of its own.

**Next, in the plan's own order:** V4.2 experiments 1–2 (they need the Alibaba Acc LoRAs downloaded); then V3 coverage
pass. The standing gotcha applies to everything above — **restart Aurea** (quit + relaunch via
`scripts/launch-aurea.ps1`) before verifying any of it in the app.

### 2026-09-02 — LTX 2.5 vs LTX 2.3: every 2.3 workflow, head to head (RUN)

Re-check of the build first: 217 core tests pass, `typecheck:core` and the desktop `tsc` are
clean, and the running Aurea (launched 15:21) is on the current studiod bundle.

Then eight A/B runs (`scripts/ab-ltx-versions.mts`, project `zoo-logic`, the recording-booth
two-shot plate, 1280x704, one shared seed per case, 2.5 with the Gemma enhancer OFF unless the
label says otherwise). Draft output is 640x352 on both engines (base pass only); full is 1280x704.
Wall clocks include the model swap between engines; case A's 2.3 arm also absorbed the cold start.

| case | workflow | 2.3 | 2.5 | verdict |
| --- | --- | --- | --- | --- |
| A | i2v draft 4s | 178s · Milo lurches out of his chair and leaves frame | 126s · stays seated, one awkward reach; **+enhancer 179s: cleanest of the three** | 2.5 |
| B | ia2v 7s (Sterling's chocolate line) | 192s · locks the take, articulates, stiff talking head | 132s · articulates, adds paw gesture, brows, the prompted proud smile | 2.5 |
| C | t2v (no start frame) | 171s · bright flat puppet frame, blocky mane, tiny Milo | 124s · lamplit shallow-focus two-shot on the bible's look, but Sterling loses his mane | 2.5 (set), neither on-model |
| D | end frame draft | 167s · lands the end frame; mid-take excursion is a smeared garble | 130s · lands the end frame; excursion is a coherent over-shoulder + dissolve | 2.5 |
| E | mid keyframe at 2s | 173s · guide taken at frame 48; final over-shoulder messy | 124s · guide taken at frame 48; final over-shoulder clean | 2.5 |
| F | FULL two-stage 4s | 231s · sharper, more mane detail; Sterling grabs Milo's mic arm | 164s · smoother/painterly; exaggerated deep lean, Milo stays put | split: 2.3 sharper, 2.5 better blocked |
| G | 48fps draft 2s | 178s · 97 frames @48; grabs the mic, Milo stands | 135s · 97 frames @48; calmer, Milo also rises | 2.5, both flawed |
| H | push-in | prose 175s **x1.02** (no move) · LoRA 1.0 192s **x1.49** | prose 132s **x1.26**, heads turn to hold the look | LoRA still the strongest push; 2.5 prose is a real half-strength substitute, 2.3 prose is nothing |

(H's zoom is fitted per frame against frame 0 on the median absolute difference, the same
throwaway fit as the H3 camera experiment.)

**Findings**

- **Every 2.3 workflow the 2.5 adapter accepts works on 2.5 at draft and at full**: i2v, t2v,
  ia2v lip-sync, end frame, mid keyframe, 48fps frame math (97 frames at 48 for 2s). The two
  refusals (Director timeline, camera LoRA) stand as designed.
- **2.5 is 25-30% faster on every case** (draft ~125-135s vs ~170-190s; full 164s vs 231s) and
  better blocked in six of eight. 2.3's recurring failure on this plate is inventing contact:
  it grabbed a microphone in three of its eight takes and sent Milo out of his chair in two.
- **2.3 keeps a sharpness edge at full quality**; 2.5 renders fur softer. A hero-finish
  upscaler (V4.3) is the answer if that matters for a keeper.
- **Audio:** 2.3 always produces room tone (-21 to -47 dB). 2.5 emitted digital silence
  (-91 dB) on every "Nobody speaks" shot at draft AND full, yet scored the t2v take (-48 dB) and
  locked the ia2v take at the same -25 dB as 2.3. Reads as 2.5 obeying the prompt rather than a
  graph fault, but a silent i2v take is what the 2.5 lanes will ship by default — if room tone
  is wanted, ask for it in the prompt (unverified) or lay a bed in the edit.
- **The enhancer is only harmful on multi-shot prose.** On a single-take motion prompt (A) it
  produced the best take of the day, at +50s for the Gemma pass.
- **Prompt lessons that apply to both engines:** "shifts in his chair" makes Milo leave the
  chair — say "stays seated"; "leans toward his microphone" on 2.3 becomes grabbing it.
- My end-frame/keyframe target (`coverage/.../02-front-right.png`) turned out to be the plate
  framing with both mouths open, not a three-quarter view, so cases D/E asked for an orbit the
  guide contradicted. Both engines still honoured the guide; the excursions are what each did
  with the contradiction. The coverage sheet's `02` is not 45° — read the sheet, not the name.

**Recommendation:** make LTX 2.5 the default LTX engine for the Zoo Logic lanes (it already is
for `zoo-interview-single` and multi-shot); keep 2.3 only where a shot needs the Director
timeline or the camera LoRA's full travel. Outputs are in the Desk's A/B panel, runs
`2026090213413-*`.
