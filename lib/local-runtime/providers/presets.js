// lib/local-runtime/providers/presets.js
// Built-in provider presets + the OpenAI-compatible default recipes. Data only.

const DEFAULT_IMAGE_RECIPE = {
  kind: 'image', path: '/v1/images/generations', method: 'POST', bodyType: 'json', authStyle: 'bearer',
  body: { model: '{{model}}', prompt: '{{prompt}}', size: '{{size}}', n: 1 },
  resultPath: 'data[0].b64_json', resultType: 'base64',
};
const DEFAULT_CHAT_RECIPE = {
  kind: 'chat', path: '/v1/chat/completions', method: 'POST', bodyType: 'json', authStyle: 'bearer',
  body: { model: '{{model}}', messages: '{{messages}}' },
  resultPath: 'choices[0].message.content', resultType: 'text',
};

const OPENAI_CHAT = JSON.stringify(DEFAULT_CHAT_RECIPE);
// OpenAI image endpoint accepts a `quality` enum (gpt-image-1: low/medium/high/auto;
// dall-e-3: standard/hd). Kept separate from the generic default so other providers
// never receive a `quality` field they may reject.
const OPENAI_IMAGE_RECIPE = JSON.stringify({
  kind: 'image', path: '/v1/images/generations', method: 'POST', bodyType: 'json', authStyle: 'bearer',
  body: { model: '{{model}}', prompt: '{{prompt}}', size: '{{size}}', quality: '{{quality}}', n: 1 },
  resultPath: 'data[0].b64_json', resultType: 'base64',
});

