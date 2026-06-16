// tests/providerRegistry.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { resolveProvider } = require('../lib/local-runtime/providers/index.js');
const config = require('../lib/local-runtime/config.js');

test('resolveProvider returns sdcpp generate for a local image model', () => {
  const r = resolveProvider('z-image-turbo');
  assert.strictEqual(r.entry.provider, 'sdcpp');
  assert.strictEqual(typeof r.generate, 'function');
});

test('resolveProvider throws for unknown model', () => {
  assert.throws(() => resolveProvider('nope'));
});

test('resolveProvider resolves an api:* model to the api provider', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogai-'));
  const prev = process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR;
  process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR = dir;
  try {
    config.upsertProvider({ id: 'p1', name: 'T', kind: 'image', baseUrl: 'https://x', apiKey: 'k', models: [{ id: 'flux', name: 'FLUX' }] });
    const r = resolveProvider('api:p1:flux');
    assert.strictEqual(r.entry.source, 'api');
    assert.strictEqual(r.entry.apiModelId, 'flux');
    assert.strictEqual(typeof r.generate, 'function');
  } finally {
    if (prev === undefined) delete process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR;
    else process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR = prev;
  }
});

test('resolveProvider still resolves local sdcpp + throws on unknown', () => {
  assert.strictEqual(resolveProvider('z-image-turbo').entry.provider, 'sdcpp');
  assert.throws(() => resolveProvider('api:ghost:x')); // not configured -> not in catalog -> Unknown model
});
