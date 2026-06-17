// tests/ollamaProgress.test.js
const test = require('node:test');
const assert = require('node:assert');
const { parseOllamaPullProgress, aggregateProgress } = require('../lib/local-runtime/catalog/ollamaProgress.js');

test('parseOllamaPullProgress: computes percent from completed/total', () => {
  const p = parseOllamaPullProgress('{"status":"pulling","completed":500,"total":1000}');
  assert.strictEqual(p.percent, 0.5);
  assert.strictEqual(p.status, 'pulling');
});

test('parseOllamaPullProgress: status-only line has null percent; bad line is null', () => {
  assert.strictEqual(parseOllamaPullProgress('{"status":"verifying sha256"}').percent, null);
  assert.strictEqual(parseOllamaPullProgress('not json'), null);
});

test('aggregateProgress: byte-weighted across files', () => {
  // file A 100% of 1GB, file B 50% of 3GB => (1 + 1.5)/4 = 0.625
  assert.ok(Math.abs(aggregateProgress([1, 0.5], [1e9, 3e9]) - 0.625) < 1e-9);
});

test('aggregateProgress: equal-weight fallback when sizes unknown', () => {
  assert.ok(Math.abs(aggregateProgress([1, 0], [0, 0]) - 0.5) < 1e-9);
});
