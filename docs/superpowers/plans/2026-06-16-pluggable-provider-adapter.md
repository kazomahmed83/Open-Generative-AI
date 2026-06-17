# Pluggable API-Provider Adapter (Recipe Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the OpenAI-only API adapter with a declarative "recipe" engine so any bring-your-own-key provider (OpenAI-shaped *or* bespoke like Gemini/Stability) works from data with no code change, plus presets, a Test button, and a live "Browse models" picker with a Free filter.

**Architecture:** A pure recipe engine (`recipe-engine.js`) does substitution → auth → result-read driven by a 12-field recipe object. Built-in presets (`presets.js`) carry recipes; `api.js` `generate()` resolves a provider's recipe (or the OpenAI-compatible default) and runs it. The registry, generate route, SSE, and local storage are unchanged. New server routes power the Test and Browse buttons.

**Tech Stack:** CommonJS runtime modules (the repo is CJS-default; ESM `.js` + `await import()` fails on this Node 25/Windows). Tests run with `node --test "tests/*.test.js"` (glob form — bare `node --test tests/` is broken here). Files use **CRLF** line endings. Next.js route handlers are ESM with `export const runtime = 'nodejs'`. Node global `fetch`/`FormData`/`Buffer` are available in the node runtime.

Design spec: [`2026-06-16-pluggable-provider-adapter-design.md`](../specs/2026-06-16-pluggable-provider-adapter-design.md).

---

## File Structure

**New files:**
- `lib/local-runtime/providers/recipe-engine.js` — pure engine: `arToSize`, `arToWH`, `buildValues`, `substitute`, `fillPath`, `getByPath`, `readByPath`, `readResult`, `readMime`, `buildRequest`, `runRecipe`, `normalizeModelList`, `extFromMime`, `extFromUrl`.
- `lib/local-runtime/providers/presets.js` — `DEFAULT_IMAGE_RECIPE`, `DEFAULT_CHAT_RECIPE`, `PRESETS` (9 providers), `getPreset(id)`.
- `app/api/local-ai/providers/test/route.js` — `POST` runs one recipe call, returns `{ ok, error? }`.
- `app/api/local-ai/providers/browse/route.js` — `POST` fetches+normalizes a provider's model catalog.
- `tests/recipeEngine.test.js`, `tests/providerPresets.test.js`, `tests/modelsListNormalize.test.js`.

**Modified files:**
- `lib/local-runtime/providers/api.js` — `generate()` resolves recipe + calls `runRecipe`; keep `buildImageRequest`/`buildChatRequest` as thin default-recipe wrappers.
- `lib/local-runtime/providers/index.js` — unchanged call shape (verify only).
- `lib/local-runtime/config.js` — persist optional recipe fields; models keep optional `kind`.
- `lib/local-runtime/catalog.js` — `normalizeApiModel` uses per-model `kind` (`m.kind || p.kind`).
- `app/api/local-ai/providers/route.js` — accept/validate new provider fields.
- `components/ProvidersPanel.js` — preset dropdown, per-model kind, Test button (Stage A); Browse + Advanced clone/JSON (Stage B).
- `tests/apiProvider.test.js` — update to new default-recipe request shapes.

---

# STAGE A — Recipe engine, presets, Test button (independently shippable)

## Task 1: Aspect-ratio helpers + value map

**Files:**
- Create: `lib/local-runtime/providers/recipe-engine.js`
- Test: `tests/recipeEngine.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "tests/recipeEngine.test.js"`
Expected: FAIL — `Cannot find module '.../recipe-engine.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/local-runtime/providers/recipe-engine.js
// Pure, declarative recipe engine for bring-your-own-key API providers.
// CommonJS so it is unit-testable with node --test and importable by the
// Next.js node-runtime routes and (later) Electron.

const SIZE_BY_AR = {
  '1:1': '1024x1024', '16:9': '1792x1024', '9:16': '1024x1792',
  '4:3': '1024x768', '3:4': '768x1024',
};
function arToSize(ar) { return SIZE_BY_AR[ar] || '1024x1024'; }
function arToWH(ar) {
  const [w, h] = arToSize(ar).split('x').map(Number);
  return { width: w, height: h };
}

// Map our generic generate params onto the {{token}} namespace used in recipe bodies.
// Any value left undefined is dropped from the body by substitute(), so optional
// fields stay optional.
function buildValues(apiModelId, params = {}) {
  const ar = params.aspect_ratio || '1:1';
  const { width, height } = arToWH(ar);
  return {
    prompt: params.prompt,
    model: apiModelId,
    messages: params.messages || (params.prompt != null ? [{ role: 'user', content: params.prompt }] : undefined),
    size: params.size || arToSize(ar),
    width: params.width || width,
    height: params.height || height,
    aspect_ratio: ar,
    seed: (params.seed != null && params.seed !== -1) ? params.seed : undefined,
    negative_prompt: params.negative_prompt,
    steps: params.steps,
    n: params.n,
    system: params.system,
  };
}

module.exports = { arToSize, arToWH, buildValues };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "tests/recipeEngine.test.js"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/local-runtime/providers/recipe-engine.js tests/recipeEngine.test.js
git commit -m "feat(adapter): recipe-engine aspect-ratio helpers + value map"
```

## Task 2: Template substitution + path filling

**Files:**
- Modify: `lib/local-runtime/providers/recipe-engine.js`
- Test: `tests/recipeEngine.test.js`

- [ ] **Step 1: Write the failing test** (append)

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "tests/recipeEngine.test.js"`
Expected: FAIL — `eng.substitute is not a function`.

- [ ] **Step 3: Write minimal implementation** (add to recipe-engine.js before `module.exports`, then extend exports)

```js
const TOKEN_RE = /\{\{(\w+)\}\}/g;
const EXACT_RE = /^\{\{(\w+)\}\}$/;

// Deep-walk a template, replacing {{tokens}}. A string that is EXACTLY one token
// becomes the token's native value (arrays/objects/numbers survive). Object keys
// whose value resolves to undefined are removed.
function substitute(node, values) {
  if (typeof node === 'string') {
    const exact = node.match(EXACT_RE);
    if (exact) return values[exact[1]];
    return node.replace(TOKEN_RE, (_, k) => (values[k] == null ? '' : String(values[k])));
  }
  if (Array.isArray(node)) return node.map((v) => substitute(v, values));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      const sv = substitute(v, values);
      if (sv === undefined) continue;
      out[k] = sv;
    }
    return out;
  }
  return node;
}

