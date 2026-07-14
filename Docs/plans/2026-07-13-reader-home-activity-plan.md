# Reader Everywhere Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate reader's "New article" onto the nav button (drop the legacy button), hide search hashtags, add an Article item to the Home `+` capture menu, surface reader activity (added / reading / read) in the daily Activity panel, and relax the title validation that rejected `/`.

**Architecture:** All changes live in blueprint helpers (`reader`, `home`, `daily`) consuming EXISTING mechanism options — `DocSearch.hideTags`, `ActivityFeed` `blueprints`/`colorByType`/`groupLabels`/`tsKeys`/`precomputed`, `EntityCreate`. No mechanism (`ActivityFeed`/`DocSearch`/`EntityCreate`) is modified. Reader Activity reuses the ActivityFeed group styling; "always show reading" is achieved by unioning reading articles into the dashboard's precomputed page set.

**Tech Stack:** CustomJS bare-class helpers (Node-tested statics), Obsidian Dataview, Node test harnesses (`platform/test/run-*.js`).

**Design doc:** `Docs/plans/2026-07-13-reader-home-activity-design.md`

**Landmine compliance (every code task):** bare-class-only files (no trailing statements); cold-load safety (guards via `window.customJS?.X`/`customJS?.X`, never throw); `{{template_variables}}` for paths; JSON-not-YAML for manifests; no manual version bumps (conventional commits only). Each edited helper is re-checked by `run-validator`/`run-customjs-loadable` in preflight.

---

### Task 1: Relax `validateTitle` so `/`-bearing titles work

**Files:**
- Modify: `platform/blueprints/reader/helpers/reader-article-paste.js` (`validateTitle`)
- Modify: `platform/test/run-reader-article-paste.js` (HC-READER-PASTE-7)

- [ ] **Step 1: Update the failing test (flip PASTE-7b, add all-invalid case).** In `run-reader-article-paste.js`, replace the `HC-READER-PASTE-7` block (currently asserts `a/b`, `bad:name`, `q?mark` → error) with:

```javascript
// ---------------------------------------------------------------------------
// HC-READER-PASTE-7 — validateTitle: required + non-empty-after-sanitize only.
// Filesystem-hostile chars are ALLOWED (filename sanitizes downstream; the
// frontmatter title keeps the original — see the /-in-title clip case).
// ---------------------------------------------------------------------------
{
  ok('HC-READER-PASTE-7a empty/whitespace/null title → error',
     typeof ReaderArticlePaste.validateTitle('') === 'string' &&
     typeof ReaderArticlePaste.validateTitle('   ') === 'string' &&
     typeof ReaderArticlePaste.validateTitle(null) === 'string');
  ok('HC-READER-PASTE-7b filesystem chars are ALLOWED (valid) now',
     ReaderArticlePaste.validateTitle('a/b') === null &&
     ReaderArticlePaste.validateTitle('Race Condition in hyper’s HTTP/1 Implementation') === null &&
     ReaderArticlePaste.validateTitle('bad:name') === null);
  ok('HC-READER-PASTE-7c ordinary title → null (valid)',
     ReaderArticlePaste.validateTitle('The Bitter Lesson') === null &&
     ReaderArticlePaste.validateTitle('A note, with punctuation!') === null);
  ok('HC-READER-PASTE-7d all-invalid title (sanitizes to empty) → error',
     typeof ReaderArticlePaste.validateTitle('///') === 'string' &&
     typeof ReaderArticlePaste.validateTitle(':*?') === 'string');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-reader-article-paste.js`
Expected: FAIL — 7b now expects `a/b` → null but current code returns an error string.

- [ ] **Step 3: Implement the relaxed `validateTitle`.** Replace the method body in `reader-article-paste.js`:

```javascript
    static validateTitle(title) {
        if (typeof title !== 'string' || title.trim() === '') return 'Article title is required.';
        // Filesystem-hostile chars are allowed: the manifest filename_prefix uses
        // |sanitize-filename (strips them) and the frontmatter keeps the original
        // title. Only reject a title that sanitizes to nothing (would yield an
        // empty filename).
        const sanitized = title.replace(/[\\/:*?"<>|]/g, '').trim();
        if (sanitized === '') return 'Article title needs at least one letter or number.';
        return null;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-reader-article-paste.js`
