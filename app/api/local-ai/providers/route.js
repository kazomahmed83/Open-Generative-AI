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
  // Preserve existing key if the edit POST omits it.
  const existing = getProvider(p.id);
  const apiKey = p.apiKey && p.apiKey.length ? p.apiKey : (existing?.apiKey || '');
  upsertProvider({
    id: p.id, name: p.name, kind: p.kind, baseUrl: p.baseUrl, apiKey,
    models: Array.isArray(p.models) ? p.models : [],
  });
  return Response.json({ ok: true, providers: listProvidersSafe() });
}

export async function DELETE(req) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
  deleteProvider(id);
  return Response.json({ ok: true, providers: listProvidersSafe() });
}
