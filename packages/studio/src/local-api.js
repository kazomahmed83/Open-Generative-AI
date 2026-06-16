// packages/studio/src/local-api.js
// Local SDK mirroring the muapi.js surface used by the studios. Talks to /api/local-ai.
// CommonJS so it is unit-testable with node --test; imported by React via bundler interop.
const BASE = '/api/local-ai';

function parseSseResult(text) {
  let result = null;
  for (const block of text.split('\n\n')) {
    const line = block.split('\n').find((l) => l.startsWith('data: '));
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line.slice(6)); } catch { continue; }
    if (obj.type === 'result') result = { url: obj.url, seed: obj.seed };
    if (obj.type === 'error') throw new Error(obj.error);
  }
  return result;
}

async function streamGenerate(payload, onProgress) {
  const res = await fetch(`${BASE}/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!res.ok || !res.body) throw new Error(`Local generation failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', result = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n'); buf = parts.pop();
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const obj = JSON.parse(line.slice(6));
      if (obj.type === 'progress') onProgress && onProgress(obj);
      if (obj.type === 'result') result = { url: obj.url, seed: obj.seed };
      if (obj.type === 'error') throw new Error(obj.error);
    }
  }
  if (!result) throw new Error('Local generation produced no image');
  return result;
}

async function generateImage(modelId, params, onProgress) {
  return streamGenerate({ model: modelId, ...params }, onProgress);
}
async function generateI2I(modelId, params, onProgress) {
  return streamGenerate({ model: modelId, ...params }, onProgress);
}
async function uploadFile(file) {
  const fd = new FormData(); fd.append('file', file);
  const res = await fetch(`${BASE}/upload`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error('Local upload failed');
  return res.json(); // { url }
}

module.exports = { parseSseResult, streamGenerate, generateImage, generateI2I, uploadFile };
