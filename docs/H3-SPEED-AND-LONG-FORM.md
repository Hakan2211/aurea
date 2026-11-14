# MiniMax-H3 — the start frame, the speed, and shots longer than the model

2026-08-30. Two complaints, one engine: *"a new video reuses the old video's first
frame"* and *"it is very slow"*. The first turned out to be a real bug with a
one-line cause; the second is not one problem but four, and this round takes all
four. It also adds long-form H3, which is a length feature rather than a speed
one but lands on the same graph.

Everything below is measured on this box — RTX 3090 Ti, 24 GB, sm_86, the
managed runtime's own ComfyUI 0.32.0 — at H3's native shape: **1344×768, 4s
(107 frames), fl2va, GGUF weights** unless stated otherwise.

---

## 1 · The start frame that would not go away

**Symptom.** Every H3 take opened on the same image. Three consecutive jobs in
`jobs.json` carried the identical `startFrame`, including the ones queued as
text-to-video.

**Cause.** `useVideoLab().generate` in `apps/desktop/src/hooks.ts`:

```ts
startFrame: input.minimaxRefs ? undefined : (input.startFrame ?? startFrame.relPath),
```

The panel sends `startFrame: undefined` on purpose for the two frameless modes —
"No start frame" (text-to-video, all three engines) and a MiniMax reference shot.
The fallback read that `undefined` as "the caller didn't say" and put the newest
library still back in. It exempted reference shots, because those failed loudly;
text-to-video failed *quietly*, by rendering something plausible.

And the newest library still, right after you rendered a shot, is the still that
*started* that shot. So every "text-to-video" H3 take animated the previous
take's first frame. The **No start frame** switch had never done anything on any
engine.

**Fix.** The panel already resolves its own default (`frameRel ?? defaultRel`)
and is the only caller. The seam now passes the payload through untouched.

---

## 2 · Speed

Four levers, measured one at a time against the same shape and seed.

| Configuration | Wall clock | s/step |
| --- | --- | --- |
| Old 4-step LoRA run at 8 steps, GGUF, no sage, cu128 *(what shipped)* | **454s** | 40.0 |
| …with SageAttention | 383s | 30.4 |
| LightX2V 8-step v1.0 — **Standard**, GGUF, sage | 388s | 30.5 |
| LightX2V 4-step v1.1 — **Draft**, GGUF, sage | 270s | 33.0 |
| Draft, GGUF, sage, **CUDA 13** | 261s | 29.7 |
| **Draft, w4a8, sage, CUDA 13** | **156s** | **17.6** |

**454s → 156s, 2.9× end to end**, and every lever pulls a different part of it.
About 100–125s of each of those is fixed cost — reading the weights off disk and
encoding the prompt — which is why the totals move less than the per-step
numbers do, and why the w4a8 set, which is 5.6 GB smaller across the unet and
the video VAE, moves both.

### 2.0 The thing under all of it: H3 does not fit

`scripts/h3-fit.mts` renders one sampler step at increasing lengths — the
allocation is the same as a real render, the wait is not — and reads ComfyUI's
own load line:

| Length | Frames | GGUF | w4a8 |
| --- | --- | --- | --- |
| 4.0s | 107 | `loaded completely` (15352 of 15403 MB) | fits |
| 4.5s | 113 | `loaded partially; 1216 MB offloaded` | fits |
| 8.0s | 197 | `loaded partially; 5806 MB offloaded` — 330s | **fits** — 140s |
| 12.0s | 294 | — | **fits** — 200s |
| 15.0s | 362 | — | **fits** — 261s, 19.8 GB still free |

Past roughly **four seconds** at H3's own native canvas, the GGUF unet no longer
fits on a 24 GB card beside its 9.6 GB text encoder and its 5.0 GB video VAE,
and starts renting system RAM. That — not the sampler, not the step count — is
most of what "H3 is very slow" means at length, and it is why the one shape this
box renders happily is the 4s one.

