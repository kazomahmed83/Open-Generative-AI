# Model Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app Model Library — a curated catalog of downloadable models (Ollama chat, ComfyUI image checkpoints, multi-file bundles like FLUX.2) that install from Settings with live progress, fit badges, and engine-aware destinations.

**Architecture:** Extend the existing local-first plumbing rather than build new. New pure CommonJS helpers under `lib/local-runtime/catalog/` (catalog data, install-state, fit, engine roots, allowlist, progress, merge), each TDD'd with `node --test`. Then wire them into the existing `lib/local-ai-web.js` (`listLocalModels`, a new `downloadRecipe`), convert the `download-model` route to SSE (matching `generate/route.js`), surface in `components/LocalModelsPanel.js`, and add a FLUX.2 workflow to `comfyui.js`.

**Tech Stack:** Node.js (CommonJS libs, ESM web module), Next.js App Router (SSE via `ReadableStream`), React (client panel), `node:test` + `node:assert`. Engines: Ollama (`/api/pull`), ComfyUI (workflow API + ComfyUI-GGUF node, already installed).

**Test command (all tasks):** `node --test tests/` (run from `d:\Open-Generative-AI`). Baseline is 112 passing.

**Module-system rule:** Everything in `lib/local-runtime/catalog/` is CommonJS (`require` / `module.exports`) so the tests can `require()` it and Next can import it via interop (same as `gpu.js`). `lib/local-ai-web.js` stays ESM.

---

## File Structure

**Create (all CommonJS + a sibling test):**
- `lib/local-runtime/catalog/allowlist.js` — `isHostAllowed(url, allowed?)`. Download URL host safety.
- `lib/local-runtime/catalog/engineRoots.js` — `resolveEngineRoot(engine, opts)`, `resolveDest(root, dest)`. Where each engine's files live.
- `lib/local-runtime/catalog/recipes.js` — `RECIPES`, `getRecipe(id)`. The curated catalog data.
- `lib/local-runtime/catalog/recipeState.js` — `recipeState(recipe, ctx)`, `computeFit(fit, gpu)`. Install state + hardware fit.
- `lib/local-runtime/catalog/ollamaProgress.js` — `parseOllamaPullProgress(line)`, `aggregateProgress(fractions, sizes)`. Progress math.
- `lib/local-runtime/catalog/mergeCatalog.js` — `mergeCatalog(detected, recipes, stateFor)`. Merge curated entries into detected models.
- Tests: `tests/allowlist.test.js`, `tests/engineRoots.test.js`, `tests/recipes.test.js`, `tests/recipeState.test.js`, `tests/ollamaProgress.test.js`, `tests/mergeCatalog.test.js`, plus additions to `tests/comfyuiProvider.test.js`.

**Modify:**
- `lib/local-ai-web.js` — add `onProgress` to `downloadFile`; add `downloadRecipe()` + `ollamaPull()`; merge recipes into `listLocalModels()`; helper `nodeInstalled()`.
- `app/api/local-ai/download-model/route.js` — SSE streaming via `downloadRecipe`, legacy fallback.
- `components/LocalModelsPanel.js` — fit badge, category grouping, SSE progress, needs-node notice.
- `lib/local-runtime/providers/comfyui.js` — `buildFlux2Workflow()` + workflow selection in `generate()`.

---

## Task 1: Host allowlist

**Files:**
- Create: `lib/local-runtime/catalog/allowlist.js`
- Test: `tests/allowlist.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/allowlist.test.js
const test = require('node:test');
const assert = require('node:assert');
const { isHostAllowed } = require('../lib/local-runtime/catalog/allowlist.js');

test('isHostAllowed: allows huggingface.co and its CDN subdomains', () => {
  assert.strictEqual(isHostAllowed('https://huggingface.co/x/resolve/main/m.gguf'), true);
  assert.strictEqual(isHostAllowed('https://cdn-lfs.huggingface.co/a/b'), true);
  assert.strictEqual(isHostAllowed('https://cdn-lfs-us-1.hf.co/a/b'), true);
});

test('isHostAllowed: rejects arbitrary and malformed hosts', () => {
  assert.strictEqual(isHostAllowed('https://evil.example.com/m.gguf'), false);
  assert.strictEqual(isHostAllowed('not a url'), false);
  assert.strictEqual(isHostAllowed('https://nothuggingface.co.evil.com/x'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/allowlist.test.js`
Expected: FAIL — `Cannot find module '../lib/local-runtime/catalog/allowlist.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/local-runtime/catalog/allowlist.js
// Download URLs in recipes are restricted to these hosts so a catalog entry can never point the
// downloader at an arbitrary server. Subdomains of each base host are allowed (HF serves bytes
// from cdn-lfs.* hostnames).
const ALLOWED_HOSTS = ['huggingface.co', 'hf.co'];

function isHostAllowed(url, allowed = ALLOWED_HOSTS) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  return allowed.some((h) => host === h || host.endsWith(`.${h}`));
}

module.exports = { isHostAllowed, ALLOWED_HOSTS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/allowlist.test.js`
Expected: PASS (2/2). Then `node --test tests/` — still 112 + 2.

- [ ] **Step 5: Commit**

```bash
git add lib/local-runtime/catalog/allowlist.js tests/allowlist.test.js
git commit -m "feat(model-library): host allowlist for recipe download URLs"
```

---

## Task 2: Engine roots + destination resolution