Expected: PASS — all HC-READER-PASTE assertions green (count = prior total, unchanged structure).

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/reader/helpers/reader-article-paste.js platform/test/run-reader-article-paste.js
git commit -m "fix(reader): allow filesystem chars in article title (filename sanitizes downstream)"
```

---

### Task 2: Nav "New article" opens the paste dialog

**Files:**
- Modify: `platform/blueprints/reader/helpers/reader-chrome-bar.js` (`dispatch` `new-article` arm)
- Modify: `platform/test/run-reader-chrome-bar.js` (RCB-DISPATCH-1)

- [ ] **Step 1: Update the test.** In `run-reader-chrome-bar.js`, the block that stubs `customJS` and asserts `RCB-DISPATCH-1 new-article → EntityCreate.create`. Add a `ReaderArticlePaste` spy to the stub and assert the dialog is preferred. Replace the stub + RCB-DISPATCH-1 assertion so it reads:

```javascript
      const calls = [];
      const paste = [];
      global.customJS = {
        ChromeBar: { makeAdapter: (c) => c, render: () => {}, openNavTarget: () => {} },
        EntityCreate: { create: (o) => calls.push({ create: o.instance }) },
        ReaderArticlePaste: { open: () => paste.push(true) },
        ReaderArticleActions: { statusTransitions: () => [], _setStatus: () => {} },
      };
      cfg.dispatch(dv, { context: 'reader-hub' }, 'new-article');
      // ... existing open-article / status-archived dispatch calls stay ...
      ok('RCB-DISPATCH-1 new-article → ReaderArticlePaste.open (paste dialog), not EntityCreate',
         paste.length === 1 && !calls.some(c => c.create === 'reader-article'));
```

Then add a fallback assertion right after (new id RCB-DISPATCH-1b): with `ReaderArticlePaste` absent, `new-article` falls back to `EntityCreate.create`:

```javascript
      const calls2 = [];
      global.customJS = {
        ChromeBar: { makeAdapter: (c) => c, render: () => {}, openNavTarget: () => {} },
        EntityCreate: { create: (o) => calls2.push({ create: o.instance }) },
        ReaderArticleActions: { statusTransitions: () => [], _setStatus: () => {} },
      };
      cfg.dispatch(dv, { context: 'reader-hub' }, 'new-article');
      ok('RCB-DISPATCH-1b new-article falls back to EntityCreate when paste helper absent',
         calls2.some(c => c.create === 'reader-article'));
```

(If the harness reuses a single `customJS` set up earlier, adapt to its structure — the assertion intent is what matters: paste preferred, EntityCreate fallback.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-reader-chrome-bar.js`
Expected: FAIL — RCB-DISPATCH-1 now expects `paste.length === 1` but current dispatch calls `EntityCreate.create`.

- [ ] **Step 3: Implement the dispatch change.** In `reader-chrome-bar.js` `_config().dispatch`, replace the `new-article` arm:

```javascript
        if (id === "new-article") {
          if (customJS && customJS.ReaderArticlePaste && typeof customJS.ReaderArticlePaste.open === "function") {
            customJS.ReaderArticlePaste.open(dv); return;
          }
          if (customJS && customJS.EntityCreate && typeof customJS.EntityCreate.create === "function") {
            customJS.EntityCreate.create({ instance: "reader-article", dv });
          } else if (typeof Notice === "function") { new Notice("ReaderChromeBar: create unavailable — reinstall reader blueprint.", 6000); }
          return;
        }
```

Also update the class header comment line referencing the `+ New article` button dispatching to "the same EntityCreate call ReaderArticleActions.renderCreateRow already uses (which stays active…)" — change it to note the nav button now opens `ReaderArticlePaste.open` and `renderCreateRow` is removed.

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-reader-chrome-bar.js`
Expected: PASS — including RCB-DISPATCH-1 + 1b.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/reader/helpers/reader-chrome-bar.js platform/test/run-reader-chrome-bar.js
git commit -m "feat(reader): nav New article opens the paste dialog"
```

---

### Task 3: Remove the legacy `renderCreateRow` button + hide search hashtags

