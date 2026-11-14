# MiniMax-Music3 — status

The engine renders real songs through Aurea. This doc is the measured
configuration and the traps that cost time getting there — first the original
build (2026-08-14), then the warm-worker rebuild (2026-08-30) that fixed
"it's either super slow or it stops at 45%".

## What was actually wrong (2026-08-30)

Two separate faults wearing one coat.

**"Stops at 45%."** It never stopped. The adapter reported `progress: 45` when
the script printed `generating...` and then emitted nothing at all until the
WAV landed — for a three-minute song, half an hour of a frozen bar. Three
killed runs in `~/.aurea/runs` (`j-2700ce1a`, `j-a8b5baa3`, `j-77cc660f`) each
end a few seconds into generation with no error in the log: those are cancels,
not crashes. Somebody waiting on a bar that never moves eventually stops it.

**"Super slow."** Two causes, both measured:

1. **~95s of warm-up on every single song.** 40s to load the components and a
   further **59.5s for the first CPU→GPU placement**. That second number is
   not a PCIe transfer — raw H2D on this box measures 5.4 GB/s pageable, which
   would move the 8B language model in ~3s. The safetensors are mmap'd, so the
   first `.to("cuda")` is really a disk read. In the same process the *second*
   placement costs **4.9s**, because the weights are then real pages in host
   RAM.
2. **VRAM oversubscription, silently.** A 30s song peaks at 17.6 GiB of 24. If
   a ComfyUI (Aurea's own, or the operator's Desktop install on :8188) is
   holding its last model, the pipeline does not fail — Windows pages GPU
   memory to host RAM and the run continues at roughly a tenth of the speed.
   Measured here: the autoregressive stage fell from **~14 frames/s to ~1.4**.
   This is the identical failure the H3 adapter documents at 130 s/step.

### Where the time goes (30s song, 3090 Ti, instrumented per block)

| phase | cold | warm |
|---|---|---|
| pipeline load | 40.8s | — |
| LM placement + prefill | **59.7s** | **4.9s** |
| autoregressive (750 frames) | 49.9s @ 15.0 fps | 26.0s @ 14.4 fps (15s song) |
| flow-matching denoise (210 steps) | 36.5s @ 5.8 it/s | 17.6s |
| vocoder decode | 0.8s | 0.3s |

A 15s song: **107.7s cold → 48.3s warm**. Third run in the same process: 48.3s.

## The fix: a warm worker

`adapters/minimax-music-worker-script.ts` is a long-lived python process that
loads the pipeline once and serves songs off stdin (one JSON object per line
each way, framed by an `@@AUREA ` marker so tqdm bars and HF warnings can never
be mistaken for protocol traffic). `adapters/minimax-music-worker.ts` owns it
from studiod's side and registers as a `WarmEngine` on the GpuScheduler.

Things that turned out to matter:

- **Release the card before announcing the song is done.** The first version
  emitted `done`, then pushed components back to CPU. The scheduler admitted
  the next job against a GPU this process still held 17 GiB of, saw 1.1 GB
  free, and parked it for **80s — longer than the warm render it was waiting
  to start**. `release_vram()` now runs before the `done` event.
- **`warm()` must mean "holding VRAM", not "process alive".**
  `GpuScheduler.preflight` *skips the VRAM check entirely* when a job's own
  engine is warm, reasoning that resident weights are the memory the job needs.
  True for the ComfyUI sidecar; false here, because the worker deliberately
  drops to ~0 VRAM between songs and still needs its 20 GB. Reporting `true`
  reintroduced the oversubscription bug. It now reports `pending !== undefined`,
  which is false at every admission — exactly the intent.
- **`D:\music3env\Scripts\python.exe` is a redirector stub.** It spawns the
  base `Python312\python.exe`, and *that* child loads the 11B pipeline and
  holds the VRAM. Killing the stub alone orphans a process sitting on ~17 GB
  of the card — which is how one benchmark ended up at 1.4 fps with nothing
  visibly running. `taskkill /T` covers the live case; `killStaleWorkers()`
  sweeps by command line at startup for the case no parent survives.
- **Free ComfyUI's VRAM before every render**, like the H3 adapter. The
  scheduler can evict Aurea's managed sidecar, but a ComfyUI the operator
  launched themselves is not Aurea's to stop — asking it to unload is all
  there is, and it is enough.
- **Time each stage from its own first unit.** Measuring the AR rate from the
  job's start folds the 60s placement stall into it and inflates every estimate
  behind it (the ETA read 133s when the truth was 51s, and the degraded-rate
  detector fired on every cold run).

### Progress and the ETA

