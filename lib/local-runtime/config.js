// lib/local-runtime/config.js
const fs = require('fs');
const path = require('path');
const { getPaths } = require('./paths.js');

function configPath() { return path.join(getPaths().dataDir, 'config.json'); }

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); }
  catch { return { providers: [] }; }
}
function writeConfig(c) {
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(c, null, 2));
}

function listProviders() { return readConfig().providers || []; }
function getProvider(id) { return listProviders().find((p) => p.id === id) || null; }
function listProvidersSafe() {
  return listProviders().map(({ apiKey, ...rest }) => ({ ...rest, hasApiKey: !!apiKey }));
}
function upsertProvider(provider) {
  const c = readConfig();
  c.providers = (c.providers || []).filter((p) => p.id !== provider.id);
  c.providers.push(provider);
  writeConfig(c);
  return provider;
}
function deleteProvider(id) {
  const c = readConfig();
  c.providers = (c.providers || []).filter((p) => p.id !== id);
  writeConfig(c);
}

module.exports = { listProviders, getProvider, listProvidersSafe, upsertProvider, deleteProvider };
