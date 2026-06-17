import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { execFile } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { LOCAL_MODEL_CATALOG, ZIMAGE_AUXILIARY } = require('../electron/lib/modelCatalog.js');
const { pickBinaryAssetForPlatform } = require('../electron/lib/localInferenceAssets.js');
const { RECIPES, getRecipe } = require('./local-runtime/catalog/recipes.js');
const { mergeCatalog } = require('./local-runtime/catalog/mergeCatalog.js');
const { recipeState } = require('./local-runtime/catalog/recipeState.js');
const { resolveEngineRoot, resolveDest } = require('./local-runtime/catalog/engineRoots.js');
const { isHostAllowed } = require('./local-runtime/catalog/allowlist.js');
const { parseOllamaPullProgress, aggregateProgress } = require('./local-runtime/catalog/ollamaProgress.js');

const DATA_DIR = path.resolve(process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR || path.join(process.cwd(), '.local-ai'));
const BIN_DIR = path.join(DATA_DIR, 'bin');
const MODELS_DIR = path.join(DATA_DIR, 'models');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
const BINARY_NAME = process.platform === 'win32' ? 'sd-cli.exe' : 'sd-cli';
const BINARY_PATH = path.join(BIN_DIR, BINARY_NAME);
const PROBE_TIMEOUT_MS = 1600;

const CUSTOM_BINARIES = {
  'darwin-arm64': 'https://github.com/Anil-matcha/Open-Generative-AI/releases/download/v1.0.3-binaries/sd-cli-metal-macos-arm64.zip',
};

const WAN2GP_CATALOG = [
  {
    id: 'wan2gp:flux-dev',
    name: 'Flux.1 Dev (Wan2GP)',
    description: 'Image model served by a user-run Wan2GP Gradio server.',
    type: 'image',
    family: 'flux',
    provider: 'wan2gp',
    tags: ['image', 'flux', 'external-local'],
  },
  {
    id: 'wan2gp:qwen-image',
    name: 'Qwen Image (Wan2GP)',
    description: 'Qwen-Image text-to-image served by a user-run Wan2GP Gradio server.',
    type: 'image',
    family: 'qwen',
    provider: 'wan2gp',
    tags: ['image', 'qwen', 'external-local'],
  },
  {
    id: 'wan2gp:wan22-t2v',
    name: 'Wan 2.2 (Text-to-Video)',
    description: 'Wan 2.2 text-to-video served by Wan2GP. Requires a CUDA/ROCm server.',
    type: 'video',
    family: 'wan',
    provider: 'wan2gp',
    tags: ['video', 'wan', 'text-to-video', 'external-local'],
  },
  {
    id: 'wan2gp:wan22-i2v',
    name: 'Wan 2.2 (Image-to-Video)',
    description: 'Wan 2.2 image-to-video served by Wan2GP. Requires a CUDA/ROCm server.',
    type: 'video',
    family: 'wan',
    provider: 'wan2gp',
    needsImage: true,
    tags: ['video', 'wan', 'image-to-video', 'external-local'],
  },
  {
    id: 'wan2gp:hunyuan-video',
    name: 'Hunyuan Video (Wan2GP)',
    description: 'Hunyuan text-to-video served by a user-run Wan2GP Gradio server.',
    type: 'video',
    family: 'hunyuan',
    provider: 'wan2gp',
    tags: ['video', 'hunyuan', 'external-local'],
  },
  {
    id: 'wan2gp:ltx-video',
    name: 'LTX Video (Wan2GP)',
    description: 'LTX text-to-video served by Wan2GP. Usually the fastest Wan2GP video option.',
    type: 'video',
    family: 'ltx',
    provider: 'wan2gp',
    tags: ['video', 'ltx', 'fast', 'external-local'],
  },
];

