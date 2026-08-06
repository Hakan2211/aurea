# MiniMax-H3 in Aurea

The hero-shot engine. H3 generates **video and its soundtrack in one forward
pass** — dialogue, sound effects and music are modelled jointly with the
picture, not layered on afterwards. That is the one thing the LTX-2.3 pipeline
cannot do, and it is the only reason to pay H3's cost.

It does not replace LTX. It is roughly **10× slower** for the same length on
the same card, and it gives up everything Aurea's Shot Director offers.

## Measured on this machine (3090 Ti, 2026-08-05)

A 4s request → 107 frames at 768 × 448, 25 steps:

| | |
|---|---|
| Sampler | ~9.8 s/it → ~4.1 min for 25 steps |
| Whole prompt, warm | **350 s** (5.8 min) |
| Output | h264 768×448 107f @ 24fps + **AAC 32 kHz stereo** |
| Audio level | mean −37.9 dB, peak −24.5 dB (real sound, not silence) |

768 × 448 is about **a third** of H3's native 1344 × 768 canvas area, so budget
the full canvas nearer the ~20 min the original evaluation predicted. Add a
cold-start penalty on the first run of a session: 24 GB of weights have to come
off disk.

---

## Why it is a separate engine, not another checkpoint

Two facts made this a new job kind rather than an `engine: "ltx2"` branch:

1. **It emits muxed A/V.** Everywhere else in Aurea the contract is "the engine
   renders picture; audio is layered after" — voice takes from
   Chatterbox/DramaBox, score from ACE-Step, placed on a timeline. A voice take
   handed to H3 would simply be ignored, so the adapter rejects it out loud
   instead.
2. **It needs ComfyUI 0.30.0+.** `comfy/ldm/minimax` landed in 0.30.0. The
   proven LTX-2.3 pipeline runs on a 0.28.0 install with the WhatDreamsCost
   node pack. Rather than force one install to be both, H3 queues on its **own**
   ComfyUI.

## The two ComfyUI installs

| | LTX-2.3 (production) | MiniMax-H3 |
|---|---|---|
| Path | `D:\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI` | `D:\Comfy-Desktop\ComfyUI-Installs\ComfyUI-MiniMax` |
| Version | 0.28.0 | 0.30.2 |
| Port | 8000 | 8189 (8188 is the Comfy Desktop app itself) |
| Custom nodes | all of `D:\custom_nodes` | `ComfyUI-GGUF` only |
| Aurea setting | `engines.comfyUrl` | `engines.minimaxUrl` |

The H3 install is a **git worktree** off the Desktop app's own ComfyUI
checkout, so it costs a working tree and not a second clone. It has its own
`.venv` (python 3.13, torch 2.12.1+cu130) so nothing it installs can reach the
production environment.

Start it with:

```powershell
D:\Comfy-Desktop\ComfyUI-Installs\ComfyUI-MiniMax\start-minimax.ps1
```

`PYTHONUTF8=1` is set in that script on purpose — a node printing a traceback
through cp1252 kills ComfyUI startup on this machine. `PYTHONUNBUFFERED=1` is
there for a subtler reason: without it a host that captures stdout only sees
the first block of the boot log, which cuts off *before* the custom-node import
table — exactly the part you need when a node fails to register.

### Two traps this setup walked into

**Port 8188 belongs to the Comfy Desktop app.** It launches its own ComfyUI
there, and whichever process binds first wins. Probing 8188 and finding the
MiniMax nodes but *no* GGUF nodes is the signature of talking to the Desktop
app's server instead of this one. Hence 8189.

**Don't put `2>&1` on a native exe in a PowerShell launcher.** PowerShell wraps
a native command's stderr in ErrorRecords, so ComfyUI's ordinary `[INFO]` lines
become a `NativeCommandError` and kill the script under
`$ErrorActionPreference = 'Stop'`.

## Two heads: fl2va and ref2va

H3 ships as two separately trained checkpoints on one text encoder and one pair
of VAEs. They are not modes of a single file, and Aurea gates them separately.

| | **fl2va** (`MiniMaxH3ImageToVideo`) | **ref2va** (`MiniMaxH3ReferenceToVideo`) |
|---|---|---|
| Conditioned on | a first and/or last frame | up to 9 stills, 3 clips, 3 sound clips |
| Keyframes | that's the whole idea | **none** — the node has no frame input |
| Model entry | `minimax-h3-gguf` | `minimax-h3-ref-gguf` (+15.6 GB) |
| Aurea payload | `startFrame` / `endFrame` | `minimaxRefs` |

