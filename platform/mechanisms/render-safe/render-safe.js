// render-safe.js — render-safe mechanism v0.1.0.
//
// Cold-load safety for Dataview render context. On cold vault load Dataview can
// render a dataviewjs block before it has indexed the embedding file, so
// dv.current() returns undefined and a bare `dv.current().file.path` deref throws
// the "Cannot read properties of undefined" flash (landmines #1-#2 + the v0.119/
// v0.132/v0.133 point-fixes). RenderSafe is the single home for the fallback:
// helpers call customJS.RenderSafe.page(dv) (window.customJS is already loaded in
// a helper body, since the customjs-guard view resolved the class first).
//
// Templates / dataviewjs-block args CANNOT use this class (customJS may be in the
// TDZ pre-guard) — they use `dv.current()?.x || app.workspace.getActiveFile()?.x`
// optional chaining instead. See Docs/agent-guides/code-conventions.md.
//
// Methods are INSTANCE methods (NOT static): the customJS plugin stores classes as
// instances (`customJS.RenderSafe = new RenderSafe()`), so members reached via
// `customJS.RenderSafe.page(dv)` must live on the prototype. A static method would
// be undefined on the instance and throw at render time (the customjs
// static-vs-instance trap — code-conventions.md "Dispatcher contracts").
class RenderSafe {
  // Returns the live Dataview page when indexed, else a shim built from the
  // active file (path/name + cached frontmatter), else null. Never throws.
  page(dv) {
    let cur = null;
    try {
      cur = dv && typeof dv.current === 'function' ? dv.current() : null;
    } catch (_e) { cur = null; }
    try {
      const f = (typeof app !== 'undefined' && app.workspace && app.workspace.getActiveFile)
        ? app.workspace.getActiveFile() : null;
      if (cur && cur.file) {
        // Mobile cold-load: Dataview can hand back a page that has `.file` but has NOT
        // yet populated its frontmatter fields (the note renders before the DV index is
        // ready), so consumers reading `page.type` etc. get undefined and bail — an empty
        // breadcrumb / chrome that never renders on phones. The fully-null case already
        // falls through to the active-file shim below; this handles the PARTIAL case.
        // When the DV page is for the ACTIVE file, overlay the metadataCache frontmatter
        // for any field the DV page is missing — DV's own resolved values win where
        // present. Return a shallow copy (never mutate the live DV page); keep DV's `.file`.
        if (f && cur.file.path === f.path && app.metadataCache && app.metadataCache.getFileCache) {
          const fm = (app.metadataCache.getFileCache(f) || {}).frontmatter;
          if (fm) {
            let needs = false;
            for (const k in fm) { if (cur[k] === undefined) { needs = true; break; } }
            if (needs) {
              const merged = Object.assign({}, fm, cur);
              if (cur.file && !merged.file) merged.file = cur.file;
              return merged;
            }
          }
        }
        return cur;
      }
      if (!f) return null;
      const fm2 = (app.metadataCache && app.metadataCache.getFileCache)
        ? (app.metadataCache.getFileCache(f) || {}).frontmatter : null;
      return Object.assign({ file: { path: f.path, name: f.basename } }, fm2 || {});
    } catch (_e) { return (cur && cur.file) ? cur : null; }
  }

  filePath(dv) { const p = this.page(dv); return (p && p.file && p.file.path) || null; }
  fileName(dv) { const p = this.page(dv); return (p && p.file && p.file.name) || null; }

