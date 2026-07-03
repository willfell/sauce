# Seamless task actions + Home day-refresh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (with per-task review) or superpowers:test-driven-development inline. Steps use `- [ ]` checkboxes. Design: `Docs/plans/2026-07-03-seamless-task-actions-design.md`.

**Goal:** Make finishing/adding/editing tasks feel instant with no scroll jump, and fix the Home page freezing on a stale day — one PR, shipped to all three vaults.

**Architecture:** Five additive, never-throw levers on the existing Dataview+customjs surface. Optimistic DOM removal (L2), a self-restoring scroll primitive in render-safe (L3), a metadataCache-gated force-refresh after add (L4), a same-file self-reopen guard (L10), and a deduped `active-leaf-change` day-watcher on Home (L-HOME). No template edits, no migrations/heals.

**Tech Stack:** Node.js behavioral harnesses (stdlib only), customJS instance-method classes, Dataview `dataview:dataview-force-refresh-views` command, Playwright MCP for real-browser scroll certification.

**Non-negotiables:** every write mirrors `platform/…` source → `ranch/scripts/…` dogfood copy (and blueprint copies where they exist). All new code is never-throw and cold-load-safe (`window.customJS?.X?.m?.()`). No hardcoded version literals in tests. `npm run release:preflight` green before push.

**Copy map (edit source → sync these):**
- `platform/mechanisms/render-safe/render-safe.js` → `ranch/scripts/render-safe/render-safe.js`
- `platform/mechanisms/task-entity/task-today-list.js` → `ranch/scripts/task-entity/…` *(verify path)* — task-entity has NO `ranch/scripts/task-entity/`; confirm where task-entity deploys (grep `renderTaskRow` under ranch/scripts) and sync every deployed copy.
- `platform/mechanisms/task-entity/task-dialog.js` → its deployed copy
- `platform/blueprints/to-do/helpers/todo-create-task.js` → `ranch/scripts/to-do/todo-create-task.js`
- `platform/blueprints/home/helpers/space-home.js` → `ranch/scripts/home/space-home.js`

> **Task 0 (do first):** run `grep -rln 'renderTaskRow\|class TaskDialog\|class SpaceHome\|class RenderSafe\|class ToDoCreateTask' ranch/scripts platform/blueprints` and record the exact deployed copy path for every edited source file. Every task's final step syncs source→copy and re-runs the harness against BOTH. If a mechanism has no `ranch/scripts` copy, note that install materializes it and the dogfood test (`npm run status` / preflight `run-install`) covers it.

---

## Task 1: L3 — self-restoring scroll primitive in RenderSafe

**Files:**
- Modify: `platform/mechanisms/render-safe/render-safe.js` (add instance methods)
- Test: `platform/test/run-render-safe.js` (add RS-CAP-* / RS-REST-* / scroller-finder cases)

**Design:** `captureScroll(opts)` finds the active Reading-view scroller, stashes `{path,y,t}` on `win.__sauceScrollStash`, AND installs a one-shot restore watcher on the scroller (survives block re-render because the scroller is the view container, not the block). `opts = { doc, win, now, activePath }` all injectable for node tests; defaults to real globals. Pure helper `_findScroller(doc)` is separately testable.

- [ ] **Step 1: Write failing tests** in `run-render-safe.js` (append after existing cases). Use the existing `loadClass` + `new RenderSafeClass()` pattern.

