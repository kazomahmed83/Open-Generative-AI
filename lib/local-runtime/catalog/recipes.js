// lib/local-runtime/catalog/recipes.js
// Curated, hand-picked models that are known to fit a 12 GB / 32 GB machine. Each is a "recipe":
// an engine + how to install it (files->folders, or an ollama pull) + how to run it (workflow).
const HF = 'https://huggingface.co';

const RECIPES = [
  // ---- Image / ComfyUI ----
  {
    id: 'comfyui:flux2-klein', name: 'FLUX.2 Klein (9B)',
    description: 'Distilled 9B FLUX.2 (Apache). Q4 GGUF unet + Qwen3-8B encoder (klein uses Qwen3, not Mistral).',
    category: 'image', engine: 'comfyui', provider: 'comfyui',
    sizeBytes: 14_300_000_000, fit: { minVramGb: 8, recVramGb: 12 }, workflow: 'flux2',
    files: [
      { url: `${HF}/unsloth/FLUX.2-klein-base-9B-GGUF/resolve/main/flux-2-klein-base-9b-Q4_K_M.gguf`, dest: 'unet/flux-2-klein-base-9b-Q4_K_M.gguf' },
      { url: `${HF}/Comfy-Org/vae-text-encorder-for-flux-klein-9b/resolve/main/split_files/text_encoders/qwen_3_8b_fp8mixed.safetensors`, dest: 'text_encoders/qwen_3_8b_fp8mixed.safetensors' },
      { url: `${HF}/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors`, dest: 'vae/flux2-vae.safetensors' },
    ],
    requiresNode: { name: 'ComfyUI-GGUF', repo: 'https://github.com/city96/ComfyUI-GGUF', dir: 'ComfyUI-GGUF' },
  },
  {
    id: 'comfyui:juggernaut-xl', name: 'Juggernaut XL v9',
    description: 'Photoreal SDXL finetune. Single 7 GB checkpoint.',
    category: 'image', engine: 'comfyui', provider: 'comfyui',
    sizeBytes: 7_100_000_000, fit: { minVramGb: 6, recVramGb: 8 }, workflow: 'sdxl',
    files: [{ url: `${HF}/RunDiffusion/Juggernaut-XL-v9/resolve/main/Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors`, dest: 'checkpoints/juggernaut-xl-v9.safetensors' }],
  },
  {
    id: 'comfyui:flux1-schnell', name: 'FLUX.1 Schnell (fp8)',
    description: 'Fast 4-step FLUX.1 (Apache). Single fp8 checkpoint, no extra encoders.',
    category: 'image', engine: 'comfyui', provider: 'comfyui',
    sizeBytes: 17_200_000_000, fit: { minVramGb: 8, recVramGb: 12 }, workflow: 'sdxl',
    files: [{ url: `${HF}/Comfy-Org/flux1-schnell/resolve/main/flux1-schnell-fp8.safetensors`, dest: 'checkpoints/flux1-schnell-fp8.safetensors' }],
  },
  // ---- Chat / Ollama (installed via `ollama pull`) ----
  { id: 'ollama:qwen3',         name: 'Qwen3 (8B)',         description: 'Strong general + reasoning chat model.',                  category: 'chat', engine: 'ollama', provider: 'ollama', sizeBytes: 5_200_000_000, fit: { minVramGb: 6, recVramGb: 8 },  pull: 'qwen3' },
  { id: 'ollama:llama3.2',      name: 'Llama 3.2 (3B)',     description: 'Small, fast Meta chat model.',                            category: 'chat', engine: 'ollama', provider: 'ollama', sizeBytes: 2_000_000_000, fit: { minVramGb: 4, recVramGb: 6 },  pull: 'llama3.2' },
  { id: 'ollama:mistral',       name: 'Mistral (7B)',       description: 'Well-rounded 7B instruct model.',                         category: 'chat', engine: 'ollama', provider: 'ollama', sizeBytes: 4_100_000_000, fit: { minVramGb: 5, recVramGb: 8 },  pull: 'mistral' },
  { id: 'ollama:phi4',          name: 'Phi-4 (14B)',        description: 'Microsoft reasoning-tuned model.',                        category: 'chat', engine: 'ollama', provider: 'ollama', sizeBytes: 9_100_000_000, fit: { minVramGb: 9, recVramGb: 12 }, pull: 'phi4' },
  { id: 'ollama:gemma2',        name: 'Gemma 2 (9B)',       description: "Google's compact, capable chat model.",                   category: 'chat', engine: 'ollama', provider: 'ollama', sizeBytes: 5_400_000_000, fit: { minVramGb: 6, recVramGb: 8 },  pull: 'gemma2' },
  { id: 'ollama:deepseek-r1',   name: 'DeepSeek-R1 (7B)',   description: 'Open reasoning model with visible chain-of-thought.',      category: 'chat', engine: 'ollama', provider: 'ollama', sizeBytes: 4_700_000_000, fit: { minVramGb: 5, recVramGb: 8 },  pull: 'deepseek-r1' },
  { id: 'ollama:qwen2.5-coder', name: 'Qwen2.5 Coder (7B)', description: 'Code-specialized model for the chat/coding studio.',       category: 'chat', engine: 'ollama', provider: 'ollama', sizeBytes: 4_700_000_000, fit: { minVramGb: 5, recVramGb: 8 },  pull: 'qwen2.5-coder' },
  // ---- Additional chat/code models (verified real + sized against a 12 GB / 32 GB box) ----
  // The mid-size ones (mistral-small/codestral/devstral) exceed 12 GB VRAM and run via Ollama's
  // automatic CPU/RAM offload — the ✗ fit badge flags that; they still run (slower) within 32 GB RAM.
  { id: 'ollama:gemma3',         name: 'Gemma 3 (4B)',        description: "Google's multimodal Gemma 3 4B chat model, 128K context.",  category: 'chat', engine: 'ollama', provider: 'ollama', sizeBytes: 3_300_000_000,  fit: { minVramGb: 3,  recVramGb: 5 },  pull: 'gemma3' },
  { id: 'ollama:gemma4',         name: 'Gemma 4 (E4B)',       description: "Google's Gemma 4 multimodal chat model (E4B variant).",     category: 'chat', engine: 'ollama', provider: 'ollama', sizeBytes: 9_600_000_000,  fit: { minVramGb: 10, recVramGb: 12 }, pull: 'gemma4' },
  { id: 'ollama:mistral-small',  name: 'Mistral Small (24B)', description: 'Mistral Small 3 24B instruct; runs via CPU/RAM offload on 12 GB.', category: 'chat', engine: 'ollama', provider: 'ollama', sizeBytes: 14_000_000_000, fit: { minVramGb: 14, recVramGb: 16 }, pull: 'mistral-small' },
  { id: 'ollama:deepseek-coder', name: 'DeepSeek Coder (1.3B)', description: 'Compact, fast code-generation model.',                  category: 'code', engine: 'ollama', provider: 'ollama', sizeBytes: 780_000_000,    fit: { minVramGb: 1,  recVramGb: 3 },  pull: 'deepseek-coder' },
  { id: 'ollama:starcoder2',     name: 'StarCoder2 (3B)',     description: 'BigCode StarCoder2 3B for code, 16K context.',             category: 'code', engine: 'ollama', provider: 'ollama', sizeBytes: 1_700_000_000,  fit: { minVramGb: 2,  recVramGb: 4 },  pull: 'starcoder2' },
  { id: 'ollama:codestral',      name: 'Codestral (22B)',     description: 'Mistral Codestral 22B; runs via CPU/RAM offload on 12 GB.', category: 'code', engine: 'ollama', provider: 'ollama', sizeBytes: 13_000_000_000, fit: { minVramGb: 13, recVramGb: 15 }, pull: 'codestral' },
  { id: 'ollama:devstral',       name: 'Devstral (24B)',      description: 'Mistral Devstral 24B agentic coding model; CPU/RAM offload on 12 GB.', category: 'code', engine: 'ollama', provider: 'ollama', sizeBytes: 14_000_000_000, fit: { minVramGb: 14, recVramGb: 16 }, pull: 'devstral' },
];

function getRecipe(id) { return RECIPES.find((r) => r.id === id) || null; }

module.exports = { RECIPES, getRecipe };
