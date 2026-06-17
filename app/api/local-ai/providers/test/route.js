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
    if (!/^https?:\/\//i.test(String(provider.baseUrl || ''))) {
      return Response.json({ ok: false, error: 'baseUrl must be http(s)' }, { status: 400 });
    }
    // No hard apiKey precondition: keyless OpenAI-compatible local servers (LM Studio, vLLM)
    // are supported. Let runRecipe attempt the call and surface the real upstream result.
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
