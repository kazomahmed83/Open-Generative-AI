# M3 — Decouple MuAPI (make cloud-independent by default)

> Subagent-driven, same as M0–M2. Roadmap: [`2026-06-16-local-first-platform-roadmap.md`](./2026-06-16-local-first-platform-roadmap.md).

**Goal:** The app is **fully functional with no MuAPI key** and the **Image path is 100% MuAPI-free** (local sd.cpp + generic API providers cover it). MuAPI is demoted to an explicit, optional **legacy cloud** path. Local storage is the default for uploads.

## SCOPE REALITY (important)
Video, Audio, Marketing, Workflow, Agents, Design-Agent are **still MuAPI-backed** — their local backends are M4–M9. So M3 does **NOT** delete the catch-all proxy routes (that would break those studios). Instead:
- The proxies stay but are **key-gated/optional** (they already only work when a MuAPI key is present — no change needed to make them "optional"; they degrade to errors without a key, which is correct for an unmigrated studio).
- Each proxy is deleted **per-studio** as M4–M9 land its local backend.
- M3's deliverable is: **image fully decoupled, no required MuAPI dependency, MuAPI clearly optional, local storage default.**

## Tasks

### M3-T1: Remove MuAPI text-to-image from Image Studio (API = providers only)
**File:** `packages/studio/src/components/ImageStudio.jsx`.
- API mode (`!useLocalModel`) shows ONLY configured API providers' image models. Remove the MuAPI `ModelDropdown` fallback branch; when no providers are configured, show an empty-state select: "No API providers — add one in Settings, or switch to Local."
- In `handleGenerate`, remove the MuAPI t2i branch (`generateImage(apiKey, …)`). API t2i always goes through `localApi.generateImage(selectedApiModelId, …)`. If API mode is active with no provider selected, show a friendly error instead of calling MuAPI.
- **Keep i2i as optional-legacy:** the `imageMode` / "Reference image" branch still uses MuAPI `generateI2I(apiKey, …)` BUT only when a MuAPI key is present; if no key, disable the reference-image button with a tooltip "Image-to-image needs cloud (MuAPI) — optional, or coming locally." (Don't delete i2i; it has no local replacement yet.)
- Verify: API mode with a configured provider generates; with none, shows the empty state; no `generateImage` (MuAPI t2i) call remains for the toggle.

### M3-T2: Default uploads to local storage
**Files:** `packages/studio/src/muapi.js` (`uploadFile`), and confirm the M1 `og_local_mode` branch.
- Make `uploadFile` use `/api/local-ai/upload` (local) by default, falling back to the MuAPI S3 presign only when cloud is explicitly enabled (a MuAPI key is set AND a `cloudEnabled` flag). This makes reference-image / asset uploads local-first.
- Verify: uploading a reference image in Image Studio stores it under `.local-ai/assets/` and serves it from `/api/assets`.

### M3-T3: Demote MuAPI to optional "legacy cloud" in the shell
**File:** `components/StandaloneShell.js` (+ `ApiKeyModal.js` copy).
- The app must be fully usable with `apiKey = null` (already largely true). Relabel the API-key UI as **"Cloud (MuAPI) — optional legacy"**; the header already shows "Local" when no key — keep it. Balance polling only runs when a key is set (already the case). No key required to reach any studio.
- Add a small "Cloud (legacy)" note on the MuAPI-backed studios (video/audio/marketing/workflow/agents/design-agent) indicating they currently need a cloud key until their local backend lands. (Lightweight — a banner or disabled-state hint; don't rebuild those studios.)
- Verify: with no MuAPI key, the app loads, Image Studio (local + API) fully works, and MuAPI-only studios clearly indicate they need cloud/are coming-local.

### M3-T4: Gate the middleware MuAPI rewrite
**File:** `middleware.js`.
- The unconditional rewrite of `/api/v1/*` → `api.muapi.ai` should only apply to requests that carry a MuAPI key (cloud path); local routes (`/api/local-ai/*`, `/api/assets/*`) must never be rewritten. Confirm local routes are excluded and the rewrite is a no-op without a key.
- Verify: `/api/local-ai/generate` and `/api/assets/*` are untouched by middleware; image generation works with no key.

### M3-T5: Verify (gate)
- Unit tests green.
- Browser, **with no MuAPI key and `api.muapi.ai` blocked**: app loads; Image Studio generates locally AND via a configured API provider; uploads land locally; MuAPI-only studios show the "needs cloud / coming local" hint rather than crashing the app.
- `grep` the active Image path for `muapi.ai` / `generateImage(apiKey` → none.

## Out of scope (deferred)
- Deleting the catch-all proxy routes (`/api/{workflow,agents,app}/[[...path]]`, `/api/v1/creative-agent`) — done per-studio in M4–M9.
- Local image-to-image (replaces the last MuAPI image feature) — future.
- Removing the `studio` package's `muapi.js` entirely — when the last studio migrates.

## Notes
- Principle (from the roadmap): keep each route's shape while its backend swaps so the UI never breaks. M3 removes the *required* dependency and the image coupling; the rest is optional until migrated.
