/* The managed ACE-Step entry point, embedded as source and written into the
 * job's scratch dir before spawn — no .py asset to locate through bundlers.
 * Runs the runtime's pinned source checkout against the model manager's
 * checkpoints (project_root/checkpoints/… is the layout the engine expects;
 * the registry ships files under that prefix so no copying or linking).
 * Progress lines match gen_music_cli.py's shapes so the adapter parses both.
 * Unlike the CLI, both initialize results are asserted — the CLI ignores
 * them and fails later with a confusing generation error. */

export const ACESTEP_SCRIPT = `"""Aurea managed ACE-Step synthesis (generated file — edits are discarded)."""
import os, shutil, sys, tempfile

ROOT       = os.environ["AUREA_ACESTEP_ROOT"]       # pinned source checkout
PROJECT    = os.environ["AUREA_CHECKPOINT_ROOT"]    # <dataRoot>/models/acestep-v15
CAPTION    = os.environ["AUREA_CAPTION"]
DURATION   = int(os.environ.get("AUREA_DURATION", "30"))
VOCALS     = os.environ.get("AUREA_VOCALS") == "1"
LYRICS     = os.environ.get("AUREA_LYRICS", "")
SEED       = int(os.environ.get("AUREA_SEED", "7203"))
OUT_WAV    = os.environ["AUREA_OUT_WAV"]

LM_MODEL   = "acestep-5Hz-lm-1.7B"                  # the LM the registry ships

sys.path.insert(0, ROOT)
os.chdir(ROOT)

from acestep.handler import AceStepHandler
from acestep.llm_inference import LLMHandler
from acestep.inference import GenerationParams, GenerationConfig, generate_music

dit = AceStepHandler()
print("[aurea-music] initializing DiT (turbo)...", flush=True)
msg, ok = dit.initialize_service(
    project_root=PROJECT, config_path="acestep-v15-turbo", device="cuda"
)
if not ok:
    print(f"[aurea-music] FAILED: DiT init: {msg}", flush=True)
    sys.exit(1)

llm = LLMHandler()
print("[aurea-music] initializing 5Hz LM (1.7B)...", flush=True)
msg, ok = llm.initialize(
    checkpoint_dir=os.path.join(PROJECT, "checkpoints"),
    lm_model_path=LM_MODEL,
    backend="vllm",
    device="cuda",
)
if not ok:
    print(f"[aurea-music] FAILED: LM init: {msg}", flush=True)
    sys.exit(1)

kwargs = dict(
    caption=CAPTION,
    instrumental=not VOCALS,
    duration=DURATION,
    inference_steps=8,
    shift=3.0,
    seed=SEED,
)
if not VOCALS:
    kwargs["lyrics"] = "[Instrumental]"
elif LYRICS:
    kwargs["lyrics"] = LYRICS
params = GenerationParams(**kwargs)
config = GenerationConfig(batch_size=1, audio_format="wav")

save_dir = tempfile.mkdtemp(prefix="aurea-music-")
print("[aurea-music] generating...", flush=True)
result = generate_music(dit, llm, params, config, save_dir=save_dir)

if not result.success or not result.audios:
    print(f"[aurea-music] FAILED: {getattr(result, 'error', 'no audio produced')}", flush=True)
    sys.exit(1)

os.makedirs(os.path.dirname(os.path.abspath(OUT_WAV)), exist_ok=True)
shutil.copyfile(result.audios[0]["path"], OUT_WAV)
print(f"[aurea-music] OK -> {OUT_WAV}", flush=True)
`;
