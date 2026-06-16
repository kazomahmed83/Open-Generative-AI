// tests/localRuntimeCatalog.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { listCatalog, getCatalogEntry } = require('../lib/local-runtime/catalog.js');
const config = require('../lib/local-runtime/config.js');

test('listCatalog returns normalized local image entries', () => {
  const all = listCatalog();
  assert.ok(Array.isArray(all) && all.length > 0);
  const z = all.find(m => m.id === 'z-image-turbo');
  assert.ok(z, 'z-image-turbo present');
  assert.strictEqual(z.source, 'local');
  assert.strictEqual(z.provider, 'sdcpp');
  assert.strictEqual(z.kind, 'image');
  assert.ok(Array.isArray(z.aspectRatios));
  assert.ok(z.raw && z.raw.filename, 'keeps raw electron entry');
});

test('getCatalogEntry resolves by id', () => {
  assert.strictEqual(getCatalogEntry('z-image-turbo').id, 'z-image-turbo');
  assert.strictEqual(getCatalogEntry('does-not-exist'), null);
});

test('listCatalog merges configured API provider models (secret-free, source=api)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogai-'));
  const prev = process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR;
  process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR = dir;
  try {
    config.upsertProvider({ id: 'p1', name: 'T', kind: 'image', baseUrl: 'https://x', apiKey: 'k', models: [{ id: 'flux', name: 'FLUX' }] });
    const all = listCatalog();
    const e = all.find((m) => m.id === 'api:p1:flux');
    assert.ok(e, 'api entry present');
    assert.strictEqual(e.source, 'api');
    assert.strictEqual(e.kind, 'image');
    assert.strictEqual(e.apiModelId, 'flux');
    assert.strictEqual(e.provider, 'p1');
    assert.ok(!('apiKey' in e) && !('baseUrl' in e), 'no secrets in catalog entry');
    // local sdcpp entries still present alongside
    assert.ok(all.some((m) => m.id === 'z-image-turbo' && m.source === 'local'));
    assert.strictEqual(getCatalogEntry('api:p1:flux').name, 'FLUX');
  } finally {
    if (prev === undefined) delete process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR;
    else process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR = prev;
  }
});
