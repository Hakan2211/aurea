/* The curated model catalog. Every entry is a real, publicly downloadable
 * weight set for one of the studio's engines: URLs, sizes and sha256s come
 * from the publishers' Hugging Face LFS metadata (or the GitHub release), so
 * the manager can verify integrity after download. Gated licenses (Flux,
 * LTX) require explicit acceptance in the UI before the download starts.
 *
 * File names of ComfyUI-consumed weights carry their Comfy category as a
 * subdirectory ("diffusion_models/…", "vae/…"): the managed ComfyUI mounts
 * <dataRoot>/models for every category, and graphs reference weights as
 * "<model-id>/<category>/<file>" — unique by construction. */

import type { ModelInfo } from "@aurea/shared";

const MIT = { name: "MIT", url: "https://opensource.org/license/mit", gated: false };
const APACHE = {
  name: "Apache 2.0",
  url: "https://www.apache.org/licenses/LICENSE-2.0",
  gated: false,
};
/** vrgamedevgirl84's style set states no licence on its cards — the author's
 * own terms apply, which is exactly why it is gated: the user reads the card
 * and accepts before anything downloads. */
const styleLoraLicense = (repo: string) => ({
  name: "No licence stated — the author's terms (see the model card)",
  url: `https://huggingface.co/vrgamedevgirl84/${repo}`,
  gated: true,
});

const withSize = (m: Omit<ModelInfo, "sizeBytes">): ModelInfo => ({
  ...m,
  sizeBytes: m.files.reduce((sum, f) => sum + f.sizeBytes, 0),
});