  // ---------- Gesture mutation lifecycle ----------
  // One lifecycle for gesture-time frontmatter/vault writes. It captures scroll
  // before any visible or persisted work, applies optimistic UI before starting
  // the write, and reconciles only the active/create surface after Dataview's
  // authoritative index is current. Background changes are intentionally left
  // to the platform reconciler.
  //
  // Returns { ok: true, value } or { ok: false, error }. Operational helpers
  // (scroll, Notice, metadata, Dataview, commands, timers) are best-effort and
  // never mask the original write failure. All seams are injectable so the same
  // instance-method contract works in CustomJS and deterministic harnesses.
  async mutate(opts) {
    opts = opts || {};
    const appRef = opts.app || this._runtimeApp();
    const path = typeof opts.path === 'string' ? opts.path : '';
    const mode = this._mutationMode(opts.mode, appRef, path);
    const dv = opts.dv || this._dataviewApi(appRef);

    // Capture is always the first effect, even for background/create/failure.
    try { this.captureScroll(opts.scroll || opts); } catch (_e) {}

    // Active forced refresh is opt-in: only the caller knows which indexed
    // value proves this particular mutation current. When no mutation-specific
    // predicate is supplied, finish after the write and leave reconciliation
    // to Dataview instead of polling a generic page delta. Create remains
    // existence-authoritative and independent of isCurrent.
    const activeAuthority = mode === 'active' && typeof opts.isCurrent === 'function';
    const beforePage = activeAuthority ? this._dvPage(dv, path) : null;
    const reconcile = (mode === 'create' || activeAuthority)
      ? this._prepareMutationReconcile({
          app: appRef,
          dv,
          path,
          mode,
          timers: opts.timers,
          setTimeout: opts.setTimeout,
          clearTimeout: opts.clearTimeout,
          signalTimeout: opts.signalTimeout,
          pollInterval: opts.pollInterval,
          pollAttempts: opts.pollAttempts,
          isCurrent: opts.isCurrent,
          beforePage,
        })
      : null;

    try {
      if (typeof opts.optimistic === 'function') await opts.optimistic();
      if (typeof opts.write !== 'function') throw new Error('RenderSafe.mutate requires write');
      const value = await opts.write();
      if (reconcile) await reconcile.start();
      return { ok: true, value };
    } catch (error) {
      if (reconcile) reconcile.cancel();
      if (typeof opts.revert === 'function') {
        try { await opts.revert(error); } catch (_e) {}
      }
      this._mutationNotice(opts, error);
      return { ok: false, error };
    }
  }

  // Structural companion to mutate(). `apply` performs the optimistic DOM
  // insert/remove and returns an opaque receipt (for example { parent, node,
  // nextSibling, focusTarget }). If persistence rejects, `rollback` receives
  // that exact receipt so the caller can restore identity and position instead
  // of reconstructing a lookalike row from stale Dataview data.
  //
  // This is deliberately a thin adapter: mutate remains the single owner of
  // scroll capture, failure Notice behavior, and write ordering. Structural UI
  // is already current locally, so this seam always uses background mode and
  // leaves authoritative cleanup to Dataview's natural reconciler. Callers
  // cannot turn a successful structural gesture into a global forced refresh.
  async mutateStructure(opts) {
    opts = opts || {};
    let receipt;
    const mutation = Object.assign({}, opts, {
      mode: 'background',
      isCurrent: undefined,
      optimistic: async () => {
        if (typeof opts.apply !== 'function') {
          throw new Error('RenderSafe.mutateStructure requires apply');
        }
        if (typeof opts.rollback !== 'function') {
          throw new Error('RenderSafe.mutateStructure requires rollback');
        }
        receipt = await opts.apply();
      },
      revert: async (error) => opts.rollback(receipt, error),
    });
    return this.mutate(mutation);
  }

  _runtimeApp() {
    try {
      if (typeof window !== 'undefined' && window.app) return window.app;
      if (typeof globalThis !== 'undefined' && globalThis.app) return globalThis.app;
      if (typeof app !== 'undefined') return app;
    } catch (_e) {}
    return null;
  }

  _mutationMode(mode, appRef, path) {
    if (mode === 'active' || mode === 'background' || mode === 'create') return mode;
    try {
      const active = appRef && appRef.workspace && typeof appRef.workspace.getActiveFile === 'function'
        ? appRef.workspace.getActiveFile() : null;
      return path && active && active.path === path ? 'active' : 'background';
    } catch (_e) { return 'background'; }
  }

  _dataviewApi(appRef) {
    try {
      const plugin = appRef && appRef.plugins && appRef.plugins.plugins
        ? appRef.plugins.plugins.dataview : null;
      return plugin && plugin.api ? plugin.api : null;
    } catch (_e) { return null; }
  }

  _dvPage(dv, path) {
    try { return dv && typeof dv.page === 'function' && path ? (dv.page(path) || null) : null; }
    catch (_e) { return null; }
  }

  _mutationNotice(opts, error) {
    try {
      const NoticeClass = opts.Notice
        || (typeof window !== 'undefined' && window.Notice)
        || (typeof Notice !== 'undefined' ? Notice : null);
      if (typeof NoticeClass !== 'function') return;
      const reason = error && error.message ? error.message : String(error || 'Unknown error');
      new NoticeClass(opts.failureMessage || ('Update failed: ' + reason));
    } catch (_e) {}
  }

