# 3D lab — Hunyuan3D-2.1 (2026-08-30)

A concept still becomes a textured GLB you can turn. Route `/3d`, nav under
**Labs**, assets land on the `model3d` shelf.

## Why this engine, and why no install

`D:\hunyuan3d` already held a working, tested standalone runner — `generate.py`
driving the Windows-adapted pipeline code from
`visualbruno/ComfyUI-Hunyuan3d-2-1` with its own venv (Python 3.12, torch 2.6
cu126) and ~30 GB of model caches under `D:\AIModels\hy3dgen`. videofast drives
it from `models3d/gen_scene_models.py`. Aurea points at that same install
rather than building a second copy, through `engines.hunyuan3dDir` /
`hunyuan3dPython` with a `D:\hunyuan3d` convention probe as the fallback — the
same operator-owned escape-hatch shape as ACE-Step and MiniMax-Music3.

Nothing was downloaded to ship this lab. The work was Aurea-side plumbing.

## The two ways in

They look like one form with a switch; they are two different tasks.

**From a prompt** is exploratory. You name an object and the lab enqueues an
*image* job first, wrapping your subject in the framing the shape model was
trained on — one subject, centred, three-quarter view, pure white seamless
background, soft even light, no ground shadow. That wrapper is the difference
between a usable plate and a wasted three minutes, so the lab owns it rather
than leaving it to the operator. When the still lands, `server.ts`'s
`importOutput` chains the mesh job onto it — the same "the second job needs a
file the first had to produce" shape as music cover art. The shelf folds both
into **one** row: the concept still is scaffolding, and listing it separately
reads as two things having been made when one was asked for.

**From an image** is production. A keyframe, a photo, a still you already
trust, lifted as-is. Anything without an alpha channel has its background
removed first (u2net), which rarely improves the shape — a clean plate in is
still the whole game.

## Inside one job

| stage | what happens | share of the time |
|---|---|---|
| shape | flow-matching DiT samples an occupancy field; marching cubes meshes it; floaters and degenerate faces are removed; the mesh is decimated | ~⅓ |
| paint | multiview diffusion renders six views, they are baked onto a UV atlas and the seams inpainted | ~⅔, skipped entirely when `textured` is false |

Measured on the 3090 Ti: **115.7s** untextured at octree 256; **180s** textured
at octree 256; **189s** for the shipping config (octree 384, 60k faces, 1024px
maps). The prompt path adds the concept still on top of that.

The runner caches the shape to `<out>.shape.ply`, so a paint-stage failure
costs the paint pass only on a retry. That file lives in the job's scratch dir
(`~/.aurea/runs/<jobId>/out/`), not beside the delivered asset — `job.output`
is where the importer *put* the artifact, not where it was built.

## Things that had to be got right

- **Progress must not stand still, and getting there took two fixes.** Both
  long stages narrate through tqdm rather than log lines, so mapping only the
  `[hy3d] …` lines leaves the bar frozen for the 30s shape sample and again
  for the two-minute paint — precisely the "is it stuck?" the Music3 engine
  was suffering from. So the adapter maps each log line to the *start* of a
  span and interpolates the tqdm percentage across it. But:
  1. **tqdm redraws with a bare carriage return and no newline**, so its
     updates sat unterminated in `runProcess`'s buffer and `onLine` saw
     nothing at all until a bar finished. The interpolation was wired and
     still frozen. `runProcess` now takes an opt-in `splitCarriageReturns`
     (off by default — the other adapters' engines narrate in whole lines and
     shouldn't pay for the extra callbacks).
  2. **A stage can contain several tqdm bars.** The paint stage emits two
     `Loading weights` passes and *then* the anonymous ten-step diffusion bar
     that is the actual two minutes. Interpolating whichever bar spoke last
     races to the end of the span in a second and then jumps backwards twice,
     so each stage nominates which bar carries its work and ignores the rest.
- **Start from an empty card.** The shape DiT and the paint pipeline each want
  most of the 24 GB. The adapter asks whichever ComfyUI is reachable to unload
  before starting, following the H3 and Music3 precedent; the scheduler's own
  preflight (`vramGb: 16`) evicts Aurea's managed sidecar.
- **The licence travels with the file.** Hunyuan3D 2.1 outputs are bound by the
  Tencent Community License: attribution required, and not licensed in the EU,
  UK or South Korea. The runner writes both strings into `<out>.stats.json`;
  the adapter copies them into the asset's sidecar and the lab prints the
  obligation under the Generate button. An obligation that lives only in a doc
  travels with nothing.

## The viewer

`components/GlbViewer.tsx` — three.js r182: a neutral studio environment plus a
plain white key/fill/rim, orbit, a turntable you can stop, and a wireframe
toggle. Deliberately small: it answers "is the back there, did the texture
bake, how dense is it" and nothing else.

**The environment map is not decoration.** A metallic PBR material with no
environment has nothing to reflect and renders *black*. The first textured
kettle through this viewer came out a near-black silhouette with a few specular
highlights on it and looked like a failed bake; with a `RoomEnvironment` PMREM
behind it, the same file is polished brass with a wooden handle. A viewer whose
entire job is answering "did the texture bake?" cannot answer it without one —
this is the one place where adding light is the honest choice, not the
flattering one.

The rig is otherwise neutral on purpose. The camera fits to the loaded bounding
box rather than assuming a scale — Hunyuan normalises to roughly a unit cube,
but a mesh that arrives at 100× still has to be visible. Everything (geometry,
textures, materials, the PMREM targets) is disposed on unmount; a GL context per
preview would leak the card dry after a dozen models.

## Verification

`npx tsx scripts/test-model3d.mts [--textured] [--prompt]`

The default is the fast path (an existing still, shape only) because that is
the assertion worth running often. It checks the engine catalog, the GLB on
disk, the shape cache, that the stage names cover both halves, the library
import, and that the sidecar carries the face count, the licence obligation and
a working pointer back to the still it was lifted from. It also asserts the bar
took at least eight distinct values between 5 and 96 — i.e. that it moved
*inside* the stages and not just between them, which is the only way to catch
either of the two frozen-bar failures above.

One trap in the harness itself: jobs carry no timestamp and finished ones stay
in the list, so a run matching only on `payload.type === "model3d"` latches onto
the *previous* run's completed job and "passes" in 0 seconds. Snapshot the job
ids before enqueueing.

## Where this could go next

- **Hunyuan3D-2mv** (multiview) takes up to four views for markedly better
  shape fidelity. Same venv and same paint stage; it needs its own weights
  download and a second runner path. The natural pairing is a Storyboard shot's
  existing front/side keyframes.
- **TRELLIS.2-4B** is the quality leader but a fresh install: new repo, new
  venv, ~10 GB of weights, and an unproven VRAM fit next to everything else on
  this card.
- **Shot-attached props.** `model3d` assets are library citizens already; the
  missing piece is a Studio affordance to hang one on a shot as a prop or set
  piece.
