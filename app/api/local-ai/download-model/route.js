import { NextResponse } from 'next/server';
import { downloadLocalModel } from '@/lib/local-ai-web';

export async function POST(request) {
  try {
    const { modelId } = await request.json();
    if (!modelId) {
      return NextResponse.json({ error: 'Missing modelId' }, { status: 400 });
    }
    return NextResponse.json(await downloadLocalModel(modelId));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
