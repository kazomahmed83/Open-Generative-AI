// app/api/local-ai/providers/test/route.js
import { resolveRecipe } from '../../../../../lib/local-runtime/providers/api.js';
import * as eng from '../../../../../lib/local-runtime/providers/recipe-engine.js';
import { getProvider } from '../../../../../lib/local-runtime/config.js';
export const runtime = 'nodejs';

// Body: { providerId?, provider?, apiModelId, kind }
// Cost-safe: image providers are verified with a FREE models-list GET (auth + connectivity)
// instead of generating a real image — on paid models (e.g. gpt-image-1) a test generation
// costs real money. Chat is verified with a tiny prompt, which is effectively free.
export async function POST(req) {
  try {
    const { providerId, provider: draft, apiModelId, kind } = await req.json();
    const provider = providerId ? getProvider(providerId) : draft;
    if (!provider) return Response.json({ ok: false, error: 'provider not found' }, { status: 400 });
    if (!/^https?:\/\//i.test(String(provider.baseUrl || ''))) {
      return Response.json({ ok: false, error: 'baseUrl must be http(s)' }, { status: 400 });
    }

    if (kind === 'image') {
      // Prefer the provider's models-list (free GET); most OpenAI-compatible image APIs
      // expose /v1/models. This validates the key + base URL without paying to generate.
      const ml = (provider.modelsList && provider.modelsList.path) ? provider.modelsList : { path: '/v1/models', auth: true };
      const url = String(provider.baseUrl).replace(/\/+$/, '') + eng.fillPath(ml.path, { apiKey: provider.apiKey });
      const headers = {};
      if (ml.auth !== false) eng.attachAuth(headers, provider.authStyle, provider.authHeader, provider.apiKey);
      let res;
      try {
        res = await fetch(url, { headers, signal: req.signal });
      } catch (e) {
        return Response.json({ ok: false, error: String(e.message || e).slice(0, 120) }, { status: 200 });
      }
      if (res.ok) return Response.json({ ok: true, note: 'key OK (no image generated)' }, { status: 200 });
      if (res.status === 401 || res.status === 403) {
        return Response.json({ ok: false, error: `key rejected (${res.status})` }, { status: 200 });
      }
      // No free test endpoint here — saved, but we won't spend money to verify it.
      return Response.json({ ok: true, note: `saved; not test-generated (HTTP ${res.status})` }, { status: 200 });
    }

    // Chat: a tiny prompt is effectively free.
    const recipe = resolveRecipe(provider, kind);
    await eng.runRecipe(recipe, provider, apiModelId, { prompt: 'ping' }, {});
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: String(e.message || e).slice(0, 200) }, { status: 200 });
  }
}
