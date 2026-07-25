# Model distribution — how weights reach a user's machine

**Status:** decision doc — **linked roots IMPLEMENTED 2026-07-20**, see
"Implementation" below for what actually shipped. Written after Edit-with-refs
failed on this machine with *"Qwen Image Edit 2509 (GGUF) weights are not
installed"* while the exact same 22.9 GB of weights sat unused in `D:\models`.

That failure is not a bug in the Image lab. It is the model-distribution
story showing its seam, and it is the same seam every user will hit.

---

## The problem, stated once

Aurea ships an app. It cannot ship the weights — the image + video + audio
set is well past 100 GB, most of it under licenses that forbid
redistribution. So every install has a cold-start problem: **the app works
only after tens of gigabytes arrive from somewhere.**

There are exactly three places weights can come from:

| Source | Bytes to download | Needs | Who it suits |
|---|---|---|---|
| **Managed store** — the model manager downloads into `<dataRoot>/models/<model-id>/<category>/<file>` | Full | Nothing | A fresh user with no AI tooling |
| **External ComfyUI** — point `comfyMode: external` at a running ComfyUI | Zero | That ComfyUI running, forever | Someone who lives in ComfyUI already |
| **Linked roots** — mount a folder the user already has, read-only | Zero | Nothing running | Anyone with an existing ComfyUI/A1111/Forge library |

Today Aurea implements the first two. The third does not exist, and it is
the one that matters most for distribution.

---

## Why "just download it" is not enough

The managed store is the correct **default**, and it should stay the
default. It is the only option that works for a user who has never heard
of ComfyUI, and it is the only one where Aurea controls the layout, the
integrity checks, and the licence gating.

But it is a bad *only* option:

- **The duplicate-download problem.** A large share of the target audience
  already owns these weights. Krea 2, Qwen-Image-Edit, LTX-2.3 and Z-Image
  are the same public files everyone pulls from the same Hugging Face
  repos. Making that user re-download 23 GB they already have — onto a
  different drive, no less — is the kind of thing that gets an app
  uninstalled before it renders a frame.
- **The disk-topology problem.** `dataRoot` defaults to the user profile,
  i.e. `C:`. Model libraries live on the big spinning/second drive. On this
  machine that is precisely the split: `C:\Users\User\Aurea\models` for
  managed, `D:\models` for everything real.
- **The cold-start cliff.** First-run currently means "wait for 20+ GB
  before the first image". Linked roots turn that into "we found your
  library, you're ready" for a meaningful fraction of users.

## Why "just use external ComfyUI" is not enough either

It solves the bytes but creates a dependency the app cannot control: a
second application that must be installed, launched, kept at a compatible
version, and which holds VRAM Aurea then has to fight for (see the
`POST :8000/free` gotcha). It is the right escape hatch for a power user.
It is not something to hand a stranger.

---

## Recommendation

**Ship all three, in this priority order, with managed as the default.**

1. **Managed (default).** Unchanged. First-run wizard offers the essential
   set; everything else downloads on demand when a lab needs it.
2. **Linked roots (build this).** A user points at one or more existing
   model folders. Aurea mounts them read-only and treats weights found
   there as installed. Never writes, never deletes, never verifies
   checksums for them — they are the user's files.
3. **External ComfyUI (unchanged).** Stays as the power-user escape hatch.

The decisive property of linked roots is that **it degrades correctly**: a
user with nothing gets the managed path; a user with a library gets an
instant start; nobody is forced into a second application.

---

## Implementation — linked model roots (shipped 2026-07-20)

Built as described below, with these notes from the build:

- **Category aliases were required, not optional.** The registry names the
  qwen-edit weight `diffusion_models/Qwen-Image-Edit-2509-Q5_K_M.gguf`; every
  real ComfyUI install keeps GGUF diffusion weights in `unet/`. Matching
  treats `diffusion_models`↔`unet` and `text_encoders`↔`clip` as the same
  category, and linked roots mount both.
- **`ready()` replaced every `status.state === "installed"` check** across
  labs.ts, comfy-image, comfy-video, tts, music — otherwise a linked model
  runs but the lab's picker still says "not installed".
- **`managedCopy()` is a separate question from `ready()`.** Loader-name
  resolution asks the first (is this file *ours*?), preflight asks the second
  (can we run at all?). Conflating them is exactly the bug the old
  `managed ? X_MANAGED : X_EXTERNAL` binary had.
- Verified on the real `D:\models`: 6 models / 103.5 GB detected, bare-name
  resolution for linked, `<id>/<category>/<file>` for a managed copy, managed
  copy winning over linked, external mode forcing bare names, and `remove()`
  refusing to touch a linked file. 22 checks + 8 YAML checks, all passing.

### Original plan

### 1. Settings

