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
