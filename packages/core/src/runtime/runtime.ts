/* EngineRuntime — the managed engine substrate under <dataRoot>/runtime/:
 *
 *   runtime/python/       portable CPython (python-build-standalone, pinned)
 *   runtime/comfy/        headless ComfyUI source at a pinned release tag
 *   runtime/comfy-venv/   ComfyUI's own venv (CUDA torch + requirements.txt)
 *   runtime/downloads/    archives (resumable, shared .part protocol)
 *   runtime/pip-cache/    pip wheel cache, kept inside dataRoot
 *   runtime/extra_model_paths.yaml   points ComfyUI at <dataRoot>/models
 *   runtime/runtime.json  installed versions (a pin change = reinstall)
 *
 * This is what makes the P1 exit criterion possible: a clean machine — Windows
 * or macOS — gets Python and ComfyUI from the wizard, no terminal, no system
 * installs. Everything is user-writable and lives under the one storage root.
 *
 * Weights are never bundled: the model manager fetches them from Hugging Face
 * on demand, so the host only has to supply an interpreter and an accelerator. */

import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { RuntimeComponent, RuntimeComponentId, RuntimeStatus } from "@aurea/shared";
import type { SettingsStore } from "../settings.js";
import { runProcess } from "../adapters/proc.js";
import { downloadFile } from "./download.js";

/* ---------- host platform ----------
 *
 * The managed runtime is the same substrate on every host — portable CPython,
 * one ComfyUI, venvs per engine. What differs is three things and no more: the
 * CPython asset, where a venv puts its interpreter, and which torch wheels to
 * pull. Everything below funnels those differences through here rather than
 * scattering `process.platform` checks down the install path. */
const IS_WINDOWS = process.platform === "win32";

/** Windows lays a venv out as Scripts/python.exe, POSIX as bin/python3. */
const VENV_BIN = IS_WINDOWS ? "Scripts" : "bin";
const VENV_PYTHON = IS_WINDOWS ? "python.exe" : "python3";

/** pinned upstream builds — bump deliberately, never silently */
const PYTHON_VERSION = "3.12.13";
/** python-build-standalone release tag */
const PYTHON_TAG = "20260623";

/**
 * One tag, one CPython version, one asset per host. Sizes and digests are the
 * ones GitHub reports for that release — the Windows entry is the pin this file
 * has always carried, unchanged.
 *
 * Apple Silicon and Intel are both listed because an Intel Mac running the
 * arm64 build would fail at the first native wheel, and picking by
 * `process.arch` costs nothing.
 */
const PYTHON_BUILDS: Record<
  string,
  { triple: string; sizeBytes: number; sha256: string }
> = {
  "win32-x64": {
    triple: "x86_64-pc-windows-msvc",
    sizeBytes: 46013305,
    sha256: "c6af85bb83d5158c9ff71f50dfad467853d1cd236f932b144e87e26e2ea2a83e",
  },
  "darwin-arm64": {
    triple: "aarch64-apple-darwin",
    sizeBytes: 25159977,
    sha256: "3724aa4dafb5f7b6c2cf98e89914e4248dc6bd2fe40407df4a2d73de99615f16",
  },
  "darwin-x64": {
    triple: "x86_64-apple-darwin",
    sizeBytes: 24829196,
    sha256: "7c57fdd1fa675190093700eb0d8e7117e1f9eae7c30a46dea5f8d5266bcfc791",
  },
};

/**
 * Resolved lazily rather than at module load: importing @aurea/core on an
 * unsupported host (Linux CI, a contributor's box) must not explode on import.
 * The failure belongs at "install the runtime", where it can be shown in the
 * wizard as a sentence a person can act on.
 */
function pythonBuild(): { triple: string; sizeBytes: number; sha256: string } {
  const key = `${process.platform}-${process.arch}`;
  const build = PYTHON_BUILDS[key];
  if (!build) {
    throw new Error(
      `No managed Python build for ${key}. Aurea's runtime supports Windows x64 and macOS (Apple Silicon or Intel).`,
    );
  }
  return build;
}

export const PYTHON_PIN = {
  version: PYTHON_VERSION,
  tag: PYTHON_TAG,
  /** the asset for *this* host — throws on an unsupported platform */
  get url(): string {
    // "+" is percent-encoded in the published filename
    return `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_TAG}/cpython-${PYTHON_VERSION}%2B${PYTHON_TAG}-${pythonBuild().triple}-install_only.tar.gz`;
  },
  get sizeBytes(): number {
    return pythonBuild().sizeBytes;
  },
  get sha256(): string {
    return pythonBuild().sha256;
  },
};

/** Bumped v0.28.0 → v0.30.2 on 2026-08-07 so ONE managed ComfyUI serves both
 * video engines: MiniMax-H3's nodes became core in 0.30, so the managed runtime
 * no longer needs an external ComfyUI for H3 (0.28 has core LTX but no H3).
 * That is what lets engines.videoMode run "managed" — see comfy/service.ts.
 *
 * Bumped v0.30.2 → v0.32.0 on 2026-08-12 for LTX 2.5, whose nodes
 * (LTXVDualCFGGuider, the Gemma 4 encoders, the 2.5 model detection) landed
 * in core 0.32.0 — LTX 2.3, H3 and the custom packs all ride along.
 *
 * Bumped v0.32.0 → v0.45.0 on 2026-11-11 for MiniMax-H3-Image (t2i + edit,
 * PR #17655: MiniMaxH3ImageConditioning, image VAE, PDD head-grid sampling). */
export const COMFY_PIN = {
  tag: "v0.45.0",
  /** GitHub tag archive (no published sha — verified structurally instead) */
  url: "https://github.com/Comfy-Org/ComfyUI/archive/refs/tags/v0.45.0.zip",
};

/**
 * Torch install args for the host.
 *
 * On Windows the CUDA index is passed as `--index-url` (not `--extra-`) so
 * PyPI can never win with a newer CPU-only build — that rule is load-bearing
 * and every engine spec below depends on it.
 *
 * On macOS there is no CUDA index to point at: PyPI's own macOS wheels are the
 * Metal/MPS builds, and forcing an index-url would either 404 or drag in a
 * Linux CPU wheel. So the version pins stay exactly as they are and only the
 * index drops — same torch, same resolution, different accelerator underneath.
 */
function torchArgs(packages: string[], cudaIndex: string): string[] {
  return IS_WINDOWS ? [...packages, "--index-url", cudaIndex] : [...packages];
}

/** "Installing PyTorch (CUDA 13)" reads as a lie on a Mac. */
function torchStage(cudaLabel: string): string {
  return IS_WINDOWS
    ? `Installing PyTorch (${cudaLabel}) — several GB, takes a while`
    : "Installing PyTorch (Metal/MPS) — several GB, takes a while";
}

/**
 * The accelerator probe behind every engine's post-install check: CUDA on
 * Windows, MPS on a Mac. The check exists to prove the import graph resolves,
 * so it prints the answer rather than asserting it — a machine with no usable
 * accelerator should say `accel=False` out loud, not fail the install and
 * leave the user guessing which of forty wheels went wrong.
 */
