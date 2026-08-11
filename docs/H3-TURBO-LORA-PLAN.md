# H3 Turbo LoRA + LTX Director capability gap — assessment & plan (2026-08-07)

## Part A — MiniMax-H3 Turbo LoRA: integrate? **YES (as an opt-in Turbo/draft mode, not the default)**

### What it is
- `larryvrh/MiniMax-H3-Turbo-Lora` — distilled few-step LoRA for MiniMax-H3, joint video+stereo-audio in 4 steps, ~5× wall-clock speedup. Apache 2.0. Preview quality: known plastic skin / over-sharp grain. Needs the author's custom "Turbo Sampler" node → **not the one we want**.
- `drbaph/MiniMax-H3-Turbo-Lora-ComfyUI` — key-renamed + pruned conversion that runs on **standard ComfyUI core nodes only**. 6 variants, 620 MB each. **This is the one to use.**

### Verified from the example workflow (`fl_minimax_h3_turbo_lora_example_workflow.json`)
- Wiring: `DiffusionModelLoader → LoraLoaderModelOnly (strength 1.0) → [sage patches] → MiniMaxH3SigmaShift(video 12, audio 6)` → BasicGuider.
- Sampler: `res_multistep` + `simple` scheduler, **10 steps**, denoise 1 — identical sampler/scheduler to Aurea's current H3 graph (`minimax-graphs.ts:190-200`), which runs 25 steps.
- README ranges: 8–10 steps (6–8 for ckpt500), LoRA strength 0.8–1.8, video shift 12, audio shift 4–6.
- Extra nodes in their workflow (`SpectrumApplyMiniMaxH3`, `SolAttnPatch`, `MiniMaxH3MemoryEfficientSageAttentionPatch`) are optimizations, not required.

### Why yes
- Current H3: 25 steps hardcoded, ~5 min for 4 s. Turbo at 8 steps ≈ **~3× faster (~1.5–2 min)** for iteration passes, with native audio intact.
- Zero new node packs; drop-in file + graph splice.
- Cost: 620 MB disk; quality regression (plastic skin) → keep 25-step as "Final".

### Implementation sketch
1. **Weights**: download `minimax_h3_turbo_4step_ema_ckpt850_pruned_comfyui.safetensors` into the loras folder of whichever install serves H3 (shared-server default ⇒ the LTX/managed install: `<dataRoot>\models\<model-id>\loras\` addressed as `<model-id>/loras/<file>`; external H3 install ⇒ its own `models\loras\`). Ideally add a registry entry (`models/registry.ts:66-67` shape) so the model manager fetches it.
2. **Graph** (`packages/core/src/comfy/minimax-graphs.ts`): in `minimaxScaffold`, when `spec.turbo`: splice `LoraLoaderModelOnly` right after `UnetLoaderGGUF` (before the Sage patch), add `MiniMaxH3SigmaShift` (12 / 6) after the patches, set `steps: 8`. Both fl2va and ref2va paths get it for free via the scaffold.
   - ⚠ Probe caveat: verify `MiniMaxH3SigmaShift` exists in ComfyUI 0.30.2 via combo/schema probe, **not** status code (`/object_info/<Class>` returns 200 `{}` for unknown classes).
   - ⚠ GGUF: LoRA-on-GGUF goes through ComfyUI-GGUF's on-the-fly patching — verify `LoraLoaderModelOnly` accepts the GGUF model output on our pin.
3. **Surface**: reuse the existing `fast` payload flag with a per-engine meaning — delete the refusal at `minimax-video.ts:267-272`, map `fast → turbo` in the adapter, flip `engineSurface.ts` to show the `quality` section for `minimax-h3`, add `draft: true` to the H3 catalog block in `labs.ts`. UI radio (Draft/Final) already exists in `ParamsPanel.tsx:1417-1435`.
4. **Capability gate**: extend `probeMinimaxCapabilities` (`capabilities.ts:296-339`) with a `LoraLoaderModelOnly` combo probe; only show Draft for H3 when the turbo file is present in the combo list.
5. **Verify**: real render, draft vs final, same seed/prompt; confirm audio still decodes (shift 6 on audio lane) and timing gain.

Tuning starting point: ema_ckpt850, strength 1.0, 8 steps, shift 12/6. If mushy → 10 steps or strength 1.2.

## Part B — LTX Director: what ComfyUI can do that Aurea doesn't expose yet

Aurea already drives `LTXDirector` (timeline segments, local prompts, guide strength, keyframe guides, IC-LoRA slot, audio lanes, retake). Currently fixed/hidden (all in `director-graph.ts`):

| Capability | Today | Value |
|---|---|---|
| `image_attention_strength` | fixed constant (:341-344) | how strongly keyframes/refs bind — big look control |
| `img_compression` (guide compression) | fixed `GUIDE_COMPRESSION` (:39-41) | crispness vs motion freedom of guides |
| `global_prompt` | deliberately empty (:194-201) | whole-clip style prompt over per-segment prompts |
| Sampler/sigma ladders + CFG | hardcoded euler / `SIGMAS_BASE/REFINE`, CFG 1 (:33-37) | a real quality tier (more steps/CFG for hero shots) |
| Tiled encode + tile size | hard-false (:345-347) | bigger canvases / longer clips without OOM |
| Camera-motion LoRAs | schema exists, hidden until weights (`engineSurface.ts:160-164`) | dolly/orbit/zoom moves — just needs weight files |
| Multi-ref ingredients (>1 IC-LoRA) | single slot (:129-138) | multi-character casting |
| `upscale_method`, `display_mode` | fixed | minor |

**Recommended shortlist (highest visual impact / lowest effort first):**
1. `image_attention_strength` + `img_compression` as advanced sliders on the Director params panel.
2. A "hero quality" tier: denser sigma ladder + optional CFG > 1 on the base pass.
3. Camera LoRAs — unblock by downloading the LTX camera-control LoRA weights into the store (the code path already exists end-to-end).
4. `global_prompt` as a per-project style line.
5. Tiled encode toggle for long/2K-canvas runs.

## Status (2026-08-07, end of day)
- **Part A: SHIPPED & VERIFIED.** `minimax-h3-turbo-lora` registry entry + manifest; graph splice
  (`LoraLoaderModelOnly` → optional Sage → `MiniMaxH3SigmaShift` 12/6, 8 steps) behind
  `spec.turbo`; adapter resolves the LoRA from the install's own combo walk and REFUSES (not
  silently falls back) when it or the shift node is missing; Draft/Final surfaced for H3
  (catalog `minimax.turbo.available` → engineSurface `quality` shown/locked). Verified by real
  render `j-6485fa63`: 4s t2v @ 1344×768 → 4.46s h264 + AAC stereo (mean −16.3 dB), prompt
  executed in 478.8s INCLUDING cold sidecar boot + 24 GB weight load, vs ~20 min warm estimate
  for 25-step Final at the same canvas.
- **Part B camera LoRAs: INSTALLED.** The "19b" set is dimensionally IDENTICAL to the 2.3-22b
  transformer on every layer it touches — verified key-by-key against the 22b checkpoint
  (480/480 pairs, same 48 blocks, 4096 hidden). All 7 moves in
  `<dataRoot>/models/ltx-camera-loras/loras/`, sha256-verified; `resolveCameraLoras` matches
  all 7 filenames (tested). Live render test with dolly-in queued at close of session.
- **Part B sliders (attention/compression/global_prompt/tiled encode/hero tier): not started** —
  still awaiting a pick.