**Files:**
- Modify: `platform/blueprints/reader/helpers/reader-queue.js` (remove `renderCreateRow` call; add `hideTags`)
- Modify: `platform/blueprints/reader/helpers/reader-article-actions.js` (remove `renderCreateRow` method + instance delegator)
- Modify: `platform/test/run-reader.js` (drop/replace any `renderCreateRow` reference)

- [ ] **Step 1: Check for test references.**

Run: `grep -n "renderCreateRow" platform/test/run-reader.js platform/test/run-reader-render-guards.js 2>/dev/null`
Expected: note each hit. If a test asserts `renderCreateRow` exists or renders a row, it must be removed/replaced in Step 5. (If zero hits, no test change needed beyond the new negative assertion in Step 5.)

- [ ] **Step 2: Remove the `renderCreateRow` call in `reader-queue.js`.** Delete the block (around lines 135-143):

```javascript
        // separate ReaderArticleActions dataviewjs block; keeping it in THIS block
        // (like WikiTree hosts WikiHubActions) makes the button↔search gap tight.
        // If ReaderArticleActions is cold, the search + queue below still render.
        try {
            const RAA = window.customJS && window.customJS.ReaderArticleActions;
            if (RAA && typeof RAA.renderCreateRow === 'function') {
                RAA.renderCreateRow(dv);
            }
        } catch (_e) { /* create button is best-effort */ }

```

(Delete the whole block including its comment. The nav chrome-bar is now the sole create entry.)

- [ ] **Step 3: Add `hideTags: true` to the DocSearch call in `reader-queue.js`.** Change the `DocSearch.render(dv, { … })` options object to include `hideTags: true`:

```javascript
        const ctx = DocSearch.render(dv, {
            scopePath: 'spice/reader',
            recursive: false,
            entityType: 'reader-article',
            persist: false,
            hideTags: true,
            onChange: (c) => {
                c.resultsContainer.empty();
                this._renderResults(dv, c.resultsContainer, c);
            },
        });
```

- [ ] **Step 4: Remove `renderCreateRow` from `reader-article-actions.js`.** Delete the static `renderCreateRow(dv)` method (the "Static create-button row" block, ~lines 88-133) AND its instance delegator (`renderCreateRow(dv) { return ReaderArticleActions.renderCreateRow(dv); }`). Update the class header comment that documents `renderCreateRow` (remove that bullet; note the nav chrome-bar owns article creation now). Keep `_mobilize` and all other helpers (still used by `render`). Do NOT introduce any trailing statement — the file stays one bare class.

- [ ] **Step 5: Update `run-reader.js`.** Remove any assertion referencing `renderCreateRow` found in Step 1. Add a negative assertion (place near the other ReaderArticleActions API checks):

```javascript
ok('HC-READER-NOCREATEROW ReaderArticleActions no longer exposes renderCreateRow (nav owns create)',
   typeof ReaderArticleActions.renderCreateRow === 'undefined' &&
   typeof (new ReaderArticleActions()).renderCreateRow === 'undefined');
```

- [ ] **Step 6: Run reader harnesses**

Run: `node platform/test/run-reader.js && node platform/test/run-reader-chrome-bar.js`
Expected: PASS both. If `run-reader-render-guards.js` exists and referenced `renderCreateRow`, also run it: `node platform/test/run-reader-render-guards.js` → PASS.

- [ ] **Step 7: Commit**

```bash
git add platform/blueprints/reader/helpers/reader-queue.js platform/blueprints/reader/helpers/reader-article-actions.js platform/test/run-reader.js
git commit -m "feat(reader): drop legacy New-article button + hide search hashtags"
```

---

### Task 4: Stamp `status_changed_at` on reader status changes

**Files:**
- Modify: `platform/blueprints/reader/helpers/reader-article-actions.js` (`_setStatus`)
- Modify: `platform/test/run-reader.js` (source-structure guard)

- [ ] **Step 1: Add a source-structure guard test.** In `run-reader.js`, add:

```javascript
{
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'blueprints', 'reader', 'helpers', 'reader-article-actions.js'), 'utf8');
  ok('HC-READER-STATUSTS _setStatus stamps status_changed_at alongside status',
     /fm\.status\s*=\s*next/.test(src) && /status_changed_at/.test(src));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-reader.js`
Expected: FAIL — `status_changed_at` not yet in the source.

