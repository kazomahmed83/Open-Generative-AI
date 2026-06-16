// lib/local-runtime/storage.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getPaths } = require('./paths.js');

function saveAsset(buffer, ext = 'png') {
  const { assetsDir } = getPaths();
  fs.mkdirSync(assetsDir, { recursive: true });
  const key = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const filePath = path.join(assetsDir, key);
  fs.writeFileSync(filePath, buffer);
  return { key, url: `/api/assets/${key}`, path: filePath };
}

function getAssetPath(key) {
  const { assetsDir } = getPaths();
  const resolved = path.resolve(assetsDir, key);
  if (!resolved.startsWith(path.resolve(assetsDir) + path.sep)) throw new Error('Invalid asset key');
  return resolved;
}

module.exports = { saveAsset, getAssetPath };