// Single-brace path tokens (kept distinct from body {{tokens}} so they never collide).
function fillPath(path, { model, apiKey } = {}) {
  return String(path)
    .replace(/\{model\}/g, encodeURIComponent(model || ''))
    .replace(/\{apiKey\}/g, encodeURIComponent(apiKey || ''));
}
```

Update the exports line:

```js
module.exports = { arToSize, arToWH, buildValues, substitute, fillPath };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "tests/recipeEngine.test.js"`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/local-runtime/providers/recipe-engine.js tests/recipeEngine.test.js
git commit -m "feat(adapter): template substitution + path filling"
```

## Task 3: Result-path reader (`getByPath`, `readByPath`, `readResult`, `readMime`)

**Files:**
- Modify: `lib/local-runtime/providers/recipe-engine.js`
- Test: `tests/recipeEngine.test.js`

- [ ] **Step 1: Write the failing test** (append)

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "tests/recipeEngine.test.js"`
Expected: FAIL — `eng.getByPath is not a function`.

- [ ] **Step 3: Write minimal implementation** (add before `module.exports`, extend exports)

```js
// Read-only path traversal. Never evaluates code.
function getByPath(obj, pathExpr) {
  const parts = String(pathExpr)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

// Supports a single [*] wildcard: navigate to the array, pick the element that has
// `selectWithField` (or the first), then read the remainder of the path on it.
function readByPath(obj, pathExpr, selectWithField) {
  if (pathExpr && pathExpr.includes('[*]')) {
    const [before, afterRaw] = pathExpr.split('[*]');
    const arr = getByPath(obj, before.replace(/\.$/, ''));
    if (!Array.isArray(arr)) return undefined;
    const after = afterRaw.replace(/^\./, '');
    const sel = selectWithField
      ? arr.find((el) => el && getByPath(el, selectWithField) != null)
      : arr[0];
    if (sel == null) return undefined;
    return after ? getByPath(sel, after) : sel;
  }
  return getByPath(obj, pathExpr);
}

function readResult(parsed, recipe) {
  return readByPath(parsed, recipe.resultPath, recipe.selectWithField);
}
function readMime(parsed, recipe) {
  return recipe.resultMimePath ? readByPath(parsed, recipe.resultMimePath, recipe.selectWithField) : undefined;
}
```

Update exports:

```js
module.exports = { arToSize, arToWH, buildValues, substitute, fillPath, getByPath, readByPath, readResult, readMime };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "tests/recipeEngine.test.js"`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/local-runtime/providers/recipe-engine.js tests/recipeEngine.test.js
git commit -m "feat(adapter): read-only result-path reader with wildcard + mime"
```

## Task 4: `buildRequest` (compose URL, auth, headers, body)

**Files:**
- Modify: `lib/local-runtime/providers/recipe-engine.js`
- Test: `tests/recipeEngine.test.js`

- [ ] **Step 1: Write the failing test** (append)

```js
test('buildRequest composes a bearer JSON image request', () => {
  const recipe = { kind: 'image', path: '/v1/images/generations', authStyle: 'bearer', body: { model: '{{model}}', prompt: '{{prompt}}', size: '{{size}}', n: 1 }, resultPath: 'data[0].b64_json', resultType: 'base64' };
  const req = eng.buildRequest(recipe, { baseUrl: 'https://api.openai.com/', apiKey: 'sk' }, 'gpt-image-1', { prompt: 'cat', aspect_ratio: '1:1' });
  assert.equal(req.url, 'https://api.openai.com/v1/images/generations');
  assert.equal(req.method, 'POST');
  assert.equal(req.headers.Authorization, 'Bearer sk');
  assert.equal(req.headers['Content-Type'], 'application/json');
  assert.deepEqual(req.body, { model: 'gpt-image-1', prompt: 'cat', size: '1024x1024', n: 1 });
  assert.equal(req.bodyType, 'json');
});

test('buildRequest supports header auth + {model} in path (Gemini) and omits Content-Type for multipart', () => {
  const gem = { kind: 'image', path: '/v1/models/{model}:generateContent', authStyle: 'header', authHeader: 'x-goog-api-key', body: { contents: [{ parts: [{ text: '{{prompt}}' }] }] }, resultPath: 'candidates[0].content.parts[*].inlineData.data', resultType: 'base64' };
  const r1 = eng.buildRequest(gem, { baseUrl: 'https://g.googleapis.com', apiKey: 'K' }, 'gemini-x', { prompt: 'cat' });
  assert.equal(r1.url, 'https://g.googleapis.com/v1/models/gemini-x:generateContent');
  assert.equal(r1.headers['x-goog-api-key'], 'K');
  assert.equal(r1.headers.Authorization, undefined);

  const stab = { kind: 'image', path: '/v2beta/stable-image/generate/core', bodyType: 'multipart', authStyle: 'bearer', headers: { Accept: 'application/json' }, body: { prompt: '{{prompt}}', aspect_ratio: '{{aspect_ratio}}' }, resultPath: 'image', resultType: 'base64' };
  const r2 = eng.buildRequest(stab, { baseUrl: 'https://api.stability.ai', apiKey: 'K' }, 'core', { prompt: 'cat', aspect_ratio: '16:9' });
  assert.equal(r2.bodyType, 'multipart');
  assert.equal(r2.headers['Content-Type'], undefined); // boundary set by the HTTP layer
  assert.equal(r2.headers.Accept, 'application/json');
  assert.deepEqual(r2.body, { prompt: 'cat', aspect_ratio: '16:9' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "tests/recipeEngine.test.js"`
Expected: FAIL — `eng.buildRequest is not a function`.

- [ ] **Step 3: Write minimal implementation** (add before `module.exports`, extend exports)

```js
function normBase(baseUrl) { return String(baseUrl || '').replace(/\/+$/, ''); }

function buildRequest(recipe, provider, apiModelId, params) {
  const values = buildValues(apiModelId, params);
  const url = normBase(provider.baseUrl) + fillPath(recipe.path, { model: apiModelId, apiKey: provider.apiKey });
  const headers = Object.assign({}, recipe.headers || {});
  const style = recipe.authStyle || 'bearer';
  if (style === 'bearer') headers['Authorization'] = `Bearer ${provider.apiKey}`;
  else if (style === 'header') headers[recipe.authHeader || 'Authorization'] = provider.apiKey;
  // style === 'query' is carried via {apiKey} already substituted into the path.
  const bodyType = recipe.bodyType || 'json';
  const body = substitute(recipe.body || {}, values);
  if (bodyType === 'json' && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  return { url, method: recipe.method || 'POST', headers, body, bodyType, recipe };
}
```

Update exports to add `buildRequest`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "tests/recipeEngine.test.js"`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/local-runtime/providers/recipe-engine.js tests/recipeEngine.test.js
git commit -m "feat(adapter): buildRequest composes url/auth/headers/body"
```

## Task 5: `runRecipe` (HTTP call + result handling) + ext helpers

**Files:**
- Modify: `lib/local-runtime/providers/recipe-engine.js`
- Test: `tests/recipeEngine.test.js`

- [ ] **Step 1: Write the failing test** (append). Stubs `global.fetch`.

```js
test('extFromMime / extFromUrl map to file extensions', () => {
  assert.equal(eng.extFromMime('image/png'), 'png');
  assert.equal(eng.extFromMime('image/jpeg'), 'jpeg');
  assert.equal(eng.extFromUrl('https://x/y/pic.webp?sig=1'), 'webp');
});

test('runRecipe returns text for a chat recipe', async () => {
  const orig = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'hello' } }] }) });
  try {
    const recipe = { kind: 'chat', path: '/v1/chat/completions', body: { model: '{{model}}', messages: '{{messages}}' }, resultPath: 'choices[0].message.content', resultType: 'text' };
    const out = await eng.runRecipe(recipe, { baseUrl: 'https://x', apiKey: 'k' }, 'm', { prompt: 'hi' });
    assert.deepEqual(out, { text: 'hello' });
  } finally { global.fetch = orig; }
});

test('runRecipe decodes base64 image and uses mime for ext', async () => {
  const orig = global.fetch;
  const b64 = Buffer.from('PNGDATA').toString('base64');
  global.fetch = async () => ({ ok: true, json: async () => ({ data: [{ b64_json: b64 }] }) });
  try {
    const recipe = { kind: 'image', path: '/v1/images/generations', body: { prompt: '{{prompt}}' }, resultPath: 'data[0].b64_json', resultType: 'base64' };
    const out = await eng.runRecipe(recipe, { baseUrl: 'https://x', apiKey: 'k' }, 'm', { prompt: 'cat' });
    assert.equal(out.buffer.toString(), 'PNGDATA');
    assert.equal(out.ext, 'png');
  } finally { global.fetch = orig; }
});

test('runRecipe downloads a url-type image result', async () => {
  const orig = global.fetch;
  let call = 0;
  global.fetch = async (u) => {
    call += 1;
    if (call === 1) return { ok: true, json: async () => ({ images: [{ url: 'https://cdn/x.png' }] }) };
    return { ok: true, arrayBuffer: async () => Buffer.from('BYTES') };
  };
  try {
    const recipe = { kind: 'image', path: '/v1/images/generations', body: { prompt: '{{prompt}}' }, resultPath: 'images[0].url', resultType: 'url' };
    const out = await eng.runRecipe(recipe, { baseUrl: 'https://x', apiKey: 'k' }, 'm', { prompt: 'cat' });
    assert.equal(out.buffer.toString(), 'BYTES');
  } finally { global.fetch = orig; }
});

test('runRecipe throws a helpful error on non-ok response', async () => {
  const orig = global.fetch;
  global.fetch = async () => ({ ok: false, status: 401, text: async () => 'nope' });
  try {
    const recipe = { kind: 'chat', path: '/x', body: {}, resultPath: 'a', resultType: 'text' };
    await assert.rejects(() => eng.runRecipe(recipe, { baseUrl: 'https://x', apiKey: 'k' }, 'm', {}), /401/);
  } finally { global.fetch = orig; }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "tests/recipeEngine.test.js"`
Expected: FAIL — `eng.extFromMime is not a function`.

- [ ] **Step 3: Write minimal implementation** (add before `module.exports`, extend exports)

```js
function extFromMime(mime) {
  if (!mime) return undefined;
  const m = String(mime).toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpeg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  return undefined;
}
function extFromUrl(url) {
  const m = String(url).split('?')[0].match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : undefined;
}

async function runRecipe(recipe, provider, apiModelId, params, opts = {}) {
  const req = buildRequest(recipe, provider, apiModelId, params);
  let fetchBody;
  if (req.bodyType === 'multipart') {
    const fd = new FormData();
    let any = false;
    for (const [k, v] of Object.entries(req.body)) {
      if (v == null) continue;
      fd.append(k, String(v));
      any = true;
    }
    if (!any) fd.append('none', ''); // multipart gotcha: force a multipart body
    fetchBody = fd;
  } else {
    fetchBody = JSON.stringify(req.body);
  }
  const res = await fetch(req.url, { method: req.method, headers: req.headers, body: fetchBody, signal: opts.signal });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`API ${recipe.kind} request failed (${res.status})${detail ? `: ${detail.slice(0, 120)}` : ''}`);
  }
  if (recipe.resultType === 'binary') {
    return { buffer: Buffer.from(await res.arrayBuffer()), ext: 'png', seed: params.seed };
  }
  if (recipe.resultType === 'text') {
    const data = await res.json();
    return { text: readResult(data, recipe) || '' };
  }
  const data = await res.json();
  const val = readResult(data, recipe);
  if (recipe.resultType === 'url') {
    if (!val) throw new Error('API returned no image url');
    const imgRes = await fetch(val, { signal: opts.signal });
    if (!imgRes.ok) throw new Error(`API image download failed (${imgRes.status})`);
    return { buffer: Buffer.from(await imgRes.arrayBuffer()), ext: extFromUrl(val) || 'png', seed: params.seed };
  }
  if (!val) throw new Error('API returned no image');
  return { buffer: Buffer.from(val, 'base64'), ext: extFromMime(readMime(data, recipe)) || 'png', seed: params.seed };
}
```

Update exports to add `runRecipe`, `extFromMime`, `extFromUrl`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "tests/recipeEngine.test.js"`
Expected: PASS (19 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/local-runtime/providers/recipe-engine.js tests/recipeEngine.test.js
git commit -m "feat(adapter): runRecipe HTTP call + base64/url/binary/text handling"
```

## Task 6: Presets + default recipes

**Files:**
- Create: `lib/local-runtime/providers/presets.js`
- Test: `tests/providerPresets.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/providerPresets.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "tests/providerPresets.test.js"`
Expected: FAIL — `Cannot find module '.../presets.js'`.

- [ ] **Step 3: Write minimal implementation** (recipes verbatim from the validated spec)

```js
// lib/local-runtime/providers/presets.js
// Built-in provider presets + the OpenAI-compatible default recipes. Data only.

const DEFAULT_IMAGE_RECIPE = {
  kind: 'image', path: '/v1/images/generations', method: 'POST', bodyType: 'json', authStyle: 'bearer',
  body: { model: '{{model}}', prompt: '{{prompt}}', size: '{{size}}', n: 1 },
  resultPath: 'data[0].b64_json', resultType: 'base64',
};
const DEFAULT_CHAT_RECIPE = {
  kind: 'chat', path: '/v1/chat/completions', method: 'POST', bodyType: 'json', authStyle: 'bearer',
  body: { model: '{{model}}', messages: '{{messages}}' },
  resultPath: 'choices[0].message.content', resultType: 'text',
};

const OPENAI_CHAT = JSON.stringify(DEFAULT_CHAT_RECIPE);

const PRESETS = [
  {
    id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com', authStyle: 'bearer',
    models: [
      { id: 'gpt-image-1', name: 'GPT Image 1', kind: 'image' },
      { id: 'dall-e-3', name: 'DALL·E 3', kind: 'image' },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', kind: 'chat' },
    ],
    imageRecipe: JSON.stringify(DEFAULT_IMAGE_RECIPE),
    chatRecipe: OPENAI_CHAT,
    modelsList: { path: '/v1/models', auth: true, itemsPath: 'data', idField: 'id' },
  },
  {
    id: 'together', name: 'Together AI', baseUrl: 'https://api.together.xyz', authStyle: 'bearer',
    models: [
      { id: 'black-forest-labs/FLUX.1-schnell-Free', name: 'FLUX.1 schnell (Free)', kind: 'image' },
      { id: 'black-forest-labs/FLUX.1-schnell', name: 'FLUX.1 schnell (Turbo)', kind: 'image' },
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B Turbo', kind: 'chat' },
    ],
    imageRecipe: JSON.stringify({ kind: 'image', path: '/v1/images/generations', bodyType: 'json', authStyle: 'bearer', body: { model: '{{model}}', prompt: '{{prompt}}', width: '{{width}}', height: '{{height}}', steps: 4, n: 1, response_format: 'base64' }, resultPath: 'data[0].b64_json', resultType: 'base64' }),
    chatRecipe: OPENAI_CHAT,
    modelsList: { path: '/v1/models', auth: true, itemsPath: 'data', idField: 'id' },
  },
  {
    id: 'siliconflow', name: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn', authStyle: 'bearer',
    models: [
      { id: 'black-forest-labs/FLUX.1-schnell', name: 'FLUX.1 schnell', kind: 'image' },
      { id: 'Kwai-Kolors/Kolors', name: 'Kolors', kind: 'image' },
      { id: 'nex-agi/Nex-N2-Pro', name: 'Nex-N2-Pro', kind: 'chat' },
      { id: 'Qwen/Qwen3-8B', name: 'Qwen3 8B', kind: 'chat' },
    ],
    imageRecipe: JSON.stringify({ kind: 'image', path: '/v1/images/generations', bodyType: 'json', authStyle: 'bearer', body: { model: '{{model}}', prompt: '{{prompt}}', image_size: '{{size}}', num_inference_steps: 20 }, resultPath: 'images[0].url', resultType: 'url' }),
    chatRecipe: OPENAI_CHAT,
    modelsList: { path: '/v1/models', auth: true, itemsPath: 'data', idField: 'id' },
  },
  {
    id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com', authStyle: 'bearer',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', kind: 'chat' },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', kind: 'chat' },
    ],
    chatRecipe: JSON.stringify(Object.assign({}, DEFAULT_CHAT_RECIPE, { path: '/openai/v1/chat/completions' })),
    modelsList: { path: '/openai/v1/models', auth: true, itemsPath: 'data', idField: 'id' },
  },
  {
    id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai', authStyle: 'bearer',
    models: [
      { id: 'nex-agi/nex-n2-pro:free', name: 'Nex-N2-Pro (free)', kind: 'chat' },
      { id: 'nex-agi/nex-n2-pro', name: 'Nex-N2-Pro', kind: 'chat' },
    ],
    chatRecipe: JSON.stringify({ kind: 'chat', path: '/api/v1/chat/completions', bodyType: 'json', authStyle: 'bearer', headers: { 'HTTP-Referer': 'https://open-generative-ai.local', 'X-Title': 'Open Generative AI' }, body: { model: '{{model}}', messages: '{{messages}}' }, resultPath: 'choices[0].message.content', resultType: 'text' }),
    modelsList: { path: '/api/v1/models', auth: false, itemsPath: 'data', idField: 'id', nameField: 'name', freePath: 'pricing.prompt', freeEquals: '0', kindFromPath: 'architecture.output_modalities', kindImageWhenContains: 'image' },
  },
  {
    id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', authStyle: 'bearer',
    models: [
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', kind: 'chat' },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', kind: 'chat' },
    ],
    chatRecipe: JSON.stringify(Object.assign({}, DEFAULT_CHAT_RECIPE, { path: '/chat/completions' })),
    modelsList: { path: '/models', auth: true, itemsPath: 'data', idField: 'id' },
  },
  {
    id: 'moonshot', name: 'Moonshot AI (Kimi)', baseUrl: 'https://api.moonshot.ai', authStyle: 'bearer',
    models: [
      { id: 'kimi-k2.6', name: 'Kimi k2.6', kind: 'chat' },
      { id: 'moonshot-v1-128k', name: 'Moonshot v1 128k', kind: 'chat' },
    ],
    chatRecipe: OPENAI_CHAT,
    modelsList: { path: '/v1/models', auth: true, itemsPath: 'data', idField: 'id' },
  },
  {
    id: 'stability', name: 'Stability AI', baseUrl: 'https://api.stability.ai', authStyle: 'bearer',
    models: [
      { id: 'core', name: 'Stable Image Core', kind: 'image' },
      { id: 'ultra', name: 'Stable Image Ultra', kind: 'image' },
    ],
    imageRecipe: JSON.stringify({ kind: 'image', path: '/v2beta/stable-image/generate/core', method: 'POST', bodyType: 'multipart', authStyle: 'bearer', headers: { Accept: 'application/json' }, body: { prompt: '{{prompt}}', aspect_ratio: '{{aspect_ratio}}', output_format: 'png' }, resultPath: 'image', resultType: 'base64' }),
  },
  {
    id: 'gemini', name: 'Google Gemini API', baseUrl: 'https://generativelanguage.googleapis.com', authStyle: 'header',
    models: [
      { id: 'gemini-3.1-flash-image', name: 'Gemini 3.1 Flash Image', kind: 'image' },
      { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (preview)', kind: 'chat' },
    ],
    imageRecipe: JSON.stringify({ kind: 'image', path: '/v1/models/{model}:generateContent', method: 'POST', bodyType: 'json', authStyle: 'header', authHeader: 'x-goog-api-key', body: { contents: [{ parts: [{ text: '{{prompt}}' }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], responseFormat: { aspectRatio: '{{aspect_ratio}}', imageSize: '2K' } } }, resultPath: 'candidates[0].content.parts[*].inlineData.data', selectWithField: 'inlineData', resultMimePath: 'candidates[0].content.parts[*].inlineData.mimeType', resultType: 'base64' }),
    chatRecipe: JSON.stringify({ kind: 'chat', path: '/v1beta/models/{model}:generateContent', method: 'POST', bodyType: 'json', authStyle: 'header', authHeader: 'x-goog-api-key', body: { contents: [{ parts: [{ text: '{{prompt}}' }] }] }, resultPath: 'candidates[0].content.parts[0].text', resultType: 'text' }),
  },
];

function getPreset(id) { return PRESETS.find((p) => p.id === id) || null; }

module.exports = { PRESETS, getPreset, DEFAULT_IMAGE_RECIPE, DEFAULT_CHAT_RECIPE };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "tests/providerPresets.test.js"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/local-runtime/providers/presets.js tests/providerPresets.test.js
git commit -m "feat(adapter): 9 validated provider presets + default recipes"
```

## Task 7: Wire `api.js` to the recipe engine (keep registry call shape)

**Files:**
- Modify: `lib/local-runtime/providers/api.js`
- Modify: `tests/apiProvider.test.js`

- [ ] **Step 1: Update the failing test** — replace the body-shape assertions in `tests/apiProvider.test.js` with the new default-recipe shapes and a `resolveRecipe` check. Read the existing file first; replace the `buildImageRequest`/`buildChatRequest` assertions with:

```js
const { buildImageRequest, buildChatRequest, resolveRecipe, generate } = require('../lib/local-runtime/providers/api.js');

test('buildImageRequest uses the default OpenAI image shape', () => {
  const req = buildImageRequest({ baseUrl: 'https://api.openai.com', apiKey: 'sk' }, 'gpt-image-1', { prompt: 'cat', aspect_ratio: '1:1' });
  assert.equal(req.url, 'https://api.openai.com/v1/images/generations');
  assert.equal(req.headers.Authorization, 'Bearer sk');
  assert.deepEqual(req.body, { model: 'gpt-image-1', prompt: 'cat', size: '1024x1024', n: 1 });
});

test('buildChatRequest uses the default chat shape', () => {
  const req = buildChatRequest({ baseUrl: 'https://x', apiKey: 'k' }, 'm', { prompt: 'hi' });
  assert.equal(req.url, 'https://x/v1/chat/completions');
  assert.deepEqual(req.body, { model: 'm', messages: [{ role: 'user', content: 'hi' }] });
});

test('resolveRecipe prefers an explicit provider recipe, else the default', () => {
  assert.equal(resolveRecipe({}, 'image').resultPath, 'data[0].b64_json');
  const custom = resolveRecipe({ imageRecipe: JSON.stringify({ kind: 'image', path: '/x', body: {}, resultPath: 'y', resultType: 'base64' }) }, 'image');
  assert.equal(custom.path, '/x');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "tests/apiProvider.test.js"`
Expected: FAIL — `resolveRecipe is not a function` / new shape mismatch.

- [ ] **Step 3: Rewrite `lib/local-runtime/providers/api.js`**

```js
// lib/local-runtime/providers/api.js
// Generic OpenAI-compatible + bespoke API provider, driven by declarative recipes.
const eng = require('./recipe-engine.js');
const { DEFAULT_IMAGE_RECIPE, DEFAULT_CHAT_RECIPE } = require('./presets.js');

function resolveRecipe(provider, kind) {
  const explicit = kind === 'image' ? provider.imageRecipe : provider.chatRecipe;
  if (explicit) return typeof explicit === 'string' ? JSON.parse(explicit) : explicit;
  return kind === 'image' ? DEFAULT_IMAGE_RECIPE : DEFAULT_CHAT_RECIPE;
}

// Backward-compatible thin wrappers (used by tests and any legacy callers).
function buildImageRequest(provider, apiModelId, params) {
  const r = eng.buildRequest(DEFAULT_IMAGE_RECIPE, provider, apiModelId, params);
  return { url: r.url, headers: r.headers, body: r.body };
}
function buildChatRequest(provider, apiModelId, params) {
  const r = eng.buildRequest(DEFAULT_CHAT_RECIPE, provider, apiModelId, params);
  return { url: r.url, headers: r.headers, body: r.body };
}

// Called by the registry: api.generate({ provider, apiModelId, kind }, params, onProgress, { signal })
async function generate({ provider, apiModelId, kind }, params, onProgress = () => {}, opts = {}) {
  onProgress({ step: 1, totalSteps: 1, progress: 1, status: 'requesting' });
  const recipe = resolveRecipe(provider, kind);
  return eng.runRecipe(recipe, provider, apiModelId, params, opts);
}

module.exports = { resolveRecipe, buildImageRequest, buildChatRequest, generate, arToSize: eng.arToSize };
```

- [ ] **Step 4: Run the full suite**

Run: `node --test "tests/*.test.js"`
Expected: PASS — all tests including `providerRegistry.test.js` (the registry still calls `api.generate(...)` unchanged) and the 19 engine tests.

- [ ] **Step 5: Commit**

```bash
git add lib/local-runtime/providers/api.js tests/apiProvider.test.js
git commit -m "feat(adapter): drive api.generate via the recipe engine (default = OpenAI-compatible)"
```

## Task 8: Per-model `kind` in config + catalog

**Files:**
- Modify: `lib/local-runtime/catalog.js`
- Modify: `lib/local-runtime/config.js` (only if it strips unknown fields — verify first)
- Test: `tests/localRuntimeCatalog.test.js`

- [ ] **Step 1: Write the failing test** (append to `tests/localRuntimeCatalog.test.js`)

```js
test('normalizeApiModel uses per-model kind, falling back to provider kind', () => {
  const { normalizeApiModel } = require('../lib/local-runtime/catalog.js');
  const provider = { id: 'p1', name: 'P1', kind: 'chat' };
  const imageModel = normalizeApiModel(provider, { id: 'img', name: 'Img', kind: 'image' });
  const inherit = normalizeApiModel(provider, { id: 'c', name: 'C' });
  assert.equal(imageModel.kind, 'image');
  assert.equal(imageModel.id, 'api:p1:img');
  assert.equal(inherit.kind, 'chat');
});
```

> If `normalizeApiModel` is not currently exported, add it to the `module.exports` of `catalog.js` as part of Step 3.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "tests/localRuntimeCatalog.test.js"`
Expected: FAIL — either not exported, or `kind` equals `'chat'` for the image model.

- [ ] **Step 3: Update `normalizeApiModel`** in `lib/local-runtime/catalog.js` so `kind` is `model.kind || provider.kind` and export it. Locate the existing function and change its `kind` assignment:

```js
// inside normalizeApiModel(p, m):
kind: m.kind || p.kind,
```

Ensure `module.exports` includes `normalizeApiModel` (add it if missing). Verify `config.js` `upsertProvider` stores the whole provider object verbatim (it does — it JSON-writes `providers`); models with a `kind` field and provider-level `authStyle`/`authHeader`/`headers`/`imageRecipe`/`chatRecipe`/`modelsList` are therefore persisted with no config.js change. If `config.js` allow-lists fields, extend the allow-list to include those keys.

- [ ] **Step 4: Run the full suite**

Run: `node --test "tests/*.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/local-runtime/catalog.js lib/local-runtime/config.js tests/localRuntimeCatalog.test.js
git commit -m "feat(adapter): per-model kind in catalog (model.kind || provider.kind)"
```

## Task 9: Providers route accepts recipe fields + Test endpoint + minimal UI hooks

**Files:**
- Modify: `app/api/local-ai/providers/route.js`
- Create: `app/api/local-ai/providers/test/route.js`
- Modify: `components/ProvidersPanel.js`

- [ ] **Step 1: Extend the providers POST route** to pass through the new fields and keep the existing apiKey-preserve + http(s) validation. In `app/api/local-ai/providers/route.js`, where the incoming `provider` is assembled before `upsertProvider`, ensure these keys are forwarded if present: `authStyle`, `authHeader`, `headers`, `imageRecipe`, `chatRecipe`, `modelsList`, and per-model `kind`. (If the route spreads the body object, only add validation; if it copies named fields, add the new names.) Keep: reject when `baseUrl` is not `http(s)`; preserve existing `apiKey` when the incoming one is blank.

- [ ] **Step 2: Create the Test route**

```js
// app/api/local-ai/providers/test/route.js
import { resolveRecipe } from '../../../../../lib/local-runtime/providers/api.js';
import * as eng from '../../../../../lib/local-runtime/providers/recipe-engine.js';
import { getProvider } from '../../../../../lib/local-runtime/config.js';
export const runtime = 'nodejs';

// Body: { providerId?, provider?, apiModelId, kind }
// Uses the stored key when providerId is given, else the draft provider (incl. apiKey).
export async function POST(req) {
  try {
    const { providerId, provider: draft, apiModelId, kind } = await req.json();
    const provider = providerId ? getProvider(providerId) : draft;
    if (!provider) return Response.json({ ok: false, error: 'provider not found' }, { status: 400 });
    if (!provider.apiKey) return Response.json({ ok: false, error: 'no API key set' }, { status: 400 });
    const recipe = resolveRecipe(provider, kind);
    const params = kind === 'image'
      ? { prompt: 'a small red circle on white', aspect_ratio: '1:1' }
      : { prompt: 'ping' };
    await eng.runRecipe(recipe, provider, apiModelId, params, {});
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: String(e.message || e).slice(0, 200) }, { status: 200 });
  }
}
```

- [ ] **Step 3: ProvidersPanel — preset dropdown, per-model kind, Test button.** In `components/ProvidersPanel.js`:
  - Import presets: `import { PRESETS } from '../lib/local-runtime/providers/presets.js';`
  - Extend `parseModels` to a third pipe field for kind: `const [id, name, kind] = l.split('|').map(s => s.trim()); return { id, name: name || id, ...(kind === 'image' || kind === 'chat' ? { kind } : {}) };`
  - Update the `save()` `provider` object to include `authStyle: form.authStyle, authHeader: form.authHeader, headers: form.headers, imageRecipe: form.imageRecipe || undefined, chatRecipe: form.chatRecipe || undefined, modelsList: form.modelsList || undefined`.
  - Add a preset `<select>` above the Name input that, on change, fills the form from the chosen preset:

```jsx
<select
  value=""
  onChange={(e) => {
    const p = PRESETS.find((x) => x.id === e.target.value);
    if (!p) return;
    setForm({
      ...BLANK,
      name: p.name,
      baseUrl: p.baseUrl,
      authStyle: p.authStyle || 'bearer',
      authHeader: p.authHeader || '',
      headers: p.headers || null,
      imageRecipe: p.imageRecipe || '',
      chatRecipe: p.chatRecipe || '',
      modelsList: p.modelsList || null,
      modelsText: p.models.map((m) => `${m.id}|${m.name}|${m.kind}`).join('\n'),
    });
  }}
  className="w-full bg-black/30 text-white text-sm rounded px-2 py-1 border border-white/10 outline-none"