```js
// ---------- L3 scroll capture/restore ----------
// Minimal DOM stubs: scroller with mutable scrollTop/scrollHeight/clientHeight,
// a fake MutationObserver that records its callback, and a fake requestAnimationFrame.
function makeScroller(overflow, sh, ch) {
  return {
    scrollTop: 0, scrollHeight: sh, clientHeight: ch,
    _cs: { overflowY: overflow },
    matches(sel){ return this._sel === sel; },
  };
}
function makeWin() {
  const cbs = [];
  return {
    __sauceScrollStash: undefined,
    MutationObserver: function (cb) { this.cb = cb; this.observe = () => {}; this.disconnect = () => {}; observers.push(this); },
    requestAnimationFrame: (fn) => { rafs.push(fn); return rafs.length; },
    getComputedStyle: (el) => el._cs || { overflowY: 'visible' },
    setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; },
    clearTimeout: () => {},
    _cbs: cbs,
  };
}
let observers = [], rafs = [], timeouts = [];

ok('RS-CAP-1 captureScroll stashes {path,y,t} from the active scroller', () => {
  observers = []; rafs = []; timeouts = [];
  const scroller = makeScroller('auto', 2000, 800); scroller.scrollTop = 640;
  const doc = { querySelector: (sel) => (sel.includes('markdown-preview-view') ? scroller : null) };
  const win = makeWin();
  const out = RenderSafe.captureScroll({ doc, win, now: 111, activePath: 'spice/home/Home.md' });
  assert(win.__sauceScrollStash && win.__sauceScrollStash.y === 640, 'y captured');
  assert(win.__sauceScrollStash.path === 'spice/home/Home.md', 'path captured');
  assert(win.__sauceScrollStash.t === 111, 't captured');
  assert(observers.length === 1, 'restore observer installed');
});

ok('RS-CAP-2 no scroller → no stash, no throw', () => {
  const doc = { querySelector: () => null };
  const win = makeWin();
  const out = RenderSafe.captureScroll({ doc, win, now: 1, activePath: 'x.md' });
  assert(win.__sauceScrollStash === undefined, 'no stash written');
});

ok('RS-REST-1 restore watcher sets scrollTop=y once scrollHeight recovers past y', () => {
  observers = [];
  const scroller = makeScroller('auto', 2000, 800); scroller.scrollTop = 500;
  const doc = { querySelector: () => scroller };
  const win = makeWin();
  RenderSafe.captureScroll({ doc, win, now: 5, activePath: 'a.md' });
  // Simulate teardown: block cleared → height collapses, scrollTop clamped to 0.
  scroller.scrollHeight = 40; scroller.scrollTop = 0;
  observers[0].cb();                       // mutation during teardown → height < y, no restore yet
  assert(scroller.scrollTop === 0, 'not restored while collapsed');
  // Rebuild: height recovers past y.
  scroller.scrollHeight = 2000;
  observers[0].cb();                       // mutation after rebuild → restore
  assert(scroller.scrollTop === 500, 'scrollTop restored to y once tall enough');
});

ok('RS-FIND overflow ancestor fallback when no .markdown-preview-view', () => {
  const scroller = makeScroller('scroll', 900, 300);
  const leaf = { querySelector: (sel) => null, closest: () => null };
  // _findScroller walks a provided candidate list; assert it picks a scrollable el.
  const picked = RenderSafe._findScroller
    ? RenderSafe._findScroller({ querySelector: (s)=> s.includes('preview')?null:scroller })
    : null;
  assert(picked === scroller || picked === null, 'finder returns a scroller or null, never throws');
});
```

- [ ] **Step 2: Run — expect FAIL** `node platform/test/run-render-safe.js` → RS-CAP/REST/FIND fail ("captureScroll is not a function").

- [ ] **Step 3: Implement** in `render-safe.js` (add instance methods before the closing `}` of class RenderSafe). Never-throw; real globals as defaults; the restore watcher is one-shot and self-disconnecting.

