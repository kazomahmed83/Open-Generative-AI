# Pluggable API-Provider Adapter (Recipe Engine) — Design

> **Status:** Approved design (brainstorming complete). Next: implementation plan via `writing-plans`.
> **Date:** 2026-06-16 · **Author:** subagent-driven session · **Milestone:** M3.5 (extends M2 provider framework)

## Goal
Replace the hard-coded OpenAI-only API adapter with a **declarative "recipe" engine** so a user can add **any** bring-your-own-key provider — including non-OpenAI-shaped ones (Google Gemini, Stability AI) — from the UI, with **no code change**. Keep the common (OpenAI-compatible) path one-click, and keep everything local-first and secret-free.

## Background / current state
- `lib/local-runtime/providers/api.js` hard-codes OpenAI's conventions: `Authorization: Bearer`, fixed paths (`/v1/images/generations`, `/v1/chat/completions`), a fixed image body (`size`, `response_format`), and fixed result locations (`data[0].b64_json`, `choices[0].message.content`).
- `components/ProvidersPanel.js` collects: Name, one Type (image|chat) **per provider**, Base URL, API key, and a `model-id|Display Name` list.
- This works for OpenAI-compatible providers but cannot express: different auth (Gemini `?key=` / `x-goog-api-key`), different paths/bodies (Stability multipart), different response shapes (Gemini nested base64), or a provider that offers **both** image and chat.

This design was validated by a research pass over **9 real providers** (OpenAI, Together, SiliconFlow, Groq, OpenRouter, DeepSeek, Moonshot, plus the two deliberate non-OpenAI stress-tests **Stability AI** and **Google Gemini**). A single recipe format expressed **all nine**, including both stress-tests, with **no per-provider code**.

## Approach: declarative recipe engine
A **recipe** is plain data describing one provider+kind. The engine performs three mechanical jobs:
1. **Substitute** `{{placeholders}}` into a body/path template.
2. **Attach auth** per the recipe's auth style.
3. **Read the result** from a named, read-only path.

Recipes are shipped as **built-in presets** and can be **pasted/edited in an Advanced UI field**, so new providers need no code release.

### Files
- **New:** `lib/local-runtime/providers/recipe-engine.js` — pure helpers: `substitute(template, values)`, `readResult(response, recipe)`, `buildRequest(recipe, provider, apiModelId, params)`; plus `runRecipe(...)` performing the HTTP call.
- **New:** `lib/local-runtime/providers/presets.js` — the 9 built-in provider presets (base URL, auth, models, recipes) + the `openai-compatible` **default recipe**.
- **Refactor:** `lib/local-runtime/providers/api.js` — `generate()` becomes "resolve recipe → `runRecipe` → return `{buffer,ext,seed}` (image) or `{text}` (chat)." Current behavior becomes the default recipe so nothing breaks.
- **Modify:** `components/ProvidersPanel.js` — presets dropdown, per-model Type, Test button, Advanced (clone-a-preset + raw JSON).
- **Modify (small):** `lib/local-runtime/config.js` (store optional recipe fields), `lib/local-runtime/catalog.js` (`normalizeApiModel` already keys by `kind`; ensure per-model kind), `app/api/local-ai/providers/route.js` (accept recipe fields; validation), and a new `POST /api/local-ai/providers/test` for the Test button.

## The recipe schema (12 fields; most optional with defaults)

