import os from 'os';
import { NextResponse } from 'next/server';
import { getLocalEngines, listLocalModels } from '@/lib/local-ai-web';
import { getPaths } from '@/lib/local-runtime/paths.js';
import { detectGpu, isGpuBuild } from '@/lib/local-runtime/gpu.js';

export async function GET() {
  try {
    const [models, engines] = await Promise.all([
      listLocalModels(),
      getLocalEngines(),
    ]);
    // On a CUDA build, generation runs in VRAM — report free VRAM so the UI auto-fits resolution
    // to the GPU's dedicated memory (not contended system RAM). CPU build: report free RAM.
    const gpu = isGpuBuild(getPaths().binDir) ? detectGpu() : null;
    return NextResponse.json({
      models, engines, gpu,
      freeMemBytes: gpu ? gpu.freeVramBytes : os.freemem(),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