const ACCEL_EXPR =
  "(torch.cuda.is_available() or (hasattr(torch.backends,'mps') and torch.backends.mps.is_available()))";

/** A Python engine that runs in its own venv under runtime/venvs/<id> —
 * the protocol behind every non-ComfyUI local engine. Bumping `version`
 * (or changing a pin) makes the component read as absent → reinstall. */
export interface VenvEngineSpec {
  id: RuntimeComponentId;
  name: string;
  /** recorded in runtime.json; shown as the component's pinned version */
  version: string;
  /** optional pinned source checkout (engines that run from a repo, not a
   * pip package) — extracted to runtime/engines/<id> like the ComfyUI
   * install; "{repo}" in step args and check.code resolves to that path */
  repo?: {
    /** commit/tag archive zip (GitHub generates these — no published sha,
     * verified structurally via marker instead) */
    url: string;
    /** posix-relative file that must exist after extraction */
    marker: string;
  };
  /** pip install invocations, run in order inside the venv */
  steps: { stage: string; args: string[] }[];
  /** import check: `python -c code` must print a line matching expect */
  check: { code: string; expect: RegExp };
  /** rough installed footprint (venv + wheel cache), progress estimation only */
  expectedBytes: number;
}

export const CHATTERBOX_PIN: VenvEngineSpec = {
  id: "chatterbox",
  name: "Chatterbox TTS",
  version: "0.1.7",
  steps: [
    {
      stage: torchStage("CUDA 12.4"),
      // chatterbox-tts pins torch==2.6.0; on Windows install the CUDA build
      // first so PyPI's CPU-only wheel can never satisfy the pin. On macOS the
      // PyPI wheel *is* the right one (MPS), so the index drops away.
      args: torchArgs(
        ["torch==2.6.0", "torchaudio==2.6.0"],
        "https://download.pytorch.org/whl/cu124",
      ),
    },
    { stage: "Installing Chatterbox TTS", args: ["chatterbox-tts==0.1.7"] },
  ],
  check: {
    code: `import chatterbox.tts, torch; print('chatterbox ok accel='+str(${ACCEL_EXPR}))`,
    expect: /chatterbox ok accel=/,
  },
  expectedBytes: 6 * 1024 ** 3,
};

export const ACESTEP_PIN: VenvEngineSpec = {
  id: "acestep",
  name: "ACE-Step Music",
  // upstream pyproject version @ pinned commit (post-v0.1.5, MP3-export fix)
  version: "1.5.0-f1f8f6c",
  repo: {
    url: "https://github.com/ACE-Step/ACE-Step-1.5/archive/f1f8f6c1c9db9ada7a4b68c38c25589752133026.zip",
    marker: "acestep/handler.py",
  },
  steps: [
    {
      stage: torchStage("CUDA 12.8"),
      // upstream pins torch==2.7.1+cu128 on Windows; CUDA index first so
      // PyPI's CPU-only build can never satisfy the pin
      args: torchArgs(
        ["torch==2.7.1", "torchvision==0.22.1", "torchaudio==2.7.1"],
        "https://download.pytorch.org/whl/cu128",
      ),
    },
    {
      stage: "Installing ACE-Step dependencies",
      // pinned to the versions of a proven working install; torch-coupled
      // packages (torchcodec/torchao) MUST stay pinned or pip upgrades torch
      // to a newer CPU build to satisfy them
      args: [
        "transformers==4.57.6", "diffusers==0.37.1", "accelerate==1.13.0",
        "safetensors==0.7.0", "einops==0.8.2", "soundfile==0.13.1",
        "numba==0.64.0", "vector-quantize-pytorch==1.28.0",
        "torchao==0.15.0", "torchcodec==0.11.0",
        "gradio==6.2.0", "matplotlib", "scipy", "loguru", "fastapi",
        "uvicorn[standard]", "diskcache", "toml", "xxhash==3.6.0",
        "modelscope==1.35.3", "peft==0.18.1", "lycoris-lora==3.4.0",
        "lightning==2.6.1", "tensorboard", "typer-slim",
      ],
    },
    {
      // bundled LM runtime — pure-python on 3.12 (triton/flash-attn markers
      // self-exclude; nano-vllm falls back to SDPA attention)
      stage: "Installing nano-vllm (bundled LM runtime)",
      args: ["{repo}/acestep/third_parts/nano-vllm"],
    },
  ],
  check: {
    code: `import sys; sys.path.insert(0, r"{repo}"); from acestep.handler import AceStepHandler; import nanovllm, torch; print("acestep ok accel="+str(${ACCEL_EXPR}))`,
    expect: /acestep ok accel=/,
  },
  expectedBytes: 8 * 1024 ** 3,
};

export const SEEDVC_PIN: VenvEngineSpec = {
  id: "seedvc",
  name: "Seed-VC Voice Conversion",
  // upstream has no releases — pinned master commit
  version: "1.0-51383ef",
  repo: {
    url: "https://github.com/Plachtaa/seed-vc/archive/51383efd921027683c89e5348211d93ff12ac2a8.zip",
    marker: "inference.py",
  },
  steps: [
    {
      stage: torchStage("CUDA 12.4"),
      // upstream pins torch==2.4.0 (works on our portable 3.12); CUDA index
      // first so PyPI's CPU-only wheel can never satisfy the pin
      args: torchArgs(
        ["torch==2.4.0", "torchvision==0.19.0", "torchaudio==2.4.0"],
        "https://download.pytorch.org/whl/cu124",
      ),
    },
    {
      stage: "Installing Seed-VC dependencies",
      // upstream requirements.txt minus GUI/eval extras (gradio, FreeSimpleGUI,
      // sounddevice, resemblyzer, jiwer, funasr, modelscope) — the V1 CLI
      // inference path imports none of them, and resemblyzer's webrtcvad has
      // no 3.12 wheel on Windows
      args: [
        "scipy==1.13.1", "librosa==0.10.2", "huggingface-hub>=0.28.1",
        "munch==4.0.0", "einops==0.8.0", "descript-audio-codec==1.0.0",
        "pydub==0.25.1", "transformers==4.46.3", "soundfile==0.12.1",
        "numpy==1.26.4", "hydra-core==1.3.2", "pyyaml", "python-dotenv",
        "accelerate",
      ],
    },
  ],
  check: {
    code: `import sys; sys.path.insert(0, r"{repo}"); import torch; from modules import commons; print("seedvc ok accel="+str(${ACCEL_EXPR}))`,
    expect: /seedvc ok accel=/,
  },
  expectedBytes: 7 * 1024 ** 3,
};

export const VENV_ENGINES: VenvEngineSpec[] = [CHATTERBOX_PIN, ACESTEP_PIN, SEEDVC_PIN];

/** A pinned ComfyUI custom-node pack, installed to runtime/nodes/<dir> and
 * mounted into the managed ComfyUI via extra_model_paths.yaml (custom_nodes
 * search paths are loaded before node init) — the checkout survives a ComfyUI
 * reinstall. Python deps go into the ComfyUI venv, so ComfyUI must be ready
 * first. Bumping `version` (or the pin) makes the component reinstall. */