**Files:**
- Create: `lib/local-runtime/catalog/engineRoots.js`
- Test: `tests/engineRoots.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/engineRoots.test.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { resolveEngineRoot, resolveDest, DEFAULT_COMFY_MODELS_DIR } = require('../lib/local-runtime/catalog/engineRoots.js');

test('resolveEngineRoot: comfyui precedence config > env > default', () => {
  assert.strictEqual(
    resolveEngineRoot('comfyui', { config: { engines: { comfyui: { modelsDir: 'C:/custom' } } }, env: {} }),
    'C:/custom');
  assert.strictEqual(resolveEngineRoot('comfyui', { config: {}, env: { COMFYUI_MODELS_DIR: 'D:/env' } }), 'D:/env');
  assert.strictEqual(resolveEngineRoot('comfyui', { config: {}, env: {} }), DEFAULT_COMFY_MODELS_DIR);
});

test('resolveEngineRoot: sdcpp uses the .local-ai models dir; ollama is null', () => {
  const root = resolveEngineRoot('sdcpp', { env: { OPEN_GENERATIVE_AI_LOCAL_AI_DIR: '/data/.local-ai' } });
  assert.strictEqual(root, path.join('/data/.local-ai', 'models'));
  assert.strictEqual(resolveEngineRoot('ollama', {}), null);
});

test('resolveDest: joins root + relative dest', () => {
  assert.strictEqual(resolveDest('R', 'unet/x.gguf'), path.join('R', 'unet/x.gguf'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/engineRoots.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/local-runtime/catalog/engineRoots.js
const path = require('path');

// The portable ComfyUI install on this machine. Overridable via config.engines.comfyui.modelsDir
// or the COMFYUI_MODELS_DIR env var so the catalog stays machine-independent.
const DEFAULT_COMFY_MODELS_DIR = 'F:/AI/ComfyUI_windows_portable/ComfyUI/models';

function resolveEngineRoot(engine, { config = {}, env = process.env } = {}) {
  if (engine === 'comfyui') {
    return (config.engines && config.engines.comfyui && config.engines.comfyui.modelsDir)
      || env.COMFYUI_MODELS_DIR
      || DEFAULT_COMFY_MODELS_DIR;
  }
  if (engine === 'sdcpp') {
    const dataDir = path.resolve(env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR || path.join(process.cwd(), '.local-ai'));
    return path.join(dataDir, 'models');
  }
  return null; // ollama is not file-based
}

function resolveDest(root, dest) {
  return path.join(root, dest);
}

module.exports = { resolveEngineRoot, resolveDest, DEFAULT_COMFY_MODELS_DIR };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/engineRoots.test.js` → PASS (3/3). Then `node --test tests/`.

- [ ] **Step 5: Commit**

```bash
git add lib/local-runtime/catalog/engineRoots.js tests/engineRoots.test.js
git commit -m "feat(model-library): engine root + dest resolution"
```

---

## Task 3: Curated recipe catalog

**Files:**
- Create: `lib/local-runtime/catalog/recipes.js`
- Test: `tests/recipes.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/recipes.test.js
const test = require('node:test');
const assert = require('node:assert');
const { RECIPES, getRecipe } = require('../lib/local-runtime/catalog/recipes.js');
const { isHostAllowed } = require('../lib/local-runtime/catalog/allowlist.js');

test('recipes: ids are unique and well-formed', () => {
  const ids = RECIPES.map((r) => r.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'duplicate recipe id');
  for (const r of RECIPES) {
    assert.ok(['image', 'chat', 'video', 'audio'].includes(r.category), `${r.id} bad category`);
    assert.ok(['comfyui', 'ollama', 'sdcpp'].includes(r.engine), `${r.id} bad engine`);
    assert.ok(r.name && r.description, `${r.id} missing name/description`);
  }
});

test('recipes: file-based entries carry allowlisted URLs + dests; ollama entries carry pull', () => {
  for (const r of RECIPES) {
    if (r.engine === 'ollama') { assert.ok(r.pull, `${r.id} missing pull`); continue; }
    assert.ok(Array.isArray(r.files) && r.files.length, `${r.id} missing files`);
    for (const f of r.files) {
      assert.ok(isHostAllowed(f.url), `${r.id} url not allowlisted: ${f.url}`);
      assert.ok(f.dest && !f.dest.startsWith('/') && !f.dest.includes('..'), `${r.id} bad dest: ${f.dest}`);
    }
  }
});

test('getRecipe: returns by id or null', () => {
  assert.strictEqual(getRecipe('comfyui:flux2-klein').name, 'FLUX.2 Klein (9B)');
  assert.strictEqual(getRecipe('nope'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/recipes.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/local-runtime/catalog/recipes.js
// Curated, hand-picked models that are known to fit a 12 GB / 32 GB machine. Each is a "recipe":
// an engine + how to install it (files→folders, or an ollama pull) + how to run it (workflow).
const HF = 'https://huggingface.co';

const RECIPES = [
  // ---- Image / ComfyUI ----
  {
    id: 'comfyui:flux2-klein', name: 'FLUX.2 Klein (9B)',
    description: 'Distilled 9B FLUX.2 (Apache). Q4 GGUF fits 12 GB; Mistral encoder offloads to system RAM.',
    category: 'image', engine: 'comfyui', provider: 'comfyui',
    sizeBytes: 24_280_000_000, fit: { minVramGb: 8, recVramGb: 12 }, workflow: 'flux2',
    files: [
      { url: `${HF}/unsloth/FLUX.2-klein-base-9B-GGUF/resolve/main/flux-2-klein-base-9b-Q4_K_M.gguf`, dest: 'unet/flux-2-klein-base-9b-Q4_K_M.gguf' },
      { url: `${HF}/Comfy-Org/flux2-dev/resolve/main/split_files/text_encoders/mistral_3_small_flux2_fp8.safetensors`, dest: 'text_encoders/mistral_3_small_flux2_fp8.safetensors' },
      { url: `${HF}/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors`, dest: 'vae/flux2-vae.safetensors' },
    ],
    requiresNode: { name: 'ComfyUI-GGUF', repo: 'https://github.com/city96/ComfyUI-GGUF', dir: 'ComfyUI-GGUF' },
  },
  {
    id: 'comfyui:juggernaut-xl', name: 'Juggernaut XL v9',
    description: 'Photoreal SDXL finetune. Single 7 GB checkpoint.',
    category: 'image', engine: 'comfyui', provider: 'comfyui',
    sizeBytes: 7_100_000_000, fit: { minVramGb: 6, recVramGb: 8 }, workflow: 'sdxl',
    files: [{ url: `${HF}/RunDiffusion/Juggernaut-XL-v9/resolve/main/Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors`, dest: 'checkpoints/juggernaut-xl-v9.safetensors' }],
  },
  {
    id: 'comfyui:flux1-schnell', name: 'FLUX.1 Schnell (fp8)',
    description: 'Fast 4-step FLUX.1 (Apache). Single fp8 checkpoint, no extra encoders.',
    category: 'image', engine: 'comfyui', provider: 'comfyui',
    sizeBytes: 17_200_000_000, fit: { minVramGb: 8, recVramGb: 12 }, workflow: 'sdxl',
    files: [{ url: `${HF}/Comfy-Org/flux1-schnell/resolve/main/flux1-schnell-fp8.safetensors`, dest: 'checkpoints/flux1-schnell-fp8.safetensors' }],
  },
  // ---- Chat / Ollama (installed via `ollama pull`) ----
  { id: 'ollama:qwen3',          name: 'Qwen3 (8B)',           description: 'Strong general + reasoning chat model.', category: 'chat', engine: 'ollama', provider: 'ollama', sizeBytes: 5_200_000_000, fit: { minVramGb: 6, recVramGb: 8 },  pull: 'qwen3' },
  { id: 'ollama:llama3.2',       name: 'Llama 3.2 (3B)',       description: 'Small, fast Meta chat model.',           category: 'chat', engine: 'ollama', provider: 'ollama', sizeBytes: 2_000_000_000, fit: { minVramGb: 4, recVramGb: 6 },  pull: 'llama3.2' },
  { id: 'ollama:mistral',        name: 'Mistral (7B)',         description: 'Well-rounded 7B instruct model.',        category: 'chat', engine: 'ollama', provider: 'ollama', sizeBytes: 4_100_000_000, fit: { minVramGb: 5, recVramGb: 8 },  pull: 'mistral' },
  { id: 'ollama:phi4',           name: 'Phi-4 (14B)',          description: 'Microsoft reasoning-tuned model.',       category: 'chat', engine: 'ollama', provider: 'ollama', sizeBytes: 9_100_000_000, fit: { minVramGb: 9, recVramGb: 12 }, pull: 'phi4' },
  { id: 'ollama:gemma2',         name: 'Gemma 2 (9B)',         description: "Google's compact, capable chat model.",  category: 'chat', engine: 'ollama', provider: 'ollama', sizeBytes: 5_400_000_000, fit: { minVramGb: 6, recVramGb: 8 },  pull: 'gemma2' },
  { id: 'ollama:deepseek-r1',    name: 'DeepSeek-R1 (7B)',     description: 'Open reasoning model with visible chain-of-thought.', category: 'chat', engine: 'ollama', provider: 'ollama', sizeBytes: 4_700_000_000, fit: { minVramGb: 5, recVramGb: 8 }, pull: 'deepseek-r1' },
  { id: 'ollama:qwen2.5-coder',  name: 'Qwen2.5 Coder (7B)',   description: 'Code-specialized model for the chat/coding studio.', category: 'chat', engine: 'ollama', provider: 'ollama', sizeBytes: 4_700_000_000, fit: { minVramGb: 5, recVramGb: 8 }, pull: 'qwen2.5-coder' },
];

function getRecipe(id) { return RECIPES.find((r) => r.id === id) || null; }

module.exports = { RECIPES, getRecipe };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/recipes.test.js` → PASS (3/3). Then `node --test tests/`.