`minimaxRefs` present and non-empty switches the render to ref2va. Passing a
start frame at the same time is an error rather than a silent drop — there is
nowhere for it to go.

### The tags are the interface

Every reference is presented to the model with a label, and the prompt has to
name it:

```
Bold comic-book ink, night city.
Use <Picture 1> as the boy and <Picture 2> as the kaiju, and hold
<Video 1>'s camera move. He speaks in the voice of <Audio 2>.
```

The tags are not metadata — the text encoder literally prepends `"<Picture 1>: "`
before each still's vision block and appends your prompt after all of them
(`comfy/text_encoders/minimax.py`). So an unnamed reference still conditions the
shot, but nothing tells H3 what part it plays, and `<Picture1>` is a different
string rather than a forgiven variant. Referenced **audio never reaches the
language model at all** — it gets a text label and goes straight to the DiT, so
naming it in the prompt is the only handle you have on it. Aurea computes the tags in `minimaxRefLabels()` (shared, so the panel
and the adapter agree) and **rejects a prompt that names a tag the shot doesn't
have** — that failure is otherwise invisible until you watch the output.

**The numbering trap.** Ordinals are 1-based *per type*, and a reference clip's
own soundtrack takes an `<Audio j>` of its own, emitted immediately before its
`<Video k>`. So one clip-with-sound plus one voice clip means the *voice* is
`<Audio 2>` — the opposite of the order they were attached in. This is the one
thing about ref2va that is guessed wrong every time, which is why it has its own
test.

### Editing a clip

There is no separate edit mode: reference the clip and describe the change.

```
minimaxRefs: { videos: [{ video: "…/take.mp4", lengthSec: 3, useItsAudio: false }] }
prompt: "Keep <Video 1>'s staging, blocking and camera exactly. Restyle it as
         a night exterior lit by sodium streetlight."
```

The take is **regenerated, not composited** — a new performance of the same
idea, with its own soundtrack. That makes it the right tool for a restyle or a
redirect and the wrong one for a two-second artefact; LTX's `shot_retake` still
owns in-place repair.

### What it costs

Reference frames are VAE-encoded and ride through **every** sampling step, so a
reference is not a pointer — it is tokens. Aurea trims and retimes each clip
with ffmpeg before upload (24 fps, a 768 short edge, the requested window) for
three reasons that all fail quietly otherwise:

- H3 reads a reference at 24 fps; hand it 30 fps footage and every motion it
  copies runs 25% slow, with no error anywhere.
- The node crops a reference to the take's own frame count, so anything past
  that was decoded for nothing.
- `ref_image_size: "max"` (2048px short edge) holds identity harder and costs
  several times more. `"match"` is the default for a reason.

**And it moves the VRAM ceiling.** Measured 2026-08-05 on the 3090 Ti: a 3-second
reference clip OOM'd where the same shot with a reference *still* rendered fine
— encoding the clip's frames through the video VAE asked for 2.9 GB on top of
the 19.7 GB an external ComfyUI was still holding from the previous job. So the
adapter frees the server's memory **before a render that carries a clip or
2048px stills, and only then**. Stills at `"match"` rendered fine on the same
warm card, and neither they nor fl2va should pay a 24 GB reload for a problem
they don't have.

The autogrow inputs are addressed by their **dotted path** in an API graph —
`ref_images.ref_image_0`, 0-based and contiguous. Not a list, not a bare name.
A wrong name here does not fail: ComfyUI accepts the prompt and renders with no
references at all. `minimax-graphs.test.ts` pins the exact strings, and
`scripts/test-minimax-h3-ref.mts` re-checks them against a live server.

## Weights (the Ampere-safe set)

An RTX 3090 Ti is Ampere: no FP8 or FP4 tensor cores, so the NVFP4 text encoder
Comfy-Org publishes is off the table and **GGUF is the only viable path**.

| File | Size | Where |
|---|---|---|
| `MiniMax-H3-FL2VA-Q3_K_M.gguf` | 15.58 GB | `diffusion_models/` |
| `qwen3vl-32B-MiniMax-H3-Q2_K.gguf` | 8.49 GB | `text_encoders/` |
| `minimax_h3_video_vae_fp16.safetensors` | 5.21 GB | `vae/` |
| `minimax_h3_audio_vae_fp32.safetensors` | 0.61 GB | `vae/` |

