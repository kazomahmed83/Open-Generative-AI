// components/ProvidersPanel.js
"use client";
import { useState, useEffect } from "react";

const BLANK = { name: "", kind: "image", baseUrl: "", apiKey: "", modelsText: "" };

export default function ProvidersPanel() {
  const [providers, setProviders] = useState([]);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = () =>
    fetch("/api/local-ai/providers")
      .then((r) => r.json())
      .then((d) => setProviders(d.providers || []))
      .catch(() => setProviders([]));

  useEffect(() => { load(); }, []);

  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const parseModels = (text) =>
    text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const [id, ...rest] = l.split("|");
      return { id: id.trim(), name: rest.join("|").trim() || id.trim() };
    }).filter((m) => m.id);

  const save = async () => {
    setError(null);
    if (!form.name || !form.baseUrl) { setError("Name and Base URL are required."); return; }
    setBusy(true);
    try {
      const provider = {
        id: slug(form.name), name: form.name, kind: form.kind,
        baseUrl: form.baseUrl, apiKey: form.apiKey, models: parseModels(form.modelsText),
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
            </div>
            <button onClick={() => remove(p.id)} disabled={busy} className="text-xs text-red-300 hover:text-red-200 px-2 py-1">Delete</button>
          </div>
        ))}
      </div>

      <div className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-2">
        <div className="text-white/70 text-sm font-medium">Add / update a provider</div>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name (e.g. Together)" className="w-full bg-black/30 text-white text-sm rounded px-2 py-1 border border-white/10 outline-none" />
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className="w-full bg-black/30 text-white text-sm rounded px-2 py-1 border border-white/10 outline-none">
          <option value="image">image</option>
          <option value="chat">chat</option>
        </select>
        <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="Base URL (e.g. https://api.together.xyz)" className="w-full bg-black/30 text-white text-sm rounded px-2 py-1 border border-white/10 outline-none" />
        <input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder="API key (blank keeps existing)" className="w-full bg-black/30 text-white text-sm rounded px-2 py-1 border border-white/10 outline-none" />
        <textarea value={form.modelsText} onChange={(e) => setForm({ ...form, modelsText: e.target.value })} placeholder={"Models, one per line:\nmodel-id|Display Name"} rows={3} className="w-full bg-black/30 text-white text-sm rounded px-2 py-1 border border-white/10 outline-none font-mono" />
        {error && <div className="text-red-300 text-xs">{error}</div>}
        <button onClick={save} disabled={busy} className="bg-cyan-500 text-black text-sm font-medium rounded px-3 py-1 disabled:opacity-50">{busy ? "Saving…" : "Save provider"}</button>
      </div>
    </div>
  );
}