>
  <option value="">Start from a preset…</option>
  {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
</select>
```

  - Extend `BLANK` to: `{ name: "", kind: "image", baseUrl: "", apiKey: "", modelsText: "", authStyle: "bearer", authHeader: "", headers: null, imageRecipe: "", chatRecipe: "", modelsList: null }`.
  - Add a Test button next to each saved provider that calls the Test route for the first model and shows ✅/❌:

```jsx
<button
  onClick={async () => {
    const m = (p.models || [])[0];
    const r = await fetch('/api/local-ai/providers/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: p.id, apiModelId: m?.id, kind: m?.kind || p.kind || 'chat' }),
    }).then((x) => x.json()).catch(() => ({ ok: false, error: 'network' }));
    setTestResult((t) => ({ ...t, [p.id]: r.ok ? '✅ works' : `❌ ${r.error || 'failed'}` }));
  }}
  className="text-xs text-cyan-300 hover:text-cyan-200 px-2 py-1"
>Test</button>
```

  - Add `const [testResult, setTestResult] = useState({});` and render `{testResult[p.id]}` under each provider row.

- [ ] **Step 4: Manual verification (browser)** — dev server `npx next dev -p 3005` (already running; restart if needed). At `http://localhost:3005/studio` → Settings → API Providers:
  1. Pick "OpenRouter" from the preset dropdown → form fills (base URL, models incl. `nex-agi/nex-n2-pro:free|…|chat`).
  2. Paste a real OpenRouter key → Save → it appears in the list with "key set".
  3. Click **Test** on it → expect ✅ (or a clear ❌ reason). Confirm via the running dev server logs there is no error and the request hit `https://openrouter.ai/api/v1/chat/completions`.

