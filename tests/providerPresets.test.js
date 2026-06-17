const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PRESETS, getPreset, DEFAULT_IMAGE_RECIPE, DEFAULT_CHAT_RECIPE } = require('../lib/local-runtime/providers/presets.js');
const { normalizeApiModel } = require('../lib/local-runtime/catalog.js');
const eng = require('../lib/local-runtime/providers/recipe-engine.js');

test('there are 10 presets, each with id/name/baseUrl/models', () => {
  assert.equal(PRESETS.length, 10);
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
  assert.match(req.url, /\/v1beta\/models\/gemini-3\.1-flash-image:generateContent$/);
  assert.equal(req.headers['x-goog-api-key'], 'K');
  assert.equal(recipe.selectWithField, 'inlineData');
});

test('OpenAI per-model sizeMap: gpt-image-1 and dall-e-3 differ for the same 16:9', () => {
  const oa = getPreset('openai');
  const recipe = JSON.parse(oa.imageRecipe);
  const provider = { baseUrl: oa.baseUrl, apiKey: 'k', models: oa.models };
  const gpt = eng.buildRequest(recipe, provider, 'gpt-image-1', { prompt: 'x', aspect_ratio: '16:9' });
  const dalle = eng.buildRequest(recipe, provider, 'dall-e-3', { prompt: 'x', aspect_ratio: '16:9' });
  assert.equal(gpt.body.size, '1536x1024', 'gpt-image-1 must use its own landscape size');
  assert.equal(dalle.body.size, '1792x1024', 'dall-e-3 keeps its larger landscape size');
});

test('buildValues honors a per-model sizeMap and derives width/height from it', () => {
  const v = eng.buildValues('m', { aspect_ratio: '16:9' }, { sizeMap: { '16:9': '1536x1024' } });
  assert.equal(v.size, '1536x1024');
  assert.equal(v.width, 1536);
  assert.equal(v.height, 1024);
});

test('buildValues falls back to the global size table without a sizeMap', () => {
  const v = eng.buildValues('m', { aspect_ratio: '16:9' });
  assert.equal(v.size, '1792x1024');
});

test('OpenAI image recipe carries a quality token; gpt-image-1 sends quality, no response_format', () => {
  const oa = getPreset('openai');
  const recipe = JSON.parse(oa.imageRecipe);
  assert.equal(recipe.body.quality, '{{quality}}');
  const provider = { baseUrl: oa.baseUrl, apiKey: 'k', models: oa.models };
  const req = eng.buildRequest(recipe, provider, 'gpt-image-1', { prompt: 'x', aspect_ratio: '1:1', quality: 'high' });
  assert.equal(req.body.quality, 'high');
  assert.equal(req.body.size, '1024x1024');
  assert.ok(!('response_format' in req.body), 'gpt-image-1 must NOT send response_format');
});

test('dall-e-3 merges its bodyExtra (response_format) and uses standard/hd quality', () => {
  const oa = getPreset('openai');
  const recipe = JSON.parse(oa.imageRecipe);
  const provider = { baseUrl: oa.baseUrl, apiKey: 'k', models: oa.models };
  const req = eng.buildRequest(recipe, provider, 'dall-e-3', { prompt: 'x', aspect_ratio: '16:9', quality: 'hd' });
  assert.equal(req.body.response_format, 'b64_json');
  assert.equal(req.body.quality, 'hd');
  assert.equal(req.body.size, '1792x1024');
});

test('quality token is dropped when no quality is selected', () => {
  const oa = getPreset('openai');
  const recipe = JSON.parse(oa.imageRecipe);
  const provider = { baseUrl: oa.baseUrl, apiKey: 'k', models: oa.models };
  const req = eng.buildRequest(recipe, provider, 'gpt-image-1', { prompt: 'x', aspect_ratio: '1:1' });
  assert.ok(!('quality' in req.body), 'undefined quality must be omitted');
});

test('preset image models expose qualityOptions', () => {
  const oa = getPreset('openai');
  assert.deepEqual(oa.models.find((m) => m.id === 'gpt-image-1').qualityOptions, ['auto', 'low', 'medium', 'high']);
  assert.deepEqual(oa.models.find((m) => m.id === 'dall-e-3').qualityOptions, ['standard', 'hd']);
});

test('normalizeApiModel carries qualityOptions/defaultQuality/sizeMap onto the catalog entry', () => {
  const entry = normalizeApiModel(
    { id: 'openai', kind: 'image' },
    { id: 'gpt-image-1', name: 'GPT', kind: 'image', qualityOptions: ['auto', 'high'], defaultQuality: 'medium', sizeMap: { '16:9': '1536x1024' } },
  );
  assert.deepEqual(entry.qualityOptions, ['auto', 'high']);
  assert.equal(entry.defaultQuality, 'medium');
  assert.deepEqual(entry.sizeMap, { '16:9': '1536x1024' });
  assert.equal(entry.id, 'api:openai:gpt-image-1');
});

test('Pollinations free recipe is GET, keyless, prompt URL-encoded into the path', () => {
  const p = getPreset('pollinations');
  const recipe = JSON.parse(p.imageRecipe);
  const provider = { baseUrl: p.baseUrl, authStyle: 'none', models: p.models };
  const req = eng.buildRequest(recipe, provider, 'flux', { prompt: 'a red fox', aspect_ratio: '9:16' });
  assert.equal(req.method, 'GET');
  assert.ok(!req.headers['Authorization'], 'no auth header for keyless provider');
  assert.match(req.url, /image\.pollinations\.ai\/prompt\/a%20red%20fox\?/);
  assert.match(req.url, /width=720&height=1280/);
  assert.match(req.url, /model=flux/);
  assert.equal(recipe.resultType, 'binary');
});

test('preset image models carry a cheaper defaultQuality (not high)', () => {
  const oa = getPreset('openai');
  assert.equal(oa.models.find((m) => m.id === 'gpt-image-1').defaultQuality, 'medium');
  assert.equal(oa.models.find((m) => m.id === 'dall-e-3').defaultQuality, 'standard');
});
