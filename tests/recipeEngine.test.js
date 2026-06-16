// tests/recipeEngine.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const eng = require('../lib/local-runtime/providers/recipe-engine.js');

test('arToSize maps known ratios and falls back to 1024x1024', () => {
  assert.equal(eng.arToSize('16:9'), '1792x1024');
  assert.equal(eng.arToSize('9:16'), '1024x1792');
  assert.equal(eng.arToSize('weird'), '1024x1024');
});

test('arToWH splits the size string into integers', () => {
  assert.deepEqual(eng.arToWH('4:3'), { width: 1024, height: 768 });
});

test('buildValues derives size/width/height and drops empty seed', () => {
  const v = eng.buildValues('m1', { prompt: 'cat', aspect_ratio: '16:9' });
  assert.equal(v.prompt, 'cat');
  assert.equal(v.model, 'm1');
  assert.equal(v.size, '1792x1024');
  assert.deepEqual({ w: v.width, h: v.height }, { w: 1792, h: 1024 });
  assert.equal(v.seed, undefined);
  assert.deepEqual(v.messages, [{ role: 'user', content: 'cat' }]);
});

test('buildValues keeps an explicit seed and explicit messages', () => {
  const v = eng.buildValues('m1', { seed: 7, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(v.seed, 7);
  assert.deepEqual(v.messages, [{ role: 'user', content: 'hi' }]);
});
