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
function buildValues(apiModelId, params = {}, opts = {}) {
  const ar = params.aspect_ratio || '1:1';
  // Per-model size override (e.g. gpt-image-1 forbids DALL·E-3's 1792x1024 for 16:9).
  const size = params.size || (opts.sizeMap && opts.sizeMap[ar]) || arToSize(ar);
  const [sw, sh] = String(size).split('x').map(Number);
  return {
    prompt: params.prompt,
    model: apiModelId,
    messages: params.messages || (params.prompt != null ? [{ role: 'user', content: params.prompt }] : undefined),
    size,
    quality: params.quality,
    width: params.width || sw || 1024,
    height: params.height || sh || 1024,
    aspect_ratio: ar,
    seed: (params.seed != null && params.seed !== -1) ? params.seed : undefined,
    negative_prompt: params.negative_prompt,
    steps: params.steps,
    n: params.n,
    system: params.system,
  };
}

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
      // Guard against prototype-pollution keys in user-authored/pasted recipe JSON.
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      const sv = substitute(v, values);
      if (sv === undefined) continue;
      out[k] = sv;
    }
    return out;
  }
  return node;
}

// Single-brace path tokens (kept distinct from body {{tokens}} so they never collide).
// Substitute body-style {{tokens}} into a URL path/query, URL-encoded. No-op when the path
// has no {{tokens}} — lets GET image APIs (e.g. Pollinations) carry the prompt in the URL.
function substitutePath(path, values) {
  return String(path).replace(TOKEN_RE, (_, k) => (values[k] == null ? '' : encodeURIComponent(String(values[k]))));
}
function fillPath(path, { model, apiKey } = {}) {
  return String(path)
    .replace(/\{model\}/g, encodeURIComponent(model || ''))
    .replace(/\{apiKey\}/g, encodeURIComponent(apiKey || ''));
}

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

function normBase(baseUrl) { return String(baseUrl || '').replace(/\/+$/, ''); }

// Attach auth to a headers object. Shared by buildRequest and the Browse route so
// every path treats authStyle identically. 'query' auth is carried via {apiKey} in
// the path (fillPath), so it adds no header here.
function attachAuth(headers, authStyle, authHeader, apiKey) {
  const style = authStyle || 'bearer';
  if (style === 'bearer') headers['Authorization'] = `Bearer ${apiKey}`;
  else if (style === 'header') headers[authHeader || 'Authorization'] = apiKey;
  return headers;
}

function buildRequest(recipe, provider, apiModelId, params) {
  const modelEntry = (provider.models || []).find((m) => m && m.id === apiModelId);
  const values = buildValues(apiModelId, params, { sizeMap: modelEntry && modelEntry.sizeMap });
  // {{tokens}} (URL-encoded) are substituted first so GET image APIs can carry the prompt and
  // dimensions in the URL; then single-brace {model}/{apiKey} are filled (won't match inside {{}}).
  const tokenizedPath = substitutePath(recipe.path, values);
  const url = normBase(provider.baseUrl) + fillPath(tokenizedPath, { model: apiModelId, apiKey: provider.apiKey });
  // Provider-level headers/auth are the fallback; the recipe overrides them when set.
  const headers = Object.assign({}, provider.headers || {}, recipe.headers || {});
  attachAuth(headers, recipe.authStyle || provider.authStyle, recipe.authHeader || provider.authHeader, provider.apiKey);
  const bodyType = recipe.bodyType || 'json';
  const body = substitute(recipe.body || {}, values);
  // Per-model literal body extras (e.g. dall-e-3 needs response_format=b64_json, which
  // gpt-image-1 rejects). Merged after substitution.
  if (modelEntry && modelEntry.bodyExtra) Object.assign(body, modelEntry.bodyExtra);
  const isGet = (recipe.method || 'POST').toUpperCase() === 'GET';
  if (bodyType === 'json' && !isGet && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  return { url, method: recipe.method || 'POST', headers, body, bodyType, recipe };
}

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
  const noBody = ['GET', 'HEAD'].includes((req.method || 'POST').toUpperCase());
  let fetchBody;
  if (noBody) {
    fetchBody = undefined;
  } else if (req.bodyType === 'multipart') {
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
    const ct = res.headers && res.headers.get ? res.headers.get('content-type') : undefined;
    return { buffer: Buffer.from(await res.arrayBuffer()), ext: extFromMime(ct) || 'png', seed: params.seed };
  }
  if (recipe.resultType === 'text') {
    const data = await res.json();
    const t = readResult(data, recipe);
    if (t == null) throw new Error(`API returned no text at resultPath ${recipe.resultPath}`);
    return { text: String(t) };
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

function normalizeModelList(raw, ml = {}) {
  const items = getByPath(raw, ml.itemsPath || 'data');
  if (!Array.isArray(items)) return [];
  const defaultKind = ml.defaultKind || 'chat';
  return items.map((it) => {
    const id = getByPath(it, ml.idField || 'id');
    const name = (ml.nameField && getByPath(it, ml.nameField)) || id;
    let free = 'unknown';
    if (ml.freePath) free = String(getByPath(it, ml.freePath)) === String(ml.freeEquals) ? 'free' : 'paid';
    let kind = defaultKind;
    if (ml.kindFromPath) {
      const kv = getByPath(it, ml.kindFromPath);
      const arr = Array.isArray(kv) ? kv : [kv];
      kind = arr.includes(ml.kindImageWhenContains) ? 'image' : 'chat';
    }
    return { id, name, free, kind };
  }).filter((m) => m.id);
}

module.exports = { arToSize, arToWH, buildValues, substitute, fillPath, substitutePath, getByPath, readByPath, readResult, readMime, attachAuth, buildRequest, runRecipe, extFromMime, extFromUrl, normalizeModelList };
