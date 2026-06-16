// lib/local-runtime/providers/index.js
const { getCatalogEntry } = require('../catalog.js');
const sdcpp = require('./sdcpp.js');

const PROVIDERS = { sdcpp }; // wan2gp, ollama, comfyui, api/* added in later milestones

function resolveProvider(modelId) {
  const entry = getCatalogEntry(modelId);
  if (!entry) throw new Error(`Unknown model: ${modelId}`);
  const provider = PROVIDERS[entry.provider];
  if (!provider) throw new Error(`No provider registered for: ${entry.provider}`);
  // provider.generate expects ({ model, params }, onProgress, opts) -> { buffer, ext, seed }.
  // opts (e.g. { signal }) is forwarded so the route can cancel on client disconnect.
  return {
    entry,
    generate: (params, onProgress, opts) => provider.generate({ model: entry.raw, params }, onProgress, opts),
  };
}

module.exports = { resolveProvider };