| Field | Type | Required | Purpose |
|---|---|---|---|
| `kind` | `"image" \| "chat"` | yes | Selects request builder + result handler. |
| `path` | string | yes | Appended to `baseUrl`. May contain `{model}` and (for `query` auth) `{apiKey}`. |
| `method` | string (default `POST`) | no | All 9 are POST. |
| `bodyType` | `"json" \| "multipart"` (default `json`) | no | `multipart` ⇒ FormData with library-set boundary (Stability). |
| `authStyle` | `"bearer" \| "header" \| "query"` (default `bearer`) | yes | `bearer` ⇒ `Authorization: Bearer {apiKey}`; `header` ⇒ custom header; `query` ⇒ `{apiKey}` substituted into `path`. |
| `authHeader` | string | no | Header name when `authStyle="header"` (e.g. `x-goog-api-key`). |
| `headers` | object<string,string> | no | Static extra headers (e.g. Stability `Accept`, OpenRouter `X-Title`). Do **not** set `Content-Type` for multipart. |
| `body` | object (template) | yes | JSON tree (json) or flat field map (multipart) with placeholders. |
| `resultPath` | string (path expr) | yes | Where the result lives. Supports `@binary` and `[*]` wildcard. |
| `resultType` | image: `"base64"\|"url"\|"binary"`; chat: `"text"` | yes | How to interpret `resultPath`. |
| `resultMimePath` | string (path expr) | no | Sibling path to a MIME string → file extension (Gemini). |
| `selectWithField` | string | no | For `[*]` arrays: pick the element that **has** this sub-field (Gemini `inlineData`). |

### Placeholder syntax
Double-brace tokens `{{name}}` inside string values of `body` and `path`. The engine deep-walks the template:
- A string that is **exactly one token** (e.g. `"{{messages}}"`) is replaced by the token's **native value** (array/object/number survive).
- Tokens embedded in a larger string are stringified in place.
- A token with **no supplied value is dropped** (its key removed) so optional fields stay optional.
- `{apiKey}` (single brace) is reserved for `path` substitution under `authStyle="query"`/`"header"`, so it is never confused with body tokens.

**Supported tokens:** `{{prompt}}`, `{{model}}` (the apiModelId; also `{model}` in `path`), `{{messages}}` (chat array; if absent the engine synthesizes `[{role:"user",content:"<prompt>"}]`), `{{size}}` (`WxH`), `{{width}}`/`{{height}}` (ints), `{{aspect_ratio}}`, `{{seed}}`, `{{negative_prompt}}`, `{{steps}}`, `{{n}}`, `{{system}}`.

### Result-path syntax
Dot/bracket JSON path with zero-based indexes: `choices[0].message.content`, `data[0].b64_json`, `images[0].url`, `image`. Three image specials:
1. **`@binary`** — the entire HTTP response body is the image bytes (no JSON parse); pair with `resultType:"binary"` (Stability `Accept: image/*`).
2. **`[*]` + `selectWithField`** — select the first array element containing a named sub-field, e.g. `candidates[0].content.parts[*].inlineData.data` + `selectWithField:"inlineData"` (Gemini).
3. **`resultMimePath`** — a sibling path to the MIME string (e.g. `…inlineData.mimeType`).

Paths are **read-only traversal and never execute code.**

### Engine behavior by `resultType`
- `text` → return `{ text: <resultPath string> }`.
- `base64` → decode `resultPath` → `{ buffer, ext, seed }` (ext from `resultMimePath` or default `png`).
- `url` → fetch `resultPath` server-side, download bytes → `{ buffer, ext, seed }` (handles ~1h-expiring URLs from SiliconFlow/Together/DALL·E).
- `binary` → `res.arrayBuffer()` is the image → `{ buffer, ext, seed }` (skip JSON parse).

For `bodyType:"multipart"` the engine builds `FormData`, lets the runtime set `Content-Type` with boundary, and emits a dummy part if there is no file part (Stability multipart gotcha).