```js
  // ---------- L3: scroll preservation across a write→re-render ----------
  // Find the active Reading-view scroll container. Robust: try the known
  // reading-view selector, then a bare preview-view, then null. Never throws.
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
  // collapsing height, then repaints). Called by the task-complete handler and the
  // add path BEFORE the write that triggers the re-render. Fully injectable for tests.
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
        try { path = (typeof app !== 'undefined' && app.workspace && app.workspace.getActiveFile)
          ? (app.workspace.getActiveFile() || {}).path : null; } catch (_e) { path = null; }
      }
      win.__sauceScrollStash = { path: path || null, y: y, t: now };
      RenderSafe._installRestore(scroller, y, win);
      return win.__sauceScrollStash;
    } catch (_e) { return null; }
  }

  // Install a one-shot MutationObserver on the scroller that re-applies scrollTop=y
  // once the content has rebuilt past y, then disconnects. rAF + timeout fallbacks.
  static _installRestore(scroller, y, win) {
    try {
      const MO = win.MutationObserver;
      let done = false;
      const apply = () => {
        try {
          if (done) return;
          if ((Number(scroller.scrollHeight) || 0) >= y) {
            scroller.scrollTop = y;
            if (Math.abs((Number(scroller.scrollTop) || 0) - y) <= 2) { done = true; if (obs) obs.disconnect(); }
          }
        } catch (_e) { done = true; }
      };
      let obs = null;
      if (typeof MO === 'function') {
        obs = new MO(() => apply());
        try { obs.observe(scroller, { childList: true, subtree: true }); } catch (_e) {}
      }
      const raf = win.requestAnimationFrame || ((fn) => (win.setTimeout ? win.setTimeout(fn, 16) : null));
      raf(() => raf(apply));                 // double-rAF fallback
      if (win.setTimeout) win.setTimeout(() => { done = true; if (obs) try { obs.disconnect(); } catch (_e) {} }, 6000);
    } catch (_e) { /* never throw */ }
  }
```

> Note: RenderSafe stores an INSTANCE on `customJS.RenderSafe`; `captureScroll` is an instance method (callable as `customJS.RenderSafe.captureScroll(...)`). `_findScroller`/`_installRestore` are statics used internally + by tests.

- [ ] **Step 4: Run — expect PASS** `node platform/test/run-render-safe.js` → all green.
- [ ] **Step 5: Sync** source → `ranch/scripts/render-safe/render-safe.js` (`cp` or re-edit identically); re-run the harness. **Commit:** `git add -A && git commit -m "feat(render-safe): captureScroll — self-restoring scroll preservation primitive"`

---

## Task 2: L2 — optimistic row removal on complete

**Files:**
- Modify: `platform/mechanisms/task-entity/task-today-list.js` (checkbox `change` handler, ~L270–285)
- Test: `platform/test/run-task-entity.js` (RTR-4/5/6/7 + RTR-CAP)

- [ ] **Step 1: Write failing tests.** Extend the RTR-3 DOM stub so elements track `parentNode`/`children`/`insertBefore`/`remove`. Add a `RenderSafe` capture spy on `window.customJS`.

