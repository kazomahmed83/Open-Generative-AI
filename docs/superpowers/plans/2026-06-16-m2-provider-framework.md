# M2 — Provider Framework (generic API providers + Ollama + unified catalog + settings)

> Executed subagent-driven, same as M0/M1. Builds on the M0 runtime. Steps use `- [ ]`.
> Roadmap: [`2026-06-16-local-first-platform-roadmap.md`](./2026-06-16-local-first-platform-roadmap.md).

**Goal:** Complete the provider abstraction so the Studio's **Local / API toggle** is real and generic: local providers (sdcpp now, Ollama added) **and** a generic **bring-your-own API** kind (OpenAI-compatible, **not** MuAPI). One unified model catalog; a Providers settings panel to add API providers + keys; the API catalog grows over time.

**Architecture:** Extend `lib/local-runtime/` (CommonJS). A `config.js` persists user-defined API providers to `.local-ai/config.json` (gitignored). `catalog.js` becomes source-agnostic: it merges local sdcpp entries + configured API-provider models (+ available Ollama models). `providers/index.js` resolves `local` and `api` providers uniformly. A `/api/local-ai/providers` route does CRUD; a Providers settings panel edits them. The Image Studio "API" branch shows configured API image models and generates through them.

**Tech stack:** Node 25 CJS · `fetch` (Node global) for HTTP providers · OpenAI-compatible REST (`/v1/chat/completions`, `/v1/images/generations`) as the generic API contract (covers OpenAI, Together, Groq, OpenRouter, Fireworks, LM Studio, vLLM, …) · Ollama `/api/generate`/`/api/tags`.

## ENVIRONMENT CONTRACT (unchanged from M0 — verified)
- `lib/local-runtime/*` = **CommonJS** (`require`/`module.exports`), no Next/Electron imports. Routes = ESM `runtime='nodejs'`. Tests `require()` directly; run `node --test "tests/*.test.js"`. Currently **35 pass**.

## Locked design decisions
1. **API providers are OpenAI-compatible by default.** A provider config = `{ id, name, kind: 'image'|'chat', baseUrl, apiKey, models: [{ id, name }] }`. The adapter calls the standard OpenAI route for that kind. This is the 80% case and keeps M2 bounded; a `requestTemplate` escape hatch can come later.
2. **Config lives in `.local-ai/config.json`** (gitignored), schema `{ providers: [...] }`. Never committed; keys never logged.
3. **Catalog is unified + source-tagged.** Every entry: `{ id, name, source: 'local'|'api', provider, kind, params?, ready }`. The Studio toggle filters by `source`. API model ids are namespaced `api:<providerId>:<modelId>` to avoid collisions; local ids stay bare.
4. **Ollama** is a `local` provider of `kind:'chat'` (text). It has no Image-Studio surface yet — it's foundation for Agents/architect — but M2 wires the adapter + registry + catalog so it's callable and listed.
5. **The generate route stays SSE.** API image providers are request/response (no streaming progress) — the adapter emits a single synthetic `progress` then the `result`. Contract to the client is identical.

---

### Task 1: `lib/local-runtime/config.js` — provider config store
**Files:** create `lib/local-runtime/config.js`; test `tests/localRuntimeConfig.test.js`.

