# Model Library — Design Spec

**Date:** 2026-06-17
**Status:** Approved (design); ready for implementation plan
**Sub-project:** #1 of 5 in the local-first agentic roadmap (Model Library → Chat Studio → Agentic Engine → Website/Brand Builder → Video/Audio providers)

---

## Goal

Give the app an in-app **Model Library**: a curated catalog of downloadable models that the user can install from inside Settings — Ollama chat models (`ollama pull`), ComfyUI image checkpoints, and multi-file bundles like FLUX.2 — so the model panel shows models that are *available to download*, not only the handful already installed. This fixes the current "only 2 models show, I can't download anything" problem and creates the **capability menu** that the later Agentic Engine reads.

## Background / why this is an extension, not a new build

A repo audit (4 parallel explorations) + a GitHub diff against the upstream original (`Anil-matcha/Open-Generative-AI`) established that ~70% of the plumbing already exists. Our fork added an entire local-first layer; only `ImageStudio.jsx` + `StandaloneShell.js` were modified from the original. Everything below is reuse unless marked **NEW**.

| Capability | Already exists | File |
|---|---|---|
| Download w/ resume + retry + redirects | `downloadFile()` | `lib/local-ai-web.js` (web), `electron/lib/localInference.js` |
| Multi-file model download | `download-auxiliary` route + `ZIMAGE_AUXILIARY` | `app/api/local-ai/download-auxiliary/route.js`, `electron/lib/modelCatalog.js` |
| Install-state detection | `getModelState()`, `listComfyCheckpoints()`, `listOllamaModels()` | `electron/lib/localInference.js`, `lib/local-ai-web.js` |
| Engine probes (Ollama/ComfyUI/…) | `getLocalEngines()`, `probeJson()` | `lib/local-ai-web.js` |
| SSE progress streaming | `ReadableStream` `data: {…}\n\n` | `app/api/local-ai/generate/route.js` |
| Model rows / badges / Download-Delete buttons | `LocalModelsPanel.js` | `components/LocalModelsPanel.js` |
| Browse/search UI pattern | `ProvidersPanel` browse | `components/ProvidersPanel.js` |
| GPU + free-mem reporting | `gpu`, `freeMemBytes` in models route | `app/api/local-ai/models/route.js`, `lib/local-runtime/gpu.js` |
| ComfyUI txt2img workflow | `buildWorkflow()` | `lib/local-runtime/providers/comfyui.js` |
| Model id conventions | `comfyui:<ckpt>`, `ollama:<name>`, `api:<prov>:<id>` | `lib/local-runtime/providers/index.js` |

## Non-goals (YAGNI)

- No dynamic HuggingFace/Ollama-registry *search* in v1 (curated catalog only; search is a later follow-up).
- No auto-installation of third-party ComfyUI nodes without explicit per-action user consent.
- No changes to the cloud (MuAPI) studios; this is local-first model acquisition only.
- No new top-level UI surface — extend the existing Settings `LocalModelsPanel`.

---

## Architecture

```
LocalModelsPanel (Settings)
  └─ GET /api/local-ai/models  ──►  listLocalModels() + curated recipes (merged, deduped by id)
        each entry: { …existing fields…, recipeState, fit }
  └─ Download click ──► POST /api/local-ai/download-model { id }   (SSE progress)
        └─ resolveRecipe(id)
            ├─ engine 'ollama'  → ollama pull (stream JSON progress)
            └─ engine 'comfyui'/'sdcpp' → for each file: downloadFile(url → engineRoot/dest)  [resume]
                └─ requiresNode present & not installed → emit { type:'needs-node' } (no auto-install)
  └─ Generate (ImageStudio) ──► provider picks workflow by recipe.workflow ('sdxl' | 'flux2')
```

### Component 1 — Curated recipe catalog **(NEW)**

`lib/local-runtime/catalog/recipes.js` — a pure data module exporting `RECIPES` (array) and helpers. Each recipe extends the existing `modelCatalog.js` entry DNA with `engine`, `fit`, `workflow`, `files[]`/`pull`, `requiresNode`.

