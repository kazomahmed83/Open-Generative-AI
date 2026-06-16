# M0 Foundation + M1 Image Studio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
> Context: see the master roadmap [`2026-06-16-local-first-platform-roadmap.md`](./2026-06-16-local-first-platform-roadmap.md).

**Goal:** Make the **live web** Image Studio generate images locally via stable-diffusion.cpp — a capability that currently exists only in Electron.

**Architecture:** Build a portable `lib/local-runtime/` (plain ESM Node, Electron-importable) that ports the working `electron/lib/localInference.js` `generate()` into a server-callable provider. A thin `POST /api/local-ai/generate` route streams progress via SSE and saves the PNG to `.local-ai/assets/`, served by `/api/assets/[key]`. A new `packages/studio/src/local-api.js` SDK (mirroring `muapi.js`) lets `ImageStudio.jsx` call local generation behind a Local/API toggle.

**Tech Stack:** Next.js 15 (App Router, `runtime='nodejs'`) · React 19 · Node 25 `node:test` · `child_process.spawn` · SSE · stable-diffusion.cpp (`sd-cli`).

**Reference source of truth (port from, do not reinvent):**
- `electron/lib/localInference.js` lines 406–562 (`arToDimensions`, `generate()`) — the spawn + args.
- `electron/lib/localInferenceRuntime.js` — `resolveGenerationSteps`, `resolveGuidanceScale`, `parseGenerationProgressChunk` (reuse via `require`).
- `electron/lib/modelCatalog.js` — `LOCAL_MODEL_CATALOG`, `ZIMAGE_AUXILIARY` (reuse via `require`).
- `electron/lib/localInferencePaths.js` — path convention.
- `src/components/ImageStudio.js` lines 39–44, 201–230, 1172–1237 — the toggle UX to port into the React component.

**Branch:** Create and work on `local-first-platform` off `main` before Task 1.

```bash
git checkout -b local-first-platform
```

---

# MILESTONE 0 — Foundation (headless runtime)

### Task 1: Wire up the test runner

**Files:**
- Modify: `package.json` (scripts block)

- [ ] **Step 1: Add the test script**

In `package.json` `"scripts"`, add:

```json
"test": "node --test tests/"
```

- [ ] **Step 2: Run the existing tests to verify the runner works**

Run: `npm test`
Expected: the 4 existing tests (`localInferenceAssets`, `localInferencePaths`, `localInferenceProgress`, `wan2gpModelAvailability`) PASS.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add node --test runner script"
```

---

### Task 2: `lib/local-runtime/paths.js` — single path resolver

**Files:**
- Create: `lib/local-runtime/paths.js`
- Test: `tests/localRuntimePaths.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/localRuntimePaths.test.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

test('getPaths honors OPEN_GENERATIVE_AI_LOCAL_AI_DIR and derives subdirs', async () => {
  const mod = await import('../lib/local-runtime/paths.js');
  const p = mod.getPaths({ OPEN_GENERATIVE_AI_LOCAL_AI_DIR: '/tmp/og-ai' });
  assert.strictEqual(p.dataDir, path.resolve('/tmp/og-ai'));
  assert.strictEqual(p.binDir, path.join(path.resolve('/tmp/og-ai'), 'bin'));
  assert.strictEqual(p.modelsDir, path.join(path.resolve('/tmp/og-ai'), 'models'));
  assert.strictEqual(p.assetsDir, path.join(path.resolve('/tmp/og-ai'), 'assets'));
  assert.ok(p.binaryPath.endsWith('sd-cli.exe') || p.binaryPath.endsWith('sd-cli'));
});