- [ ] **Step 3: Implement.** In `reader-article-actions.js` `_setStatus`, change the `processFrontMatter` callback from `(fm) => { fm.status = next; }` to also stamp the timestamp:

```javascript
            await appRef.fileManager.processFrontMatter(file, (fm) => {
                fm.status = next;
                try { fm.status_changed_at = new Date().toISOString(); } catch (_e) {}
            });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-reader.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/reader/helpers/reader-article-actions.js platform/test/run-reader.js
git commit -m "feat(reader): stamp status_changed_at on article status changes"
```

---

### Task 5: Home `+` capture — add "Article"

**Files:**
- Modify: `platform/blueprints/home/helpers/space-home.js` (`_captureSpec`, `_dispatch`)
- Modify: `platform/test/run-home.js` (HOME-CAP)

- [ ] **Step 1: Update the test.** In `run-home.js`, the HOME-CAP block asserting `_captureSpec()` shape. Update the expected button set to include `article`, and add a dispatch assertion. Replace/extend the relevant assertions:

```javascript
{
  const spec = SpaceHome._captureSpec();
  const keys = spec.map((s) => s.key);
  assertEq("HOME-CAP-1 capture keys include meeting/sticky-note/article", JSON.stringify(keys), JSON.stringify(["meeting", "sticky-note", "article"]));
  const art = spec.find((s) => s.key === "article");
  ok("HOME-CAP-1b article entry has a label + icon", !!art && /Article/.test(art.label) && typeof art.icon === "string" && art.icon.length > 0);
}
{
  // article dispatch → ReaderArticlePaste.open(dv); guarded no-op when absent.
  const opened = [];
  const prev = global.customJS;
  global.customJS = { ReaderArticlePaste: { open: (dv) => opened.push(true) } };
  let threw = false;
  try { SpaceHome._dispatch("article", { container: {} }, "2026-07-13"); } catch (_e) { threw = true; }
  global.customJS = {};
  let threw2 = false;
  try { SpaceHome._dispatch("article", { container: {} }, "2026-07-13"); } catch (_e) { threw2 = true; } // absent → no throw
  global.customJS = prev;
  ok("HOME-CAP-ART dispatch(article) opens paste dialog + no-ops (no throw) when absent",
     opened.length === 1 && !threw && !threw2);
}
```

