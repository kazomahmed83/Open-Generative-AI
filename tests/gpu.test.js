// tests/gpu.test.js
const test = require('node:test');
const assert = require('node:assert');
const { parseNvidiaSmi } = require('../lib/local-runtime/gpu.js');

test('parseNvidiaSmi parses name + total/free VRAM (MiB) into bytes', () => {
  const g = parseNvidiaSmi('NVIDIA GeForce RTX 3060, 12288, 11500\n');
  assert.strictEqual(g.vendor, 'nvidia');
  assert.strictEqual(g.name, 'NVIDIA GeForce RTX 3060');
  assert.strictEqual(g.totalVramBytes, 12288 * 1024 * 1024);
  assert.strictEqual(g.freeVramBytes, 11500 * 1024 * 1024);
});

test('parseNvidiaSmi takes the first GPU when several are listed', () => {
  const g = parseNvidiaSmi('NVIDIA RTX 3060, 12288, 11000\nNVIDIA RTX 4090, 24576, 24000');
  assert.strictEqual(g.name, 'NVIDIA RTX 3060');
  assert.strictEqual(g.totalVramBytes, 12288 * 1024 * 1024);
});

test('parseNvidiaSmi returns null on empty or unparseable output', () => {
  assert.strictEqual(parseNvidiaSmi(''), null);
  assert.strictEqual(parseNvidiaSmi('command not found'), null);
});