  _prepareMutationReconcile(opts) {
    const appRef = opts.app;
    const metadata = appRef && appRef.metadataCache;
    const path = opts.path;
    const timers = opts.timers || {};
    const setT = timers.setTimeout || opts.setTimeout
      || (appRef && appRef._setTimeout)
      || (typeof window !== 'undefined' && window.setTimeout)
      || (typeof setTimeout !== 'undefined' ? setTimeout : null);
    const clearT = timers.clearTimeout || opts.clearTimeout
      || (appRef && appRef._clearTimeout)
      || (typeof window !== 'undefined' && window.clearTimeout)
      || (typeof clearTimeout !== 'undefined' ? clearTimeout : null);
    const signalTimeout = Number.isFinite(opts.signalTimeout) ? Math.max(0, opts.signalTimeout) : 1200;
    const pollInterval = Number.isFinite(opts.pollInterval) ? Math.max(0, opts.pollInterval) : 150;
    const pollAttempts = Number.isFinite(opts.pollAttempts) ? Math.max(0, Math.floor(opts.pollAttempts)) : 20;
    let ref = null;
    let listener = null;
    let signaled = false;
    let started = false;
    let done = false;
    let resolveDone = null;
    const timerIds = [];

    const detach = () => {
      if (!metadata || !ref) return;
      try {
        if (typeof metadata.offref === 'function') metadata.offref(ref);
        else if (typeof metadata.off === 'function' && listener) metadata.off('changed', listener);
      } catch (_e) {}
      ref = null;
    };
    const clearTimers = () => {
      if (typeof clearT === 'function') {
        while (timerIds.length) {
          try { clearT(timerIds.pop()); } catch (_e) {}
        }
      } else {
        timerIds.length = 0;
      }
    };
    const schedule = (fn, delay) => {
      if (typeof setT !== 'function' || done) return false;
      try {
        const id = setT(fn, delay);
        timerIds.push(id);
        return true;
      } catch (_e) { return false; }
    };
    const forceRefresh = () => {
      try {
        const commands = appRef && appRef.commands;
        if (!commands || typeof commands.executeCommandById !== 'function') return false;
        commands.executeCommandById('dataview:dataview-force-refresh-views');
        return true;
      } catch (_e) { return false; }
    };
    const finish = (refresh) => {
      if (done) return;
      done = true;
      detach();
      clearTimers();
      const refreshed = refresh ? forceRefresh() : false;
      if (resolveDone) resolveDone(refreshed);
    };
    const current = () => {
      const page = this._dvPage(opts.dv, path);
      // Create reconciliation has exactly two authorities: the page now exists,
      // or its bounded polling window expires below. Keep this branch ahead of
      // every active-only escape hatch. An injected isCurrent predicate cannot
      // prove creation, and missing/unusable Dataview cannot be treated as a
      // current index when there is no page to observe.
      if (opts.mode === 'create') return !!page;
      // Active reconciliation is only constructed when mutate received an
      // explicit mutation-specific authority. Keep this fail-closed guard in
      // the private seam so direct/mutated calls can never fall back to page
      // shape, metadata volatility, or an unrelated same-file semantic delta.
      if (typeof opts.isCurrent !== 'function') return false;
      try {
        const verdict = opts.isCurrent(page, opts.beforePage);
        if (verdict === true) return true;
        // isCurrent is deliberately synchronous and boolean-only. An async
        // predicate is itself a contract violation, never freshness evidence.
        // Observe promise/thenable rejection so fail-closed handling cannot leak
        // an unhandled rejection into Obsidian or the test runner.
        if (verdict && (typeof verdict === 'object' || typeof verdict === 'function')) {
          try { Promise.resolve(verdict).catch(() => {}); } catch (_e) {}
        }
        return false;
      } catch (_e) { return false; }
    };
    const poll = (attemptsLeft) => {
      if (done) return;
      if (current()) { finish(true); return; }
      // Create must surface a newly-written page even if Dataview misses the
      // bounded window. Active updates must never redraw known-stale data.
      if (attemptsLeft <= 0) { finish(opts.mode === 'create'); return; }
      if (!schedule(() => poll(attemptsLeft - 1), pollInterval)) finish(false);
    };
    const beginPoll = () => {
      if (done) return;
      clearTimers();
      poll(pollAttempts);
    };

    listener = (file) => {
      if (done || signaled || !file || file.path !== path) return;
      signaled = true;
      if (started) beginPoll();
    };
    try {
      if (metadata && typeof metadata.on === 'function' && path) {
        ref = metadata.on('changed', listener);
      }
    } catch (_e) { ref = null; }

    return {
      start: () => {
        if (done) return Promise.resolve(false);
        started = true;
        return new Promise((resolve) => {
          resolveDone = resolve;
          if (signaled || !ref) {
            beginPoll();
          } else if (!schedule(beginPoll, signalTimeout)) {
            // No timer means we cannot safely prove Dataview freshness.
            finish(false);
          }
        });
      },
      cancel: () => finish(false),
    };
  }

