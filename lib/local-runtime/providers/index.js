// lib/local-runtime/providers/index.js
const { getCatalogEntry } = require('../catalog.js');
const config = require('../config.js');
const sdcpp = require('./sdcpp.js');
const api = require('./api.js');

function resolveProvider(modelId) {
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
