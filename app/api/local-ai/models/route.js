import { NextResponse } from 'next/server';
import { getLocalEngines, listLocalModels } from '@/lib/local-ai-web';

export async function GET() {
  try {
    const [models, engines] = await Promise.all([
      listLocalModels(),
      getLocalEngines(),
    ]);
    return NextResponse.json({ models, engines });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
