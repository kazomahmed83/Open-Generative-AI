# Local-First Generative AI Platform — Master Roadmap (A→Z)

> **For agentic workers:** This is the master roadmap. Each milestone (M0–M11) becomes its own detailed
> implementation plan (in this same folder) when we reach it, executed with
> superpowers:subagent-driven-development. The first detailed plan already exists:
> [`2026-06-16-m0-foundation-and-image-studio.md`](./2026-06-16-m0-foundation-and-image-studio.md).
> Steps in the detailed plans use checkbox (`- [ ]`) syntax.

**Goal:** Convert this MuAPI-cloud-dependent studio into a **local-first** generative AI platform — image, video, audio, workflows, agents, design-agent — where a shared Node runtime drives local engines (stable-diffusion.cpp, Ollama, ComfyUI, Wan2GP) and a generic **bring-your-own API** provider layer, with the cloud (MuAPI) removed. Ships as a localhost web app now; the same runtime packages into an Electron desktop app later.

**Architecture:** Keep every existing **UI** (live Next.js studio shell + the workflow/agent/design-agent submodule packages). Replace every **backend** call. All local-inference logic lives in portable `lib/local-runtime/` Node modules; Next.js API routes are thin wrappers over them; Electron's main process will later import the *same* modules. One **Provider Registry** unifies `local` adapters and generic `api` adapters behind a single model list + a Local/API toggle.

**Tech Stack:** Next.js 15 (App Router) · React 19 · Node 25 (`node:test`, `child_process.spawn`, SSE) · stable-diffusion.cpp (`sd-cli`) · Ollama HTTP · ComfyUI HTTP · Wan2GP (Gradio HTTP) · Konva/ReactFlow (already in the UI packages) · Electron + electron-builder (already configured) for the later desktop target.

---

## 0. Ground Truth (verified against the code, 2026-06-16)

A multi-agent map verified the repo. The corrected picture:

### Three UI layers — only one is live
| Layer | Location | Status | Local path? |
|---|---|---|---|
| **A. Active Next.js web** | `app/`, `components/StandaloneShell.js`, `packages/studio/**` | **LIVE** (`next dev`; `/` → `/studio`) | **NO** |
| **B. Old vanilla `src/`** | `src/components/*.js`, `src/lib/*.js` | Electron-only (built by `electron:build:*`, not the web app) | **YES** — full sd.cpp + Wan2GP toggle |
| **C. Submodule packages** | `packages/Vibe-Workflow`, `packages/Open-Poe-AI`, `packages/Open-AI-Design-Agent` | LIVE (imported by A via `transpilePackages`) | **NO** |

The rebuild = **graft Layer B's proven local engine onto Layer A's live UI**, bridged by `lib/local-runtime/`.

### Corrections to the previous agent's claims (verified)
1. **REFUTED** — "workflow/agent/design-agent/upload/marketing/explore are separate proxied routes." They are **three catch-alls**: `/api/workflow/[[...path]]`, `/api/agents/[[...path]]`, `/api/app/[[...path]]`, plus `/api/v1/creative-agent/[[...path]]` and `/api/api/v1/[[...path]]`. "design-agent/marketing/explore" are path *segments*, not endpoints.
2. **PARTIAL** — "the web app has a local toggle." It does **not**. The live `packages/studio/src/components/ImageStudio.jsx` is 100% MuAPI; the toggle exists only in the dead-for-web `src/components/ImageStudio.js`. `StandaloneShell.js:338` showing "Local" is just a label when no API key is set — it does not route to local inference.
3. **PARTIAL** — "the in-progress web runtime generates images." It does **not**. The web `/api/local-ai/*` routes do management only (status/models/download/delete). **No generation route exists.** Web local-first is ~30% wired (infra only).
4. **PARTIAL** — workflow node types: the real registered set is `textNode, imageNode, videoNode, audioNode, concatNode, vidConcatNode, apiNode` (`UploadNode.jsx` is a helper, not a node type).
5. **PARTIAL** — agents have no live "tools" call; skills are baked into the system prompt via a `preview-realign` step, not invoked as runtime tools.

