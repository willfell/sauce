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

// 6. Mobile cold-load: dv.current() has .file but has NOT yet populated its
// frontmatter fields (the note renders before the DV index is ready). When it IS
// the active file, page() overlays the metadataCache frontmatter so `type` etc.
// resolve — the previous guard returned the partial page verbatim, leaving
// consumers (breadcrumb / chrome) with an undefined type → empty render on phones.
ok('RS-6 page overlays cached frontmatter onto a partial dv.current() (mobile cold-load)', () => {
  withApp({ path: 'spice/wiki/infra/AWS.md', basename: 'AWS' }, { type: 'wiki-page', title: 'AWS' }, () => {
    const partial = { file: { path: 'spice/wiki/infra/AWS.md', name: 'AWS' } }; // no type yet
    const out = RenderSafe.page({ current: () => partial });
    assert(out && out.file && out.file.path === 'spice/wiki/infra/AWS.md', 'keeps DV .file');
    assert(out.type === 'wiki-page', 'overlays frontmatter.type from metadataCache');
    assert(out.title === 'AWS', 'overlays frontmatter.title');
    assert(partial.type === undefined, 'does NOT mutate the live DV page');
  });
});

// 7. The overlay only FILLS missing fields — DV's own resolved values win.
ok('RS-7 overlay does not clobber DV-resolved fields (DV wins over cache)', () => {
  withApp({ path: 'a/B.md', basename: 'B' }, { type: 'cached', extra: 'x' }, () => {
    const cur = { file: { path: 'a/B.md', name: 'B' }, type: 'live' }; // DV already resolved type
    const out = RenderSafe.page({ current: () => cur });
    assert(out.type === 'live', 'DV type wins over cached');
    assert(out.extra === 'x', 'still fills a field DV was missing');
  });
});

// 8. Only overlay when the DV page IS the active file — never borrow another
// file's frontmatter (embeds / split views render non-active notes).
ok('RS-8 no overlay when dv.current() is not the active file', () => {
  withApp({ path: 'other/Active.md', basename: 'Active' }, { type: 'wiki-page' }, () => {
    const cur = { file: { path: 'embedded/Note.md', name: 'Note' } }; // a different (embedded) file
    const out = RenderSafe.page({ current: () => cur });
    assert(out === cur, 'returns the DV page unchanged (no cross-file overlay)');
    assert(out.type === undefined, 'does not borrow the active file frontmatter');
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
    MutationObserver: function (cb) { this.cb = cb; this._disconnected = false; this.observe = () => {}; this.disconnect = () => { this._disconnected = true; }; observers.push(this); },
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

ok('RS-REST-EARLY an early rAF nudge before any teardown must NOT restore/disconnect (regression)', () => {
  // Regression for the real-browser bug: the rAF fallback fires ~2 frames after
  // capture, BEFORE the Dataview teardown clamps scrollTop. A naive "tall enough
  // → done + disconnect" completed trivially there (scrollTop still == y), so the
  // observer was gone by the time the real teardown+rebuild landed → scroll lost.
  observers = []; rafs = [];
  const scroller = makeScroller('auto', 2000, 800); scroller.scrollTop = 500;
  const doc = { querySelector: () => scroller };
  const win = makeWin();
  RenderSafe.captureScroll({ doc, win, now: 9, activePath: 'e.md' });
  // Fire the early rAF nudges while the content is still intact (no teardown yet).
  for (let i = 0; i < 5 && rafs.length; i++) { const fn = rafs.shift(); fn(); }
  assert(observers[0]._disconnected === false, 'early nudge must NOT disconnect before a teardown is seen');
  assert(scroller.scrollTop === 500, 'no spurious scroll change before teardown');
  // Now the real teardown → clamp → rebuild.
  scroller.scrollHeight = 40; scroller.scrollTop = 0; observers[0].cb();
  assert(scroller.scrollTop === 0, 'still not restored while collapsed');
  scroller.scrollHeight = 2000; observers[0].cb();
  assert(scroller.scrollTop === 500, 'restored to y after the real teardown→rebuild');
  assert(observers[0]._disconnected === true, 'observer disconnects only after the real restore');
});

ok('RS-FIND finder returns a scroller or null and never throws', () => {
  const scroller = makeScroller('scroll', 900, 300);
  const picked = RenderSafe._findScroller({ querySelector: (s) => (String(s).includes('preview') ? null : scroller) });
  assert(picked === scroller || picked === null, 'finder returns scroller or null');
  assert(RenderSafe._findScroller(null) === null, 'null doc → null, no throw');
});

console.log(`\nrun-render-safe: ${passes} passed, ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
