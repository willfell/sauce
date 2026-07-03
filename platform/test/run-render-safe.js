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
// customJS stores classes as INSTANCES (customJS.RenderSafe = new RenderSafe()),
// and helpers call customJS.RenderSafe.page(dv). Exercise the SAME instance-call
// form here so a regression to static methods (undefined-on-instance trap) fails.
const RenderSafeClass = loadClass('mechanisms/render-safe/render-safe.js', 'RenderSafe');
const RenderSafe = new RenderSafeClass();

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

// ---------- L3 scroll capture/restore ----------
let observers = [], rafs = [], timeouts = [];
function makeScroller(overflow, sh, ch) {
  return { scrollTop: 0, scrollHeight: sh, clientHeight: ch, _cs: { overflowY: overflow } };
}
function makeWin() {
  return {
    __sauceScrollStash: undefined,
    MutationObserver: function (cb) { this.cb = cb; this.observe = () => {}; this.disconnect = () => {}; observers.push(this); },
    requestAnimationFrame: (fn) => { rafs.push(fn); return rafs.length; },
    getComputedStyle: (el) => (el && el._cs) || { overflowY: 'visible' },
    setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; },
    clearTimeout: () => {},
  };
}

ok('RS-CAP-1 captureScroll stashes {path,y,t} from the active scroller + installs observer', () => {
  observers = []; rafs = []; timeouts = [];
  const scroller = makeScroller('auto', 2000, 800); scroller.scrollTop = 640;
  const doc = { querySelector: (sel) => (String(sel).includes('markdown-preview-view') ? scroller : null) };
  const win = makeWin();
  RenderSafe.captureScroll({ doc, win, now: 111, activePath: 'spice/home/Home.md' });
  assert(win.__sauceScrollStash && win.__sauceScrollStash.y === 640, 'y captured');
  assert(win.__sauceScrollStash.path === 'spice/home/Home.md', 'path captured');
  assert(win.__sauceScrollStash.t === 111, 't captured');
  assert(observers.length === 1, 'restore observer installed');
});

ok('RS-CAP-2 no scroller → no stash, no throw', () => {
  observers = [];
  const doc = { querySelector: () => null };
  const win = makeWin();
  RenderSafe.captureScroll({ doc, win, now: 1, activePath: 'x.md' });
  assert(win.__sauceScrollStash === undefined, 'no stash written');
});

ok('RS-CAP-3 already at top (scrollTop 0) → no stash (nothing to preserve)', () => {
  const scroller = makeScroller('auto', 2000, 800); scroller.scrollTop = 0;
  const doc = { querySelector: () => scroller };
  const win = makeWin();
  RenderSafe.captureScroll({ doc, win, now: 1, activePath: 'x.md' });
  assert(win.__sauceScrollStash === undefined, 'no stash at top');
});

ok('RS-REST-1 restore watcher sets scrollTop=y once scrollHeight recovers past y', () => {
  observers = [];
  const scroller = makeScroller('auto', 2000, 800); scroller.scrollTop = 500;
  const doc = { querySelector: () => scroller };
  const win = makeWin();
  RenderSafe.captureScroll({ doc, win, now: 5, activePath: 'a.md' });
  scroller.scrollHeight = 40; scroller.scrollTop = 0;   // teardown: collapsed
  observers[0].cb();                                    // mutation while collapsed → no restore
  assert(scroller.scrollTop === 0, 'not restored while collapsed');
  scroller.scrollHeight = 2000;                         // rebuild: tall again
  observers[0].cb();                                    // mutation after rebuild → restore
  assert(scroller.scrollTop === 500, 'scrollTop restored once tall enough');
});

ok('RS-FIND finder returns a scroller or null and never throws', () => {
  const scroller = makeScroller('scroll', 900, 300);
  const picked = RenderSafe._findScroller({ querySelector: (s) => (String(s).includes('preview') ? null : scroller) });
  assert(picked === scroller || picked === null, 'finder returns scroller or null');
  assert(RenderSafe._findScroller(null) === null, 'null doc → null, no throw');
});

console.log(`\nrun-render-safe: ${passes} passed, ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
