// lib/local-runtime/catalog.js
const { LOCAL_MODEL_CATALOG } = require('../../electron/lib/modelCatalog.js');

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

function listCatalog() {
  return LOCAL_MODEL_CATALOG.map(normalizeSdcpp);
}

function getCatalogEntry(id) {
  return listCatalog().find(m => m.id === id) || null;
}

module.exports = { listCatalog, getCatalogEntry };
