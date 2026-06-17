// tests/mergeCatalog.test.js
const test = require('node:test');
const assert = require('node:assert');
const { mergeCatalog } = require('../lib/local-runtime/catalog/mergeCatalog.js');

const recipes = [
  { id: 'comfyui:flux2-klein', name: 'FLUX.2 Klein (9B)', description: 'd', category: 'image', engine: 'comfyui', provider: 'comfyui', sizeBytes: 24e9, fit: { minVramGb: 8, recVramGb: 12 }, requiresNode: { dir: 'ComfyUI-GGUF' } },
  { id: 'ollama:qwen3', name: 'Qwen3 (8B)', description: 'd', category: 'chat', engine: 'ollama', provider: 'ollama', sizeBytes: 5.2e9, fit: { minVramGb: 6, recVramGb: 8 }, pull: 'qwen3' },
];

test('mergeCatalog: detected model with same id wins; recipe is not duplicated', () => {
  const detected = [{ id: 'ollama:qwen3', name: 'qwen3:latest', state: 'available', provider: 'ollama' }];
  const out = mergeCatalog(detected, recipes, () => 'available');
  assert.strictEqual(out.filter((m) => m.id === 'ollama:qwen3').length, 1);
  assert.strictEqual(out.find((m) => m.id === 'ollama:qwen3').name, 'qwen3:latest'); // detected kept
});

test('mergeCatalog: undetected recipe appended with computed state + sizeGB + fit', () => {
  const out = mergeCatalog([], recipes, (r) => (r.engine === 'ollama' ? 'available' : 'needs-node'));
  const flux = out.find((m) => m.id === 'comfyui:flux2-klein');
  assert.strictEqual(flux.installMode, 'recipe');
  assert.strictEqual(flux.state, 'needs-node');
  assert.strictEqual(flux.sizeGB, 22.4);
  assert.deepStrictEqual(flux.fit, { minVramGb: 8, recVramGb: 12 });
});
