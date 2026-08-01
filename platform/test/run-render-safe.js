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
const asyncCases = [];
function okAsync(name, fn) { asyncCases.push({ name, fn }); }

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

// ---------- Shared gesture mutation lifecycle ----------
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function flushMicrotasks(rounds) {
  for (let i = 0; i < (rounds || 6); i++) await Promise.resolve();
}

function makeManualTimers() {
  let nextId = 1;
  const queue = [];
  const cleared = [];
  const api = {
    setTimeout(fn, ms) {
      const item = { id: nextId++, fn, ms, cleared: false };
      queue.push(item);
      return item.id;
    },
    clearTimeout(id) {
      cleared.push(id);
      const item = queue.find((entry) => entry.id === id);
      if (item) item.cleared = true;
    },
  };
  return {
    api,
    queue,
    cleared,
    async runNext() {
      while (queue.length) {
        const item = queue.shift();
        if (item.cleared) continue;
        item.fn();
        await flushMicrotasks();
        return item;
      }
      return null;
    },
    async runAll(limit) {
      let count = 0;
      while (queue.some((item) => !item.cleared)) {
        assert(count++ < (limit || 50), 'timer queue did not settle');
        await this.runNext();
      }
    },
  };
}

function makeMutationApp(activePath) {
  const calls = { on: 0, offref: 0, refresh: 0, listener: null };
  const ref = { id: 'metadata-ref' };
  const app = {
    workspace: { getActiveFile: () => activePath ? { path: activePath } : null },
    metadataCache: {
      on(event, listener) {
        assert(event === 'changed', 'expected changed listener');
        calls.on++;
        calls.listener = listener;
        return ref;
      },
      offref(got) {
        assert(got === ref, 'detaches the exact listener ref');
        calls.offref++;
      },
    },
    commands: {
      executeCommandById(id) {
        assert(id === 'dataview:dataview-force-refresh-views', 'canonical force-refresh command');
        calls.refresh++;
      },
    },
  };
  return { app, calls };
}

ok('GA-P1-METHOD mutate is available on the CustomJS instance prototype', () => {
  assert(typeof RenderSafe.mutate === 'function', 'instance exposes mutate');
  assert(!Object.prototype.hasOwnProperty.call(RenderSafeClass, 'mutate'), 'mutate is not a static class member');
});

okAsync('GA-P1-SCROLL-CAPTURE-ALWAYS capture precedes optimistic/write on every path', async () => {
  const cases = [
    { name: 'active-success', mode: 'active', fail: false },
    { name: 'background-success', mode: 'background', fail: false },
    { name: 'create-success', mode: 'create', fail: false },
    { name: 'active-failure', mode: 'active', fail: true },
    { name: 'background-failure', mode: 'background', fail: true },
  ];
  for (const fixture of cases) {
    const rs = new RenderSafeClass();
    const order = [];
    rs.captureScroll = () => { order.push('capture'); };
    const result = await rs.mutate({
      app: {},
      mode: fixture.mode,
      path: 'spice/x.md',
      optimistic: () => { order.push('optimistic'); },
      write: () => {
        order.push('write');
        if (fixture.fail) throw new Error(fixture.name);
        return fixture.name;
      },
    });
    assert(order.join(',') === 'capture,optimistic,write', fixture.name + ' order: ' + order.join(','));
    assert(result.ok === !fixture.fail, fixture.name + ' deterministic result');
  }
});

okAsync('GA-P1-OPTIMISTIC-BEFORE-WRITE awaits optimistic UI and deferred write settlement', async () => {
  const rs = new RenderSafeClass();
  const optimisticGate = deferred();
  const writeGate = deferred();
  const order = [];
  rs.captureScroll = () => { order.push('capture'); };
  let settled = false;
  const pending = rs.mutate({
    mode: 'background',
    optimistic: async () => {
      order.push('optimistic-start');
      await optimisticGate.promise;
      order.push('optimistic-done');
    },
    write: async () => {
      order.push('write-start');
      return writeGate.promise;
    },
  }).then((result) => { settled = true; return result; });
  await flushMicrotasks();
  assert(order.join(',') === 'capture,optimistic-start', 'write must not begin before optimistic settles');
  assert(settled === false, 'mutate remains pending during optimistic work');
  optimisticGate.resolve();
  await flushMicrotasks();
  assert(order.join(',') === 'capture,optimistic-start,optimistic-done,write-start', 'write starts after optimistic completion');
  assert(settled === false, 'mutate remains pending while write is deferred');
  writeGate.resolve('written');
  const result = await pending;
  assert(result.ok && result.value === 'written', 'success result carries write value');
});

okAsync('GA-P1-REVERT-NOTICE-ON-FAILURE reverts/notices once, never refreshes, preserves error', async () => {
  const rs = new RenderSafeClass();
  const original = new Error('disk rejected');
  const runtime = makeMutationApp('spice/tasks/X.md');
  const calls = { revert: 0, notices: [] };
  const result = await rs.mutate({
    app: runtime.app,
    dv: { page: () => ({ file: { path: 'spice/tasks/X.md' }, status: 'open' }) },
    path: 'spice/tasks/X.md',
    mode: 'active',
    isCurrent: () => false,
    write: async () => { throw original; },
    revert: async (error) => {
      calls.revert++;
      assert(error === original, 'revert receives original reason');
      throw new Error('revert also failed');
    },
    Notice: function (message) { calls.notices.push(message); },
  });
  assert(result.ok === false, 'deterministic failure result');
  assert(result.error === original, 'original failure is not masked');
  assert(calls.revert === 1, 'revert exactly once');
  assert(calls.notices.length === 1 && calls.notices[0].includes('disk rejected'), 'one visible failure Notice');
  assert(runtime.calls.refresh === 0, 'failure never refreshes');
  assert(runtime.calls.on === 1 && runtime.calls.offref === 1, 'failure cleans its pre-armed metadata listener exactly once');
});

okAsync('GA-P1-ACTIVE-POLL-BEFORE-REFRESH waits for matching signal and stale→current page', async () => {
  const rs = new RenderSafeClass();
  rs.captureScroll = () => {};
  const timers = makeManualTimers();
  const { app, calls } = makeMutationApp('spice/tasks/X.md');
  let page = { file: { path: 'spice/tasks/X.md' }, status: 'open' };
  let pageReads = 0;
  const dv = { page: () => { pageReads++; return page; } };
  const pending = rs.mutate({
    app,
    dv,
    path: 'spice/tasks/X.md',
    mode: 'active',
    timers: timers.api,
    pollAttempts: 3,
    isCurrent: (current) => !!current && current.status === 'done',
    write: () => 'saved',
  });
  await flushMicrotasks();
  assert(calls.on === 1 && typeof calls.listener === 'function', 'listener is pre-armed');
  assert(calls.refresh === 0, 'no refresh merely because write settled');
  calls.listener({ path: 'spice/tasks/Other.md' });
  assert(pageReads === 1 && calls.refresh === 0, 'non-matching metadata signal is ignored');
  calls.listener({ path: 'spice/tasks/X.md' });
  assert(pageReads === 2 && calls.refresh === 0, 'matching signal polls but stale page does not refresh');
  calls.listener({ path: 'spice/tasks/X.md' });
  assert(pageReads === 2, 'duplicate matching signals cannot restart the bounded poll');
  page.status = 'done'; // Dataview may update a cached page object in place.
  await timers.runNext();
  assert(calls.refresh === 1, 'an in-place indexed page update is recognized as current');
  const result = await pending;
  assert(result.ok && result.value === 'saved', 'write result preserved');
  assert(pageReads === 3, 'authoritative page polled until current');
  assert(calls.refresh === 1, 'exactly one refresh after current');
  assert(calls.offref === 1, 'metadata listener detached exactly once');
});

async function runUnchangedActiveFixture(beforePage, afterPage, label) {
  const rs = new RenderSafeClass();
  rs.captureScroll = () => {};
  const timers = makeManualTimers();
  const { app, calls } = makeMutationApp('A.md');
  let pageReads = 0;
  const result = await rs.mutate({
    app,
    dv: { page: () => { pageReads++; return afterPage || beforePage; } },
    path: 'A.md',
    mode: 'active',
    timers: timers.api,
    pollAttempts: 1,
    write: () => true,
  });
  assert(result.ok, label + ' preserves write success');
  assert(pageReads === 0, label + ' page shape is never read without mutation authority');
  assert(calls.on === 0 && calls.offref === 0, label + ' installs no unnecessary listener');
  assert(timers.queue.length === 0, label + ' incurs no bounded polling delay');
  assert(calls.refresh === 0, label + ' never authorizes forced refresh');
}

async function runChangedActiveFixture(beforePage, afterPage, label) {
  await runUnchangedActiveFixture(beforePage, afterPage, label);
}

okAsync('GA-P1A-PAGE-STAMP-FALSE-FRESH reordered page keys remain semantically stale', async () => {
  await runUnchangedActiveFixture(
    { file: { path: 'A.md' }, status: 'open', details: { owner: 'Will', rank: 2 } },
    { details: { rank: 2, owner: 'Will' }, status: 'open', file: { path: 'A.md' } },
    'reordered keys',
  );
});

okAsync('GA-P1A-PAGE-STAMP-FALSE-FRESH volatile file metadata cannot prove freshness', async () => {
  await runUnchangedActiveFixture(
    { file: { path: 'A.md', mtime: 100, ctime: 50, size: 20 }, status: 'open' },
    { file: { path: 'A.md', mtime: 200, ctime: 50, size: 21, link: { path: 'A.md' } }, status: 'open' },
    'volatile file metadata',
  );
});

okAsync('GA-P1A-PAGE-STAMP-FALSE-FRESH true root and nested deltas lack mutation authority', async () => {
  for (const fixture of [
    {
      label: 'root',
      before: { file: { path: 'A.md' }, status: 'open', details: { owner: 'Will', rank: 2 } },
      after: { details: { rank: 2, owner: 'Will' }, status: 'done', file: { path: 'A.md', mtime: 200 } },
    },
    {
      label: 'nested',
      before: { file: { path: 'A.md' }, status: 'open', details: { owner: 'Will', rank: 2 } },
      after: { details: { rank: 3, owner: 'Will' }, status: 'open', file: { path: 'A.md', mtime: 200 } },
    },
  ]) {
    await runChangedActiveFixture(
      fixture.before,
      fixture.after,
      fixture.label + ' semantic delta',
    );
  }
});