export const MODEL_REGISTRY: ModelInfo[] = [
  withSize({
    id: "flux-krea-dev-fp8",
    name: "FLUX.1 Krea [dev]",
    use: "image",
    engine: "ComfyUI · Image Lab (krea2)",
    description:
      "Opinionated photoreal text-to-image — the Image Lab's default engine. fp8-scaled single file, ComfyUI repack.",
    files: [
      {
        name: "diffusion_models/flux1-krea-dev_fp8_scaled.safetensors",
        url: "https://huggingface.co/Comfy-Org/FLUX.1-Krea-dev_ComfyUI/resolve/main/split_files/diffusion_models/flux1-krea-dev_fp8_scaled.safetensors",
        sizeBytes: 11904639672,
        sha256: "b17a8c21703c4d6ffb0e300dd920eff3cfd35c9a72a1abaf107e3788e408b8d8",
      },
    ],
    license: {
      name: "FLUX.1 [dev] Non-Commercial License",
      url: "https://huggingface.co/black-forest-labs/FLUX.1-Krea-dev/blob/main/LICENSE.md",
      gated: true,
    },
    essential: true,
  }),
  withSize({
    id: "ltx-23-22b-fp8",
    name: "LTX 2.3 22B (fp8)",
    use: "video",
    engine: "ComfyUI · Video Lab (ltx2)",
    description:
      "Lightricks' audio-video foundation model — image-to-video with generated sound, and phoneme " +
      "lip-sync when you hand it a voice take (ia2v). Dev fp8 checkpoint + distilled LoRA + Gemma " +
      "prompt encoder + spatial upscaler; ~42 GB, fits a 24 GB GPU with offloading.",
    files: [
      {
        name: "checkpoints/ltx-2.3-22b-dev-fp8.safetensors",
        url: "https://huggingface.co/Lightricks/LTX-2.3-fp8/resolve/main/ltx-2.3-22b-dev-fp8.safetensors",
        sizeBytes: 29145431166,
        sha256: "28606c5b5a06ce56f896d4dfcb20f212739e07a68fbe48e53638188449d26450",
      },
      {
        name: "loras/ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors",
        url: "https://huggingface.co/Comfy-Org/ltx-2.3/resolve/main/split_files/loras/ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors",
        sizeBytes: 2741024390,
        sha256: "31e0c0195fb841bf31af78e8b60858f489e87ddcea4a5239abc80943da65e3ac",
      },
      {
        name: "text_encoders/gemma_3_12B_it_fp4_mixed.safetensors",
        url: "https://huggingface.co/eraRelentless/Gemma_3_12B_it_fp4/resolve/main/gemma_3_12B_it_fp4_mixed.safetensors",
        sizeBytes: 9447702218,
        sha256: "aaca463d11e6d8d2a4bdb0d6299214c15ef78a3f73e0ef8113d5a9d0219b3f6d",
      },
      {
        name: "latent_upscale_models/ltx-2.3-spatial-upscaler-x2-1.1.safetensors",
        url: "https://huggingface.co/Lightricks/LTX-2.3/resolve/main/ltx-2.3-spatial-upscaler-x2-1.1.safetensors",
        sizeBytes: 995743560,
        sha256: "5f416311fa8172b65af67530758964708d29a317b830d689a51143b7f91913ed",
      },
    ],
    license: {
      name: "LTX-2.3 Community License",
      url: "https://huggingface.co/Lightricks/LTX-2.3/blob/main/LICENSE",
      gated: true,
    },
    essential: false,
  }),
  withSize({
    id: "ltx-25-22b-int8",
    name: "LTX 2.5 22B (int8)",
    use: "video",
    engine: "ComfyUI · Video Lab (ltx25)",
    description:
      "Lightricks' 2.5 world model — native multishot, diffusion-fidelity rendering, and a " +
      "distilled transformer good enough to be the only one you run locally. Distilled int8 " +
      "transformer + Gemma 4 12B int8 encoder + video/audio VAEs + spatial upscaler; ~40 GB, " +
      "fits a 24 GB GPU with offloading. Needs ComfyUI 0.32.0+.",
    files: [
      {
        name: "diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
        url: "https://huggingface.co/Lightricks/LTX-2.5/resolve/main/diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
        sizeBytes: 21504034224,
        sha256: "c4279eeff115cbeaca494bd2183e7d768c38fe85a184dc6afbb7159157c44334",
      },
      {
        name: "text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
        url: "https://huggingface.co/Lightricks/LTX-2.5/resolve/main/text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
        sizeBytes: 15372971786,
        sha256: "09a89e084de1a149c3de60cfe9dfd3e5161967eb09eea39e806fcdeffdd568de",
      },
      {
        name: "vae/ltx-2.5-video-vae-bf16.safetensors",
        url: "https://huggingface.co/Lightricks/LTX-2.5/resolve/main/vae/ltx-2.5-video-vae-bf16.safetensors",
        sizeBytes: 1472223346,
        sha256: "847e14ca7f3355debca0cea4eaa24ac0fbcdf0061da054ac89ca638a869ddba3",
      },
      {
        name: "vae/ltx-2.5-audio-vae-bf16.safetensors",
        url: "https://huggingface.co/Lightricks/LTX-2.5/resolve/main/vae/ltx-2.5-audio-vae-bf16.safetensors",
        sizeBytes: 364866540,
        sha256: "c52733d37f6a7fb7949c3dc0fb468c6cb2169e4d836983a73babb9f0d54837a5",
      },
      {
        name: "latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors",
        url: "https://huggingface.co/Lightricks/LTX-2.5/resolve/main/latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors",
        sizeBytes: 995778752,
        sha256: "eb5a71fe4068ee87ccdb1c3aa635e547ca76bd2d30ae20ae889f2c325c0677e8",
      },
    ],
    license: {
      name: "LTX-2.5 Community License",
      url: "https://huggingface.co/Lightricks/LTX-2.5/blob/main/LICENSE.md",
      gated: true,
    },
    essential: false,
  }),
  withSize({
    // the 2.5 prompt enhancer — its own entry because 10 GB of Gemma 4 E2B is
    // a choice, not a requirement: the engine renders fine on the raw prompt
    id: "ltx-25-prompt-enhancer",
    name: "LTX 2.5 Prompt Enhancer (Gemma 4 E2B)",
    use: "video",
    engine: "ComfyUI · Video Lab (ltx25)",
    description:
      "The small Gemma 4 encoder the official LTX 2.5 workflows use to expand a short prompt " +
      "into the detailed shot description the model was trained on — reading the start frame " +
      "too, so the rewrite matches the picture. Optional; without it the raw prompt is used.",
    files: [
      {
        name: "text_encoders/gemma4_e2b_it_bf16.safetensors",
        url: "https://huggingface.co/Comfy-Org/gemma-4/resolve/main/text_encoders/gemma4_e2b_it_bf16.safetensors",
        sizeBytes: 10278774160,
        sha256: "dcc3c8d27be2db2ef38b78d564ebfa1e92eb24665ed2751f2983275f03a067c8",
      },
    ],
    license: {
      name: "Gemma Terms of Use",
      url: "https://ai.google.dev/gemma/terms",
      gated: false,
    },
    essential: false,
  }),
  withSize({
    // the ×2 finishing pass (Video Lab quality plan Q1): an IC-LoRA that reads
    // the finished take as an in-context reference and re-renders it at twice
    // the size with invented detail. Its own entry because it is a finish, not
    // a render — nothing needs it until a take is worth keeping. The filename
    // matches INFRA_LORA (ic-lora), so it stays out of the user LoRA slots.
    id: "ltx-25-spatial-upscaler-ic",
    name: "LTX 2.5 Pixel Spatial Upscaler (IC-LoRA ×2)",
    use: "video",
    engine: "ComfyUI · Video Lab (ltx25) · finish",
    description:
      "Lightricks' ×2 generative upscaler for LTX 2.5: a second pass that reads a finished " +
      "take as its reference and re-renders it at twice the resolution with synthesized " +
      "fur, edge and texture detail — the answer to 2.5's softness at full quality. Used by " +
      "the take's Finish → Upscale action; not needed for rendering.",
    files: [
      {
        name: "loras/ltx-2.5-22b-ic-lora-pixel-spatial-upscaler-x2-1.0.safetensors",
        url: "https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-Pixel-Spatial-Upscaler/resolve/main/ltx-2.5-22b-ic-lora-pixel-spatial-upscaler-x2-1.0.safetensors",
        sizeBytes: 327322640,
        sha256: "984851b769ea2bcb4c9e0a239a7676239e42c6a6001ddc69943b41ff0b283c1d",
      },
    ],
    license: {
      name: "LTX-2 Community License",
      url: "https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-Pixel-Spatial-Upscaler/blob/main/LICENSE.md",
      gated: true,
    },
    essential: false,
  }),
  withSize({
    id: "minimax-h3-gguf",
    name: "MiniMax-H3 (GGUF)",
    use: "video",
    engine: "ComfyUI · Video Lab (minimax-h3)",
    description:
      "MiniMax's omni-modal video model — the only engine here that generates dialogue, sound " +
      "effects and music in the SAME pass as the picture, so a shot comes out already scored " +
      "and lip-synced. First/last-frame mode (fl2va). Ampere-safe quantization: Q3_K_M unet + " +
      "Q2_K Qwen3-VL-32B encoder, ~30 GB, loaded in sequence so the peak fits 24 GB. Expect " +
      "roughly 10× LTX-2.3's render time — this is the hero-shot engine, not the daily one.",
    files: [
      {
        name: "diffusion_models/MiniMax-H3-FL2VA-Q3_K_M.gguf",
        url: "https://huggingface.co/realrebelai/MiniMax-H3_GGUFs/resolve/main/MiniMax-H3-FL2VA-Q3_K_M.gguf",
        sizeBytes: 15577923360,
        sha256: "d809c9e38999eb65dd425a32e034726d5c5c54dacf5d10791e46c49bf8d61be8",
      },
      {
        // Q2_K, not Q4: the 32B encoder and the unet both have to fit the same
        // 24 GB card, and Ampere can't run the NVFP4 encoder Comfy-Org ships
        name: "text_encoders/qwen3vl-32B-MiniMax-H3-Q2_K.gguf",
        url: "https://huggingface.co/realrebelai/MiniMax-H3_GGUFs/resolve/main/qwen3vl-32B-MiniMax-H3-Q2_K.gguf",
        sizeBytes: 8487968160,
        sha256: "5bbc11d0b3ef197c98df2ce8f05de8fbb8eb5917cd91c33d0b59f93759b34914",
      },
      {
        name: "vae/minimax_h3_video_vae_fp16.safetensors",
        url: "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_fp16.safetensors",
        sizeBytes: 5207808496,
        sha256: "7c1f131492e7eddacaac9069a61b81bdd39de5cc96561e677c5eab1cdce5e522",
      },
      {
        // separate from the video VAE — the audio track decodes on its own
        name: "vae/minimax_h3_audio_vae_fp32.safetensors",
        url: "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors",
        sizeBytes: 605254808,
        sha256: "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48",
      },
    ],
    license: {
      name: "MiniMax H3 Community License Agreement",
      url: "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE",
      gated: true,
    },
    essential: false,
  }),
  withSize({
    id: "minimax-h3-ref-gguf",
    name: "MiniMax-H3 Reference (GGUF)",
    use: "video",
    engine: "ComfyUI · Video Lab (minimax-h3 · references)",
    description:
      "H3's reference head (ref2va) — the same model conditioned on things you give it rather " +
      "than on a first frame: up to 9 stills, 3 clips (with their sound) and 3 sound clips, each " +
      "named in the prompt as <Picture 1>, <Video 1>, <Audio 1>. It is how a character, a voice " +
      "or a camera move is carried from one shot into the next, and how a clip is EDITED — " +
      "reference the clip, describe the change. A second 15.6 GB checkpoint that shares the " +
      "base entry's text encoder and both VAEs, so install MiniMax-H3 (GGUF) as well.",
    files: [
      {
        // same Q3_K_M trade as the fl2va head, for the same reason: the 32B
        // encoder and this unet have to take turns in the same 24 GB
        name: "diffusion_models/MiniMax-H3-REF2VA-Q3_K_M.gguf",
        url: "https://huggingface.co/realrebelai/MiniMax-H3_GGUFs/resolve/main/MiniMax-H3-REF2VA-Q3_K_M.gguf",
        sizeBytes: 15577923264,
        sha256: "ada8452ece22ef84497f7f6f7ad07708c4754066127a6ad2c10fab8ae9eee596",
      },
    ],
    license: {
      name: "MiniMax H3 Community License Agreement",
      url: "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE",
      gated: true,
    },
    essential: false,
  }),
  withSize({
    id: "minimax-h3-turbo-lora",
    name: "MiniMax-H3 Turbo LoRAs",
    use: "video",
    engine: "ComfyUI · Video Lab (minimax-h3 · draft)",
    description:
      "LightX2V's distilled few-step LoRAs for MiniMax-H3 — the same joint audio-video pass in " +
      "4 or 8 sampler steps instead of 25. Three weights, one per tier and head: 4-step v1.1 " +
      "(Draft), 8-step v1.0 (Standard — the tier LightX2V runs in its own hosted studio, and " +
      "the one to reach for when a 4-step take looks plastic), and the 4-step ref2v distill for " +
      "H3's reference head, which the fl2v LoRAs do not fit. Final stays the model's own " +
      "25-step schedule with no LoRA at all.",
    files: [
      {
        // Draft. v1.1 over v1.0: same size and shape, later checkpoint.
        name: "loras/minimax_h3_fl2v_turbo_4step_v1.1_768p_comfyui_bf16.safetensors",
        url: "https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/main/minimax_h3_fl2v_turbo_4step_v1.1_768p_comfyui_bf16.safetensors",
        sizeBytes: 1956192992,
        sha256: "449d80f301ac571622c72e28b8fd72a4b3681b7a8df8a92f17c8f6ec43f56558",
      },
      {
        // Standard
        name: "loras/minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors",
        url: "https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/main/minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors",
        sizeBytes: 1956193000,
        sha256: "08cfe946033af7d27719b964b6e0a0e50c32138daabbd6ce4137e23df6bf9980",
      },
      {
        /* The reference head's own distill. Aurea used to put ONE turbo LoRA
         * on both heads on the reasoning that the distill was trained on the
         * shared transformer — LightX2V ships fl2v and ref2v separately, so
         * that reasoning was a guess and this is the publisher's answer. */
        name: "loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors",
        url: "https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/main/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors",
        sizeBytes: 1956193000,
        sha256: "5b9ab5ade15d0775676d01a907268a69a1468dc6033b3b0d3ded5502f3ebb84c",
      },
    ],
    license: APACHE,
    essential: false,
  }),
  withSize({
    id: "minimax-h3-tutu-8step-lora",
    name: "MiniMax-H3 Tutu 20→8 NFE LoRA",
    use: "video",
    engine: "ComfyUI · Video Lab (minimax-h3 · standard)",
    description:
      "A second candidate for the Standard tier: a 20→8 NFE distill of the fl2va head that " +
      "claims to keep H3's stereo audio and lip-sync, where a generic few-step distill tends to " +
      "trade them away. It is NOT a drop-in swap for the LightX2V 8-step weight — the author " +
      "publishes a sampling contract and is explicit that it must be honoured: euler (not " +
      "res_multistep), 8 steps, shift 12/3, strength 0.8, and NINE fixed sigmas that must be " +
      "supplied verbatim (\"do not replace these with a generic uniform 8-step schedule\"). " +
      "Aurea supplies them; the manual schedule needs KJNodes' Custom Sigmas node. Three " +
      "checkpoints ship — step100 is the author's recommended start and the one the adapter " +
      "loads, with 200 and 300 there to A/B against it. Known issue: visible ghosting in fast " +
      "motion. fl2va only — the reference head keeps its own distill.",
    files: [
      {
        // the author's recommended start
        name: "loras/tutu-t8-minimax-h3-av-20to8-nfe-lora-step000100-bf16-comfyui.safetensors",
        url: "https://huggingface.co/tutututututu/Tutu-MiniMax-H3-AudioVideo-20to8-NFE-LoRA/resolve/main/comfyui/tutu-t8-minimax-h3-av-20to8-nfe-lora-step000100-bf16-comfyui.safetensors",
        sizeBytes: 773709596,
        sha256: "d88b5fd7c61e706566cbb42744e33e82f4b6e9ea585f687bfdbd989ab7c6045e",
      },
      {
        name: "loras/tutu-t8-minimax-h3-av-20to8-nfe-lora-step000200-bf16-comfyui.safetensors",
        url: "https://huggingface.co/tutututututu/Tutu-MiniMax-H3-AudioVideo-20to8-NFE-LoRA/resolve/main/comfyui/tutu-t8-minimax-h3-av-20to8-nfe-lora-step000200-bf16-comfyui.safetensors",
        sizeBytes: 773709596,
        sha256: "0709bd8345a5cdc2851fdbd1b66187f69d7e324b7e8883dde5cce40ec613e8c6",
      },
      {
        name: "loras/tutu-t8-minimax-h3-av-20to8-nfe-lora-step000300-bf16-comfyui.safetensors",
        url: "https://huggingface.co/tutututututu/Tutu-MiniMax-H3-AudioVideo-20to8-NFE-LoRA/resolve/main/comfyui/tutu-t8-minimax-h3-av-20to8-nfe-lora-step000300-bf16-comfyui.safetensors",
        sizeBytes: 773709596,
        sha256: "8789aeedd9feedc93babf3643042a86c4256f8b95dbf5d6918a6c89a896a03d3",
      },
    ],
    license: {
      name: "Tutu MiniMax-H3 LoRA licence",
      url: "https://huggingface.co/tutututututu/Tutu-MiniMax-H3-AudioVideo-20to8-NFE-LoRA/blob/main/LICENSE",
      gated: false,
    },
    essential: false,
  }),
  withSize({
    id: "minimax-h3-turbo-lora-v2",
    name: "MiniMax-H3 Turbo LoRAs (Sep–Oct releases)",
    use: "video",
    engine: "ComfyUI · Video Lab (minimax-h3 · draft / standard candidates)",
    description:
      "LightX2V's later distills, as bake-off candidates against the shipped Turbo set — " +
      "nothing renders on them until a payload names them. The first TRUE 8-step ref2v (the " +
      "shipped Standard runs the 4-step ref2v at 8 steps), the 768p 4-step ref2v v1.0, fl2v " +
      "8-step v1.1 and fl2v 4-step v1.2 (\"cleaner, more stable audio\"). Publisher recipe: " +
      "fl2v at video/audio shift 6/3, ref2v at 12/3, Euler. fl2v 4-step v1.3 is left out on " +
      "purpose: its release thread reports it breaking with sparse attention and other LoRAs.",
    files: [
      {
        name: "loras/minimax_h3_fl2v_turbo_8step_v1.1_768p_comfyui_bf16.safetensors",
        url: "https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/main/minimax_h3_fl2v_turbo_8step_v1.1_768p_comfyui_bf16.safetensors",
        sizeBytes: 1956193000,
        sha256: "fb4c00361c94bad47f878d5e096c6cab2f45063b0968bd5756dcb7da6936f53e",
      },
      {
        name: "loras/minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors",
        url: "https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/main/minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors",
        sizeBytes: 1956193000,
        sha256: "6a56f41ab4229c9dd845b9501bbd475ee57e112d846cf2e819d534a1ae928c5a",
      },
      {
        name: "loras/minimax_h3_fl2v_turbo_4step_v1.2_768p_comfyui_bf16.safetensors",
        url: "https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/main/minimax_h3_fl2v_turbo_4step_v1.2_768p_comfyui_bf16.safetensors",
        sizeBytes: 1956193000,
        sha256: "c8168ebc17bbacc4296103dda2fec1ba85b24392fa08cf2bfbcef0cff0dc3cc8",
      },
      {
        name: "loras/minimax_h3_ref2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors",
        url: "https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/main/minimax_h3_ref2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors",
        sizeBytes: 1956193000,
        sha256: "b4da466e43588004097dfbcde245ccc439c34a26bc997cb76a0b53a1d549ea0d",
      },
    ],
    license: APACHE,
    essential: false,
  }),
  withSize({
    id: "minimax-h3-hyperflow-lora",
    name: "MiniMax-H3 HyperFlow 8-step LoRA",
    use: "video",
    engine: "ComfyUI · Video Lab (minimax-h3 · standard candidate)",
    description:
      "Video Rebirth's 8-step HyperFlow distill in drbaph's ComfyUI conversion: pruned (for " +
      "the pruned w4a8 base Aurea's fast path runs) and SVD-resized to rank 20, 316 MB against " +
      "the 3.9 GB original. One weight for both heads. It brings a fixed 9-point sigma ladder " +
      "(read from HyperFlow's own file header, shifted 12 for the sampler) and needs KJNodes' " +
      "Custom Sigmas node. The ComfyUI conversion drops HyperFlow's second time embedder, so " +
      "this is an approximation of the upstream method, not the method.",
    files: [
      {
        name: "loras/minimax_h3_hyperflow_8step_v1.0_comfyui_pruned_bf16_resized_avg_rank_20_bf16.safetensors",
        url: "https://huggingface.co/drbaph/MiniMax-H3-Turbo-Lora-ComfyUI/resolve/main/minimax_h3_hyperflow_8step_v1.0_comfyui_pruned_bf16_resized_avg_rank_20_bf16.safetensors",
        sizeBytes: 315905192,
        sha256: "f8c307078def510312bb374509e70e8a9384e9ac963cf3da3fbf3dab0e630089",
      },
    ],
    license: {
      // the weights' own header: derivative of H3, under H3's licence
      name: "MiniMax H3 Community License Agreement (HyperFlow derivative weights)",
      url: "https://huggingface.co/VideoRebirthAI/hyperflow/blob/main/LICENSE",
      gated: true,
    },
    essential: false,
  }),
  withSize({
    id: "minimax-h3-turbo-v4-lora",
    name: "MiniMax-H3 Turbo v4 step-600 (6-step)",
    use: "video",
    engine: "ComfyUI · Video Lab (minimax-h3 · standard candidate)",
    description:
      "drbaph's recommended workflow weight: the v4 step-600 EMA turbo, converted for pruned " +
      "H3 bases. Card recipe: 6–8 steps, Euler + Beta, strength 1.0, video shift 12, audio " +
      "shift 4–6. Aurea runs it at 6 steps — a rung between Draft (4) and Standard (8). " +
      "fl2va head only.",
    files: [
      {
        name: "loras/minimax_h3_turbo_v4_step600_ema_pruned_comfyui.safetensors",
        url: "https://huggingface.co/drbaph/MiniMax-H3-Turbo-Lora-ComfyUI/resolve/main/minimax_h3_turbo_v4_step600_ema_pruned_comfyui.safetensors",
        sizeBytes: 620285592,
        sha256: "7098acf3ee75028fd9fcd948f50fcc8d995057fabb76f86bd3ca2c0ffc58e409",
      },
    ],
    license: APACHE,
    essential: false,
  }),
  withSize({
    id: "minimax-h3-camera-lora",
    name: "MiniMax-H3 Camera Motion LoRA",
    use: "video",
    engine: "ComfyUI · Video Lab (minimax-h3 · camera)",
    description:
      "Camera control for H3, which otherwise has none: the prompt is its whole surface, so a " +
      "move was only ever a description and the model took it or left it. Jojocodex's LoRA " +
      "gives push-in, pull-back, orbit, handheld tracking, crane, pan, tilt, macro and aerial " +
      "as steerable moves. The trigger phrase `camera motion` must OPEN the prompt — the " +
      "adapter prepends it. Strength 0.8 is gentle, 1.0 pronounced, past 1.2 unstable; " +
      "push-in, pull-back and handheld are the author's most stable moves and pan the weakest. " +
      "Two checkpoints ship: the 3000-step weight is the default and the 1000-step one is " +
      "there to A/B against it.",
    files: [
      {
        name: "loras/camera_motion_h3_lora_v1_3000_pruned.safetensors",
        url: "https://huggingface.co/Jojocodex/minimax-h3-Camera-Motion-lora/resolve/main/camera_motion_h3_lora_v1_3000_pruned.safetensors",
        sizeBytes: 155109680,
        sha256: "9d7d98d7377f56efed3aa7d507f767936112d208906f49908ec9a8ae912be88b",
      },
      {
        // the gentler checkpoint — A/B experiment #3 in the upgrade plan
        name: "loras/camera_motion_h3_lora_v1_1000_pruned.safetensors",
        url: "https://huggingface.co/Jojocodex/minimax-h3-Camera-Motion-lora/resolve/main/camera_motion_h3_lora_v1_1000_pruned.safetensors",
        sizeBytes: 155109488,
        sha256: "c126738c887804ace3a4be4a3156fcca70517613c7a7ece4e5938d372419186b",
      },
    ],
    license: APACHE,
    essential: false,
  }),
  withSize({
    id: "ltx-style-anime",
    name: "LTX style · Fantasy anime",
    use: "video",
    engine: "ComfyUI · Video Lab (ltx2 / ltx25 · style)",
    description:
      "Cinematic fantasy-anime cel-shaded illustration: hand-drawn linework, painted shading, expressive faces. " +
      "One of vrgamedevgirl84's LTX 2.3 22b style adapters (F3 of the freeform plan): a LOOK names it " +
      "by file in payload.loras and the adapters resolve the install's own name. Trained on 2.3; the " +
      "2.5 adapter loads the same keys. Strength 1.0 is the author's; the trigger word `f4nt4sy4n1m6` " +
      "helps but is not required. MEASURED 2026-09-02 (one seed, enhancer off): a clear win over prose alone — the prose arm renders a 3D CG fox, this one a true 2D cel-shaded frame. Ships on the Anime cel look.",
    files: [
      {
        name: "loras/Fantasy_Anime.safetensors",
        url: "https://huggingface.co/vrgamedevgirl84/LTX_2.3_Fantasy_Anime_Style_LoRa/resolve/main/Fantasy_Anime.safetensors",
        sizeBytes: 352679880,
        sha256: "8e0d80a8ee65a2d76057f6cdbc2ba125f56385624040bca67cadddd16d10187a",
      },
    ],
    license: styleLoraLicense("LTX_2.3_Fantasy_Anime_Style_LoRa"),
    essential: false,
  }),
  withSize({
    id: "ltx-style-claymation",
    name: "LTX style · Claymation",
    use: "video",
    engine: "ComfyUI · Video Lab (ltx2 / ltx25 · style)",
    description:
      "Stop-motion clay diorama: sculpted figures with fingerprints, miniature sets, warm cinematic light. " +
      "One of vrgamedevgirl84's LTX 2.3 22b style adapters (F3 of the freeform plan): a LOOK names it " +
      "by file in payload.loras and the adapters resolve the install's own name. Trained on 2.3; the " +
      "2.5 adapter loads the same keys. Strength 1.0 is the author's; the trigger word `claymation style` " +
      "helps but is not required. MEASURED 2026-09-02 (one seed, enhancer off): NOT shipped on a look — the prose arm was, if anything, more felted than the adapter's. The Claymation look renders on H3, which has no LoRA arm at all.",
    files: [
      {
        name: "loras/Claymation.safetensors",
        url: "https://huggingface.co/vrgamedevgirl84/LTX_2.3_Clay_Mation_Style_LoRa/resolve/main/Claymation.safetensors",
        sizeBytes: 352679880,
        sha256: "e1098c8b7e6f8bc6a183ce21f5aa9b7f528e3de1c9294eecc4d82d0c3dc3f923",
      },
    ],
    license: styleLoraLicense("LTX_2.3_Clay_Mation_Style_LoRa"),
    essential: false,
  }),
  withSize({
    id: "ltx-style-painterly",
    name: "LTX style · Fantasy painterly",
    use: "video",
    engine: "ComfyUI · Video Lab (ltx2 / ltx25 · style)",
    description:
      "Oil-painted cinematic fantasy: visible brushwork, layered paint texture, luminous highlights. " +
      "One of vrgamedevgirl84's LTX 2.3 22b style adapters (F3 of the freeform plan): a LOOK names it " +
      "by file in payload.loras and the adapters resolve the install's own name. Trained on 2.3; the " +
      "2.5 adapter loads the same keys. Strength 1.0 is the author's; the trigger word `D4rkP41nt3r` " +
      "helps but is not required. MEASURED 2026-09-02 (one seed, enhancer off): a clear win over prose alone — visible impasto brushwork and canvas where the prose arm was photographic. Ships on the Oil-paint look.",
    files: [
      {
        name: "loras/Fantasy_Painterly.safetensors",
        url: "https://huggingface.co/vrgamedevgirl84/LTX_2.3_Fantasy_Painterly_Style_LoRa/resolve/main/Fantasy_Painterly.safetensors",
        sizeBytes: 352679888,
        sha256: "4a12d30f8277e9d7be8431b4d35214af7c62bc188807a5c53dc47e9a8ff562c4",
      },
    ],
    license: styleLoraLicense("LTX_2.3_Fantasy_Painterly_Style_LoRa"),
    essential: false,
  }),
  withSize({
    id: "ltx-style-pixar-toon",
    name: "LTX style · CGI toon",
    use: "video",
    engine: "ComfyUI · Video Lab (ltx2 / ltx25 · style)",
    description:
      "Feature-animation CGI toon: smooth stylised surfaces, big expressive eyes, soft global illumination (no studio IP in the set). " +
      "One of vrgamedevgirl84's LTX 2.3 22b style adapters (F3 of the freeform plan): a LOOK names it " +
      "by file in payload.loras and the adapters resolve the install's own name. Trained on 2.3; the " +
      "2.5 adapter loads the same keys. Strength 1.0 is the author's; the trigger word `P1x4r` " +
      "helps but is not required. MEASURED 2026-09-02 (one seed, enhancer off): NOT shipped on a look — the prose already renders a clean CGI toon and the adapter's difference was marginal. Installable if you want to try it.",
    files: [
      {
        name: "loras/Pixar_Toon.safetensors",
        url: "https://huggingface.co/vrgamedevgirl84/LTX_2.3_Pixar_Toon_Style_LoRa/resolve/main/Pixar_Toon.safetensors",
        sizeBytes: 352679872,
        sha256: "7606e01d7e9bccbd983b720062e3ce6118f3efaa4c233f5448dc78eebf5e140b",
      },
    ],
    license: styleLoraLicense("LTX_2.3_Pixar_Toon_Style_LoRa"),
    essential: false,
  }),
  withSize({
    id: "ltx-style-papercut",
    name: "LTX style · Paper cut-out",
    use: "video",
    engine: "ComfyUI · Video Lab (ltx2 / ltx25 · style)",
    description:
      "Layered paper diorama: cut edges, stacked sheets, slight curl, cosy storybook light. " +
      "One of vrgamedevgirl84's LTX 2.3 22b style adapters (F3 of the freeform plan): a LOOK names it " +
      "by file in payload.loras and the adapters resolve the install's own name. Trained on 2.3; the " +
      "2.5 adapter loads the same keys. Strength 1.0 is the author's; the trigger word `Pap3rCut0u7` " +
      "helps but is not required. MEASURED 2026-09-02 (one seed, enhancer off): NOT shipped on a look — it moved the props towards card but left a plush 3D subject, so neither arm was true paper cut-out. Installable if you want to try it.",
    files: [
      {
        name: "loras/PaperCutOutStyle.safetensors",
        url: "https://huggingface.co/vrgamedevgirl84/LTX_2.3_Paper_Cut_Out_Style_LoRa/resolve/main/PaperCutOutStyle.safetensors",
        sizeBytes: 352679880,
        sha256: "7e3baf133a9ebd05c9ea0102be3744a7308d89a6dc405d8809e0f0519a24543b",
      },
    ],
    license: styleLoraLicense("LTX_2.3_Paper_Cut_Out_Style_LoRa"),
    essential: false,
  }),
  withSize({
    id: "minimax-h3-w4a8",
    name: "MiniMax-H3 (w4a8 · fast)",
    use: "video",
    engine: "ComfyUI · Video Lab (minimax-h3)",
    description:
      "The fl2va head as 4-bit weights with int8 activations, plus the int8 video VAE. Same " +
      "model as the GGUF entry, a different bargain: GGUF dequantizes every weight back to " +
      "bf16 on every forward, where w4a8 unpacks once and multiplies on the card's INT8 tensor " +
      "cores. 12.5 GB instead of 15.6 (and 3.2 instead of 5.2 for the VAE), so the DiT stops " +
      "sharing 24 GB with its own text encoder. Needs ComfyUI 0.31+; still uses the GGUF " +
      "entry's Qwen3-VL text encoder and audio VAE, so install that one too.",
    files: [
      {
        name: "diffusion_models/minimax_h3_fl2va_pruned_w4a8_mixed.safetensors",
        url: "https://huggingface.co/Kijai/MiniMax-H3-experimental/resolve/main/minimax_h3_fl2va_pruned_w4a8_mixed.safetensors",
        sizeBytes: 12540858008,
        sha256: "01aa7b92c007c599890461c325f9b7e3c96fb06c36f242f95b62f7f20e538dec",
      },
      {
        // ~1.5× on the decode, and 2 GB of headroom back at the exact moment
        // the graph is holding a full-length latent
        name: "vae/minimax_h3_video_vae_int8_convrot.safetensors",
        url: "https://huggingface.co/Kijai/MiniMax-H3-experimental/resolve/main/minimax_h3_video_vae_int8_convrot.safetensors",
        sizeBytes: 3171670912,
        sha256: "9bb2d96f218c76babd85e0611b85ca8fb330a90546c01a0005e8a58a59593410",
      },
    ],
    license: {
      name: "MiniMax H3 Community License Agreement",
      url: "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE",
      gated: true,
    },
    essential: false,
  }),
  withSize({
    id: "minimax-h3-ref-w4a8",
    name: "MiniMax-H3 Reference (w4a8 · fast)",
    use: "video",
    engine: "ComfyUI · Video Lab (minimax-h3 · references)",
    description:
      "The ref2va head in the same 4-bit/int8 format — 11.8 GB against the GGUF's 15.6. Pairs " +
      "with MiniMax-H3 (w4a8): the two heads are separate checkpoints, and a reference shot " +
      "renders on this one.",
    files: [
      {
        name: "diffusion_models/minimax_h3_ref2va_pruned_w4a8_mixed.safetensors",
        url: "https://huggingface.co/Kijai/MiniMax-H3-experimental/resolve/main/minimax_h3_ref2va_pruned_w4a8_mixed.safetensors",
        sizeBytes: 11770657048,
        sha256: "de2c6c29c4ee702b45e48e40daae3834aeee58ab681c732d9152589a87c89910",
      },
    ],
    license: {
      name: "MiniMax H3 Community License Agreement",
      url: "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE",
      gated: true,
    },
    essential: false,
  }),
  withSize({
    id: "minimax-h3-sla-lora",
    name: "MiniMax-H3 Turbo SLA LoRA",
    use: "video",
    engine: "ComfyUI · Video Lab (minimax-h3 · draft)",
    description:
      "The 4-step distill again, trained to render with 85% of its attention thrown away " +
      "(sparse linear attention). LightX2V measured ~2.5× on a 5090 against their own 4-step " +
      "baseline. Optional and separate from the Turbo entry on purpose: the speed-up is in the " +
      "sparse-attention kernels, so on a card or a ComfyUI without them this weight is simply " +
      "the v0.1 4-step LoRA with none of the win.",
    files: [
      {
        name: "loras/minimax_h3_fl2v_turbo_4step_v0.1_768p_sla_comfyui_bf16.safetensors",
        url: "https://huggingface.co/lightx2v/Minimax-h3-Turbo-SLA/resolve/main/minimax_h3_fl2v_turbo_4step_v0.1_768p_sla_comfyui_bf16.safetensors",
        sizeBytes: 1956192992,
        sha256: "5cae6df40a06ea825f85fc8876c9ea1c9692c833a9af07bb8b3bac9ce2a71bac",
      },
    ],
    license: APACHE,
    essential: false,
  }),
  withSize({
    id: "z-image-turbo",
    name: "Z-Image Turbo",
    use: "image",
    engine: "ComfyUI · Image Lab (z-image)",
    description:
      "Tongyi's 6B distilled text-to-image — 8-step generations, the managed Image Lab's built-in engine.",
    files: [
      {
        name: "diffusion_models/z_image_turbo_bf16.safetensors",
        url: "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors",
        sizeBytes: 12309866400,
        sha256: "2407613050b809ffdff18a4ac99af83ea6b95443ecebdf80e064a79c825574a6",
      },
      {
        name: "text_encoders/qwen_3_4b.safetensors",
        url: "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors",
        sizeBytes: 8044982048,
        sha256: "6c671498573ac2f7a5501502ccce8d2b08ea6ca2f661c458e708f36b36edfc5a",
      },
      {
        name: "vae/ae.safetensors",
        url: "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors",
        sizeBytes: 335304388,
        sha256: "afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38",
      },
    ],
    license: APACHE,
    essential: true,
  }),
  withSize({
    id: "krea2-turbo-gguf",
    name: "Krea 2 Turbo (GGUF)",
    use: "image",
    engine: "ComfyUI · Image Lab (krea2)",
    description:
      "Krea's flagship photoreal text-to-image, Q8 GGUF quantization — fits a 24 GB GPU through the managed GGUF loader nodes.",
    files: [
      {
        name: "diffusion_models/krea2_turbo-Q8_0.gguf",
        url: "https://huggingface.co/vantagewithai/Krea-2-Turbo-GGUF/resolve/main/krea2_turbo-Q8_0.gguf",
        sizeBytes: 13705958688,
        sha256: "1fa2da08a7a708827c2100d0af41c8371d79efd9f7c5490c23ebc65408536490",
      },
      {
        name: "text_encoders/qwen3vl_4b_bf16.safetensors",
        url: "https://huggingface.co/Comfy-Org/Krea-2/resolve/main/text_encoders/qwen3vl_4b_bf16.safetensors",
        sizeBytes: 8875719384,
        sha256: "36f3ff447ef59201722e8f9ce6020c9819fdcfba6aa2608c4e09b1c0ce114e34",
      },
      {
        name: "vae/qwen_image_vae.safetensors",
        url: "https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors",
        sizeBytes: 253806246,
        sha256: "a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f",
      },
    ],
    license: {
      name: "Krea 2 Community License",
      url: "https://huggingface.co/krea/Krea-2-Turbo/blob/main/LICENSE.pdf",
      gated: true,
    },
    essential: false,
  }),
  withSize({
    id: "chatterbox-tts",
    name: "Chatterbox TTS",
    use: "voice",
    engine: "Voice Lab (character voices)",
    description:
      "Resemble AI's zero-shot voice cloning TTS — powers the character voice roster with emotion control.",
    files: [
      {
        name: "t3_cfg.safetensors",
        url: "https://huggingface.co/ResembleAI/chatterbox/resolve/main/t3_cfg.safetensors",
        sizeBytes: 2129653744,
        sha256: "914cb1696f47527fe8852ca8f1fe1fa63cb34f76f9c715e84e067b744dd0da81",
      },
      {
        name: "s3gen.safetensors",
        url: "https://huggingface.co/ResembleAI/chatterbox/resolve/main/s3gen.safetensors",
        sizeBytes: 1056484620,
        sha256: "2b78103c654207393955e4900aac14a12de8ef25f4b09424f1ef91941f161d4e",
      },
      {
        name: "ve.safetensors",
        url: "https://huggingface.co/ResembleAI/chatterbox/resolve/main/ve.safetensors",
        sizeBytes: 5695784,
        sha256: "f0921cab452fa278bc25cd23ffd59d36f816d7dc5181dd1bef9751a7fb61f63c",
      },
      {
        name: "conds.pt",
        url: "https://huggingface.co/ResembleAI/chatterbox/resolve/main/conds.pt",
        sizeBytes: 107374,
        sha256: "6552d70568833628ba019c6b03459e77fe71ca197d5c560cef9411bee9d87f4e",
      },
      {
        name: "tokenizer.json",
        url: "https://huggingface.co/ResembleAI/chatterbox/resolve/main/tokenizer.json",
        sizeBytes: 25470,
        sha256: null,
      },
    ],
    license: MIT,
    essential: true,
  }),
  withSize({
    id: "acestep-v15",
    name: "ACE-Step 1.5",
    use: "music",
    engine: "Music Lab (ACE-Step)",
    description:
      "Open-source music foundation model — full songs with vocals in seconds on a consumer GPU. Files mirror the checkout layout the engine expects (project_root/checkpoints/…).",
    files: [
      {
        name: "checkpoints/config.json",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/config.json",
        sizeBytes: 1968,
        sha256: null,
      },
      {
        name: "checkpoints/vae/config.json",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/vae/config.json",
        sizeBytes: 425,
        sha256: null,
      },
      {
        name: "checkpoints/vae/diffusion_pytorch_model.safetensors",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/vae/diffusion_pytorch_model.safetensors",
        sizeBytes: 337431388,
        sha256: "da17edb604c40deaf09e9b24974e590d1ca83a374070e5d0884cfa4bed9a99b0",
      },
      {
        name: "checkpoints/acestep-v15-turbo/config.json",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/acestep-v15-turbo/config.json",
        sizeBytes: 1968,
        sha256: null,
      },
      {
        // ACE-Step syncs its remote-code .py files into the checkpoint dir
        // at init when they diverge from the source checkout — mutable
        name: "checkpoints/acestep-v15-turbo/configuration_acestep_v15.py",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/acestep-v15-turbo/configuration_acestep_v15.py",
        sizeBytes: 13130,
        sha256: null,
        mutable: true,
      },
      {
        name: "checkpoints/acestep-v15-turbo/modeling_acestep_v15_turbo.py",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/acestep-v15-turbo/modeling_acestep_v15_turbo.py",
        sizeBytes: 96036,
        sha256: null,
        mutable: true,
      },
      {
        name: "checkpoints/acestep-v15-turbo/model.safetensors",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/acestep-v15-turbo/model.safetensors",
        sizeBytes: 4787825604,
        sha256: "3f6e0797fad420a39bd33979eb6e840e30989e34a3794e843d23b60ec6e422d7",
      },
      {
        name: "checkpoints/acestep-v15-turbo/silence_latent.pt",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/acestep-v15-turbo/silence_latent.pt",
        sizeBytes: 3841215,
        sha256: "a778e9dd942f5e8b2c09c55370782d318834432b03dabbcdf70e6ed49ad6358b",
      },
      {
        name: "checkpoints/acestep-5Hz-lm-1.7B/added_tokens.json",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/acestep-5Hz-lm-1.7B/added_tokens.json",
        sizeBytes: 2217787,
        sha256: null,
      },
      {
        name: "checkpoints/acestep-5Hz-lm-1.7B/chat_template.jinja",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/acestep-5Hz-lm-1.7B/chat_template.jinja",
        sizeBytes: 4168,
        sha256: null,
      },
      {
        name: "checkpoints/acestep-5Hz-lm-1.7B/config.json",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/acestep-5Hz-lm-1.7B/config.json",
        sizeBytes: 1385,
        sha256: null,
      },
      {
        name: "checkpoints/acestep-5Hz-lm-1.7B/merges.txt",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/acestep-5Hz-lm-1.7B/merges.txt",
        sizeBytes: 1671853,
        sha256: null,
      },
      {
        name: "checkpoints/acestep-5Hz-lm-1.7B/model.safetensors",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/acestep-5Hz-lm-1.7B/model.safetensors",
        sizeBytes: 3708521528,
        sha256: "f161689da73e5ecefa28ff780d51c2d92a00f056d021d7933c779ed5c6cd7db8",
      },
      {
        name: "checkpoints/acestep-5Hz-lm-1.7B/special_tokens_map.json",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/acestep-5Hz-lm-1.7B/special_tokens_map.json",
        sizeBytes: 1824199,
        sha256: null,
      },
      {
        name: "checkpoints/acestep-5Hz-lm-1.7B/tokenizer.json",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/acestep-5Hz-lm-1.7B/tokenizer.json",
        sizeBytes: 24321939,
        sha256: "35af56c3f5cb3ea2cc578aa28a8937770981d504f183ac5c8c38baf4bbd4af4d",
      },
      {
        name: "checkpoints/acestep-5Hz-lm-1.7B/tokenizer_config.json",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/acestep-5Hz-lm-1.7B/tokenizer_config.json",
        sizeBytes: 14072925,
        sha256: "6cd70cdd89425971794f5235562edcc608b0629a6c4686ae51a8b8c8b8ba5e95",
      },
      {
        name: "checkpoints/acestep-5Hz-lm-1.7B/vocab.json",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/acestep-5Hz-lm-1.7B/vocab.json",
        sizeBytes: 2776833,
        sha256: null,
      },
      {
        name: "checkpoints/Qwen3-Embedding-0.6B/added_tokens.json",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/Qwen3-Embedding-0.6B/added_tokens.json",
        sizeBytes: 707,
        sha256: null,
      },
      {
        name: "checkpoints/Qwen3-Embedding-0.6B/chat_template.jinja",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/Qwen3-Embedding-0.6B/chat_template.jinja",
        sizeBytes: 4116,
        sha256: null,
      },
      {
        name: "checkpoints/Qwen3-Embedding-0.6B/config.json",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/Qwen3-Embedding-0.6B/config.json",
        sizeBytes: 1359,
        sha256: null,
      },
      {
        name: "checkpoints/Qwen3-Embedding-0.6B/merges.txt",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/Qwen3-Embedding-0.6B/merges.txt",
        sizeBytes: 1671853,
        sha256: null,
      },
      {
        name: "checkpoints/Qwen3-Embedding-0.6B/model.safetensors",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/Qwen3-Embedding-0.6B/model.safetensors",
        sizeBytes: 1191586416,
        sha256: "0437e45c94563b09e13cb7a64478fc406947a93cb34a7e05870fc8dcd48e23fd",
      },
      {
        name: "checkpoints/Qwen3-Embedding-0.6B/special_tokens_map.json",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/Qwen3-Embedding-0.6B/special_tokens_map.json",
        sizeBytes: 613,
        sha256: null,
      },
      {
        name: "checkpoints/Qwen3-Embedding-0.6B/tokenizer.json",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/Qwen3-Embedding-0.6B/tokenizer.json",
        sizeBytes: 11423705,
        sha256: "def76fb086971c7867b829c23a26261e38d9d74e02139253b38aeb9df8b4b50a",
      },
      {
        name: "checkpoints/Qwen3-Embedding-0.6B/tokenizer_config.json",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/Qwen3-Embedding-0.6B/tokenizer_config.json",
        sizeBytes: 5404,
        sha256: null,
      },
      {
        name: "checkpoints/Qwen3-Embedding-0.6B/vocab.json",
        url: "https://huggingface.co/ACE-Step/Ace-Step1.5/resolve/main/Qwen3-Embedding-0.6B/vocab.json",
        sizeBytes: 2776833,
        sha256: null,
      },
    ],
    license: MIT,
    essential: true,
  }),
  withSize({
    id: "kokoro-82m",
    name: "Kokoro 82M",
    use: "voice",
    engine: "Voice Lab (narrator voices)",
    description:
      "Lightweight high-quality narration TTS — instant clean reads for voiceover formats.",
    files: [
      {
        name: "kokoro-v1_0.pth",
        url: "https://huggingface.co/hexgrad/Kokoro-82M/resolve/main/kokoro-v1_0.pth",
        sizeBytes: 327212226,
        sha256: "496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4",
      },
    ],
    license: APACHE,
    essential: false,
  }),
  withSize({
    id: "qwen-image-edit-2509-gguf",
    name: "Qwen Image Edit 2509 (GGUF)",
    use: "image",
    engine: "ComfyUI · Storyboard keyframes",
    description:
      "Reference-driven image generation — keeps characters on-model across storyboard keyframes " +
      "without LoRA training (the videofast-proven Q5_K_M stack; needs the GGUF loader nodes).",
    files: [
      {
        name: "diffusion_models/Qwen-Image-Edit-2509-Q5_K_M.gguf",
        url: "https://huggingface.co/QuantStack/Qwen-Image-Edit-2509-GGUF/resolve/main/Qwen-Image-Edit-2509-Q5_K_M.gguf",
        sizeBytes: 14934899232,
        sha256: "9e3f23a2c662fd4ccc84ca259fa93a6e5a6beec81a51662f4437a6a399b84d87",
      },
      {
        name: "text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors",
        url: "https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors",
        sizeBytes: 9384670680,
        sha256: "cb5636d852a0ea6a9075ab1bef496c0db7aef13c02350571e388aea959c5c0b4",
      },
      {
        name: "vae/qwen_image_vae.safetensors",
        url: "https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors",
        sizeBytes: 253806246,
        sha256: "a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f",
      },
    ],
    license: APACHE,
    essential: false,
  }),
  withSize({
    id: "qwen-edit-upscale2k-lora",
    name: "Qwen Image Edit — Upscale2K LoRA",
    use: "image",
    engine: "ComfyUI · Image lab upscale (refine)",
    description:
      "Diffusion upscaler LoRA that re-renders a still at ~2K with invented detail. Published " +
      "against Qwen-Image-Edit-2511; runs on the 2509 GGUF stack this studio already installs " +
      "(same DiT architecture) — rides on top of Qwen Image Edit 2509 (GGUF), which it needs.",
    files: [
      {
        name: "loras/qwen_image_edit_2511_upscale.safetensors",
        url: "https://huggingface.co/starsfriday/Qwen-Image-Edit-2511-Upscale2K/resolve/main/qwen_image_edit_2511_upscale.safetensors",
        sizeBytes: 590057176,
        sha256: "2be84dd96690311cebfa86bf5c5a3a656bd6ca4da6181dcbeea794a227bd2a74",
      },
    ],
    license: APACHE,
    essential: false,
  }),
  withSize({
    id: "realesrgan-x4plus",
    name: "Real-ESRGAN x4+",
    use: "utility",
    engine: "Pipeline · upscaling",
    description: "4× image upscaler for thumbnails and video frames.",
    files: [
      {
        name: "upscale_models/RealESRGAN_x4plus.pth",
        url: "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth",
        sizeBytes: 67040989,
        sha256: "4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1",
      },
    ],
    license: {
      name: "BSD 3-Clause",
      url: "https://github.com/xinntao/Real-ESRGAN/blob/master/LICENSE",
      gated: false,
    },
    essential: true,
  }),
];