```js
// RTR-4..7 — optimistic removal. The DOM stub's createEl must set child.parentNode=el
// and push to el.children; remove() splices from parent.children; insertBefore(node,ref)
// inserts at ref's index (or end if ref null).
okAsync('RTR-4 complete removes the row immediately, before markDone resolves', async () => {
  const container = makeContainer();
  let resolveMD, removedAtCall = null;
  const TD = { markDone: () => { removedAtCall = (row.parentNode == null); return new Promise(r => { resolveMD = () => r({ ok: true }); }); } };
  const row = TaskTodayList.renderTaskRow(container, { title: 'x', path: 'spice/tasks/x.md' }, TD);
  const cb = findCheckbox(row);
  cb.checked = true; await cb._fire('change');   // handler runs; markDone pending
  assert(removedAtCall === true, 'row detached BEFORE markDone was awaited');
  resolveMD(); await tick();
  assert(row.parentNode == null, 'row stays removed on success');
});

okAsync('RTR-5 failure re-inserts the row at its original index + unchecks + Notice', async () => {
  const container = makeContainer();
  const sib = container.createEl('div');       // a sibling after the row to test index restore
  const TD = { markDone: async () => ({ ok: false, reason: 'collision' }) };
  const row = TaskTodayList.renderTaskRow(container, { title: 'x', path: 'p.md' }, TD);
  // move row before sib is already the case (row created first) — capture order
  const cb = findCheckbox(row); cb.checked = true; await cb._fire('change'); await tick();
  assert(row.parentNode === container, 're-inserted');
  assert(cb.checked === false, 'unchecked on failure');
  assert(lastNotice() && /complete/i.test(lastNotice()), 'Notice shown');
});

okAsync('RTR-6 markDone throwing re-inserts + unchecks (no unhandled rejection)', async () => {
  const container = makeContainer();
  const TD = { markDone: async () => { throw new Error('boom'); } };
  const row = TaskTodayList.renderTaskRow(container, { title: 'x', path: 'p.md' }, TD);
  const cb = findCheckbox(row); cb.checked = true; await cb._fire('change'); await tick();
  assert(row.parentNode === container && cb.checked === false, 'reverted on throw');
});

okAsync('RTR-7 cold-load (no TD) unchecks, no removal, no throw', async () => {
  const container = makeContainer();
  const row = TaskTodayList.renderTaskRow(container, { title: 'x', path: 'p.md' }, null);
  const cb = findCheckbox(row); cb.checked = true; await cb._fire('change'); await tick();
  assert(row.parentNode === container && cb.checked === false, 'no-op revert');
});

okAsync('RTR-CAP captureScroll is invoked before markDone', async () => {
  const container = makeContainer();
  let capturedBefore = null;
  global.window = global.window || {}; window.customJS = window.customJS || {};
  window.customJS.RenderSafe = { captureScroll: () => { capturedBefore = true; } };
  const TD = { markDone: async () => { assert(capturedBefore === true, 'captured before write'); return { ok: true }; } };
  const row = TaskTodayList.renderTaskRow(container, { title: 'x', path: 'p.md' }, TD);
  const cb = findCheckbox(row); cb.checked = true; await cb._fire('change'); await tick();
});
```

- [ ] **Step 2: Run — expect FAIL** `node platform/test/run-task-entity.js` (new RTR cases red; the stub helpers `makeContainer/findCheckbox/tick/lastNotice/_fire` may need adding — add them near RTR-3).
- [ ] **Step 3: Implement** — replace the `cb.addEventListener('change', …)` body (task-today-list.js ~L270):

```js
        cb.addEventListener('change', async () => {
            const TD = getTD();
            if (!path || !TD || typeof TD.markDone !== 'function') { cb.checked = false; return; }
            // Optimistic: preserve scroll, detach the row NOW (instant feedback),
            // then write. Re-insert at the original index on failure.
            try { window.customJS?.RenderSafe?.captureScroll?.(); } catch (_e) {}
            const parent = row.parentNode;
            const next = row.nextSibling;
            try { row.remove(); } catch (_e) {}
            try {
                const res = await TD.markDone(path);
                if (res && res.ok === false) {
                    if (parent) { try { parent.insertBefore(row, next); } catch (_e) {} }
                    cb.checked = false;
                    try { new Notice('Could not complete task: ' + (res.reason || 'unknown'), 6000); } catch (_e) {}
                }
            } catch (e) {
                if (parent) { try { parent.insertBefore(row, next); } catch (_e) {} }
                cb.checked = false;
                try { new Notice('Could not complete task: ' + (e && (e.message || e)), 6000); } catch (_e) {}
            }
        });
```

- [ ] **Step 4: Run — expect PASS** all RTR-* + RTR-1/2/3 regressions green.
- [ ] **Step 5: Sync** to the deployed copy (Task 0 path); re-run. **Commit:** `git commit -am "fix(task-entity): optimistic row removal on complete (instant feedback + revert)"`

---

## Task 3: L4 — metadataCache-gated reconcile after add

**Files:**
- Modify: `platform/mechanisms/task-entity/task-dialog.js` (`_create` tail + new `_reconcileAfterCreate`)
- Test: `platform/test/run-task-entity.js` (TD-REC-1..4)

- [ ] **Step 1: Failing tests** — drive `_create` / a direct `_reconcileAfterCreate` with a fake app exposing `metadataCache.on/off`, `commands.executeCommandById`, `vault.create`, and controllable timers.