All four live under `D:\AIModels\Aurea-models\minimax-h3-gguf\` and are
registered in the model manager as `minimax-h3-gguf`.

The reference head is a fifth file under its own id, so the working fl2va setup
never goes "not installed" because a second checkpoint appeared in the registry:

| File | Size | Where |
|---|---|---|
| `MiniMax-H3-REF2VA-Q3_K_M.gguf` | 15.58 GB | `minimax-h3-ref-gguf/diffusion_models/` |

Q2_K for the text encoder is not timidity: the 32B encoder and the 15.6 GB unet
both have to fit the same 24 GB card. ComfyUI loads and frees them in sequence,
so peak VRAM is `max(encoder, unet)` rather than the sum — but only if neither
one alone blows the budget.

**No ComfyUI-GGUF patch was needed.** The quantizers declared
`general.architecture = "wan"` on the unet and `"qwen3vl"` on the encoder, and
both are already in ComfyUI-GGUF 1.1.10's accept lists. `CLIPLoaderGGUF`
inherits its `type` options from core's `CLIPLoader`, so `"minimax"` appears
once core is 0.30.x.

## Licence

**MiniMax H3 Community License Agreement** — not Apache, not MIT. Read it before
any commercial Aurea output. The model manager gates the download behind
explicit acceptance for exactly this reason.

## Using it

The whole control surface is the prompt. There is no timeline node, no audio
lane, no IC-LoRA. `lab_catalog('video').minimax` carries the limits and the
rules; the shape that works:

```
Cinematic breakroom two-shot, warm practical lighting, shallow depth of field.

Timeline:
[0s-2s] Sterling leans against the counter, turning his mug slowly.
[2s-5s] Bruno pushes through the door and stops short.

Camera: static medium two-shot, no push-in.

Audio: Sterling says "You switched the beans." in a dry, tired baritone.
Bruno answers "I improved the beans." Room tone of a humming fridge
underneath, no music.
```

Constraints the adapter enforces:

- **4–15 seconds.** Below 4s it refuses rather than render a stub.
- **No voice take.** Attaching one is an error, not a silent drop.
- **No Director timeline.** `payload.director` is rejected with a pointer to LTX.
- Length snaps **up** to the model's 17k+5 frame grid at 24 fps (5s = 124
  frames). Off-grid lengths fail *inside* the node, after 24 GB of weights have
  been read off disk — hence `frameLength()` and its test.
- Native canvas is a 768 short edge, sides on a multiple of 32. `1344 × 768`
  and `768 × 1344` are in the Video lab's resolution list.

Finished takes carry `meta.engine = "minimax-h3"` and `meta.nativeAudio = true`
in their provenance sidecar, so the timeline treats them as already-scored
rather than as mute clips waiting for a voice track. The ffmpeg export already
probes clips for embedded audio and mixes it, so an H3 take needs nothing
special on a timeline.

## Scheduling

The adapter takes the `gpu` lane under `engineId: "comfy"`, the same id LTX
uses — both want the whole card, and two 20 GB models racing for 24 GB is how
you OOM a queue.

It deliberately declares **no `vramGb`**. H3 only ever runs on an external
ComfyUI, and an external instance owns its memory: it keeps the last model
resident and frees it when the next one needs room. Declaring a 21 GB
requirement makes the scheduler preflight against free VRAM it does not
control, so the *second* H3 job of a session parks in "Waiting for VRAM"
forever behind the weights the first one left warm. (Found exactly that way on
2026-08-05.) The LTX adapter skips the estimate in its own external mode for
the same reason.

If you do need the card back without queueing anything:

```
curl -X POST http://127.0.0.1:8189/free -H "Content-Type: application/json" \
     -d '{"unload_models":true,"free_memory":true}'
```

## Files

| What | Where |
|---|---|
| Graph builders | `packages/core/src/comfy/minimax-graphs.ts` (`minimaxH3Graph`, `minimaxH3RefGraph`) |
| Adapter | `packages/core/src/adapters/minimax-video.ts` |
| Tests | `packages/core/src/comfy/minimax-graphs.test.ts` |
| Reference tags | `packages/shared/src/index.ts` (`minimaxRefLabels`, `unknownMinimaxRefTags`) |
| Registry entries | `packages/core/src/models/registry.ts` (`minimax-h3-gguf`, `minimax-h3-ref-gguf`) |
| Catalog + rules | `packages/core/src/labs.ts` (`videoCatalog`, `.minimax.reference`) |
| Video lab panel | `apps/desktop/src/screens/VideoLab.tsx` (`ReferenceLane`) |
| MCP tool | `packages/core/src/tools.ts` (`reference_video`) |
| Smoke tests | `scripts/test-minimax-h3.mts`, `scripts/test-minimax-h3-ref.mts` |
| Settings field | `engines.minimaxUrl` |
