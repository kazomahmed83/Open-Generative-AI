import { NextResponse } from 'next/server';
import { getLocalAiStatus } from '@/lib/local-ai-web';

export async function GET() {
  try {
    return NextResponse.json(getLocalAiStatus());
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
