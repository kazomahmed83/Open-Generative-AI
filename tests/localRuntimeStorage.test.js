// tests/localRuntimeStorage.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { saveAsset, getAssetPath } = require('../lib/local-runtime/storage.js');

test('saveAsset writes a file and returns a /api/assets url', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogai-'));
  const prev = process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR;
  process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR = dir;
  try {
    const { key, url } = saveAsset(Buffer.from('hello'), 'png');
    assert.ok(/^[\w.-]+\.png$/.test(key));
    assert.strictEqual(url, `/api/assets/${key}`);
    assert.strictEqual(fs.readFileSync(getAssetPath(key), 'utf8'), 'hello');
  } finally {
    if (prev === undefined) delete process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR;
    else process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR = prev;
  }
});

test('getAssetPath rejects path traversal', () => {
  assert.throws(() => getAssetPath('../../etc/passwd'));
});

test('getAssetPath rejects the bare assets dir (empty relative)', () => {
  assert.throws(() => getAssetPath('.'));
});

test('saveAsset sanitizes a malicious ext so the write stays inside assetsDir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogai-'));
  const prev = process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR;
  process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR = dir;
  try {
    const { key, path: filePath } = saveAsset(Buffer.from('x'), '/../../pwned.txt');
    // key is <ts>-<hex>.<sanitized> with no separators
    assert.ok(/^[0-9]+-[a-f0-9]+\.[a-z0-9]{1,8}$/.test(key), `unsafe key: ${key}`);
    const assetsDir = path.join(dir, 'assets');
    assert.ok(
      path.resolve(filePath).startsWith(path.resolve(assetsDir) + path.sep),
      `escaped assetsDir: ${filePath}`,
    );
  } finally {
    if (prev === undefined) delete process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR;
    else process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR = prev;
  }
});
