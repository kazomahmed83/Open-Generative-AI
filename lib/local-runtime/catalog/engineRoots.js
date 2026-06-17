// lib/local-runtime/catalog/engineRoots.js
const path = require('path');

// The portable ComfyUI install on this machine. Overridable via config.engines.comfyui.modelsDir
// or the COMFYUI_MODELS_DIR env var so the catalog stays machine-independent.
const DEFAULT_COMFY_MODELS_DIR = 'F:/AI/ComfyUI_windows_portable/ComfyUI/models';

function resolveEngineRoot(engine, { config = {}, env = process.env } = {}) {
  if (engine === 'comfyui') {
    return (config.engines && config.engines.comfyui && config.engines.comfyui.modelsDir)
      || env.COMFYUI_MODELS_DIR
      || DEFAULT_COMFY_MODELS_DIR;
  }
  if (engine === 'sdcpp') {
    const dataDir = path.resolve(env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR || path.join(process.cwd(), '.local-ai'));
    return path.join(dataDir, 'models');
  }
  return null; // ollama is not file-based
}

function resolveDest(root, dest) {
  return path.join(root, dest);
}

module.exports = { resolveEngineRoot, resolveDest, DEFAULT_COMFY_MODELS_DIR };
