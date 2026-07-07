#!/usr/bin/env node
/**
 * run-prune-orphan-breadcrumb.js — regression guard for pruneOrphanedProjectBreadcrumb
 * (platform/install.js). The project blueprint's pre-mechanism helpers/breadcrumb.js
 * (a `class Breadcrumb`) was dropped from the manifest when the breadcrumb MECHANISM
 * (also `class Breadcrumb`) took over, but lingered at ranch/scripts/project/breadcrumb.js
 * in already-installed vaults → a customJS NAME COLLISION whose winner depends on the
 * platform's file-scan order → on mobile the legacy (no buildSegments) could win → the
 * ChromeBar breadcrumb silently rendered nothing. The prune removes the orphan.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'platform/install.js'), 'utf8');
const m = SRC.match(/async function pruneOrphanedProjectBreadcrumb\(tp, history, git\) \{[\s\S]*?\n\}\n/);
if (!m) { console.error('FAIL: could not extract pruneOrphanedProjectBreadcrumb from install.js'); process.exit(1); }
const NoticeStub = function () {};
const prune = new Function('Notice', `${m[0]}\nreturn pruneOrphanedProjectBreadcrumb;`)(NoticeStub);

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const TARGET = 'ranch/scripts/project/breadcrumb.js';
const LEGACY = 'class Breadcrumb {\n  async render(dv) { /* legacy standalone trail renderer */ }\n}\n';
const MECH = 'class Breadcrumb {\n  async buildSegments(dv) { return []; }\n}\n';
const git = { commit: 'abc123', tag: 'v0.0.0', dirty: false };

function fakeAdapter(files) {
  return {
    exists: async (p) => Object.prototype.hasOwnProperty.call(files, p),
    read: async (p) => { if (!(p in files)) throw new Error('ENOENT: ' + p); return files[p]; },
    write: async (p, b) => { files[p] = b; },
    remove: async (p) => { delete files[p]; },
  };
}
const tpWith = (files) => ({ app: { vault: { adapter: fakeAdapter(files) } } });

(async () => {
  // POB-1..3 — removes the legacy orphan, backs it up first, logs it.
  {
    const files = { [TARGET]: LEGACY };
    const history = [];
    await prune(tpWith(files), history, git);
    ok('POB-1 removes the legacy orphan', !(TARGET in files));
    ok('POB-2 wrote a .sauce-backup with the original body first', files[TARGET + '.sauce-backup'] === LEGACY);
    ok('POB-3 recorded an applied history entry', history.some((h) => h && h.action === 'applied' && h.removed === TARGET));
  }
  // POB-4 — guard: never remove a file exposing the mechanism API (buildSegments).
  {
    const files = { [TARGET]: MECH };
    await prune(tpWith(files), [], git);
    ok('POB-4 leaves a mechanism-API file untouched (has buildSegments)', (TARGET in files) && !((TARGET + '.sauce-backup') in files));
  }
  // POB-5 — guard: never remove a non-Breadcrumb file at that path.
  {
    const files = { [TARGET]: 'class SomethingElse {}\n' };
    await prune(tpWith(files), [], git);
    ok('POB-5 leaves a non-Breadcrumb file untouched', TARGET in files);
  }
  // POB-6 — no-op + never-throw when the orphan is absent.
  {
    let threw = false;
    try { await prune(tpWith({}), [], git); } catch (_e) { threw = true; }
    ok('POB-6 no-op + never-throw when the orphan is absent', !threw);
  }
  console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
  process.exit(results.every(([, c]) => c) ? 0 : 1);
})();