- [ ] **Step 5: Verify image URLs resolve (catch a bad URL early, not at user download)**

Run (network; non-blocking — log only):
```bash
for u in \
 "https://huggingface.co/RunDiffusion/Juggernaut-XL-v9/resolve/main/Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors" \
 "https://huggingface.co/Comfy-Org/flux1-schnell/resolve/main/flux1-schnell-fp8.safetensors"; do
  echo "$u -> $(curl -sI -o /dev/null -w '%{http_code}' -L "$u")"; done
```
Expected: each prints `200` (or `302→200`). If a `404`, fix that recipe's URL (search the correct HF path) and re-run Step 4. FLUX.2 klein URLs are already proven (downloaded successfully).

- [ ] **Step 6: Commit**

```bash
git add lib/local-runtime/catalog/recipes.js tests/recipes.test.js
git commit -m "feat(model-library): curated recipe catalog (image + chat)"
```

---

## Task 4: Install-state + hardware fit

**Files:**
- Create: `lib/local-runtime/catalog/recipeState.js`
- Test: `tests/recipeState.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/recipeState.test.js
const test = require('node:test');
const assert = require('node:assert');
const { recipeState, computeFit } = require('../lib/local-runtime/catalog/recipeState.js');

const fileRecipe = {
  engine: 'comfyui',
  files: [{ dest: 'unet/a.gguf' }, { dest: 'vae/b.safetensors' }],
  requiresNode: { dir: 'ComfyUI-GGUF' },
};

test('recipeState: file recipe ready only when all files present and node installed', () => {
  const all = new Set(['unet/a.gguf', 'vae/b.safetensors']);
  assert.strictEqual(recipeState(fileRecipe, { resolveDest: (d) => d, fileExists: (d) => all.has(d), nodeInstalled: () => true }), 'ready');
  assert.strictEqual(recipeState(fileRecipe, { resolveDest: (d) => d, fileExists: (d) => all.has(d), nodeInstalled: () => false }), 'needs-node');
});

test('recipeState: partial when some files present, available when none', () => {
  assert.strictEqual(recipeState(fileRecipe, { resolveDest: (d) => d, fileExists: (d) => d === 'unet/a.gguf' }), 'partial');
  assert.strictEqual(recipeState(fileRecipe, { resolveDest: (d) => d, fileExists: () => false }), 'available');
});

test('recipeState: ollama ready when the model (any tag) is installed', () => {
  const r = { engine: 'ollama', pull: 'qwen3' };
  assert.strictEqual(recipeState(r, { ollamaModelNames: new Set(['qwen3:latest']) }), 'ready');
  assert.strictEqual(recipeState(r, { ollamaModelNames: new Set(['mistral:latest']) }), 'available');
});

test('computeFit: fits/tight/too-big from free VRAM, unknown without gpu', () => {
  const fit = { minVramGb: 8, recVramGb: 12 };
  assert.strictEqual(computeFit(fit, { freeVramBytes: 12.5 * 1024 ** 3 }), 'fits');
  assert.strictEqual(computeFit(fit, { freeVramBytes: 9 * 1024 ** 3 }), 'tight');
  assert.strictEqual(computeFit(fit, { freeVramBytes: 5 * 1024 ** 3 }), 'too-big');
  assert.strictEqual(computeFit(fit, null), 'unknown');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/recipeState.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/local-runtime/catalog/recipeState.js
// Pure install-state + hardware-fit for a recipe. Callers inject probes (file existence, the set of
// installed Ollama model names, whether a ComfyUI node dir exists) so this stays deterministic.
function recipeState(recipe, ctx = {}) {
  const { fileExists = () => false, ollamaModelNames = new Set(), nodeInstalled = () => true, resolveDest = (d) => d } = ctx;
  if (recipe.engine === 'ollama') {
    const base = String(recipe.pull || '').split(':')[0];
    const has = [...ollamaModelNames].some((n) => n === recipe.pull || String(n).split(':')[0] === base);
    return has ? 'ready' : 'available';
  }
  const files = recipe.files || [];
  const present = files.filter((f) => fileExists(resolveDest(f.dest))).length;
  if (present === 0) return 'available';
  if (present < files.length) return 'partial';
  if (recipe.requiresNode && !nodeInstalled(recipe.requiresNode.dir || recipe.requiresNode.name)) return 'needs-node';
  return 'ready';
}

// Map a recipe's VRAM hints against detected free VRAM. gpu is { freeVramBytes } or null.
function computeFit(fit, gpu) {
  if (!fit || !gpu || !gpu.freeVramBytes) return 'unknown';
  const freeGb = gpu.freeVramBytes / 1024 ** 3;
  if (freeGb >= fit.recVramGb) return 'fits';
  if (freeGb >= fit.minVramGb) return 'tight';
  return 'too-big';
}

module.exports = { recipeState, computeFit };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/recipeState.test.js` → PASS (4/4). Then `node --test tests/`.

