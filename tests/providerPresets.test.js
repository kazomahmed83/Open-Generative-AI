const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PRESETS, getPreset, DEFAULT_IMAGE_RECIPE, DEFAULT_CHAT_RECIPE } = require('../lib/local-runtime/providers/presets.js');
const eng = require('../lib/local-runtime/providers/recipe-engine.js');

test('there are 9 presets, each with id/name/baseUrl/models', () => {
  assert.equal(PRESETS.length, 9);
  for (const p of PRESETS) {
    assert.ok(p.id && p.name && p.baseUrl, `preset ${p.id} missing core fields`);
    assert.ok(Array.isArray(p.models) && p.models.length > 0, `preset ${p.id} has no models`);
    for (const m of p.models) assert.ok(m.id && (m.kind === 'image' || m.kind === 'chat'), `bad model in ${p.id}`);
  }
});

test('getPreset returns OpenRouter with a free Nex model and a modelsList', () => {
  const or = getPreset('openrouter');
  assert.ok(or.models.some((m) => m.id === 'nex-agi/nex-n2-pro:free'));
  assert.ok(or.modelsList && or.modelsList.path === '/api/v1/models');
});

test('every preset chat recipe builds a valid /chat request via the engine', () => {
  for (const p of PRESETS) {
    const recipe = p.chatRecipe ? JSON.parse(p.chatRecipe) : DEFAULT_CHAT_RECIPE;
    if (recipe === DEFAULT_CHAT_RECIPE && !p.models.some((m) => m.kind === 'chat')) continue;
    const req = eng.buildRequest(recipe, { baseUrl: p.baseUrl, apiKey: 'k', authStyle: p.authStyle }, 'mid', { prompt: 'hi' });
    assert.ok(req.url.startsWith(p.baseUrl.replace(/\/+$/, '')), `${p.id} url`);
  }
});

test('Gemini image preset uses header auth, {model} path, wildcard result', () => {
  const g = getPreset('gemini');
  const recipe = JSON.parse(g.imageRecipe);
  const req = eng.buildRequest(recipe, { baseUrl: g.baseUrl, apiKey: 'K' }, 'gemini-3.1-flash-image', { prompt: 'cat', aspect_ratio: '16:9' });
  assert.match(req.url, /\/v1\/models\/gemini-3\.1-flash-image:generateContent$/);
  assert.equal(req.headers['x-goog-api-key'], 'K');
  assert.equal(recipe.selectWithField, 'inlineData');
});
