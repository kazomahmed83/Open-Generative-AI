// lib/local-runtime/catalog/recipes.js
// Curated, hand-picked models that are known to fit a 12 GB / 32 GB machine. Each is a "recipe":
// an engine + how to install it (files->folders, or an ollama pull) + how to run it (workflow).
const HF = 'https://huggingface.co';

const RECIPES = [
  // ---- Image / ComfyUI ----
  {
    id: 'comfyui:flux2-klein', name: 'FLUX.2 Klein (9B)',
    description: 'Distilled 9B FLUX.2 (Apache). Q4 GGUF fits 12 GB; Mistral encoder offloads to system RAM.',
    category: 'image', engine: 'comfyui', provider: 'comfyui',
    sizeBytes: 24_280_000_000, fit: { minVramGb: 8, recVramGb: 12 }, workflow: 'flux2',
    files: [
      { url: `${HF}/unsloth/FLUX.2-klein-base-9B-GGUF/resolve/main/flux-2-klein-base-9b-Q4_K_M.gguf`, dest: 'unet/flux-2-klein-base-9b-Q4_K_M.gguf' },
      { url: `${HF}/Comfy-Org/flux2-dev/resolve/main/split_files/text_encoders/mistral_3_small_flux2_fp8.safetensors`, dest: 'text_encoders/mistral_3_small_flux2_fp8.safetensors' },
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
];

function getRecipe(id) { return RECIPES.find((r) => r.id === id) || null; }

module.exports = { RECIPES, getRecipe };
