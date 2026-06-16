// tests/recipeEngine.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const eng = require('../lib/local-runtime/providers/recipe-engine.js');

test('arToSize maps known ratios and falls back to 1024x1024', () => {
  assert.equal(eng.arToSize('16:9'), '1792x1024');
  assert.equal(eng.arToSize('9:16'), '1024x1792');
  assert.equal(eng.arToSize('weird'), '1024x1024');
});

test('arToWH splits the size string into integers', () => {
  assert.deepEqual(eng.arToWH('4:3'), { width: 1024, height: 768 });
});

test('buildValues derives size/width/height and drops empty seed', () => {
  const v = eng.buildValues('m1', { prompt: 'cat', aspect_ratio: '16:9' });
  assert.equal(v.prompt, 'cat');
  assert.equal(v.model, 'm1');
  assert.equal(v.size, '1792x1024');
  assert.deepEqual({ w: v.width, h: v.height }, { w: 1792, h: 1024 });
  assert.equal(v.seed, undefined);
  assert.deepEqual(v.messages, [{ role: 'user', content: 'cat' }]);
});

test('buildValues keeps an explicit seed and explicit messages', () => {
  const v = eng.buildValues('m1', { seed: 7, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(v.seed, 7);
  assert.deepEqual(v.messages, [{ role: 'user', content: 'hi' }]);
});

test('substitute replaces exact-token strings with native values', () => {
  const out = eng.substitute({ model: '{{model}}', messages: '{{messages}}' }, { model: 'm1', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(out.model, 'm1');
  assert.deepEqual(out.messages, [{ role: 'user', content: 'hi' }]);
});

test('substitute stringifies tokens embedded in larger strings', () => {
  const out = eng.substitute({ q: 'a {{prompt}} b' }, { prompt: 'cat' });
  assert.equal(out.q, 'a cat b');
});

test('substitute drops keys whose token has no value', () => {
  const out = eng.substitute({ model: '{{model}}', seed: '{{seed}}' }, { model: 'm1', seed: undefined });
  assert.deepEqual(out, { model: 'm1' });
});

test('substitute walks nested arrays/objects', () => {
  const out = eng.substitute({ contents: [{ parts: [{ text: '{{prompt}}' }] }] }, { prompt: 'cat' });
  assert.deepEqual(out, { contents: [{ parts: [{ text: 'cat' }] }] });
});

test('fillPath substitutes single-brace {model} and {apiKey}', () => {
  assert.equal(eng.fillPath('/v1/models/{model}:generateContent', { model: 'gemini-x', apiKey: 'k' }), '/v1/models/gemini-x:generateContent');
  assert.equal(eng.fillPath('/x?key={apiKey}', { model: 'm', apiKey: 'sk 1' }), '/x?key=sk%201');
});

test('getByPath reads dot + bracket paths', () => {
  assert.equal(eng.getByPath({ choices: [{ message: { content: 'hi' } }] }, 'choices[0].message.content'), 'hi');
  assert.equal(eng.getByPath({ a: { b: 'c' } }, 'a.b'), 'c');
  assert.equal(eng.getByPath({}, 'x[0].y'), undefined);
});

test('readResult handles a plain image base64 path', () => {
  const data = { data: [{ b64_json: 'QUJD' }] };
  assert.equal(eng.readResult(data, { resultPath: 'data[0].b64_json' }), 'QUJD');
});

test('readResult handles wildcard + selectWithField (Gemini)', () => {
  const data = { candidates: [{ content: { parts: [{ text: 'hi' }, { inlineData: { data: 'IMG', mimeType: 'image/png' } }] } }] };
  const recipe = { resultPath: 'candidates[0].content.parts[*].inlineData.data', selectWithField: 'inlineData', resultMimePath: 'candidates[0].content.parts[*].inlineData.mimeType' };
  assert.equal(eng.readResult(data, recipe), 'IMG');
  assert.equal(eng.readMime(data, recipe), 'image/png');
});
