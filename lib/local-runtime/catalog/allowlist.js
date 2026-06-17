// lib/local-runtime/catalog/allowlist.js
// Download URLs in recipes are restricted to these hosts so a catalog entry can never point the
// downloader at an arbitrary server. Subdomains of each base host are allowed (HF serves bytes
// from cdn-lfs.* hostnames).
const ALLOWED_HOSTS = ['huggingface.co', 'hf.co'];

function isHostAllowed(url, allowed = ALLOWED_HOSTS) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  return allowed.some((h) => host === h || host.endsWith(`.${h}`));
}

module.exports = { isHostAllowed, ALLOWED_HOSTS };