- [ ] **Step 5: Commit**

```bash
git add lib/local-runtime/catalog/recipeState.js tests/recipeState.test.js
git commit -m "feat(model-library): recipe install-state + hardware fit"
```

---

## Task 5: Progress math (Ollama pull + multi-file aggregate)

**Files:**
- Create: `lib/local-runtime/catalog/ollamaProgress.js`
- Test: `tests/ollamaProgress.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/ollamaProgress.test.js
const test = require('node:test');
const assert = require('node:assert');
const { parseOllamaPullProgress, aggregateProgress } = require('../lib/local-runtime/catalog/ollamaProgress.js');

test('parseOllamaPullProgress: computes percent from completed/total', () => {
  const p = parseOllamaPullProgress('{"status":"pulling","completed":500,"total":1000}');
  assert.strictEqual(p.percent, 0.5);
  assert.strictEqual(p.status, 'pulling');
});

test('parseOllamaPullProgress: status-only line has null percent; bad line is null', () => {
  assert.strictEqual(parseOllamaPullProgress('{"status":"verifying sha256"}').percent, null);
  assert.strictEqual(parseOllamaPullProgress('not json'), null);
});

test('aggregateProgress: byte-weighted across files', () => {
  // file A 100% of 1GB, file B 50% of 3GB => (1 + 1.5)/4 = 0.625
  assert.ok(Math.abs(aggregateProgress([1, 0.5], [1e9, 3e9]) - 0.625) < 1e-9);
});

test('aggregateProgress: equal-weight fallback when sizes unknown', () => {
  assert.ok(Math.abs(aggregateProgress([1, 0], [0, 0]) - 0.5) < 1e-9);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ollamaProgress.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/local-runtime/catalog/ollamaProgress.js
// Ollama's POST /api/pull streams newline-delimited JSON: {status, completed?, total?}.
function parseOllamaPullProgress(line) {
  let obj;
  try { obj = typeof line === 'string' ? JSON.parse(line) : line; } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  const { status, completed, total } = obj;
  const percent = total > 0 && completed >= 0 ? Math.min(1, completed / total) : null;
  return { status: status || '', completed: completed || 0, total: total || 0, percent };
}

// Combine per-file fractions (0..1) into one overall fraction, weighted by byte size when known.
function aggregateProgress(fractions, sizes) {
  const totalSize = sizes.reduce((a, b) => a + (b || 0), 0);
  if (totalSize <= 0) {
    const n = fractions.length || 1;
    return Math.min(1, fractions.reduce((a, b) => a + (b || 0), 0) / n);
  }
  const done = fractions.reduce((a, f, i) => a + (f || 0) * (sizes[i] || 0), 0);
  return Math.min(1, done / totalSize);
}

module.exports = { parseOllamaPullProgress, aggregateProgress };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/ollamaProgress.test.js` → PASS (4/4). Then `node --test tests/`.

- [ ] **Step 5: Commit**

```bash
git add lib/local-runtime/catalog/ollamaProgress.js tests/ollamaProgress.test.js
git commit -m "feat(model-library): ollama pull + multi-file progress math"
```

---

## Task 6: Merge catalog + wire into listLocalModels

**Files:**
- Create: `lib/local-runtime/catalog/mergeCatalog.js`
- Test: `tests/mergeCatalog.test.js`
- Modify: `lib/local-ai-web.js` (imports near top; `listLocalModels` at lines 870-903)

- [ ] **Step 1: Write the failing test**

