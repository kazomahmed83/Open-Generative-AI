// app/api/assets/[key]/route.js
import fs from 'fs';
import { getAssetPath } from '../../../../lib/local-runtime/storage.js';

export const runtime = 'nodejs';

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav' };

export async function GET(_req, { params }) {
  const { key } = await params; // Next.js 15: params is a Promise
  let filePath;
  try { filePath = getAssetPath(key); } catch { return new Response('Bad key', { status: 400 }); }
  if (!fs.existsSync(filePath)) return new Response('Not found', { status: 404 });
  const ext = key.split('.').pop().toLowerCase();
  return new Response(fs.readFileSync(filePath), {
    headers: { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
}
