// lib/local-runtime/memory.js
//
// Pre-flight memory estimation for local (sd.cpp) image generation.
//
// Heavy 1024² diffusion models allocate a large *contiguous physical* compute buffer that
// can't be memory-mapped. When free RAM is short, sd.cpp either fails instantly
// ("failed to allocate buffer") or spills to the pagefile and crawls (~minutes per step).
// Rather than let a user wait 15 minutes for an out-of-memory crash, we estimate the peak
// requirement up front and fail fast with a clear, actionable message.
//
// Anchors are empirical, measured live on this build (sd.cpp commit 5a34bc7):
//   Z-Image Turbo @ 1024²  ->  compute buffer 7,065,409,632 B (~6.6 GiB)
//                              + resident weights: Qwen3-4B 1483 MiB + z_image 3685 MiB (~5 GiB)
//                              => ~12 GiB peak.
// SDXL / SD1.5 are estimated from their relative model sizes; precision isn't required —
// the gate only needs to catch "you don't have enough".

const HEAVY_TYPES = ['z-image', 'sdxl', 'flux'];

// Resident model weights during a forward pass, in bytes, keyed by sd.cpp model type.
const WEIGHTS_BYTES = {
  'z-image': 5.4e9, // Qwen3-4B text encoder + z_image DiT (both resident while sampling)
  sdxl: 4.5e9,
  flux: 7.0e9,
  sd1: 2.0e9,
  sd2: 2.0e9,
};

// Compute-buffer cost per output pixel, in bytes (scales ~linearly with W*H).
// z-image anchored to the observed 7.065e9 / (1024*1024) ≈ 6738 B/px.
const PER_PIXEL_BYTES = {
  'z-image': 6740,
  sdxl: 2600,
  flux: 5000,
  sd1: 1500,
  sd2: 1500,
};

function modelType(model) {
  return (model && (model.type || (model.raw && model.raw.type))) || null;
}

// True for the 1024-class models whose compute buffer is large enough to risk OOM on a
// memory-constrained machine — used to gate the pre-flight check and to flag them in the UI.
function isHeavyModel(model) {
  return HEAVY_TYPES.includes(modelType(model));
}

// Estimated peak resident memory (bytes) for one generation at the given output size.
function estimatePeakBytes(model, { width, height }) {
  const t = modelType(model);
  const weights = WEIGHTS_BYTES[t] != null ? WEIGHTS_BYTES[t] : 2.0e9;
  const perPixel = PER_PIXEL_BYTES[t] != null ? PER_PIXEL_BYTES[t] : 1500;
  return weights + perPixel * (width || 512) * (height || 512);
}

const toGiB = (b) => (b / 1024 ** 3).toFixed(1);

// Decide whether a generation can run in available memory. Pure: callers pass the live free
// reading — system RAM (os.freemem()) on a CPU build, or free VRAM (nvidia-smi) on a GPU build —
// plus the device, so this stays deterministic and testable.
function checkMemory({ model, width, height, freeBytes, device }) {
  const neededBytes = estimatePeakBytes(model, { width, height });
  const ok = freeBytes >= neededBytes;
  const name = (model && model.name) || modelType(model) || 'this model';
  const mem = device === 'gpu' ? 'VRAM' : 'RAM';
  const advice = device === 'gpu'
    ? 'Lower the Resolution, or close other GPU apps.'
    : 'Lower the Resolution, close some apps, or use a lighter model (SD 1.5, or a cloud model like Pollinations/OpenAI).';
  const message = ok
    ? null
    : `Not enough free ${mem} for ${name}: needs ~${toGiB(neededBytes)} GB at ${width}×${height}, ` +
      `but only ~${toGiB(freeBytes)} GB is free. ${advice}`;
  return { ok, neededBytes, freeBytes, message };
}

module.exports = { isHeavyModel, estimatePeakBytes, checkMemory };
