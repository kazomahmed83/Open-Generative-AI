// lib/local-runtime/providers/api.js
// Generic OpenAI-compatible + bespoke API provider, driven by declarative recipes.
const eng = require('./recipe-engine.js');
const { DEFAULT_IMAGE_RECIPE, DEFAULT_CHAT_RECIPE } = require('./presets.js');

function resolveRecipe(provider, kind) {
  const explicit = kind === 'image' ? provider.imageRecipe : provider.chatRecipe;
  if (explicit) return typeof explicit === 'string' ? JSON.parse(explicit) : explicit;
  return kind === 'image' ? DEFAULT_IMAGE_RECIPE : DEFAULT_CHAT_RECIPE;
}

// Backward-compatible thin wrappers (used by tests and any legacy callers).
function buildImageRequest(provider, apiModelId, params) {
  const r = eng.buildRequest(DEFAULT_IMAGE_RECIPE, provider, apiModelId, params);
  return { url: r.url, headers: r.headers, body: r.body };
}
function buildChatRequest(provider, apiModelId, params) {
  const r = eng.buildRequest(DEFAULT_CHAT_RECIPE, provider, apiModelId, params);
  return { url: r.url, headers: r.headers, body: r.body };
}

// Called by the registry: api.generate({ provider, apiModelId, kind }, params, onProgress, { signal })
async function generate({ provider, apiModelId, kind }, params, onProgress = () => {}, opts = {}) {
  onProgress({ step: 1, totalSteps: 1, progress: 1, status: 'requesting' });
  const recipe = resolveRecipe(provider, kind);
  return eng.runRecipe(recipe, provider, apiModelId, params, opts);
}

module.exports = { resolveRecipe, buildImageRequest, buildChatRequest, generate, arToSize: eng.arToSize };
