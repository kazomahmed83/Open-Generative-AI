// app/api/local-ai/generate/route.js
import { resolveProvider } from '../../../../lib/local-runtime/providers/index.js';
import { saveAsset } from '../../../../lib/local-runtime/storage.js';

export const runtime = 'nodejs';
export const maxDuration = 600;

export async function POST(req) {
  const body = await req.json();
  const { model, ...params } = body || {};
  let provider;
  try { provider = resolveProvider(model); } catch (e) { return Response.json({ error: e.message }, { status: 400 }); }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); }
        catch { closed = true; }
      };
      try {
        const { buffer, ext, seed } = await provider.generate(
          params,
          (evt) => send({ type: 'progress', ...evt }),
          { signal: req.signal },
        );
        const asset = saveAsset(buffer, ext);
        send({ type: 'result', url: asset.url, key: asset.key, seed, model });
      } catch (e) {
        send({ type: 'error', error: String(e?.message || e) });
      } finally {
        send({ type: 'end' });
        try { controller.close(); } catch {}
        closed = true;
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
