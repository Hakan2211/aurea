# Video route: speed & reliability plan (2026-08-31)

Scope: MiniMax H3 + LTX 2.5 generation speed, render reliability, and the new-technique
opportunities (multi-shot) that feed the Zoo Logic podcast idea. Sources: code audit of
`packages/core` (this doc cites exact lines), the official ComfyUI 0.32 LTX-2.5 workflow
templates found **in our own comfy venv** (`comfyui_workflow_templates_json\templates\
video_ltx2_5_i2v.json`), the lightx2v Minimax-h3-Turbo HF repo + settings discussions,
and the Lightricks LTX-2.5 model card.

---

## 0. The headline findings

1. **Our LTX 2.5 graph is closer to official than feared.** The official 2.5 i2v template
   uses the *same* sigma ladders as 2.3 (`1.0, 0.99375, … 0.0` base / `0.85, 0.725,
   0.4219, 0.0` refine) and `euler_ancestral` on **both** passes. Our "inherited from 2.3"
   sigmas and sampler are exactly what Lightricks ships. **Do not churn them.**
2. **But LTX 2.5 gets zero tuning.** `ltx25-video.ts` never calls `resolveTuning`/
   `applyTuning` — so SageAttention and chunkFeedForward (measured ~23% faster on big
   shots on 2.3) silently do nothing on 2.5, even though the Settings toggle reads as
   global. This is the single largest free speed win on the LTX side.
3. **Our 2.5 decode tiling is off-template.** We use `VAEDecodeTiled 512/64/64/16`
   (tile/overlap/temporal_size/temporal_overlap); official is **768/64/4096/32**. Temporal
   size 64 makes a 121-frame decode run ~3 overlapping temporal tiles instead of one —
   slower decode plus temporal-seam risk, for nothing.
