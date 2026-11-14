/* The MiniMax-Music3 *worker*: one long-lived process that loads the 11B
 * pipeline once and then serves songs off stdin. It replaces the per-job
 * script because the measured cost of a cold start dwarfs the song itself on
 * this card — 40s to load the components plus 59.5s for the first CPU→GPU
 * placement (mmap'd safetensors paging off disk; the PCIe transfer alone is
 * ~3s at the 5.4 GB/s this box measures). The second and third songs in the
 * same process pay 4.9s for that placement, so a 15s song goes 108s → 48s.
 *
 * Between songs every component is pushed back to CPU and the CUDA cache is
 * dropped, so an idle worker holds ~0 VRAM and ComfyUI can have the card.
 * The host RAM it keeps warm (~22 GB of weights) is exactly what makes the
 * next placement cheap, and is what the node side's idle timeout gives back.
 *
 * Protocol — one JSON object per line, both directions, framed by a marker so
 * tqdm bars, HF warnings and torch FutureWarnings can never be mistaken for
 * protocol traffic:
 *   in   {"cmd":"gen", id, prompt, lyrics, duration, steps, seed?, out}
 *        {"cmd":"cancel", id} | {"cmd":"shutdown"}
 *   out  @@AUREA {"ev":"loading"|"ready"|"progress"|"done"|"error"|"idle", …}
 *
 * Progress is real: the autoregressive stage is counted per emitted frame
 * (`_embed_audio_frame` runs exactly once per frame) and the flow-matching
 * stage per Euler step (the loop block's progress bar). Both totals are known
 * before the work starts, so the worker reports one blended fraction weighted
 * by measured *seconds* per unit rather than by unit count — otherwise the bar
 * sprints through denoise and crawls through generation. */