- [ ] **Test first:**
```js
// tests/localRuntimeConfig.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const cfg = require('../lib/local-runtime/config.js');

function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogai-'));
  const prev = process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR;
  process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR = dir;
  try { fn(dir); } finally {
    if (prev === undefined) delete process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR;
    else process.env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR = prev;
  }
}

test('defaults to empty providers when no config file', () => {
  withTmp(() => { assert.deepStrictEqual(cfg.listProviders(), []); });
});

test('upsertProvider adds then updates by id; deleteProvider removes', () => {
  withTmp(() => {
    cfg.upsertProvider({ id: 'p1', name: 'Together', kind: 'image', baseUrl: 'https://api.together.xyz', apiKey: 'k', models: [{ id: 'flux', name: 'FLUX' }] });
    assert.strictEqual(cfg.listProviders().length, 1);
    cfg.upsertProvider({ id: 'p1', name: 'Together 2', kind: 'image', baseUrl: 'https://x', apiKey: 'k2', models: [] });
    assert.strictEqual(cfg.listProviders()[0].name, 'Together 2');
    cfg.deleteProvider('p1');
    assert.deepStrictEqual(cfg.listProviders(), []);
  });
});

test('listProvidersSafe strips apiKey', () => {
  withTmp(() => {
    cfg.upsertProvider({ id: 'p1', name: 'X', kind: 'chat', baseUrl: 'b', apiKey: 'secret', models: [] });
    const safe = cfg.listProvidersSafe();
    assert.strictEqual(safe[0].apiKey, undefined);
    assert.strictEqual(safe[0].hasApiKey, true);
  });
});
```
- [ ] **Implement:**
```js
// lib/local-runtime/config.js
const fs = require('fs');
const path = require('path');
const { getPaths } = require('./paths.js');

function configPath() { return path.join(getPaths().dataDir, 'config.json'); }

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); }
  catch { return { providers: [] }; }
}
function writeConfig(c) {
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(c, null, 2));
}

function listProviders() { return readConfig().providers || []; }
function getProvider(id) { return listProviders().find((p) => p.id === id) || null; }
function listProvidersSafe() {
  return listProviders().map(({ apiKey, ...rest }) => ({ ...rest, hasApiKey: !!apiKey }));
}
function upsertProvider(provider) {
  const c = readConfig();
  c.providers = (c.providers || []).filter((p) => p.id !== provider.id);
  c.providers.push(provider);
  writeConfig(c);
  return provider;
}
function deleteProvider(id) {
  const c = readConfig();
  c.providers = (c.providers || []).filter((p) => p.id !== id);
  writeConfig(c);
}

module.exports = { listProviders, getProvider, listProvidersSafe, upsertProvider, deleteProvider };
```
- [ ] Run `node --test tests/localRuntimeConfig.test.js` → PASS. Commit `feat(runtime): provider config store`.

---

### Task 2: generalize `catalog.js` to merge local + API entries
**Files:** modify `lib/local-runtime/catalog.js`; modify `tests/localRuntimeCatalog.test.js`.

- [ ] Keep `normalizeSdcpp` but add `normalizeApiModel(provider, model)` → `{ id: \`api:${provider.id}:${model.id}\`, name: model.name, source: 'api', provider: provider.id, kind: provider.kind, ready: true, apiModelId: model.id }`. `listCatalog()` returns `[...sdcpp, ...apiFromConfig]` (read via `config.listProviders()`). `getCatalogEntry(id)` resolves both (bare id → sdcpp; `api:*` → api entry, attaching the resolved provider config for the registry).
- [ ] Add tests: an upserted API provider's models appear in `listCatalog()` with `source:'api'` and the namespaced id; `getCatalogEntry('api:p1:flux')` resolves and carries the provider. Existing sdcpp tests stay green.
- [ ] Run tests → PASS. Commit `feat(runtime): unified catalog (local + api)`.

---

### Task 3: `lib/local-runtime/providers/ollama.js` — chat adapter
**Files:** create `providers/ollama.js`; test `tests/ollamaProvider.test.js`.
- [ ] Pure helper `buildOllamaRequest({ model, params })` → `{ url, body }` for `POST <base>/api/generate` with `{ model, prompt, stream:false }` (base default `http://127.0.0.1:11434`). Unit-test the pure builder. `generate({model,params}, onProgress, opts)` does the fetch, returns `{ text }` (chat has no image). Register `ollama` in `providers/index.js`. (No Image-Studio wiring; foundation only.)
- [ ] Commit `feat(runtime): ollama chat provider`.

---

