// tests/recipeState.test.js
const test = require('node:test');
const assert = require('node:assert');
const { recipeState, computeFit } = require('../lib/local-runtime/catalog/recipeState.js');

const fileRecipe = {
  engine: 'comfyui',
  files: [{ dest: 'unet/a.gguf' }, { dest: 'vae/b.safetensors' }],
  requiresNode: { dir: 'ComfyUI-GGUF' },
};

test('recipeState: file recipe ready only when all files present and node installed', () => {
  const all = new Set(['unet/a.gguf', 'vae/b.safetensors']);
  assert.strictEqual(recipeState(fileRecipe, { resolveDest: (d) => d, fileExists: (d) => all.has(d), nodeInstalled: () => true }), 'ready');
  assert.strictEqual(recipeState(fileRecipe, { resolveDest: (d) => d, fileExists: (d) => all.has(d), nodeInstalled: () => false }), 'needs-node');
});

test('recipeState: partial when some files present, available when none', () => {
  assert.strictEqual(recipeState(fileRecipe, { resolveDest: (d) => d, fileExists: (d) => d === 'unet/a.gguf' }), 'partial');
  assert.strictEqual(recipeState(fileRecipe, { resolveDest: (d) => d, fileExists: () => false }), 'available');
});

test('recipeState: ollama ready when the model (any tag) is installed', () => {
  const r = { engine: 'ollama', pull: 'qwen3' };
  assert.strictEqual(recipeState(r, { ollamaModelNames: new Set(['qwen3:latest']) }), 'ready');
  assert.strictEqual(recipeState(r, { ollamaModelNames: new Set(['mistral:latest']) }), 'available');
});

test('computeFit: fits/tight/too-big from free VRAM, unknown without gpu', () => {
  const fit = { minVramGb: 8, recVramGb: 12 };
  assert.strictEqual(computeFit(fit, { freeVramBytes: 12.5 * 1024 ** 3 }), 'fits');
  assert.strictEqual(computeFit(fit, { freeVramBytes: 9 * 1024 ** 3 }), 'tight');
  assert.strictEqual(computeFit(fit, { freeVramBytes: 5 * 1024 ** 3 }), 'too-big');
  assert.strictEqual(computeFit(fit, null), 'unknown');
});
