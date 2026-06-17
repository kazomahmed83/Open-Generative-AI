#!/usr/bin/env node
/**
 * Ensures every npm workspace package is resolvable from node_modules/<name>.
 *
 * Why this exists: on Windows, npm's workspace symlink step can silently fail
 * (no Developer Mode / admin), leaving node_modules/<name> as an EMPTY directory.
 * That makes `import ... from 'studio'` fail at build time even though the package
 * exists under packages/. This script (run from postinstall + `npm run setup`)
 * repairs those by creating a real link (junction on Windows, symlink elsewhere).
 *
 * It is idempotent and safe: existing valid links are left untouched, and a real
 * (non-empty) directory is never deleted.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const rootPkg = require(path.join(root, 'package.json'));
const workspaces = rootPkg.workspaces || [];

let linked = 0;
let skipped = 0;

for (const ws of workspaces) {
  const pkgDir = path.join(root, ws);
  const pkgJsonPath = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) {
    console.warn(`[link-workspaces] skip (no package.json): ${ws}`);
    continue;
  }
  const name = require(pkgJsonPath).name;
  if (!name) {
    console.warn(`[link-workspaces] skip (no name): ${ws}`);
    continue;
  }
  const linkPath = path.join(root, 'node_modules', name);

  // Inspect current state of node_modules/<name>.
  let existing = null;
  try { existing = fs.lstatSync(linkPath); } catch { /* nothing there */ }

  if (existing) {
    if (existing.isSymbolicLink()) { skipped++; continue; } // junction/symlink already in place
    if (existing.isDirectory()) {
      const entries = fs.readdirSync(linkPath);
      if (entries.length > 0) { skipped++; continue; } // real populated dir — leave it alone
      fs.rmdirSync(linkPath); // empty stub from a failed link — remove and relink
    } else {
      skipped++; continue; // a file — unexpected, don't touch
    }
  }

  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  try {
    fs.symlinkSync(pkgDir, linkPath, type);
    linked++;
    console.log(`[link-workspaces] linked ${name} -> ${path.relative(root, pkgDir)}`);
  } catch (err) {
    console.error(`[link-workspaces] FAILED to link ${name}: ${err.message}`);
  }
}

console.log(`[link-workspaces] done (${linked} linked, ${skipped} already ok)`);
