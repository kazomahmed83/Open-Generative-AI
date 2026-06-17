// lib/local-runtime/gpu.js
//
// GPU detection for local inference. When an NVIDIA CUDA build of sd.cpp is installed, the
// heavy compute buffer lives in VRAM (dedicated) instead of system RAM (contended), so the
// memory pre-flight must gate on VRAM and the binary downloader must prefer the CUDA asset.
const fs = require('fs');
const { execFileSync } = require('child_process');

// Parse `nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader,nounits`.
// Pure: takes raw stdout, returns a structured descriptor (or null if unparseable). The first
// GPU line wins (primary device).
function parseNvidiaSmi(output) {
  const line = String(output || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
  if (!line) return null;
  const parts = line.split(',').map((s) => s.trim());
  if (parts.length < 3) return null;
  const totalMiB = parseInt(parts[1], 10);
  const freeMiB = parseInt(parts[2], 10);
  if (!Number.isFinite(totalMiB) || !Number.isFinite(freeMiB)) return null;
  return {
    vendor: 'nvidia',
    name: parts[0],
    totalVramBytes: totalMiB * 1024 * 1024,
    freeVramBytes: freeMiB * 1024 * 1024,
  };
}

// Run nvidia-smi and return the GPU descriptor, or null if there's no NVIDIA GPU / the tool
// is missing. Never throws.
function detectGpu() {
  try {
    const out = execFileSync(
      'nvidia-smi',
      ['--query-gpu=name,memory.total,memory.free', '--format=csv,noheader,nounits'],
      { encoding: 'utf8', timeout: 4000 },
    );
    return parseNvidiaSmi(out);
  } catch {
    return null;
  }
}

// Is the installed sd.cpp a GPU (CUDA) build? Detect by the CUDA runtime/backend DLLs that the
// cudart bundle drops next to the binary (cudart64_*.dll, cublas*.dll, ggml-cuda.dll, …).
function isGpuBuild(binDir) {
  try {
    return fs.readdirSync(binDir).some((f) => /cudart|cublas|cuda/i.test(f));
  } catch {
    return false;
  }
}

module.exports = { parseNvidiaSmi, detectGpu, isGpuBuild };