  // ---------- L3: scroll preservation across a write→re-render ----------
  // Find the active Reading-view scroll container. Robust: known reading-view
  // selector, then a bare preview-view, then null. Never throws.
  static _findScroller(doc) {
    try {
      if (!doc || typeof doc.querySelector !== 'function') return null;
      return doc.querySelector('.workspace-leaf.mod-active .markdown-reading-view .markdown-preview-view')
        || doc.querySelector('.workspace-leaf.mod-active .markdown-preview-view')
        || doc.querySelector('.markdown-preview-view')
        || null;
    } catch (_e) { return null; }
  }

  // Capture the active scroller's scrollTop and install a one-shot watcher that
  // restores it after the block tears down + rebuilds (Dataview clears the block,
  // collapsing height, then repaints). Call BEFORE the write that triggers the
  // re-render. Fully injectable for tests; never throws.
  captureScroll(opts) {
    opts = opts || {};
    try {
      const win = opts.win || (typeof window !== 'undefined' ? window : null);
      const doc = opts.doc || (win && win.document) || (typeof document !== 'undefined' ? document : null);
      if (!win || !doc) return null;
      const scroller = RenderSafe._findScroller(doc);
      if (!scroller) return null;
      const y = Number(scroller.scrollTop) || 0;
      if (y <= 0) return null; // already at top → nothing to preserve
      const now = (typeof opts.now === 'number') ? opts.now
        : (typeof Date !== 'undefined' && Date.now ? Date.now() : 0);
      let path = opts.activePath;
      if (path == null) {
        try {
          path = (typeof app !== 'undefined' && app.workspace && app.workspace.getActiveFile)
            ? (app.workspace.getActiveFile() || {}).path : null;
        } catch (_e) { path = null; }
      }
      win.__sauceScrollStash = { path: path || null, y: y, t: now };
      RenderSafe._installRestore(scroller, y, win);
      return win.__sauceScrollStash;
    } catch (_e) { return null; }
  }

  // Instance alias so tests can call RenderSafe._findScroller(doc) on an instance.
  _findScroller(doc) { return RenderSafe._findScroller(doc); }

  // Watch the scroller and restore scrollTop=y ONCE the teardown→rebuild has run.
  // Two-phase (this is the subtle part): the Dataview re-render clears the block a
  // few frames AFTER we capture, which CLAMPS scrollTop below y. We must NOT
  // "restore" (and disconnect) on an early nudge that fires BEFORE that teardown —
  // at that point scrollTop is still y and the content is still tall, so a naive
  // "tall enough → done" check completes trivially and disconnects, losing the
  // scroll when the real teardown lands. So: wait until we OBSERVE a drift below y
  // (the clamp), THEN restore once the content is tall enough again, then stop.
  // rAF nudges cover the no-MutationObserver case; the timeout is a hard cap.
  // Never throws.
  static _installRestore(scroller, y, win) {
    try {
      const MO = win.MutationObserver;
      let done = false;
      let sawDrift = false;
      let obs = null;
      const step = () => {
        try {
          if (done) return;
          const top = Number(scroller.scrollTop) || 0;
          const h = Number(scroller.scrollHeight) || 0;
          if (top < y - 2) sawDrift = true;                 // teardown clamped us below y
          if (sawDrift && h >= y) {                          // content tall enough again → restore once
            scroller.scrollTop = y;
            if ((Number(scroller.scrollTop) || 0) >= y - 2) { done = true; if (obs) obs.disconnect(); }
          }
        } catch (_e) { done = true; }
      };
      if (typeof MO === 'function') {
        obs = new MO(() => step());
        try { obs.observe(scroller, { childList: true, subtree: true }); } catch (_e) {}
      }
      // rAF nudges for a bounded number of frames (covers the no-observer path);
      // NEVER disconnects — only step() on a real restore disconnects.
      const raf = win.requestAnimationFrame || ((fn) => (win.setTimeout ? win.setTimeout(fn, 16) : null));
      let frames = 0;
      const tick = () => { if (done) return; step(); if (++frames < 90) raf(tick); };
      raf(tick);
      if (win.setTimeout) win.setTimeout(() => { done = true; if (obs) { try { obs.disconnect(); } catch (_e) {} } }, 3000);
    } catch (_e) { /* never throw */ }
  }
}