```js
// Image / ComfyUI multi-file bundle
{
  id: 'comfyui:flux2-klein',
  name: 'FLUX.2 Klein (9B)',
  description: 'Distilled 9B FLUX.2, Apache-licensed. Fits 12 GB as Q4 GGUF.',
  category: 'image',                 // image | chat | video | audio
  engine: 'comfyui',                 // comfyui | ollama | sdcpp
  provider: 'comfyui',               // for ProviderPill
  sizeBytes: 24_280_000_000,         // sum of all files (gguf 5.9 + mistral 18 + vae 0.34)
  fit: { minVramGb: 8, recVramGb: 12 },
  workflow: 'flux2',
  files: [
    { url: 'https://huggingface.co/unsloth/FLUX.2-klein-base-9B-GGUF/resolve/main/flux-2-klein-base-9b-Q4_K_M.gguf', dest: 'unet/flux-2-klein-base-9b-Q4_K_M.gguf' },
    { url: 'https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/text_encoders/mistral_3_small_flux2_fp8.safetensors', dest: 'text_encoders/mistral_3_small_flux2_fp8.safetensors' },
    { url: 'https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors', dest: 'vae/flux2-vae.safetensors' },
  ],
  requiresNode: { name: 'ComfyUI-GGUF', repo: 'https://github.com/city96/ComfyUI-GGUF' },
}

// Chat / Ollama single pull
{
  id: 'ollama:qwen3',
  name: 'Qwen3 (8B)',
  description: 'Strong general + reasoning chat model.',
  category: 'chat',
  engine: 'ollama',
  provider: 'ollama',
  sizeBytes: 5_200_000_000,
  fit: { minVramGb: 6, recVramGb: 8 },
  pull: 'qwen3',
}
```

**Field semantics**
- `engine` selects the download mechanism and the install-root.
- `files[].dest` is **relative to the engine's model root** (e.g. ComfyUI's `models/`), so the catalog is machine-independent.
- `pull` (ollama only) is the `ollama pull` argument.
- `requiresNode` is advisory metadata — it never triggers an install; the download route surfaces it as a `needs-node` state for explicit user consent.
- `workflow` tells the ComfyUI provider which graph builder to use.

### Component 2 — Engine root resolution **(NEW, small)**

`lib/local-runtime/catalog/engineRoots.js` — `resolveEngineRoot(engine, config)`:
- `comfyui` → `config.comfyuiModelsDir` or env `COMFYUI_MODELS_DIR`, default to the detected portable path `F:/AI/ComfyUI_windows_portable/ComfyUI/models` (stored in `.local-ai/config.json` under `engines.comfyui.modelsDir`).
- `sdcpp` → existing `MODELS_DIR` (`~/.local-ai/models`).
- `ollama` → not file-based (uses `ollama pull`).

### Component 3 — Install-state detector **(NEW, pure, TDD)**

`lib/local-runtime/catalog/recipeState.js`:
- `recipeState(recipe, ctx)` where `ctx = { fileExists(absPath)->bool, ollamaModelNames:Set, nodeInstalled(name)->bool }` →
  `'ready' | 'partial' | 'available' | 'needs-node'`.
  - file recipe: all dests exist → if `requiresNode` and not installed → `needs-node`, else `ready`; some dests exist → `partial`; none → `available`.
  - ollama recipe: `pull` base name in `ollamaModelNames` → `ready`, else `available`.
- `computeFit(fit, gpu)` → `'fits' | 'tight' | 'too-big' | 'unknown'` from the `gpu.freeVramBytes` (or `freeMemBytes`) already returned by the models route.

### Component 4 — Download service **(extend existing route)**

Extend `app/api/local-ai/download-model/route.js` to accept a recipe id and stream over the **existing SSE pattern**:
- `resolveRecipe(id)` from the curated catalog (falls back to the legacy sdcpp `modelCatalog` for existing ids — no regression).
- `engine === 'ollama'`: POST Ollama `/api/pull` (`{ name, stream:true }`) and forward each JSON progress line → `{ type:'progress', recipeId, completed, total, status }`.
- `engine` file-based: for each `file`, `downloadFile(url, join(root, dest), onProgress)`; emit per-file + aggregate progress.
- **Security:** every `file.url` host validated against an allowlist (`huggingface.co`, `*.hf.co`, ollama registry). Reject otherwise with `{ type:'error' }`.
- `requiresNode` present: files are always safe to fetch (the node is only needed to *run* the model), so the route downloads all files first, then — if the node is not installed — emits a terminal `{ type:'needs-node', node }`. v1 surfaces this as a notice; it never auto-installs the node (see Component 5).

