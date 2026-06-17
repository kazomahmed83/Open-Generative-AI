// lib/local-runtime/catalog/mergeCatalog.js
// Merge curated recipes with the engine-detected model list. Detected entries (already installed)
// win on id; recipes not yet present are appended as installMode:'recipe' with a Download affordance.
function mergeCatalog(detected, recipes, stateFor) {
  // A curated recipe is a *real* download, so it supersedes a static "external" placeholder of the
  // same id (the original "Connect" catalog entries). But a genuinely installed/detected model
  // (any non-'external' state) still wins — it's actually present.
  const recipeIds = new Set(recipes.map((r) => r.id));
  const base = detected.filter((m) => !(recipeIds.has(m.id) && m.state === 'external'));
  const present = new Set(base.map((m) => m.id));
  const out = [...base];
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
