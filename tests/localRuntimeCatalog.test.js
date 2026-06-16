// tests/localRuntimeCatalog.test.js
const test = require('node:test');
const assert = require('node:assert');
const { listCatalog, getCatalogEntry } = require('../lib/local-runtime/catalog.js');

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
