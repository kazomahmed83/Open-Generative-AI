// tests/sdcppArgs.test.js
const test = require('node:test');
const assert = require('node:assert');
const { arToDimensions, buildSdCppArgs } = require('../lib/local-runtime/providers/sdcpp.js');

test('arToDimensions matches reference (sdxl/z-image base 1024, else 512)', () => {
  assert.deepStrictEqual(arToDimensions('1:1', 'sd1'), [512, 512]);
  assert.deepStrictEqual(arToDimensions('1:1', 'sdxl'), [1024, 1024]);
  assert.deepStrictEqual(arToDimensions('1:1', 'z-image'), [1024, 1024]);
  const [w, h] = arToDimensions('16:9', 'sd1');
  assert.strictEqual(h, 512);
  assert.strictEqual(w % 64, 0);
});

test('buildSdCppArgs builds correct flags for an sdxl model', () => {
  const model = { filename: 'sdxl.safetensors', type: 'sdxl', sampler: 'euler_a' };
  const args = buildSdCppArgs({
    model, modelsDir: '/m', outPath: '/out.png',
    params: { prompt: 'a cat', aspect_ratio: '1:1', steps: 12, guidance_scale: 6, seed: 42 },
  });
  assert.ok(args.includes('-m') && args.includes(require('path').join('/m', 'sdxl.safetensors')));
  assert.ok(args.includes('-p') && args.includes('a cat'));
  assert.ok(args.includes('--steps') && args.includes('12'));
  assert.ok(args.includes('--cfg-scale') && args.includes('6'));
  assert.ok(args.includes('--seed') && args.includes('42'));
  assert.ok(args.includes('--sd-version') && args.includes('sdxl'));
});

test('buildSdCppArgs uses --diffusion-model + --llm/--vae for z-image', () => {
  const model = { filename: 'z.gguf', type: 'z-image', scheduler: 'discrete' };
  const args = buildSdCppArgs({
    model, modelsDir: '/m', outPath: '/o.png', llmPath: '/m/llm.gguf', vaePath: '/m/ae.safetensors',
    params: { prompt: 'x', aspect_ratio: '1:1', seed: 1 },
  });
  assert.ok(args.includes('--diffusion-model'));
  assert.ok(args.includes('--llm') && args.includes('/m/llm.gguf'));
  assert.ok(args.includes('--vae') && args.includes('/m/ae.safetensors'));
  assert.ok(args.includes('--scheduler') && args.includes('discrete'));
});

test('buildSdCppArgs honors an explicit seed of 0', () => {
  const args = buildSdCppArgs({
    model: { filename: 'm.safetensors', type: 'sd1' }, modelsDir: '/m', outPath: '/o.png',
    params: { prompt: 'x', aspect_ratio: '1:1', seed: 0 },
  });
  const i = args.indexOf('--seed');
  assert.strictEqual(args[i + 1], '0');
});
