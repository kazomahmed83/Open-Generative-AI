// tests/localRuntimeConfig.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const cfg = require('../lib/local-runtime/config.js');

function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogai-'));
  const prev = process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR;
  process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR = dir;
  try { fn(dir); } finally {
    if (prev === undefined) delete process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR;
    else process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR = prev;
  }
}

test('defaults to empty providers when no config file', () => {
  withTmp(() => { assert.deepStrictEqual(cfg.listProviders(), []); });
});

test('upsertProvider adds then updates by id; deleteProvider removes', () => {
  withTmp(() => {
    cfg.upsertProvider({ id: 'p1', name: 'Together', kind: 'image', baseUrl: 'https://api.together.xyz', apiKey: 'k', models: [{ id: 'flux', name: 'FLUX' }] });
    assert.strictEqual(cfg.listProviders().length, 1);
    cfg.upsertProvider({ id: 'p1', name: 'Together 2', kind: 'image', baseUrl: 'https://x', apiKey: 'k2', models: [] });
    assert.strictEqual(cfg.listProviders()[0].name, 'Together 2');
    cfg.deleteProvider('p1');
    assert.deepStrictEqual(cfg.listProviders(), []);
  });
});

test('listProvidersSafe strips apiKey but flags presence', () => {
  withTmp(() => {
    cfg.upsertProvider({ id: 'p1', name: 'X', kind: 'chat', baseUrl: 'b', apiKey: 'secret', models: [] });
    const safe = cfg.listProvidersSafe();
    assert.strictEqual(safe[0].apiKey, undefined);
    assert.strictEqual(safe[0].hasApiKey, true);
  });
});