```ts
storage.modelRoots: string[]   // absolute paths, conventional ComfyUI layout
```

Conventional layout means the categories ComfyUI itself uses —
`unet/`, `diffusion_models/`, `text_encoders/`, `clip/`, `vae/`,
`loras/`, `upscale_models/`. This is what `D:\models` already is, and what
every ComfyUI install is.

### 2. Mount them in the managed engine

`EngineRuntime.writeExtraModelPaths()` already emits one YAML block for the
managed store. Emit one additional block per linked root, mapping each
category to itself:

```yaml
aurea:
  base_path: C:/Users/User/Aurea/models
  diffusion_models: "."
  # …every category, flat — graphs address these as <model-id>/<category>/<file>

linked_0:
  base_path: D:/models
  unet: unet
  diffusion_models: diffusion_models
  text_encoders: text_encoders
  vae: vae
  loras: loras
  upscale_models: upscale_models
```

Note the asymmetry, which is the whole trick: the managed block is flat so
graphs can use collision-proof `<model-id>/<category>/<file>` names; linked
blocks keep conventional names so graphs must use the **bare filename**.

### 3. Teach ModelManager to adopt

A registry entry becomes satisfied when *every* file in `files[]` is found
by basename under some linked root's matching category. Report it as a new
status state:

```ts
status: { state: "linked", root: "D:\\models" }
```

Rules that keep this honest:

- **Never checksum a linked file.** It is the user's file; a hash mismatch
  is not Aurea's business to enforce and would only produce false alarms
  against legitimately different quantisations.
- **Never delete a linked file.** `models.remove` must refuse.
- **Managed copy wins** when both exist, so an explicit download always
  takes precedence over a discovered one.
- Re-scan on settings change and on model-list query; this is a cheap
  `fs.existsSync` sweep, no index to invalidate.

### 4. Resolve graph names through the manager

This is the load-bearing refactor. Today every adapter does:

```ts
managed ? QWENEDIT_MANAGED : QWENEDIT_EXTERNAL
```

…a binary that no longer describes reality, because a *managed* engine can
now be reading a *conventionally named* linked file. Replace it with a
resolver that returns the right name per file:

```ts
this.models.comfyNames("qwen-image-edit-2509-gguf")
// managed copy → { unet: "qwen-image-edit-2509-gguf/diffusion_models/Qwen-…gguf", … }
// linked       → { unet: "Qwen-Image-Edit-2509-Q5_K_M.gguf", … }
```

`*_MANAGED` / `*_EXTERNAL` constants in `graphs.ts` collapse into registry
metadata: each registry file already knows its category and filename, which
is everything the resolver needs. Touches `comfy-image.ts`,
`comfy-video.ts`, and the music/tts adapters that name weights.

### 5. Preflight guards

The adapter guards currently throw on
`models.list().find(...)?.status.state !== "installed"`. They become
`state !== "installed" && state !== "linked"`. Same message, one more
accepted state.

### 6. UI

- **First-run wizard:** after the storage step, offer *"Already have a model
  library? Point us at it."* with a folder picker, then show what was found
  ("Found 6 of 9 models in D:\models — 23 GB you don't need to download").
  This is the moment with the highest possible payoff.
- **Settings → Models:** a "Linked folders" section listing roots with
  add/remove, and each model card showing `Linked · D:\models` instead of a
  download button.

### 7. Packaging consequence

None. Linked roots are pure configuration — no extra bytes in the
installer, no new runtime component. That is a large part of why this is
the right feature.

---

## What this machine should do right now

This box is the power-user case and the developer box at once:

- `D:\models` already holds every weight the Image lab needs, in exactly
  the conventional layout linked roots expect. It is the ideal first test
  fixture for step 2–4.
- Until linked roots land, the zero-download unblock is
  `comfyMode: external` against Comfy Desktop on `:8000`, which reads
  `D:\models` natively.
- The two genuinely missing files, either way, are
  `RealESRGAN_x4plus.pth` (67 MB, already in the managed store — a copy,
  not a download) and `qwen_image_edit_2511_upscale.safetensors`
  (590 MB, the Upscale2K LoRA) into `loras/`.

---

## Open questions

- **Quantisation mismatch.** A linked `Qwen-Image-Edit-2509-Q4_K_M.gguf`
  is not the `Q5_K_M` the registry names, but it would work fine. Should
  matching be exact-filename (safe, misses cases) or
  fuzzy-by-model-family (helpful, can pick something surprising)? Start
  exact; revisit with a "choose which file" picker.
- **Multiple roots, same file.** First root wins, roots are ordered, order
  is user-editable. Cheap and predictable.
- **A1111/Forge layouts** use different folder names (`Stable-diffusion/`,
  `Lora/`). Worth a layout-preset dropdown later; ComfyUI layout only for v1.
