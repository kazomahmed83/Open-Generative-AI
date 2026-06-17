// tests/modelsListNormalize.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const eng = require('../lib/local-runtime/providers/recipe-engine.js');

const OPENROUTER_ML = { itemsPath: 'data', idField: 'id', nameField: 'name', freePath: 'pricing.prompt', freeEquals: '0', kindFromPath: 'architecture.output_modalities', kindImageWhenContains: 'image' };

test('normalizeModelList reads OpenRouter pricing→free and modalities→kind', () => {
  const raw = { data: [
    { id: 'a/free', name: 'A Free', pricing: { prompt: '0' }, architecture: { output_modalities: ['text'] } },
    { id: 'b/paid', name: 'B', pricing: { prompt: '0.0001' }, architecture: { output_modalities: ['image'] } },
  ] };
  const out = eng.normalizeModelList(raw, OPENROUTER_ML);
  assert.deepEqual(out[0], { id: 'a/free', name: 'A Free', free: 'free', kind: 'chat' });
  assert.deepEqual(out[1], { id: 'b/paid', name: 'B', free: 'paid', kind: 'image' });
});

test('normalizeModelList degrades to ids with unknown free/kind', () => {
  const out = eng.normalizeModelList({ data: [{ id: 'm1' }] }, { itemsPath: 'data', idField: 'id' });
  assert.deepEqual(out, [{ id: 'm1', name: 'm1', free: 'unknown', kind: 'chat' }]);
});

test('normalizeModelList returns [] for a non-array items path', () => {
  assert.deepEqual(eng.normalizeModelList({}, { itemsPath: 'data', idField: 'id' }), []);
});
