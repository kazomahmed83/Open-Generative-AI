// app/api/local-ai/upload/route.js
import { saveAsset } from '../../../../lib/local-runtime/storage.js';
export const runtime = 'nodejs';

export async function POST(req) {
  const form = await req.formData();
  const file = form.get('file');
  if (!file) return Response.json({ error: 'no file' }, { status: 400 });
  const buffer = Buffer.from(await file.arrayBuffer());
  // Whitelist upload extensions; anything else falls back to png (saveAsset also sanitizes).
  const ALLOWED = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm', 'mov', 'mp3', 'wav', 'ogg']);
  const raw = (file.name?.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const ext = ALLOWED.has(raw) ? raw : 'png';
  const { url } = saveAsset(buffer, ext);
  return Response.json({ url });
}