const EXTERNAL_ENGINE_CATALOG = [
  {
    id: 'comfyui:flux2-dev',
    name: 'FLUX.2 [dev]',
    description: 'Open-weight FLUX.2 image generation and editing through a local ComfyUI workflow.',
    type: 'image',
    category: 'image',
    family: 'flux',
    provider: 'comfyui',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:8188',
    tags: ['image', 'editing', 'flux.2', 'comfyui', 'external-local'],
  },
  {
    id: 'comfyui:ltx-2.3',
    name: 'LTX-2.3',
    description: 'Open-weight synchronized video and audio generation through a local ComfyUI workflow.',
    type: 'video',
    category: 'video',
    family: 'ltx',
    provider: 'comfyui',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:8188',
    tags: ['video', 'audio', 'ltx-2.3', 'comfyui', 'external-local'],
  },
  {
    id: 'comfyui:audio-workflows',
    name: 'ComfyUI Audio Workflows',
    description: 'Local audio generation, enhancement, and voice workflows served from ComfyUI custom nodes.',
    type: 'audio',
    category: 'audio',
    family: 'audio',
    provider: 'comfyui',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:8188',
    tags: ['audio', 'comfyui', 'external-local'],
  },
  {
    id: 'xinference:whisper-large-v3-turbo',
    name: 'Whisper Large v3 Turbo',
    description: 'Local speech-to-text transcription and translation model. Good default for audio/video captioning.',
    type: 'audio',
    category: 'audio',
    family: 'whisper',
    provider: 'xinference',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:9997',
    tags: ['audio', 'speech-to-text', 'whisper', 'external-local'],
  },
  {
    id: 'comfyui:kokoro-tts',
    name: 'Kokoro TTS',
    description: 'Small, fast local text-to-speech model with high quality voices through ComfyUI or local TTS servers.',
    type: 'audio',
    category: 'audio',
    family: 'kokoro',
    provider: 'comfyui',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:8188',
    tags: ['audio', 'tts', 'voice', 'external-local'],
  },
  {
    id: 'xinference:cosyvoice2',
    name: 'CosyVoice2',
    description: 'Local multilingual speech generation and voice-cloning model family.',
    type: 'audio',
    category: 'audio',
    family: 'cosyvoice',
    provider: 'xinference',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:9997',
    tags: ['audio', 'tts', 'voice-clone', 'external-local'],
  },
  {
    id: 'comfyui:f5-tts',
    name: 'F5-TTS',
    description: 'Local zero-shot and reference-voice text-to-speech workflows.',
    type: 'audio',
    category: 'audio',
    family: 'f5-tts',
    provider: 'comfyui',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:8188',
    tags: ['audio', 'tts', 'voice-clone', 'external-local'],
  },
  {
    id: 'xinference:fish-speech',
    name: 'Fish Speech',
    description: 'Local expressive speech synthesis model family for longer voice generation.',
    type: 'audio',
    category: 'audio',
    family: 'fish-speech',
    provider: 'xinference',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:9997',
    tags: ['audio', 'tts', 'voice', 'external-local'],
  },
  {
    id: 'comfyui:musicgen',
    name: 'MusicGen / AudioCraft',
    description: 'Local music and sound generation workflows for prompts and melody-conditioned audio.',
    type: 'audio',
    category: 'audio',
    family: 'musicgen',
    provider: 'comfyui',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:8188',
    tags: ['audio', 'music', 'sound', 'external-local'],
  },
  {
    id: 'comfyui:stable-audio-open',
    name: 'Stable Audio Open',
    description: 'Local open audio generation workflows for music clips, effects, and sound design.',
    type: 'audio',
    category: 'audio',
    family: 'stable-audio',
    provider: 'comfyui',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:8188',
    tags: ['audio', 'music', 'sound-design', 'external-local'],
  },
  {
    id: 'ollama:chat-models',
    name: 'Ollama Chat Models',
    description: 'Local assistants such as Llama, Qwen, Mistral, Gemma, and DeepSeek served by Ollama.',
    type: 'chat',
    category: 'chat',
    family: 'llm',
    provider: 'ollama',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:11434',
    tags: ['chat', 'ollama', 'external-local'],
  },
  {
    id: 'ollama:deepseek-r1',
    name: 'DeepSeek-R1',
    description: 'Local reasoning/chat model family available through Ollama.',
    type: 'chat',
    category: 'chat',
    family: 'deepseek',
    provider: 'ollama',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:11434',
    suggestedCommand: 'ollama run deepseek-r1',
    tags: ['chat', 'reasoning', 'ollama', 'external-local'],
  },
  {
    id: 'ollama:qwen3',
    name: 'Qwen3',
    description: 'Strong local general assistant model family with reasoning and multilingual capability.',
    type: 'chat',
    category: 'chat',
    family: 'qwen',
    provider: 'ollama',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:11434',
    suggestedCommand: 'ollama run qwen3',
    tags: ['chat', 'reasoning', 'ollama', 'external-local'],
  },
  {
    id: 'ollama:llama3.3',
    name: 'Llama 3.3',
    description: 'General-purpose local chat model family for writing, summarization, and assistants.',
    type: 'chat',
    category: 'chat',
    family: 'llama',
    provider: 'ollama',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:11434',
    suggestedCommand: 'ollama run llama3.3',
    tags: ['chat', 'assistant', 'ollama', 'external-local'],
  },
  {
    id: 'ollama:gemma3',
    name: 'Gemma 3',
    description: 'Compact local assistant model family suited for multilingual and everyday assistant tasks.',
    type: 'chat',
    category: 'chat',
    family: 'gemma',
    provider: 'ollama',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:11434',
    suggestedCommand: 'ollama run gemma3',
    tags: ['chat', 'assistant', 'ollama', 'external-local'],
  },
  {
    id: 'ollama:gemma4',
    name: 'Gemma 4',
    description: 'Google open model family for advanced reasoning, multimodal input, long context, and local-first assistant workflows.',
    type: 'chat',
    category: 'chat',
    family: 'gemma',
    provider: 'ollama',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:11434',
    suggestedCommand: 'ollama run gemma4',
    tags: ['chat', 'reasoning', 'multimodal', 'ollama', 'external-local'],
  },
  {
    id: 'ollama:phi4',
    name: 'Phi-4',
    description: 'Smaller local reasoning/chat model family for machines with less VRAM.',
    type: 'chat',
    category: 'chat',
    family: 'phi',
    provider: 'ollama',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:11434',
    suggestedCommand: 'ollama run phi4',
    tags: ['chat', 'small', 'ollama', 'external-local'],
  },
  {
    id: 'ollama:mistral-small',
    name: 'Mistral Small',
    description: 'Local Mistral assistant family for fast chat, writing, and structured outputs.',
    type: 'chat',
    category: 'chat',
    family: 'mistral',
    provider: 'ollama',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:11434',
    suggestedCommand: 'ollama run mistral-small',
    tags: ['chat', 'assistant', 'ollama', 'external-local'],
  },
  {
    id: 'openrouter:nex-n2-pro',
    name: 'Nex-N2-Pro',
    description: 'Open-weight Nex AGI agentic reasoning model for long-horizon tasks, research, tool use, and coding. Very large: realistic local use requires serious multi-GPU/server hardware or a hosted/local-compatible provider.',
    type: 'chat',
    category: 'chat',
    family: 'nex-n2',
    provider: 'openrouter',
    installMode: 'external-server',
    endpoint: 'OpenAI-compatible endpoint',
    tags: ['chat', 'reasoning', 'agentic', 'vision-input', 'external-local'],
  },
  {
    id: 'vllm:kimi-k2.6',
    name: 'Kimi K2.6',
    description: 'Moonshot open-weight multimodal agentic model for long-horizon coding, product creation, tool use, and agent swarm workflows.',
    type: 'chat',
    category: 'chat',
    family: 'kimi',
    provider: 'vllm',
    installMode: 'external-server',
    endpoint: 'OpenAI-compatible local server',
    tags: ['chat', 'code', 'agentic', 'multimodal', 'external-local'],
  },
  {
    id: 'vllm:glm-5.1',
    name: 'GLM-5.1',
    description: 'Z.ai open-weight agentic engineering model for reasoning, coding, repository tasks, and long-horizon workflows.',
    type: 'chat',
    category: 'chat',
    family: 'glm',
    provider: 'vllm',
    installMode: 'external-server',
    endpoint: 'OpenAI-compatible local server',
    tags: ['chat', 'code', 'reasoning', 'agentic', 'external-local'],
  },
  {
    id: 'ollama:qwen3.6',
    name: 'Qwen3.6',
    description: 'Local Qwen3.6 model family for agentic coding, vision, tool use, and thinking preservation.',
    type: 'chat',
    category: 'chat',
    family: 'qwen',
    provider: 'ollama',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:11434',
    suggestedCommand: 'ollama run qwen3.6',
    tags: ['chat', 'code', 'vision', 'tools', 'ollama', 'external-local'],
  },
  {
    id: 'qwen:qwen3.6-plus',
    name: 'Qwen3.6-Plus',
    description: 'Hosted Qwen3.6-Plus model from Alibaba Cloud Model Studio with very long context. Listed as API/endpoint only because Plus is not a normal open-weight local model.',
    type: 'chat',
    category: 'chat',
    family: 'qwen',
    provider: 'qwen',
    installMode: 'external-server',
    endpoint: 'Alibaba Cloud Model Studio / OpenAI-compatible endpoint',
    tags: ['chat', 'agentic', 'hosted', 'not-local-download'],
  },
  {
    id: 'ollama:code-models',
    name: 'Ollama Code Models',
    description: 'Local coding models such as Qwen Coder, DeepSeek Coder, Codestral, StarCoder, and Devstral.',
    type: 'code',
    category: 'code',
    family: 'coder',
    provider: 'ollama',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:11434',
    tags: ['code', 'ollama', 'external-local'],
  },
  {
    id: 'ollama:qwen3-coder-next',
    name: 'Qwen3-Coder-Next',
    description: 'Coding-focused local LLM optimized for agentic coding workflows and local development.',
    type: 'code',
    category: 'code',
    family: 'qwen',
    provider: 'ollama',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:11434',
    suggestedCommand: 'ollama run qwen3-coder-next',
    tags: ['code', 'agentic', 'ollama', 'external-local'],
  },
  {
    id: 'ollama:gemma4-code',
    name: 'Gemma 4',
    description: 'Gemma 4 local model family for IDE assistants, coding assistants, advanced reasoning, and agentic workflows.',
    type: 'code',
    category: 'code',
    family: 'gemma',
    provider: 'ollama',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:11434',
    suggestedCommand: 'ollama run gemma4',
    tags: ['code', 'reasoning', 'ollama', 'external-local'],
  },
  {
    id: 'ollama:qwen3-coder',
    name: 'Qwen3-Coder',
    description: 'Long-context local coding model family for code generation, refactors, and repository tasks.',
    type: 'code',
    category: 'code',
    family: 'qwen',
    provider: 'ollama',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:11434',
    suggestedCommand: 'ollama run qwen3-coder',
    tags: ['code', 'long-context', 'ollama', 'external-local'],
  },
  {
    id: 'ollama:qwen2.5-coder',
    name: 'Qwen2.5-Coder',
    description: 'Popular local coding model family for code completion, repair, and explanation.',
    type: 'code',
    category: 'code',
    family: 'qwen',
    provider: 'ollama',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:11434',
    suggestedCommand: 'ollama run qwen2.5-coder',
    tags: ['code', 'ollama', 'external-local'],
  },
  {
    id: 'ollama:deepseek-coder',
    name: 'DeepSeek Coder',
    description: 'Local coding model family trained heavily on code and natural language.',
    type: 'code',
    category: 'code',
    family: 'deepseek',
    provider: 'ollama',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:11434',
    suggestedCommand: 'ollama run deepseek-coder',
    tags: ['code', 'ollama', 'external-local'],
  },
  {
    id: 'ollama:codestral',
    name: 'Codestral',
    description: 'Mistral coding model family for code generation and fill-in-the-middle style workflows.',
    type: 'code',
    category: 'code',
    family: 'mistral',
    provider: 'ollama',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:11434',
    suggestedCommand: 'ollama run codestral',
    tags: ['code', 'mistral', 'ollama', 'external-local'],
  },
  {
    id: 'ollama:starcoder2',
    name: 'StarCoder2',
    description: 'Open local code model family for broad programming-language coverage.',
    type: 'code',
    category: 'code',
    family: 'starcoder',
    provider: 'ollama',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:11434',
    suggestedCommand: 'ollama run starcoder2',
    tags: ['code', 'ollama', 'external-local'],
  },
  {
    id: 'ollama:devstral',
    name: 'Devstral',
    description: 'Local coding assistant model family aimed at software engineering tasks.',
    type: 'code',
    category: 'code',
    family: 'mistral',
    provider: 'ollama',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:11434',
    suggestedCommand: 'ollama run devstral',
    tags: ['code', 'agentic', 'ollama', 'external-local'],
  },
  {
    id: 'openrouter:nex-n2-pro-code',
    name: 'Nex-N2-Pro',
    description: 'Agentic coding and software-engineering model from Nex AGI, strong for coding benchmarks and multi-step tool workflows. Best exposed through vLLM/SGLang/OpenAI-compatible servers when self-hosted.',
    type: 'code',
    category: 'code',
    family: 'nex-n2',
    provider: 'openrouter',
    installMode: 'external-server',
    endpoint: 'OpenAI-compatible endpoint',
    tags: ['code', 'reasoning', 'agentic', 'software-engineering', 'external-local'],
  },
  {
    id: 'vllm:kimi-k2.6-code',
    name: 'Kimi K2.6',
    description: 'Open-weight Moonshot model for long autonomous coding runs, multi-file work, coding-driven design, and agent swarms.',
    type: 'code',
    category: 'code',
    family: 'kimi',
    provider: 'vllm',
    installMode: 'external-server',
    endpoint: 'OpenAI-compatible local server',
    tags: ['code', 'agentic', 'multimodal', 'external-local'],
  },
  {
    id: 'vllm:glm-5.1-code',
    name: 'GLM-5.1',
    description: 'Open-weight Z.ai model tuned for agentic engineering, repo generation, terminal tasks, and software engineering benchmarks.',
    type: 'code',
    category: 'code',
    family: 'glm',
    provider: 'vllm',
    installMode: 'external-server',
    endpoint: 'OpenAI-compatible local server',
    tags: ['code', 'reasoning', 'agentic', 'external-local'],
  },
  {
    id: 'ollama:qwen3.6-code',
    name: 'Qwen3.6',
    description: 'Local Qwen3.6 family for agentic coding and thinking-preserving tool workflows.',
    type: 'code',
    category: 'code',
    family: 'qwen',
    provider: 'ollama',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:11434',
    suggestedCommand: 'ollama run qwen3.6',
    tags: ['code', 'tools', 'vision', 'ollama', 'external-local'],
  },
  {
    id: 'qwen:qwen3.6-plus-code',
    name: 'Qwen3.6-Plus',
    description: 'Hosted Qwen3.6-Plus endpoint for agentic workflows. Not listed as a local download because Plus is not currently the open-weight local variant.',
    type: 'code',
    category: 'code',
    family: 'qwen',
    provider: 'qwen',
    installMode: 'external-server',
    endpoint: 'Alibaba Cloud Model Studio / OpenAI-compatible endpoint',
    tags: ['code', 'agentic', 'hosted', 'not-local-download'],
  },
  {
    id: 'lmstudio:openai-server',
    name: 'LM Studio Local Server',
    description: 'OpenAI-compatible local server for GGUF chat and coding models downloaded in LM Studio.',
    type: 'chat',
    category: 'chat',
    family: 'llm',
    provider: 'lmstudio',
    installMode: 'external-server',
    endpoint: 'http://127.0.0.1:1234',
    tags: ['chat', 'code', 'lm-studio', 'external-local'],
  },
];

