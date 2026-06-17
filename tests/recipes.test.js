// tests/recipes.test.js
const test = require('node:test');
const assert = require('node:assert');
const { RECIPES, getRecipe } = require('../lib/local-runtime/catalog/recipes.js');
const { isHostAllowed } = require('../lib/local-runtime/catalog/allowlist.js');

test('recipes: ids are unique and well-formed', () => {
  const ids = RECIPES.map((r) => r.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'duplicate recipe id');
  for (const r of RECIPES) {
    assert.ok(['image', 'chat', 'code', 'video', 'audio'].includes(r.category), `${r.id} bad category`);
    assert.ok(['comfyui', 'ollama', 'sdcpp'].includes(r.engine), `${r.id} bad engine`);
    assert.ok(r.name && r.description, `${r.id} missing name/description`);
  }
});

test('recipes: file-based entries carry allowlisted URLs + safe dests; ollama entries carry pull', () => {
  for (const r of RECIPES) {
    if (r.engine === 'ollama') { assert.ok(r.pull, `${r.id} missing pull`); continue; }
    assert.ok(Array.isArray(r.files) && r.files.length, `${r.id} missing files`);
    for (const f of r.files) {
      assert.ok(isHostAllowed(f.url), `${r.id} url not allowlisted: ${f.url}`);
      assert.ok(f.dest && !f.dest.startsWith('/') && !f.dest.includes('..'), `${r.id} bad dest: ${f.dest}`);
    }
  }
});

test('getRecipe: returns by id or null', () => {
  assert.strictEqual(getRecipe('comfyui:flux2-klein').name, 'FLUX.2 Klein (9B)');
  assert.strictEqual(getRecipe('nope'), null);
});
