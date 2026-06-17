// app/api/local-ai/catalog/route.js
// Secret-free unified catalog (local sdcpp + configured API providers), source-tagged.
import { listCatalog } from '../../../../lib/local-runtime/catalog.js';

export const runtime = 'nodejs';

export async function GET() {
  return Response.json({ catalog: listCatalog() });
}
