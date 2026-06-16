// lib/local-runtime/catalog.js
const { LOCAL_MODEL_CATALOG } = require('../../electron/lib/modelCatalog.js');
const config = require('./config.js');

// Normalize the electron sd.cpp catalog into unified provider-registry entries.
function normalizeSdcpp(m) {
  return {
    id: m.id,
    name: m.name,
    source: 'local',
    provider: 'sdcpp',
    kind: 'image',
    aspectRatios: m.aspectRatios || ['1:1', '16:9', '9:16', '4:3', '3:4'],
    defaultSteps: m.defaultSteps ?? 20,
    defaultGuidance: m.defaultGuidance ?? 7.5,
    requiresAuxiliary: !!m.requiresAuxiliary,
    raw: m, // full electron entry (filename, type, sampler, scheduler) for the provider
  };
}

// Secret-free: references provider by id + upstream model id only (no baseUrl/apiKey).
function normalizeApiModel(provider, model) {
  return {
    id: `api:${provider.id}:${model.id}`,
    name: model.name,
    source: 'api',
    provider: provider.id,
    kind: provider.kind,
    ready: true,
    apiModelId: model.id,
  };
}

function listCatalog() {
  const local = LOCAL_MODEL_CATALOG.map(normalizeSdcpp);
  const api = config
    .listProviders()
    .flatMap((p) => (p.models || []).map((m) => normalizeApiModel(p, m)));
  return [...local, ...api];
}

function getCatalogEntry(id) {
  return listCatalog().find((m) => m.id === id) || null;
}

module.exports = { listCatalog, getCatalogEntry };
