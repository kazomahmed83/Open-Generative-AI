// lib/local-runtime/providers/sdcpp.js
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getPaths } = require('../paths.js');
const {
  resolveGenerationSteps, resolveGuidanceScale, parseGenerationProgressChunk,
} = require('../../../electron/lib/localInferenceRuntime.js');
const { ZIMAGE_AUXILIARY } = require('../../../electron/lib/modelCatalog.js');

// Ported verbatim from electron/lib/localInference.js:407-417
function arToDimensions(ar, modelType) {
  const base = (modelType === 'sdxl' || modelType === 'z-image') ? 1024 : 512;
  const map = {
    '1:1': [base, base],
    '16:9': [Math.round(base * 16 / 9 / 64) * 64, base],
    '9:16': [base, Math.round(base * 16 / 9 / 64) * 64],
    '4:3': [Math.round(base * 4 / 3 / 64) * 64, base],
    '3:4': [base, Math.round(base * 4 / 3 / 64) * 64],
  };
  return map[ar] || [base, base];
}

// Pure: build the sd-cli argv. Mirrors electron/lib/localInference.js:439-482.
function buildSdCppArgs({ model, params, modelsDir, outPath, llmPath, vaePath }) {
  const [width, height] = arToDimensions(params.aspect_ratio || '1:1', model.type);
  const seed = params.seed && params.seed !== -1 ? params.seed : Math.floor(Math.random() * 2147483647);
  const steps = resolveGenerationSteps(params, model);
  const cfgScale = resolveGuidanceScale(params, model);
  const sampler = model.sampler || 'euler_a';
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
  ];
  if (params.negative_prompt) args.push('-n', params.negative_prompt);

  if (model.type === 'z-image') {
    args.push('--llm', llmPath, '--vae', vaePath);
    if (model.scheduler) args.push('--scheduler', model.scheduler);
  } else if (model.type === 'sdxl') {
    args.push('--sd-version', 'sdxl');
  } else if (model.type === 'sd2') {
    args.push('--sd-version', 'sd2');
  } else if (model.type === 'flux') {
    args.push('--flux');
  }
  return args;
}

// generate(): spawns sd-cli, streams progress via onProgress, returns { buffer, ext, seed }.
// Ported from electron/lib/localInference.js:419-562 (mainWindow IPC -> onProgress callback).
async function generate({ model, params }, onProgress = () => {}) {
  const { binDir, modelsDir, tmpDir, binaryPath } = getPaths();
  if (!fs.existsSync(binaryPath)) throw new Error('sd.cpp binary not installed. Download it in Settings > Local Models.');
  if (!fs.existsSync(path.join(modelsDir, model.filename))) {
    throw new Error(`Model file not found. Download "${model.name}" in Settings > Local Models.`);
  }

  let llmPath, vaePath;
  if (model.requiresAuxiliary || model.type === 'z-image') {
    llmPath = path.join(modelsDir, ZIMAGE_AUXILIARY.llm.filename);
    vaePath = path.join(modelsDir, ZIMAGE_AUXILIARY.vae.filename);
    if (!fs.existsSync(llmPath)) throw new Error('Text encoder (Qwen3-4B) not downloaded for Z-Image.');
    if (!fs.existsSync(vaePath)) throw new Error('VAE (ae.safetensors) not downloaded for Z-Image.');
  }

  fs.mkdirSync(tmpDir, { recursive: true });
  const outPath = path.join(tmpDir, `gen-${process.hrtime.bigint()}.png`);
  const seed = params.seed && params.seed !== -1 ? params.seed : Math.floor(Math.random() * 2147483647);
  const args = buildSdCppArgs({ model, params: { ...params, seed }, modelsDir, outPath, llmPath, vaePath });

  return await new Promise((resolve, reject) => {
    const env = { ...process.env, DYLD_LIBRARY_PATH: binDir, LD_LIBRARY_PATH: binDir };
    const proc = spawn(binaryPath, args, { env });
    const state = { tail: '', lastStep: 0, lastTotalSteps: 0 };
    const lines = [];
    const onData = (d) => {
      const line = d.toString();
      lines.push(line.trimEnd());
      for (const evt of parseGenerationProgressChunk(line, state)) onProgress({ ...evt, status: 'generating' });
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`sd-cli exited (code ${code}):\n${lines.slice(-20).join('\n')}`));
      if (!fs.existsSync(outPath)) return reject(new Error('sd.cpp finished but no output image found'));
      try {
        const buffer = fs.readFileSync(outPath);
        fs.unlinkSync(outPath);
        resolve({ buffer, ext: 'png', seed });
      } catch (e) { reject(e); }
    });
  });
}

module.exports = { arToDimensions, buildSdCppArgs, generate };
