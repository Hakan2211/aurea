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
    id: "ltxv-2b-distilled-fp8",
    name: "LTX Video 2B distilled",
    use: "video",
    engine: "ComfyUI · Video Lab (ltx2)",
    description:
      "Fast image-to-video generation, distilled fp8 build — the Video Lab's entry engine on a single consumer GPU.",
    files: [
      {
        name: "diffusion_models/ltxv-2b-0.9.8-distilled-fp8.safetensors",
        url: "https://huggingface.co/Lightricks/LTX-Video/resolve/main/ltxv-2b-0.9.8-distilled-fp8.safetensors",
        sizeBytes: 4461695684,
        sha256: "d6d8fa8ed3a98346787c2503ac80fb5d7cebcf80e356b79a2ba361fbadf97e15",
      },
    ],
    license: {
      name: "LTX-Video Open Weights License",
      url: "https://huggingface.co/Lightricks/LTX-Video/blob/main/License.txt",
      gated: true,
    },
    essential: true,
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
    id: "qwen-image-edit-2509-fp8",
    name: "Qwen Image Edit 2509",
    use: "image",
    engine: "ComfyUI · reference consistency",
    description:
      "Reference-driven image editing — keeps characters on-model across keyframes without LoRA training.",
    files: [
      {
        name: "diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors",
        url: "https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors",
        sizeBytes: 20430698424,
        sha256: "318568f61951ab9da21100c7b896e3c1da67f0d2efad6421545e022cfaa2b2b4",
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