okAsync('GA-P1A-PAGE-STAMP-FALSE-FRESH injected isCurrent remains authoritative', async () => {
  const rs = new RenderSafeClass();
  rs.captureScroll = () => {};
  const timers = makeManualTimers();
  const { app, calls } = makeMutationApp('A.md');
  const before = { file: { path: 'A.md' }, status: 'open' };
  let page = before;
  let authoritative = false;
  let seenBefore = null;
  const pending = rs.mutate({
    app,
    dv: { page: () => page },
    path: 'A.md',
    mode: 'active',
    timers: timers.api,
    pollAttempts: 2,
    isCurrent(current, beforePage) {
      seenBefore = beforePage;
      return authoritative && current.status === 'done';
    },
    write: () => true,
  });
  await flushMicrotasks();
  page = { file: { path: 'A.md' }, status: 'done' };
  calls.listener({ path: 'A.md' });
  assert(calls.refresh === 0, 'custom predicate can hold a semantically changed page');
  assert(seenBefore === before, 'custom predicate receives the captured pre-write page');
  authoritative = true;
  await timers.runNext();
  const result = await pending;
  assert(result.ok && calls.refresh === 1, 'custom predicate releases exactly one refresh');
});

async function runUnrelatedInterleavingFixture(ClassUnderTest, useMutationAuthority) {
  const rs = new ClassUnderTest();
  rs.captureScroll = () => {};
  const timers = makeManualTimers();
  const { app, calls } = makeMutationApp('A.md');
  const writeGate = deferred();
  let page = {
    file: { path: 'A.md', mtime: 100 },
    status: 'open',
    owner: 'Will',
  };
  const opts = {
    app,
    dv: { page: () => page },
    path: 'A.md',
    mode: 'active',
    timers: timers.api,
    pollAttempts: 2,
    write: () => writeGate.promise,
  };
  if (useMutationAuthority) {
    opts.isCurrent = (current) => !!current && current.status === 'done';
  }
  let settled = false;
  const pending = rs.mutate(opts).then((result) => {
    settled = true;
    return result;
  });
  await flushMicrotasks();
  assert(calls.on === 1 && typeof calls.listener === 'function', 'metadata signal is pre-armed before the pending write');

  // Another same-file gesture indexes first while this mutation is still
  // pending. The generic whole-page comparator used by GA-P1a4 mistook this
  // unrelated owner/mtime delta for proof that status=done was current.
  page = {
    file: { path: 'A.md', mtime: 200 },
    status: 'open',
    owner: 'Ari',
  };
  calls.listener({ path: 'A.md' });
  assert(calls.refresh === 0 && settled === false, 'unrelated signal cannot refresh while the intended write is pending');

  writeGate.resolve('saved');
  await flushMicrotasks();
  return { calls, pending, settled: () => settled, timers, setPage: (next) => { page = next; } };
}

okAsync('GA-P1A4-UNRELATED-SEMANTIC-FALSE-CURRENT mutation authority rejects unrelated pending-write interleaving', async () => {
  const outcome = await runUnrelatedInterleavingFixture(RenderSafeClass, true);
  assert(outcome.calls.refresh === 0, 'unrelated same-file delta remains stale after the intended write resolves');
  assert(outcome.settled() === false, 'authorized reconciliation remains bounded while intended status is stale');
  outcome.setPage({
    file: { path: 'A.md', mtime: 300 },
    status: 'done',
    owner: 'Ari',
  });
  await outcome.timers.runNext();
  const result = await outcome.pending;
  assert(result.ok && result.value === 'saved', 'interleaved mutation preserves the write result');
  assert(outcome.calls.refresh === 1, 'refresh occurs exactly once after mutation-specific status is indexed');
  assert(outcome.calls.offref === 1, 'interleaved reconciliation detaches its pre-armed listener');
});