## Default recipe + backward compatibility
A built-in **`openai-compatible` default recipe pair** equals today's behavior:
```jsonc
// default image
{ "kind":"image","path":"/v1/images/generations","bodyType":"json","authStyle":"bearer",
  "body":{"model":"{{model}}","prompt":"{{prompt}}","size":"{{size}}","n":1},
  "resultPath":"data[0].b64_json","resultType":"base64" }
// default chat
{ "kind":"chat","path":"/v1/chat/completions","bodyType":"json","authStyle":"bearer",
  "body":{"model":"{{model}}","messages":"{{messages}}"},
  "resultPath":"choices[0].message.content","resultType":"text" }
```
A provider that supplies **no recipe** inherits the default and only stores deltas (e.g. Groq overrides `path` to `/openai/v1/...`). **Existing providers in `.local-ai/config.json` keep working with zero recipe data — no migration, no breakage.**

## Built-in presets (validated against current docs, 2026-06)
Each preset = `{ id, name, baseUrl, authStyle, headers?, models:[{id,name,kind}], imageRecipe?, chatRecipe? }`. The chat recipe for OpenAI/Together/SiliconFlow/Groq/OpenRouter/DeepSeek/Moonshot is the default chat recipe **modulo path**.

| Preset | baseUrl | Notable recipe facts |
|---|---|---|
| **OpenAI** | `https://api.openai.com` | default image + chat. Models: `gpt-image-1`, `dall-e-3` (image), `gpt-4o-mini` (chat). |
| **Together AI** | `https://api.together.xyz` | image uses `width`/`height` + `response_format:"base64"` → `data[0].b64_json`. Models incl. `black-forest-labs/FLUX.1-schnell-Free`. |
| **SiliconFlow** | `https://api.siliconflow.cn` | image uses `image_size:"{{size}}"`, result `images[0].url` (`resultType:url`). Models incl. **`nex-agi/Nex-N2-Pro`** (chat, free tier), `Kwai-Kolors/Kolors` (image). |
| **Groq** | `https://api.groq.com` | chat path override `/openai/v1/chat/completions`. Chat only (free tier). |
| **OpenRouter** | `https://openrouter.ai` | chat path `/api/v1/chat/completions`; `headers:{HTTP-Referer,X-Title}`. Models incl. **`nex-agi/nex-n2-pro:free`** (zero-cost), `nex-agi/nex-n2-pro`. |

**Free / zero-cost options (user priority):** Nex-N2-Pro is usable for **free** via OpenRouter (`nex-agi/nex-n2-pro:free`) and SiliconFlow's free tier; Groq, Together (`FLUX.1-schnell-Free`), and Gemini also have free tiers. These presets exist specifically so the user can run strong models at no cost.
| **DeepSeek** | `https://api.deepseek.com` | chat path `/chat/completions`. Models `deepseek-v4-pro`, `deepseek-v4-flash`, `deepseek-chat`. |
| **Moonshot (Kimi)** | `https://api.moonshot.ai` | default chat. Models `kimi-k2.6`, etc. |
| **Stability AI** *(bespoke)* | `https://api.stability.ai` | `bodyType:"multipart"`, `headers:{Accept:application/json}`, path `/v2beta/stable-image/generate/core`, body `{prompt,aspect_ratio,output_format:png}`, `resultPath:"image"`, `resultType:"base64"`. (SD3.5 variants are a later recipe variant — see Deferred.) |
| **Google Gemini** *(bespoke)* | `https://generativelanguage.googleapis.com` | `authStyle:"header"`, `authHeader:"x-goog-api-key"`, path `/v1/models/{model}:generateContent`, body `{contents:[{parts:[{text:"{{prompt}}"}]}],generationConfig:{responseModalities:["TEXT","IMAGE"],responseFormat:{aspectRatio:"{{aspect_ratio}}",imageSize:"2K"}}}`, `resultPath:"candidates[0].content.parts[*].inlineData.data"`, `selectWithField:"inlineData"`, `resultMimePath:"…inlineData.mimeType"`, `resultType:"base64"`. |

The exact recipe JSON for all 9 presets (from the validation pass) is the implementation source of truth and will live verbatim in `presets.js`.