### Task 4: `lib/local-runtime/providers/api.js` — generic OpenAI-compatible adapter
**Files:** create `providers/api.js`; test `tests/apiProvider.test.js`.
- [ ] Pure `buildOpenAiImageRequest(provider, apiModelId, params)` → `{ url: \`${baseUrl}/v1/images/generations\`, headers: { Authorization: \`Bearer ${apiKey}\` }, body: { model: apiModelId, prompt, size } }` and `buildOpenAiChatRequest(...)` → `/v1/chat/completions`. Unit-test both builders (URL, auth header, body shape; **assert the apiKey is only in the header, never logged**).
- [ ] `generate(entry, params, onProgress)` (entry carries the provider): emit one `{step:1,totalSteps:1}` progress, POST the request, parse the OpenAI image response (`data[0].url` or `b64_json`), if b64 → `saveAsset` and return `{buffer|url, ext, seed}` in the runtime's standard shape. Register `api` provider in `providers/index.js` (keyed by `entry.source==='api'`).
- [ ] Commit `feat(runtime): generic OpenAI-compatible API provider`.

---

### Task 5: `/api/local-ai/providers` route (CRUD) + registry resolution for api
**Files:** create `app/api/local-ai/providers/route.js` (GET list-safe, POST upsert, DELETE); ensure `providers/index.js#resolveProvider` handles `api:*` ids (look up the entry's provider config, dispatch to `providers/api.js`).
- [ ] GET → `config.listProvidersSafe()`. POST body `{ provider }` → `config.upsertProvider`. DELETE `?id=` → `config.deleteProvider`. Return safe (no keys).
- [ ] Commit `feat(api): providers CRUD route`.

---

### Task 6: Providers settings panel
**Files:** create `components/ProvidersPanel.js` (mirror `LocalModelsPanel.js` style); mount it in the Settings modal next to Local Models (`StandaloneShell.js`).
- [ ] List configured providers (from GET), a form to add one (name, kind image/chat, baseUrl, apiKey, models list), save (POST), delete. Keys are write-only (show "•••• set").
- [ ] Commit `feat(studio): Providers settings panel`.

---

### Task 7: Image Studio "API" path uses configured API image models
**Files:** modify `packages/studio/src/components/ImageStudio.jsx`.
- [ ] The model fetch already hits `/api/local-ai/models` for local; add a fetch of `/api/local-ai/catalog?source=api&kind=image` (a tiny new catalog route, or extend models route) so the **API** side of the toggle lists configured API image models (in addition to / instead of the MuAPI list). Generate via `localApi.generateImage(apiModelId, …)` which already routes to `/api/local-ai/generate` → registry resolves `api:*`. Keep the MuAPI list as a fallback group if present.
- [ ] Commit `feat(studio): API providers in Image Studio model list`.

---

### Task 8: Verify (gate)
- [ ] Unit tests green (config, catalog merge, ollama builder, api builders).
- [ ] Add a dummy API provider in Settings (e.g. a local mock or LM Studio if available) → it appears under the Image Studio **API** toggle; selecting + generating routes through the generic adapter. If no real endpoint is available, verify the request-building + routing with a stub and document that a live API key is needed for a full image.
- [ ] Ollama: if installed, list models; otherwise the catalog shows it unavailable. Confirm `buildOllamaRequest` + a real `/api/generate` returns text when Ollama is running.

## Pre-M2 carry-ins (from the M0/M1 final review)
- Thread the server asset **`key`** through `local-api.js` result → ImageStudio entry id (cheap correctness; do in Task 7's edit).
- Defer the `jobs.js` ↔ generate-route SSE-schema unification to when `jobs.js` is first wired into a reconnectable route (M6/M7), not M2.

## Notes
- API keys: stored in `.local-ai/config.json` (gitignored), returned only via `listProvidersSafe` (stripped). Never log request bodies/headers for API providers.
- Security: validate `baseUrl` is http(s); the generic adapter performs outbound requests to user-configured hosts (expected) — keep it user-driven only (no SSRF from untrusted input).