export const MINIMAX_MUSIC3_WORKER_SCRIPT = String.raw`"""Aurea MiniMax-Music3 warm worker (generated file - edits are discarded)."""
import json, os, sys, threading, time, queue

MODEL = os.environ["AUREA_MUSIC3_MODEL"]


def emit(**kw):
    sys.stdout.write("@@AUREA " + json.dumps(kw) + "\n")
    sys.stdout.flush()


def fail(message):
    emit(ev="fatal", message=message)
    sys.exit(1)


import numpy as np
import soundfile as sf
import torch

if not torch.cuda.is_available():
    fail("CUDA is required for MiniMax-Music3")

from diffusers import ComponentsManager, ModularPipeline
import diffusers.modular_pipelines.minimax_music3.encoders as _encoders
from diffusers.modular_pipelines.modular_pipeline import LoopSequentialPipelineBlocks

# Measured on a 3090 Ti. Only used to weight the progress fraction and to seed
# the ETA before enough real samples exist; both are re-estimated live.
AR_SECONDS_PER_FRAME = 0.0705
DENOISE_SECONDS_PER_STEP = 0.174
FRAME_RATE = 25.0
CHUNK_FRAMES, CHUNK_HOP = 200, 100


class Canceled(Exception):
    pass


class Progress:
    """One fraction and one ETA across both stages, measured in seconds.

    Two things make a naive bar lie here. The stages have wildly different
    per-unit costs (a frame is ~70ms, an Euler step ~174ms), so counting units
    makes the bar crawl then sprint - hence weighting by seconds. And the run
    opens with a stall that belongs to neither stage: placing the language
    model on the GPU takes ~60s cold and ~5s warm. Timing the stages from the
    job's start would fold that stall into the observed rate and inflate every
    estimate behind it, so each stage is timed from its OWN first unit and the
    stall is simply time already spent.
    """

    def __init__(self, job_id, frames, steps):
        self.job_id = job_id
        self.frames = frames
        self.steps = steps
        self.ar_done = 0
        self.den_done = 0
        self.t0 = time.time()
        self.ar_t0 = None
        self.den_t0 = None
        self.last_emit = 0.0

    def _ar_rate(self, now):
        # trust the live rate only once it has settled
        if self.ar_t0 is not None and self.ar_done >= 20:
            return (now - self.ar_t0) / self.ar_done
        return AR_SECONDS_PER_FRAME

    def _den_rate(self, now):
        if self.den_t0 is not None and self.den_done >= 10:
            return (now - self.den_t0) / self.den_done
        return DENOISE_SECONDS_PER_STEP

    def degraded(self, now):
        """True when the AR loop is running far below this card's known rate.

        There is one way this pipeline goes catastrophically slow rather than
        merely slowly: it does not fit, and Windows pages GPU memory to host
        RAM instead of failing. Measured here at 1.4 frames/s against a
        baseline of 14 - a three-minute song becomes most of an hour, with
        nothing in any log to say why. The rate is the only signal that
        reaches the operator, so report it rather than let them stare at a bar
        that is technically still moving.
        """
        if self.ar_t0 is None or self.ar_done < 60:
            return False
        return self._ar_rate(now) > AR_SECONDS_PER_FRAME / 0.4

    def tick(self, stage, force=False):
        now = time.time()
        if not force and now - self.last_emit < 0.75:
            return
        self.last_emit = now
        ar_rate, den_rate = self._ar_rate(now), self._den_rate(now)
        spent = self.ar_done * ar_rate + self.den_done * den_rate
        total = max(self.frames * ar_rate + self.steps * den_rate, 1e-6)
        eta = (self.frames - self.ar_done) * ar_rate + (self.steps - self.den_done) * den_rate
        emit(
            ev="progress",
            id=self.job_id,
            stage=stage,
            fraction=min(spent / total, 0.999),
            frames=self.ar_done,
            frames_total=self.frames,
            steps=self.den_done,
            steps_total=self.steps,
            elapsed=round(now - self.t0, 1),
            eta=round(max(eta, 0.0), 1),
            degraded=self.degraded(now),
        )


_state = {"progress": None, "cancel": False}

_orig_embed_audio_frame = _encoders._embed_audio_frame


def _embed_audio_frame(components, frame_codes):
    if _state["cancel"]:
        raise Canceled()
    progress = _state["progress"]
    if progress is not None:
        if progress.ar_t0 is None:
            # the model is on the GPU and the loop is turning: the stage clock
            # starts here, not at the job's start
            progress.ar_t0 = time.time()
        progress.ar_done += 1
        progress.tick("ar")
    return _orig_embed_audio_frame(components, frame_codes)


_encoders._embed_audio_frame = _embed_audio_frame


class _Bar:
    """Stands in for the denoise loop's tqdm; the block only calls update()."""

    def __init__(self, total):
        self.total = total

    def __enter__(self):
        progress = _state["progress"]
        if progress is not None:
            # The language model can stop before audio_duration, so both real
            # totals are only known here: the frames it actually wrote and the
            # windows they chunk into.
            progress.frames = progress.ar_done
            progress.steps = self.total
        return self

    def __exit__(self, *exc):
        return False

    def update(self, n=1):
        if _state["cancel"]:
            raise Canceled()
        progress = _state["progress"]
        if progress is not None:
            if progress.den_t0 is None:
                progress.den_t0 = time.time()
            progress.den_done += n
            progress.tick("denoise")

    def close(self):
        pass


LoopSequentialPipelineBlocks.progress_bar = (
    lambda self, iterable=None, total=None: _Bar(total if total is not None else len(iterable))
)


def planned_units(duration, steps):
    """Frames the AR stage will emit and Euler steps the denoise stage will run."""
    frames = min(int(duration * FRAME_RATE), 9000)
    chunks = 1 if frames <= CHUNK_FRAMES else len(range(0, frames - CHUNK_HOP, CHUNK_HOP))
    return frames, chunks * steps


# ------------------------------------------------------------------ load once
emit(ev="loading")
_t0 = time.time()
manager = ComponentsManager()
manager.enable_auto_cpu_offload(device="cuda")
pipe = ModularPipeline.from_pretrained(MODEL, components_manager=manager)
pipe.load_components(dtype=torch.bfloat16)
emit(ev="ready", seconds=round(time.time() - _t0, 1))


def release_vram():
    """Push every component back to CPU so an idle worker holds no VRAM."""
    for hook in manager.model_hooks or []:
        try:
            hook.offload()
        except Exception:  # noqa: BLE001 - a component that never landed on the GPU
            pass
    torch.cuda.empty_cache()


def generate(req):
    job_id = req["id"]
    duration = float(req.get("duration", 60))
    steps = int(req.get("steps", 30))
    frames, den_steps = planned_units(duration, steps)
    progress = Progress(job_id, frames, den_steps)
    _state["progress"] = progress
    _state["cancel"] = False
    progress.tick("ar", force=True)

    generator = None
    if req.get("seed") is not None:
        generator = torch.Generator("cuda")
        generator.manual_seed(int(req["seed"]))

    free, total = torch.cuda.mem_get_info()
    emit(ev="vram", id=job_id, free_gib=round(free / 2**30, 2), total_gib=round(total / 2**30, 2))

    started = time.time()
    audio = pipe(
        prompt=req["prompt"],
        lyrics=req["lyrics"],
        audio_duration=duration,
        num_inference_steps=steps,
        generator=generator,
        output="audios",
    )[0]

    # The pipeline hands back numpy or a torch tensor depending on the
    # component path; normalise rather than lose a finished render at save time.
    if isinstance(audio, torch.Tensor):
        data = audio.T.float().cpu().numpy()
    else:
        data = np.asarray(audio, dtype=np.float32).T
    out = req["out"]
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    sf.write(out, data, pipe.sampling_rate)
    seconds = round(time.time() - started, 1)

    # Give the card back BEFORE saying the song is done. Announcing first lets
    # the next job be admitted against a GPU this process still holds 17 GiB
    # of: measured, the scheduler saw 1.1 GB free and parked the follow-up for
    # 80s - longer than the entire warm render it was waiting to start.
    release_vram()
    emit(
        ev="done",
        id=job_id,
        out=out,
        seconds=seconds,
        audio_seconds=round(data.shape[0] / pipe.sampling_rate, 2),
    )


# -------------------------------------------------------------- command loop
# stdin is read on its own thread so a cancel can land while a song is in
# flight; the flag it sets is checked from inside both stage hooks.
commands = queue.Queue()


def reader():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        if msg.get("cmd") == "cancel":
            _state["cancel"] = True
        else:
            commands.put(msg)
    commands.put({"cmd": "shutdown"})


threading.Thread(target=reader, daemon=True).start()

while True:
    request = commands.get()
    command = request.get("cmd")
    if command == "shutdown":
        break
    if command != "gen":
        continue
    try:
        generate(request)
    except Canceled:
        emit(ev="error", id=request.get("id"), message="Canceled by user", canceled=True)
    except Exception as exc:  # noqa: BLE001 - any failure must not kill the worker
        import traceback

        traceback.print_exc()
        emit(ev="error", id=request.get("id"), message=f"{type(exc).__name__}: {exc}")
    finally:
        _state["progress"] = None
        _state["cancel"] = False
        release_vram()
        emit(ev="idle")
`;