```js
okAsync('TD-REC-1 _reconcileAfterCreate force-refreshes when the new file is indexed, then detaches', async () => {
  const calls = { cmd: [], on: 0, off: 0 };
  let handler = null;
  const app = {
    metadataCache: { on: (ev, fn) => { calls.on++; handler = { ev, fn }; return handler; }, offref: (h) => { calls.off++; } },
    commands: { executeCommandById: (id) => { calls.cmd.push(id); return true; } },
    workspace: { getActiveFile: () => ({ path: 'spice/tasks/x.md' }) },
  };
  const d = new TaskDialogClass();
  d._reconcileAfterCreate(app, 'spice/tasks/x.md');
  assert(calls.on === 1, 'listener registered');
  handler.fn({ path: 'spice/tasks/x.md' });   // file indexed
  assert(calls.cmd.includes('dataview:dataview-force-refresh-views'), 'force-refresh fired');
});

okAsync('TD-REC-2 timeout fallback force-refreshes if the event never fires', async () => {
  // Use an injectable timer: _reconcileAfterCreate reads app._setTimeout if present.
  const calls = [];
  const app = { metadataCache: { on: () => ({}), offref: () => {} },
    commands: { executeCommandById: (id) => calls.push(id) },
    _setTimeout: (fn) => fn() };            // fire immediately
  new TaskDialogClass()._reconcileAfterCreate(app, 'p.md');
  assert(calls.includes('dataview:dataview-force-refresh-views'), 'fallback fired');
});

okAsync('TD-REC-3 absent commands API → no throw', async () => {
  const app = { metadataCache: { on: () => ({}), offref: () => {} } };
  new TaskDialogClass()._reconcileAfterCreate(app, 'p.md');  // must not throw
  assert(true, 'no throw');
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** Add call at `_create` tail (after `new Notice('Task created')`): `try { this._reconcileAfterCreate(app, path); } catch (_e) {}`. Add the method:

```js
    /**
     * L4: after a create, reconcile the surface WITHOUT waiting for Dataview's
     * ~2.5s tick. Gate a force-refresh on the metadataCache 'changed' for the new
     * file (so it never runs against a stale index), with a timeout fallback.
     * Preserves scroll first. Never throws; degrades to the natural refresh.
     */
    _reconcileAfterCreate(app, path) {
        try { (typeof window !== 'undefined' && window.customJS?.RenderSafe?.captureScroll?.()); } catch (_e) {}
        try {
            if (!app) return;
            const fire = () => { try { app.commands && app.commands.executeCommandById
                && app.commands.executeCommandById('dataview:dataview-force-refresh-views'); } catch (_e) {} };
            let done = false;
            const off = () => { done = true; try { ref && app.metadataCache.offref && app.metadataCache.offref(ref); } catch (_e) {} };
            let ref = null;
            if (app.metadataCache && typeof app.metadataCache.on === 'function') {
                ref = app.metadataCache.on('changed', (f) => {
                    if (done) return;
                    if (f && f.path === path) { fire(); off(); }
                });
            }
            const setT = app._setTimeout || (typeof window !== 'undefined' && window.setTimeout) || setTimeout;
            setT(() => { if (done) return; fire(); off(); }, 1200);
        } catch (_e) { /* never throw */ }
    }
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Sync** deployed copy; re-run. **Commit:** `git commit -am "fix(task-entity): reconcile after add via metadataCache-gated Dataview force-refresh"`

---

## Task 4: L10 — no self-reopen of the active note on create/edit

**Files:**
- Modify: `platform/blueprints/to-do/helpers/todo-create-task.js` (`_submit` L601–605, `_submitEdit` L552–560)
- Test: `platform/test/run-todo-dialog.js` (TDLG-REOPEN-1/2)