## UI changes (`ProvidersPanel`)
- **Presets dropdown** — "Start from a preset" pre-fills baseUrl + authStyle + headers + the model list (with per-model kind) for any of the 9. Paste key → Save.
- **Per-model Type** — each model line carries its own `kind` (image/chat), so one provider holds both. UI: `model-id | Display Name | image|chat` (the third field is optional and defaults to the provider's existing `kind` field, retained for back-compat with current configs). Parser extends the current `id|name` split.
- **"Test" button** — calls `POST /api/local-ai/providers/test` which runs the recipe once (tiny prompt for chat; 1 small image for image) server-side and returns ✅ or ❌ with the failure reason. Never exposes the key to the client.
- **Advanced (collapsible)** — (a) **"Start from <preset>"** clones the closest preset's recipe JSON into an editable textarea; (b) a raw recipe-JSON textarea for full control. Validated on save (well-formed JSON + required fields). This is the Tier-3 escape hatch.

## Data flow (unchanged outside the engine)
Image Studio → `localApi.generateImage(apiModelId, params)` → `POST /api/local-ai/generate` (SSE) → registry resolves `api:<provider>:<model>` → loads provider recipe (or default) → **engine** substitutes/auth/sends → reads result → returns bytes → `saveAsset` stores locally → SSE `result`. Route, SSE, cancellation, and local storage are untouched.

## Security
- All calls and key usage stay **server-side**; `listProvidersSafe` still strips keys; keys never logged or returned to the client.
- The result-path reader is **read-only traversal — no `eval`, no code execution.**
- Base URLs validated as `http(s)`; recipe JSON validated (shape + required fields) before save.
- Provider-returned image URLs are downloaded server-side and re-served locally (existing pattern), so the browser never fetches third-party URLs directly.
- (Local-first, single-user: SSRF surface is user-controlled by design; we validate scheme and keep requests server-side but do not block private hosts, since LM Studio/vLLM run on localhost.)

## Testing (TDD, same as M0–M3; `node --test "tests/*.test.js"`)
- `substitute()`: native-type preservation (`"{{messages}}"` → array), embedded stringification, dropped-optional tokens, `{apiKey}` path substitution.
- `readResult()`: `data[0].b64_json`, `choices[0].message.content`, `images[0].url`, `@binary`, `parts[*]`+`selectWithField`, `resultMimePath`.
- `buildRequest()` for **all 9 presets**: assert exact URL, headers (incl. auth), bodyType, and serialized body each would send — no live keys needed.
- Regression: existing `apiProvider.test.js` / `providerRegistry.test.js` still pass; default recipe reproduces current OpenAI behavior byte-for-byte.

## Deferred / out of scope (YAGNI — flagged by the validation pass)
- **Streaming (SSE)** — recipes always send `stream:false`; add a streaming flag only when a consumer needs it.
- **Async job + polling** — none of the 9 need it; add an optional `poll` block later if a provider requires it.
- **Image *input* / multimodal & tool-calling** — advanced users can hand-author `{{messages}}`; not modeled now.
- **Per-model path/body divergence inside one provider** (e.g. Stability `sd3` endpoint needs a `model` form field + different path than `core`) — ship lowest-common-denominator (Stability uses `core`); SD3.5 variants become additional recipe entries selected by model id in a later iteration.
- **OAuth "Connect" (e.g. OpenRouter)** — API-key paste is the universal method now; OAuth convenience later.

## File plan summary
- New: `lib/local-runtime/providers/recipe-engine.js`, `lib/local-runtime/providers/presets.js`, `app/api/local-ai/providers/test/route.js`, tests `tests/recipeEngine.test.js`, `tests/providerPresets.test.js`.
- Modified: `lib/local-runtime/providers/api.js`, `components/ProvidersPanel.js`, `lib/local-runtime/config.js`, `lib/local-runtime/catalog.js`, `app/api/local-ai/providers/route.js`.

## Open questions
None blocking. (SD3.5 multi-recipe and OAuth are explicitly deferred above.)
