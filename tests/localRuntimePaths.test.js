// tests/localRuntimePaths.test.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { getPaths } = require('../lib/local-runtime/paths.js');

test('getPaths honors OPEN_GENERATIVE_AI_LOCAL_AI_DIR and derives subdirs', () => {
  const p = getPaths({ OPEN_GENERATIVE_AI_LOCAL_AI_DIR: '/tmp/og-ai' });
  assert.strictEqual(p.dataDir, path.resolve('/tmp/og-ai'));
  assert.strictEqual(p.binDir, path.join(path.resolve('/tmp/og-ai'), 'bin'));
  assert.strictEqual(p.modelsDir, path.join(path.resolve('/tmp/og-ai'), 'models'));
  assert.strictEqual(p.assetsDir, path.join(path.resolve('/tmp/og-ai'), 'assets'));
  assert.ok(p.binaryPath.endsWith('sd-cli.exe') || p.binaryPath.endsWith('sd-cli'));
});

test('getPaths defaults to <cwd>/.local-ai when env unset', () => {
  const p = getPaths({});
  assert.strictEqual(p.dataDir, path.resolve(path.join(process.cwd(), '.local-ai')));
});
