// lib/local-runtime/catalog/recipeState.js
// Pure install-state + hardware-fit for a recipe. Callers inject probes (file existence, the set of
// installed Ollama model names, whether a ComfyUI node dir exists) so this stays deterministic.
function recipeState(recipe, ctx = {}) {
  const { fileExists = () => false, ollamaModelNames = new Set(), nodeInstalled = () => true, resolveDest = (d) => d } = ctx;
  if (recipe.engine === 'ollama') {
    const base = String(recipe.pull || '').split(':')[0];
    const has = [...ollamaModelNames].some((n) => n === recipe.pull || String(n).split(':')[0] === base);
    return has ? 'ready' : 'available';
  }
  const files = recipe.files || [];
  const present = files.filter((f) => fileExists(resolveDest(f.dest))).length;
  if (present === 0) return 'available';
  if (present < files.length) return 'partial';
  if (recipe.requiresNode && !nodeInstalled(recipe.requiresNode.dir || recipe.requiresNode.name)) return 'needs-node';
  return 'ready';
}

// Map a recipe's VRAM hints against detected free VRAM. gpu is { freeVramBytes } or null.
function computeFit(fit, gpu) {
  if (!fit || !gpu || !gpu.freeVramBytes) return 'unknown';
  const freeGb = gpu.freeVramBytes / 1024 ** 3;
  if (freeGb >= fit.recVramGb) return 'fits';
  if (freeGb >= fit.minVramGb) return 'tight';
  return 'too-big';
}

module.exports = { recipeState, computeFit };