```js
// tests/mergeCatalog.test.js
const test = require('node:test');
const assert = require('node:assert');
const { mergeCatalog } = require('../lib/local-runtime/catalog/mergeCatalog.js');

const recipes = [
  { id: 'comfyui:flux2-klein', name: 'FLUX.2 Klein (9B)', description: 'd', category: 'image', engine: 'comfyui', provider: 'comfyui', sizeBytes: 24e9, fit: { minVramGb: 8, recVramGb: 12 }, requiresNode: { dir: 'ComfyUI-GGUF' } },
  { id: 'ollama:qwen3', name: 'Qwen3 (8B)', description: 'd', category: 'chat', engine: 'ollama', provider: 'ollama', sizeBytes: 5.2e9, fit: { minVramGb: 6, recVramGb: 8 }, pull: 'qwen3' },
];

test('mergeCatalog: detected model with same id wins; recipe is not duplicated', () => {
  const detected = [{ id: 'ollama:qwen3', name: 'qwen3:latest', state: 'available', provider: 'ollama' }];
  const out = mergeCatalog(detected, recipes, () => 'available');
  assert.strictEqual(out.filter((m) => m.id === 'ollama:qwen3').length, 1);
  assert.strictEqual(out.find((m) => m.id === 'ollama:qwen3').name, 'qwen3:latest'); // detected kept
});

test('mergeCatalog: undetected recipe appended with computed state + sizeGB + fit', () => {
  const out = mergeCatalog([], recipes, (r) => (r.engine === 'ollama' ? 'available' : 'needs-node'));
  const flux = out.find((m) => m.id === 'comfyui:flux2-klein');
  assert.strictEqual(flux.installMode, 'recipe');
  assert.strictEqual(flux.state, 'needs-node');
  assert.strictEqual(flux.sizeGB, 22.4);
  assert.deepStrictEqual(flux.fit, { minVramGb: 8, recVramGb: 12 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/mergeCatalog.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/local-runtime/catalog/mergeCatalog.js
// Merge curated recipes with the engine-detected model list. Detected entries (already installed)
// win on id; recipes not yet present are appended as installMode:'recipe' with a Download affordance.
function mergeCatalog(detected, recipes, stateFor) {
  const present = new Set(detected.map((m) => m.id));
  const out = [...detected];
  for (const r of recipes) {
    if (present.has(r.id)) continue;
    out.push({
      id: r.id, name: r.name, description: r.description,
      type: r.category, category: r.category, provider: r.provider, engine: r.engine,
      installMode: 'recipe', recipe: true,
      sizeGB: r.sizeBytes ? Math.round((r.sizeBytes / 1024 ** 3) * 10) / 10 : undefined,
      fit: r.fit || null, requiresNode: r.requiresNode || null,
      state: stateFor(r),
    });
  }
  return out;
}

module.exports = { mergeCatalog };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/mergeCatalog.test.js` → PASS (2/2). Then `node --test tests/`.

- [ ] **Step 5: Wire merge into `listLocalModels` (lib/local-ai-web.js)**

Add imports near the top of `lib/local-ai-web.js` (with the other imports):

```js
import { RECIPES } from '@/lib/local-runtime/catalog/recipes.js';
import { mergeCatalog } from '@/lib/local-runtime/catalog/mergeCatalog.js';
import { recipeState } from '@/lib/local-runtime/catalog/recipeState.js';
import { resolveEngineRoot, resolveDest } from '@/lib/local-runtime/catalog/engineRoots.js';
```

Add a helper above `listLocalModels` (after `listComfyCheckpoints`, ~line 869):

```js
// True if a ComfyUI custom-node directory exists (used to gate `needs-node` recipes).
function nodeInstalled(dirName) {
  const root = resolveEngineRoot('comfyui', { config: readConfigSafe() });
  // root is .../ComfyUI/models — the custom_nodes dir is a sibling of models.
  return fs.existsSync(path.join(path.dirname(root), 'custom_nodes', dirName));
}
function readConfigSafe() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'config.json'), 'utf8')); } catch { return {}; }
}
```

Change the final return of `listLocalModels` (line 902) from:

```js
  return [...sdcpp, ...comfyCheckpoints, ...external, ...wan2gp, ...ollamaModels, ...lmStudioModels];
```

to:

```js
  const detected = [...sdcpp, ...comfyCheckpoints, ...external, ...wan2gp, ...ollamaModels, ...lmStudioModels];
  const ollamaNames = new Set(ollamaModels.map((m) => m.id.replace(/^ollama:/, '')));
  const config = readConfigSafe();
  const stateFor = (r) => recipeState(r, {
    fileExists: (p) => fs.existsSync(p),
    resolveDest: (d) => resolveDest(resolveEngineRoot(r.engine, { config }), d),
    ollamaModelNames: ollamaNames,
    nodeInstalled,
  });
  return mergeCatalog(detected, RECIPES, stateFor);
```

- [ ] **Step 6: Verify the merged catalog from the running app**

Restart the dev server (CommonJS/ESM module changes need it), then:
```bash
curl -s http://localhost:3005/api/local-ai/models | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const r=j.models.filter(m=>m.installMode==='recipe');console.log('recipe entries:',r.length);console.log(r.map(m=>m.id+' '+m.state).join('\n'))})"
```
Expected: lists the curated recipes not already installed, each with a state (`available` / `ready` / `needs-node`). `comfyui:flux2-klein` should be `ready` (files on disk + GGUF node installed). Installed Ollama models (e.g. `ollama:qwen3`) appear once, from detection.

- [ ] **Step 7: Commit**

```bash
git add lib/local-runtime/catalog/mergeCatalog.js tests/mergeCatalog.test.js lib/local-ai-web.js
git commit -m "feat(model-library): merge curated recipes into listLocalModels"
```

---

## Task 7: Download service (downloadRecipe + progress)

**Files:**
- Modify: `lib/local-ai-web.js` (`downloadFile` at line 732; add `downloadRecipe` + `ollamaPull` near the other exported download fns ~line 950)