### The goldmine (production-ready, reusable as-is)
- `electron/lib/localInference.js` (591L) — **working** sd.cpp pipeline: binary download (resume), model download, `spawn()` + progress, PNG output. (`generate()` = lines 419–562.)
- `electron/lib/wan2gpProvider.js` (457L) — **HTTP-based** Wan2GP (Gradio v4) video/image provider. **Zero changes needed.**
- `electron/lib/modelCatalog.js`, `localInferenceRuntime.js` (progress parse), `localInferenceAssets.js` (platform binary pick), `localInferencePaths.js` — pure Node, **already unit-tested** in `tests/*.test.js`.
- `lib/local-ai-web.js` — ESM web layer that **already** `require()`s the electron catalogs and probes Ollama/ComfyUI/LM Studio/Xinference; has download/extract/list. Missing only `generate()`.
- `app/api/local-ai/{status,models,download-engine,download-model,download-auxiliary,delete-model}/route.js` — management routes, working.
- `components/LocalModelsPanel.js` — settings UI for local models, working.
- `.local-ai/bin/{sd-cli.exe, sd-server.exe, stable-diffusion.dll}` — binaries present (gitignored).

---

## 1. Target Architecture

```
                    Browser UI (localhost:3000)  ── Electron window (later, SAME app)
                          │                              │
   packages/studio · workflow-builder · agents · design-agent   (REUSED, no rewrite)
                          │   uses one SDK:  local-api.js  (replaces muapi.js)
                          ▼
        Next.js API routes  (THIN wrappers — Next-only glue)
   /api/local-ai/generate · /api/assets/[key] · /api/workflow · /api/agents · /api/creative-agent
                          │   import
                          ▼
        lib/local-runtime/   ◄── PORTABLE Node modules (Electron imports these too)
   ┌──────────────────────────────────────────────────────────────────────┐
   │ catalog.js   providers/index.js   storage.js   jobs.js               │
   │              ├ providers/sdcpp.js   (port of electron/lib/localInference)│
   │              ├ providers/wan2gp.js  (re-export electron/lib/wan2gpProvider)│
   │              ├ providers/ollama.js  (127.0.0.1:11434)                  │
   │              ├ providers/comfyui.js (127.0.0.1:8188)                   │
   │              └ providers/api/*      (GENERIC bring-your-own remote)    │
   └──────────────────────────────────────────────────────────────────────┘
                          │ spawn / HTTP                       │ filesystem
                          ▼                                    ▼
     sd-cli · Ollama · ComfyUI · Wan2GP · user APIs     .local-ai/{models,assets,db}
```

### The one rule that makes "Electron later" cheap (not a rewrite)
**All inference logic lives in `lib/local-runtime/` plain Node modules. API routes never contain `spawn()`/engine logic — they only parse the request, call `lib/`, and stream the result.** Because of this, the Electron main process imports the identical `lib/local-runtime/` modules; "add Electron" = point Electron at the built Next app + bundle binaries (electron-builder config already exists). Estimated as a single milestone (M10), not a parallel burden.

### The Provider Registry (implements your "API ≠ MuAPI" decision)
Every model — local or remote — is one normalized catalog entry:
```js
{ id, name, source: 'local' | 'api', provider: 'sdcpp'|'wan2gp'|'ollama'|'comfyui'|'<api-provider-id>',
  kind: 'image'|'video'|'audio'|'text', params: <schema>, ready: boolean }
```
- **`local` providers** spawn binaries / call localhost engines.
- **`api` providers** are **generic, user-configured** (endpoint + key + model list). **Not MuAPI.** The provider/model *catalog* is built later (M2 ships the framework + settings UI; the curated list grows over time).
- The Studio's **Local / API toggle** simply filters the unified list by `source`. The selector shows both lists; selecting a model picks its provider automatically.

---

## 2. Reuse vs Build Matrix (verified)

