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

module.exports = { arToSize, arToWH, buildValues, substitute, fillPath };
