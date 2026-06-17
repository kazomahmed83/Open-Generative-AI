import { downloadRecipe, downloadLocalModel } from '@/lib/local-ai-web';
import { getRecipe } from '@/lib/local-runtime/catalog/recipes.js';

export async function POST(request) {
  const { modelId } = await request.json().catch(() => ({}));
  if (!modelId) return new Response(JSON.stringify({ error: 'Missing modelId' }), { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        if (getRecipe(modelId)) {
          await downloadRecipe(modelId, send);          // emits progress / needs-node / done
        } else {
          await downloadLocalModel(modelId);            // legacy sdcpp single-file
          send({ type: 'done', state: 'ready' });
        }
      } catch (e) {
        send({ type: 'error', error: e.message });
      } finally {
        send({ type: 'end' });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