Every lever below helps. Only one of them addresses *this*, and it settles it:
w4a8 stages 5.6 GB smaller across the unet and the video VAE, the 8s probe that
made the GGUF unet page 5.8 GB loads whole and finishes in **140s against 330s**,
and the per-frame cost then stays flat (0.73 → 0.68 → 0.72 s/frame) all the way
to H3's full 15-second window. **On the 4-bit weights the limit at the native
canvas is the model, not the card.**

### 2.1 SageAttention — 40 → 30 s/step

The toggle existed. The library did not: `sageattention` was never installed in
any ComfyUI's python, so `false` was the only default that could not fail a
render. The managed runtime now installs it (`ACCEL_PACKAGES` in `runtime.ts`,
`triton-windows` + `sageattention`, allowed to fail without failing the runtime),
the schema default flips to `true`, and a stored `false` from before this change
is lifted once by a settings migration (`SETTINGS_VERSION` 1 → 2).

PyPI's `sageattention` is the Triton implementation, which is the one that runs
on Ampere — the 2.x CUDA-kernel builds target sm_89+. On the attention op alone,
fp16, 16 heads, head_dim 128:

```
16k tokens   45 ms → 14 ms   3.1×
49k tokens  377 ms → 131 ms  2.9×
```

The whole step only moves 1.3×, which says attention is roughly 40% of an H3
step and the GGUF dequant and MLP are the rest. That is the case for §2.2.

**LTX's identical toggle is deliberately left alone.** INT8 attention is a
picture change as well as a speed change, and LTX is a working engine with a
tuned look; that one wants an A/B, not a migration.

### 2.2 The distilled tiers — three rungs, not two

