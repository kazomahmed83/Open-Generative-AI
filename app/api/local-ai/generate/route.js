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

  // Bridge client-disconnect to an AbortController so an abandoned generation kills its
  // sd-cli child instead of orphaning it (a stuck 1024² run can squat on ~7 GB of RAM).
  // Two triggers: the request's own signal, and the ReadableStream cancel() callback that
  // the runtime fires when the SSE client goes away — the reliable hook for streamed responses.
  const ac = new AbortController();
  const abort = () => { try { ac.abort(); } catch {} };
  if (req.signal) {
    if (req.signal.aborted) abort();
    else req.signal.addEventListener('abort', abort, { once: true });
  }

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
          { signal: ac.signal },
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
    // Fired when the client disconnects mid-stream — abort so sd-cli is killed, not orphaned.
    cancel() { abort(); },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
