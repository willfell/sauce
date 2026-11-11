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

  // ---------- Refresh gate: a Dataview re-execution must not destroy live UI ----------
  //
  // Dataview re-executes a dataviewjs block whenever its index revision moves:
  // its own debounced `dataview:refresh-views` after ANY note is saved (the
  // one being typed in included), and the sauce plugin's reconciler ~500ms
  // after a background write. DataviewJSRenderer.render() starts with
  // `container.innerHTML = ""`, so every widget is torn down and rebuilt from
  // nothing even when its output is identical. That is the "it reset on me"
  // class: the note flashes and jumps while typing, a half-typed input loses
  // its text and focus, an open menu closes.
  //
  // The gate takes over the renderer's refresh (never its first render). It
  // runs the block into a hidden scratch element beside the real container,
  // then commits per top-level child: a child whose markup equals what the last
  // render produced is left untouched (same node, so focus, typed text, open
  // menus and scroll survive, and nothing repaints); a child that really
  // changed is swapped in one synchronous step, with typed text, focus and
  // caret carried onto the matching field. The container is never empty.
  //
  // customjs-guard calls beginRefresh(dv) before the widget renders and
  // settleRefresh(dv) after; that is the whole integration. Those two calls are
  // also the ONLY reliable "this run has finished rendering" signal: Dataview's
  // dv.view() does not return the view's async body, so `await dv.view(...)`,
  // and with it the renderer's own render() promise, resolve as soon as the
  // view has STARTED. The gate therefore counts begin/settle pairs per run
  // (nested views included) and commits a scratch run only once they balance. Everything here
  // feature-detects and never throws: with no `dv.component.render`, with the
  // kill switch set (`window.__sauceRefreshGate = false` or localStorage
  // `sauce.refresh-gate` = "off"), or on any failure, Dataview's own render
  // runs exactly as before.
  beginRefresh(dv) {
    try {
      const component = dv && dv.component;
      const container = dv && dv.container;
      if (!component || !container || typeof component.render !== 'function') return null;
      let gate = component.__sauceRefreshGate || null;
      if (gate) {
        const run = gate.scratchRun;
        const inScratch = !!gate.scratchDvs && gate.scratchDvs.has(dv);
        if (run && (inScratch ? run.dvs.includes(dv) : container === run.el)) {
          if (!inScratch) { run.dvs.push(dv); gate.scratchDvs.add(dv); }
          run.began = true;
          run.depth += 1;
        } else if (!inScratch && container === gate.container) {
          gate.depth += 1;
        }
        return gate;
      }
      if (this._refreshGateDisabled()) return null;
      const self = this;
      gate = {
        component,
        container,
        origRender: component.render,
        depth: 1,
        settled: false,
        snapshot: null,
        running: null,
        queued: false,
        scratchRun: null,
        scratchDvs: typeof WeakSet === 'function' ? new WeakSet() : null,
        lastOutcome: null,
        lastError: null,
        edited: typeof WeakSet === 'function' ? new WeakSet() : null,
      };
      Object.defineProperty(component, '__sauceRefreshGate', { value: gate, configurable: true, writable: true });
      component.render = function () { return self._gatedRender(gate); };
      try {
        if (gate.edited && typeof container.addEventListener === 'function') {
          container.addEventListener('input', (ev) => {
            try { if (ev && ev.target) gate.edited.add(ev.target); } catch (_e) {}
          }, true);
        }
      } catch (_e) {}
      return gate;
    } catch (_e) { return null; }
  }

  settleRefresh(dv, error) {
    try {
      const gate = dv && dv.component && dv.component.__sauceRefreshGate;
      if (!gate || !dv.container) return;
      if (gate.scratchDvs && gate.scratchDvs.has(dv)) {
        const run = gate.scratchRun;
        if (run && run.dvs.includes(dv)) {
          if (error) run.failed = true;
          run.depth = Math.max(0, run.depth - 1);
          if (run.depth === 0 && run.onIdle) run.onIdle();
        }
        return;
      }
      if (dv.container !== gate.container) return;
      gate.depth = Math.max(0, gate.depth - 1);
      if (gate.depth === 0) {
        gate.snapshot = this._refreshSnapshot(gate.container);
        gate.settled = true;
      }
    } catch (_e) {}
  }

  _refreshGateDisabled() {
    try {
      if (typeof window !== 'undefined' && window.__sauceRefreshGate === false) return true;
      if (typeof localStorage !== 'undefined' && localStorage.getItem('sauce.refresh-gate') === 'off') return true;
    } catch (_e) {}
    return false;
  }

  _refreshNodes(el) {
    try { return Array.from((el && (el.childNodes || el.children)) || []); } catch (_e) { return []; }
  }

  // What a freshly rendered node shows. Serialized markup alone misses state
  // a widget sets as a PROPERTY (an input's value, a checkbox's checked), so
  // those are appended; otherwise changed data rendered that way would compare
  // equal and the stale node would be kept.
  _refreshMarkup(node) {
    try {
      if (!node || typeof node.outerHTML !== 'string') return 'T:' + String((node && node.textContent) || '');
      const fields = [];
      const tag = String(node.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') fields.push(node);
      if (typeof node.querySelectorAll === 'function') fields.push(...this._fieldList(node));
      const props = fields.map((el) => String(el.value == null ? '' : el.value)
        + (el.checked ? '\u0001c' : '') + (el.indeterminate ? '\u0001i' : '')).join('\u0000');
      return 'E:' + this._stableMarkup(node.outerHTML) + '\u0002' + props;
    } catch (_e) { return 'X:' + Math.random(); }
  }

  // Attributes that differ between two renders of identical data and carry no
  // meaning across renders. `data-sauce-task-order` is TaskTodayList's
  // process-wide row sequence: it only orders siblings within one render, and
  // it grows on every render, so comparing it would mark every task list as
  // changed on every refresh.
  // `data-sauce-refreshed` is the gate's own mark (see _markRefreshed).
  _stableMarkup(html) {
    return String(html)
      .replace(/\sdata-sauce-task-order="[^"]*"/g, '')
      .replace(/\sdata-sauce-refreshed(="[^"]*")?/g, '');
  }

  // A node the gate swaps in replaces one the reader was already looking at,
  // so it must not play a widget's entry animation again. The mark lets a
  // stylesheet tell a refresh from a first paint
  // (`[data-sauce-refreshed] .row { animation: none; }`). It is set after the
  // markup comparison and stripped by _stableMarkup, so it never makes two
  // renders of the same data look different.
  _markRefreshed(node) {
    try { if (node && typeof node.setAttribute === 'function') node.setAttribute('data-sauce-refreshed', ''); } catch (_e) {}
  }

  _refreshSnapshot(container) {
    const nodes = this._refreshNodes(container);
    return { nodes, markup: nodes.map((n) => this._refreshMarkup(n)) };
  }

  // One gated refresh at a time per block; refreshes that arrive meanwhile
  // coalesce into a single follow-up run.
  _gatedRender(gate) {
    if (gate.running) { gate.queued = true; return gate.running; }
    gate.running = (async () => {
      try {
        do {
          gate.queued = false;
          await this._gatedRenderOnce(gate);
        } while (gate.queued);
      } finally { gate.running = null; }
    })();
    return gate.running;
  }

  async _gatedRenderOnce(gate) {
    const { component, container } = gate;
    let scratch = null;
    try {
      const parent = container.parentNode;
      const doc = container.ownerDocument || (typeof document !== 'undefined' ? document : null);
      const usable = gate.settled && gate.snapshot && parent && doc
        && typeof doc.createElement === 'function'
        && container.isConnected !== false
        && !this._refreshGateDisabled();
      if (!usable) { gate.lastOutcome = 'ungated'; return await this._ungatedRender(gate); }

      scratch = doc.createElement(container.tagName || 'div');
      try {
        scratch.className = String(container.className || '').replace(/\bnode-insert-event\b/g, '').trim();
        let width = 0;
        try { width = container.getBoundingClientRect().width || 0; } catch (_e) { width = 0; }
        scratch.style.cssText = 'position:absolute;left:0;top:0;height:0;overflow:hidden;visibility:hidden;'
          + 'pointer-events:none;' + (width > 0 ? 'width:' + width + 'px;' : 'width:100%;');
        scratch.setAttribute('aria-hidden', 'true');
        scratch.setAttribute('data-sauce-refresh-scratch', '');
      } catch (_e) {}
      parent.insertBefore(scratch, container.nextSibling || null);
    } catch (error) {
      gate.lastOutcome = 'ungated';
      gate.lastError = error;
      try { if (scratch && scratch.parentNode) scratch.parentNode.removeChild(scratch); } catch (_e2) {}
      return this._ungatedRender(gate);
    }

    const run = { el: scratch, dvs: [], depth: 0, began: false, failed: false, onIdle: null };
    gate.scratchRun = run;
    try {
      const shadow = Object.create(component, {
        container: { value: scratch, writable: true, configurable: true },
        containerEl: { value: scratch, writable: true, configurable: true },
      });
      await gate.origRender.call(shadow);
      if (!(await this._scratchRunFinished(run))) { gate.lastOutcome = 'timeout'; return; }
      // A widget that threw has produced nothing usable: what is on screen is
      // better than an empty block. The next refresh tries again.
      if (run.failed) { gate.lastOutcome = 'failed'; return; }
      if (container.isConnected === false || container.parentNode == null) { gate.lastOutcome = 'detached'; return; }
      const replaced = this._commitRefresh(gate, scratch);
      gate.lastOutcome = replaced ? 'replaced' : 'kept';
      if (replaced) {
        // Closures from this run that still hold `dv` must reach the real
        // container, where their output now lives.
        for (const dv of run.dvs) {
          try { if (dv && dv.container === scratch) dv.container = container; } catch (_e) {}
        }
      }
    } catch (error) {
      // The scratch run failed outside Dataview's own error handling: leave
      // what is on screen alone; the next refresh tries again.
      gate.lastOutcome = 'failed';
      gate.lastError = error;
    } finally {
      run.onIdle = null;
      if (gate.scratchRun === run) gate.scratchRun = null;
      try { if (scratch.parentNode) scratch.parentNode.removeChild(scratch); } catch (_e) {}
    }
  }

  // Resolves true once every view the scratch run started has settled. By the
  // time Dataview's render() promise has resolved, every AWAITED dv.view of the
  // block has begun, so "began and balanced" is complete output. A run in which
  // no guarded view began at all (the guard printed a diagnostic instead) has
  // nothing more to wait for. Resolves false if the run never balances within
  // the limit, in which case the caller leaves the screen as it is.
  _scratchRunFinished(run) {
    if (!run.began || run.depth === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      let finished = false;
      let timer = null;
      const finish = (ok) => {
        if (finished) return;
        finished = true;
        run.onIdle = null;
        try { if (timer != null && typeof clearTimeout === 'function') clearTimeout(timer); } catch (_e) {}
        resolve(ok);
      };
      run.onIdle = () => finish(true);
      try {
        const limit = Number.isFinite(this._scratchRunTimeoutMs) ? this._scratchRunTimeoutMs : 15000;
        if (typeof setTimeout === 'function') timer = setTimeout(() => finish(false), limit);
      } catch (_e) {}
    });
  }

  async _ungatedRender(gate) {
    gate.settled = false;
    gate.snapshot = null;
    gate.depth = 0;
    return gate.origRender.call(gate.component);
  }

  // Move the scratch output into the real container. Returns true when any
  // node was replaced, false when everything on screen was kept.
  _commitRefresh(gate, scratch) {
    const container = gate.container;
    const live = this._refreshNodes(container);
    const fresh = this._refreshNodes(scratch);
    const freshMarkup = fresh.map((n) => this._refreshMarkup(n));
    const snap = gate.snapshot;
    const intact = !!snap && snap.nodes.length === live.length && snap.nodes.every((n, i) => n === live[i]);

    if (intact && fresh.length === live.length && freshMarkup.every((m, i) => m === snap.markup[i])) {
      return false;
    }

    const fields = this._captureFields(gate, container);
    if (intact) {
      const common = Math.min(live.length, fresh.length);
      for (let i = 0; i < common; i++) {
        if (freshMarkup[i] !== snap.markup[i]) { this._markRefreshed(fresh[i]); container.replaceChild(fresh[i], live[i]); }
      }
      for (let i = common; i < live.length; i++) container.removeChild(live[i]);
      for (let i = common; i < fresh.length; i++) { this._markRefreshed(fresh[i]); container.appendChild(fresh[i]); }
    } else {
      // Something other than the last render owns part of the container (a
      // widget appended later, an interleaved first render). Replace it all,
      // still in one step.
      for (const node of live) { try { container.removeChild(node); } catch (_e) {} }
      for (const node of fresh) { this._markRefreshed(node); container.appendChild(node); }
    }
    gate.snapshot = { nodes: this._refreshNodes(container), markup: freshMarkup };
    this._restoreFields(gate, container, fields);
    return true;
  }

  _fieldKey(el) {
    const attr = (name) => { try { return String(el.getAttribute(name) || ''); } catch (_e) { return ''; } };
    return [String(el.tagName || '').toLowerCase(), attr('type'), attr('name'), attr('placeholder'),
      attr('aria-label'), attr('data-capture-key'), String(el.className || '')].join('|');
  }

  _isTextField(el) {
    const tag = String(el.tagName || '').toLowerCase();
    if (tag === 'textarea') return true;
    if (tag !== 'input') return false;
    const type = String((el.getAttribute && el.getAttribute('type')) || el.type || 'text').toLowerCase();
    return ['text', 'search', 'url', 'tel', 'email', 'password', 'number', 'date', 'time', 'datetime-local', ''].includes(type);
  }

  _fieldList(root) {
    try { return Array.from(root.querySelectorAll('input, textarea, select')); } catch (_e) { return []; }
  }

  // What the user has typed or is focused on, keyed so the same field can be
  // found in a re-rendered subtree. Only fields the user actually edited (or
  // the focused one) are carried; a value a widget set itself is data and must
  // come from the fresh render.
  _captureFields(gate, container) {
    const out = [];
    try {
      const doc = container.ownerDocument || (typeof document !== 'undefined' ? document : null);
      const active = doc ? doc.activeElement : null;
      const ordinals = new Map();
      for (const el of this._fieldList(container)) {
        const key = this._fieldKey(el);
        const ordinal = ordinals.get(key) || 0;
        ordinals.set(key, ordinal + 1);
        const focused = el === active;
        const edited = !!(gate.edited && gate.edited.has(el));
        if (!focused && !edited) continue;
        const text = this._isTextField(el);
        const entry = { el, key, ordinal, focused, edited, text, value: el.value };
        if (focused && text) {
          try { entry.start = el.selectionStart; entry.end = el.selectionEnd; entry.direction = el.selectionDirection; } catch (_e) {}
        }
        out.push(entry);
      }
    } catch (_e) {}
    return out;
  }

  _restoreFields(gate, container, fields) {
    if (!fields || !fields.length) return;
    try {
      const byKey = new Map();
      for (const el of this._fieldList(container)) {
        const key = this._fieldKey(el);
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(el);
      }
      for (const entry of fields) {
        const candidates = byKey.get(entry.key) || [];
        if (candidates.includes(entry.el)) continue; // its node was kept; nothing was lost
        const target = candidates[entry.ordinal];
        if (!target) continue;
        if (entry.edited && (entry.text || String(target.tagName || '').toLowerCase() === 'select')) {
          try { target.value = entry.value; } catch (_e) {}
          try { if (gate.edited) gate.edited.add(target); } catch (_e) {}
        }
        if (entry.focused) {
          try { target.focus({ preventScroll: true }); } catch (_e) {}
          if (entry.text && typeof entry.start === 'number' && typeof target.setSelectionRange === 'function') {
            try { target.setSelectionRange(entry.start, entry.end, entry.direction || 'none'); } catch (_e) {}
          }
        }
      }
    } catch (_e) {}
  }
}
