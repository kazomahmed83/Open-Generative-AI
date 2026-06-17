// tests/allowlist.test.js
const test = require('node:test');
const assert = require('node:assert');
const { isHostAllowed } = require('../lib/local-runtime/catalog/allowlist.js');

test('isHostAllowed: allows huggingface.co and its CDN subdomains', () => {
  assert.strictEqual(isHostAllowed('https://huggingface.co/x/resolve/main/m.gguf'), true);
  assert.strictEqual(isHostAllowed('https://cdn-lfs.huggingface.co/a/b'), true);
  assert.strictEqual(isHostAllowed('https://cdn-lfs-us-1.hf.co/a/b'), true);
});

test('isHostAllowed: rejects arbitrary and malformed hosts', () => {
  assert.strictEqual(isHostAllowed('https://evil.example.com/m.gguf'), false);
  assert.strictEqual(isHostAllowed('not a url'), false);
  assert.strictEqual(isHostAllowed('https://nothuggingface.co.evil.com/x'), false);
});
