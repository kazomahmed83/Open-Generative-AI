// lib/local-runtime/providers/index.js
const { getCatalogEntry } = require('../catalog.js');
const config = require('../config.js');
const sdcpp = require('./sdcpp.js');
const comfyui = require('./comfyui.js');
const api = require('./api.js');

function resolveProvider(modelId) {
  // ComfyUI checkpoints are addressed as "comfyui:<checkpoint>.safetensors" — the id carries
  // everything needed, so we route straight to the ComfyUI provider without a catalog lookup.
  if (typeof modelId === 'string' && modelId.startsWith('comfyui:')) {
    const { getRecipe } = require('../catalog/recipes.js');
    const recipe = getRecipe(modelId); // multi-file recipes (e.g. FLUX.2) carry a `workflow`
    const ckptName = modelId.slice('comfyui:'.length);
    return {
      entry: { id: modelId, provider: 'comfyui', kind: 'image', ckptName },
      generate: (params, onProgress, opts) =>
        comfyui.generate({ model: { ckptName, recipe, sampler: params.sampler, scheduler: params.scheduler }, params }, onProgress, opts),
    };
  }

  const entry = getCatalogEntry(modelId);
  if (!entry) throw new Error(`Unknown model: ${modelId}`);

  if (entry.source === 'api') {
    const provider = config.getProvider(entry.provider);
    if (!provider) throw new Error(`API provider not configured: ${entry.provider}`);
    return {
      entry,
      generate: (params, onProgress, opts) =>
        api.generate({ provider, apiModelId: entry.apiModelId, kind: entry.kind }, params, onProgress, opts),
    };
  }

  if (entry.provider === 'sdcpp') {
    return {
      entry,
      generate: (params, onProgress, opts) => sdcpp.generate({ model: entry.raw, params }, onProgress, opts),
    };
  }

  throw new Error(`No provider registered for: ${entry.provider}`);
}

module.exports = { resolveProvider };
