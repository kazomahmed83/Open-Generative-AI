'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { computeFit } from '@/lib/local-runtime/catalog/recipeState.js';

const CATEGORIES = [
  { id: 'image', label: 'Image', hint: 'FLUX.2, Z-Image, SDXL' },
  { id: 'video', label: 'Video', hint: 'LTX-2.3, Wan, Hunyuan' },
  { id: 'audio', label: 'Audio', hint: 'LTX audio, ComfyUI audio' },
  { id: 'code', label: 'Code', hint: 'Coder LLMs' },
  { id: 'chat', label: 'Chat', hint: 'Local assistants' },
];

const PROVIDER_LABELS = {
  sdcpp: 'sd.cpp',
  comfyui: 'ComfyUI',
  wan2gp: 'Wan2GP',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  xinference: 'Xinference',
  openrouter: 'OpenAI Endpoint',
  vllm: 'vLLM / SGLang',
  qwen: 'Qwen Endpoint',
};

function formatGB(value) {
  return `${value || '?'} GB`;
}

async function apiFetch(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

function StatusBadge({ ready, children }) {
  return (
    <span
      className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold ${
        ready ? 'bg-emerald-500/10 text-emerald-300' : 'bg-yellow-500/10 text-yellow-300'
      }`}
    >
      {children}
    </span>
  );
}

function ProviderPill({ provider }) {
  return (
    <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] font-bold text-white/45">
      {PROVIDER_LABELS[provider] || provider || 'local'}
    </span>
  );
}

// Recipe status badge label (state from the merged catalog).
function recipeBadgeText(state) {
  if (state === 'ready') return 'Ready';
  if (state === 'partial') return 'Partial';
  if (state === 'needs-node') return 'Needs node';
  return 'Get';
}

// Hardware-fit badge styling + label from computeFit() output.
const FIT_STYLE = {
  fits: { cls: 'bg-emerald-500/10 text-emerald-300', label: '✓ fits' },
  tight: { cls: 'bg-amber-500/10 text-amber-300', label: '⚠ tight' },
  'too-big': { cls: 'bg-red-500/10 text-red-300', label: '✗ too big' },
};

function EngineGrid({ engines }) {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {engines.map((engine) => (
        <div key={engine.id} className="rounded-md border border-white/[0.04] bg-white/[0.035] p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="truncate text-sm font-bold text-white">{engine.name}</div>
                <StatusBadge ready={engine.ready}>{engine.ready ? 'Online' : 'Offline'}</StatusBadge>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-white/50">{engine.role}</p>
              <p className="mt-1 truncate text-[10px] text-white/30" title={engine.endpoint}>
                {engine.endpoint}
              </p>
            </div>
            {engine.modelCount ? (
              <span className="rounded-md bg-[#22d3ee]/10 px-2 py-0.5 text-[10px] font-bold text-[#22d3ee]">
                {engine.modelCount} models
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function LocalModelsPanel() {
  const [status, setStatus] = useState(null);
  const [models, setModels] = useState([]);
  const [engines, setEngines] = useState([]);
  const [activeCategory, setActiveCategory] = useState('image');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [gpu, setGpu] = useState(null);
  const [progress, setProgress] = useState({}); // { [modelId]: { overall, needsNode } }

  const refresh = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const [statusData, modelsData] = await Promise.all([
        apiFetch('/api/local-ai/status'),
        apiFetch('/api/local-ai/models'),
      ]);
      setStatus(statusData);
      setModels(modelsData.models || []);
      setEngines(modelsData.engines || []);
      setGpu(modelsData.gpu || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const counts = useMemo(() => {
    return CATEGORIES.reduce((acc, category) => {
      acc[category.id] = models.filter((model) => model.category === category.id).length;
      return acc;
    }, {});
  }, [models]);

  const visibleModels = useMemo(() => {
    return models.filter((model) => model.category === activeCategory);
  }, [activeCategory, models]);

  const runAction = async (id, action) => {
    setBusyId(id);
    setError('');
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  // Recipe downloads stream SSE progress (the route is text/event-stream, not JSON), so they need
  // their own reader instead of apiFetch.
  const downloadRecipeStreamed = async (modelId) => {
    setBusyId(modelId);
    setError('');
    setProgress((p) => ({ ...p, [modelId]: { overall: 0 } }));
    try {
      const res = await fetch('/api/local-ai/download-model', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelId }),
      });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, nl).replace(/^data: /, '');
          buf = buf.slice(nl + 2);
          let evt; try { evt = JSON.parse(line); } catch { continue; }
          if (evt.type === 'progress') setProgress((p) => ({ ...p, [modelId]: { ...(p[modelId] || {}), overall: evt.overall ?? p[modelId]?.overall ?? 0 } }));
          if (evt.type === 'needs-node') setProgress((p) => ({ ...p, [modelId]: { ...(p[modelId] || {}), needsNode: evt.node } }));
          if (evt.type === 'error') setError(evt.error || 'Download failed');
        }
      }
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-white/[0.04] bg-white/[0.035] p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-wider text-white/30">
              Local Engines
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-white/65">
              This project now treats localhost tools as engines: sd.cpp for direct image downloads, ComfyUI for FLUX.2 and LTX-2.3 workflows, Ollama or LM Studio for chat/code, and Wan2GP for heavier video.
            </p>
            {status?.dataDir && (
              <p className="mt-2 truncate text-[11px] text-white/35" title={status.dataDir}>
                {status.dataDir}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge ready={!!status?.engineInstalled}>
              {status?.engineInstalled ? 'sd.cpp ready' : 'sd.cpp needed'}
            </StatusBadge>
            {!status?.engineInstalled && (
              <button
                type="button"
                onClick={() => runAction('__engine__', () => apiFetch('/api/local-ai/download-engine', { method: 'POST' }))}
                disabled={busyId === '__engine__'}
                className="rounded-md bg-[#22d3ee] px-3 py-1.5 text-xs font-bold text-black transition hover:bg-[#e5ff33] disabled:cursor-wait disabled:opacity-60"
              >
                {busyId === '__engine__' ? 'Installing...' : 'Install sd.cpp'}
              </button>
            )}
          </div>
        </div>
        <div className="mt-4">
          <EngineGrid engines={engines} />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-bold uppercase tracking-wider text-white/30">
            Model Categories
          </div>
          <button
            type="button"
            onClick={refresh}
            className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {CATEGORIES.map((category) => {
            const active = activeCategory === category.id;
            return (
              <button
                type="button"
                key={category.id}
                onClick={() => setActiveCategory(category.id)}
                className={`rounded-md border p-3 text-left transition ${
                  active
                    ? 'border-[#22d3ee]/60 bg-[#22d3ee]/10 text-white'
                    : 'border-white/[0.04] bg-white/[0.03] text-white/55 hover:bg-white/[0.06]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-black">{category.label}</span>
                  <span className="text-[10px] font-bold text-white/35">{counts[category.id] || 0}</span>
                </div>
                <div className="mt-1 truncate text-[10px] text-white/35">{category.hint}</div>
              </button>
            );
          })}
        </div>

        {error && (
          <div className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-md border border-white/[0.03] bg-white/5 p-4 text-center text-xs text-white/40">
            Checking local engines and models...
          </div>
        ) : (
          <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
            {visibleModels.length === 0 ? (
              <div className="rounded-md border border-white/[0.03] bg-white/5 p-4 text-center text-xs text-white/40">
                No local {activeCategory} models detected yet. Start Ollama, LM Studio, ComfyUI, or Wan2GP, then refresh.
              </div>
            ) : visibleModels.map((model) => {
              const external = model.installMode === 'external-server';
              const engineManaged = model.installMode === 'engine'; // ComfyUI checkpoints etc. — managed by the engine, not the app
              const recipe = model.installMode === 'recipe'; // curated, downloadable-into-engine
              const downloaded = model.state === 'downloaded';
              const available = model.state === 'available';
              const aux = model.auxiliaryStatus || {};
              const fit = recipe ? FIT_STYLE[computeFit(model.fit, gpu)] : null;
              return (
                <div key={model.id} className="rounded-md border border-white/[0.03] bg-white/[0.035] p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-bold text-white">{model.name}</div>
                        {model.featured && (
                          <span className="rounded-md bg-[#22d3ee]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#22d3ee]">
                            Featured
                          </span>
                        )}
                        <ProviderPill provider={model.provider} />
                        {external ? (
                          <StatusBadge ready={available}>{available ? 'Available' : 'External'}</StatusBadge>
                        ) : engineManaged ? (
                          <StatusBadge ready>Ready</StatusBadge>
                        ) : recipe ? (
                          <StatusBadge ready={model.state === 'ready'}>{recipeBadgeText(model.state)}</StatusBadge>
                        ) : (
                          <StatusBadge ready={downloaded}>{downloaded ? 'Ready' : 'Not downloaded'}</StatusBadge>
                        )}
                        {fit && (
                          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${fit.cls}`}>{fit.label}</span>
                        )}
                      </div>
                      <p className="mt-2 text-[12px] leading-relaxed text-white/55">{model.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] font-bold text-white/45">
                          {model.type}
                        </span>
                        {model.sizeGB ? (
                          <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] font-bold text-white/45">
                            {formatGB(model.sizeGB)}
                          </span>
                        ) : null}
                        <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] font-bold text-white/45">
                          {external ? 'local server' : engineManaged ? `${PROVIDER_LABELS[model.provider] || model.provider} engine` : 'direct download'}
                        </span>
                      </div>
                    </div>
                    {external ? (
                      <span className="shrink-0 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-white/55">
                        {available ? 'Detected' : 'Connect'}
                      </span>
                    ) : engineManaged ? (
                      <span className="shrink-0 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-300">
                        Ready
                      </span>
                    ) : recipe ? (
                      model.state === 'ready' ? (
                        <span className="shrink-0 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-300">
                          Ready
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => downloadRecipeStreamed(model.id)}
                          disabled={busyId === model.id}
                          className="shrink-0 rounded-md bg-[#22d3ee] px-3 py-1.5 text-xs font-bold text-black transition hover:bg-[#e5ff33] disabled:cursor-wait disabled:opacity-60"
                        >
                          {busyId === model.id ? 'Working...' : model.state === 'partial' ? 'Resume' : 'Download'}
                        </button>
                      )
                    ) : (
                      <button
                        type="button"
                        onClick={() => (
                          downloaded
                            ? runAction(model.id, () => apiFetch('/api/local-ai/delete-model', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ modelId: model.id }),
                              }))
                            : runAction(model.id, () => apiFetch('/api/local-ai/download-model', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ modelId: model.id }),
                              }))
                        )}
                        disabled={busyId === model.id}
                        className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-bold transition disabled:cursor-wait disabled:opacity-60 ${
                          downloaded
                            ? 'bg-red-500/10 text-red-300 hover:bg-red-500/20'
                            : 'bg-[#22d3ee] text-black hover:bg-[#e5ff33]'
                        }`}
                      >
                        {busyId === model.id ? 'Working...' : downloaded ? 'Delete' : 'Download'}
                      </button>
                    )}
                  </div>

                  {recipe && busyId === model.id && progress[model.id] && (
                    <div className="mt-3 h-1.5 w-full overflow-hidden rounded bg-white/10">
                      <div className="h-full bg-[#22d3ee] transition-all" style={{ width: `${Math.round((progress[model.id].overall || 0) * 100)}%` }} />
                    </div>
                  )}

                  {recipe && (model.state === 'needs-node' || progress[model.id]?.needsNode) && (
                    <div className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/10 p-2 text-[11px] leading-relaxed text-amber-200">
                      Files installed — needs the {model.requiresNode?.name || 'required'} node in ComfyUI.{' '}
                      {model.requiresNode?.repo && (
                        <a href={model.requiresNode.repo} target="_blank" rel="noreferrer" className="underline">Get it</a>
                      )}
                    </div>
                  )}

                  {external && !available && (
                    <div className="mt-3 rounded-md border border-white/[0.04] bg-white/[0.025] p-3 text-[12px] leading-relaxed text-white/55">
                      Run {PROVIDER_LABELS[model.provider] || model.provider} on localhost, then refresh. This keeps the app local while letting heavier models use their best engine.
                      {model.suggestedCommand ? (
                        <code className="mt-2 block overflow-x-auto rounded-md bg-black/30 px-2 py-1 text-[11px] text-white/70">
                          {model.suggestedCommand}
                        </code>
                      ) : null}
                    </div>
                  )}

                  {model.requiresAuxiliary && (
                    <div className="mt-3 space-y-2 border-t border-white/[0.04] pt-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-white/30">
                        Required components
                      </div>
                      {[
                        ['llm', 'Qwen3-4B Text Encoder', '2.4 GB'],
                        ['vae', 'FLUX VAE', '335 MB'],
                      ].map(([auxKey, label, size]) => {
                        const ready = aux[auxKey] === 'downloaded';
                        return (
                          <div key={auxKey} className="flex items-center justify-between gap-3 rounded-md bg-white/[0.025] px-3 py-2">
                            <div className="min-w-0">
                              <div className="truncate text-[12px] font-bold text-white/80">{label}</div>
                              <div className="text-[10px] text-white/35">{size}</div>
                            </div>
                            {ready ? (
                              <StatusBadge ready>Ready</StatusBadge>
                            ) : (
                              <button
                                type="button"
                                onClick={() => runAction(`${model.id}:${auxKey}`, () => apiFetch('/api/local-ai/download-auxiliary', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ auxKey }),
                                }))}
                                disabled={busyId === `${model.id}:${auxKey}`}
                                className="shrink-0 rounded-md bg-[#22d3ee]/10 px-2.5 py-1 text-[11px] font-bold text-[#22d3ee] transition hover:bg-[#22d3ee]/20 disabled:cursor-wait disabled:opacity-60"
                              >
                                {busyId === `${model.id}:${auxKey}` ? 'Downloading...' : 'Get'}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