function classifyOllamaModel(name) {
  const value = String(name || '').toLowerCase();
  if (/(code|coder|codestral|deepseek-coder|starcoder|qwen.*coder|devstral)/.test(value)) return 'code';
  return 'chat';
}

function withCategory(model) {
  const known = new Set(['image', 'video', 'audio', 'code', 'chat']);
  return {
    ...model,
    category: model.category || (known.has(model.type) ? model.type : 'image'),
  };
}

async function probeJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function probeText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getLocalEngines() {
  const [ollama, lmStudio, comfyui, wan2gp, xinference] = await Promise.all([
    probeJson('http://127.0.0.1:11434/api/tags'),
    probeJson('http://127.0.0.1:1234/v1/models'),
    probeJson('http://127.0.0.1:8188/system_stats'),
    probeText(process.env.WAN2GP_URL || 'http://127.0.0.1:7860'),
    probeJson('http://127.0.0.1:9997/v1/models'),
  ]);

  return [
    {
      id: 'sdcpp',
      name: 'sd.cpp',
      category: 'image',
      endpoint: 'project-local',
      ready: fs.existsSync(BINARY_PATH),
      role: 'Direct image checkpoint runner',
    },
    {
      id: 'comfyui',
      name: 'ComfyUI',
      category: 'image/video/audio',
      endpoint: 'http://127.0.0.1:8188',
      ready: !!comfyui,
      role: 'Advanced local workflows for FLUX.2, LTX-2.3, audio, and custom pipelines',
    },
    {
      id: 'ollama',
      name: 'Ollama',
      category: 'chat/code',
      endpoint: 'http://127.0.0.1:11434',
      ready: !!ollama,
      role: 'Local chat and coding LLMs',
      modelCount: Array.isArray(ollama?.models) ? ollama.models.length : 0,
    },
    {
      id: 'lmstudio',
      name: 'LM Studio',
      category: 'chat/code',
      endpoint: 'http://127.0.0.1:1234',
      ready: !!lmStudio,
      role: 'OpenAI-compatible local chat server',
      modelCount: Array.isArray(lmStudio?.data) ? lmStudio.data.length : 0,
    },
    {
      id: 'wan2gp',
      name: 'Wan2GP',
      category: 'video/image',
      endpoint: process.env.WAN2GP_URL || 'http://127.0.0.1:7860',
      ready: !!wan2gp,
      role: 'Large local video/image generation server',
    },
    {
      id: 'xinference',
      name: 'Xinference',
      category: 'audio/chat/embedding',
      endpoint: 'http://127.0.0.1:9997',
      ready: !!xinference,
      role: 'Local model server with strong audio, speech, LLM, and embedding support',
      modelCount: Array.isArray(xinference?.data) ? xinference.data.length : 0,
    },
  ];
}

