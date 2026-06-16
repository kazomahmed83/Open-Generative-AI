// tests/providerRegistry.test.js
const test = require('node:test');
const assert = require('node:assert');
const { resolveProvider } = require('../lib/local-runtime/providers/index.js');

test('resolveProvider returns sdcpp generate for a local image model', () => {
  const r = resolveProvider('z-image-turbo');
  assert.strictEqual(r.entry.provider, 'sdcpp');
  assert.strictEqual(typeof r.generate, 'function');
});

test('resolveProvider throws for unknown model', () => {
  assert.throws(() => resolveProvider('nope'));
});
