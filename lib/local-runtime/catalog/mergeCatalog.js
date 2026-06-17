// lib/local-runtime/catalog/mergeCatalog.js
// Merge curated recipes with the engine-detected model list. Detected entries (already installed)
// win on id; recipes not yet present are appended as installMode:'recipe' with a Download affordance.
function mergeCatalog(detected, recipes, stateFor) {
  const present = new Set(detected.map((m) => m.id));
  const out = [...detected];
  for (const r of recipes) {
    if (present.has(r.id)) continue;
    out.push({
      id: r.id, name: r.name, description: r.description,
      type: r.category, category: r.category, provider: r.provider, engine: r.engine,
      installMode: 'recipe', recipe: true,
      sizeGB: r.sizeBytes ? Math.round((r.sizeBytes / 1024 ** 3) * 10) / 10 : undefined,
      fit: r.fit || null, requiresNode: r.requiresNode || null,
      state: stateFor(r),
    });
  }
  return out;
}

module.exports = { mergeCatalog };
