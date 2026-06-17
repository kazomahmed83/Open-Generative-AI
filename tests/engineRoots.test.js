// tests/engineRoots.test.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { resolveEngineRoot, resolveDest, DEFAULT_COMFY_MODELS_DIR } = require('../lib/local-runtime/catalog/engineRoots.js');

test('resolveEngineRoot: comfyui precedence config > env > default', () => {
  assert.strictEqual(
    resolveEngineRoot('comfyui', { config: { engines: { comfyui: { modelsDir: 'C:/custom' } } }, env: {} }),
    'C:/custom');
  assert.strictEqual(resolveEngineRoot('comfyui', { config: {}, env: { COMFYUI_MODELS_DIR: 'D:/env' } }), 'D:/env');
  assert.strictEqual(resolveEngineRoot('comfyui', { config: {}, env: {} }), DEFAULT_COMFY_MODELS_DIR);
});

test('resolveEngineRoot: sdcpp uses the .local-ai models dir; ollama is null', () => {
  const root = resolveEngineRoot('sdcpp', { env: { OPEN_GENERATIVE_AI_LOCAL_AI_DIR: '/data/.local-ai' } });
  assert.strictEqual(root, path.join(path.resolve('/data/.local-ai'), 'models'));
  assert.strictEqual(resolveEngineRoot('ollama', {}), null);
});

test('resolveDest: joins root + relative dest', () => {
  assert.strictEqual(resolveDest('R', 'unet/x.gguf'), path.join('R', 'unet/x.gguf'));
});