- [ ] **Step 5: Commit**

```bash
git add app/api/local-ai/providers/route.js app/api/local-ai/providers/test/route.js components/ProvidersPanel.js
git commit -m "feat(adapter): providers route recipe fields, Test endpoint, preset dropdown + per-model kind UI"
```

**End of Stage A — the provider system is fully recipe-driven, presets work, Test validates, and existing OpenAI-compatible providers are unchanged. This is shippable on its own.**

---

# STAGE B — Browse models (live catalog + Free filter) + Advanced clone/JSON

## Task 10: `normalizeModelList`

**Files:**
- Modify: `lib/local-runtime/providers/recipe-engine.js`
- Test: `tests/modelsListNormalize.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/modelsListNormalize.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const eng = require('../lib/local-runtime/providers/recipe-engine.js');

const OPENROUTER_ML = { itemsPath: 'data', idField: 'id', nameField: 'name', freePath: 'pricing.prompt', freeEquals: '0', kindFromPath: 'architecture.output_modalities', kindImageWhenContains: 'image' };

test('normalizeModelList reads OpenRouter pricing→free and modalities→kind', () => {
  const raw = { data: [
    { id: 'a/free', name: 'A Free', pricing: { prompt: '0' }, architecture: { output_modalities: ['text'] } },
    { id: 'b/paid', name: 'B', pricing: { prompt: '0.0001' }, architecture: { output_modalities: ['image'] } },
  ] };
  const out = eng.normalizeModelList(raw, OPENROUTER_ML);
  assert.deepEqual(out[0], { id: 'a/free', name: 'A Free', free: 'free', kind: 'chat' });
  assert.deepEqual(out[1], { id: 'b/paid', name: 'B', free: 'paid', kind: 'image' });
});

test('normalizeModelList degrades to ids with unknown free/kind', () => {
  const out = eng.normalizeModelList({ data: [{ id: 'm1' }] }, { itemsPath: 'data', idField: 'id' });
  assert.deepEqual(out, [{ id: 'm1', name: 'm1', free: 'unknown', kind: 'chat' }]);
});

test('normalizeModelList returns [] for a non-array items path', () => {
  assert.deepEqual(eng.normalizeModelList({}, { itemsPath: 'data', idField: 'id' }), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "tests/modelsListNormalize.test.js"`