export interface CustomNodeSpec {
  id: RuntimeComponentId;
  name: string;
  /** recorded in runtime.json — "<upstream>-<shortsha>" */
  version: string;
  /** commit archive zip (GitHub generates these — no published sha,
   * verified structurally via marker instead) */
  url: string;
  /** directory name under runtime/nodes — becomes the python module name */
  dir: string;
  /** posix-relative file that must exist after extraction */
  marker: string;
  /** pip requirements installed into the ComfyUI venv */
  pipArgs: string[];
  /** import check inside the ComfyUI venv */
  check: { code: string; expect: RegExp };
}

export const GGUF_NODE_PIN: CustomNodeSpec = {
  id: "gguf",
  name: "GGUF loader nodes",
  // upstream pyproject 2.0.0 @ pinned commit (metadata-on-new-comfy fix)
  version: "2.0.0-6ea2651",
  url: "https://github.com/city96/ComfyUI-GGUF/archive/6ea2651e7df66d7585f6ffee804b20e92fb38b8a.zip",
  dir: "ComfyUI-GGUF",
  marker: "nodes.py",
  pipArgs: ["gguf>=0.13.0", "sentencepiece", "protobuf"],
  check: {
    // the gguf package exposes no __version__ — ask package metadata
    code: "import gguf, sentencepiece; from importlib.metadata import version; print('gguf ok '+version('gguf'))",
    expect: /gguf ok/,
  },
};

/** KJNodes carries the LTX 2.3 render tuning (chunked feed-forward, the
 * SageAttention patches, NAG) plus VAELoaderKJ. Pinned to the commit the
 * external install was verified against on 2026-07-25. Its __init__ imports
 * every node module eagerly with no try/except, so the full requirements list
 * has to go in — one missing dep and the whole pack fails to register. */
export const KJNODES_PIN: CustomNodeSpec = {
  id: "kjnodes",
  name: "KJNodes (LTX tuning)",
  version: "1.4.7-e27a505",
  url: "https://github.com/kijai/ComfyUI-KJNodes/archive/e27a505b3ba6ce42687fe00500deda103d9d6071.zip",
  dir: "ComfyUI-KJNodes",
  marker: "nodes/ltxv_nodes.py",
  pipArgs: [
    "pillow>=10.3.0",
    "color-matcher",
    "matplotlib",
    "mss",
    "opencv-python-headless",
  ],
  check: {
    code: "import color_matcher, matplotlib, mss, cv2; print('kjnodes deps ok')",
    expect: /kjnodes deps ok/,
  },
};

/** The Shot Director's timeline nodes (LTXDirector, LTXDirectorGuide,
 * LTXDirectorCropGuides). Pinned to the commit the external install was
 * verified against on 2026-07-25 — the node's `timeline_data` contract is one
 * we synthesise by hand, so an unpinned upgrade could move it underneath us.
 * `av` (PyAV) does the audio/video decoding for timeline segments.
 *
 * Bumped bf71104 → fbf22af (v2.0.4) on 2026-07-25 for cast references: only
 * that version reads a still off the IC-LoRA track. Re-verified externally
 * first — V4's two-voice shot and V5's motion/retake both still pass, and every
 * node input the graph writes came through unchanged. A managed engine on the
 * old pin re-fetches when this version string changes. */
export const WHATDREAMSCOST_PIN: CustomNodeSpec = {
  id: "director-nodes",
  name: "LTX Director nodes",
  version: "2.0.4-fbf22af",
  url: "https://github.com/WhatDreamsCost/WhatDreamsCost-ComfyUI/archive/fbf22afdfce99587c80c4e8625f545deaa6c66a0.zip",
  dir: "WhatDreamsCost-ComfyUI",
  marker: "ltx_director.py",
  pipArgs: ["av", "pillow", "numpy"],
  check: {
    code: "import av, PIL, numpy; print('director deps ok')",
    expect: /director deps ok/,
  },
};

/* CUDA 13, not 12.8.
 *
 * Same torch, a different CUDA runtime under it — and the reason is one line in
 * comfy/quant_ops.py: comfy-kitchen DISABLES its optimized CUDA backend when
 * `torch.version.cuda < 13`, printing "You need pytorch with cu130 or higher to
 * use optimized CUDA operations" and falling back to eager. Every quantized
 * format the studio touches (fp8, nvfp4, int8-convrot, w4a8) runs through that
 * backend, so on cu128 the 4-bit weights are read by the slowest path that can
 * read them.
 *
 * CUDA 13 drops Maxwell through Volta (sm_50–70); Ampere, Ada and Blackwell are
 * all still supported, and this project's floor is a 24 GB Ampere card. */
const TORCH_INDEX = "https://download.pytorch.org/whl/cu130";

/** Which llama.cpp wheel the Endless Sampler's Gemma runs on.
 *
 * The pack's own requirements.txt asks for `whl/cu125`. Two things are wrong
 * with taking that at face value:
 *
 *  1. llama.cpp's ggml-cuda.dll resolves cudart/cublas by plain name, so it
 *     loads whatever CUDA runtime is already on the search path — which in this
 *     venv is the one torch shipped. The moment TORCH_INDEX moved to cu130 and
 *     torch/lib became `cudart64_13.dll`, the cu125 build stopped importing at
 *     all: "Could not find module llama.dll (or one of its dependencies)".
 *  2. The matching cu130 build imports fine and then dies INSIDE
 *     `llama_init_from_model` with `0xc000001d` — STATUS_ILLEGAL_INSTRUCTION.
 *     Its ggml-cpu.dll is compiled for an instruction set this class of CPU
 *     does not have (measured on a 12th-gen Core i7, where AVX-512 is fused
 *     off — which is every consumer Alder Lake and Raptor Lake part). The same
 *     version from `whl/cpu` loads the same model and generates.
 *
 * So: the CPU build, deliberately. Gemma runs between chunks with H3 unloaded,
 * which is the one place in this pipeline where the GPU is idle anyway, and a
 * planner that runs beats a planner that crashes. On a machine whose CPU can
 * take it, `whl/cu130` is a one-word change here and worth making. */
const LLAMA_CPP_INDEX = "https://abetlen.github.io/llama-cpp-python/whl/cpu";

/** Long-form MiniMax-H3: a drop-in replacement for SamplerCustomAdvanced that
 * samples one long latent as a chain of chunks, carrying the finished tail of
 * each into the next as H3's own synchronized <Video N>/<Audio N> reference.
 *
 * It is a length feature, not a speed one. H3's trained window is ~15 seconds
 * and a 24 GB card runs out well before that at full canvas; this makes the
 * ceiling the wall clock instead of the VRAM. The cost is real: between chunks
 * it runs Gemma 4 12B to re-plan the next chunk's prompt from the frames just
 * rendered, which is what keeps a five-shot minute coherent instead of ten
 * unrelated clips — and which is why the pack pulls in llama-cpp-python and
 * downloads ~8 GB of Gemma on first use. Aurea gates the whole thing on the
 * shot actually being longer than one chunk (see the adapter).
 *
 * llama-cpp-python is pinned to the version the pack pins, from the publisher's
 * own wheel index: PyPI ships only an sdist, and building llama.cpp from source
 * on a Windows box with no MSVC is not a thing to do inside an app's first-run
 * install. WHICH index is a decision with a history — see LLAMA_CPP_INDEX. */