| Subsystem | Verdict | Effort | What we actually do |
|---|---|---|---|
| Web shell + routing | reuse UI, replace backend | M | Swap `muapi.js` → `local-api.js`; neutralize balance/key checks |
| MuAPI proxy layer | replace target | M | Remove 3 catch-alls + middleware rewrite; route to local |
| In-progress local runtime | **finish it** | M | Add the one missing `generate` route + provider registry |
| Studio package (image/video/audio/marketing) | reuse UI, replace backend | M | One shared SDK swap covers all four studios |
| Workflow builder | reuse UI, build backend | L | Local DAG executor + node-schema registry + run store |
| Agents | reuse UI, build backend | L | Local agent CRUD + Ollama chat + streaming + local files |
| Design agent | reuse UI, build backend | M–L | Local sessions/jobs/assets/events + agent loop + plan/approve |
| Electron + old local | **reuse as-is (port IPC→HTTP)** | L | Lift `electron/lib/*` into `lib/local-runtime/` |

**No subsystem needs a UI rewrite.** Every row is "reuse the UI, replace/build the backend."

---

## 3. Milestone Roadmap

Each milestone is independently shippable and verifiable. Effort is rough dev-days for one engineer; they compress heavily with subagent parallelism.

### M0 — Foundation: shared local runtime (headless) · ~3–4d · **detailed plan written**
- **Goal:** `lib/local-runtime/` exists and a `POST /api/local-ai/generate` produces a real sd.cpp image, saved to `.local-ai/assets/`, served at `/api/assets/[key]`.
- **Build:** `catalog.js`, `providers/index.js`, `providers/sdcpp.js` (port of `localInference.generate`), `storage.js`, `jobs.js` (in-memory + SSE), `app/api/local-ai/generate/route.js`, `app/api/assets/[key]/route.js`. Add `"test": "node --test tests/"`.
- **Exit:** `curl` the generate route with a downloaded model → PNG saved + URL returned + progress streamed. Unit tests green. **No UI change yet.**

### M1 — Image Studio vertical (first user-visible win) · ~2–3d · **detailed plan written**
- **Goal:** The live web ImageStudio generates locally — the capability that has only ever run in Electron.
- **Build:** `packages/studio/src/local-api.js` (mirrors `muapi.js` signatures); branch `muapi.js` on `source/localMode`; port the Local/API toggle + unified model selector from `src/components/ImageStudio.js` into `packages/studio/src/components/ImageStudio.jsx`; wire upload to local FS.
- **Exit:** In the browser, toggle Local, pick a downloaded model, generate, see the image, find it in history. E2E verified with Playwright (webapp-testing skill).

### M2 — Provider framework completion (API kind + Ollama + settings) · ~3d
- **Goal:** The generic `api` provider kind and the unified Local/API model list are real.
- **Build:** `providers/ollama.js` (chat/text); `providers/api/` generic adapter (`{baseUrl, apiKey, models[], request/response mapping}`); a **Providers settings panel** to add/edit API providers + keys (stored in `.local-ai/config.json`, gitignored); catalog merges `local` + `api` entries; Studio toggle filters by `source`.
- **Exit:** Add a dummy API provider in settings → its models appear under "API"; switch the toggle; local models still default. Ollama text generation callable from the runtime.

### M3 — Decouple MuAPI (rip out the cloud) · ~2–3d
- **Goal:** Zero hard dependency on `api.muapi.ai` / `cdn.muapi.ai`.
- **Build:** Delete/replace the 3 catch-all proxies + `middleware.js` rewrite; remove `muapi.js` cloud `BASE_URL` + balance/credit/cookie logic from `StandaloneShell.js`; replace S3 presign + CDN URLs with `lib/local-runtime/storage.js` + `/api/assets`. Keep route *shapes* the UI expects (so the UI is untouched) but back them locally or by `api` providers.
- **Exit:** Block `api.muapi.ai` at the network layer; image generation + uploads still work. Grep shows no remaining hardcoded `muapi.ai` in active paths.

