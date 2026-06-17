// lib/local-runtime/providers/sdcpp.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { getPaths } = require('../paths.js');
const { checkMemory } = require('../memory.js');
const { detectGpu, isGpuBuild } = require('../gpu.js');
const {
  resolveGenerationSteps, resolveGuidanceScale, parseGenerationProgressChunk,
} = require('../../../electron/lib/localInferenceRuntime.js');
const { ZIMAGE_AUXILIARY } = require('../../../electron/lib/modelCatalog.js');

function resolveSeed(seed) {
  return seed != null && seed !== -1 ? seed : Math.floor(Math.random() * 2147483647);
}

// Ported from electron/lib/localInference.js:407-417, plus an optional base override so the UI
// can lower a heavy model's resolution (fits RAM + runs faster — compute scales with W*H).
function arToDimensions(ar, modelType, baseOverride) {
  const base = (baseOverride && baseOverride > 0)
    ? baseOverride
    : ((modelType === 'sdxl' || modelType === 'z-image') ? 1024 : 512);
  const map = {
    '1:1': [base, base],
    '16:9': [Math.round(base * 16 / 9 / 64) * 64, base],
    '9:16': [base, Math.round(base * 16 / 9 / 64) * 64],
    '4:3': [Math.round(base * 4 / 3 / 64) * 64, base],
    '3:4': [base, Math.round(base * 4 / 3 / 64) * 64],
  };
  return map[ar] || [base, base];
}

// Some catalog entries use legacy sampler names (e.g. 'dpmpp2m'); this sd.cpp build expects
// the '++' forms (e.g. 'dpm++2m') and exits with "invalid sample method" otherwise.
const SAMPLER_ALIASES = { dpmpp2m: 'dpm++2m', dpmpp2mv2: 'dpm++2mv2', dpmpp2s_a: 'dpm++2s_a' };
function normalizeSampler(s) { return SAMPLER_ALIASES[s] || s || 'euler_a'; }

// Build the platform-specific "kill the whole process tree" command. On Windows, Node's
// proc.kill() only signals the direct child, so a stuck sd-cli can stay resident holding
// gigabytes of RAM (the orphan we hunted down). taskkill /T kills the tree, /F forces it.
function killSpec(pid, platform = process.platform) {
  if (platform === 'win32') return { cmd: 'taskkill', args: ['/PID', String(pid), '/T', '/F'] };
  return null;
}

// Terminate a spawned sd-cli (and any children) reliably across platforms.
function killProcessTree(proc) {
  if (!proc || proc.pid == null) return;
  const spec = killSpec(proc.pid);
  if (spec) { try { spawn(spec.cmd, spec.args, { stdio: 'ignore' }); } catch {} }
  try { proc.kill('SIGTERM'); } catch {}
}

// Pure: build the sd-cli argv. Mirrors electron/lib/localInference.js:439-482.
function buildSdCppArgs({ model, params, modelsDir, outPath, llmPath, vaePath }) {
  const [width, height] = arToDimensions(params.aspect_ratio || '1:1', model.type, params.resolution);
  const seed = resolveSeed(params.seed);
  const steps = resolveGenerationSteps(params, model);
  const cfgScale = resolveGuidanceScale(params, model);
  const sampler = normalizeSampler(model.sampler);
  const modelFlag = (model.type === 'z-image' || model.type === 'flux') ? '--diffusion-model' : '-m';

  const args = [
    modelFlag, path.join(modelsDir, model.filename),
    '-p', params.prompt || '',
    '-o', outPath,
    '--steps', String(steps),
    '-H', String(height),
    '-W', String(width),
    '--cfg-scale', String(cfgScale),
    '--seed', String(seed),
    '--sampling-method', sampler,
    '-v',
    '--mmap', // memory-map weights: avoids the slow upfront read, big startup win for large local models
  ];
  if (params.negative_prompt) args.push('-n', params.negative_prompt);

  if (model.type === 'z-image') {
    args.push('--llm', llmPath, '--vae', vaePath);
    if (model.scheduler) args.push('--scheduler', model.scheduler);
  }
  // Newer sd.cpp (commit 5a34bc7) auto-detects the architecture from the model weights and
  // rejects the legacy --sd-version / --flux flags, so SD1.5 / SDXL / SD2 / FLUX need no hint.
  return args;
}

