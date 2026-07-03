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
    try {
      const cur = dv && typeof dv.current === 'function' ? dv.current() : null;
      if (cur && cur.file) return cur;
    } catch (_e) { /* fall through to active-file shim */ }
    try {
      const f = (typeof app !== 'undefined' && app.workspace && app.workspace.getActiveFile)
        ? app.workspace.getActiveFile() : null;
      if (!f) return null;
      const fm = (app.metadataCache && app.metadataCache.getFileCache)
        ? (app.metadataCache.getFileCache(f) || {}).frontmatter : null;
      return Object.assign({ file: { path: f.path, name: f.basename } }, fm || {});
    } catch (_e) { return null; }
  }

  filePath(dv) { const p = this.page(dv); return (p && p.file && p.file.path) || null; }
  fileName(dv) { const p = this.page(dv); return (p && p.file && p.file.name) || null; }

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