okAsync('GA-P1A4-UNRELATED-SEMANTIC-FALSE-CURRENT generic whole-page comparator mutant turns red', async () => {
  const sourcePath = path.join(__dirname, '..', 'mechanisms', 'render-safe', 'render-safe.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const authorityAnchor = `    const activeAuthority = mode === 'active' && typeof opts.isCurrent === 'function';`;
  const currentAnchor = `      if (typeof opts.isCurrent !== 'function') return false;`;
  assert(source.includes(authorityAnchor), 'active reconciliation is explicitly mutation-authority gated');
  assert(source.includes(currentAnchor), 'current-page authority has no generic comparator fallback');
  const mutantSource = source
    .replace(authorityAnchor, `    const activeAuthority = mode === 'active';`)
    .replace(currentAnchor, `      if (typeof opts.isCurrent !== 'function') {
        try { return JSON.stringify(page) !== JSON.stringify(opts.beforePage); } catch (_e) { return false; }
      }`);
  const MutantClass = new Function(`${mutantSource}; return RenderSafe;`)();
  const outcome = await runUnrelatedInterleavingFixture(MutantClass, false);
  const result = await outcome.pending;
  assert(result.ok, 'generic comparator mutant preserves the write result');
  assert(outcome.calls.refresh === 1, 'mutant reproduces the forbidden refresh on an unrelated same-file delta');
});

async function runAuthorityShapeFixture(ClassUnderTest, predicate) {
  const rs = new ClassUnderTest();
  rs.captureScroll = () => {};
  const timers = makeManualTimers();
  const { app, calls } = makeMutationApp('A.md');
  const pending = rs.mutate({
    app,
    dv: { page: () => ({ file: { path: 'A.md' }, status: 'stale' }) },
    path: 'A.md',
    mode: 'active',
    timers: timers.api,
    pollAttempts: 1,
    isCurrent: predicate,
    write: () => 'saved',
  });
  await flushMicrotasks();
  calls.listener({ path: 'A.md' });
  const signalRefreshes = calls.refresh;
  await timers.runAll();
  const result = await pending;
  await new Promise((resolve) => setImmediate(resolve));
  return { calls, result, signalRefreshes, timers };
}

okAsync('GA-P1A5-ASYNC-ISCURRENT-FALSE-AUTHORIZES only synchronous literal true authorizes refresh', async () => {
  const pendingPromise = new Promise(() => {});
  const throwingThenGetter = {};
  Object.defineProperty(throwingThenGetter, 'then', {
    get() { throw new Error('then getter denied'); },
  });
  const fixtures = [
    { label: 'sync false', predicate: () => false },
    { label: 'truthy non-boolean object', predicate: () => ({ current: true }) },
    { label: 'resolved true Promise', predicate: () => Promise.resolve(true) },
    { label: 'resolved false Promise', predicate: () => Promise.resolve(false) },
    { label: 'pending Promise', predicate: () => pendingPromise },
    { label: 'rejecting Promise', predicate: () => Promise.reject(new Error('async false')) },
    { label: 'resolving true thenable', predicate: () => ({ then(resolve) { resolve(true); } }) },
    { label: 'rejecting thenable', predicate: () => ({ then(_resolve, reject) { reject(new Error('thenable false')); } }) },
    { label: 'throwing then getter', predicate: () => throwingThenGetter },
    { label: 'throwing predicate', predicate: () => { throw new Error('sync false'); } },
  ];
  const unhandled = [];
  const onUnhandled = (reason) => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  try {
    for (const fixture of fixtures) {
      const outcome = await runAuthorityShapeFixture(RenderSafeClass, fixture.predicate);
      assert(outcome.signalRefreshes === 0, fixture.label + ' cannot authorize at the metadata signal');
      assert(outcome.result.ok && outcome.result.value === 'saved', fixture.label + ' preserves write success');
      assert(outcome.calls.refresh === 0, fixture.label + ' remains fail-closed through bounded timeout');
      assert(outcome.calls.offref === 1, fixture.label + ' detaches its metadata listener');
    }
    assert(unhandled.length === 0, 'rejecting promises and thenables emit no unhandled rejection');
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
});

okAsync('GA-P1A5-ASYNC-ISCURRENT-FALSE-AUTHORIZES coercion mutant turns red', async () => {
  const sourcePath = path.join(__dirname, '..', 'mechanisms', 'render-safe', 'render-safe.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const strictAnchor = `        if (verdict === true) return true;`;
  const coercionMutant = `        if (!!verdict) return true;`;
  assert(source.includes(strictAnchor), 'production authority requires literal boolean true');
  const mutantSource = source.replace(strictAnchor, coercionMutant);
  const MutantClass = new Function(`${mutantSource}; return RenderSafe;`)();
  const outcome = await runAuthorityShapeFixture(MutantClass, () => Promise.resolve(false));
  assert(outcome.result.ok, 'coercion mutant preserves the write result');
  assert(outcome.signalRefreshes === 1 && outcome.calls.refresh === 1, 'coercion mutant reproduces stale refresh from async false');
});

okAsync('GA-P1A3-COLD-UNINDEXED-ACTIVE-FALSE-FRESH null before page cannot authorize a stale active refresh', async () => {
  await runUnchangedActiveFixture(
    null,
    { file: { path: 'A.md', mtime: 200 }, status: 'open' },
    'cold null-before to first stampable stale page',
  );
});

okAsync('GA-P1A3-COLD-UNINDEXED-ACTIVE-FALSE-FRESH explicit isCurrent authorizes a cold active transition', async () => {
  const rs = new RenderSafeClass();
  rs.captureScroll = () => {};
  const timers = makeManualTimers();
  const { app, calls } = makeMutationApp('A.md');
  let page = null;
  let seenBefore = 'unset';
  const pending = rs.mutate({
    app,
    dv: { page: () => page },
    path: 'A.md',
    mode: 'active',
    timers: timers.api,
    isCurrent(current, before) {
      seenBefore = before;
      return !!current && current.status === 'done';
    },
    write: () => true,
  });
  await flushMicrotasks();
  page = { file: { path: 'A.md', mtime: 200 }, status: 'done' };
  calls.listener({ path: 'A.md' });
  const result = await pending;
  assert(seenBefore === null, 'explicit predicate receives the cold null before-page');
  assert(result.ok && calls.refresh === 1, 'explicit predicate authorizes one cold transition refresh');
  assert(calls.offref === 1, 'authorized cold transition detaches once');
});

async function runActiveMissingDvFixture(ClassUnderTest, dv, isCurrent) {
  const rs = new ClassUnderTest();
  rs.captureScroll = () => {};
  const timers = makeManualTimers();
  const { app, calls } = makeMutationApp('A.md');
  const opts = {
    app,
    dv,
    path: 'A.md',
    mode: 'active',
    timers: timers.api,
    pollAttempts: 1,
    write: () => true,
  };
  if (typeof isCurrent === 'function') opts.isCurrent = isCurrent;
  const pending = rs.mutate(opts);
  await flushMicrotasks();
  if (typeof calls.listener === 'function') calls.listener({ path: 'A.md' });
  const signalRefreshes = calls.refresh;
  await timers.runAll();
  const result = await pending;
  return { calls, result, signalRefreshes, timers };
}

async function assertActiveMissingDvFailsClosed(label, dv) {
  const outcome = await runActiveMissingDvFixture(RenderSafeClass, dv);
  assert(outcome.signalRefreshes === 0, label + ' cannot authorize signal-time refresh');
  assert(outcome.result.ok, label + ' preserves successful write result');
  assert(outcome.calls.refresh === 0, label + ' never redraws unproven data');
  assert(outcome.calls.on === 0 && outcome.calls.offref === 0, label + ' installs no listener without authority');
  assert(outcome.timers.queue.length === 0, label + ' incurs no bounded polling delay');
}

okAsync('GA-P1A4-ACTIVE-MISSING-DV-FALSE-FRESH null Dataview fails closed', async () => {
  await assertActiveMissingDvFailsClosed('null Dataview', null);
});

okAsync('GA-P1A4-ACTIVE-MISSING-DV-FALSE-FRESH missing page method fails closed', async () => {
  await assertActiveMissingDvFailsClosed('missing page method', {});
});

okAsync('GA-P1A4-ACTIVE-MISSING-DV-FALSE-FRESH non-callable page method fails closed', async () => {
  await assertActiveMissingDvFailsClosed('non-callable page method', { page: 'unusable' });
});

okAsync('GA-P1A4-ACTIVE-MISSING-DV-FALSE-FRESH throwing page method fails closed', async () => {
  await assertActiveMissingDvFailsClosed('throwing page method', {
    page() { throw new Error('Dataview unavailable'); },
  });
});

okAsync('GA-P1A4-ACTIVE-MISSING-DV-FALSE-FRESH explicit isCurrent remains the no-stamp authority', async () => {
  let predicateCalls = 0;
  const outcome = await runActiveMissingDvFixture(RenderSafeClass, null, (page, beforePage) => {
    predicateCalls++;
    assert(page === null && beforePage === null, 'predicate receives the unavailable active pages');
    return true;
  });
  assert(outcome.signalRefreshes === 1, 'explicit predicate authorizes one signal-time refresh');
  assert(outcome.result.ok && outcome.calls.refresh === 1, 'explicit predicate refreshes exactly once');
  assert(predicateCalls === 1, 'explicit predicate is consulted exactly once');
  assert(outcome.calls.offref === 1, 'authorized no-stamp transition detaches once');
});

ok('GA-P1A4-ACTIVE-MISSING-DV-FALSE-FRESH no default page comparator remains', () => {
  const sourcePath = path.join(__dirname, '..', 'mechanisms', 'render-safe', 'render-safe.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert(!/_pageStamp|_canonicalMutation|beforeStamp/.test(source), 'dead generic stamp/canonicalization authority is removed');
});

okAsync('GA-P1A3-COLD-UNINDEXED-ACTIVE-FALSE-FRESH create mode keeps existence-based cold transition', async () => {
  const rs = new RenderSafeClass();
  rs.captureScroll = () => {};
  const timers = makeManualTimers();
  const { app, calls } = makeMutationApp('Home.md');
  let page = null;
  const pending = rs.mutate({
    app,
    dv: { page: () => page },
    path: 'spice/tasks/Cold Create.md',
    mode: 'create',
    timers: timers.api,
    write: () => true,
  });
  await flushMicrotasks();
  page = { file: { path: 'spice/tasks/Cold Create.md' } };
  calls.listener({ path: 'spice/tasks/Cold Create.md' });
  const result = await pending;
  assert(result.ok && calls.refresh === 1, 'create refreshes when the new page first exists');
  assert(calls.offref === 1, 'create cold transition detaches once');
});

async function runCreatePredicateBypassFixture(ClassUnderTest) {
  const rs = new ClassUnderTest();
  rs.captureScroll = () => {};
  const timers = makeManualTimers();
  const { app, calls } = makeMutationApp('Home.md');
  let page = null;
  let predicateCalls = 0;
  const pending = rs.mutate({
    app,
    dv: { page: () => page },
    path: 'spice/tasks/Predicate Create.md',
    mode: 'create',
    timers: timers.api,
    pollAttempts: 2,
    isCurrent() {
      predicateCalls++;
      return true;
    },
    write: () => true,
  });
  await flushMicrotasks();
  calls.listener({ path: 'spice/tasks/Predicate Create.md' });
  const earlyRefreshes = calls.refresh;
  page = { file: { path: 'spice/tasks/Predicate Create.md' } };
  await timers.runNext();
  const result = await pending;
  return { calls, earlyRefreshes, predicateCalls, result, timers };
}

okAsync('GA-P1A3-CREATE-EXISTENCE-BYPASS create ignores active isCurrent until dv.page exists', async () => {
  const outcome = await runCreatePredicateBypassFixture(RenderSafeClass);
  assert(outcome.earlyRefreshes === 0, 'isCurrent=true cannot refresh a still-missing created page');
  assert(outcome.predicateCalls === 0, 'create never consults the active-only predicate');
  assert(outcome.result.ok && outcome.calls.refresh === 1, 'later page existence refreshes exactly once');
  assert(outcome.calls.offref === 1, 'later existence detaches the metadata listener once');
  assert(outcome.timers.cleared.length > 0, 'later existence clears the bounded poll timer');
});

okAsync('GA-P1A3-CREATE-EXISTENCE-BYPASS old-order predicate mutant turns red', async () => {
  const sourcePath = path.join(__dirname, '..', 'mechanisms', 'render-safe', 'render-safe.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const authoritativeOrder = `      if (opts.mode === 'create') return !!page;`;
  const oldOrderMutant = `      if (typeof opts.isCurrent === 'function') {
        try { return !!opts.isCurrent(page, opts.beforePage); } catch (_e) { return false; }
      }
      if (opts.mode === 'create') return !!page;`;
  assert(source.includes(authoritativeOrder), 'mutation anchor proves create authority precedes isCurrent');
  const mutantSource = source.replace(authoritativeOrder, oldOrderMutant);
  const MutantClass = new Function(`${mutantSource}; return RenderSafe;`)();
  const outcome = await runCreatePredicateBypassFixture(MutantClass);
  assert(outcome.earlyRefreshes === 1, 'old ordering reproduces the forbidden early refresh');
  assert(outcome.predicateCalls === 1, 'old ordering reaches the active-only predicate in create mode');
});

okAsync('GA-P1A3-CREATE-EXISTENCE-BYPASS missing or unusable Dataview waits for bounded create timeout', async () => {
  const fixtures = [
    { label: 'missing', dv: null },
    { label: 'missing page method', dv: {} },
    { label: 'non-callable page method', dv: { page: 'unusable' } },
    { label: 'throwing page method', dv: { page() { throw new Error('Dataview unavailable'); } } },
  ];
  for (const fixture of fixtures) {
    const rs = new RenderSafeClass();
    rs.captureScroll = () => {};
    const timers = makeManualTimers();
    const { app, calls } = makeMutationApp('Home.md');
    let predicateCalls = 0;
    const pending = rs.mutate({
      app,
      dv: fixture.dv,
      path: 'spice/tasks/' + fixture.label + '.md',
      mode: 'create',
      timers: timers.api,
      pollAttempts: 2,
      isCurrent() {
        predicateCalls++;
        return true;
      },
      write: () => true,
    });
    await flushMicrotasks();
    calls.listener({ path: 'spice/tasks/' + fixture.label + '.md' });
    assert(calls.refresh === 0, fixture.label + ' cannot refresh at the metadata signal');
    assert(predicateCalls === 0, fixture.label + ' cannot fall through to active isCurrent');
    await timers.runNext();
    assert(calls.refresh === 0, fixture.label + ' cannot refresh during the bounded wait');
    await timers.runAll();
    const result = await pending;
    assert(result.ok, fixture.label + ' timeout preserves write success');
    assert(calls.refresh === 1, fixture.label + ' refreshes exactly once at bounded timeout');
    assert(calls.offref === 1, fixture.label + ' detaches its metadata listener once');
    assert(timers.cleared.length >= 2, fixture.label + ' cleans its bounded poll timers');
  }
});

function unreadableMutationFixtures() {
  const getter = {};
  Object.defineProperty(getter, 'value', {
    enumerable: true,
    get() { throw new Error('getter denied'); },
  });
  const read = new Proxy({ value: 'hidden' }, {
    get(target, key, receiver) {
      if (key === 'value') throw new Error('read denied');
      return Reflect.get(target, key, receiver);
    },
  });
  const ownKeys = new Proxy({ value: 'hidden' }, {
    ownKeys() { throw new Error('keys denied'); },
  });
  const descriptor = new Proxy({ value: 'hidden' }, {
    getOwnPropertyDescriptor() { throw new Error('descriptor denied'); },
  });
  const cycle = { value: 'cycle' };
  cycle.self = cycle;
  const symbolKey = { value: 'symbol-key' };
  symbolKey[Symbol('hidden')] = true;
  return [
    { label: 'getter', value: getter },
    { label: 'read', value: read },
    { label: 'ownKeys', value: ownKeys },
    { label: 'descriptor', value: descriptor },
    { label: 'cycle', value: cycle },
    { label: 'symbol-key', value: symbolKey },
    { label: 'symbol-value', value: { value: Symbol('hidden') } },
    { label: 'function', value: { value() {} } },
    { label: 'undefined', value: { value: undefined } },
    { label: 'bigint', value: { value: 1n } },
    { label: 'non-finite', value: { value: Number.NaN } },
    { label: 'unsupported-object', value: { value: new Map([['status', 'done']]) } },
  ];
}

ok('GA-P1A-CANONICAL-UNREADABLE-FALSE-FRESH dead whole-page canonicalizer is absent', () => {
  const rs = new RenderSafeClass();
  assert(typeof rs._pageStamp === 'undefined', 'no whole-page stamp remains as accidental authority');
  assert(typeof rs._canonicalMutationValue === 'undefined', 'no dead canonicalizer remains in production');
});

okAsync('GA-P1A-CANONICAL-UNREADABLE-FALSE-FRESH readable↔unreadable transitions fail closed', async () => {
  for (const fixture of unreadableMutationFixtures()) {
    const readable = {
      file: { path: 'A.md' },
      status: 'open',
      details: { owner: 'Will', rank: 2 },
    };
    const unreadable = {
      file: { path: 'A.md', mtime: 200 },
      status: 'done',
      details: fixture.value,
    };
    await runUnchangedActiveFixture(
      readable,
      unreadable,
      fixture.label + ' readable-to-unreadable',
    );
    await runUnchangedActiveFixture(
      unreadable,
      readable,
      fixture.label + ' unreadable-to-readable',
    );
  }
});

okAsync('GA-P1A-CANONICAL-UNREADABLE-FALSE-FRESH partial stamp continuation cannot authorize refresh', async () => {
  const broken = {};
  Object.defineProperty(broken, 'secret', {
    enumerable: true,
    get() { throw new Error('partial data denied'); },
  });
  await runUnchangedActiveFixture(
    {
      file: { path: 'A.md' },
      status: 'open',
      safe: { rank: 1 },
      broken,
    },
    {
      file: { path: 'A.md', mtime: 300 },
      status: 'done',
      safe: { rank: 2 },
      broken,
    },
    'partial-stamp change beside unreadable data',
  );
});

okAsync('GA-P1A-CANONICAL-UNREADABLE-FALSE-FRESH explicit isCurrent overrides unstampable pages', async () => {
  const rs = new RenderSafeClass();
  rs.captureScroll = () => {};
  const timers = makeManualTimers();
  const { app, calls } = makeMutationApp('A.md');
  const beforeDetails = {};
  Object.defineProperty(beforeDetails, 'secret', {
    enumerable: true,
    get() { throw new Error('before unreadable'); },
  });
  let page = { file: { path: 'A.md' }, status: 'open', details: beforeDetails };
  const beforePage = page;
  let authoritative = false;
  const pending = rs.mutate({
    app,
    dv: { page: () => page },
    path: 'A.md',
    mode: 'active',
    timers: timers.api,
    pollAttempts: 2,
    isCurrent(current, before) {
      assert(before === beforePage, 'explicit predicate receives the unstampable before page');
      return authoritative && current.status === 'done';
    },
    write: () => true,
  });
  await flushMicrotasks();
  page = {
    file: { path: 'A.md', mtime: 200 },
    status: 'done',
    details: { value: Symbol('after unreadable') },
  };
  calls.listener({ path: 'A.md' });
  assert(calls.refresh === 0, 'explicit predicate can hold an otherwise unstampable change');
  authoritative = true;
  await timers.runNext();
  const result = await pending;
  assert(result.ok && calls.refresh === 1, 'explicit predicate authorizes exactly one refresh');
});

function unsupportedRawFrontmatterFixtures() {
  return [
    { label: 'raw-symbol', value: Symbol('raw') },
    { label: 'raw-function', value() {} },
    { label: 'raw-undefined', value: undefined },
    { label: 'raw-nested-unsupported', value: { safe: 'kept', nested: new Map([['status', 'done']]) } },
  ];
}

ok('GA-P1A2-FILE-FRONTMATTER-UNSUPPORTED-SKIPPED raw frontmatter has no default comparator', () => {
  const rs = new RenderSafeClass();
  assert(typeof rs._pageStamp === 'undefined', 'unsupported raw frontmatter cannot enter a default stamp path');
});

okAsync('GA-P1A2-FILE-FRONTMATTER-UNSUPPORTED-SKIPPED raw unreadable transitions reject simultaneous safe changes', async () => {
  for (const fixture of unsupportedRawFrontmatterFixtures()) {
    const readable = {
      file: { path: 'A.md', frontmatter: { status: 'open', safe: { rank: 1 } } },
      status: 'open',
      safe: { rank: 1 },
    };
    const unreadable = {
      file: { path: 'A.md', mtime: 200, frontmatter: fixture.value },
      status: 'done',
      safe: { rank: 2 },
    };
    await runUnchangedActiveFixture(
      readable,
      unreadable,
      fixture.label + ' readable-to-unreadable with safe changes',
    );
    await runUnchangedActiveFixture(
      unreadable,
      readable,
      fixture.label + ' unreadable-to-readable with safe changes',
    );
  }
});

function defineSemanticKey(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return target;
}

function hostileKeyPage(values) {
  values = Object.assign({
    rootProto: 1,
    nestedProto: 1,
    rootConstructor: 1,
    rootPrototype: 1,
    nestedConstructor: 1,
  }, values || {});
  const page = { file: { path: 'A.md' }, status: 'open' };
  const nested = { safe: 'nested' };
  defineSemanticKey(page, '__proto__', { rank: values.rootProto });
  defineSemanticKey(page, 'constructor', { rank: values.rootConstructor });
  defineSemanticKey(page, 'prototype', { rank: values.rootPrototype });
  defineSemanticKey(nested, '__proto__', { rank: values.nestedProto });
  defineSemanticKey(nested, 'constructor', {
    prototype: { rank: values.nestedConstructor },
  });
  page.nested = nested;
  return page;
}

ok('GA-P1A2-PROTO-KEY-DROPPED hostile own keys cannot reach a generic comparator', () => {
  const rs = new RenderSafeClass();
  const page = hostileKeyPage();
  assert(typeof rs._pageStamp === 'undefined', 'hostile keys have no default stamp path');
  assert(Object.prototype.hasOwnProperty.call(page, '__proto__'), 'hostile key remains ordinary fixture data');
  assert(({}).polluted === undefined, 'fixture construction does not mutate Object.prototype');
});

okAsync('GA-P1A2-PROTO-KEY-DROPPED hostile-key value changes cannot prove mutation freshness', async () => {
  for (const fixture of [
    { label: 'root __proto__', values: { rootProto: 2 } },
    { label: 'nested __proto__', values: { nestedProto: 2 } },
    { label: 'root constructor', values: { rootConstructor: 2 } },
    { label: 'root prototype', values: { rootPrototype: 2 } },
    { label: 'nested constructor.prototype', values: { nestedConstructor: 2 } },
  ]) {
    await runChangedActiveFixture(
      hostileKeyPage(),
      hostileKeyPage(fixture.values),
      fixture.label + ' mutation',
    );
  }
});

const COLLISION_PRONE_KEYS = [
  '__fileFrontmatter',
  'file',
  'value',
  'data',
  'semantic',
  'frontmatter',
  '__proto__',
  'constructor',
  'prototype',
];

function collisionPayload(changedKey, changedValue, nested) {
  const payload = Object.create(null);
  for (const key of COLLISION_PRONE_KEYS) {
    defineSemanticKey(payload, key, {
      rank: key === changedKey ? changedValue : 1,
    });
  }
  if (nested) {
    const wrapper = Object.create(null);
    defineSemanticKey(wrapper, 'nested', payload);
    return wrapper;
  }
  return payload;
}

function collisionEnvelopePage(surface, changedKey, changedValue) {
  const rawRoot = collisionPayload(
    surface === 'raw-root' ? changedKey : null,
    changedValue,
    false,
  );
  defineSemanticKey(
    rawRoot,
    'nested-payload',
    collisionPayload(surface === 'raw-nested' ? changedKey : null, changedValue, false),
  );
  const page = {
    file: { path: 'A.md', frontmatter: rawRoot },
    status: 'open',
  };
  defineSemanticKey(
    page,
    'nested-payload',
    collisionPayload(surface === 'page-nested' ? changedKey : null, changedValue, false),
  );
  if (surface === 'page-root') {
    defineSemanticKey(page, changedKey, { rank: changedValue });
  }
  return page;
}

okAsync('GA-P1A2-RAW-FRONTMATTER-SYNTHETIC-KEY-COLLISION collision shapes cannot prove mutation freshness', async () => {
  const fixtures = [];
  for (const key of COLLISION_PRONE_KEYS) {
    // page.file is Dataview's metadata object, not page-level frontmatter.
    // The legitimate user `file` field is represented by raw frontmatter and
    // by nested page semantics, both of which must remain collision-free.
    if (key !== 'file') fixtures.push({ surface: 'page-root', key });
    fixtures.push({ surface: 'page-nested', key });
    fixtures.push({ surface: 'raw-root', key });
    fixtures.push({ surface: 'raw-nested', key });
  }
  for (const fixture of fixtures) {
    await runChangedActiveFixture(
      collisionEnvelopePage(fixture.surface, fixture.key, 1),
      collisionEnvelopePage(fixture.surface, fixture.key, 2),
      fixture.surface + ' ' + fixture.key + ' mutation',
    );
  }
  assert(({}).polluted === undefined, 'collision-prone keys never pollute Object.prototype');
});

ok('GA-P1A2-RAW-FRONTMATTER-SYNTHETIC-KEY-COLLISION no synthetic merge or tuple authority remains', () => {
  const rs = new RenderSafeClass();
  const page = collisionEnvelopePage('page-root', '__fileFrontmatter', 7);
  assert(typeof rs._pageStamp === 'undefined', 'no synthetic default stamp remains');
  assert(page.__fileFrontmatter.rank === 7, 'legitimate collision-prone page key remains untouched');
  assert(page.file.frontmatter.__fileFrontmatter.rank === 1, 'raw collision-prone key remains untouched');
  assert(({}).rank === undefined, 'fixture construction does not mutate Object.prototype');
});

okAsync('GA-P1A2-RAW-FRONTMATTER-SYNTHETIC-KEY-COLLISION raw frontmatter absence and presence are distinct', async () => {
  await runChangedActiveFixture(
    { file: { path: 'A.md' }, status: 'open' },
    { file: { path: 'A.md', frontmatter: {} }, status: 'open' },
    'absent-to-present empty raw frontmatter',
  );
  await runChangedActiveFixture(
    { file: { path: 'A.md', frontmatter: {} }, status: 'open' },
    { file: { path: 'A.md' }, status: 'open' },
    'present-to-absent raw frontmatter',
  );
});

okAsync('GA-P1-ACTIVE-POLL-BEFORE-REFRESH timeout is bounded and never redraws stale data', async () => {
  const rs = new RenderSafeClass();
  rs.captureScroll = () => {};
  const timers = makeManualTimers();
  const { app, calls } = makeMutationApp('A.md');
  const stale = { file: { path: 'A.md' }, status: 'open' };
  const pending = rs.mutate({
    app,
    dv: { page: () => stale },
    path: 'A.md',
    mode: 'active',
    timers: timers.api,
    pollAttempts: 2,
    isCurrent: () => false,
    write: () => true,
  });
  await flushMicrotasks();
  calls.listener({ path: 'A.md' });
  assert(calls.refresh === 0, 'stale first poll cannot refresh');
  await timers.runNext();
  assert(calls.refresh === 0, 'stale retry cannot refresh early');
  await timers.runNext();
  const result = await pending;
  assert(result.ok, 'reconciliation timeout does not mask write success');
  assert(calls.refresh === 0, 'active timeout leaves stale data to the natural reconciler');
  assert(calls.offref === 1, 'timeout detaches listener');
});

okAsync('GA-P1A5-SIGNAL-TIMEOUT-UNBOUND active no-signal path settles fail-closed', async () => {
  const rs = new RenderSafeClass();
  rs.captureScroll = () => {};
  const timers = makeManualTimers();
  const { app, calls } = makeMutationApp('A.md');
  let pageReads = 0;
  let settled = false;
  const pending = rs.mutate({
    app,
    dv: {
      page: () => {
        pageReads++;
        return { file: { path: 'A.md' }, status: 'stale' };
      },
    },
    path: 'A.md',
    mode: 'active',
    timers: timers.api,
    signalTimeout: 37,
    pollInterval: 11,
    pollAttempts: 2,
    isCurrent: () => false,
    write: () => 'saved',
  }).then((result) => {
    settled = true;
    return result;
  });
  await flushMicrotasks();

  assert(calls.on === 1 && typeof calls.listener === 'function', 'active no-signal path installs its production metadata listener');
  assert(calls.refresh === 0 && settled === false, 'successful active write waits without refreshing stale data');
  assert(
    timers.queue.length === 1 && timers.queue[0].ms === 37 && timers.queue[0].cleared === false,
    'active no-signal path arms the exact signal-timeout timer',
  );

  const signalTimer = await timers.runNext();
  assert(signalTimer && signalTimer.ms === 37, 'manual clock drives the production signal-timeout callback');
  assert(pageReads === 2 && calls.refresh === 0 && settled === false, 'signal timeout enters bounded polling without authorizing refresh');
  await timers.runAll();
  const result = await pending;

  assert(result.ok && result.value === 'saved', 'active no-signal timeout preserves write success');
  assert(calls.refresh === 0, 'active no-signal bounded timeout never refreshes stale data');
  assert(calls.offref === 1, 'active no-signal timeout detaches exactly once');
  assert(timers.queue.length === 0, 'active no-signal timeout leaves no timer work');
});

okAsync('GA-P1A5-SIGNAL-TIMEOUT-UNBOUND create no-signal path settles with bounded refresh', async () => {
  const rs = new RenderSafeClass();
  rs.captureScroll = () => {};
  const timers = makeManualTimers();
  const { app, calls } = makeMutationApp('Home.md');
  let pageReads = 0;
  let settled = false;
  const pending = rs.mutate({
    app,
    dv: {
      page: () => {
        pageReads++;
        return null;
      },
    },
    path: 'spice/tasks/New-no-signal.md',
    mode: 'create',
    timers: timers.api,
    signalTimeout: 41,
    pollInterval: 13,
    pollAttempts: 2,
    write: () => 'created',
  }).then((result) => {
    settled = true;
    return result;
  });
  await flushMicrotasks();

  assert(calls.on === 1 && typeof calls.listener === 'function', 'create no-signal path installs its production metadata listener');
  assert(calls.refresh === 0 && settled === false, 'successful create waits for existence or its bound');
  assert(
    timers.queue.length === 1 && timers.queue[0].ms === 41 && timers.queue[0].cleared === false,
    'create no-signal path arms the exact signal-timeout timer',
  );

  const signalTimer = await timers.runNext();
  assert(signalTimer && signalTimer.ms === 41, 'manual clock drives the create signal-timeout callback');
  assert(pageReads === 1 && calls.refresh === 0 && settled === false, 'create signal timeout enters existence polling without refreshing early');
  await timers.runAll();
  const result = await pending;

  assert(result.ok && result.value === 'created', 'create no-signal timeout preserves write success');
  assert(calls.refresh === 1, 'create no-signal bounded timeout refreshes exactly once');
  assert(calls.offref === 1, 'create no-signal timeout detaches exactly once');
  assert(timers.queue.length === 0, 'create no-signal timeout leaves no timer work');
});

okAsync('GA-P1A5-SIGNAL-TIMEOUT-UNBOUND disabled signal-timeout arm mutant turns red', async () => {
  const sourcePath = path.join(__dirname, '..', 'mechanisms', 'render-safe', 'render-safe.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const signalArm = `          } else if (!schedule(beginPoll, signalTimeout)) {`;
  assert(source.split(signalArm).length === 2, 'production contains one exact signal-timeout arm');
  const mutantSource = source.replace(signalArm, `          } else if (false) {`);
  const MutantClass = new Function(`${mutantSource}; return RenderSafe;`)();
  const rs = new MutantClass();
  rs.captureScroll = () => {};
  const timers = makeManualTimers();
  const { app, calls } = makeMutationApp('A.md');
  let settled = false;
  rs.mutate({
    app,
    dv: { page: () => ({ file: { path: 'A.md' }, status: 'stale' }) },
    path: 'A.md',
    mode: 'active',
    timers: timers.api,
    signalTimeout: 1,
    pollAttempts: 1,
    isCurrent: () => false,
    write: () => 'saved',
  }).then(() => { settled = true; });
  await flushMicrotasks();
  await timers.runAll();
  await flushMicrotasks();

  assert(calls.on === 1, 'mutant still installs the production metadata listener');
  assert(timers.queue.length === 0, 'mutant removes the only no-signal progress timer');
  assert(settled === false, 'mutant reproduces the forever-pending active write');
  assert(calls.offref === 0, 'mutant reproduces the leaked metadata listener');
});

okAsync('GA-P1-BACKGROUND-NOOP leaves polling and refresh to the platform reconciler', async () => {
  const rs = new RenderSafeClass();
  rs.captureScroll = () => {};
  const { app, calls } = makeMutationApp('Active.md');
  let pageReads = 0;
  const result = await rs.mutate({
    app,
    dv: { page: () => { pageReads++; return { file: { path: 'Background.md' } }; } },
    path: 'Background.md',
    mode: 'background',
    write: () => 42,
  });
  assert(result.ok && result.value === 42, 'background write succeeds');
  assert(calls.on === 0 && calls.offref === 0, 'background installs no metadata listener');
  assert(pageReads === 0, 'background performs no manual Dataview poll');
  assert(calls.refresh === 0, 'background performs no manual refresh');
});

okAsync('GA-P1-CREATE-POLL waits for page existence then refreshes and detaches', async () => {
  const rs = new RenderSafeClass();
  rs.captureScroll = () => {};
  const timers = makeManualTimers();
  const { app, calls } = makeMutationApp('Home.md');
  let page = null;
  const pending = rs.mutate({
    app,
    dv: { page: () => page },
    path: 'spice/tasks/New.md',
    mode: 'create',
    timers: timers.api,
    pollAttempts: 3,
    write: () => 'created',
  });
  await flushMicrotasks();
  calls.listener({ path: 'spice/tasks/New.md' });
  assert(calls.refresh === 0, 'missing created page cannot refresh early');
  page = { file: { path: 'spice/tasks/New.md' } };
  await timers.runNext();
  const result = await pending;
  assert(result.ok && result.value === 'created', 'create result preserved');
  assert(calls.refresh === 1, 'create refreshes once after page exists');
  assert(calls.offref === 1, 'create detaches listener');
});

okAsync('GA-P1-CREATE-POLL timeout refreshes once and cleans listener/timers', async () => {
  const rs = new RenderSafeClass();
  rs.captureScroll = () => {};
  const timers = makeManualTimers();
  const { app, calls } = makeMutationApp('Home.md');
  const pending = rs.mutate({
    app,
    dv: { page: () => null },
    path: 'spice/tasks/Missing.md',
    mode: 'create',
    timers: timers.api,
    pollAttempts: 2,
    write: () => true,
  });
  await flushMicrotasks();
  calls.listener({ path: 'spice/tasks/Missing.md' });
  await timers.runAll();
  const result = await pending;
  assert(result.ok, 'timeout does not convert a successful write into failure');
  assert(calls.refresh === 1, 'create timeout refreshes exactly once');
  assert(calls.offref === 1, 'create timeout detaches exactly once');
  assert(timers.queue.every((item) => item.cleared), 'remaining timers are cleared');
});

okAsync('GA-P1-MISSING-DEPS missing/throwing runtime dependencies never escape', async () => {
  const rs = new RenderSafeClass();
  rs.captureScroll = () => { throw new Error('no DOM'); };
  const success = await rs.mutate({
    app: {
      metadataCache: { on: () => { throw new Error('no metadata'); } },
      commands: { executeCommandById: () => { throw new Error('no command'); } },
    },
    dv: { page: () => { throw new Error('no Dataview'); } },
    mode: 'create',
    path: 'x.md',
    timers: { setTimeout: () => { throw new Error('no timer'); } },
    write: () => 'still written',
  });
  assert(success.ok && success.value === 'still written', 'operational dependency failures preserve write success');
  const original = new Error('write failed');
  const failure = await rs.mutate({
    mode: 'background',
    write: () => { throw original; },
    Notice: function () { throw new Error('Notice unavailable'); },
  });
  assert(!failure.ok && failure.error === original, 'Notice failure cannot mask write reason');
});

ok('GA-P1-GESTURE-CONVENTION code guide routes gesture writes through RenderSafe.mutate', () => {
  const guide = fs.readFileSync(path.join(__dirname, '..', '..', 'Docs', 'agent-guides', 'code-conventions.md'), 'utf8');
  assert(/User gestures must route frontmatter and vault writes through the instance[\s\S]*RenderSafe\.mutate/.test(guide), 'canonical gesture convention');
  assert(/must not end in a[\s\S]*bare `processFrontMatter`, `vault\.modify`, or `vault\.create` write/.test(guide), 'bare gesture writes prohibited');
});

// GA-P3 sweep contract: every audited active-note gesture delegates its write
// through RenderSafe.mutate, while Finance's authoritative self-renders capture
// scroll first. These source-bound cases are intentionally one-per surface so a
// future helper can neither bypass the lifecycle nor hide in an aggregate count.
function helperSource(rel) {
  return fs.readFileSync(path.join(__dirname, '..', 'blueprints', rel), 'utf8');
}

ok('GA-P3-PROJECT-STATUS status pick routes through mutate with optimistic rollback', () => {
  const src = helperSource('project/helpers/project-status-widget.js');
  assert(/_writeStatus\([\s\S]*renderSafe\.mutate\(\{[\s\S]*optimistic:[\s\S]*revert:[\s\S]*write: \(\) => app\.fileManager\.processFrontMatter/.test(src), 'status mutation lifecycle');
});

ok('GA-P3-PROJECT-WORKSTREAM add and remove share mutate authority', () => {
  const src = helperSource('project/helpers/project-workstream-manager.js');
  assert(/updateWorkstreams = async[\s\S]*renderSafe\.mutate\(\{[\s\S]*write: async[\s\S]*processFrontMatter/.test(src), 'workstream mutation lifecycle');
  assert((src.match(/updateWorkstreams\(/g) || []).length === 2, 'add and remove both call the shared writer');
});

ok('GA-P3-PROJECT-LINKS add edit delete route through mutate', () => {
  const src = helperSource('project/helpers/project-links-manager.js');
  assert(/async _write\([\s\S]*renderSafe\.mutate\(\{[\s\S]*write: \(\) => app\.fileManager\.processFrontMatter/.test(src), 'links mutation lifecycle');
  assert((src.match(/this\._write\(dv, res\.links\)/g) || []).length === 3, 'add edit delete share the writer');
});

ok('GA-P3-MEETINGS project and attendees route through mutate', () => {
  const src = helperSource('meetings/helpers/meeting-leaf-actions.js');
  assert(/_mutateFrontmatter\([\s\S]*renderSafe\.mutate\(\{[\s\S]*write: \(\) => app\.fileManager\.processFrontMatter/.test(src), 'meeting mutation lifecycle');
  assert((src.match(/this\._mutateFrontmatter\(dv, file/g) || []).length === 2, 'project and attendee saves share the writer');
});

ok('GA-P3-READER leaf status routes through mutate with optimistic label rollback', () => {
  const src = helperSource('reader/helpers/reader-article-actions.js');
  assert(/async _setStatus\([\s\S]*renderSafe\.mutate\(\{[\s\S]*optimistic:[\s\S]*revert:[\s\S]*isCurrent:/.test(src), 'reader status mutation lifecycle');
  assert(/statusBtn\.textContent = 'Status: '/.test(src), 'reader leaf swaps the visible status optimistically');
});

ok('GA-P3-STICKY title rename routes through mutate with banner rollback', () => {
  const src = helperSource('sticky-notes/helpers/sticky-chrome-bar.js');
  const rename = src.slice(src.indexOf('async _writeTitle'), src.indexOf('_openMoveDayDialog'));
  assert(/renderSafe\.mutate\(\{[\s\S]*optimistic:[\s\S]*revert:[\s\S]*isCurrent:/.test(rename), 'sticky rename mutation lifecycle');
  assert(!/current, \(\) => \{\}\)/.test(src), 'overflow rename supplies a visible banner callback');
});

ok('GA-P3-JOURNAL title rename routes through mutate with banner rollback', () => {
  const src = helperSource('journal/helpers/journal-chrome-bar.js');
  const rename = src.slice(src.indexOf('async _writeTitle'), src.indexOf('_openDeleteDialog'));
  assert(/renderSafe\.mutate\(\{[\s\S]*optimistic:[\s\S]*revert:[\s\S]*isCurrent:/.test(rename), 'journal rename mutation lifecycle');
  assert(!/current, \(\) => \{\}\)/.test(src), 'overflow rename supplies a visible banner callback');
});

ok('GA-P3-TODAY-CAPTURE native checkbox routes through mutate capture and revert', () => {
  const src = helperSource('to-do/helpers/today-capture-editable-list.js');
  assert(/addEventListener\('change'[\s\S]*renderSafe\.mutate\(\{[\s\S]*optimistic:[\s\S]*revert:[\s\S]*replaceTaskAt/.test(src), 'today capture mutation lifecycle');
});

for (const financeEditor of ['budget-allocations-editor.js', 'budget-categories-editor.js', 'budget-defaults-editor.js']) {
  ok(`GA-P3-FINANCE-SCROLL ${financeEditor} captures before authoritative self-render`, () => {
    const src = helperSource('finance/helpers/' + financeEditor);
    const start = src.indexOf('async _rerender');
    const rerender = src.slice(start, src.indexOf('\n    }', start) + 6);
    assert(/try\s*\{\s*customJS\.RenderSafe\?\.captureScroll\?\.\(\);\s*\}\s*catch\s*\(_e\)\s*\{\}\s*return await this\.render\(dv, authoritative\);/.test(rerender),
      'capture is immediately adjacent to authoritative self-render with only its fail-closed catch between');
    assert((src.match(/await this\.render/g) || []).length === 1, 'all direct self-renders are centralized');
  });
}

function makeGestureFacade(calls) {
  return {
    async mutate(opts) {
      calls.push(opts);
      if (opts.optimistic) await opts.optimistic();
      try { return { ok: true, value: await opts.write() }; }
      catch (error) {
        if (opts.revert) await opts.revert(error);
        return { ok: false, error };
      }
    },
  };
}

function iterableOf(values) {
  return {
    *[Symbol.iterator]() { yield* values; },
  };
}

function makeRuntimeEl(text) {
  const el = {
    style: { cssText: '' },
    textContent: text || '',
    innerHTML: '',
    _tag: '',
    value: '',
    checked: false,
    disabled: false,
    _children: [],
    _listeners: {},
    createEl(tag, opts) {
      const child = makeRuntimeEl(opts && opts.text != null ? String(opts.text) : '');
      child._tag = tag;
      child.type = opts && opts.type || '';
      child.placeholder = opts && opts.placeholder || '';
      this._children.push(child);
      return child;
    },
    addEventListener(event, handler) { this._listeners[event] = handler; },
    appendChild(child) { this._children.push(child); return child; },
    focus() {},
    remove() { this.removed = true; },
    querySelector() { return null; },
    closest() { return null; },
    removeChild(child) {
      this._children = this._children.filter((candidate) => candidate !== child);
    },
  };
  Object.defineProperty(el, 'firstChild', {
    get() { return this._children[0] || null; },
  });
  return el;
}

async function withGestureRuntime(appRef, renderSafe, run) {
  const previous = {
    app: global.app, customJS: global.customJS, window: global.window,
    Notice: global.Notice, document: global.document,
  };
  global.app = appRef;
  global.customJS = { RenderSafe: renderSafe };
  global.window = { app: appRef, customJS: global.customJS };
  global.Notice = function () {};
  try { return await run(); }
  finally {
    global.app = previous.app;
    global.customJS = previous.customJS;
    global.window = previous.window;
    global.Notice = previous.Notice;
    global.document = previous.document;
  }
}

okAsync('GA-P3-PROJECT-STATUS-RUNTIME invokes mutate and optimistic chip path', async () => {
  const Klass = loadClass('blueprints/project/helpers/project-status-widget.js', 'ProjectStatusWidget');
  const file = { path: 'Project.md', fm: { status: 'idea' } };
  const calls = [], ui = [];
  const appRef = { fileManager: { processFrontMatter: async (target, fn) => fn(target.fm) } };
  await withGestureRuntime(appRef, makeGestureFacade(calls), async () => {
    const saved = await new Klass()._writeStatus({}, file, 'planning', {
      optimistic: () => ui.push('planning'), revert: () => ui.push('idea'),
    });
    assert(saved && calls.length === 1, 'status delegates exactly once');
    assert(file.fm.status === 'planning' && ui.join(',') === 'planning', 'status write and optimism execute');
    assert(calls[0].isCurrent({ status: 'idea' }) === false, 'status authority rejects stale indexed state');
    assert(calls[0].isCurrent({ status: 'planning' }) === true, 'status authority accepts only the target state');
  });
});

okAsync('GA-P3-PROJECT-STATUS-PICKER-ROLLBACK executes the rendered chip and picker callbacks', async () => {
  const Klass = loadClass('blueprints/project/helpers/project-status-widget.js', 'ProjectStatusWidget');
  const file = { path: 'Project.md', fm: { status: 'idea' } };
  const calls = [];
  const appRef = {
    vault: { getAbstractFileByPath: () => file },
    fileManager: { processFrontMatter: async () => { throw new Error('fixture write rejected'); } },
  };
  await withGestureRuntime(appRef, makeGestureFacade(calls), async () => {
    const body = makeRuntimeEl();
    global.document = {
      body,
      createElement: () => makeRuntimeEl(),
      addEventListener() {},
      removeEventListener() {},
    };
    const container = makeRuntimeEl();
    const dv = {
      container,
      current: () => ({ file: { path: file.path }, status: 'idea' }),
    };
    await new Klass().render(dv);
    const nodes = [];
    const walk = (node) => {
      nodes.push(node);
      for (const child of node._children || []) walk(child);
    };
    walk(container);
    const chip = nodes.find((node) => node._tag === 'button' && typeof node.onclick === 'function');
    assert(chip, 'rendered project status chip has its production click callback');
    let chipHtml = chip.innerHTML;
    const chipHistory = [];
    Object.defineProperty(chip, 'innerHTML', {
      get() { return chipHtml; },
      set(value) { chipHtml = String(value); chipHistory.push(chipHtml); },
    });
    chip.onclick();
    const pickerNodes = [];
    walk(body);
    for (const node of nodes) {
      if (!pickerNodes.includes(node)) pickerNodes.push(node);
    }
    const planning = nodes.find((node) => node._tag === ''
      && typeof node.onclick === 'function' && /<span>planning<\/span>/.test(node.innerHTML || ''));
    assert(planning, 'rendered project picker exposes the planning choice');
    await planning.onclick();
    assert(calls.length === 1, 'rendered picker delegates once through mutate');
    assert(chipHistory.length >= 2
      && /planning/.test(chipHistory[chipHistory.length - 2])
      && /idea/.test(chipHistory[chipHistory.length - 1]),
    'rendered chip visibly applies planning then restores idea after rejection');
  });
});

okAsync('GA-P3-PROJECT-WORKSTREAM-RUNTIME executes add and remove across root atlas and map', async () => {
  const Klass = loadClass('blueprints/project/helpers/project-workstream-manager.js', 'ProjectWorkstreamManager');
  const docsAtlas = { path: 'spice/projects/x/docs/Docs.md', fm: { type: 'project', workstreams: [{ id: 'docs' }] } };
  const docsBefore = JSON.stringify(docsAtlas.fm);
  const atlas = { path: 'spice/projects/x/X.md', fm: { type: 'project', workstreams: [] } };
  const map = { path: 'spice/projects/x/Project Map.md', fm: { type: 'map', workstreams: [] } };
  const calls = [];
  const appRef = {
    vault: {
      getFiles: () => [docsAtlas, atlas, map],
    },
    metadataCache: { getFileCache: (file) => ({ frontmatter: file.fm }) },
    fileManager: { processFrontMatter: async (target, fn) => fn(target.fm) },
  };
  await withGestureRuntime(appRef, makeGestureFacade(calls), async () => {
    let indexed = [];
    const dv = { current: () => ({ file: { path: map.path }, workstreams: indexed }) };
    const inst = new Klass();
    let pending = null;
    inst._showModal = (build) => {
      const dialog = makeRuntimeEl();
      build(dialog, () => {});
      const nodes = [];
      const walk = (node) => {
        nodes.push(node);
        for (const child of node._children || []) walk(child);
      };
      walk(dialog);
      const name = nodes.find((node) => node.placeholder === 'Name (e.g. Terraform)');
      const description = nodes.find((node) => node.placeholder === 'Description (optional)');
      const add = nodes.find((node) => node.textContent === 'Add');
      assert(name && description && add, 'add flow exposes its inputs and submit gesture');
      name.value = 'API';
      description.value = '';
      pending = add.onclick();
    };
    inst.addWorkstream(dv);
    await pending;
    assert(calls.length === 1, 'add workstream delegates through one mutate call');
    assert(atlas.fm.workstreams[0].id === 'api', 'shared writer persists the project atlas');
    assert(map.fm.workstreams[0].id === 'api', 'shared writer persists the project map');
    assert(JSON.stringify(docsAtlas.fm) === docsBefore, 'shared writer keeps the complete nested docs atlas unchanged');
    assert(calls[0].isCurrent({ workstreams: iterableOf([{ id: 'stale' }]) }) === false,
      'workstream authority rejects stale iterable state');
    assert(calls[0].isCurrent({ workstreams: iterableOf([{ id: 'api', name: 'API', description: '' }]) }) === true,
      'workstream authority accepts a non-Array iterable with the exact target');
    assert(calls[0].isCurrent({ workstreams: { 0: { id: 'api' }, length: 1 } }) === false,
      'workstream authority fails closed for non-iterable array-like state');

    indexed = [{ id: 'api', name: 'API', description: '' }];
    inst._showModal = (build) => {
      const dialog = makeRuntimeEl();
      build(dialog, () => {});
      const nodes = [];
      const walk = (node) => {
        nodes.push(node);
        for (const child of node._children || []) walk(child);
      };
      walk(dialog);
      const remove = nodes.find((node) => typeof node.onclick === 'function'
        && (node._children || []).some((child) => child.textContent === 'API'));
      assert(remove, 'remove flow exposes the API removal gesture');
      pending = remove.onclick();
    };
    inst.removeWorkstream(dv);
    await pending;
    assert(calls.length === 2, 'remove workstream delegates through one additional mutate call');
    assert(atlas.fm.workstreams.length === 0 && map.fm.workstreams.length === 0,
      'remove persists the same empty target to root atlas and map');
    assert(JSON.stringify(docsAtlas.fm) === docsBefore, 'remove also keeps the complete nested docs atlas unchanged');
    assert(calls[1].isCurrent({ workstreams: iterableOf([{ id: 'api' }]) }) === false,
      'remove authority rejects the stale pre-remove iterable');
    assert(calls[1].isCurrent({ workstreams: iterableOf([]) }) === true,
      'remove authority accepts the exact empty iterable');
  });
});

okAsync('GA-P3-PROJECT-LINKS-RUNTIME invokes mutate for link persistence', async () => {
  const Klass = loadClass('blueprints/project/helpers/project-links-manager.js', 'ProjectLinksManager');
  const file = { path: 'Links Hub.md', fm: { links: [] } };
  const calls = [];
  const appRef = {
    vault: { getAbstractFileByPath: () => file },
    fileManager: { processFrontMatter: async (target, fn) => fn(target.fm) },
  };
  await withGestureRuntime(appRef, makeGestureFacade(calls), async () => {
    const saved = await new Klass()._write({ current: () => ({ file: { path: file.path } }) }, [{ url: 'https://x', text: 'X' }]);
    assert(saved && calls.length === 1, 'links delegate exactly once');
    assert(file.fm.links[0].text === 'X', 'links persist through the delegated write');
    assert(calls[0].isCurrent({ links: iterableOf([{ url: 'https://stale', text: 'Stale' }]) }) === false,
      'links authority rejects stale iterable state');
    assert(calls[0].isCurrent({ links: iterableOf([{ url: 'https://x', text: 'X' }]) }) === true,
      'links authority accepts exact non-Array DataArray-shaped state');
    assert(calls[0].isCurrent({ links: iterableOf([{ url: 'https://x' }]) }) === false,
      'links authority rejects a label that does not match the exact target');
  });
});

okAsync('GA-P3-MEETINGS-RUNTIME invokes mutate for frontmatter persistence', async () => {
  const Klass = loadClass('blueprints/meetings/helpers/meeting-leaf-actions.js', 'MeetingLeafActions');
  const file = { path: 'Meeting.md', fm: {} };
  const calls = [];
  const appRef = { fileManager: { processFrontMatter: async (target, fn) => fn(target.fm) } };
  await withGestureRuntime(appRef, makeGestureFacade(calls), async () => {
    const saved = await new Klass()._mutateFrontmatter({}, file, {
      write: (fm) => { fm.project = '[[Sauce]]'; }, isCurrent: () => true,
    });
    assert(saved && calls.length === 1 && file.fm.project === '[[Sauce]]', 'meeting delegates exactly once');
  });
});

okAsync('GA-P3-MEETING-PROJECT-AUTHORITY executes the handler predicate against Link objects', async () => {
  const Klass = loadClass('blueprints/meetings/helpers/meeting-leaf-actions.js', 'MeetingLeafActions');
  const file = { path: 'Meeting.md', fm: {} };
  const calls = [];
  const appRef = {
    vault: { getAbstractFileByPath: () => file },
    fileManager: { processFrontMatter: async (target, fn) => fn(target.fm) },
  };
  await withGestureRuntime(appRef, makeGestureFacade(calls), async () => {
    const inst = new Klass();
    inst._listProjects = () => [{ name: 'Sauce', slug: 'sauce' }];
    let choosePromise = null;
    inst._openModal = ({ build }) => {
      const panel = makeRuntimeEl();
      build(panel, () => {});
      const buttons = [];
      const walk = (node) => {
        if (typeof node.onclick === 'function') buttons.push(node);
        for (const child of node._children || []) walk(child);
      };
      walk(panel);
      const sauce = buttons.find((button) => button.textContent === 'Sauce');
      assert(sauce, 'project handler exposes the Sauce choice');
      choosePromise = sauce.onclick();
    };
    inst._onAddToProject({ current: () => ({ file: { path: file.path } }) });
    await choosePromise;
    assert(calls.length === 1, 'project handler delegates exactly once');
    const authority = calls[0].isCurrent;
    assert(authority({ project: { path: 'spice/projects/sauce/Sauce.md', display: 'Sauce' } }) === true,
      'project authority accepts the exact Obsidian Link object');
    assert(authority({ project: { path: 'spice/projects/other/Other.md', display: 'Other' } }) === false,
      'project authority rejects an unrelated Link object');
  });
});

okAsync('GA-P3-MEETING-ATTENDEE-AUTHORITY executes the handler predicate against iterable Link values', async () => {
  const Klass = loadClass('blueprints/meetings/helpers/meeting-leaf-actions.js', 'MeetingLeafActions');
  const file = { path: 'Meeting.md', fm: {} };
  const calls = [];
  const appRef = {
    vault: { getAbstractFileByPath: () => file, getMarkdownFiles: () => [] },
    fileManager: { processFrontMatter: async (target, fn) => fn(target.fm) },
  };
  await withGestureRuntime(appRef, makeGestureFacade(calls), async () => {
    const inst = new Klass();
    inst._listPeople = () => ['Alice'];
    let savePromise = null;
    inst._openModal = ({ build }) => {
      const panel = makeRuntimeEl();
      build(panel, () => {});
      const nodes = [];
      const walk = (node) => {
        nodes.push(node);
        for (const child of node._children || []) walk(child);
      };
      walk(panel);
      const save = nodes.find((node) => node.textContent === 'Save attendees');
      assert(save && typeof save.onclick === 'function', 'attendee handler exposes Save attendees');
      savePromise = save.onclick();
    };
    inst._onEditAttendees({
      current: () => ({ file: { path: file.path }, attendees: ['[[Alice]]'] }),
    });
    await savePromise;
    assert(calls.length === 1, 'attendee handler delegates exactly once');
    const authority = calls[0].isCurrent;
    assert(authority({ attendees: iterableOf([{ path: 'spice/people/Alice.md', display: 'Alice' }]) }) === true,
      'attendee authority accepts an exact non-Array iterable of Link objects');
    assert(authority({ attendees: iterableOf([{ path: 'spice/people/Bob.md', display: 'Bob' }]) }) === false,
      'attendee authority rejects stale iterable Link state');
    assert(authority({ attendees: { 0: '[[Alice]]', length: 1 } }) === false,
      'attendee authority fails closed for a non-iterable array-like value');
  });
});

okAsync('GA-P3-READER-RUNTIME invokes mutate for leaf status persistence', async () => {
  const Klass = loadClass('blueprints/reader/helpers/reader-article-actions.js', 'ReaderArticleActions');
  const file = { path: 'Article.md', fm: { status: 'unread' } };
  const calls = [], ui = [];
  const appRef = {
    vault: { getAbstractFileByPath: () => file },
    fileManager: { processFrontMatter: async (target, fn) => fn(target.fm) },
  };
  await withGestureRuntime(appRef, makeGestureFacade(calls), async () => {
    const saved = await new Klass()._setStatus(file.path, 'reading', {}, {
      optimistic: () => ui.push('reading'), revert: () => ui.push('unread'),
    });
    assert(saved && calls.length === 1, 'reader delegates exactly once');
    assert(file.fm.status === 'reading' && ui.join(',') === 'reading', 'reader status and optimistic label execute');
    assert(calls[0].isCurrent({ status: 'unread' }) === false, 'reader authority rejects stale status');
    assert(calls[0].isCurrent({ status: 'READING' }) === true, 'reader authority canonicalizes exact status');
  });
});

async function readerButtonRollbackOutcome(Klass) {
  const file = { path: 'Article.md', fm: { status: 'unread' } };
  const calls = [], buttons = [];
  let settle;
  const settled = new Promise((resolve) => { settle = resolve; });
  const facade = makeGestureFacade(calls);
  const mutate = facade.mutate;
  facade.mutate = async (opts) => {
    const result = await mutate(opts);
    settle();
    return result;
  };
  const appRef = {
    vault: { getAbstractFileByPath: () => file },
    fileManager: { processFrontMatter: async () => { throw new Error('fixture write rejected'); } },
  };
  return await withGestureRuntime(appRef, facade, async () => {
    global.customJS.AccentButton = {
      render: (_row, opts) => {
        const button = makeRuntimeEl();
        let visibleText = '';
        let visibleHtml = '';
        const visibleHistory = [];
        const initialHtml = `<span>${opts.label}</span>`;
        Object.defineProperties(button, {
          textContent: {
            configurable: true,
            get() { return visibleText; },
            set(value) {
              visibleText = String(value);
              // This bounded fixture writes only the fixed plain status label.
              // Mirror it directly so the fake models textContent replacing
              // innerHTML without pretending to be a general HTML sanitizer.
              visibleHtml = visibleText;
              visibleHistory.push(visibleText);
            },
          },
          innerHTML: {
            configurable: true,
            get() { return visibleHtml; },
            set(value) {
              visibleHtml = String(value);
              // The fixture has one known markup value; do not model general
              // HTML parsing or sanitization in this bounded DOM double.
              visibleText = visibleHtml === initialHtml ? String(opts.label) : visibleHtml;
              visibleHistory.push(visibleText);
            },
          },
        });
        button.innerHTML = initialHtml;
        button.onclick = opts.onClick;
        button._label = opts.label;
        button._visibleHistory = visibleHistory;
        buttons.push(button);
        return button;
      },
    };
    const container = makeRuntimeEl();
    const dv = {
      container,
      current: () => ({
        type: 'reader-article', file: { path: file.path }, status: 'unread', url: '',
      }),
    };
    new Klass().render(dv);
    const reading = buttons.find((button) => button._label === 'Mark reading');
    assert(reading, 'rendered reader row exposes the Mark reading button');
    const priorHtml = reading.innerHTML;
    reading.onclick();
    await settled;
    return {
      calls: calls.length,
      visibleHistory: reading._visibleHistory,
      priorHtml,
      finalHtml: reading.innerHTML,
      disabled: reading.disabled,
    };
  });
}

okAsync('GA-P3-READER-BUTTON-ROLLBACK executes the rendered status-button callbacks', async () => {
  const Klass = loadClass('blueprints/reader/helpers/reader-article-actions.js', 'ReaderArticleActions');
  const outcome = await readerButtonRollbackOutcome(Klass);
  assert(outcome.calls === 1, 'rendered reader button delegates once through mutate');
  assert(outcome.visibleHistory.includes('Status: Reading'), 'reader button visibly applies the optimistic status');
  assert(outcome.finalHtml === outcome.priorHtml && outcome.disabled === false,
      'reader button restores its exact prior markup and enabled state after rejection');
});

okAsync('GA-P3C-READER-BUTTON-DOM-LABEL-ROLLBACK-MUTANT turns red', async () => {
  const src = helperSource('reader/helpers/reader-article-actions.js');
  const restoration = 'statusBtn.innerHTML = priorHtml;';
  assert(src.includes(restoration), 'reader label-restoration mutation anchor exists');
  const mutantSource = src.replace(restoration, '/* mutant: label restoration removed */');
  const MutantClass = new Function(`${mutantSource}; return ReaderArticleActions;`)();
  const outcome = await readerButtonRollbackOutcome(MutantClass);
  const rollbackFixturePasses = outcome.finalHtml === outcome.priorHtml && outcome.disabled === false;
  assert(outcome.visibleHistory.includes('Status: Reading'), 'mutant still reaches the visible optimistic label');
  assert(outcome.disabled === false, 'mutant still restores enabled state');
  assert(rollbackFixturePasses === false,
    'DOM-faithful rollback fixture turns red when visible-label restoration is removed');
});

for (const [rel, name, label] of [
  ['blueprints/sticky-notes/helpers/sticky-chrome-bar.js', 'StickyChromeBar', 'sticky'],
  ['blueprints/journal/helpers/journal-chrome-bar.js', 'JournalChromeBar', 'journal'],
]) {
  okAsync(`GA-P3-${label.toUpperCase()}-RUNTIME invokes mutate for title persistence`, async () => {
    const Klass = loadClass(rel, name);
    const file = { path: `${label}.md`, fm: { title: 'Old' } };
    const calls = [], ui = [];
    const appRef = { fileManager: { processFrontMatter: async (target, fn) => fn(target.fm) } };
    await withGestureRuntime(appRef, makeGestureFacade(calls), async () => {
      const saved = await new Klass()._writeTitle({}, file, 'Old', 'New', (value) => ui.push(value));
      assert(saved && calls.length === 1, `${label} delegates exactly once`);
      assert(file.fm.title === 'New' && ui.join(',') === 'New', `${label} title and optimism execute`);
    });
  });
}

for (const [rel, name, label, bannerClass] of [
  ['blueprints/sticky-notes/helpers/sticky-chrome-bar.js', 'StickyChromeBar', 'sticky', 'sticky-title-banner'],
  ['blueprints/journal/helpers/journal-chrome-bar.js', 'JournalChromeBar', 'journal', 'journal-title-banner'],
]) {
  okAsync(`GA-P3-${label.toUpperCase()}-OVERFLOW-ROLLBACK executes real dispatch callback and rejected-write revert`, async () => {
    const Klass = loadClass(rel, name);
    const file = { path: `${label}.md`, fm: { title: 'Old' } };
    const calls = [], history = [];
    const titleEl = { style: { cssText: '' } };
    Object.defineProperty(titleEl, 'textContent', {
      get() { return history.length ? history[history.length - 1] : 'Old'; },
      set(value) { history.push(String(value)); },
    });
    const banner = {
      firstElementChild: titleEl,
      querySelector: () => titleEl,
    };
    const dv = {
      container: { querySelectorAll: (selector) => selector === `.${bannerClass}` ? [banner] : [] },
      current: () => ({ file: { path: file.path }, title: 'Old' }),
    };
    const appRef = {
      vault: { getAbstractFileByPath: () => file },
      fileManager: { processFrontMatter: async () => { throw new Error('fixture write rejected'); } },
    };
    await withGestureRuntime(appRef, makeGestureFacade(calls), async () => {
      global.customJS.RenderSafe.page = () => ({ file: { path: file.path }, title: 'Old' });
      const inst = new Klass();
      let overflowCallback = null;
      inst._openRenameDialog = (_dv, _file, current, onDone) => {
        assert(current === 'Old', `${label} overflow dispatch carries the current title`);
        overflowCallback = onDone;
      };
      inst._config().dispatch(dv, { context: `${label}-entry`, path: file.path }, 'rename');
      assert(typeof overflowCallback === 'function', `${label} overflow dispatch exposes a real banner callback`);
      const saved = await inst._writeTitle(dv, file, 'Old', 'New', overflowCallback);
      assert(saved === false && calls.length === 1, `${label} rejected write settles false through mutate`);
      assert(history.join(',') === 'New,Old', `${label} banner applies optimism then restores the prior title`);
      assert(calls[0].isCurrent({ title: 'Old' }) === false, `${label} title authority rejects stale state`);
      assert(calls[0].isCurrent({ title: 'New' }) === true, `${label} title authority accepts exact state`);

      const clickHistory = [];
      const clickTitle = {
        style: { cssText: '' },
        _listeners: {},
        addEventListener(event, handler) { this._listeners[event] = handler; },
      };
      Object.defineProperty(clickTitle, 'textContent', {
        get() { return clickHistory.length ? clickHistory[clickHistory.length - 1] : 'Old'; },
        set(value) { clickHistory.push(String(value)); },
      });
      const clickBanner = {
        style: { cssText: '' },
        firstElementChild: clickTitle,
        querySelector: () => clickTitle,
        createEl: () => clickTitle,
        remove() {},
      };
      let mounted = false;
      const clickContainer = {
        querySelectorAll: (selector) => selector === `.${bannerClass}` && mounted ? [clickBanner] : [],
        createEl: (_tag, opts) => {
          assert(opts && opts.cls === bannerClass, `${label} click path creates the expected banner`);
          mounted = true;
          return clickBanner;
        },
      };
      const clickDv = { ...dv, container: clickContainer };
      let clickCallback = null;
      inst._openRenameDialog = (_dv, _file, current, onDone) => {
        assert(current === 'Old', `${label} click dispatch carries the current title`);
        clickCallback = onDone;
      };
      inst._renderTitleBanner(clickContainer, { title: 'Old', file: { name: `${label}.md` } }, file, clickDv);
      assert(typeof clickTitle._listeners.click === 'function', `${label} title banner has a click gesture`);
      clickTitle._listeners.click();
      assert(typeof clickCallback === 'function', `${label} click gesture exposes the visible banner callback`);
      const clickSaved = await inst._writeTitle(clickDv, file, 'Old', 'New', clickCallback);
      assert(clickSaved === false && calls.length === 2, `${label} click-path rejected write settles false`);
      assert(clickHistory.join(',') === 'New,Old', `${label} click path applies optimism then restores the prior title`);
    });
  });
}

for (const [rel, name, method, label, args] of [
  ['blueprints/project/helpers/project-status-widget.js', 'ProjectStatusWidget', '_writeStatus', 'project status',
    (file, ui) => [{}, file, 'planning', ui]],
  ['blueprints/reader/helpers/reader-article-actions.js', 'ReaderArticleActions', '_setStatus', 'reader status',
    (file, ui) => [file.path, 'reading', {}, ui]],
]) {
  okAsync(`GA-P3-${label.toUpperCase().replace(/ /g, '-')}-ROLLBACK restores visible state after write failure`, async () => {
    const Klass = loadClass(rel, name);
    const file = { path: `${label}.md`, fm: {} };
    const calls = [], ui = [];
    const appRef = {
      vault: { getAbstractFileByPath: () => file },
      fileManager: { processFrontMatter: async () => { throw new Error('fixture write rejected'); } },
    };
    await withGestureRuntime(appRef, makeGestureFacade(calls), async () => {
      const saved = await new Klass()[method](...args(file, {
        optimistic: () => ui.push('next'),
        revert: () => ui.push('prior'),
      }));
      assert(saved === false && calls.length === 1, `${label} rejected write settles false`);
      assert(ui.join(',') === 'next,prior', `${label} executes optimism then the exact revert callback`);
    });
  });
}

(async () => {
  for (const test of asyncCases) {
    try {
      await test.fn();
      console.log('ok ' + test.name);
      passes++;
    } catch (e) {
      console.error('FAIL ' + test.name + ': ' + (e && e.stack ? e.stack : e));
      fails++;
    }
  }
  console.log(`\nrun-render-safe: ${passes} passed, ${fails} failed`);
  process.exit(fails === 0 ? 0 : 1);
})();