- [ ] **Step 1: Add an optional progress callback to `downloadFile`**

In `lib/local-ai-web.js`, change the signature (line 732) and the data handler. Replace:

```js
function downloadFile(url, destPath) {
```
with:
```js
function downloadFile(url, destPath, onProgress) {
```

And inside the `(res) => { ... }` handler, right after the line `const out = fs.createWriteStream(tmpPath, { flags: res.statusCode === 206 ? 'a' : 'w' });` (line 773), insert byte-progress wiring:

```js
        const total = Number(res.headers['content-length']) + existingSize || 0;
        let received = existingSize;
        if (onProgress) res.on('data', (chunk) => { received += chunk.length; if (total > 0) onProgress(Math.min(1, received / total), received, total); });
```

(Existing callers `downloadLocalEngine`/`downloadLocalModel`/`downloadLocalAuxiliary` pass no third arg — `onProgress` is `undefined`, so behavior is unchanged.)

- [ ] **Step 2: Add `ollamaPull` and `downloadRecipe`**

Add near the top imports of `lib/local-ai-web.js`:

```js
import { getRecipe } from '@/lib/local-runtime/catalog/recipes.js';
import { isHostAllowed } from '@/lib/local-runtime/catalog/allowlist.js';
import { parseOllamaPullProgress, aggregateProgress } from '@/lib/local-runtime/catalog/ollamaProgress.js';
```

Add these exported functions (after `downloadLocalAuxiliary`, ~line 966):

```js
// Stream `ollama pull` progress as normalized events.
async function ollamaPull(recipe, onEvent) {
  const res = await fetch('http://127.0.0.1:11434/api/pull', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: recipe.pull, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error('Ollama is not running (start it, then retry).');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      const p = parseOllamaPullProgress(line);
      if (p) onEvent({ type: 'progress', overall: p.percent == null ? undefined : p.percent, status: p.status });
    }
  }
  return { ok: true };
}

// Install a recipe: ollama pull, or download each file into its engine's folder (resumable,
// allowlisted). Emits { type:'progress', overall, file? } and a terminal { type:'needs-node' } | { type:'done' }.
export async function downloadRecipe(recipeId, onEvent = () => {}) {
  const recipe = getRecipe(recipeId);
  if (!recipe) throw new Error(`Unknown recipe: ${recipeId}`);

  if (recipe.engine === 'ollama') {
    await ollamaPull(recipe, onEvent);
    onEvent({ type: 'done', state: 'ready' });
    return { ok: true };
  }

  for (const f of recipe.files) {
    if (!isHostAllowed(f.url)) throw new Error(`Blocked download host: ${new URL(f.url).hostname}`);
  }
  const root = resolveEngineRoot(recipe.engine, { config: readConfigSafe() });
  const fractions = recipe.files.map(() => 0);
  const sizes = recipe.files.map(() => 0);
  for (let i = 0; i < recipe.files.length; i++) {
    const f = recipe.files[i];
    const dest = resolveDest(root, f.dest);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest)) { fractions[i] = 1; onEvent({ type: 'progress', overall: aggregateProgress(fractions, sizes), file: f.dest }); continue; }
    await downloadFile(f.url, dest, (frac, _recv, total) => {
      fractions[i] = frac; sizes[i] = total;
      onEvent({ type: 'progress', overall: aggregateProgress(fractions, sizes), file: f.dest });
    });
    fractions[i] = 1;
  }
  if (recipe.requiresNode && !nodeInstalled(recipe.requiresNode.dir || recipe.requiresNode.name)) {
    onEvent({ type: 'needs-node', node: recipe.requiresNode });
    return { ok: true, needsNode: true };
  }
  onEvent({ type: 'done', state: 'ready' });
  return { ok: true };
}
```

- [ ] **Step 3: Manual integration check (no unit test — real network I/O)**

