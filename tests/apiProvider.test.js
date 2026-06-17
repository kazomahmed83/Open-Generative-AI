// tests/apiProvider.test.js
const test = require('node:test');
const assert = require('node:assert');
const api = require('../lib/local-runtime/providers/api.js');
const { buildImageRequest, buildChatRequest, resolveRecipe, generate } = require('../lib/local-runtime/providers/api.js');

const PROVIDER = { id: 'p1', name: 'T', kind: 'image', baseUrl: 'https://api.example.com/', apiKey: 'sk-secret' };

test('arToSize maps aspect ratios to OpenAI sizes', () => {
  assert.strictEqual(api.arToSize('1:1'), '1024x1024');
  assert.strictEqual(api.arToSize('16:9'), '1792x1024');
  assert.strictEqual(api.arToSize('9:16'), '1024x1792');
  assert.strictEqual(api.arToSize('weird'), '1024x1024');
});

test('buildImageRequest uses the default OpenAI image shape', () => {
  const req = buildImageRequest({ baseUrl: 'https://api.openai.com', apiKey: 'sk' }, 'gpt-image-1', { prompt: 'cat', aspect_ratio: '1:1' });
  assert.equal(req.url, 'https://api.openai.com/v1/images/generations');
  assert.equal(req.headers.Authorization, 'Bearer sk');
  assert.deepEqual(req.body, { model: 'gpt-image-1', prompt: 'cat', size: '1024x1024', n: 1 });
});

test('buildChatRequest uses the default chat shape', () => {
  const req = buildChatRequest({ baseUrl: 'https://x', apiKey: 'k' }, 'm', { prompt: 'hi' });
  assert.equal(req.url, 'https://x/v1/chat/completions');
  assert.deepEqual(req.body, { model: 'm', messages: [{ role: 'user', content: 'hi' }] });
});

test('resolveRecipe prefers an explicit provider recipe, else the default', () => {
  assert.equal(resolveRecipe({}, 'image').resultPath, 'data[0].b64_json');
  const custom = resolveRecipe({ imageRecipe: JSON.stringify({ kind: 'image', path: '/x', body: {}, resultPath: 'y', resultType: 'base64' }) }, 'image');
  assert.equal(custom.path, '/x');
});
