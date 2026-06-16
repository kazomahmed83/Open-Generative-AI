// tests/localApiSdk.test.js
const test = require('node:test');
const assert = require('node:assert');
const { parseSseResult } = require('../packages/studio/src/local-api.js');

test('parseSseResult extracts the result url from an SSE body', () => {
  const body = [
    'data: {"type":"progress","step":1,"totalSteps":8}',
    'data: {"type":"result","url":"/api/assets/abc.png","seed":7}',
    'data: {"type":"end"}',
  ].join('\n\n');
  assert.deepStrictEqual(parseSseResult(body), { url: '/api/assets/abc.png', seed: 7 });
});

test('parseSseResult throws on error event', () => {
  const body = 'data: {"type":"error","error":"boom"}';
  assert.throws(() => parseSseResult(body), /boom/);
});
