// app/api/local-ai/providers/route.js
import { listProvidersSafe, getProvider, upsertProvider, deleteProvider } from '../../../../lib/local-runtime/config.js';
export const runtime = 'nodejs';

export async function GET() {
  return Response.json({ providers: listProvidersSafe() });
}

export async function POST(req) {
  const body = await req.json();
  const p = body?.provider;
  if (!p || !p.id || !p.name || !p.baseUrl || !p.kind) {
    return Response.json({ error: 'invalid provider (id, name, baseUrl, kind required)' }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(p.baseUrl)) {
    return Response.json({ error: 'baseUrl must be http(s)' }, { status: 400 });
  }
  // Validate any supplied recipe JSON server-side (shape + required fields), so a
  // non-UI caller cannot persist a malformed recipe that only fails at generate time.
  const badRecipe = (s) => {
    if (s == null || s === '') return false; // absent = inherit the default recipe
    let o;
    try { o = typeof s === 'string' ? JSON.parse(s) : s; } catch { return true; }
    if (!o || !o.kind || !o.path || !o.resultType) return true;
    // GET recipes carry params in the URL (no body); binary results are the raw response (no resultPath).
    if ((o.method || 'POST').toUpperCase() !== 'GET' && !o.body) return true;
    if (o.resultType !== 'binary' && !o.resultPath) return true;
    return false;
  };
  if (badRecipe(p.imageRecipe) || badRecipe(p.chatRecipe)) {
    return Response.json({ error: 'invalid recipe JSON (need kind, path, body, resultPath, resultType)' }, { status: 400 });
  }
  // Preserve existing key if the edit POST omits it.
  const existing = getProvider(p.id);
  const apiKey = p.apiKey && p.apiKey.length ? p.apiKey : (existing?.apiKey || '');
  const provider = {
    id: p.id, name: p.name, kind: p.kind, baseUrl: p.baseUrl, apiKey,
    models: Array.isArray(p.models) ? p.models : [],
  };
  // Forward optional recipe / auth fields when present.
  for (const k of ['authStyle', 'authHeader', 'headers', 'imageRecipe', 'chatRecipe', 'modelsList']) {
    if (p[k] != null) provider[k] = p[k];
  }
  upsertProvider(provider);
  return Response.json({ ok: true, providers: listProvidersSafe() });
}

export async function DELETE(req) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
  deleteProvider(id);
  return Response.json({ ok: true, providers: listProvidersSafe() });
}