- [ ] **Step 1: Failing tests** — drive `_submit`/`_submitEdit` with a fake `window.app` whose `workspace.getActiveFile()` is controllable and whose `getLeaf().openFile` is a spy.
```js
// TDLG-REOPEN-1: destination == active file → openFile NOT called.
// TDLG-REOPEN-2: destination != active file → openFile IS called.
// (Follow run-todo-dialog.js's existing app-stub + _submit invocation pattern.)
```
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** `_submit` (L601): 
```js
        if (payload.mode !== 'recurring') {
            const cur = window.app.workspace.getActiveFile && window.app.workspace.getActiveFile();
            if (!cur || cur.path !== file.path) {
                const leaf = window.app.workspace.getLeaf(false);
                await leaf.openFile(file);
                window.customJS.OpenHelpers?.forceLeafPreview?.(leaf);
            }
        }
```
`_submitEdit` (L552): before opening, `const cur = window.app.workspace.getActiveFile && window.app.workspace.getActiveFile(); if (cur && cur.path === editExisting.filePath) return;` (place after the `if (!file) return;` guard, before `getLeaf`).
- [ ] **Step 4: Run — expect PASS** (+ regression: run-todo-dialog 84 baseline stays green).
- [ ] **Step 5: Sync** `ranch/scripts/to-do/todo-create-task.js`; re-run. **Commit:** `git commit -am "fix(to-do): don't self-reopen the active note on create/edit (kills scroll-to-top)"`

---

## Task 5: L-HOME — Home day-refresh watcher

**Files:**
- Modify: `platform/blueprints/home/helpers/space-home.js` (`render()` + new static `_shouldDayRefresh`)
- Test: `platform/test/run-home.js` (HOME-DAY-1/2/3)

- [ ] **Step 1: Failing tests.**
```js
ok('HOME-DAY-1 _shouldDayRefresh true iff Home leaf + day changed', () => {
  const H = 'spice/home/Home.md';
  assert(SpaceHome._shouldDayRefresh(H, '2026-07-03', '2026-07-04') === true, 'home + new day');
  assert(SpaceHome._shouldDayRefresh(H, '2026-07-04', '2026-07-04') === false, 'same day');
  assert(SpaceHome._shouldDayRefresh('spice/x.md', '2026-07-03', '2026-07-04') === false, 'not home');
  assert(SpaceHome._shouldDayRefresh(null, 'a', 'b') === false, 'null path safe');
});
// HOME-DAY-2: after render(dv), window.__sauceHomeRenderDay === today AND a single
//   workspace.on('active-leaf-change') listener exists after N renders (dedup).
// HOME-DAY-3: invoking that listener with the Home active + a changed day calls
//   executeCommandById('dataview:dataview-force-refresh-views'); same-day → no call;
//   missing moment/commands → no throw.
```
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** Add static:
```js
  static _shouldDayRefresh(activePath, renderDay, today) {
    return !!activePath && activePath === 'spice/home/Home.md' && !!renderDay && !!today && renderDay !== today;
  }
```
In `render()`, after `const today = …`:
```js
    try {
      const w = (typeof window !== 'undefined' && window) || null;
      if (w) {
        w.__sauceHomeRenderDay = today;
        const A = (typeof app !== 'undefined' && app) || w.app || null;
        if (A && A.workspace && typeof A.workspace.on === 'function' && !w.__sauceHomeDayWatcher) {
          w.__sauceHomeDayWatcher = A.workspace.on('active-leaf-change', () => {
            try {
              const M2 = (typeof moment !== 'undefined' && moment) || w.moment || null;
              const now = M2 ? M2().format('YYYY-MM-DD') : '';
              const af = A.workspace.getActiveFile && A.workspace.getActiveFile();
              const p = af && af.path;
              if (SpaceHome._shouldDayRefresh(p, w.__sauceHomeRenderDay, now)) {
                A.commands && A.commands.executeCommandById
                  && A.commands.executeCommandById('dataview:dataview-force-refresh-views');
              }
            } catch (_e) { /* never throw */ }
          });
        }
      }
    } catch (_e) { /* never throw */ }
```
(For HOME-DAY-2/3 testability, the harness sets `global.window`/`global.app` stubs with a spying `workspace.on`, `getActiveFile`, `commands.executeCommandById`, and a `moment` stub; render is already exercised by HOME-RENDER.)
- [ ] **Step 4: Run — expect PASS** (+ HOME-DATE/GLANCE/RENDER regressions green).
- [ ] **Step 5: Sync** `ranch/scripts/home/space-home.js`; re-run. **Commit:** `git commit -am "fix(home): re-render on new-day re-activation (kills the frozen-Friday snapshot)"`