### M4 — Video Studio vertical (Wan2GP + ComfyUI video) · ~3d
- **Goal:** Local text-to-video / image-to-video in the live VideoStudio.
- **Build:** `providers/wan2gp.js` (re-export, zero changes) + `providers/comfyui.js` (workflow-graph submit + history poll); extend catalog with video models; port VideoStudio's local-model merging from `src/components/VideoStudio.js`; SSE progress for long jobs.
- **Exit:** Generate a short clip locally via Wan2GP (and/or a ComfyUI video graph); it appears in VideoStudio history.

### M5 — Audio Studio vertical · ~2–3d
- **Goal:** Local TTS/STT/audio-gen.
- **Build:** Audio adapter(s) — Whisper (STT) + Kokoro/F5-TTS (TTS) via local binaries or ComfyUI/Xinference; reuse AudioStudio's schema-driven param form (already model-agnostic).
- **Exit:** Generate/transcribe audio locally; output in AudioStudio.

### M6 — Workflow backend (local DAG engine) · ~5–6d
- **Goal:** Save, edit, and **run** workflows entirely locally; the workflow-builder UI is untouched.
- **Build:** `lib/local-runtime/workflow/` — storage (`.local-ai/workflows/`), node-schema registry (text/image/video/audio/concat/vidConcat/api), a topological run engine that calls the provider registry per node, run-status store. Implement the exact endpoints `NodeFlow.jsx` calls: `create`, `get-workflow-defs`, `get-workflow-def/{id}`, `{id}/node-schemas`, `{id}/run`, `run/{id}/status`, `{id}/node/{nodeId}/run`, `architect` (local LLM via Ollama). Reuse `buildWorkflowPayload()` + `pollRunIdStatus()` from the UI as-is.
- **Exit:** Build a 3-node graph (text→image→video) in the UI, run it, watch node statuses, get outputs — no cloud.

### M7 — Agents backend (local chat) · ~5d
- **Goal:** Create agents and chat with them via a local LLM; reuse the agent UI.
- **Build:** `lib/local-runtime/agents/` — agent CRUD (`.local-ai/agents/`), conversation store, chat via `providers/ollama.js` with the UI's request_id→poll contract (or upgrade to SSE), local file uploads (replace S3/CDN), skill→system-prompt assembly (mirrors `preview-realign`), agent icon gen via local image provider (replace `flux-schnell-image`). Neutralize balance/like/credit calls.
- **Exit:** Create an agent, hold a multi-turn local conversation with attachments, edit skills — fully local.

### M8 — Design Agent backend (creative loop) · ~5–6d
- **Goal:** The Konva canvas creative-agent runs on a local agent loop.
- **Build:** `lib/local-runtime/creative/` — sessions, messages, **jobs + events** (the canvas consumes an event stream: `canvas_op`, `tool_call`, `tool_result`, `plan_propose`, `error`), a planner (local LLM) producing the PlanVisualizer DAG, approve/reject/cancel, asset registration → local storage. Tool calls (`generate_image`, `generate_video`, `image_to_video`, `edit_image`, `enhance_image`) dispatch to the provider registry. Implement the `/api/v1/creative-agent/*` paths the UI expects.
- **Exit:** Open the canvas, ask for a multi-step design, approve the plan, watch assets stream onto the canvas — locally.

