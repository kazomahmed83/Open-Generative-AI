import { NextResponse } from 'next/server';
import { downloadLocalAuxiliary } from '@/lib/local-ai-web';

export async function POST(request) {
  try {
    const { auxKey } = await request.json();
    if (!auxKey) {
      return NextResponse.json({ error: 'Missing auxKey' }, { status: 400 });
    }
    return NextResponse.json(await downloadLocalAuxiliary(auxKey));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