`isHostAllowed(url, allowlist)` is a pure, TDD'd helper.

### Component 5 — Panel surfacing **(extend `LocalModelsPanel.js`)**

- The models route merges curated recipes into the returned `models` (deduped by `id`; an installed model keeps its detected state).
- Rows render via the existing card; add: a **fit badge** (`✓ fits` emerald / `⚠ tight` amber / `✗ too big` red) from `computeFit`, and a **multi-file progress bar** during download (driven by SSE).
- `needs-node` rows show an inline notice "Installed — needs ComfyUI-GGUF node" with the repo link. **v1 decision: node install stays a manual/CLI step** (the web server never executes third-party installs); auto-install via a dedicated consent flow is a later iteration.
- Group rows by `category` with the existing section styling.

### Component 6 — FLUX.2 workflow **(extend `comfyui.js`)**

Add `buildFlux2Workflow({prompt, negativePrompt, width, height, steps, cfg, seed, unetName, textEncoderName, vaeName})` returning the FLUX.2 GGUF graph: `UnetLoaderGGUF` (unet) + `CLIPLoader`(mistral, type flux2) + `VAELoader`(flux2-vae) + flux sampling nodes + `VAEDecode` + `SaveImage`. The provider's `generate()` selects `buildFlux2Workflow` vs `buildWorkflow` by `recipe.workflow`. Exact ComfyUI node `class_type`s are verified against ComfyUI's FLUX.2 example workflow during implementation. ComfyUI requires a restart to load the GGUF node (already installed).

---

## v1 curated catalog

- **Image / ComfyUI:** `flux2-klein` (downloaded), `sd_xl_base_1.0` (present), `dreamshaper_8` (present), + downloadable `juggernaut-xl`, `flux1-schnell`.
- **Chat / Ollama (downloadable):** `qwen3`, `llama3.2`, `mistral`, `phi4`, `gemma2`, `deepseek-r1`, `qwen2.5-coder`.
- **sdcpp:** existing `modelCatalog.js` entries surfaced through the same merged list (no change to their download path).

---

## Testing (TDD — matches existing `node --test tests/*.test.js`, currently 112 passing)

Pure functions, each RED→GREEN→REFACTOR:
- `recipeState()` — ready/partial/available/needs-node across comfyui + ollama recipes.
- `computeFit()` — fits/tight/too-big/unknown vs gpu free VRAM.
- `resolveEngineRoot()` — config + env + default precedence.
- `resolveDest()` — joins engine root + `file.dest` correctly per platform.
- `isHostAllowed()` — allow huggingface/ollama, reject arbitrary hosts.
- `parseOllamaPullProgress()` — `{completed,total,status}` → percent, dedupe.
- `buildFlux2Workflow()` — snapshot of the node graph (like the existing `buildWorkflow` test).
- `mergeCatalog()` — curated recipes merged with detected models, dedup by id, installed state wins.

---

## Security

- API keys remain only in gitignored `.local-ai/config.json`; never committed.
- Download URLs host-allowlisted; no arbitrary fetch.
- Third-party ComfyUI nodes are never auto-installed by the server; install requires explicit user action (consent already demonstrated for ComfyUI-GGUF).
- `.local-ai/`, model files, and large binaries stay gitignored.

## Rollout / order of implementation

1. Pure helpers + tests (`recipeState`, `computeFit`, `resolveEngineRoot`, `resolveDest`, `isHostAllowed`, `parseOllamaPullProgress`).
2. `recipes.js` curated catalog + `mergeCatalog` into the models route.
3. Extend `download-model` route: ollama pull + multi-file engine-aware download + SSE + allowlist.
4. `LocalModelsPanel` surfacing: fit badge, grouping, multi-file progress, needs-node text.
5. `buildFlux2Workflow` + provider selection; restart ComfyUI; verify FLUX.2 generates end-to-end via the app.
6. Full `node --test` green; manual end-to-end (download an Ollama model + generate a FLUX.2 image through the app).
