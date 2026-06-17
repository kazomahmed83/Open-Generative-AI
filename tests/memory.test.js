// tests/memory.test.js
const test = require('node:test');
const assert = require('node:assert');
const { isHeavyModel, estimatePeakBytes, checkMemory } = require('../lib/local-runtime/memory.js');

const GiB = 1024 ** 3;

test('isHeavyModel: true for 1024-class diffusion models, false for SD1.5/API', () => {
  assert.strictEqual(isHeavyModel({ type: 'z-image' }), true);
  assert.strictEqual(isHeavyModel({ type: 'sdxl' }), true);
  assert.strictEqual(isHeavyModel({ type: 'flux' }), true);
  assert.strictEqual(isHeavyModel({ type: 'sd1' }), false);
  assert.strictEqual(isHeavyModel({}), false);
  // works off the normalized catalog entry too (type lives under raw)
  assert.strictEqual(isHeavyModel({ raw: { type: 'z-image' } }), true);
});

test('estimatePeakBytes: Z-Image 1024² lands near the observed ~12 GB peak', () => {
  const bytes = estimatePeakBytes({ type: 'z-image' }, { width: 1024, height: 1024 });
  // Observed live: 6.6 GiB compute buffer + ~5 GiB resident weights ≈ 11-12 GiB.
  assert.ok(bytes > 11 * 1e9, `expected > 11e9, got ${bytes}`);
  assert.ok(bytes < 14 * 1e9, `expected < 14e9, got ${bytes}`);
});

test('estimatePeakBytes: SD 1.5 512² is small and far below Z-Image', () => {
  const sd1 = estimatePeakBytes({ type: 'sd1' }, { width: 512, height: 512 });
  const zimg = estimatePeakBytes({ type: 'z-image' }, { width: 1024, height: 1024 });
  assert.ok(sd1 < 3 * 1e9, `expected < 3e9, got ${sd1}`);
  assert.ok(zimg > sd1, 'a 1024² DiT must estimate heavier than a 512² SD1.5');
});

test('checkMemory: blocks Z-Image 1024² when only ~7 GB is free', () => {
  const r = checkMemory({ model: { type: 'z-image', name: 'Z-Image Turbo' }, width: 1024, height: 1024, freeBytes: 7.2 * GiB });
  assert.strictEqual(r.ok, false);
  assert.ok(r.neededBytes > r.freeBytes);
  assert.match(r.message, /Z-Image Turbo/);
  assert.match(r.message, /free/i);
});

test('checkMemory: allows Z-Image 1024² when there is plenty free', () => {
  const r = checkMemory({ model: { type: 'z-image', name: 'Z-Image Turbo' }, width: 1024, height: 1024, freeBytes: 16 * GiB });
  assert.strictEqual(r.ok, true);
});

test('checkMemory: allows SD 1.5 512² on a tight 7 GB budget', () => {
  const r = checkMemory({ model: { type: 'sd1', name: 'Dreamshaper 8' }, width: 512, height: 512, freeBytes: 7.2 * GiB });
  assert.strictEqual(r.ok, true);
});
