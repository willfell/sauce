#!/usr/bin/env node
/**
 * run-open-helpers.js — unit-tests OpenHelpers.forceActiveLeafPreview logic
 * against a stubbed Obsidian app. Runtime leaf-flipping is verified manually
 * in dogfood (no Dataview/Obsidian process headless).
 */
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'mechanisms', 'open-helpers', 'open-helpers.js'), 'utf8');

function loadClass(app) {
  // Provide `app`, `setTimeout` (synchronous shim so the deferred body runs now).
  const syncTimeout = (fn) => { fn(); return 0; };
  const fn = new Function('app', 'setTimeout', `${SRC}\nreturn OpenHelpers;`);
  return fn(app, syncTimeout);
}
function fakeLeaf(viewState) {
  return {
    _state: viewState,
    getViewState() { return this._state; },
    setViewState(s) { this._applied = s; },
  };
}
const results = [];
function ok(name, cond) { results.push([name, !!cond]); console.log(`  ${cond ? 'PASS' : 'FAIL'} — ${name}`); }

// OH1 — markdown leaf in source mode → flipped to preview
{
  const leaf = fakeLeaf({ type: 'markdown', state: { mode: 'source' } });
  const app = { workspace: { activeLeaf: leaf } };
  new (loadClass(app))().forceActiveLeafPreview();
  ok('OH1 markdown source → preview', leaf._applied && leaf._applied.state.mode === 'preview');
}
// OH2 — already preview → no setViewState call (idempotent / no churn)
{
  const leaf = fakeLeaf({ type: 'markdown', state: { mode: 'preview' } });
  const app = { workspace: { activeLeaf: leaf } };
  new (loadClass(app))().forceActiveLeafPreview();
  ok('OH2 already preview → no-op', leaf._applied === undefined);
}
// OH3 — non-markdown leaf (e.g. kanban board) → skipped
{
  const leaf = fakeLeaf({ type: 'kanban', state: {} });
  const app = { workspace: { activeLeaf: leaf } };
  new (loadClass(app))().forceActiveLeafPreview();
  ok('OH3 non-markdown → skipped', leaf._applied === undefined);
}
// OH4 — no active leaf → no throw
{
  const app = { workspace: { activeLeaf: null } };
  let threw = false;
  try { new (loadClass(app))().forceActiveLeafPreview(); } catch (_e) { threw = true; }
  ok('OH4 no active leaf → no throw', !threw);
}

const allPass = results.every(([, p]) => p);
console.log(`\n${results.filter(([, p]) => p).length}/${results.length} passed`);
process.exit(allPass ? 0 : 1);
