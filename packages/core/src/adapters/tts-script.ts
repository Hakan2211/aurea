/* The managed Chatterbox entry point, embedded as source and written into the
 * job's scratch dir before spawn — no .py asset to locate through bundlers.
 * Loads weights from the model manager's folder with from_local() (never
 * downloads), clones the voice from a reference wav, writes one output wav.
 * Progress lines match gen_char_vo.py's shapes so the adapter parses both. */

export const CHATTERBOX_SCRIPT = `"""Aurea managed Chatterbox synthesis (generated file — edits are discarded)."""
import os, time

MODEL_DIR = os.environ["AUREA_MODEL_DIR"]   # <dataRoot>/models/chatterbox-tts
TEXT      = os.environ["AUREA_TEXT"]
REF_WAV   = os.environ["AUREA_REF_WAV"]
EXAG      = float(os.environ.get("AUREA_EXAG", "0.6"))
OUT_WAV   = os.environ["AUREA_OUT_WAV"]

import torchaudio
from chatterbox.tts import ChatterboxTTS

t0 = time.time()
model = ChatterboxTTS.from_local(MODEL_DIR, device="cuda")
print(f"[aurea-tts] model loaded in {time.time()-t0:.1f}s (exag={EXAG})", flush=True)

wav = model.generate(TEXT, audio_prompt_path=REF_WAV, exaggeration=EXAG, cfg_weight=0.4)
os.makedirs(os.path.dirname(OUT_WAV), exist_ok=True)
torchaudio.save(OUT_WAV, wav, model.sr)
print(f"[aurea-tts] take: {TEXT[:60]!r} -> {wav.shape[-1]/model.sr:.2f}s", flush=True)
`;