---

## Task 6: L3 real-browser certification (Playwright)

**Files:** Create `.playwright-mcp/scroll-harness.html` (git-ignored scratch).

- [ ] **Step 1:** Build an HTML page: a `.markdown-preview-view` scroller (fixed height, `overflow:auto`) containing tall content + a "task block" div. Inline the REAL `RenderSafe._findScroller`/`captureScroll`/`_installRestore` from source (copy verbatim). A button: scroll to 800, call `captureScroll({win:window,doc:document,now:Date.now(),activePath:'x'})`, then after 50ms clear the task block (`innerHTML=''`) and after another 120ms rebuild it (restoring height). 
- [ ] **Step 2:** `python3 -m http.server` in `.playwright-mcp`; Playwright MCP `browser_navigate` to it (file:// is blocked), click the button, `browser_evaluate` to read `scroller.scrollTop` after rebuild.
- [ ] **Step 3:** Assert final `scrollTop === 800` (restored). Screenshot for the record. **No commit** (scratch); note the result in the PR body.

---

## Task 7: Full preflight, dogfood, and bumped-state gate

- [ ] **Step 1:** `npm run release:preflight` → all green (fix any harness the changes touched).
- [ ] **Step 2:** `npm run status` (workshop dogfood) → clean.
- [ ] **Step 3:** On a CLEAN tree: `npm run release:preflight-bumped` → green (guards the post-merge release wedge). If it complains about a dirty tree, commit first.
- [ ] **Step 4:** Confirm no hardcoded version literals were added to any test (`git diff origin/main -- platform/test | grep -nE '"[0-9]+\.[0-9]+\.[0-9]+"'` → none new).

---

## Task 8: PR, CI, merge, release, deploy

- [ ] **Step 1:** `git merge origin/main` (absorb autoloop churn) → re-run preflight if it moved.
- [ ] **Step 2:** Push branch; open PR titled `fix(task-entity): seamless task actions — optimistic complete, scroll-hold, add-reconcile, no self-reopen + home day-refresh`. Body: the 5 levers, the design/plan links, the Playwright cert result, the test additions. End with the Claude co-author trailer.
- [ ] **Step 3:** Wait for `preflight (macos-latest)` + `preflight (ubuntu-latest)` to pass. If BEHIND: `gh pr update-branch` / re-merge origin/main.
- [ ] **Step 4:** Merge the FEATURE PR (`gh pr merge --squash`). Do NOT touch the auto-opened release PR.
- [ ] **Step 5:** Monitor `release.yml`: release PR auto-merges → `tag-and-ship` tags `v<X.Y.Z>` + auto-merges the tap PR. Intervene ONLY if the tap PR stalls (then merge it).
- [ ] **Step 6:** `git fetch --tags`; `node scripts/autoloop/deploy.js run` (ensure `sauce` on PATH / `/opt/homebrew/bin`). Verify `allOk:true` and all three vaults report the new version. Re-run if `brew update` transiently failed.
- [ ] **Step 7:** Confirm each vault's live `space-home.js` / task-entity copy matches the shipped version; report back with the version + deploy JSON.

---

## Self-review notes
- Coverage: L2✓(T2) L3✓(T1+T6) L4✓(T3) L10✓(T4) L-HOME✓(T5); sync✓(each T5-step); ship✓(T7-T8).
- No version literals in new tests (T7-S4 gate).
- Symbol consistency: `captureScroll`, `_findScroller`, `_installRestore`, `_reconcileAfterCreate`, `_shouldDayRefresh`, stash `window.__sauceScrollStash`, `window.__sauceHomeRenderDay`, `window.__sauceHomeDayWatcher`, command id `dataview:dataview-force-refresh-views` — used identically across tasks.
