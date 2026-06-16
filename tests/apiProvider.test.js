// tests/apiProvider.test.js
const test = require('node:test');
const assert = require('node:assert');
const api = require('../lib/local-runtime/providers/api.js');

const PROVIDER = { id: 'p1', name: 'T', kind: 'image', baseUrl: 'https://api.example.com/', apiKey: 'sk-secret' };

test('arToSize maps aspect ratios to OpenAI sizes', () => {
  assert.strictEqual(api.arToSize('1:1'), '1024x1024');
  assert.strictEqual(api.arToSize('16:9'), '1792x1024');
  assert.strictEqual(api.arToSize('9:16'), '1024x1792');
  assert.strictEqual(api.arToSize('weird'), '1024x1024');
});

test('buildImageRequest builds the OpenAI images endpoint with auth + body', () => {
  const r = api.buildImageRequest(PROVIDER, 'flux', { prompt: 'a cat', aspect_ratio: '16:9' });
  assert.strictEqual(r.url, 'https://api.example.com/v1/images/generations'); // trailing slash normalized
  assert.strictEqual(r.headers.Authorization, 'Bearer sk-secret');
  assert.strictEqual(r.body.model, 'flux');
  assert.strictEqual(r.body.prompt, 'a cat');
  assert.strictEqual(r.body.size, '1792x1024');
  assert.strictEqual(r.body.response_format, 'b64_json');
  // secret must NOT leak into the body
  assert.ok(!JSON.stringify(r.body).includes('sk-secret'));
});

test('buildChatRequest builds the chat endpoint with messages', () => {
  const r = api.buildChatRequest({ ...PROVIDER, kind: 'chat' }, 'llama3', { prompt: 'hi' });
  assert.strictEqual(r.url, 'https://api.example.com/v1/chat/completions');
  assert.strictEqual(r.headers.Authorization, 'Bearer sk-secret');
  assert.strictEqual(r.body.model, 'llama3');
  assert.deepStrictEqual(r.body.messages, [{ role: 'user', content: 'hi' }]);
});