(If HOME-CAP already asserts a specific `_captureSpec` length/shape, reconcile with the above — the intent: 3 keys ending in `article`, and `_dispatch("article",…)` routes to `ReaderArticlePaste.open`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-home.js`
Expected: FAIL — `_captureSpec` returns 2 keys (no `article`); `_dispatch("article")` no-ops without calling the spy.

- [ ] **Step 3: Add the `article` capture entry.** In `space-home.js` `_captureSpec()`, append after the sticky-note entry (inside the returned array):

```javascript
      { key: "article", label: "＋ Article", icon: svg(`<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>`) },
```

- [ ] **Step 4: Add the `article` dispatch arm.** In `space-home.js` `_dispatch(key, dv, today)`, add before the `catch`:

```javascript
      if (key === "article") {
        if (cjs && cjs.ReaderArticlePaste && typeof cjs.ReaderArticlePaste.open === "function") {
          cjs.ReaderArticlePaste.open(dv);
        } else if (typeof Notice === "function") {
          new Notice("Reader paste dialog unavailable — reinstall reader blueprint.", 6000);
        }
        return;
      }
```

Update the `_dispatch` header comment's grep-verified entrypoint list to include `article → customJS.ReaderArticlePaste.open({ dv })`.

- [ ] **Step 5: Run test to verify it passes**

Run: `node platform/test/run-home.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add platform/blueprints/home/helpers/space-home.js platform/test/run-home.js
git commit -m "feat(home): add Article to the quick-capture menu (opens paste dialog)"
```

---

### Task 6: `selectReadingArticles` pure static (always-show reading)

**Files:**
- Modify: `platform/blueprints/daily/helpers/space-daily-dashboard.js` (new static)
- Modify: `platform/test/run-daily-dashboard.js` (new assertions)

- [ ] **Step 1: Write the failing test.** In `run-daily-dashboard.js`, add (mirroring how it stubs dv for `selectMeetings`/`selectUpcomingTrips`):

```javascript
// ---------------------------------------------------------------------------
// SELREAD — selectReadingArticles returns only status:reading reader-articles.
// ---------------------------------------------------------------------------
{
  const mk = (title, status, extra) => Object.assign(
    { type: 'reader-article', title, status, file: { path: 'spice/reader/' + title + '.md' } }, extra || {});
  const pages = [
    mk('R1', 'reading'),
    mk('U1', 'unread'),
    mk('A1', 'archived'),
    mk('R2', 'reading'),
    Object.assign(mk('NotReader', 'reading'), { type: 'wiki-page' }),
  ];
  // Plain-array dv stub (Node): .pages() returns an array with .where/.array shims.
  const dv = makeReadingDv(pages); // helper below
  const got = SpaceDailyDashboard.selectReadingArticles(dv).map((p) => p.title).sort();
  assertEq('SELREAD-1 only status:reading reader-articles', JSON.stringify(got), JSON.stringify(['R1', 'R2']));

  let threw = false;
  try { SpaceDailyDashboard.selectReadingArticles(null); SpaceDailyDashboard.selectReadingArticles({}); }
  catch (_e) { threw = true; }
  ok('SELREAD-2 null/empty dv → [] never throws', !threw &&
     SpaceDailyDashboard.selectReadingArticles(null).length === 0);
}
```

Add the `makeReadingDv` helper near the top of the file (or reuse the existing dv-stub pattern the file already defines for `selectMeetings` — if one exists, use it and drop this helper):

```javascript
function makeReadingDv(pages) {
  const arr = pages.slice();
  const wrap = (a) => ({
    where: (fn) => wrap(a.filter(fn)),
    array: () => a.slice(),
    slice: () => a.slice(),
    filter: (fn) => a.filter(fn),
    map: (fn) => a.map(fn),
    length: a.length,
  });
  return { pages: (src) => wrap(arr) };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-daily-dashboard.js`
Expected: FAIL — `selectReadingArticles` undefined.

- [ ] **Step 3: Implement the static.** Add to `space-daily-dashboard.js` (near `selectMeetings`/`selectUpcomingTrips`):

```javascript
  /**
   * All reader-articles currently in the "reading" state, regardless of when
   * they were last touched — the daily Activity panel always surfaces
   * in-progress reading (unioned into the activity page set by render). Pure +
   * Node-testable: supports both a real Dataview DataArray (.where().array())
   * and a plain-array stub. Never throws; missing folder / no pages → [].
   */
  static selectReadingArticles(dv) {
    try {
      if (!dv || typeof dv.pages !== "function") return [];
      const src = dv.pages('"spice/reader"');
      const isReading = (p) => p && p.type === "reader-article" &&
        String(p.status == null ? "" : p.status).trim().toLowerCase() === "reading";
      if (src && typeof src.where === "function") {
        const out = src.where(isReading);
        return (out && typeof out.array === "function") ? out.array() : Array.from(out || []);
      }
      const arr = Array.isArray(src) ? src : Array.from(src || []);
      return arr.filter(isReading);
    } catch (_e) { return []; }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-daily-dashboard.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/daily/helpers/space-daily-dashboard.js platform/test/run-daily-dashboard.js
git commit -m "feat(daily): selectReadingArticles for always-show reading in Activity"
```

---

### Task 7: Wire reader into the Activity panel (opts + union + status pill)

**Files:**
- Modify: `platform/blueprints/daily/helpers/space-daily-dashboard.js`
- Modify: `platform/test/run-daily-dashboard.js`

- [ ] **Step 1: Write failing tests for the opts + meta.** In `run-daily-dashboard.js`, add:

```javascript
// ---------------------------------------------------------------------------
// READER-ACT — reader-article surfaced in Activity opts + status pill in meta.
// ---------------------------------------------------------------------------
{
  const inst = new SpaceDailyDashboard();
  const bp = inst._DEFAULT_DASHBOARD_BLUEPRINTS;
  ok('READER-ACT-1 reader-article in Activity allowlist', bp.indexOf('reader-article') !== -1);
  const colors = inst._BLUEPRINT_COLORS;
  ok('READER-ACT-2 reader-article has an accent color', typeof colors['reader-article'] === 'string' && colors['reader-article'].length > 0);
  const opts = inst._buildActivityOpts({ pages: () => ({ where: () => ({ array: () => [] }) }) }, '2026-07-13', { square: '', activity: '' });
  ok('READER-ACT-3 captured_at added to tsKeys', Array.isArray(opts.tsKeys) && opts.tsKeys.indexOf('captured_at') !== -1);
  ok('READER-ACT-4 Reader group label present', opts.groupLabels && opts.groupLabels['reader-article'] === 'Reader');
}
{
  // metaBuilder renders a status word (Added/Reading/Read) for reader-article,
  // and nothing reader-specific for other types.
  const inst = new SpaceDailyDashboard();
  const mkEl = () => { const kids = []; const el = { className: '', innerHTML: '', createEl: (t) => { const c = { tag: t, textContent: '', className: '', style: {}, createEl: mkEl().createEl }; kids.push(c); return c; }, _kids: kids, get text() { return kids.map(k => k.textContent).join('|'); } }; return el; };
  const readEl = mkEl();
  inst._renderActivityMeta({ type: 'reader-article', status: 'reading', file: { mtime: 0 } }, readEl, '', '');
  ok('READER-ACT-5 reader card meta shows a Reading label', /Reading/.test(readEl.text));
  const readEl2 = mkEl();
  inst._renderActivityMeta({ type: 'reader-article', status: 'archived', file: { mtime: 0 } }, readEl2, '', '');
  ok('READER-ACT-6 archived reader card meta shows Read', /Read/.test(readEl2.text));
}
```

(If the file's DOM-stub helper differs, reuse the existing one it already uses to test `_renderActivityMeta`/`_renderTodoBadge`; the intent is: reader pill shows Added/Reading/Read.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-daily-dashboard.js`
Expected: FAIL — reader-article not in allowlist; no reader status label in meta.

- [ ] **Step 3: Add reader to the allowlist.** In `_DEFAULT_DASHBOARD_BLUEPRINTS` (the returned array), add `"reader-article"` (place after the wiki/doc-note group):

```javascript
      "wiki-page", "wiki-section", "doc-note", "reader-article",
```

- [ ] **Step 4: Add the reader accent color.** In `_BLUEPRINT_COLORS`, add under the "Activity-feed groups" section:

```javascript
      "reader-article": "var(--color-cyan)",
```

- [ ] **Step 5: Add group label + `captured_at` tsKey.** In `_buildActivityOpts`'s returned opts:
  - `groupLabels` — add `"reader-article": "Reader"` (keep existing `"sticky-note"`/`"wiki"`):
    ```javascript
    groupLabels: { "sticky-note": "Sticky Notes", "wiki": "Wiki", "reader-article": "Reader" },
    ```
  - `tsKeys` — append `"captured_at"`:
    ```javascript
    tsKeys: ["day", "created_at", "status_changed_at", "captured_at"],
    ```
  - `groupOrder` — include reader after wiki:
    ```javascript
    groupOrder: ["cowork", "project", "wiki", "reader-article", "kanban", "trip"],
    ```

- [ ] **Step 6: Union reading articles into the activity page set.** In `render()`, right after `activityPages` is assigned from `ActivityFeed.query(...)` (the block around lines 440-448), union in reading articles not already present, BEFORE `const activityCount = …`:

```javascript
    // Always-show in-progress reading: union reader-articles with status:reading
    // that the today-scoped query didn't already include (dedup by file.path).
    try {
      const reading = SpaceDailyDashboard.selectReadingArticles(dv);
      if (reading.length) {
        const seen = new Set(activityPages.map((p) => (p && p.file && p.file.path) || ""));
        for (const r of reading) {
          const key = (r && r.file && r.file.path) || "";
          if (key && !seen.has(key)) { activityPages.push(r); seen.add(key); }
        }
      }
    } catch (_e) { /* reading union is best-effort */ }
```

(The existing `precomputed: { pages: activityPages }` handed to `ActivityFeed.render` at ~line 721 picks these up unchanged. `activityCount = activityPages.length` now includes them, driving the gate + "Reader" count pill.)

- [ ] **Step 7: Status pill in `_renderActivityMeta`.** Replace the "Type pill" block so `reader-article` shows a status word + status color instead of the raw type string:

```javascript
    // Type pill (reader-article shows a status word: Added / Reading / Read)
    const type = p && p.type ? String(p.type) : null;
    if (type) {
      const pill = parentEl.createEl("span");
      pill.className = "sauce-pill";
      const dot = pill.createEl("span");
      dot.className = "sauce-pill-dot";
      const colorMap = this._BLUEPRINT_PILL_COLORS;
      let pillText = type;
      let dotColor = (colorMap && colorMap[type]) || "var(--color-base-50)";
      if (type === "reader-article") {
        const st = String(p.status == null ? "unread" : p.status).trim().toLowerCase();
        if (st === "reading") { pillText = "Reading"; dotColor = "var(--interactive-accent)"; }
        else if (st === "archived") { pillText = "Read"; dotColor = "var(--color-green)"; }
        else { pillText = "Added"; dotColor = "var(--color-orange)"; }
      }
      dot.style.background = dotColor;
      const label = pill.createEl("span");
      label.textContent = pillText;
    }
```

Also update the timestamp source so reader rows prefer their own timestamps — change the `tsRaw` line to:

```javascript
    // Time stamp (reader: status_changed_at → captured_at; else created_at → mtime)
    const tsRaw = (p && p.type === "reader-article")
      ? (p.status_changed_at || p.captured_at || p.created_at || (p.file && p.file.mtime))
      : (p && (p.created_at || (p.file && p.file.mtime)));
```

- [ ] **Step 8: Run test to verify it passes**

Run: `node platform/test/run-daily-dashboard.js`
Expected: PASS — READER-ACT-1..6 green.

- [ ] **Step 9: Commit**

```bash
git add platform/blueprints/daily/helpers/space-daily-dashboard.js platform/test/run-daily-dashboard.js
git commit -m "feat(daily): surface reader articles (added/reading/read) in Activity panel"
```

---

### Task 8: Schema lint + full preflight + dogfood

**Files:** none (verification)

- [ ] **Step 1: Lint schemas.**

Run: `npm run lint-schemas`
Expected: PASS (no schema-index change was needed for `status_changed_at`; the reader entry is a type-validating rule-fragment). If it fails referencing reader, read the message and add the field per `Docs/agent-guides/schemas.md`, then re-run.

- [ ] **Step 2: Full preflight.**

Run: `npm run release:preflight`
Expected: exit 0 — all gates incl. `check-version-sync`, `lint-*`, `run-validator`, `run-customjs-loadable` (bare-class checks on every edited helper), `run-reader-article-paste`, `run-reader`, `run-reader-chrome-bar`, `run-home`, `run-daily-dashboard`, `run-content-token-leaks`. Any failure: read output, fix the offending blueprint source (never weaken a test), re-run. If `check-version-sync` fails on drift, STOP and report — do not hand-bump.

- [ ] **Step 3: Dogfood self-install (best-effort verification).**

Run: `node platform/install.js . 2>&1 | tail -15`
Expected: install reports success (no fatal error). NOTE: the workshop's `ranch/` dogfood copies are pre-existing stale (drifted before this cycle); do NOT attempt to reconcile that drift here — consumer delivery is via `platform/` → brew, not `ranch/`. Only verify install exits cleanly. Do NOT `git add -A`.

- [ ] **Step 4: Confirm intended tree.**

Run: `git status --short`
Expected: clean (all task commits landed) or only expected dogfood artifacts. Review each; commit nothing unrelated. This is the branch-ready gate.

---

## Self-Review notes (author checklist — completed)

- **Spec coverage:** Surface A (Tasks 2+3), B (Task 3), C (Task 5), D1 (Task 4), D2-D4 (Tasks 6+7), E (Task 1), Schema (Task 8), testing/verification (each task + Task 8), versioning (header + Task 8 note). All 5 design decisions covered.
- **Placeholder scan:** every code step has full code; commands have expected output; no TBD/"add validation"/"similar to Task N".
- **Type/name consistency:** `selectReadingArticles(dv)` defined in Task 6, consumed in Task 7's union; `reader-article` key consistent across allowlist/colors/groupLabels/tsKeys/meta; `ReaderArticlePaste.open(dv)` used identically in Tasks 2 (chrome) + 5 (home); `status_changed_at` written in Task 4, read via tsKeys in Task 7; `validateTitle` sanitize regex matches the manifest's `|sanitize-filename` char class.