export const ENDLESS_NODE_PIN: CustomNodeSpec = {
  id: "endless-sampler",
  name: "HR Endless Sampler (long-form H3)",
  version: "d2939f0",
  url: "https://github.com/hradec/ComfyUI-HR-Endless-Sampler/archive/d2939f08f9c6459d7d25ecc71605c8319deb513e.zip",
  dir: "ComfyUI-HR-Endless-Sampler",
  marker: "nodes.py",
  pipArgs: [
    "llama-cpp-python==0.3.35",
    "huggingface-hub>=0.34.0",
    "av>=16.0.0",
    "--extra-index-url",
    LLAMA_CPP_INDEX,
  ],
  check: {
    /* torch FIRST, and not for show. llama.cpp's ggml-cuda.dll resolves
     * cublas/cudart by plain name, and the only copy of those in this venv is
     * the one torch ships in torch/lib — which is on the DLL search path only
     * because `import torch` puts it there. Check it the way ComfyUI loads it
     * (torch is long since imported by the time a node registers) or the check
     * fails on a venv that works perfectly. */
    code:
      "import torch; import llama_cpp, huggingface_hub, av; " +
      "print('endless deps ok '+llama_cpp.__version__)",
    expect: /endless deps ok/,
  },
};

export const CUSTOM_NODES: CustomNodeSpec[] = [
  GGUF_NODE_PIN,
  KJNODES_PIN,
  WHATDREAMSCOST_PIN,
  ENDLESS_NODE_PIN,
];



/** SageAttention, and the Triton it is written in.
 *
 * Not a nicety: at video sequence lengths attention IS the render. Benchmarked
 * on this box's 3090 Ti (sm_86, fp16, 16 heads, head_dim 128) against torch's
 * own SDPA:
 *
 *   16k tokens   45 ms → 14 ms   3.1×
 *   49k tokens  377 ms → 131 ms  2.9×
 *
 * and a 1344×768 × 107-frame MiniMax-H3 latent is ~100k tokens, so this is the
 * largest single lever on H3's wall-clock that costs no VRAM and no download of
 * weights. KJNodes' PathchSageAttentionKJ (already pinned in CUSTOM_NODES) is
 * what applies it per-model; it imports `sageattention` lazily, so without
 * these two packages the node exists, the toggle looks available, and the
 * render dies at the first attention call.
 *
 * PyPI's `sageattention` is the Triton implementation, which is the one that
 * runs on Ampere — the CUDA-kernel builds in the 2.x line target sm_89+. On
 * Windows Triton ships as `triton-windows`; on Linux it comes in with torch.
 * macOS has neither and doesn't want them (no CUDA at all). */
const ACCEL_PACKAGES: string[] | null = IS_WINDOWS
  ? ["triton-windows", "sageattention"]
  : process.platform === "linux"
    ? ["sageattention"]
    : null;
/** rough site-packages + wheel cache footprint of the torch + requirements
 * installs, for progress estimation only */
const PIP_EXPECTED_BYTES = 9 * 1024 ** 3;

/** ComfyUI model categories that resolve inside <dataRoot>/models. Weights
 * are referenced by registry-relative paths ("<model-id>/vae/ae.safetensors"),
 * so every category can point at the same root without name collisions. */
const COMFY_CATEGORIES = [
  "checkpoints",
  "diffusion_models",
  "text_encoders",
  "clip",
  "vae",
  "loras",
  "upscale_models",
  "latent_upscale_models",
  "clip_vision",
  "controlnet",
];

/** Categories mounted from a linked root. Includes "unet", which our own
 * store never uses but every real ComfyUI install does — it is where GGUF
 * diffusion weights actually live on disk. */
const LINKED_CATEGORIES = [...COMFY_CATEGORIES, "unet"];

interface RuntimeRecord {
  python?: string;
  comfy?: string;
  /** custom-node pack id -> installed spec version */
  nodes?: Record<string, string>;
  /** venv engine id -> installed spec version */
  venvs?: Record<string, string>;
  /** venv engine id -> spec version its source checkout came from (recorded
   * at extraction, before the venv finishes — keeps resumes cheap while a
   * pin change still re-fetches) */
  repos?: Record<string, string>;
  installedAt?: string;
}

interface LiveComponent {
  state: "installing" | "error";
  progress: number;
  stage: string | null;
  detail: string | null;
  error: string | null;
}

const PUBLISH_MS = 400;

export class EngineRuntime extends EventEmitter {
  /** live install state per component while install() runs (or after failure) */
  private live = new Map<RuntimeComponentId, LiveComponent>();
  private ctrl: AbortController | null = null;
  private killLive: (() => void) | null = null;
  private lastPublish = 0;
  private publishTimer: NodeJS.Timeout | undefined;

  constructor(private settings: SettingsStore) {
    super();
  }

  /* ---------- paths (all derived from the settings storage root) ---------- */

  root(): string {
    return path.join(this.settings.get().storage.dataRoot, "runtime");
  }

  pythonExe(): string {
    // python-build-standalone unpacks to python/python.exe on Windows and
    // python/bin/python3 on macOS
    return IS_WINDOWS
      ? path.join(this.root(), "python", "python.exe")
      : path.join(this.root(), "python", "bin", "python3");
  }

  comfyDir(): string {
    return path.join(this.root(), "comfy");
  }

  venvPython(): string {
    return path.join(this.root(), "comfy-venv", VENV_BIN, VENV_PYTHON);
  }

  extraModelPathsFile(): string {
    return path.join(this.root(), "extra_model_paths.yaml");
  }

  venvDir(id: RuntimeComponentId): string {
    return path.join(this.root(), "venvs", id);
  }

  venvEnginePython(id: RuntimeComponentId): string {
    return path.join(this.venvDir(id), VENV_BIN, VENV_PYTHON);
  }

  /** a venv engine's pinned source checkout (specs with `repo`) */
  engineRepoDir(id: RuntimeComponentId): string {
    return path.join(this.root(), "engines", id);
  }

  /** custom-node packs live here, mounted via extra_model_paths.yaml —
   * outside the ComfyUI checkout so a ComfyUI reinstall can't wipe them */
  nodesDir(): string {
    return path.join(this.root(), "nodes");
  }

  nodeDir(spec: CustomNodeSpec): string {
    return path.join(this.nodesDir(), spec.dir);
  }

  /* ---------- status ---------- */