async function listOllamaModels() {
  const data = await probeJson('http://127.0.0.1:11434/api/tags');
  return (data?.models || []).map((model) => {
    const category = classifyOllamaModel(model.name);
    return {
      id: `ollama:${model.name}`,
      name: model.name,
      description: `Installed Ollama ${category === 'code' ? 'coding' : 'chat'} model.`,
      type: category,
      category,
      family: String(model.name || '').split(':')[0],
      provider: 'ollama',
      installMode: 'external-server',
      state: 'available',
      sizeGB: model.size ? Math.round((model.size / 1024 ** 3) * 10) / 10 : undefined,
      tags: [category, 'ollama', 'installed-local'],
    };
  });
}

async function listLmStudioModels() {
  const data = await probeJson('http://127.0.0.1:1234/v1/models');
  return (data?.data || []).map((model) => {
    const category = classifyOllamaModel(model.id);
    return {
      id: `lmstudio:${model.id}`,
      name: model.id,
      description: `Loaded through LM Studio's local OpenAI-compatible server.`,
      type: category,
      category,
      family: String(model.id || '').split(/[:/]/)[0],
      provider: 'lmstudio',
      installMode: 'external-server',
      state: 'available',
      tags: [category, 'lm-studio', 'installed-local'],
    };
  });
}