Expected: FAIL — `eng.normalizeModelList is not a function`.

- [ ] **Step 3: Implement** (add to recipe-engine.js, extend exports)

```js
function normalizeModelList(raw, ml = {}) {
  const items = getByPath(raw, ml.itemsPath || 'data');
  if (!Array.isArray(items)) return [];
  return items.map((it) => {
    const id = getByPath(it, ml.idField || 'id');
    const name = (ml.nameField && getByPath(it, ml.nameField)) || id;
    let free = 'unknown';
    if (ml.freePath) free = String(getByPath(it, ml.freePath)) === String(ml.freeEquals) ? 'free' : 'paid';
    let kind = 'chat';
    if (ml.kindFromPath) {
      const kv = getByPath(it, ml.kindFromPath);
      const arr = Array.isArray(kv) ? kv : [kv];
      kind = arr.includes(ml.kindImageWhenContains) ? 'image' : 'chat';
    }
    return { id, name, free, kind };
  }).filter((m) => m.id);
}
```

Add `normalizeModelList` to exports.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "tests/modelsListNormalize.test.js"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/local-runtime/providers/recipe-engine.js tests/modelsListNormalize.test.js
git commit -m "feat(adapter): normalizeModelList for catalog browsing"
```

## Task 11: Browse endpoint

**Files:**
- Create: `app/api/local-ai/providers/browse/route.js`

- [ ] **Step 1: Implement the route**

```js
// app/api/local-ai/providers/browse/route.js
import * as eng from '../../../../../lib/local-runtime/providers/recipe-engine.js';
import { getProvider } from '../../../../../lib/local-runtime/config.js';
export const runtime = 'nodejs';

