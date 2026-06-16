// lib/local-runtime/paths.js
const path = require('path');

// MUST match lib/local-ai-web.js's DATA_DIR convention (<cwd>/.local-ai) so both see the same files.
function getPaths(env = process.env) {
  const dataDir = path.resolve(env.OPEN_GENERATIVE_AI_LOCAL_AI_DIR || path.join(process.cwd(), '.local-ai'));
  const binDir = path.join(dataDir, 'bin');
  const binaryName = process.platform === 'win32' ? 'sd-cli.exe' : 'sd-cli';
  return {
    dataDir,
    binDir,
    modelsDir: path.join(dataDir, 'models'),
    tmpDir: path.join(dataDir, 'tmp'),
    assetsDir: path.join(dataDir, 'assets'),
    binaryPath: path.join(binDir, binaryName),
  };
}

module.exports = { getPaths };