  status(): RuntimeStatus {
    const record = this.record();
    const component = (
      id: RuntimeComponentId,
      name: string,
      pinned: string,
      ready: boolean,
      version: string | null,
    ): RuntimeComponent => {
      const live = this.live.get(id);
      if (live) return { id, name, pinned, version, ...live };
      return {
        id,
        name,
        pinned,
        state: ready ? "ready" : "absent",
        version: ready ? version : null,
        progress: ready ? 100 : 0,
        stage: null,
        detail: null,
        error: null,
      };
    };
    const components = [
      component(
        "python",
        "Python runtime",
        PYTHON_PIN.version,
        this.pythonReady(record),
        record.python ?? null,
      ),
      component(
        "comfy",
        "ComfyUI engine",
        COMFY_PIN.tag,
        this.comfyReady(record),
        record.comfy ?? null,
      ),
      ...CUSTOM_NODES.map((spec) =>
        component(
          spec.id,
          spec.name,
          spec.version,
          this.nodeReady(spec, record),
          record.nodes?.[spec.id] ?? null,
        ),
      ),
      ...VENV_ENGINES.map((spec) =>
        component(
          spec.id,
          spec.name,
          spec.version,
          this.venvEngineReady(spec, record),
          record.venvs?.[spec.id] ?? null,
        ),
      ),
    ];
    return {
      ready: components.every((c) => c.state === "ready"),
      installing: this.ctrl !== null,
      components,
    };
  }

  /** Is this one component usable right now? (status().ready means ALL of
   * them — adapters gate on the piece they actually spawn.) */
  componentReady(id: RuntimeComponentId): boolean {
    const record = this.record();
    if (id === "python") return this.pythonReady(record);
    if (id === "comfy") return this.comfyReady(record);
    const node = CUSTOM_NODES.find((s) => s.id === id);
    if (node) return this.nodeReady(node, record);
    const spec = VENV_ENGINES.find((s) => s.id === id);
    return spec ? this.venvEngineReady(spec, record) : false;
  }

  private pythonReady(record: RuntimeRecord): boolean {
    return record.python === PYTHON_PIN.version && fs.existsSync(this.pythonExe());
  }

  private comfyReady(record: RuntimeRecord): boolean {
    return (
      record.comfy === COMFY_PIN.tag &&
      fs.existsSync(path.join(this.comfyDir(), "main.py")) &&
      fs.existsSync(this.venvPython())
    );
  }

  private nodeReady(spec: CustomNodeSpec, record: RuntimeRecord): boolean {
    return (
      record.nodes?.[spec.id] === spec.version &&
      fs.existsSync(path.join(this.nodeDir(spec), ...spec.marker.split("/")))
    );
  }

  private venvEngineReady(spec: VenvEngineSpec, record: RuntimeRecord): boolean {
    return (
      record.venvs?.[spec.id] === spec.version &&
      fs.existsSync(this.venvEnginePython(spec.id)) &&
      (!spec.repo || fs.existsSync(this.repoMarker(spec)))
    );
  }

  private repoMarker(spec: VenvEngineSpec): string {
    return path.join(this.engineRepoDir(spec.id), ...(spec.repo?.marker.split("/") ?? []));
  }

  /* ---------- install ---------- */

  /** Install (or finish installing) everything that isn't ready. Resolves
   * when the runtime is ready; rejects on failure or cancel. */
  install(): RuntimeStatus {
    if (this.ctrl) return this.status();
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    void (async () => {
      const record = this.record();
      if (!this.pythonReady(record)) await this.installPython(ctrl.signal);
      if (this.comfyReady(this.record())) {
        /* Already at the pin — but it may predate ACCEL_PACKAGES or the CUDA 13
         * move, and neither of those bumps COMFY_PIN. Both are no-ops when the
         * venv is already right. */
        const live = this.begin("comfy");
        try {
          await this.upgradeTorchCuda(ctrl.signal, live);
          await this.installAccel(ctrl.signal, live, path.join(this.root(), "pip-cache"));
        } finally {
          this.live.delete("comfy");
          this.publish();
        }
      } else {
        await this.installComfy(ctrl.signal);
      }
      for (const spec of CUSTOM_NODES) {
        // after ComfyUI: pip deps land in the ComfyUI venv
        if (!this.nodeReady(spec, this.record())) {
          await this.installCustomNode(spec, ctrl.signal);
        }
      }
      for (const spec of VENV_ENGINES) {
        if (!this.venvEngineReady(spec, this.record())) {
          await this.installVenvEngine(spec, ctrl.signal);
        }
      }
    })()
      .then(() => this.live.clear())
      .catch((err: unknown) => {
        for (const [id, live] of this.live) {
          if (live.state !== "installing") continue;
          if (ctrl.signal.aborted) {
            // cancel keeps partials silently; next install resumes
            this.live.delete(id);
          } else {
            live.state = "error";
            live.error = err instanceof Error ? err.message : String(err);
            live.stage = null;
            live.detail = null;
          }
        }
      })
      .finally(() => {
        this.ctrl = null;
        this.killLive = null;
        this.publish();
      });
    return this.status();
  }

  cancel(): RuntimeStatus {
    this.ctrl?.abort();
    this.killLive?.();
    return this.status();
  }

  close(): void {
    this.ctrl?.abort();
    this.killLive?.();
    clearTimeout(this.publishTimer);
    this.removeAllListeners();
  }

  /* ---------- python ---------- */