// Body: { providerId?, provider? }  — provider must carry baseUrl + modelsList (+ apiKey if auth)
export async function POST(req) {
  try {
    const { providerId, provider: draft } = await req.json();
    const provider = providerId ? getProvider(providerId) : draft;
    if (!provider || !provider.modelsList) return Response.json({ models: [], error: 'no modelsList' }, { status: 200 });
    const ml = provider.modelsList;
    const base = String(provider.baseUrl || '').replace(/\/+$/, '');
    if (!/^https?:\/\//.test(base)) return Response.json({ models: [], error: 'bad baseUrl' }, { status: 200 });
    const headers = {};
    if (ml.auth && provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
    const res = await fetch(base + ml.path, { headers });
    if (!res.ok) return Response.json({ models: [], error: `list failed (${res.status})` }, { status: 200 });
    const raw = await res.json();
    return Response.json({ models: eng.normalizeModelList(raw, ml) });
  } catch (e) {
    return Response.json({ models: [], error: String(e.message || e).slice(0, 200) }, { status: 200 });
  }
}
```

- [ ] **Step 2: Manual verification** — with the dev server running:

```bash
curl -s -X POST http://localhost:3005/api/local-ai/providers/browse \
  -H 'Content-Type: application/json' \
  -d '{"provider":{"baseUrl":"https://openrouter.ai","modelsList":{"path":"/api/v1/models","auth":false,"itemsPath":"data","idField":"id","nameField":"name","freePath":"pricing.prompt","freeEquals":"0","kindFromPath":"architecture.output_modalities","kindImageWhenContains":"image"}}}' | head -c 400
```
Expected: JSON `{"models":[{"id":"...","name":"...","free":"free|paid","kind":"chat|image"}, …]}` with many entries (OpenRouter's public catalog needs no key).

- [ ] **Step 3: Commit**

```bash
git add app/api/local-ai/providers/browse/route.js
git commit -m "feat(adapter): server-side Browse-models endpoint"
```

## Task 12: ProvidersPanel — Browse models UI (search + Free filter)

**Files:**
- Modify: `components/ProvidersPanel.js`

- [ ] **Step 1: Add Browse state + handler** inside the component:

```jsx
const [browse, setBrowse] = useState({ open: false, loading: false, items: [], freeOnly: true, q: '', error: null });

const openBrowse = async () => {
  setBrowse((b) => ({ ...b, open: true, loading: true, error: null, items: [] }));
  const provider = {
    baseUrl: form.baseUrl, apiKey: form.apiKey, modelsList: form.modelsList,
  };
  const r = await fetch('/api/local-ai/providers/browse', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }),
  }).then((x) => x.json()).catch(() => ({ models: [], error: 'network' }));
  setBrowse((b) => ({ ...b, loading: false, items: r.models || [], error: r.error || null }));
};

