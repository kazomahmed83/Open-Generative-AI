// lib/local-runtime/providers/api.js
// Generic OpenAI-compatible API provider (bring-your-own-key). NOT MuAPI.
// Pure request builders are unit-tested; generate() performs the HTTP call.

function normBase(baseUrl) { return String(baseUrl || '').replace(/\/+$/, ''); }

function arToSize(ar) {
  const map = { '1:1': '1024x1024', '16:9': '1792x1024', '9:16': '1024x1792', '4:3': '1024x768', '3:4': '768x1024' };
  return map[ar] || '1024x1024';
}

function buildImageRequest(provider, apiModelId, params) {
  return {
    url: `${normBase(provider.baseUrl)}/v1/images/generations`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
    body: { model: apiModelId, prompt: params.prompt || '', n: 1, size: arToSize(params.aspect_ratio), response_format: 'b64_json' },
  };
}

function buildChatRequest(provider, apiModelId, params) {
  return {
    url: `${normBase(provider.baseUrl)}/v1/chat/completions`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
    body: { model: apiModelId, messages: params.messages || [{ role: 'user', content: params.prompt || '' }] },
  };
}

// generate() is called by the registry as:
//   apiProvider.generate({ provider, apiModelId, kind }, params, onProgress, { signal })
// Image -> { buffer, ext, seed } (always returns bytes so the route can saveAsset uniformly).
// Chat  -> { text }.
async function generate({ provider, apiModelId, kind }, params, onProgress = () => {}, opts = {}) {
  onProgress({ step: 1, totalSteps: 1, progress: 1, status: 'requesting' });
  if (kind === 'image') {
    const { url, headers, body } = buildImageRequest(provider, apiModelId, params);
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: opts.signal });
    if (!res.ok) throw new Error(`API image request failed (${res.status})`);
    const data = await res.json();
    const item = (data.data && data.data[0]) || {};
    if (item.b64_json) return { buffer: Buffer.from(item.b64_json, 'base64'), ext: 'png', seed: params.seed };
    if (item.url) {
      // Some providers return a URL — fetch the bytes so all assets are served locally.
      const imgRes = await fetch(item.url, { signal: opts.signal });
      if (!imgRes.ok) throw new Error(`API image download failed (${imgRes.status})`);
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      return { buffer, ext: 'png', seed: params.seed };
    }
    throw new Error('API returned no image');
  }
  if (kind === 'chat') {
    const { url, headers, body } = buildChatRequest(provider, apiModelId, params);
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: opts.signal });
    if (!res.ok) throw new Error(`API chat request failed (${res.status})`);
    const data = await res.json();
    return { text: data.choices?.[0]?.message?.content || '' };
  }
  throw new Error(`Unsupported api kind: ${kind}`);
}

module.exports = { arToSize, buildImageRequest, buildChatRequest, generate };
