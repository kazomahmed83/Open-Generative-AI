import { NextResponse } from 'next/server';
import { downloadLocalEngine } from '@/lib/local-ai-web';

export async function POST() {
  try {
    return NextResponse.json(await downloadLocalEngine());
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
