// app/api/local-ai/upload/route.js
import { saveAsset } from '../../../../lib/local-runtime/storage.js';
export const runtime = 'nodejs';

export async function POST(req) {
  const form = await req.formData();
  const file = form.get('file');
  if (!file) return Response.json({ error: 'no file' }, { status: 400 });
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = (file.name?.split('.').pop() || 'png').toLowerCase();
  const { url } = saveAsset(buffer, ext);
  return Response.json({ url });
}
