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
    // Honor the provider's auth style (not just Bearer); query auth carries the key in the path.
    const headers = {};
    if (ml.auth && provider.apiKey) eng.attachAuth(headers, provider.authStyle, provider.authHeader, provider.apiKey);
    const path = eng.fillPath(ml.path, { apiKey: provider.apiKey });
    const res = await fetch(base + path, { headers });
    if (!res.ok) return Response.json({ models: [], error: `list failed (${res.status})` }, { status: 200 });
    const raw = await res.json();
    // Generic-basic catalogs (no kindFromPath) default to the provider's kind per the spec.
    return Response.json({ models: eng.normalizeModelList(raw, { ...ml, defaultKind: ml.defaultKind || provider.kind || 'chat' }) });
  } catch (e) {
    return Response.json({ models: [], error: String(e.message || e).slice(0, 200) }, { status: 200 });
  }
}