Restart the dev server. From a Node REPL or a scratch script (run with the app's env), confirm a small Ollama model pulls with progress:
```bash
node -e "import('./lib/local-ai-web.js').then(async m=>{await m.downloadRecipe('ollama:llama3.2',e=>console.log(e.type,e.overall??'',e.status??''));})"
```
Expected: a stream of `progress 0.xx pulling …` lines ending in `done ready`. (Requires Ollama running.) Then `ollama list` shows `llama3.2`.
Note: this is integration, not a unit test — the pure progress math is already covered by Task 5.

- [ ] **Step 4: Commit**

```bash
git add lib/local-ai-web.js
git commit -m "feat(model-library): downloadRecipe (ollama pull + multi-file, allowlisted, resumable)"
```

---

## Task 8: SSE download route

**Files:**
- Modify: `app/api/local-ai/download-model/route.js`

- [ ] **Step 1: Replace the route with an SSE stream (mirrors generate/route.js)**

```js
// app/api/local-ai/download-model/route.js
import { downloadRecipe, downloadLocalModel } from '@/lib/local-ai-web';
import { getRecipe } from '@/lib/local-runtime/catalog/recipes.js';

export async function POST(request) {
  const { modelId } = await request.json().catch(() => ({}));
  if (!modelId) return new Response(JSON.stringify({ error: 'Missing modelId' }), { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        if (getRecipe(modelId)) {
          await downloadRecipe(modelId, send);          // emits progress / needs-node / done
        } else {
          await downloadLocalModel(modelId);            // legacy sdcpp single-file
          send({ type: 'done', state: 'ready' });
        }
      } catch (e) {
        send({ type: 'error', error: e.message });
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

- [ ] **Step 2: Verify the stream end-to-end with curl**

Restart the dev server. Then:
```bash
curl -N -s -X POST http://localhost:3005/api/local-ai/download-model -H 'Content-Type: application/json' -d '{"modelId":"comfyui:flux2-klein"}'
```
Expected: since FLUX.2 files already exist, near-instant `data: {"type":"progress","overall":1,...}` for each file, then `data: {"type":"done","state":"ready"}` and `data: {"type":"end"}`. (Proves the file-present fast path + SSE shape.)

- [ ] **Step 3: Commit**

```bash
git add app/api/local-ai/download-model/route.js
git commit -m "feat(model-library): SSE download route (recipe + legacy fallback)"
```

---

## Task 9: Panel UI — fit badge, grouping, progress, needs-node

**Files:**
- Modify: `components/LocalModelsPanel.js`

> Read the current file first. The model row card is ~lines 233-359; `StatusBadge` ~38-48; `ProviderPill` ~50-56. Reuse them. The component already fetches `/api/local-ai/models` (which now returns `gpu`, `freeMemBytes`, and recipe entries) and tracks `busyId` for in-flight actions.

- [ ] **Step 1: Import the fit helper + add download-progress state**

At the top of `components/LocalModelsPanel.js`:
```js
import { computeFit } from '@/lib/local-runtime/catalog/recipeState.js';
```
Inside the component, add state for streaming progress (next to the existing `busyId`):
```js
const [progress, setProgress] = useState({}); // { [modelId]: { overall, needsNode } }
```

- [ ] **Step 2: Add an SSE download handler for recipe rows**

Add this function in the component (it reads the SSE stream the route now emits):
```js
async function downloadRecipeStreamed(modelId) {
  setBusyId(modelId);
  setProgress((p) => ({ ...p, [modelId]: { overall: 0 } }));
  try {
    const res = await fetch('/api/local-ai/download-model', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelId }),
    });
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl; while ((nl = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, nl); buf = buf.slice(nl + 2);
        const line = chunk.replace(/^data: /, '');
        let evt; try { evt = JSON.parse(line); } catch { continue; }
        if (evt.type === 'progress') setProgress((p) => ({ ...p, [modelId]: { overall: evt.overall ?? p[modelId]?.overall ?? 0 } }));
        if (evt.type === 'needs-node') setProgress((p) => ({ ...p, [modelId]: { ...p[modelId], needsNode: evt.node } }));
        if (evt.type === 'error') setProgress((p) => ({ ...p, [modelId]: { ...p[modelId], error: evt.error } }));
      }
    }
    await refresh(); // existing function that re-fetches /api/local-ai/models
  } finally {
    setBusyId(null);
  }
}
```
(If the existing re-fetch function has a different name than `refresh`, use that name.)

- [ ] **Step 3: Render the fit badge + progress + needs-node for recipe rows**

The models response is available where rows are rendered. Capture `gpu` from the fetch (store it in state as `gpu` when you `setModels(...)`). For a row where `model.installMode === 'recipe'`, render:
- a fit badge: `const fit = computeFit(model.fit, gpu);` → show `✓ fits` (emerald), `⚠ tight` (amber), `✗ too big` (red), or nothing for `unknown`. Reuse the existing tag pill styling.
- the action button: if `model.state === 'ready'` show the green "Ready" pill (existing engineManaged style); else a Download button calling `downloadRecipeStreamed(model.id)`.
- while `busyId === model.id`: a progress bar:
```jsx
{progress[model.id] && busyId === model.id && (
  <div className="mt-2 h-1.5 w-full rounded bg-white/10 overflow-hidden">
    <div className="h-full bg-[#22d3ee] transition-all" style={{ width: `${Math.round((progress[model.id].overall || 0) * 100)}%` }} />
  </div>
)}
```
- if `progress[model.id]?.needsNode` (or `model.state === 'needs-node'`): a small notice `Installed — needs the ComfyUI-GGUF node` with the repo link `model.requiresNode.repo`.

- [ ] **Step 4: Group rows by category**

Where the list is mapped, group by `model.category` (image / chat / video / audio / code) with a section header using the existing uppercase label style (`text-xs font-bold uppercase tracking-wider text-white/30`). Sort sections image → chat → video → audio → other.

- [ ] **Step 5: Manual UI verification**

Restart the dev server, open `http://localhost:3005`, open Settings → Local Models. Expected:
- Recipes appear grouped by category, each with a fit badge and a **Download** button (chat models like Llama 3.2; image models like Juggernaut XL).
- `comfyui:flux2-klein` shows **Ready** (files + node present).
- Clicking Download on `ollama:llama3.2` shows a live progress bar, then flips to Ready (and `ollama list` confirms).

- [ ] **Step 6: Commit**

```bash
git add components/LocalModelsPanel.js
git commit -m "feat(model-library): panel fit badge, category grouping, streamed download progress"
```

---

## Task 10: FLUX.2 workflow in the ComfyUI provider

**Files:**
- Modify: `lib/local-runtime/providers/comfyui.js`
- Test: `tests/comfyuiProvider.test.js` (add cases)

> The exact FLUX.2 node graph must be confirmed against ComfyUI's own example, because GGUF + the Mistral encoder use nodes (`UnetLoaderGGUF`, a FLUX-style `CLIPLoader`) that differ from the SD/SDXL `CheckpointLoaderSimple` graph already in `buildWorkflow`.

- [ ] **Step 1: Capture the real FLUX.2 graph from the running ComfyUI**