  private async installPython(signal: AbortSignal): Promise<void> {
    const live = this.begin("python");
    const archive = path.join(this.root(), "downloads", `cpython-${PYTHON_PIN.version}.tar.gz`);

    live.stage = "Downloading Python";
    this.publish();
    await downloadFile(
      {
        url: PYTHON_PIN.url,
        label: "Python runtime",
        sizeBytes: PYTHON_PIN.sizeBytes,
        sha256: PYTHON_PIN.sha256,
      },
      archive,
      signal,
      {
        onBytes: (n) => {
          live.progress = (n / PYTHON_PIN.sizeBytes) * 70;
          live.detail = fmtBytes(n);
          this.publish();
        },
        onVerifying: () => {
          live.detail = "verifying partial download";
          this.publish();
        },
      },
    );

    live.stage = "Unpacking";
    live.progress = 70;
    live.detail = null;
    this.publish();
    // the archive's top-level "python/" dir becomes runtime/python
    const staging = path.join(this.root(), ".staging-python");
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(path.join(this.root(), "python"), { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    await this.extract(archive, staging, signal);
    fs.renameSync(path.join(staging, "python"), path.join(this.root(), "python"));
    fs.rmSync(staging, { recursive: true, force: true });

    live.stage = "Checking";
    live.progress = 90;
    this.publish();
    const version = await this.capture(this.pythonExe(), ["--version"], signal);
    if (!version.includes(PYTHON_PIN.version)) {
      throw new Error(`Python runtime check failed: got "${version}"`);
    }
    fs.rmSync(archive, { force: true });
    this.saveRecord({ python: PYTHON_PIN.version });
    this.live.delete("python");
    this.publish();
  }

  /* ---------- comfy ---------- */

  private async installComfy(signal: AbortSignal): Promise<void> {
    const live = this.begin("comfy");
    const root = this.root();
    const venvDir = path.join(root, "comfy-venv");
    const cacheDir = path.join(root, "pip-cache");
    const pip = (args: string[]) => [
      "-m", "pip", "install", "--disable-pip-version-check", "--no-input",
      "--cache-dir", cacheDir, ...args,
    ];

    // a pin change re-fetches the checkout, exactly as installCustomNode does:
    // without the tag test an upgrade would reinstall requirements and record
    // the new tag over an unchanged tree, so runtime.json would claim a version
    // that is not on disk (and the new core nodes would never appear)
    if (
      !fs.existsSync(path.join(this.comfyDir(), "main.py")) ||
      this.record().comfy !== COMFY_PIN.tag
    ) {
      live.stage = `Downloading ComfyUI ${COMFY_PIN.tag}`;
      this.publish();
      const archive = path.join(root, "downloads", `ComfyUI-${COMFY_PIN.tag}.zip`);
      // GitHub generates tag archives on the fly — size unknown, no resume
      await downloadFile(
        { url: COMFY_PIN.url, label: "ComfyUI source", sizeBytes: null, sha256: null },
        archive,
        signal,
        {
          onBytes: (n) => {
            live.progress = Math.min(8, n / (3 * 1024 ** 2));
            live.detail = fmtBytes(n);
            this.publish();
          },
        },
      );

      live.stage = "Unpacking";
      live.progress = 8;
      live.detail = null;
      this.publish();
      const staging = path.join(root, ".staging-comfy");
      fs.rmSync(staging, { recursive: true, force: true });
      fs.rmSync(this.comfyDir(), { recursive: true, force: true });
      fs.mkdirSync(staging, { recursive: true });
      await this.extract(archive, staging, signal);
      // archive root is ComfyUI-<tag without v>; take the single entry
      const entries = fs.readdirSync(staging);
      if (entries.length !== 1 || !fs.existsSync(path.join(staging, entries[0], "main.py"))) {
        throw new Error(`unexpected ComfyUI archive layout: ${entries.join(", ")}`);
      }
      fs.renameSync(path.join(staging, entries[0]), this.comfyDir());
      fs.rmSync(staging, { recursive: true, force: true });
      fs.rmSync(archive, { force: true });
    }

    if (!fs.existsSync(this.venvPython())) {
      live.stage = "Creating environment";
      live.progress = 12;
      live.detail = null;
      this.publish();
      await this.run(this.pythonExe(), ["-m", "venv", venvDir], signal, live);
    }

    // pip runs are resumable as a whole: already-satisfied packages are no-ops
    const poller = this.startSizePoller([venvDir, cacheDir], live, 15, 70);
    try {
      live.stage = torchStage("CUDA 13");
      live.progress = 15;
      this.publish();
      // --index-url (not extra): PyPI must not win with a newer CPU-only build.
      // On macOS the index drops and PyPI's own wheels are the MPS builds.
      await this.run(
        this.venvPython(),
        pip(torchArgs(["torch", "torchvision", "torchaudio"], TORCH_INDEX)),
        signal,
        live,
      );

      poller.band(70, 90);
      live.stage = "Installing ComfyUI requirements";
      live.progress = 70;
      this.publish();
      await this.run(
        this.venvPython(),
        pip(["-r", path.join(this.comfyDir(), "requirements.txt")]),
        signal,
        live,
      );

      poller.band(90, 95);
      await this.installAccel(signal, live, cacheDir);
    } finally {
      poller.stop();
    }

    live.stage = "Checking";
    live.progress = 95;
    live.detail = null;
    this.publish();
    const torch = await this.capture(
      this.venvPython(),
      ["-c", `import torch;print(torch.__version__+' accel='+str(${ACCEL_EXPR}))`],
      signal,
    );
    if (!/accel=/.test(torch)) throw new Error(`torch import failed: ${torch || "(no output)"}`);
    live.detail = `torch ${torch}`;

    this.writeExtraModelPaths();
    this.saveRecord({ comfy: COMFY_PIN.tag });
    this.live.delete("comfy");
    this.publish();
  }

  /** Move an existing venv onto the CUDA build TORCH_INDEX now points at.
   *
   * Only ever runs on a venv that is already at COMFY_PIN, because a fresh one
   * gets the right wheels from the index in the first place. It exists because
   * the CUDA runtime is not part of any pin: cu128 → cu130 (2026-08-30, to stop
   * comfy-kitchen disabling its optimized quant kernels) changes nothing that
   * comfyReady() looks at, so the machines that have been rendering longest
   * would be the only ones left on the slow path.
   *
   * Two details make this work rather than silently no-op:
   *   - the version is asked of torch itself, not of pip metadata;
   *   - the reinstall names the FULL local version ("2.11.0+cu130"), because
   *     pip treats a bare "torch==2.11.0" as satisfied by the cu128 build.
   * Same torch, same torchvision, same torchaudio — only the accelerator under
   * them moves, so nothing else in the venv has to be reasoned about.
   *
   * Non-fatal, like the accel step: a runtime that renders is worth more than
   * one that refuses to start because an index was briefly unreachable. */
  private async upgradeTorchCuda(signal: AbortSignal, live: LiveComponent): Promise<void> {
    if (!IS_WINDOWS) return; // macOS has no CUDA build to be on the wrong one of
    const want = TORCH_INDEX.split("/").pop() ?? ""; // "cu130"
    if (!/^cu\d+$/.test(want)) return;
    let installed = "";
    try {
      installed = await this.capture(
        this.venvPython(),
        ["-c", "import torch;print(torch.__version__)"],
        signal,
      );
    } catch {
      return; // no importable torch yet — installComfy's own step owns that
    }
    const m = installed.trim().match(/^([\d.]+)\+(cu\d+)$/);
    if (!m || m[2] === want) return;
    live.stage = torchStage(`CUDA ${want.slice(2, -1)}`);
    live.detail = `${installed.trim()} → ${m[1]}+${want}`;
    this.publish();
    const versions = [`torch==${m[1]}+${want}`];
    for (const [pkg, expr] of [
      ["torchvision", "import torchvision;print(torchvision.__version__)"],
      ["torchaudio", "import torchaudio;print(torchaudio.__version__)"],
    ] as const) {
      try {
        const v = (await this.capture(this.venvPython(), ["-c", expr], signal)).trim();
        const vm = v.match(/^([\d.]+)\+cu\d+$/);
        if (vm) versions.push(`${pkg}==${vm[1]}+${want}`);
      } catch {
        // not installed here; nothing to move
      }
    }
    try {
      await this.run(
        this.venvPython(),
        [
          "-m", "pip", "install", "--disable-pip-version-check", "--no-input",
          "--cache-dir", path.join(this.root(), "pip-cache"),
          ...versions, "--index-url", TORCH_INDEX,
        ],
        signal,
        live,
      );
    } catch (err) {
      if (signal.aborted) throw err;
      live.detail = `CUDA upgrade skipped (${(err as Error).message.slice(0, 120)})`;
      this.publish();
    }
    live.detail = null;
  }

  /** SageAttention and its Triton, into the ComfyUI venv.
   *
   * Allowed to fail. It is a speed-up, not a dependency: every engine here
   * renders without it, so a wheel that does not exist yet for a new torch must
   * leave the runtime installed and working rather than failing the whole setup
   * at 90%. The adapters gate on the KJ node being present, and Settings shows
   * the toggle either way.
   *
   * Called from installComfy for a fresh venv AND from install() for a runtime
   * that was already at the pin — otherwise an install that predates
   * ACCEL_PACKAGES would never get them, which is exactly the machine that has
   * been rendering H3 the longest. pip is a no-op when they are already there. */
  private async installAccel(
    signal: AbortSignal,
    live: LiveComponent,
    cacheDir: string,
  ): Promise<void> {
    if (!ACCEL_PACKAGES) return;
    const stage = live.stage;
    const progress = live.progress;
    live.stage = "Installing SageAttention";
    live.progress = Math.max(progress, 90);
    this.publish();
    try {
      await this.run(
        this.venvPython(),
        [
          "-m", "pip", "install", "--disable-pip-version-check", "--no-input",
          "--cache-dir", cacheDir, ...ACCEL_PACKAGES,
        ],
        signal,
        live,
      );
    } catch (err) {
      if (signal.aborted) throw err;
      live.detail = `SageAttention unavailable (${(err as Error).message.slice(0, 120)})`;
      this.publish();
    }
    live.stage = stage;
  }

  /* ---------- custom nodes ---------- */

  private async installCustomNode(spec: CustomNodeSpec, signal: AbortSignal): Promise<void> {
    const live = this.begin(spec.id);
    const nodeDir = this.nodeDir(spec);
    const cacheDir = path.join(this.root(), "pip-cache");

    // a pin change re-fetches the checkout so code and version can't drift
    if (
      !fs.existsSync(path.join(nodeDir, ...spec.marker.split("/"))) ||
      this.record().nodes?.[spec.id] !== spec.version
    ) {
      live.stage = `Downloading ${spec.name}`;
      this.publish();
      const archive = path.join(this.root(), "downloads", `${spec.id}-${spec.version}.zip`);
      // GitHub generates commit archives on the fly — size unknown, no resume
      await downloadFile(
        { url: spec.url, label: `${spec.name} source`, sizeBytes: null, sha256: null },
        archive,
        signal,
        {
          onBytes: (n) => {
            live.progress = Math.min(20, n / (200 * 1024));
            live.detail = fmtBytes(n);
            this.publish();
          },
        },
      );

      live.stage = "Unpacking";
      live.progress = 20;
      live.detail = null;
      this.publish();
      const staging = path.join(this.root(), `.staging-${spec.id}`);
      fs.rmSync(staging, { recursive: true, force: true });
      fs.rmSync(nodeDir, { recursive: true, force: true });
      fs.mkdirSync(staging, { recursive: true });
      await this.extract(archive, staging, signal);
      // archive root is <repo>-<sha>; take the single entry
      const entries = fs.readdirSync(staging);
      if (
        entries.length !== 1 ||
        !fs.existsSync(path.join(staging, entries[0], ...spec.marker.split("/")))
      ) {
        throw new Error(`unexpected ${spec.name} archive layout: ${entries.join(", ")}`);
      }
      fs.mkdirSync(this.nodesDir(), { recursive: true });
      fs.renameSync(path.join(staging, entries[0]), nodeDir);
      fs.rmSync(staging, { recursive: true, force: true });
      fs.rmSync(archive, { force: true });
    }

    // deps go into the ComfyUI venv — the node runs inside that process
    live.stage = `Installing ${spec.name} dependencies`;
    live.progress = 40;
    this.publish();
    await this.run(
      this.venvPython(),
      [
        "-m", "pip", "install", "--disable-pip-version-check", "--no-input",
        "--cache-dir", cacheDir, ...spec.pipArgs,
      ],
      signal,
      live,
    );

    live.stage = "Checking";
    live.progress = 90;
    live.detail = null;
    this.publish();
    const out = await this.capture(this.venvPython(), ["-c", spec.check.code], signal);
    if (!spec.check.expect.test(out)) {
      throw new Error(`${spec.name} check failed: ${out || "(no output)"}`);
    }
    live.detail = out;

    this.writeExtraModelPaths(); // the nodes mount only appears once one exists
    this.saveRecord({ nodes: { ...this.record().nodes, [spec.id]: spec.version } });
    this.live.delete(spec.id);
    this.publish();
  }

  /* ---------- venv engines ---------- */

  private async installVenvEngine(spec: VenvEngineSpec, signal: AbortSignal): Promise<void> {
    const live = this.begin(spec.id);
    const venvDir = this.venvDir(spec.id);
    const cacheDir = path.join(this.root(), "pip-cache");
    const repoDir = this.engineRepoDir(spec.id);
    // "{repo}" in step args / check code resolves to the pinned checkout
    const sub = (s: string) => s.replaceAll("{repo}", repoDir);

    // a pin change re-fetches the checkout so code and version can't drift
    if (spec.repo && (!fs.existsSync(this.repoMarker(spec)) || this.record().repos?.[spec.id] !== spec.version)) {
      live.stage = `Downloading ${spec.name} source`;
      this.publish();
      const archive = path.join(this.root(), "downloads", `${spec.id}-${spec.version}.zip`);
      // GitHub generates commit archives on the fly — size unknown, no resume
      await downloadFile(
        { url: spec.repo.url, label: `${spec.name} source`, sizeBytes: null, sha256: null },
        archive,
        signal,
        {
          onBytes: (n) => {
            live.progress = Math.min(3, n / (10 * 1024 ** 2));
            live.detail = fmtBytes(n);
            this.publish();
          },
        },
      );

      live.stage = "Unpacking";
      live.progress = 3;
      live.detail = null;
      this.publish();
      const staging = path.join(this.root(), `.staging-${spec.id}`);
      fs.rmSync(staging, { recursive: true, force: true });
      fs.rmSync(repoDir, { recursive: true, force: true });
      fs.mkdirSync(staging, { recursive: true });
      await this.extract(archive, staging, signal);
      // archive root is <repo>-<sha>; take the single entry
      const entries = fs.readdirSync(staging);
      if (
        entries.length !== 1 ||
        !fs.existsSync(path.join(staging, entries[0], ...spec.repo.marker.split("/")))
      ) {
        throw new Error(`unexpected ${spec.name} archive layout: ${entries.join(", ")}`);
      }
      fs.mkdirSync(path.dirname(repoDir), { recursive: true });
      fs.renameSync(path.join(staging, entries[0]), repoDir);
      fs.rmSync(staging, { recursive: true, force: true });
      fs.rmSync(archive, { force: true });
      this.saveRecord({ repos: { ...this.record().repos, [spec.id]: spec.version } });
    }

    if (!fs.existsSync(this.venvEnginePython(spec.id))) {
      live.stage = "Creating environment";
      live.progress = 3;
      this.publish();
      // a half-created venv (crash mid-install) can't be resumed by `-m venv`
      fs.rmSync(venvDir, { recursive: true, force: true });
      await this.run(this.pythonExe(), ["-m", "venv", venvDir], signal, live);
    }

    // pip runs are resumable as a whole: already-satisfied packages are no-ops
    const python = this.venvEnginePython(spec.id);
    const poller = this.startSizePoller([venvDir, cacheDir], live, 6, 90, spec.expectedBytes);
    try {
      const span = (90 - 6) / spec.steps.length;
      for (const [i, step] of spec.steps.entries()) {
        poller.band(6 + span * i, 6 + span * (i + 1));
        live.stage = step.stage;
        live.progress = Math.max(live.progress, 6 + span * i);
        this.publish();
        await this.run(
          python,
          [
            "-m", "pip", "install", "--disable-pip-version-check", "--no-input",
            "--cache-dir", cacheDir, ...step.args.map(sub),
          ],
          signal,
          live,
        );
      }
    } finally {
      poller.stop();
    }

    live.stage = "Checking";
    live.progress = 92;
    live.detail = null;
    this.publish();
    const out = await this.capture(python, ["-c", sub(spec.check.code)], signal);
    if (!spec.check.expect.test(out)) {
      throw new Error(`${spec.name} check failed: ${out || "(no output)"}`);
    }
    live.detail = out;

    this.saveRecord({ venvs: { ...this.record().venvs, [spec.id]: spec.version } });
    this.live.delete(spec.id);
    this.publish();
  }

  /** Regenerated on every write so a moved dataRoot (or an added linked root)
   * stays correct. Note the deliberate asymmetry between the two block kinds:
   *
   *   aurea    — every category maps to "." so the manager's flat store works,
   *              and graphs address weights as <model-id>/<category>/<file>
   *   linked_N — a folder the user already owns, in conventional ComfyUI
   *              layout, so each category maps to its own name and graphs
   *              address those weights by bare filename
   *
   * That asymmetry is why ModelManager.comfyNames() resolves per file rather
   * than per mode. */
  writeExtraModelPaths(): void {
    const { storage } = this.settings.get();
    const models = path.join(storage.dataRoot, "models").replaceAll("\\", "/");
    const nodes = this.nodesDir().replaceAll("\\", "/");
    const linked = storage.modelRoots.flatMap((root, i) => {
      if (!fs.existsSync(root)) return [];
      return [
        `linked_${i}:`,
        `  base_path: ${root.replaceAll("\\", "/")}`,
        // conventional layout — the category IS the folder name
        ...LINKED_CATEGORIES.map((c) => `  ${c}: ${c}`),
      ];
    });
    const lines = [
      "# generated by Aurea — every category resolves inside the model manager's root;",
      "# graphs reference weights as <model-id>/<category>/<file>, so no collisions.",
      "aurea:",
      `  base_path: ${models}`,
      ...COMFY_CATEGORIES.map((c) => `  ${c}: "."`),
      ...(linked.length
        ? ["", "# storage.modelRoots — the user's own libraries, mounted read-only", ...linked]
        : []),
      // custom-node packs are checkouts under runtime/nodes — ComfyUI loads
      // extra custom_nodes search paths before node init (main.py order)
      ...(fs.existsSync(nodes)
        ? ["aurea_nodes:", `  custom_nodes: ${nodes}`]
        : []),
      "",
    ];
    fs.mkdirSync(this.root(), { recursive: true });
    fs.writeFileSync(this.extraModelPathsFile(), lines.join("\n"));
  }

  /* ---------- helpers ---------- */

  private begin(id: RuntimeComponentId): LiveComponent {
    const live: LiveComponent = {
      state: "installing",
      progress: 0,
      stage: null,
      detail: null,
      error: null,
    };
    this.live.set(id, live);
    this.publish();
    return live;
  }

  private async extract(archive: string, dest: string, signal: AbortSignal): Promise<void> {
    // Windows ships bsdtar (System32) which reads both .tar.gz and .zip
    const tar =
      process.platform === "win32"
        ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
        : "tar";
    await this.run(tar, ["-xf", archive, "-C", dest], signal, null);
  }

  /** run a child to completion; non-zero exit throws with the last error line */
  private async run(
    exe: string,
    args: string[],
    signal: AbortSignal,
    live: LiveComponent | null,
  ): Promise<void> {
    let lastLine = "";
    const proc = runProcess({
      exe,
      args,
      logFile: path.join(this.rootEnsured(), "install.log"),
      onLine: (line) => {
        const t = line.trim();
        if (!t) return;
        lastLine = t;
        if (live) {
          live.detail = t.length > 140 ? `${t.slice(0, 140)}…` : t;
          this.publish();
        }
      },
    });
    this.killLive = proc.kill;
    const onAbort = () => proc.kill();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const code = await proc.exited;
      if (signal.aborted) throw new Error("Canceled");
      if (code !== 0) {
        throw new Error(lastLine || `${path.basename(exe)} exited with code ${code}`);
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      this.killLive = null;
    }
  }

  private async capture(exe: string, args: string[], signal: AbortSignal): Promise<string> {
    let out = "";
    const proc = runProcess({ exe, args, onLine: (l) => (out += (out ? " " : "") + l.trim()) });
    const onAbort = () => proc.kill();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      await proc.exited;
      return out;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  /** pip prints nothing during large wheel downloads — estimate progress from
   * how much landed in the venv + wheel cache instead. */
  private startSizePoller(
    dirs: string[],
    live: LiveComponent,
    from: number,
    to: number,
    expectedBytes = PIP_EXPECTED_BYTES,
  ): { band: (from: number, to: number) => void; stop: () => void } {
    let lo = from;
    let hi = to;
    const base = dirs.map((d) => dirSize(d));
    const timer = setInterval(() => {
      const grown = dirs.reduce((sum, d, i) => sum + Math.max(0, dirSize(d) - base[i]), 0);
      const frac = Math.min(0.98, grown / expectedBytes);
      live.progress = Math.max(live.progress, lo + (hi - lo) * frac);
      this.publish();
    }, 4000);
    timer.unref();
    return {
      band: (f, t) => {
        lo = f;
        hi = t;
      },
      stop: () => clearInterval(timer),
    };
  }

  /** stream a snapshot to subscribers, throttled with a trailing edge so the
   * last progress of a burst always lands */
  private publish(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastPublish < PUBLISH_MS) {
      this.publishTimer ??= setTimeout(() => {
        this.publishTimer = undefined;
        this.publish(true);
      }, PUBLISH_MS);
      this.publishTimer.unref();
      return;
    }
    this.lastPublish = now;
    this.emit("update", this.status());
  }

  private rootEnsured(): string {
    const r = this.root();
    fs.mkdirSync(r, { recursive: true });
    return r;
  }

  private recordFile(): string {
    return path.join(this.root(), "runtime.json");
  }

  private record(): RuntimeRecord {
    try {
      return JSON.parse(fs.readFileSync(this.recordFile(), "utf8")) as RuntimeRecord;
    } catch {
      return {};
    }
  }

  private saveRecord(patch: Partial<RuntimeRecord>): void {
    const next = { ...this.record(), ...patch, installedAt: new Date().toISOString() };
    fs.mkdirSync(this.root(), { recursive: true });
    const tmp = `${this.recordFile()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, this.recordFile());
  }
}

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) total += dirSize(p);
      else if (e.isFile()) {
        try {
          total += fs.statSync(p).size;
        } catch {
          /* mid-write */
        }
      }
    }
  } catch {
    /* not created yet */
  }
  return total;
}
