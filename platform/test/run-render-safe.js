'use strict';
// Behavioral harness for the render-safe mechanism (RenderSafe customJS class).
// RenderSafe centralizes the dv.current() cold-load fallback: when Dataview has
// not yet indexed the embedding file, dv.current() is undefined and a bare
// .file deref throws. RenderSafe.page(dv) returns dv.current() when present, else
// a shim built from app.workspace.getActiveFile() + cached frontmatter, else null.
const fs = require('fs');
const path = require('path');

let passes = 0, fails = 0;
function ok(name, fn) { try { fn(); console.log('ok ' + name); passes++; } catch (e) { console.error('FAIL ' + name + ': ' + (e && e.message)); fails++; } }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

function loadClass(relPath, className) {
  const src = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
  return new Function(`${src}; return ${className};`)();
}
const RenderSafe = loadClass('mechanisms/render-safe/render-safe.js', 'RenderSafe');

// Global `app` stub used by the getActiveFile fallback branch.
function withApp(activeFile, frontmatter, run) {
  const prev = global.app;
  global.app = {
    workspace: { getActiveFile: () => activeFile },
    metadataCache: { getFileCache: (f) => (f && frontmatter ? { frontmatter } : null) },
  };
  try { return run(); } finally { global.app = prev; }
}

// 1. dv.current() present -> returned verbatim.
ok('RS-1 page returns dv.current() when present', () => {
  const page = { file: { path: 'a/B.md', name: 'B' }, day: '2026-06-26' };
  const out = RenderSafe.page({ current: () => page });
  assert(out === page, 'expected the live page object');
});

// 2. dv.current() undefined + active file -> shim with path/name + frontmatter.
ok('RS-2 page falls back to active-file shim', () => {
  withApp({ path: 'spice/x/Note.md', basename: 'Note' }, { day: '2026-06-26', workstream: 'w1' }, () => {
    const out = RenderSafe.page({ current: () => undefined });
    assert(out && out.file, 'expected a shim with .file');
    assert(out.file.path === 'spice/x/Note.md', 'shim path');
    assert(out.file.name === 'Note', 'shim name = basename (no ext)');
    assert(out.day === '2026-06-26', 'shim carries frontmatter.day');
    assert(out.workstream === 'w1', 'shim carries frontmatter.workstream');
  });
});

// 3. dv.current() null + no active file -> null (never throws).
ok('RS-3 page returns null when no current + no active file', () => {
  withApp(null, null, () => { assert(RenderSafe.page({ current: () => null }) === null, 'expected null'); });
});

// 4. dv lacking .current (unit-test shim) -> null, no throw.
ok('RS-4 page tolerates dv without .current', () => {
  withApp(null, null, () => { assert(RenderSafe.page({}) === null, 'expected null'); });
});

// 5. filePath / fileName helpers.
ok('RS-5 filePath + fileName derive from page', () => {
  const dv = { current: () => ({ file: { path: 'p/Q.md', name: 'Q' } }) };
  assert(RenderSafe.filePath(dv) === 'p/Q.md', 'filePath');
  assert(RenderSafe.fileName(dv) === 'Q', 'fileName');
  withApp(null, null, () => {
    assert(RenderSafe.filePath({ current: () => null }) === null, 'filePath null');
    assert(RenderSafe.fileName({ current: () => null }) === null, 'fileName null');
  });
});

console.log(`\nrun-render-safe: ${passes} passed, ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