const addBrowsed = (m) => {
  const line = `${m.id}|${m.name}|${m.kind}`;
  setForm((f) => ({ ...f, modelsText: f.modelsText ? `${f.modelsText}\n${line}` : line }));
};
```

- [ ] **Step 2: Render the Browse button + panel** (show the button only when the form has a `modelsList`):

```jsx
{form.modelsList && (
  <button onClick={openBrowse} disabled={!form.baseUrl} className="text-xs text-cyan-300 hover:text-cyan-200 px-2 py-1 border border-cyan-500/30 rounded">
    Browse models
  </button>
)}
{browse.open && (
  <div className="border border-white/10 rounded-lg p-2 mt-2 bg-black/30">
    <div className="flex items-center gap-2 mb-2">
      <input value={browse.q} onChange={(e) => setBrowse((b) => ({ ...b, q: e.target.value }))} placeholder="Search models…" className="flex-1 bg-black/30 text-white text-xs rounded px-2 py-1 border border-white/10 outline-none" />
      <label className="text-xs text-white/70 flex items-center gap-1">
        <input type="checkbox" checked={browse.freeOnly} onChange={(e) => setBrowse((b) => ({ ...b, freeOnly: e.target.checked }))} /> Free only
      </label>
      <button onClick={() => setBrowse((b) => ({ ...b, open: false }))} className="text-xs text-white/50 px-2">Close</button>
    </div>
    {browse.loading && <div className="text-white/40 text-xs">Loading…</div>}
    {browse.error && <div className="text-red-300 text-xs">{browse.error}</div>}
    <div className="max-h-48 overflow-y-auto space-y-1">
      {browse.items
        .filter((m) => (!browse.freeOnly || m.free === 'free'))
        .filter((m) => !browse.q || m.id.toLowerCase().includes(browse.q.toLowerCase()) || (m.name || '').toLowerCase().includes(browse.q.toLowerCase()))
        .slice(0, 200)
        .map((m) => (
          <div key={m.id} className="flex items-center justify-between text-xs text-white/80 px-2 py-1 hover:bg-white/5 rounded">
            <span className="truncate">{m.name} <span className="text-white/40">· {m.kind}{m.free === 'free' ? ' · free' : ''}</span></span>
            <button onClick={() => addBrowsed(m)} className="text-cyan-300 hover:text-cyan-200 px-2">Add</button>
          </div>
        ))}
    </div>
  </div>
)}
```

- [ ] **Step 3: Manual verification (browser)** — Settings → API Providers → preset "OpenRouter" → **Browse models** → list loads (no key needed) → "Free only" on → search "nex" → **Add** `nex-agi/nex-n2-pro:free` → it appears in the Models textarea → Save.

- [ ] **Step 4: Commit**

```bash
git add components/ProvidersPanel.js
git commit -m "feat(adapter): Browse-models UI with search + Free-only filter"
```

## Task 13: ProvidersPanel — Advanced (clone-a-preset + raw recipe JSON)

**Files:**
- Modify: `components/ProvidersPanel.js`

- [ ] **Step 1: Add an Advanced collapsible** that exposes the raw `imageRecipe` / `chatRecipe` JSON and a "Start from <preset>" clone:

```jsx
const [showAdvanced, setShowAdvanced] = useState(false);