// generate(): spawns sd-cli, streams progress via onProgress, returns { buffer, ext, seed }.
// Ported from electron/lib/localInference.js:419-562 (mainWindow IPC -> onProgress callback).
async function generate({ model, params }, onProgress = () => {}, { signal } = {}) {
  const { binDir, modelsDir, tmpDir, binaryPath } = getPaths();
  if (!fs.existsSync(binaryPath)) throw new Error('sd.cpp binary not installed. Download it in Settings > Local Models.');
  if (!fs.existsSync(path.join(modelsDir, model.filename))) {
    throw new Error(`Model file not found. Download "${model.name || model.filename}" in Settings > Local Models.`);
  }

  let llmPath, vaePath;
  if (model.requiresAuxiliary || model.type === 'z-image') {
    llmPath = path.join(modelsDir, ZIMAGE_AUXILIARY.llm.filename);
    vaePath = path.join(modelsDir, ZIMAGE_AUXILIARY.vae.filename);
    if (!fs.existsSync(llmPath)) throw new Error('Text encoder (Qwen3-4B) not downloaded for Z-Image.');
    if (!fs.existsSync(vaePath)) throw new Error('VAE (ae.safetensors) not downloaded for Z-Image.');
  }

  // Pre-flight memory check. On a CUDA build the compute buffer lives in dedicated VRAM, so we
  // gate on free VRAM; on a CPU build it's contiguous system RAM (contended), so we gate on that.
  // Either way: fail in <1s with a clear message instead of thrashing/OOM-crashing.
  const gpu = isGpuBuild(binDir) ? detectGpu() : null;
  const [pfWidth, pfHeight] = arToDimensions(params.aspect_ratio || '1:1', model.type, params.resolution);
  const mem = checkMemory({
    model, width: pfWidth, height: pfHeight,
    freeBytes: gpu ? gpu.freeVramBytes : os.freemem(),
    device: gpu ? 'gpu' : 'cpu',
  });
  if (!mem.ok) throw new Error(mem.message);

  fs.mkdirSync(tmpDir, { recursive: true });
  const outPath = path.join(tmpDir, `gen-${process.hrtime.bigint()}.png`);
  const seed = resolveSeed(params.seed);
  const args = buildSdCppArgs({ model, params: { ...params, seed }, modelsDir, outPath, llmPath, vaePath });
  // On the CUDA build, enable flash attention: faster and lower VRAM for the diffusion model.
  if (gpu) args.push('--diffusion-fa');

  return await new Promise((resolve, reject) => {
    // Put binDir first on PATH so Windows resolves the bundled CUDA runtime DLLs (cudart/cublas)
    // that sit next to sd-cli.exe, alongside the *nix loader-path vars.
    const env = {
      ...process.env,
      DYLD_LIBRARY_PATH: binDir,
      LD_LIBRARY_PATH: binDir,
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
    };
    const proc = spawn(binaryPath, args, { env });

    const cleanupTmp = () => { try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch {} };
    const onAbort = () => { killProcessTree(proc); cleanupTmp(); reject(new Error('Generation cancelled')); };
    if (signal) {
      if (signal.aborted) { killProcessTree(proc); cleanupTmp(); return reject(new Error('Generation cancelled')); }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    const detach = () => { if (signal) signal.removeEventListener('abort', onAbort); };

    const state = { tail: '', lastStep: 0, lastTotalSteps: 0 };
    const lines = [];
    const MAX_TAIL = 40;
    const onData = (d) => {
      const line = d.toString();
      lines.push(line.trimEnd());
      if (lines.length > MAX_TAIL) lines.splice(0, lines.length - MAX_TAIL);
      for (const evt of parseGenerationProgressChunk(line, state)) onProgress({ ...evt, status: 'generating' });
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (err) => { detach(); cleanupTmp(); reject(err); });
    proc.on('close', (code) => {
      detach();
      if (code !== 0) { cleanupTmp(); return reject(new Error(`sd-cli exited (code ${code}):\n${lines.slice(-20).join('\n')}`)); }
      if (!fs.existsSync(outPath)) return reject(new Error('sd.cpp finished but no output image found'));
      try {
        const buffer = fs.readFileSync(outPath);
        cleanupTmp();
        resolve({ buffer, ext: 'png', seed });
      } catch (e) { cleanupTmp(); reject(e); }
    });
  });
}

module.exports = { resolveSeed, arToDimensions, buildSdCppArgs, normalizeSampler, killSpec, generate };
