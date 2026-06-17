// tests/binaryAsset.test.js
const test = require('node:test');
const assert = require('node:assert');
const { pickBinaryAssetForPlatform, pickCudartAssetForPlatform } = require('../electron/lib/localInferenceAssets.js');

// Real asset names from leejet/stable-diffusion.cpp release master-709.
const WIN_ZIPS = [
  'sd-master-92a3b73-bin-win-avx2-x64.zip',
  'sd-master-92a3b73-bin-win-avx512-x64.zip',
  'sd-master-92a3b73-bin-win-noavx-x64.zip',
  'sd-master-92a3b73-bin-win-cuda12-x64.zip',
  'cudart-sd-bin-win-cu12-x64.zip', // self-contained CUDA build (bundles the runtime)
  'sd-master-92a3b73-bin-win-vulkan-x64.zip',
];

test('win32 + GPU: picks the cuda12 BINARY, not the runtime-only cudart bundle', () => {
  // The cudart bundle ships only the CUDA runtime DLLs (no sd-cli.exe), so the *binary* must be
  // the cuda12 build; the runtime is fetched separately (pickCudartAssetForPlatform).
  const pick = pickBinaryAssetForPlatform({ platform: 'win32', arch: 'x64', zipNames: WIN_ZIPS, gpu: true });
  assert.strictEqual(pick, 'sd-master-92a3b73-bin-win-cuda12-x64.zip');
});

test('pickCudartAssetForPlatform finds the CUDA runtime bundle on win32', () => {
  assert.strictEqual(pickCudartAssetForPlatform({ platform: 'win32', zipNames: WIN_ZIPS }), 'cudart-sd-bin-win-cu12-x64.zip');
});

test('pickCudartAssetForPlatform returns null when absent or non-Windows', () => {
  assert.strictEqual(pickCudartAssetForPlatform({ platform: 'win32', zipNames: ['sd-master-x-bin-win-avx2-x64.zip'] }), null);
  assert.strictEqual(pickCudartAssetForPlatform({ platform: 'linux', zipNames: WIN_ZIPS }), null);
});

test('win32 + GPU but only the plain cuda build present: still picks CUDA over CPU', () => {
  const zips = ['sd-master-x-bin-win-avx2-x64.zip', 'sd-master-x-bin-win-cuda12-x64.zip'];
  const pick = pickBinaryAssetForPlatform({ platform: 'win32', arch: 'x64', zipNames: zips, gpu: true });
  assert.strictEqual(pick, 'sd-master-x-bin-win-cuda12-x64.zip');
});

test('win32 + no GPU: picks a CPU build and never a CUDA build', () => {
  const pick = pickBinaryAssetForPlatform({ platform: 'win32', arch: 'x64', zipNames: WIN_ZIPS, gpu: false });
  assert.strictEqual(pick, 'sd-master-92a3b73-bin-win-avx2-x64.zip');
});

test('win32 default (no gpu flag) stays CPU-first for backward compatibility', () => {
  const pick = pickBinaryAssetForPlatform({ platform: 'win32', arch: 'x64', zipNames: WIN_ZIPS });
  assert.strictEqual(pick, 'sd-master-92a3b73-bin-win-avx2-x64.zip');
});