const PRESETS = [
  {
    id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com', authStyle: 'bearer',
    models: [
      { id: 'gpt-image-1', name: 'GPT Image 1', kind: 'image', sizeMap: { '1:1': '1024x1024', '16:9': '1536x1024', '9:16': '1024x1536', '4:3': '1536x1024', '3:4': '1024x1536' }, qualityOptions: ['auto', 'low', 'medium', 'high'], defaultQuality: 'medium' },
      { id: 'dall-e-3', name: 'DALL·E 3', kind: 'image', sizeMap: { '1:1': '1024x1024', '16:9': '1792x1024', '9:16': '1024x1792', '4:3': '1792x1024', '3:4': '1024x1792' }, qualityOptions: ['standard', 'hd'], bodyExtra: { response_format: 'b64_json' }, defaultQuality: 'standard' },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', kind: 'chat' },
    ],
    imageRecipe: OPENAI_IMAGE_RECIPE,
    chatRecipe: OPENAI_CHAT,
    modelsList: { path: '/v1/models', auth: true, itemsPath: 'data', idField: 'id' },
  },
  {
    id: 'together', name: 'Together AI', baseUrl: 'https://api.together.xyz', authStyle: 'bearer',
    models: [
      { id: 'black-forest-labs/FLUX.1-schnell-Free', name: 'FLUX.1 schnell (Free)', kind: 'image' },
      { id: 'black-forest-labs/FLUX.1-schnell', name: 'FLUX.1 schnell (Turbo)', kind: 'image' },
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B Turbo', kind: 'chat' },
    ],
    imageRecipe: JSON.stringify({ kind: 'image', path: '/v1/images/generations', bodyType: 'json', authStyle: 'bearer', body: { model: '{{model}}', prompt: '{{prompt}}', width: '{{width}}', height: '{{height}}', steps: 4, n: 1, response_format: 'base64' }, resultPath: 'data[0].b64_json', resultType: 'base64' }),
    chatRecipe: OPENAI_CHAT,
    modelsList: { path: '/v1/models', auth: true, itemsPath: 'data', idField: 'id' },
  },
  {
    id: 'siliconflow', name: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn', authStyle: 'bearer',
    models: [
      { id: 'black-forest-labs/FLUX.1-schnell', name: 'FLUX.1 schnell', kind: 'image' },
      { id: 'Kwai-Kolors/Kolors', name: 'Kolors', kind: 'image' },
      { id: 'nex-agi/Nex-N2-Pro', name: 'Nex-N2-Pro', kind: 'chat' },
      { id: 'Qwen/Qwen3-8B', name: 'Qwen3 8B', kind: 'chat' },
    ],
    imageRecipe: JSON.stringify({ kind: 'image', path: '/v1/images/generations', bodyType: 'json', authStyle: 'bearer', body: { model: '{{model}}', prompt: '{{prompt}}', image_size: '{{size}}', num_inference_steps: 20 }, resultPath: 'images[0].url', resultType: 'url' }),
    chatRecipe: OPENAI_CHAT,
    modelsList: { path: '/v1/models', auth: true, itemsPath: 'data', idField: 'id' },
  },
  {
    id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com', authStyle: 'bearer',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', kind: 'chat' },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', kind: 'chat' },
    ],
    chatRecipe: JSON.stringify(Object.assign({}, DEFAULT_CHAT_RECIPE, { path: '/openai/v1/chat/completions' })),
    modelsList: { path: '/openai/v1/models', auth: true, itemsPath: 'data', idField: 'id' },
  },
  {
    id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai', authStyle: 'bearer',
    models: [
      { id: 'nex-agi/nex-n2-pro:free', name: 'Nex-N2-Pro (free)', kind: 'chat' },
      { id: 'nex-agi/nex-n2-pro', name: 'Nex-N2-Pro', kind: 'chat' },
    ],
    chatRecipe: JSON.stringify({ kind: 'chat', path: '/api/v1/chat/completions', bodyType: 'json', authStyle: 'bearer', headers: { 'HTTP-Referer': 'https://open-generative-ai.local', 'X-Title': 'Open Generative AI' }, body: { model: '{{model}}', messages: '{{messages}}' }, resultPath: 'choices[0].message.content', resultType: 'text' }),
    modelsList: { path: '/api/v1/models', auth: false, itemsPath: 'data', idField: 'id', nameField: 'name', freePath: 'pricing.prompt', freeEquals: '0', kindFromPath: 'architecture.output_modalities', kindImageWhenContains: 'image' },
  },
  {
    id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', authStyle: 'bearer',
    models: [
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', kind: 'chat' },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', kind: 'chat' },
    ],
    chatRecipe: JSON.stringify(Object.assign({}, DEFAULT_CHAT_RECIPE, { path: '/chat/completions' })),
    modelsList: { path: '/models', auth: true, itemsPath: 'data', idField: 'id' },
  },
  {
    id: 'moonshot', name: 'Moonshot AI (Kimi)', baseUrl: 'https://api.moonshot.ai', authStyle: 'bearer',
    models: [
      { id: 'kimi-k2.6', name: 'Kimi k2.6', kind: 'chat' },
      { id: 'moonshot-v1-128k', name: 'Moonshot v1 128k', kind: 'chat' },
    ],
    chatRecipe: OPENAI_CHAT,
    modelsList: { path: '/v1/models', auth: true, itemsPath: 'data', idField: 'id' },
  },
  {
    id: 'stability', name: 'Stability AI', baseUrl: 'https://api.stability.ai', authStyle: 'bearer',
    models: [
      { id: 'core', name: 'Stable Image Core', kind: 'image' },
      { id: 'ultra', name: 'Stable Image Ultra', kind: 'image' },
    ],
    imageRecipe: JSON.stringify({ kind: 'image', path: '/v2beta/stable-image/generate/core', method: 'POST', bodyType: 'multipart', authStyle: 'bearer', headers: { Accept: 'application/json' }, body: { prompt: '{{prompt}}', aspect_ratio: '{{aspect_ratio}}', output_format: 'png' }, resultPath: 'image', resultType: 'base64' }),
  },
  {
    id: 'gemini', name: 'Google Gemini API', baseUrl: 'https://generativelanguage.googleapis.com', authStyle: 'header',
    models: [
      { id: 'gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image (Nano Banana)', kind: 'image' },
      { id: 'gemini-3.1-flash-image', name: 'Gemini 3.1 Flash Image', kind: 'image' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', kind: 'chat' },
    ],
    imageRecipe: JSON.stringify({ kind: 'image', path: '/v1beta/models/{model}:generateContent', method: 'POST', bodyType: 'json', authStyle: 'header', authHeader: 'x-goog-api-key', body: { contents: [{ parts: [{ text: '{{prompt}}' }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }, resultPath: 'candidates[0].content.parts[*].inlineData.data', selectWithField: 'inlineData', resultMimePath: 'candidates[0].content.parts[*].inlineData.mimeType', resultType: 'base64' }),
    chatRecipe: JSON.stringify({ kind: 'chat', path: '/v1beta/models/{model}:generateContent', method: 'POST', bodyType: 'json', authStyle: 'header', authHeader: 'x-goog-api-key', body: { contents: [{ parts: [{ text: '{{prompt}}' }] }] }, resultPath: 'candidates[0].content.parts[0].text', resultType: 'text' }),
  },
  {
    // Truly free, no API key, no signup. Serves FLUX/SD via a GET URL (prompt in the path).
    id: 'pollinations', name: 'Pollinations (free, no key)', baseUrl: 'https://image.pollinations.ai', authStyle: 'none',
    models: [
      { id: 'flux', name: 'FLUX (free)', kind: 'image', sizeMap: { '1:1': '1024x1024', '16:9': '1280x720', '9:16': '720x1280', '4:3': '1024x768', '3:4': '768x1024' } },
      { id: 'turbo', name: 'Turbo (free, fast)', kind: 'image', sizeMap: { '1:1': '1024x1024', '16:9': '1280x720', '9:16': '720x1280', '4:3': '1024x768', '3:4': '768x1024' } },
    ],
    imageRecipe: JSON.stringify({ kind: 'image', path: '/prompt/{{prompt}}?width={{width}}&height={{height}}&model={{model}}&nologo=true', method: 'GET', authStyle: 'none', resultType: 'binary' }),
  },
];

function getPreset(id) { return PRESETS.find((p) => p.id === id) || null; }

module.exports = { PRESETS, getPreset, DEFAULT_IMAGE_RECIPE, DEFAULT_CHAT_RECIPE };