function ensureDirs() {
  for (const dir of [BIN_DIR, MODELS_DIR, TMP_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'open-generative-ai-localhost' } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
          return;
        }
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', reject);
  });
}

function downloadFile(url, destPath) {
  ensureDirs();
  const tmpPath = `${destPath}.part`;

  const attempt = (requestUrl, redirectsLeft, retriesLeft) => new Promise((resolve, reject) => {
    const parsed = new URL(requestUrl);
    const mod = parsed.protocol === 'https:' ? https : http;
    const existingSize = fs.existsSync(tmpPath) ? fs.statSync(tmpPath).size : 0;
    const headers = {
      'User-Agent': 'open-generative-ai-localhost',
      Accept: '*/*',
    };
    if (existingSize > 0) headers.Range = `bytes=${existingSize}-`;

    const req = mod.get(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        headers,
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume();
          if (redirectsLeft <= 0) {
            reject(new Error('Too many redirects'));
            return;
          }
          const nextUrl = new URL(res.headers.location, requestUrl).toString();
          resolve(attempt(nextUrl, redirectsLeft - 1, retriesLeft));
          return;
        }

        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} from ${parsed.hostname}${parsed.pathname}`));
          return;
        }

        if (res.statusCode === 200 && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);

        const out = fs.createWriteStream(tmpPath, { flags: res.statusCode === 206 ? 'a' : 'w' });
        res.pipe(out);
        out.on('finish', () => {
          fs.renameSync(tmpPath, destPath);
          resolve();
        });
        out.on('error', reject);
        res.on('error', reject);
      },
    );

    req.on('error', (error) => {
      if (retriesLeft > 0) {
        setTimeout(() => resolve(attempt(requestUrl, redirectsLeft, retriesLeft - 1)), 3000);
      } else {
        reject(error);
      }
    });
    req.setTimeout(60000, () => req.destroy(new Error('Request timed out')));
  });

  return attempt(url, 10, 5);
}

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    if (process.platform === 'win32') {
      execFile(
        'powershell',
        ['-NoProfile', '-Command', 'Expand-Archive', '-Force', '-LiteralPath', zipPath, '-DestinationPath', destDir],
        (error) => (error ? reject(error) : resolve()),
      );
      return;
    }
    execFile('unzip', ['-o', zipPath, '-d', destDir], (error) => (error ? reject(error) : resolve()));
  });
}

function findFile(dir, filename) {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, filename);
      if (found) return found;
    } else if (entry.name === filename) {
      return full;
    }
  }
  return null;
}

function ensureBinaryPermissions() {
  if (process.platform === 'win32') return;
  for (const filename of [BINARY_NAME, 'sd-server']) {
    const filePath = path.join(BIN_DIR, filename);
    if (fs.existsSync(filePath)) fs.chmodSync(filePath, 0o755);
  }
}

export function getLocalAiStatus() {
  ensureDirs();
  return {
    engineInstalled: fs.existsSync(BINARY_PATH),
    binaryPath: BINARY_PATH,
    dataDir: DATA_DIR,
    modelsDir: MODELS_DIR,
    platform: process.platform,
    arch: process.arch,
  };
}

// Dynamically list the checkpoints a running ComfyUI exposes, as native image models. They
// generate through the ComfyUI provider (provider/index.js) right inside the Image Studio.
async function listComfyCheckpoints() {
  const info = await probeJson('http://127.0.0.1:8188/object_info/CheckpointLoaderSimple');
  const names = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
  if (!Array.isArray(names)) return [];
  return names.map((ckpt) => {
    const lower = String(ckpt).toLowerCase();
    const type = /flux/.test(lower) ? 'flux' : (/xl/.test(lower) ? 'sdxl' : 'sd1');
    return {
      id: `comfyui:${ckpt}`,
      name: `${String(ckpt).replace(/\.(safetensors|ckpt|gguf)$/i, '')} (ComfyUI)`,
      description: 'Runs through your local ComfyUI engine on the GPU.',
      type,
      category: 'image',
      provider: 'comfyui',
      installMode: 'engine',
      state: 'downloaded',
      aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
      defaultWidth: type === 'sd1' ? 512 : 1024,
      defaultHeight: type === 'sd1' ? 512 : 1024,
    };
  });
}

function readConfigSafe() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'config.json'), 'utf8')); } catch { return {}; }
}

// True if a ComfyUI custom-node directory exists. The ComfyUI models root is .../ComfyUI/models,
// so custom_nodes is a sibling of that root.
function nodeInstalled(dirName) {
  const root = resolveEngineRoot('comfyui', { config: readConfigSafe() });
  return fs.existsSync(path.join(path.dirname(root), 'custom_nodes', dirName));
}

export async function listLocalModels() {
  ensureDirs();
  const auxStatus = {
    llm: fs.existsSync(path.join(MODELS_DIR, ZIMAGE_AUXILIARY.llm.filename)) ? 'downloaded' : 'not-downloaded',
    vae: fs.existsSync(path.join(MODELS_DIR, ZIMAGE_AUXILIARY.vae.filename)) ? 'downloaded' : 'not-downloaded',
  };
  const sdcpp = LOCAL_MODEL_CATALOG.map((model) => ({
    ...withCategory(model),
    provider: 'sdcpp',
    installMode: 'download',
    state: fs.existsSync(path.join(MODELS_DIR, model.filename)) ? 'downloaded' : 'not-downloaded',
    path: path.join(MODELS_DIR, model.filename),
    ...(model.requiresAuxiliary ? { auxiliaryStatus: auxStatus } : {}),
  }));

  const wan2gp = WAN2GP_CATALOG.map((model) => ({
    ...withCategory(model),
    installMode: 'external-server',
    state: 'external',
  }));

  const external = EXTERNAL_ENGINE_CATALOG.map((model) => ({
    ...withCategory(model),
    state: 'external',
  }));

  const [ollamaModels, lmStudioModels, comfyCheckpoints] = await Promise.all([
    listOllamaModels(),
    listLmStudioModels(),
    listComfyCheckpoints(),
  ]);

  const detected = [...sdcpp, ...comfyCheckpoints, ...external, ...wan2gp, ...ollamaModels, ...lmStudioModels];
  const ollamaNames = new Set(ollamaModels.map((m) => m.id.replace(/^ollama:/, '')));
  const config = readConfigSafe();
  const stateFor = (r) => recipeState(r, {
    fileExists: (p) => fs.existsSync(p),
    resolveDest: (d) => resolveDest(resolveEngineRoot(r.engine, { config }), d),
    ollamaModelNames: ollamaNames,
    nodeInstalled,
  });
  return mergeCatalog(detected, RECIPES, stateFor);
}

export async function downloadLocalEngine() {
  ensureDirs();
  if (fs.existsSync(BINARY_PATH)) return { ok: true, path: BINARY_PATH, source: 'existing' };

  const platformKey = `${process.platform}-${process.arch}`;
  const customUrl = CUSTOM_BINARIES[platformKey];
  let downloadUrl = customUrl;
  let zipName = customUrl ? path.basename(customUrl) : null;

  if (!downloadUrl) {
    const releases = await fetchJson('https://api.github.com/repos/leejet/stable-diffusion.cpp/releases?per_page=15');
    let lastSeen = [];
    for (const release of releases) {
      const zips = (release.assets || []).filter((asset) => asset.name.endsWith('.zip'));
      lastSeen = zips.map((asset) => asset.name);
      const pickedName = pickBinaryAssetForPlatform({
        platform: process.platform,
        arch: process.arch,
        zipNames: lastSeen,
      });
      if (pickedName) {
        const chosen = zips.find((asset) => asset.name === pickedName);
        downloadUrl = chosen.browser_download_url;
        zipName = chosen.name;
        break;
      }
    }
    if (!downloadUrl) {
      throw new Error(`No sd.cpp binary found for ${process.platform}-${process.arch}.`);
    }
  }

  const zipPath = path.join(BIN_DIR, zipName);
  await downloadFile(downloadUrl, zipPath);
  await extractZip(zipPath, BIN_DIR);
  fs.unlinkSync(zipPath);

  const foundBinary = findFile(BIN_DIR, BINARY_NAME);
  if (!foundBinary) throw new Error(`Extracted archive but could not find ${BINARY_NAME}.`);
  if (foundBinary !== BINARY_PATH) fs.renameSync(foundBinary, BINARY_PATH);
  ensureBinaryPermissions();

  return { ok: true, path: BINARY_PATH };
}

export async function downloadLocalModel(modelId) {
  ensureDirs();
  const model = LOCAL_MODEL_CATALOG.find((entry) => entry.id === modelId);
  if (!model) throw new Error(`Unknown local model: ${modelId}`);
  const destPath = path.join(MODELS_DIR, model.filename);
  if (!fs.existsSync(destPath)) await downloadFile(model.downloadUrl, destPath);
  return { ok: true, path: destPath };
}

export async function downloadLocalAuxiliary(auxKey) {
  ensureDirs();
  const aux = ZIMAGE_AUXILIARY[auxKey];
  if (!aux) throw new Error(`Unknown auxiliary file: ${auxKey}`);
  const destPath = path.join(MODELS_DIR, aux.filename);
  if (!fs.existsSync(destPath)) await downloadFile(aux.downloadUrl, destPath);
  return { ok: true, path: destPath };
}

export function deleteLocalModel(modelId) {
  ensureDirs();
  const model = LOCAL_MODEL_CATALOG.find((entry) => entry.id === modelId);
  if (!model) throw new Error(`Unknown local model: ${modelId}`);
  for (const filePath of [
    path.join(MODELS_DIR, model.filename),
    `${path.join(MODELS_DIR, model.filename)}.part`,
  ]) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  return { ok: true };
}