`_embed_audio_frame` runs exactly once per emitted frame, and the denoise
loop's progress bar once per Euler step; both totals are known before the work
starts. The worker reports one fraction weighted by *measured seconds* per
unit rather than by unit count — weighting by count makes the bar crawl through
generation and sprint through denoise. Rates are re-measured live (after 20
frames / 10 steps), so the ETA converges within a few seconds and the stage
line reads `Composing — 12s of 30s written · ~48s left`.

When the AR loop runs below 40% of this card's known rate, the worker sets
`degraded` and the stage line says **"GPU memory is oversubscribed — close
other GPU apps"**. That is the only signal that reaches an operator when the
driver is paging: everything else looks like a bar that is technically moving.

### Idle behaviour

After each song the worker pushes every component back to CPU and drops the
CUDA cache, so an idle worker holds about a gigabyte of VRAM rather than 17.6
GiB. What it keeps is ~22 GB of *host* RAM of warm weights — that is precisely
what makes the next placement cost 4.9s instead of 59.5s, and on a 32 GB box it
is a lot to sit on, so `WORKER_IDLE_MS` (10 min) gives it back. The scheduler
can also evict it outright when another engine wants the card.

## Original build notes (2026-08-14) — still true

- **Do not group-offload the language model.** `use_stream=True` pre-pins ~16
  GB of page-locked *host* memory and dies with a misleading `CUDA error: out
  of memory` while 23 GB of VRAM sits free. Even working, it costs **1750s vs
  141s** for the same song. `ComponentsManager.enable_auto_cpu_offload` alone
  peaks at 17.6 GiB, which fits.
- **Instrumental needs a tag-only lyric block, not an empty one.** The text
  encoder raises `lyrics must be a non-empty string`, so unlike ACE-Step there
  is no "omit it" path. The adapter sends `[intro]/[instrumental]/[outro]` for
  instrumentals and `[verse]/[chorus]` for wordless singing.
- **The pipeline returns numpy, not a torch tensor** on some component paths.
  `audio.T.float()` threw *after* a 29-minute generation and threw the render
  away. Normalise before `sf.write`.
- **A smart dash in a `.ps1` breaks the parser** — keep generated scripts ASCII.
- **Cover art looks missing but isn't.** The chained cover job is batch
  priority and needs ComfyUI, so a harness that closes studiod the moment the
  song lands leaves it `queued`.
- Music assets have library kind **`music`**, not `audio`.
- Weights `D:\models\MiniMax-Music3` = 53.41 GB (179 files). Venv
  `D:\music3env` (Python 3.12, torch cu126, diffusers pinned `dafe3733`).

## Verification

`npx tsx scripts/test-music3.mts [--instrumental] [--warm]`

`--warm` renders a second song in the same studiod and asserts the worker
actually paid off. The harness also guards the regression directly: it records
every distinct progress value and fails unless the bar took at least five
values between 5 and 96, and requires the stage line to name the phase and
carry an ETA.

## The delivery trap this fix fell into

Worth reading before shipping any other engine change.

Electron loads `dist-electron/studiod.js` **once, at startup**. Rebuilding it
while the app is open does nothing at all: the app keeps serving the old
backend and looks completely healthy doing it.

That is exactly what happened here. The warm worker was written, measured and
verified end to end at 10:53; the app had been running since 09:23. For the
next half hour the Music lab still sat at 45%, because the app was still
running the *pre-fix* adapter - the one with a single hardcoded
`report({ progress: 45 })` - and still spawning `music_minimax3.py`, a script
that no longer existed in source. Three checks settle it in seconds:

- `curl -H "Authorization: Bearer <token>" http://127.0.0.1:<port>/labs.model3d.catalog`
  - a 404 means the running backend predates the 3D lab.
- `Get-CimInstance Win32_Process | ? { $_.CommandLine -like '*music3*' }` -
  `music_minimax3.py` is the old path, `music3_worker.py` is the new one.
- The port file's pid vs. the app's start time vs. the bundle's mtime.

**A core change is not delivered until the app is restarted.** Quit and
relaunch through `scripts/launch-aurea.ps1`, which rebuilds anything stale on
the way up.

Since this cost a whole round of "your fix doesn't work", the app now says so
itself: `packages/core/src/buildstamp.ts` compares the mtime of the file
studiod was loaded from against its own boot time, `system.overview` returns it
as `staleBuild` (computed per request, so it appears the moment a rebuild
lands), and the global status strip shows a gold **"Update ready - restart
Aurea"** pill. `buildstamp.test.ts` holds it to both halves - quiet on a fresh
boot, loud after a rebuild - because a warning that never fires is worse than
no warning at all.