test('getPaths defaults to <cwd>/.local-ai when env unset', async () => {
  const mod = await import('../lib/local-runtime/paths.js');
  const p = mod.getPaths({});
  assert.strictEqual(p.dataDir, path.resolve(path.join(process.cwd(), '.local-ai')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/localRuntimePaths.test.js`
Expected: FAIL — cannot resolve `../lib/local-runtime/paths.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/local-runtime/paths.js
import path from 'path';

// MUST match lib/local-ai-web.js's DATA_DIR convention (<cwd>/.local-ai) so both see the same files.
export function getPaths(env = process.env) {
  const dataDir = path.resolve(env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR || path.join(process.cwd(), '.local-ai'));
  const binDir = path.join(dataDir, 'bin');
  const binaryName = process.platform === 'win32' ? 'sd-cli.exe' : 'sd-cli';
  return {
    dataDir,
    binDir,
    modelsDir: path.join(dataDir, 'models'),
    tmpDir: path.join(dataDir, 'tmp'),
    assetsDir: path.join(dataDir, 'assets'),
    binaryPath: path.join(binDir, binaryName),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/localRuntimePaths.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/local-runtime/paths.js tests/localRuntimePaths.test.js
git commit -m "feat(runtime): add portable path resolver"
```

---

### Task 3: `lib/local-runtime/catalog.js` — unified model catalog

**Files:**
- Create: `lib/local-runtime/catalog.js`
- Test: `tests/localRuntimeCatalog.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/localRuntimeCatalog.test.js
const test = require('node:test');
const assert = require('node:assert');

test('listCatalog returns normalized local image entries', async () => {
  const { listCatalog } = await import('../lib/local-runtime/catalog.js');
  const all = listCatalog();
  assert.ok(Array.isArray(all) && all.length > 0);
  const z = all.find(m => m.id === 'z-image-turbo');
  assert.ok(z, 'z-image-turbo present');
  assert.strictEqual(z.source, 'local');
  assert.strictEqual(z.provider, 'sdcpp');
  assert.strictEqual(z.kind, 'image');
  assert.ok(Array.isArray(z.aspectRatios));
});

test('getCatalogEntry resolves by id', async () => {
  const { getCatalogEntry } = await import('../lib/local-runtime/catalog.js');
  assert.strictEqual(getCatalogEntry('z-image-turbo').id, 'z-image-turbo');
  assert.strictEqual(getCatalogEntry('does-not-exist'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/localRuntimeCatalog.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/local-runtime/catalog.js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { LOCAL_MODEL_CATALOG } = require('../../electron/lib/modelCatalog.js');

// Normalize the electron sd.cpp catalog into unified provider-registry entries.
function normalizeSdcpp(m) {
  return {
    id: m.id,
    name: m.name,
    source: 'local',
    provider: 'sdcpp',
    kind: 'image',
    aspectRatios: m.aspectRatios || ['1:1', '16:9', '9:16', '4:3', '3:4'],
    defaultSteps: m.defaultSteps ?? 20,
    defaultGuidance: m.defaultGuidance ?? 7.5,
    requiresAuxiliary: !!m.requiresAuxiliary,
    raw: m, // keep the full electron entry for the provider (filename, type, sampler, scheduler)
  };
}

export function listCatalog() {
  return LOCAL_MODEL_CATALOG.map(normalizeSdcpp);
}

export function getCatalogEntry(id) {
  return listCatalog().find(m => m.id === id) || null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/localRuntimeCatalog.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/local-runtime/catalog.js tests/localRuntimeCatalog.test.js
git commit -m "feat(runtime): unified local model catalog"
```

---

### Task 4: `lib/local-runtime/providers/sdcpp.js` — port the sd.cpp generator

This ports `electron/lib/localInference.js` (406–562). Extract the **pure** arg-builder so it is unit-testable; keep `spawn` in `generate()`.

**Files:**
- Create: `lib/local-runtime/providers/sdcpp.js`
- Test: `tests/sdcppArgs.test.js`

- [ ] **Step 1: Write the failing test (pure arg builder + dimensions)**

```js
// tests/sdcppArgs.test.js
const test = require('node:test');
const assert = require('node:assert');

test('arToDimensions matches reference (sdxl/z-image base 1024, else 512)', async () => {
  const { arToDimensions } = await import('../lib/local-runtime/providers/sdcpp.js');
  assert.deepStrictEqual(arToDimensions('1:1', 'sd1'), [512, 512]);
  assert.deepStrictEqual(arToDimensions('1:1', 'sdxl'), [1024, 1024]);
  assert.deepStrictEqual(arToDimensions('1:1', 'z-image'), [1024, 1024]);
  const [w, h] = arToDimensions('16:9', 'sd1');
  assert.strictEqual(h, 512);
  assert.strictEqual(w % 64, 0);
});

test('buildSdCppArgs builds correct flags for an sdxl model', async () => {
  const { buildSdCppArgs } = await import('../lib/local-runtime/providers/sdcpp.js');
  const model = { filename: 'sdxl.safetensors', type: 'sdxl', sampler: 'euler_a' };
  const args = buildSdCppArgs({
    model, modelsDir: '/m', outPath: '/out.png',
    params: { prompt: 'a cat', aspect_ratio: '1:1', steps: 12, guidance_scale: 6, seed: 42 },
  });
  assert.ok(args.includes('-m') && args.includes('/m/sdxl.safetensors'));
  assert.ok(args.includes('-p') && args.includes('a cat'));
  assert.ok(args.includes('--steps') && args.includes('12'));
  assert.ok(args.includes('--cfg-scale') && args.includes('6'));
  assert.ok(args.includes('--seed') && args.includes('42'));
  assert.ok(args.includes('--sd-version') && args.includes('sdxl'));
});

test('buildSdCppArgs uses --diffusion-model + --llm/--vae for z-image', async () => {
  const { buildSdCppArgs } = await import('../lib/local-runtime/providers/sdcpp.js');
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sdcppArgs.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation** (port from `localInference.js`; flags must mirror lines 449–482 exactly)

```js
// lib/local-runtime/providers/sdcpp.js
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { getPaths } from '../paths.js';

const require = createRequire(import.meta.url);
const { resolveGenerationSteps, resolveGuidanceScale, parseGenerationProgressChunk } =
  require('../../../electron/lib/localInferenceRuntime.js');
const { ZIMAGE_AUXILIARY } = require('../../../electron/lib/modelCatalog.js');

// Ported verbatim from electron/lib/localInference.js:407-417
export function arToDimensions(ar, modelType) {
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
export function buildSdCppArgs({ model, params, modelsDir, outPath, llmPath, vaePath }) {
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

// generate(): spawns sd-cli, streams progress via onProgress, returns a PNG Buffer + seed.
// Ported from electron/lib/localInference.js:419-562, with mainWindow IPC replaced by onProgress.
export async function generate({ model, params }, onProgress = () => {}) {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/sdcppArgs.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/local-runtime/providers/sdcpp.js tests/sdcppArgs.test.js
git commit -m "feat(runtime): port sd.cpp generator (pure args + spawn)"
```

---

### Task 5: `lib/local-runtime/storage.js` — local asset sink

**Files:**
- Create: `lib/local-runtime/storage.js`
- Test: `tests/localRuntimeStorage.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/localRuntimeStorage.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('saveAsset writes a file and returns a /api/assets url', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogai-'));
  process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR = dir;
  const { saveAsset, getAssetPath } = await import('../lib/local-runtime/storage.js?ts=' + Date.now());
  const { key, url } = saveAsset(Buffer.from('hello'), 'png');
  assert.ok(/^[\w.-]+\.png$/.test(key));
  assert.strictEqual(url, `/api/assets/${key}`);
  assert.strictEqual(fs.readFileSync(getAssetPath(key), 'utf8'), 'hello');
  delete process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR;
});

test('getAssetPath rejects path traversal', async () => {
  const { getAssetPath } = await import('../lib/local-runtime/storage.js?ts=' + Date.now());
  assert.throws(() => getAssetPath('../../etc/passwd'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/localRuntimeStorage.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/local-runtime/storage.js
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getPaths } from './paths.js';

export function saveAsset(buffer, ext = 'png') {
  const { assetsDir } = getPaths();
  fs.mkdirSync(assetsDir, { recursive: true });
  const key = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(assetsDir, key), buffer);
  return { key, url: `/api/assets/${key}`, path: path.join(assetsDir, key) };
}

export function getAssetPath(key) {
  const { assetsDir } = getPaths();
  const resolved = path.resolve(assetsDir, key);
  if (!resolved.startsWith(path.resolve(assetsDir) + path.sep)) throw new Error('Invalid asset key');
  return resolved;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/localRuntimeStorage.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/local-runtime/storage.js tests/localRuntimeStorage.test.js
git commit -m "feat(runtime): local asset storage with traversal guard"
```

---

### Task 6: `lib/local-runtime/jobs.js` — in-memory job + event store

**Files:**
- Create: `lib/local-runtime/jobs.js`
- Test: `tests/localRuntimeJobs.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/localRuntimeJobs.test.js
const test = require('node:test');
const assert = require('node:assert');

test('job lifecycle: create -> events -> complete', async () => {
  const { createJob, appendEvent, completeJob, getJob } = await import('../lib/local-runtime/jobs.js?ts=' + Date.now());
  const id = createJob('image', { model: 'z-image-turbo' });
  assert.ok(id);
  appendEvent(id, { step: 1, totalSteps: 8 });
  completeJob(id, { url: '/api/assets/x.png' });
  const job = getJob(id);
  assert.strictEqual(job.status, 'done');
  assert.strictEqual(job.events.length, 1);
  assert.strictEqual(job.result.url, '/api/assets/x.png');
});

test('subscribe receives events then end', async () => {
  const { createJob, appendEvent, completeJob, subscribe } = await import('../lib/local-runtime/jobs.js?ts=' + Date.now());
  const id = createJob('image', {});
  const got = [];
  const done = new Promise((res) => subscribe(id, (e) => { got.push(e); if (e.type === 'end') res(); }));
  appendEvent(id, { step: 1, totalSteps: 2 });
  completeJob(id, { url: '/y.png' });
  await done;
  assert.ok(got.some(e => e.type === 'progress'));
  assert.ok(got.some(e => e.type === 'end'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/localRuntimeJobs.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/local-runtime/jobs.js
import { EventEmitter } from 'events';

const jobs = new Map(); // id -> { id, kind, payload, status, events, result, error }
const emitters = new Map(); // id -> EventEmitter

let counter = 0;
function nextId() { return `job_${Date.now()}_${++counter}`; }

export function createJob(kind, payload) {
  const id = nextId();
  jobs.set(id, { id, kind, payload, status: 'running', events: [], result: null, error: null });
  emitters.set(id, new EventEmitter());
  return id;
}
export function appendEvent(id, evt) {
  const job = jobs.get(id); if (!job) return;
  job.events.push(evt);
  emitters.get(id)?.emit('event', { type: 'progress', ...evt });
}
export function completeJob(id, result) {
  const job = jobs.get(id); if (!job) return;
  job.status = 'done'; job.result = result;
  emitters.get(id)?.emit('event', { type: 'result', result });
  emitters.get(id)?.emit('event', { type: 'end' });
}
export function failJob(id, error) {
  const job = jobs.get(id); if (!job) return;
  job.status = 'error'; job.error = String(error?.message || error);
  emitters.get(id)?.emit('event', { type: 'error', error: job.error });
  emitters.get(id)?.emit('event', { type: 'end' });
}
export function getJob(id) { return jobs.get(id) || null; }
export function subscribe(id, cb) {
  const em = emitters.get(id);
  if (!em) { cb({ type: 'end' }); return () => {}; }
  em.on('event', cb);
  return () => em.off('event', cb);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/localRuntimeJobs.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/local-runtime/jobs.js tests/localRuntimeJobs.test.js
git commit -m "feat(runtime): in-memory job + SSE event store"
```

---

### Task 7: `lib/local-runtime/providers/index.js` — provider registry

**Files:**
- Create: `lib/local-runtime/providers/index.js`
- Test: `tests/providerRegistry.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/providerRegistry.test.js
const test = require('node:test');
const assert = require('node:assert');

test('resolveProvider returns sdcpp generate for a local image model', async () => {
  const { resolveProvider } = await import('../lib/local-runtime/providers/index.js');
  const r = resolveProvider('z-image-turbo');
  assert.strictEqual(r.entry.provider, 'sdcpp');
  assert.strictEqual(typeof r.generate, 'function');
});

test('resolveProvider throws for unknown model', async () => {
  const { resolveProvider } = await import('../lib/local-runtime/providers/index.js');
  assert.throws(() => resolveProvider('nope'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/providerRegistry.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/local-runtime/providers/index.js
import { getCatalogEntry } from '../catalog.js';
import * as sdcpp from './sdcpp.js';

const PROVIDERS = { sdcpp }; // wan2gp, ollama, comfyui, api/* added in later milestones

export function resolveProvider(modelId) {
  const entry = getCatalogEntry(modelId);
  if (!entry) throw new Error(`Unknown model: ${modelId}`);
  const provider = PROVIDERS[entry.provider];
  if (!provider) throw new Error(`No provider registered for: ${entry.provider}`);
  // provider.generate expects ({ model, params }, onProgress) and returns { buffer, ext, seed }
  return { entry, generate: (params, onProgress) => provider.generate({ model: entry.raw, params }, onProgress) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/providerRegistry.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/local-runtime/providers/index.js tests/providerRegistry.test.js
git commit -m "feat(runtime): provider registry (sdcpp)"
```

---

### Task 8: `app/api/assets/[key]/route.js` — serve local assets

**Files:**
- Create: `app/api/assets/[key]/route.js`

- [ ] **Step 1: Write the route**

```js
// app/api/assets/[key]/route.js
import fs from 'fs';
import { getAssetPath } from '../../../../lib/local-runtime/storage.js';

export const runtime = 'nodejs';

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav' };

export async function GET(_req, { params }) {
  const { key } = await params;
  let filePath;
  try { filePath = getAssetPath(key); } catch { return new Response('Bad key', { status: 400 }); }
  if (!fs.existsSync(filePath)) return new Response('Not found', { status: 404 });
  const ext = key.split('.').pop().toLowerCase();
  return new Response(fs.readFileSync(filePath), {
    headers: { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
}
```

- [ ] **Step 2: Manual verify after dev server is up (done in Task 10).**

- [ ] **Step 3: Commit**

```bash
git add app/api/assets/[key]/route.js
git commit -m "feat(api): serve local assets from .local-ai/assets"
```

---

### Task 9: `app/api/local-ai/generate/route.js` — SSE generation route

**Files:**
- Create: `app/api/local-ai/generate/route.js`

- [ ] **Step 1: Write the route** (thin wrapper: registry + jobs + storage; streams SSE)

```js
// app/api/local-ai/generate/route.js
import { resolveProvider } from '../../../../lib/local-runtime/providers/index.js';
import { saveAsset } from '../../../../lib/local-runtime/storage.js';

export const runtime = 'nodejs';
export const maxDuration = 600;

export async function POST(req) {
  const body = await req.json();
  const { model, ...params } = body || {};
  let provider;
  try { provider = resolveProvider(model); } catch (e) { return Response.json({ error: e.message }, { status: 400 }); }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        const { buffer, ext, seed } = await provider.generate(params, (evt) => send({ type: 'progress', ...evt }));
        const asset = saveAsset(buffer, ext);
        send({ type: 'result', url: asset.url, key: asset.key, seed, model });
      } catch (e) {
        send({ type: 'error', error: String(e?.message || e) });
      } finally {
        send({ type: 'end' });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/local-ai/generate/route.js
git commit -m "feat(api): local-ai generate route with SSE progress"
```

---

### Task 10: End-to-end verification of the headless runtime (NO UI yet)

This is a **verification gate** (superpowers:verification-before-completion). Evidence required before M0 is "done."

- [ ] **Step 1: Run all unit tests**

Run: `npm test`
Expected: all tests PASS (existing 4 + new 6 files).

- [ ] **Step 2: Ensure binary + a model are present**

Start dev server: `npm run dev`. In the browser at `/studio`, open Settings → Local Models (`LocalModelsPanel`). If sd.cpp shows "not installed", click download engine; download a small model (e.g. **z-image-turbo** + its Qwen3-4B + FLUX VAE auxiliaries, or **dreamshaper-8** which needs no auxiliaries — prefer dreamshaper-8 for the first smoke test).

- [ ] **Step 3: Curl the generate route and capture SSE**

Run:
```bash
curl -N -X POST http://localhost:3000/api/local-ai/generate \
  -H 'Content-Type: application/json' \
  -d '{"model":"dreamshaper-8","prompt":"a red bicycle, studio light","aspect_ratio":"1:1","steps":12}'
```
Expected: a stream of `data: {"type":"progress","step":N,...}` lines, then `data: {"type":"result","url":"/api/assets/....png","seed":...}`, then `data: {"type":"end"}`.

- [ ] **Step 4: Verify the asset is served**

Open the returned URL in a browser: `http://localhost:3000/api/assets/<key>.png`
Expected: the generated PNG renders.

- [ ] **Step 5: Commit a short evidence note**

```bash
git commit --allow-empty -m "test(runtime): verified local sd.cpp generation end-to-end via /api/local-ai/generate"
```

**M0 EXIT CRITERIA:** all unit tests green; SSE generation produces a real PNG saved under `.local-ai/assets/` and served at `/api/assets/[key]`. No UI changed.

---

# MILESTONE 1 — Image Studio vertical (user-visible)

### Task 11: `packages/studio/src/local-api.js` — local SDK mirroring muapi

**Files:**
- Create: `packages/studio/src/local-api.js`
- Test: `tests/localApiSdk.test.js`

- [ ] **Step 1: Write the failing test** (parse SSE → resolve final url)

```js
// tests/localApiSdk.test.js
const test = require('node:test');
const assert = require('node:assert');

test('parseSseResult extracts the result url from an SSE body', async () => {
  const { parseSseResult } = await import('../packages/studio/src/local-api.js');
  const body = [
    'data: {"type":"progress","step":1,"totalSteps":8}',
    'data: {"type":"result","url":"/api/assets/abc.png","seed":7}',
    'data: {"type":"end"}',
  ].join('\n\n');
  assert.deepStrictEqual(parseSseResult(body), { url: '/api/assets/abc.png', seed: 7 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/localApiSdk.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// packages/studio/src/local-api.js
// Local SDK mirroring the muapi.js surface used by the studios. Talks to /api/local-ai.
const BASE = '/api/local-ai';

export function parseSseResult(text) {
  let result = null;
  for (const block of text.split('\n\n')) {
    const line = block.split('\n').find(l => l.startsWith('data: '));
    if (!line) continue;
    let obj; try { obj = JSON.parse(line.slice(6)); } catch { continue; }
    if (obj.type === 'result') result = { url: obj.url, seed: obj.seed };
    if (obj.type === 'error') throw new Error(obj.error);
  }
  return result;
}

async function streamGenerate(payload, onProgress) {
  const res = await fetch(`${BASE}/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!res.ok || !res.body) throw new Error(`Local generation failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', result = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n'); buf = parts.pop();
    for (const part of parts) {
      const line = part.split('\n').find(l => l.startsWith('data: '));
      if (!line) continue;
      const obj = JSON.parse(line.slice(6));
      if (obj.type === 'progress') onProgress?.(obj);
      if (obj.type === 'result') result = { url: obj.url, seed: obj.seed };
      if (obj.type === 'error') throw new Error(obj.error);
    }
  }
  if (!result) throw new Error('Local generation produced no image');
  return result;
}

// muapi.js parity: returns a result with .url so ImageStudio can store it in history unchanged.
export async function generateImage(modelId, params, onProgress) {
  return streamGenerate({ model: modelId, ...params }, onProgress);
}
export async function generateI2I(modelId, params, onProgress) {
  return streamGenerate({ model: modelId, ...params }, onProgress); // image input handled when i2i models land
}
export async function uploadFile(file) {
  const fd = new FormData(); fd.append('file', file);
  const res = await fetch(`${BASE}/upload`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error('Local upload failed');
  return res.json(); // { url }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/localApiSdk.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/studio/src/local-api.js tests/localApiSdk.test.js
git commit -m "feat(studio): local-api SDK mirroring muapi surface"
```

---

### Task 12: Local upload route

**Files:**
- Create: `app/api/local-ai/upload/route.js`

- [ ] **Step 1: Write the route**

```js
// app/api/local-ai/upload/route.js
import { saveAsset } from '../../../../lib/local-runtime/storage.js';
export const runtime = 'nodejs';

export async function POST(req) {
  const form = await req.formData();
  const file = form.get('file');
  if (!file) return Response.json({ error: 'no file' }, { status: 400 });
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = (file.name?.split('.').pop() || 'png').toLowerCase();
  const { url } = saveAsset(buffer, ext);
  return Response.json({ url });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/local-ai/upload/route.js
git commit -m "feat(api): local file upload to asset storage"
```

---

### Task 13: Add the Local/API toggle + unified model list to `ImageStudio.jsx`

Port the UX from `src/components/ImageStudio.js` (lines 39–44, 201–230, 1172–1237) into the React component. Keep the change surgical so the submodule stays mergeable.

**Files:**
- Modify: `packages/studio/src/components/ImageStudio.jsx`
- Reference (read-only): `src/components/ImageStudio.js`, `components/LocalModelsPanel.js`

- [ ] **Step 1: Fetch the local model list**

Add near the top of the component:

```jsx
import * as localApi from '../local-api.js';
// ...
const [useLocalModel, setUseLocalModel] = useState(false);
const [localModels, setLocalModels] = useState([]);
const [localProgress, setLocalProgress] = useState(null);

useEffect(() => {
  fetch('/api/local-ai/models')
    .then(r => r.json())
    .then(d => setLocalModels((d.models || []).filter(m => m.kind === 'image' && m.ready !== false)))
    .catch(() => setLocalModels([]));
}, []);
```

- [ ] **Step 2: Add the toggle button** in the model-picker row (mirror the cloud/local button from `src/components/ImageStudio.js:201-230`):

```jsx
<button
  type="button"
  className={`text-xs px-2 py-1 rounded ${useLocalModel ? 'bg-cyan-500 text-black' : 'bg-white/10'}`}
  onClick={() => setUseLocalModel(v => !v)}
>
  {useLocalModel ? 'Local' : 'API'}
</button>
```

When `useLocalModel` is true, render `localModels` in the model dropdown instead of the MuAPI model list.

- [ ] **Step 3: Branch the generate handler** (in `handleGenerate`, mirror `src/components/ImageStudio.js:1172-1237`):

```jsx
if (useLocalModel) {
  const res = await localApi.generateImage(selectedLocalModelId, {
    prompt,
    negative_prompt: negativePrompt,
    aspect_ratio: selectedAr,
    steps,
    guidance_scale: guidanceScale,
    seed,
  }, (evt) => setLocalProgress(evt));
  setLocalProgress(null);
  addToHistory({ url: res.url, prompt, seed: res.seed }); // reuse the existing history shape
  return;
}
// ...existing MuAPI path unchanged below...
```

- [ ] **Step 4: Manual smoke (browser).** `npm run dev` → `/studio` → Image → toggle **Local** → pick `dreamshaper-8` → Generate → image appears, progress bar advances.

- [ ] **Step 5: Commit**

```bash
git add packages/studio/src/components/ImageStudio.jsx
git commit -m "feat(studio): local/API toggle + local generation in Image Studio"
```

---

### Task 14: Branch the shared `muapi.js` (optional safety net)

So any studio importing `uploadFile` can be redirected locally without per-component edits later.

**Files:**
- Modify: `packages/studio/src/muapi.js` (the `uploadFile` export and `BASE_URL` selection)

- [ ] **Step 1:** Add a module-level `localMode` flag (default from `localStorage.getItem('og_local_mode')`), and in `uploadFile`, when `localMode`, delegate to `local-api.js`'s `uploadFile`. Keep all cloud signatures intact.

- [ ] **Step 2: Commit**

```bash
git add packages/studio/src/muapi.js
git commit -m "feat(studio): route uploads locally when local mode is on"
```

---

### Task 15: Browser E2E verification (verification gate)

Use the webapp-testing skill (Playwright). Evidence required before M1 is "done."

- [ ] **Step 1:** Start dev server (`npm run dev`); ensure `dreamshaper-8` is downloaded.

- [ ] **Step 2:** Drive the browser: open `/studio`, switch to Image, click the **Local** toggle, select `dreamshaper-8`, type a prompt, click Generate.

- [ ] **Step 3:** Assert: a progress indicator appears, then an `<img>` whose `src` contains `/api/assets/` renders, and the result lands in history. Capture a screenshot.

- [ ] **Step 4:** Block `api.muapi.ai` (devtools request blocking) and repeat Step 2–3 to prove **no cloud dependency** for local generation.

- [ ] **Step 5: Commit evidence**

```bash
git commit --allow-empty -m "test(studio): e2e verified local Image Studio generation with cloud blocked"
```

**M1 EXIT CRITERIA:** with `api.muapi.ai` blocked, the live web Image Studio generates an image locally, shows progress, and stores it in history — verified by actually running it in a browser.

---

## Self-Review (run before handing off)

1. **Spec coverage** — M0 delivers: paths, catalog, sdcpp provider, storage, jobs, registry, assets route, generate route (✓ Tasks 2–10). M1 delivers: local SDK, upload, toggle+selector+generate in the live UI, e2e (✓ Tasks 11–15). Matches roadmap M0/M1 exit criteria.
2. **Placeholder scan** — every code step contains real code; the only "port from reference" steps (Task 4 spawn, Task 13 UI) cite exact source files+lines and show the target code.
3. **Type consistency** — provider returns `{ buffer, ext, seed }`; generate route consumes that and emits `{type:'result', url, seed}`; `local-api.js` parses that into `{ url, seed }`; ImageStudio stores `{ url, seed }`. Catalog `entry.raw` (full electron model) is what `sdcpp.generate` expects as `model`. Consistent across tasks.

## Execution Handoff
Two options when you're ready to build:
1. **Subagent-Driven (recommended)** — a fresh subagent per task with review between tasks.
2. **Inline Execution** — batch with checkpoints via superpowers:executing-plans.
