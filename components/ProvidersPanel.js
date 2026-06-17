// components/ProvidersPanel.js
"use client";
import { useState, useEffect } from "react";
import { PRESETS } from '../lib/local-runtime/providers/presets.js';

const BLANK = { name: "", kind: "image", baseUrl: "", apiKey: "", modelsText: "", authStyle: "bearer", authHeader: "", headers: null, imageRecipe: "", chatRecipe: "", modelsList: null, modelMeta: {} };

export default function ProvidersPanel() {
  const [providers, setProviders] = useState([]);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [testResult, setTestResult] = useState({});
  const [browse, setBrowse] = useState({ open: false, loading: false, items: [], freeOnly: true, q: '', error: null });
  const [showAdvanced, setShowAdvanced] = useState(false);

  // validate recipe JSON on save: only block if non-empty AND missing required fields
  const validRecipe = (s) => { if (!s) return true; try { const o = JSON.parse(s); if (!o || !o.kind || !o.path || !o.resultType) return false; if ((o.method || 'POST').toUpperCase() !== 'GET' && !o.body) return false; if (o.resultType !== 'binary' && !o.resultPath) return false; return true; } catch { return false; } };

  const openBrowse = async () => {
    setBrowse((b) => ({ ...b, open: true, loading: true, error: null, items: [] }));
    const provider = {
      baseUrl: form.baseUrl, apiKey: form.apiKey, modelsList: form.modelsList,
      authStyle: form.authStyle, authHeader: form.authHeader, kind: form.kind,
    };
    const r = await fetch('/api/local-ai/providers/browse', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }),
    }).then((x) => x.json()).catch(() => ({ models: [], error: 'network' }));
    setBrowse((b) => ({ ...b, loading: false, items: r.models || [], error: r.error || null }));
  };

  const addBrowsed = (m) => {
    const line = `${m.id}|${m.name}|${m.kind}`;
    setForm((f) => ({ ...f, modelsText: f.modelsText ? `${f.modelsText}\n${line}` : line }));
  };

  const load = () =>
    fetch("/api/local-ai/providers")
      .then((r) => r.json())
      .then((d) => setProviders(d.providers || []))
      .catch(() => setProviders([]));

  useEffect(() => { load(); }, []);

  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const parseModels = (text) =>
    text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const [id, name, kind] = l.split("|").map((s) => s.trim());
      return { id, name: name || id, ...(kind === "image" || kind === "chat" ? { kind } : {}) };
    }).filter((m) => m.id);

  const save = async () => {
    setError(null);
    if (!form.name || !form.baseUrl) { setError("Name and Base URL are required."); return; }
    if (!validRecipe(form.imageRecipe) || !validRecipe(form.chatRecipe)) { setError('Advanced recipe JSON is invalid (need kind, path, body, resultPath, resultType).'); return; }
    setBusy(true);
    try {
      const provider = {
        id: slug(form.name), name: form.name, kind: form.kind,
        baseUrl: form.baseUrl, apiKey: form.apiKey, models: parseModels(form.modelsText).map((m) => ({ ...m, ...((form.modelMeta && form.modelMeta[m.id]) || {}) })),
        authStyle: form.authStyle, authHeader: form.authHeader, headers: form.headers,
        imageRecipe: form.imageRecipe || undefined, chatRecipe: form.chatRecipe || undefined,
        modelsList: form.modelsList || undefined,
      };
      const res = await fetch("/api/local-ai/providers", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || "Save failed"); return; }
      setProviders(d.providers || []);
      setForm(BLANK);
    } finally { setBusy(false); }
  };

  const remove = async (id) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/local-ai/providers?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const d = await res.json();
      setProviders(d.providers || []);
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-6">
      <h3 className="text-white font-semibold mb-1">API Providers</h3>
      <p className="text-white/50 text-sm mb-3">
        Bring your own OpenAI-compatible API (OpenAI, Together, Groq, OpenRouter, LM Studio, vLLM…). Keys are stored locally and only sent to the provider you configure.
      </p>

      <div className="space-y-2 mb-4">
        {providers.length === 0 && <div className="text-white/40 text-sm">No API providers yet.</div>}
        {providers.map((p) => (
          <div key={p.id} className="flex items-center justify-between bg-white/5 border border-white/10 rounded-lg px-3 py-2">
            <div className="min-w-0">
              <div className="text-white text-sm font-medium truncate">{p.name} <span className="text-white/40">· {p.kind}</span></div>
              <div className="text-white/40 text-xs truncate">{p.baseUrl} · {(p.models || []).length} models · {p.hasApiKey ? "key set" : "no key"}</div>
              {testResult[p.id] && <div className="text-xs text-white/60 mt-0.5">{testResult[p.id]}</div>}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={async () => {
                  const m = (p.models || [])[0];
                  const r = await fetch('/api/local-ai/providers/test', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ providerId: p.id, apiModelId: m?.id, kind: m?.kind || p.kind || 'chat' }),
                  }).then((x) => x.json()).catch(() => ({ ok: false, error: 'network' }));
                  setTestResult((t) => ({ ...t, [p.id]: r.ok ? '✅ works' : `❌ ${r.error || 'failed'}` }));
                }}
                className="text-xs text-cyan-300 hover:text-cyan-200 px-2 py-1"
              >Test</button>
              <button onClick={() => remove(p.id)} disabled={busy} className="text-xs text-red-300 hover:text-red-200 px-2 py-1">Delete</button>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-2">
        <div className="text-white/70 text-sm font-medium">Add / update a provider</div>
        <select
          value=""
          onChange={(e) => {
            const p = PRESETS.find((x) => x.id === e.target.value);
            if (!p) return;
            setForm({
              ...BLANK,
              name: p.name,
              kind: p.models.some((m) => m.kind === 'image') ? 'image' : 'chat',
              baseUrl: p.baseUrl,
              authStyle: p.authStyle || 'bearer',
              authHeader: p.authHeader || '',
              headers: p.headers || null,
              imageRecipe: p.imageRecipe || '',
              chatRecipe: p.chatRecipe || '',
              modelsList: p.modelsList || null,
              modelsText: p.models.map((m) => `${m.id}|${m.name}|${m.kind}`).join('\n'), modelMeta: Object.fromEntries(p.models.filter((m) => m.sizeMap || m.qualityOptions || m.bodyExtra || m.defaultQuality).map((m) => [m.id, { ...(m.sizeMap ? { sizeMap: m.sizeMap } : {}), ...(m.qualityOptions ? { qualityOptions: m.qualityOptions } : {}), ...(m.bodyExtra ? { bodyExtra: m.bodyExtra } : {}), ...(m.defaultQuality ? { defaultQuality: m.defaultQuality } : {}) }])),
            });
          }}
          className="w-full bg-black/30 text-white text-sm rounded px-2 py-1 border border-white/10 outline-none"
        >
          <option value="">Start from a preset…</option>
          {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name (e.g. Together)" className="w-full bg-black/30 text-white text-sm rounded px-2 py-1 border border-white/10 outline-none" />
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className="w-full bg-black/30 text-white text-sm rounded px-2 py-1 border border-white/10 outline-none">
          <option value="image">image</option>
          <option value="chat">chat</option>
        </select>
        <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="Base URL (e.g. https://api.together.xyz)" className="w-full bg-black/30 text-white text-sm rounded px-2 py-1 border border-white/10 outline-none" />
        <input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder="API key (blank keeps existing)" className="w-full bg-black/30 text-white text-sm rounded px-2 py-1 border border-white/10 outline-none" />
        <textarea value={form.modelsText} onChange={(e) => setForm({ ...form, modelsText: e.target.value })} placeholder={"Models, one per line:\nmodel-id|Display Name"} rows={3} className="w-full bg-black/30 text-white text-sm rounded px-2 py-1 border border-white/10 outline-none font-mono" />
        {form.modelsList && (
          <button onClick={openBrowse} disabled={!form.baseUrl} className="text-xs text-cyan-300 hover:text-cyan-200 px-2 py-1 border border-cyan-500/30 rounded">
            Browse models
          </button>
        )}
        {browse.open && (
          <div className="border border-white/10 rounded-lg p-2 mt-2 bg-black/30">
            <div className="flex items-center gap-2 mb-2">
              <input value={browse.q} onChange={(e) => setBrowse((b) => ({ ...b, q: e.target.value }))} placeholder="Search models…" className="flex-1 bg-black/30 text-white text-xs rounded px-2 py-1 border border-white/10 outline-none" />
              <label className="text-xs text-white/70 flex items-center gap-1">
                <input type="checkbox" checked={browse.freeOnly} onChange={(e) => setBrowse((b) => ({ ...b, freeOnly: e.target.checked }))} /> Free only
              </label>
              <button onClick={() => setBrowse((b) => ({ ...b, open: false }))} className="text-xs text-white/50 px-2">Close</button>
            </div>
            {browse.loading && <div className="text-white/40 text-xs">Loading…</div>}
            {browse.error && <div className="text-red-300 text-xs">{browse.error}</div>}
            <div className="max-h-48 overflow-y-auto space-y-1">
              {browse.items
                .filter((m) => (!browse.freeOnly || m.free === 'free'))
                .filter((m) => !browse.q || m.id.toLowerCase().includes(browse.q.toLowerCase()) || (m.name || '').toLowerCase().includes(browse.q.toLowerCase()))
                .slice(0, 200)
                .map((m) => (
                  <div key={m.id} className="flex items-center justify-between text-xs text-white/80 px-2 py-1 hover:bg-white/5 rounded">
                    <span className="truncate">{m.name} <span className="text-white/40">· {m.kind}{m.free === 'free' ? ' · free' : ''}</span></span>
                    <button onClick={() => addBrowsed(m)} className="text-cyan-300 hover:text-cyan-200 px-2">Add</button>
                  </div>
                ))}
            </div>
          </div>
        )}
        <button onClick={() => setShowAdvanced((v) => !v)} className="text-xs text-white/50 hover:text-white/80">
          {showAdvanced ? '▾ Advanced (recipe JSON)' : '▸ Advanced (recipe JSON)'}
        </button>
        {showAdvanced && (
          <div className="space-y-2 border border-white/10 rounded p-2 bg-black/20">
            <div className="flex items-center gap-2">
              <select value="" onChange={(e) => { const p = PRESETS.find((x) => x.id === e.target.value); if (!p) return; setForm((f) => ({ ...f, imageRecipe: p.imageRecipe || '', chatRecipe: p.chatRecipe || '', authStyle: p.authStyle || 'bearer', authHeader: p.authHeader || '', modelsList: p.modelsList || null })); }} className="bg-black/30 text-white text-xs rounded px-2 py-1 border border-white/10">
                <option value="">Start from a preset…</option>
                {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <span className="text-white/40 text-[11px]">clones its recipe JSON to edit</span>
            </div>
            <textarea value={form.imageRecipe} onChange={(e) => setForm({ ...form, imageRecipe: e.target.value })} placeholder="image recipe JSON (optional)" rows={4} className="w-full bg-black/30 text-white text-xs rounded px-2 py-1 border border-white/10 outline-none font-mono" />
            <textarea value={form.chatRecipe} onChange={(e) => setForm({ ...form, chatRecipe: e.target.value })} placeholder="chat recipe JSON (optional)" rows={4} className="w-full bg-black/30 text-white text-xs rounded px-2 py-1 border border-white/10 outline-none font-mono" />
          </div>
        )}
        {error && <div className="text-red-300 text-xs">{error}</div>}
        <button onClick={save} disabled={busy} className="bg-cyan-500 text-black text-sm font-medium rounded px-3 py-1 disabled:opacity-50">{busy ? "Saving…" : "Save provider"}</button>
      </div>
    </div>
  );
}