### M9 — Marketing Studio + Explore Apps · ~3d
- **Goal:** Replace the two remaining cloud-content features with local catalogs.
- **Build:** Local marketing presets/templates (compose existing image/video providers behind `generateMarketingStudioAd`'s shape); a local **Explore Apps** catalog (`.local-ai/apps/` or a bundled JSON) replacing the MuAPI-served app/template lists; local "publish workflow/agent as app."
- **Exit:** Marketing ad generates from a local preset; Explore shows local/published apps; opening one launches the right studio/workflow.

### M10 — Electron desktop packaging · ~3–4d
- **Goal:** One-click desktop installer reusing the entire runtime.
- **Build:** Electron loads the built/served Next app; `electron/main.js` reuses `lib/local-runtime/` directly (or via the local HTTP server); bundle binaries via the existing `extraResources`/`afterPack`; first-run model-download UX; offline default. (`electron/preload.js` `window.localAI` becomes an optional fast-path, not a requirement.)
- **Exit:** Build `.exe`/`.dmg`/AppImage; install on a clean machine; generate an image offline after first-run download.

### M11 — Next-gen hardening & extensibility · ongoing
- ComfyUI deep integration (custom graphs, FLUX.2, advanced pipelines); SQLite-backed jobs/history (`better-sqlite3`) replacing in-memory; model-manager UX (quantization, VRAM hints); a **plugin/adapter SDK** so new local engines and API providers drop in without core changes; queue/concurrency control; optional multi-user; import/export of workflows, agents, presets.
- **This is where "Higgsfield clone → next generation" lives:** the platform becomes an extensible local creative OS.

---

## 4. Cross-Cutting Concerns (apply to every milestone)

- **Storage** — `lib/local-runtime/storage.js` is the single asset sink (`.local-ai/assets/`), served by `/api/assets/[key]`. Replaces all S3 presign + `cdn.muapi.ai`/CloudFront URLs. No cloud storage anywhere.
- **Jobs & progress** — `lib/local-runtime/jobs.js`: in-memory job + event store (M0), exposed via **SSE** from the generate/run routes. The existing UIs already poll/stream, so they need minimal change. Upgrade to SQLite in M11 for durability across restarts.
- **Unified catalog** — one normalized entry shape (above) across local + api + per-subsystem model lists. `models_dump.json` is kept only as a *reference* for param schemas; it is not a runtime dependency.
- **Config & secrets** — API provider configs/keys in `.local-ai/config.json` (gitignored, never committed). No telemetry; fully offline-capable.
- **Process safety** — spawned binaries get explicit arg arrays (never shell strings), bounded concurrency, timeouts, and cancellation (kill on client disconnect). Validate model/param inputs before spawn.
- **Testing** — pure runtime modules unit-tested with `node --test tests/` (matches the 4 existing tests). Each vertical gets a Playwright e2e (webapp-testing skill). Adversarially verify "it works" with real output before claiming done (verification-before-completion).
- **Branching/commits** — work on a `local-first-platform` branch off `main` (never commit planning churn to `main` directly); atomic commits per task; commit only when asked.

---

## 5. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| sd.cpp `spawn()` needs a real Node server (not edge/serverless) | We run `next start`/Electron (Node runtime) — never deploy generation to edge. Routes marked `runtime = 'nodejs'`. |
| Long generations block / leak processes | Jobs run async with SSE; cancel on disconnect; concurrency cap. |
| Heavy engines (ComfyUI/Wan2GP) not installed on a user's machine | Provider registry probes availability; UI shows engine status (already in `LocalModelsPanel`); models marked `ready:false` are disabled with a "how to install" hint. |
| Submodule UIs drift from upstream | We change only the SDK boundary (`muapi.js`/`local-api.js`) and small toggles; keep diffs surgical and documented so submodule updates re-merge cleanly. |
| "Electron later" silently becomes a rewrite | Enforced by the architecture rule (§1): no engine logic in routes. A lint/review check guards it. |
| Removing MuAPI breaks a feature mid-migration | M3 (decouple) comes *after* the image vertical proves the pattern; each feature keeps its route shape while the backend swaps, so the UI never breaks. |

---

## 6. Definition of Done (per vertical)
A vertical is "done" only when, with the network blocked to `*.muapi.ai`:
1. The feature works end-to-end in the **browser** (verified by running it, not by inspection).
2. Outputs persist locally and reload from history.
3. Unit tests for the new runtime modules pass (`node --test`).
4. No new hardcoded cloud URLs in active code paths (grep-clean).
5. The runtime logic lives in `lib/local-runtime/` (Electron-portable), not in route handlers.

---

## 7. Immediate Next Step
Execute **M0 + M1** from [`2026-06-16-m0-foundation-and-image-studio.md`](./2026-06-16-m0-foundation-and-image-studio.md). That single pass turns the live web Image Studio into a working local generator — the proof that unlocks every other vertical.