The old build carried one LoRA (larryvrh's 4-step, drbaph repack) and ran it at
8 steps, because that repack's README recommended 8–10. LightX2V now publish
proper per-head, per-step-count distills, so **Quality** on H3 becomes:

| Tier | Weight | Steps | Sigma shift (video/audio) |
| --- | --- | --- | --- |
| Draft | `minimax_h3_fl2v_turbo_4step_v1.1_768p_comfyui_bf16` | 4 | 6 / 3 |
| Standard | `minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16` | 8 | 12 / 3 |
| Final | *none* | 25 | model's own |

The shift is not a taste knob — a distill learns a specific noise schedule, and
rendering it against a different one is how a 4-step take comes out muddy rather
than fast.

Two things that used to be guesses are now the publisher's answer:

- **fl2v and ref2v distills are different weights.** Aurea put one LoRA on both
  heads on the reasoning that the distill was trained on the shared transformer.
  LightX2V ship them separately; the reference head gets
  `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16`. (There is no 8-step ref2v, so
  Standard on that head is the 4-step distill given twice the steps — the same
  trade the old build made everywhere, and marked as such in the code.)
- **Which LoRA gets picked.** It used to be `options.find(/minimax.h3.turbo/i)`,
  fine while exactly one turbo weight existed. There are now four; the match is
  on the exact file name.

`payload.minimaxTier` carries the choice. `fast` stays in the payload — LTX
speaks it and older jobs carry it — and reads as `draft` when the tier is absent.

### 2.3 w4a8 weights — the other 60% of a step

GGUF stores 3-bit blocks and dequantizes each one back to bf16 on every forward:
the card does the same bf16 matmul it always did *and* pays for the unpack.
Kijai's `minimax_h3_fl2va_pruned_w4a8_mixed` is 4-bit weights with int8
activations, which ComfyUI 0.32 loads through `asym_w4a8_int8` and comfy-kitchen
runs on the INT8 tensor cores (`int8_linear` → `torch.int8_mm`).

It is also *smaller*. ComfyUI's own staging lines, same shot, side by side:

```
GGUF   MiniMaxH3          15352 MB     MiniMaxH3VideoVAE  4965 MB
w4a8   MiniMaxH3          11956 MB     MiniMaxH3VideoVAE  2677 MB
```

5.6 GB back on a 24 GB card is not a rounding difference — it is the gap between
loading whole and loading partially beside the text encoder, which is what §2.0
is about. And the step itself nearly halves: **29.7 → 17.6 s/step**, because the
matmul stops being "unpack a 3-bit block to bf16, then do the bf16 matmul" and
becomes an INT8 one.

The graph picks its loader from the file: `.gguf` → `UnetLoaderGGUF`, anything
else → core's `UNETLoader` at `weight_dtype: "default"`, which is what makes it
read the checkpoint's own quant metadata. The two heads are separate registry
entries and may be in separate formats; each takes the best copy it has. The
text encoder and audio VAE stay on the GGUF entry — Kijai's repo does not
republish them, and there is nothing to gain.

### 2.4 CUDA 13

`comfy/quant_ops.py` disables comfy-kitchen's optimized CUDA backend outright
when `torch.version.cuda < 13`:

```
WARNING: You need pytorch with cu130 or higher to use optimized CUDA operations.
Found comfy_kitchen backend cuda: {'available': True, 'disabled': True, …}
```

The managed runtime was on cu128, so every quantized format in the studio —
fp8, nvfp4, int8-convrot, w4a8 — was being read by the slowest path that can
read it. `TORCH_INDEX` moves to `whl/cu130`. CUDA 13 drops Maxwell through Volta;
Ampere, Ada and Blackwell are all still supported, and this project's floor is
a 24 GB Ampere card. Same torch, same torchvision, same torchaudio — only the
accelerator under them moves.

Two upgrade traps, both handled in `EngineRuntime.upgradeTorchCuda`: the CUDA
runtime is not part of any pin, so `comfyReady()` would leave an existing venv
on cu128 forever; and pip treats `torch==2.11.0` as satisfied by
`2.11.0+cu128`, so the reinstall has to name the full local version. The same
shape covers `ACCEL_PACKAGES`, which is also not pinned. Both steps are
non-fatal — a runtime that renders is worth more than one that refuses to start
because an index was briefly unreachable.

### 2.5 What was looked at and not taken

- **Turbo-SLA** (`lightx2v/Minimax-h3-Turbo-SLA`) is downloaded and has its own
  registry entry, kept separate from the Turbo one on purpose: its ~2.5× is in
  sparse-attention kernels measured on a 5090, and on an install without them the
  weight is just the older v0.1 4-step LoRA with none of the win.
- **`minimax_h3_fastvideo_vsa_datafree_1300step_4step_int8_convrot`** (22.9 GB) is
  a 4-step distilled *full* model in int8 — attractive, but its own README gates
  it on unmerged pull requests in both ComfyUI and comfy-kitchen.
- **`Beidouqixing/minimax-h3-4step-lora-flashgen`** ships no ComfyUI conversion;
  it wants merging into the base checkpoint with the repo's script first.
- **`Abiray/MiniMax-H3-GGUF`** is the same family Aurea already uses. Higher
  quants exist; none of them are *faster*, which is the problem being solved.
- **Kijai's own `loras/MiniMax-H3-*-Acc-8Step`** are a second 8-step accel pair,
  one per head — a real alternative to LightX2V's Standard tier, and 1.7 GB each
  rather than 2.0. Not taken because LightX2V publish the step counts and shifts
  their weights were trained against and these do not, and a distill rendered on
  the wrong schedule is muddy rather than fast. Worth an A/B later.
- **`controlnet/minimax_h3_fun_controlnet_union_pruned`** in the same repo is a
  capability, not a speed-up — pose/depth/edge control over H3. Out of scope for
  this round; it wants its own node in the graph and its own lane in the panel.

---

## 3 · Long-form: shots past H3's window

`ComfyUI-HR-Endless-Sampler` is a drop-in replacement for
`SamplerCustomAdvanced` that samples one long latent as a chain of chunks. Each
finished chunk's tail is handed to the next as H3's own synchronized
`<Video N>`/`<Audio N>` reference, and Gemma 4 12B runs between chunks to rewrite
the prompt for what comes next — which is what keeps a minute coherent instead of
producing ten unrelated clips.

Everything else in the graph is unchanged: same conditioning node, same two
decoders, one muxed file out. `HREndlessSampler` subclasses
`SamplerCustomAdvanced` and takes the same four inputs in the same order, plus
the text encoder and video VAE (to build each continuation), the prompt, and the
frame rate its timecodes are written against.

**Two separate questions, deliberately.**

- *When does a shot get chunked?* Past H3's own 15s window — never before.
  §2.0 shows the card gives out around 4s, but chunking is not the fix for that:
  a handover costs a Gemma pass, so 8s as two chunks comes out level with 8s
  paged, and the planner rewriting the prompt changes the output. Everything
  that renders today keeps rendering exactly as it does today; long-form is a
  new capability, not a new default. The fix for §2.0 is w4a8.
- *How big is a chunk?* The shape that loads whole — which depends on the
  weights: 111 megapixel-frames on GGUF (107 frames at the native canvas) and
  374 on w4a8 (the full 362), scaled by canvas area and snapped to the 17k+5
  grid. Once a shot is being chunked anyway, every chunk should be one the card
  can actually hold.

Consequences worth knowing:

- **The render ceiling changes meaning.** `MAX_ESTIMATED_MINUTES` exists because
  past it a single pass pages to system RAM and takes the driver with it.
  Chunking is the fix for exactly that, so on a long shot the ceiling applies to
  a *chunk*; the whole render gets a separate, much later ceiling so a mistyped
  length is still caught.
- **A chunked shot runs on the REFERENCE head, and needs at least one still.**
  Not a policy — the mechanism. The finished tail of each chunk is carried into
  the next as H3's own `<Video N>` reference, and only ref2va conditioning has
  that channel; on fl2va the sampler stops with *"Experimental video
  conditioning requires positive conditioning from MiniMax H3 Reference to
  Video"*. It also re-tokenizes the prompt per chunk, rebuilding the reference
  conditioning from the images it is handed — matched one-for-one against the
  conditioning's own reference list, so the graph passes the stills as a single
  `ImageBatch` chain in order. Reference **clips and standalone sounds cannot
  ride along**: the sampler says outright that it cannot rebuild those from an
  images input. So the opening still goes in as `<Picture 1>` rather than as a
  start frame, which is the ref2va rule anyway.
- **Every required input has to be written out.** ComfyUI does not apply a
  node's schema defaults in an API graph — it rejects the prompt with "Required
  input is missing (pytorch_memory_fraction)" before anything loads. The graph
  spells out all eighteen, and a test walks the list.
- **Write long prompts as shots, and get the markers exactly right.** The node
  parses and validates them: `[Shot 1]` opens at frame 0 and must carry **no**
  timestamp, every later marker must carry one (`[Shot 2] At 00:10.000,`),
  numbers start at 1 and increase sequentially, times strictly increase, and a
  chunked prompt with no `[Shot 1]` at all is rejected. (Found by having the
  first render refused with "MiniMax [Shot 1] must not have a timestamp".) The
  panel says so
  once the length crosses.
- **Which llama.cpp wheel is a decision with a history.** PyPI ships only an
  sdist, so it has to come from the publisher's own index — and neither obvious
  choice works. The pack pins `whl/cu125`; llama.cpp's `ggml-cuda.dll` resolves
  cudart/cublas by plain name, so it loads whatever CUDA runtime is on the
  search path, which is torch's — and the moment §2.4 moved torch to cu130 that
  build stopped importing ("Could not find module llama.dll (or one of its
  dependencies)"). The matching `whl/cu130` build imports fine and then dies
  inside `llama_init_from_model` with `0xc000001d`, STATUS_ILLEGAL_INSTRUCTION:
  its `ggml-cpu.dll` wants an instruction set this class of CPU does not have
  (a 12th-gen Core i7, where AVX-512 is fused off — so every consumer Alder Lake
  and Raptor Lake part). `whl/cpu` loads the same model and generates. That is
  what `LLAMA_CPP_INDEX` pins, with the reasoning in place: Gemma runs between
  chunks with H3 unloaded, which is the one moment the GPU is idle anyway.
- Gemma downloads itself on first use — ~7.7 GB of weights plus a 0.18 GB
  projector and a 0.47 GB MTP assistant, into `comfy/models/llama_cpp/`.

The H3 duration ladder is H3's own, not the shared one: the shared ladder stops
at 20s because that is where LTX stops fitting on this card.

### 3.1 Status: wired and driving, blocked on the pack

Verified on Aurea's side of the boundary: the node registers, the graph is
accepted, the plan is real — *"Preparing 2 chunks at 24 fps; Video1 continuation
carries 22 frames at full"*, chunk 1 owning global frames 0–361 and chunk 2
357–480 — Gemma writes the per-chunk prompt, chunk 1 samples, and the handover
into chunk 2 happens. Three contract errors were found and fixed on the way (the
missing required inputs, the `[Shot 1]` timestamp rule, the reference-head
requirement).

**A finished long take has not been produced yet**, for reasons that are all
upstream of Aurea:

1. The pack's Gemma worker reads its subprocess pipe as strict UTF-8, and
   llama.cpp writes a byte that isn't (`UnicodeDecodeError: 'utf-8' codec can't
   decode byte 0x93`). A one-line `errors="replace"` on the seven `Popen` calls
   in `gemma4.py` gets past it — proven locally, then reverted, because forking
   a pinned dependency is the user's call.
2. With Gemma on the CPU build, the planner is the render. Measured: 6m19s for
   pre-production, then 5–25 minutes per chunk at ~5 tokens/s — more wall clock
   than the H3 sampling it exists to direct. `GEMMA_PER_CHUNK_SEC` says so.

So the honest state is: the plumbing is right and the cost is not yet
acceptable. The thing to fix first is a llama.cpp build that runs on this CPU
*and* the GPU — not anything in this repo.

---

## 4 · Files

| Path | What moved |
| --- | --- |
| `apps/desktop/src/hooks.ts` | the start-frame fallback, removed |
| `apps/desktop/src/screens/video/ParamsPanel.tsx` | three-rung Quality, `minimaxTier`, long-shot guidance |
| `apps/desktop/src/screens/video/engineSurface.ts` | H3's own duration ladder, Quality copy |
| `apps/desktop/src/screens/SettingsScreen.tsx` | SageAttention hint |
| `packages/shared/src/index.ts` | `minimaxTier`, `SETTINGS_VERSION`, sage default |
| `packages/core/src/settings.ts` | `migrateSettings` |
| `packages/core/src/runtime/runtime.ts` | `ACCEL_PACKAGES`, cu130, `ENDLESS_NODE_PIN` |
| `packages/core/src/models/registry.ts` | Turbo LoRAs, w4a8 ×2, SLA |
| `packages/core/src/comfy/minimax-graphs.ts` | loader by format, tier table, chunked sampler |
| `packages/core/src/adapters/minimax-video.ts` | tier + head LoRA choice, w4a8 preference, long-form |
| `packages/core/src/labs.ts` | `longForm` catalog block, corrected rules |
| `packages/core/src/tools.ts` | `minimaxTier` and long-form in the MCP description |
| `scripts/h3-tiers.mts` | the render-cost bench — one variable per arm |
| `scripts/h3-fit.mts` | the one-step probe behind §2.0 |
| `scripts/h3-long.mts` | one chunked render, end to end |
| `scripts/fetch-models.mts` | headless model fetch through the real ModelManager |