Restart ComfyUI (so it loads the now-installed ComfyUI-GGUF node), then confirm the node classes exist and read their input names:
```bash
curl -s http://127.0.0.1:8188/object_info/UnetLoaderGGUF | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(JSON.stringify(Object.keys(j),null,0));console.log(JSON.stringify(j.UnetLoaderGGUF?.input?.required||{}))})"
curl -s http://127.0.0.1:8188/object_info/CLIPLoader | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(JSON.stringify(j.CLIPLoader?.input?.required||{}))})"
```
Expected: `UnetLoaderGGUF` present with a `unet_name` input; `CLIPLoader` has `clip_name` + a `type` enum that includes a flux/flux2 option. Record the exact input keys and the correct `type` value — these feed Step 3. (If `UnetLoaderGGUF` is absent, ComfyUI didn't load the GGUF node — fix that before continuing.)

- [ ] **Step 2: Write the failing snapshot test**

```js
// add to tests/comfyuiProvider.test.js
const { buildFlux2Workflow } = require('../lib/local-runtime/providers/comfyui.js');

test('buildFlux2Workflow: GGUF unet + mistral clip + flux2 vae graph', () => {
  const wf = buildFlux2Workflow({
    prompt: 'a fox', width: 1024, height: 1024, steps: 20, seed: 7,
    unetName: 'flux-2-klein-base-9b-Q4_K_M.gguf',
    clipName: 'mistral_3_small_flux2_fp8.safetensors',
    vaeName: 'flux2-vae.safetensors',
  });
  const types = Object.values(wf).map((n) => n.class_type);
  assert.ok(types.includes('UnetLoaderGGUF'), 'uses GGUF unet loader');
  assert.ok(types.includes('CLIPLoader'), 'uses CLIPLoader for mistral');
  assert.ok(types.includes('VAELoader'), 'loads flux2 vae');
  assert.ok(types.includes('VAEDecode') && types.includes('SaveImage'), 'decodes + saves');
  // the gguf unet name is wired in
  assert.ok(JSON.stringify(wf).includes('flux-2-klein-base-9b-Q4_K_M.gguf'));
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/comfyuiProvider.test.js`
Expected: FAIL — `buildFlux2Workflow is not a function`.

- [ ] **Step 4: Implement `buildFlux2Workflow` using the classes confirmed in Step 1**

Add to `lib/local-runtime/providers/comfyui.js` (adjust `type` / input keys to exactly match Step 1's output):

```js
// Pure: FLUX.2 GGUF txt2img graph — GGUF unet + single Mistral text encoder + flux2 VAE.
function buildFlux2Workflow({ prompt, negativePrompt = '', width = 1024, height = 1024, steps = 20, cfg = 1, seed = 0, unetName, clipName, vaeName, samplerName = 'euler', scheduler = 'simple' }) {
  return {
    '10': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: unetName } },
    '11': { class_type: 'CLIPLoader', inputs: { clip_name: clipName, type: 'flux2' } },
    '12': { class_type: 'VAELoader', inputs: { vae_name: vaeName } },
    '6':  { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['11', 0] } },
    '7':  { class_type: 'CLIPTextEncode', inputs: { text: negativePrompt, clip: ['11', 0] } },
    '5':  { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '3':  { class_type: 'KSampler', inputs: { seed, steps, cfg, sampler_name: samplerName, scheduler, denoise: 1, model: ['10', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    '8':  { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['12', 0] } },
    '9':  { class_type: 'SaveImage', inputs: { filename_prefix: 'app', images: ['8', 0] } },
  };
}
```

Then make `generate()` pick the workflow by the model's `workflow` field. Update the `generate` signature and body so `model.workflow === 'flux2'` builds the flux2 graph with the recipe's file names. Export the new function:

```js
module.exports = { buildWorkflow, buildFlux2Workflow, findOutputImage, viewUrl, dims, resolveSeed, generate };
```

And in `lib/local-runtime/providers/index.js`, the `comfyui:` branch must pass `workflow` + file names from the recipe to the provider. Update the branch (currently lines 11-18) to look up the recipe:

```js
if (typeof modelId === 'string' && modelId.startsWith('comfyui:')) {
  const { getRecipe } = require('../catalog/recipes.js');
  const recipe = getRecipe(modelId);
  const ckptName = modelId.slice('comfyui:'.length);
  return {
    entry: { id: modelId, provider: 'comfyui', kind: 'image', ckptName },
    generate: (params, onProgress, opts) =>
      comfyui.generate({ model: { ckptName, recipe, sampler: params.sampler, scheduler: params.scheduler }, params }, onProgress, opts),
  };
}
```

In `comfyui.js` `generate()`, branch on `model.recipe?.workflow === 'flux2'`: build with `buildFlux2Workflow({ ..., unetName: <recipe unet dest basename>, clipName: <text_encoder basename>, vaeName: <vae basename> })`. Derive the basenames from the recipe's `files[].dest`.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/comfyuiProvider.test.js` → PASS. Then `node --test tests/` (full suite green).

- [ ] **Step 6: End-to-end — generate a FLUX.2 image through the app**

Ensure ComfyUI is running (restarted with the GGUF node). Open `http://localhost:3005` → Image Studio → switch to local → pick **FLUX.2 Klein (ComfyUI)** → prompt "a red fox in snow, cinematic" → Generate.
Expected: an image returns (first run slower — the 18 GB Mistral encoder loads into RAM; subsequent runs faster). If ComfyUI's console shows a missing-node or VAE error, re-check Step 1's class names/`type` and fix `buildFlux2Workflow`.

- [ ] **Step 7: Commit**

```bash
git add lib/local-runtime/providers/comfyui.js lib/local-runtime/providers/index.js tests/comfyuiProvider.test.js
git commit -m "feat(model-library): FLUX.2 GGUF workflow + provider selection"
```

---

## Final verification

- [ ] `node --test tests/` — all green (baseline 112 + new ~17 = ~129).
- [ ] Settings → Local Models: recipes grouped by category, fit badges, Download works with a live bar; FLUX.2 Klein shows Ready.
- [ ] Download a fresh Ollama model end-to-end; it flips to Ready and appears for chat use later.
- [ ] Generate a FLUX.2 image in Image Studio.
- [ ] Dispatch a final code review (subagent-driven-development's final reviewer) before finishing the branch.

## Notes / deferred (out of scope for this plan)

- Auto-installing ComfyUI custom nodes from the server (v1 shows a notice + repo link; ComfyUI-GGUF was installed manually).
- Dynamic HuggingFace/Ollama-registry search (curated catalog only here).
- Byte-accurate progress for `ollama pull` per-layer (we surface Ollama's own `completed/total`).
- A GGUF-quantized Mistral encoder to speed FLUX.2 text-encode (swap-in later).