4. **H3 Draft runs the right LoRA at the wrong strength and a risky resolution.** We ship
   fl2v turbo 4-step **v1.1** (good — that's the current best) at strength **1.0**, but the
   authors/users converge on **1.2–1.3**; at 1.0 prompt adherence in i2v is reported poor.
   And the known v1.1 failure mode — **corrupted audio + ghosting at ~1MP with 4 steps** —
   sits exactly on our 1344×768 default (1.03MP).
5. **Reliability has one structural hole: no automatic retry anywhere.** A 3-minute
   ENGINE_GONE verdict on a 35-minute render is a total loss (`jobs.ts:188` is manual-only).
   Also H3's run timeout (2 h) is 3× its own 40-min admissibility ceiling.

---

## Phase 1 — quick wins (small diffs, do first)

> **Status 2026-08-31: implemented AND render-verified** (all five items below; 142
> core tests pass, 4 new ones cover the 2.5 tuning/sampler/tiling changes, typecheck
> clean). Verification renders against the managed ComfyUI 0.32.0, driven through the
> real graph builders:
> - **LTX 2.5** 2s draft t2v with chunkFeedForward spliced in + official decode
>   tiling → success in 120 s, valid h264+AAC output. The KJNodes
>   `LTXVChunkFeedForward` patch is confirmed compatible with the 2.5 transformer.
> - **H3** 4s draft t2v (w4a8 + sage + evict, v1.1 4-step LoRA at strength 1.2,
>   shift 6/3, 768×448) → success in **85 s** including the weight load.
> - (The drive scare earlier that day resolved itself: the T7's data partition
>   simply hadn't mounted; replugging brought `D:\models` back intact.)

### 1.1 Wire tuning into LTX 2.5  ⭐ biggest LTX speed lever
- `ltx25-video.ts`: call `resolveTuning()` / `applyTuning()` the way `comfy-video.ts:252,558`
  does; port `explainTuningFailure()` (comfy-video.ts:62-72) so SageAttention import
  failures surface properly.
- Expected: ~20%+ on sampling (chunkFeedForward) + SageAttention gains on top.
- Guard: drop the sage patch silently if `PathchSageAttentionKJ` is absent (same pattern
  as `minimax-video.ts:511-513`).

### 1.2 Fix LTX 2.5 decode tiling to official values
- `ltx25-graph.ts:321-343`: `VAEDecodeTiled` → tile_size **768**, overlap **64**,
  temporal_size **4096**, temporal_overlap **32** (from `video_ltx2_5_i2v.json` node 374).
- Faster decode, removes temporal seam risk.

### 1.3 `freeMemory()` before LTX renders (parity with H3)
- H3 calls `client.freeMemory()` unconditionally before every render
  (`minimax-video.ts:735-736`) precisely because both engines share one managed ComfyUI.
  The same reasoning applies in the other direction: an LTX render queued after an H3 take
  starts against ~24 GB of warm H3 weights. Add the same call to both LTX adapters.

### 1.4 H3 Draft LoRA strength 1.0 → 1.2
- `MINIMAX_TURBO` table (`minimax-graphs.ts:348-384`): make strength a per-tier field;
  set fl2v 4-step v1.1 to **1.2** (community-verified range 1.2–1.3, 1.0 = weak i2v
  prompt adherence). Keep Standard/ref2v at 1.0 until A/B'd.

### 1.5 H3 timeout aligned to its own estimate
- `minimax-video.ts:759`: `timeoutMs` = `max(30 min, 2 × estimateRenderMinutes)` instead
  of a flat 120 min. The estimator already exists (`minimax-graphs.ts:143-151`); a render
  running at 2× its own estimate is wedged, and today only ENGINE_GONE saves us.

## Phase 2 — reliability structure

> **Status 2026-08-31: 2.1 and 2.2 implemented & verified** (147 core tests pass — 5
> new: 4 retry-ladder tests in `jobs.test.ts`, 1 `draftCanvas` table test; typecheck
> clean). 2.1 = `InfrastructureError` in `adapters/types.ts`, thrown by
> `client.ts` on ENGINE_GONE and on a network-dead `/prompt`, consumed by
> `jobs.ts` for a one-shot requeue (managed mode self-heals via
> `ComfyService.ensure`'s health-check-and-respawn; a manual retry resets the
> allowance). 2.2 = `draftCanvas()` in `minimax-graphs.ts` + adapter wiring,
> 1344×768 Draft → 1120×640; live-verified: 4s draft rendered at 1120×640 in
> 135 s with clean h264+AAC. The A/B queue (2.3) and watch list (2.4) remain open.

### 2.1 One automatic retry on infrastructure failures
- `jobs.ts`: on failure classified as *infrastructure* (ENGINE_GONE, WS drop with
  unreachable `/history`, `/prompt` connection refused — **not** validation errors or
  OOM-loops), requeue once with a flag; managed mode restarts the ComfyUI service first.
  Second failure is terminal and reports "retried once".
- This converts the most common total-loss scenario (Comfy wedged mid-render) into a
  self-healing one. Persisted-queue plumbing already exists (`jobs.ts:95-96`).

### 2.2 H3 Draft resolution guard (the 1MP / 4-step audio bug)
- In the adapter, when tier = Draft (4-step) and canvas > ~0.9 MPx: either
  (a) auto-render at the 0.7 MPx equivalent (1152×640 for 16:9 — official 32-grid ladder),
  or (b) silently use the 8-step Standard LoRA instead. Recommend (a): Draft is for speed;
  1152×640 at 4 steps is both faster *and* artifact-free, and the official resolution
  table (template node 402) blesses it.
- Surface a one-line note in the panel ("Draft renders at 1152×640 to avoid a known
  4-step audio artifact at 1MP").

### 2.3 A/B queue (cheap experiments, one render each)
| Experiment | Change | What to look for |
|---|---|---|
| H3 Standard shift 12/3 → 6/3 | the 768p FL2VA recipe uses 6/3; we run the 768p 8-step file at 12/3 | motion quality, audio integrity |
| Kijai `MiniMax-H3-*-Acc-8Step` vs LightX2V 8-step | swap Standard LoRA | already flagged in H3-TURBO-LORA-PLAN as deferred |
| LTX 2.5 truncated draft ladder | 6-step base sigma subset on `fast` | today `fast` = half-res only; distilled schedule is nominally fixed, so treat as experiment |
| H3 sage `allow_compile: true` | `minimax-graphs.ts:423-426` | first-render compile cost vs per-step gain |
| LoRA strength 1.3 vs 1.2 on H3 Draft | per 1.4 above | prompt adherence vs burn-in |

### 2.4 Watch list (no action yet)
- lightx2v **ref2v** turbo is still v0.1 (our Draft ref2v rung); a v1.1 would lift the
  reference-head path the same way fl2v v1.1 did. Check the repo when touching H3 next.
- `minimax-h3-sla-lora` is downloaded but deliberately unwired — leave it until there's a
  documented recipe.
- Long-form H3 (HREndlessSampler) stays parked: upstream UTF-8 bug + 5–25 min/chunk CPU
  planner (docs/H3-SPEED-AND-LONG-FORM.md:301-328).

## Phase 3 — new techniques (feeds the Zoo Logic podcast)

### 3.1 LTX 2.5 native multi-shot — the podcast enabler

> **Status 2026-08-31: PILOT RUN, and it works.** Full write-up in
> `docs/MULTI-SHOT-PODCAST-PILOT.md`; scripts in `scripts/podcast/`. One 8s
> generation from one boarded keyframe gave wide → Sterling single → Milo reaction,
> cuts measured at 2.54s and 4.58s (scene score 0.43), both scripted lines spoken
> verbatim, Sterling's line playing straight through the first cut, and the voices
> holding (f0 117→125 Hz across the cut, 163 Hz for Milo). A single-take control at the
> same seed produced **zero** cuts, so the prose structure is causal. **New blocker
> found: the Gemma prompt enhancer — on by default whenever its weights are present —
> flattened the same prompt to zero cuts and dropped a character's line entirely.**
> A multi-shot path needs an `enhance` toggle on the video payload first.
Multi-shot needs **no new nodes and no new weights** — it's pure prompt structure on the
graph we already run. Rules (LTX prompt guide + Runware multi-shot guide):
- One chronological **prose paragraph**, never a shot list or sluglines.
- Name each transition in prose: "A hard cut transitions to…", "a match cut connects…".
- At every cut re-establish: scale, angle, who's in frame, lighting.
- Reuse the same visual tag per recurring character (this is our named-beat lipsync rule
  generalized — pronouns drift, names lock).
- State audio continuity across the cut ("the conversation continues under…").
- **2–4 shots per generation** is the sweet spot; voices and identity hold across cuts.

Podcast shape that falls out of this: one 8–10s generation = wide two-shot of the studio
→ hard cut to speaker A's single (named beat, quoted line) → hard cut to speaker B's
reaction/reply. That's real coverage — cuts, matched voices, held identities — from a
single boarded keyframe + one prompt. Combined with ia2v (already wired and correct at
`ltx25-graph.ts:262-283`) the audio take can drive it.

**Proposed step**: a `multiShot` hint in shotSpec/Director prompt assembly that formats
beats into the prose-cut structure, plus one manual pilot render (two Zoo Logic heads at
a podcast table) before building anything.

### 3.2 Not pursuing now
- **Duration head / auto-duration**: not wired in the official comfy templates yet; skip.
- **Prompt enhancer**: already in our graph behind a toggle; leave as is.
- **NVFP4 transformer quant**: PyTorch-only, not for the comfy path.

---

## Suggested order of work
1. Phase 1 (1.1–1.5) in one sitting — all small, all verifiable with one draft render per
   engine. Restart Aurea after rebuild (buildstamp pill).
2. Phase 2.1 retry + 2.2 draft guard.
3. Multi-shot podcast pilot (3.1) — one manual render to judge before wiring anything.
4. A/B queue (2.3) opportunistically, one experiment per session.

## References
- Official templates (local): `aurea/runtime/comfy-venv/Lib/site-packages/comfyui_workflow_templates_json/templates/video_ltx2_5_*.json`
- https://huggingface.co/lightx2v/Minimax-h3-Turbo (+ discussion #42: v1.1 4-step settings)
- https://huggingface.co/Lightricks/LTX-2.5 (model card: variants, DFR, duration head)
- https://docs.comfy.org/tutorials/video/ltx/ltx-2-5
- https://ltx.io/blog/ltx-2-5-prompt-guide + https://runware.ai/docs/models/lightricks-ltx-2-5-pro/guides/multi-shot (multi-shot prose rules)
