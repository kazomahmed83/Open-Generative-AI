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
