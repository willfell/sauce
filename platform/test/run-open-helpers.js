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
// OH5 — forceLeafPreview(leaf) flips the CAPTURED leaf and never reads
// activeLeaf, even when activeLeaf points at a different (decoy) note. This is
// the capture-vs-activeLeaf guarantee: focus may move between call time and the
// deferred flip, so the helper must operate on the passed handle only.
{
  const captured = fakeLeaf({ type: 'markdown', state: { mode: 'source' } });
  const decoy = fakeLeaf({ type: 'markdown', state: { mode: 'source' } });
  // Trap any read of activeLeaf — forceLeafPreview must never touch it.
  let activeLeafRead = false;
  const app = {
    workspace: {
      // decoy IS the active leaf; if the helper (wrongly) read activeLeaf it
      // would flip the decoy. The getter also records that a read happened.
      get activeLeaf() { activeLeafRead = true; return decoy; },
    },
  };
  // Capture happens at call time; the sync setTimeout shim fires the body
  // immediately. activeLeaf already = decoy, so a capture-respecting helper
  // ignores it entirely.
  new (loadClass(app))().forceLeafPreview(captured);
  ok('OH5 forceLeafPreview flips the CAPTURED leaf',
     captured._applied && captured._applied.state.mode === 'preview');
  ok('OH5 forceLeafPreview leaves the decoy (activeLeaf) untouched',
     decoy._applied === undefined);
  ok('OH5 forceLeafPreview never reads activeLeaf', activeLeafRead === false);
}

const allPass = results.every(([, p]) => p);
console.log(`\n${results.filter(([, p]) => p).length}/${results.length} passed`);
process.exit(allPass ? 0 : 1);
