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
