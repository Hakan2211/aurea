/* The DramaBox entry point, embedded as source and written into the job's
 * scratch dir before spawn — no .py asset to locate through bundlers (same
 * pattern as CHATTERBOX_SCRIPT). Runs against the operator's external DramaBox
 * checkout (engines.dramaboxRepo) and venv (engines.dramaboxPython); weights
 * come from the repo's own ~/.cache/dramabox auto-download.
 *
 * DramaBox's contract: anything INSIDE quotes is spoken, anything OUTSIDE is a
 * performed stage direction. The tag-translation layer below is ported
 * verbatim from videofast/audio/gen_char_vo_dramabox.py (the proven pipeline)
 * so [laughs]/(nervously)/*sighs* tags are acted, never read aloud.
 * Progress lines match the adapter's regexes in dramabox.ts. */

export const DRAMABOX_SCRIPT = `"""Aurea DramaBox synthesis (generated file — edits are discarded)."""
import os, re, sys, time

REPO      = os.environ["AUREA_DBX_REPO"]
TEXT      = os.environ["AUREA_TEXT"]
DESIGN    = os.environ["AUREA_DESIGN"]
REF       = os.environ.get("AUREA_REF_AUDIO") or None   # mp3/wav; None = raw model voice
OUT_WAV   = os.environ["AUREA_OUT_WAV"]
SEED      = int(os.environ.get("AUREA_SEED", "42"))
CFG       = float(os.environ.get("AUREA_CFG", "2.5"))
STG       = float(os.environ.get("AUREA_STG", "1.5"))
DUR_MULT  = float(os.environ.get("AUREA_DUR_MULT", "0.9"))
GEN_DUR   = float(os.environ.get("AUREA_GEN_DUR", "0"))
REF_SECS  = float(os.environ.get("AUREA_REF_SECONDS", "10"))
WATERMARK = os.environ.get("AUREA_WATERMARK", "") in ("1", "true")

# ---------------------------------------------------------------------------
# Tag -> stage-direction translation, ported from gen_char_vo_dramabox.py.
# DramaBox performs verbs/actions written OUTSIDE the quotes and speaks
# anything INSIDE them, so every tag is lifted out and rewritten as prose.
# ---------------------------------------------------------------------------

PRONOUN = "He"  # current roster is all male voices; design overrides timbre

VERB_CUES = {
    "laugh": "laughs", "laughs": "laughs", "laughing": "laughs",
    "chuckle": "chuckles", "chuckles": "chuckles", "chuckling": "chuckles",
    "giggle": "giggles", "giggles": "giggles",
    "cackle": "cackles", "cackles": "cackles",
    "snicker": "snickers", "snickers": "snickers",
    "sigh": "sighs", "sighs": "sighs", "sighing": "sighs",
    "gasp": "gasps", "gasps": "gasps",
    "groan": "groans", "groans": "groans",
    "grunt": "grunts", "grunts": "grunts",
    "scoff": "scoffs", "scoffs": "scoffs", "scoffing": "scoffs",
    "sniffle": "sniffles", "sniffles": "sniffles",
    "snort": "snorts", "snorts": "snorts",
    "hum": "hums", "hums": "hums", "humming": "hums",
    "yawn": "yawns", "yawns": "yawns",
    "gulp": "gulps", "gulps": "gulps",
    "cough": "coughs", "coughs": "coughs",
    "mutter": "mutters", "mutters": "mutters", "muttering": "mutters",
    "stammer": "stammers", "stammers": "stammers", "stammering": "stammers",
    "sob": "sobs", "sobs": "sobs",
    "sniff": "sniffs", "sniffs": "sniffs",
}
PHRASE_CUES = {
    "clears throat": f"{PRONOUN} clears his throat.",
    "clears his throat": f"{PRONOUN} clears his throat.",
    "trails off": f"{PRONOUN} trails off nervously.",
    "long pause": "A long pause.",
    "pause": "A brief pause.",
    "pauses": "A brief pause.",
    "beat": "A brief pause.",
    "voice cracks": f"{PRONOUN}'s voice cracks.",
    "voice breaks": f"{PRONOUN}'s voice breaks.",
    "voice trembles": f"{PRONOUN}'s voice trembles.",
    "deep breath": f"{PRONOUN} takes a deep breath.",
    "under his breath": f"{PRONOUN} mutters under his breath.",
}
ADJ_CUES = {
    "angry": "angrily", "angrily": "angrily",
    "nervous": "nervously", "nervously": "nervously",
    "excited": "excitedly", "excitedly": "excitedly",
    "sad": "sadly", "sadly": "sadly",
    "happy": "happily", "happily": "happily",
    "calm": "calmly", "calmly": "calmly",
    "warm": "warmly", "warmly": "warmly",
    "cold": "coldly", "coldly": "coldly",
    "soft": "softly", "softly": "softly",
    "loud": "loudly", "loudly": "loudly",
    "slow": "slowly", "slowly": "slowly",
    "quick": "quickly", "quickly": "quickly",
    "proud": "proudly", "proudly": "proudly",
    "shy": "shyly", "shyly": "shyly",
    "grand": "grandly", "grandly": "grandly",
    "firm": "firmly", "firmly": "firmly",
    "gentle": "gently", "gently": "gently",
    "cheerful": "cheerfully", "cheerfully": "cheerfully",
    "panicked": "in a panic", "panicky": "in a panic",
    "sarcastic": "with dry sarcasm", "sarcastically": "with dry sarcasm",
    "smug": "smugly", "smugly": "smugly",
    "worried": "with worry", "worriedly": "with worry",
    "confident": "confidently", "confidently": "confidently",
}
SPECIAL_ADJ = {
    "whisper": f"{PRONOUN} speaks in a whisper.",
    "whispers": f"{PRONOUN} speaks in a whisper.",
    "whispering": f"{PRONOUN} speaks in a whisper.",
    "shout": f"{PRONOUN} raises his voice.",
    "shouts": f"{PRONOUN} raises his voice.",
    "shouting": f"{PRONOUN} raises his voice.",
    "yelling": f"{PRONOUN} raises his voice.",
}


def _adverbify(word):
    """Best-effort adjective -> adverb so unknown tags still read as prose."""
    if word.endswith("ly"):
        return word
    if word in ADJ_CUES:
        return ADJ_CUES[word]
    return f"in a {word} way"


def tag_to_direction(inner):
    """Rewrite one tag's contents as a DramaBox stage-direction sentence."""
    raw = inner.strip().strip(".!?,").lower()
    if not raw:
        return ""
    if raw in PHRASE_CUES:
        return PHRASE_CUES[raw]
    if raw in SPECIAL_ADJ:
        return SPECIAL_ADJ[raw]
    words = raw.split()
    if len(words) == 1 and words[0] in VERB_CUES:
        return f"{PRONOUN} {VERB_CUES[words[0]]}."
    if len(words) == 1 and (words[0] in ADJ_CUES or words[0].endswith("ly")):
        return f"{PRONOUN} speaks {_adverbify(words[0])}."
    if words[0] in ("speaks", "says", "speaking", "voice"):
        return f"{PRONOUN} speaks {' '.join(words[1:])}." if len(words) > 1 else ""
    for w in words:
        if w in VERB_CUES:
            return f"{PRONOUN} {VERB_CUES[w]}."
    return f"{PRONOUN} speaks {_adverbify(words[-1])}."


# Producible in-quote sounds — used only for tag-only lines (e.g. "[chuckles]")
# where there is no dialogue to speak but the tag should still be heard.
SOUND_TOKENS = {
    "laugh": "Hahaha", "laughs": "Hahaha", "laughing": "Hahaha",
    "chuckle": "Heh heh", "chuckles": "Heh heh",
    "giggle": "Hehehe", "giggles": "Hehehe",
    "cackle": "Hahaha", "cackles": "Hahaha", "snicker": "Heh", "snickers": "Heh",
    "sigh": "Ahhh", "sighs": "Ahhh", "groan": "Ughhh", "groans": "Ughhh",
    "gasp": "Ah", "gasps": "Ah", "hum": "Mmmm", "hums": "Mmmm",
    "sob": "Ahh", "sobs": "Ahh", "gulp": "Gulp",
}


def tag_to_sound(inner):
    """If a tag names a producible vocal sound, return its in-quote token."""
    w = inner.strip().strip(".!?,").lower().split()
    for tok in w:
        if tok in SOUND_TOKENS:
            return SOUND_TOKENS[tok]
    return None


# Any bracketed / starred / angled span is treated as a performance tag.
_TAG_RE = re.compile(r"\\[[^\\]]*\\]|\\([^)]*\\)|\\{[^}]*\\}|\\*[^*]*\\*|<[^>]*>")


def sanitize_line(text):
    """Split a raw script line into ordered (spoken_chunk | direction) parts."""
    segments, notes = [], []
    pos = 0
    for m in _TAG_RE.finditer(text):
        before = text[pos:m.start()]
        if before.strip():
            segments.append(("say", before.strip()))
        inner = m.group(0)[1:-1]           # drop the surrounding delimiters
        direction = tag_to_direction(inner)
        if direction:
            segments.append(("dir", direction))
            notes.append((m.group(0), direction))
        pos = m.end()
    tail = text[pos:]
    if tail.strip():
        segments.append(("say", tail.strip()))
    return segments, notes


def _clean_spoken(s):
    """Tidy a spoken chunk: collapse whitespace, ensure it ends punctuated."""
    s = re.sub(r"\\s+", " ", s).strip(" ,;")
    if s and s[-1] not in ".!?":
        s += "."
    return s


def build_dramabox_prompt(design, text):
    """Assemble a DramaBox prompt: design + interleaved directions & quotes.

    Structure produced:
        <design>. [leading dirs] "<chunk1>" <dir> "<chunk2>" ...
    Guarantees the prompt ENDS on a closing quote (guide requirement) — a
    trailing direction is moved to just before the final quoted chunk.
    """
    segments, notes = sanitize_line(text)

    says = [i for i, (k, _) in enumerate(segments) if k == "say"]
    if not says:
        # Tag-only line. Never speak the raw tag: utter its sound if producible,
        # otherwise keep the direction with a minimal neutral in-quote token.
        sound = None
        for m in _TAG_RE.finditer(text):
            sound = tag_to_sound(m.group(0)[1:-1])
            if sound:
                break
        if sound:
            return f'{design.rstrip(". ")}. "{sound}"', notes
        segments.append(("say", "Hmm"))
        says = [len(segments) - 1]

    # Move any trailing directions (after the last spoken chunk) to just before
    # that chunk, so the prompt terminates on a quote.
    last_say = says[-1]
    trailing = [seg for seg in segments[last_say + 1:] if seg[0] == "dir"]
    if trailing:
        segments = segments[:last_say] + trailing + [segments[last_say]]

    parts = [design.rstrip(". ") + "."]
    for kind, val in segments:
        if kind == "dir":
            parts.append(val)
        else:
            parts.append(f'"{_clean_spoken(val)}"')
    prompt = " ".join(p for p in parts if p)
    return prompt, notes


# ---------------------------------------------------------------------------

sys.path.insert(0, REPO)
os.chdir(REPO)  # relative HF-cache/config lookups resolve from the repo
from src.inference_server import TTSServer
from src.model_downloader import get_all_paths

print("[aurea-dbx] loading model", flush=True)
paths = get_all_paths()   # weights auto-cached under ~/.cache/dramabox
t0 = time.time()
server = TTSServer(checkpoint=paths["transformer"],
                   full_checkpoint=paths["audio_components"],
                   gemma_root=paths["gemma_root"], device="cuda",
                   compile_model=False)   # torch.compile needs Triton (no Windows)
print(f"[aurea-dbx] model loaded in {time.time()-t0:.1f}s "
      f"(seed={SEED} cfg={CFG} stg={STG} dur_mult={DUR_MULT})", flush=True)

prompt, notes = build_dramabox_prompt(DESIGN, TEXT)
for tag, direction in notes:
    print(f"[aurea-dbx] tag {tag} -> performed: {direction}", flush=True)
print(f"[aurea-dbx] prompt: {prompt}", flush=True)


def progress(i, n, est):
    print(f"[aurea-dbx] chunk {i + 1}/{n} (~{est:.0f}s)", flush=True)


kwargs = dict(voice_ref=REF, cfg_scale=CFG, stg_scale=STG,
              duration_multiplier=DUR_MULT, seed=SEED, ref_duration=REF_SECS,
              watermark=WATERMARK,
              denoise_ref=False,   # RE-USE (mamba-ssm) has no Windows wheel
              progress_callback=progress)
if GEN_DUR > 0:
    kwargs["gen_duration"] = GEN_DUR

os.makedirs(os.path.dirname(OUT_WAV), exist_ok=True)
server.generate_to_file(prompt=prompt, output=OUT_WAV, **kwargs)

import torchaudio
info = torchaudio.info(OUT_WAV)
print(f"[aurea-dbx] take: {TEXT[:60]!r} -> {info.num_frames/info.sample_rate:.2f}s", flush=True)
`;

/** Per-character speaker "design" prompts, ported from videofast's
 * bakeoff/characters.json (the voice-design source of truth). Used when the
 * payload carries no explicit design override. */
export const DRAMABOX_DESIGNS: Record<string, string> = {
  sterling:
    "a refined posh British male voice, plummy Received Pronunciation accent, smooth measured and warm, charming and a touch theatrical, mid-range, unhurried delivery",
  grant:
    "a deep steady calm male voice with natural authority, a coach or teacher, clear projecting diction, grounded and reassuring, unflappable",
  milo: "a fast slightly high-pitched anxious young male voice, jittery and hyper-alert, quick nervous bursts that sometimes trail off, nervous little laugh",
  bruno:
    "a low warm gentle male voice, soft-spoken and slightly slow, kind and shy, a big friendly rumble, occasionally hums softly",
  jax: "a clear confident male voice with a slight airy resonance, visionary and thoughtful, deliberate pauses, speaks in a calm big-picture way as if seeing from above",
  barney:
    "a smooth sly slightly raspy male voice, dry sarcastic drawl, unhurried and amused, elongated hissing S sounds, effortlessly cool",
};

export const DRAMABOX_DESIGN_FALLBACK = "a natural, clear voice with expressive delivery";
