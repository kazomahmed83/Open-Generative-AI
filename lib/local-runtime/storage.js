// lib/local-runtime/storage.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getPaths } = require('./paths.js');

function saveAsset(buffer, ext = 'png') {
  const { assetsDir } = getPaths();
  fs.mkdirSync(assetsDir, { recursive: true });
  // Sanitize ext to [a-z0-9] (max 8): the ext can be caller/upload-derived, so this
  // guards the WRITE path against separators / path traversal in the generated key.
  const safeExt = String(ext).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'png';
  const key = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${safeExt}`;
  const filePath = path.join(assetsDir, key);
  fs.writeFileSync(filePath, buffer);
  return { key, url: `/api/assets/${key}`, path: filePath };
}

function getAssetPath(key) {
  const { assetsDir } = getPaths();
  const base = path.resolve(assetsDir);
  const resolved = path.resolve(base, key);
  // Cross-platform containment check (handles Windows case-insensitivity + drive changes).
  const rel = path.relative(base, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Invalid asset key');
  return resolved;
}

module.exports = { saveAsset, getAssetPath };