// validate recipe JSON on save: only block if non-empty AND unparseable
const validRecipe = (s) => { if (!s) return true; try { const o = JSON.parse(s); return o && o.path && o.resultPath && o.resultType; } catch { return false; } };
```

In `save()`, before POSTing, guard:

```js
if (!validRecipe(form.imageRecipe) || !validRecipe(form.chatRecipe)) { setError('Advanced recipe JSON is invalid (need path, resultPath, resultType).'); return; }
```

Render:

```jsx
<button onClick={() => setShowAdvanced((v) => !v)} className="text-xs text-white/50 hover:text-white/80">
  {showAdvanced ? '▾ Advanced (recipe JSON)' : '▸ Advanced (recipe JSON)'}
</button>
{showAdvanced && (
  <div className="space-y-2 border border-white/10 rounded p-2 bg-black/20">
    <div className="flex items-center gap-2">
      <select value="" onChange={(e) => { const p = PRESETS.find((x) => x.id === e.target.value); if (!p) return; setForm((f) => ({ ...f, imageRecipe: p.imageRecipe || '', chatRecipe: p.chatRecipe || '', authStyle: p.authStyle || 'bearer', authHeader: p.authHeader || '', modelsList: p.modelsList || null })); }} className="bg-black/30 text-white text-xs rounded px-2 py-1 border border-white/10">
        <option value="">Start from a preset…</option>
        {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <span className="text-white/40 text-[11px]">clones its recipe JSON to edit</span>
    </div>
    <textarea value={form.imageRecipe} onChange={(e) => setForm({ ...form, imageRecipe: e.target.value })} placeholder="image recipe JSON (optional)" rows={4} className="w-full bg-black/30 text-white text-xs rounded px-2 py-1 border border-white/10 outline-none font-mono" />
    <textarea value={form.chatRecipe} onChange={(e) => setForm({ ...form, chatRecipe: e.target.value })} placeholder="chat recipe JSON (optional)" rows={4} className="w-full bg-black/30 text-white text-xs rounded px-2 py-1 border border-white/10 outline-none font-mono" />
  </div>
)}
```

- [ ] **Step 2: Manual verification (browser)** — Settings → API Providers → expand Advanced → "Start from Gemini" → the image/chat recipe JSON appears editable → change `imageSize` to `1K` → Save → no validation error. (Full bespoke generation is exercised once a chat/image consumer exists; the Test button on a saved provider with a key confirms the round-trip.)

- [ ] **Step 3: Run the full suite**

Run: `node --test "tests/*.test.js"`
Expected: PASS (all engine, presets, normalize, catalog, registry, config tests green).

- [ ] **Step 4: Commit**

```bash
git add components/ProvidersPanel.js
git commit -m "feat(adapter): Advanced recipe JSON editor + clone-a-preset (Tier-3 escape hatch)"
```

**End of Stage B — Browse + Advanced complete. The user can add any preset, browse free models live, and hand-author/clone a recipe for any bespoke provider with no code change.**

---

## Final verification (after all tasks)
- `node --test "tests/*.test.js"` → all green (engine 19, presets 4, normalize 3, plus existing catalog/config/registry/api suites).
- Browser, no MuAPI key: Settings → API Providers → OpenRouter preset → Browse → Free-only → add Nex-N2-Pro free → paste free key → Test ✅.
- Grep: the image path remains MuAPI-free (`generateImage(apiKey` / `muapi.ai` → none in `packages/studio/src/components/ImageStudio.jsx`).
- Then dispatch the final code-reviewer (per subagent-driven-development) over the whole branch.

## Notes / gotchas for the implementer
- **CommonJS only** for `lib/local-runtime/**` and `tests/**` (`require`/`module.exports`). Routes are ESM with `export const runtime = 'nodejs'`.
- Tests run via the **glob**: `node --test "tests/*.test.js"`. Bare `node --test tests/` is broken here.
- Files are **CRLF**; when scripting bulk edits, match `\r?\n`.
- `studio` is transpiled from source (`transpilePackages`), so `ProvidersPanel.js` and `lib/**` changes hot-reload — no rebuild.
- Do **not** migrate `middleware.js` to `proxy.ts` (Next 15; that's a Next 16 feature).
- Keys never reach the client: the Test/Browse routes run server-side; `listProvidersSafe` still strips keys on GET.
