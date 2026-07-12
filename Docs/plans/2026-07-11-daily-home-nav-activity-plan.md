# Daily/Home ChromeBar migration + Activity coverage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Daily note and Home page off the legacy `SpaceNavButtons` grid onto the shared `ChromeBar` mechanism (with a vault-wide Home button + trailing divider + smart day-nav), and close the Activity panel's coverage gap (wiki + project docs invisible today) plus add a count-based auto-collapse.

**Architecture:** Five independently-testable slices: (1) `chrome-bar` mechanism grows a Home button, a trailing hairline divider, and `adapter.dayNav` support; (2) `daily` blueprint gets a new `DailyChromeBar` adapter + template wiring; (3) `home` blueprint gets a new `HomeChromeBar` adapter + template wiring; (4) `activity-feed` mechanism grows a count-based collapse threshold; (5) `space-daily-dashboard.js` widens its Activity allowlist. A sixth slice heals already-created Daily/Home notes on consumer vaults. Every slice is TDD'd against the existing Node harness pattern (`new Function` load + DOM/customJS stubs) before touching manifests/templates.

**Tech Stack:** Vanilla JS (customJS classes, no imports/exports), Obsidian Dataview/Templater, Node test harnesses under `platform/test/run-*.js`, JSON manifests.

**Design doc:** `Docs/plans/2026-07-11-daily-home-nav-activity-design.md`

---

## Task 1: `chrome-bar` — Home icon + button

**Files:**
- Modify: `platform/mechanisms/chrome-bar/chrome-bar.js` (the `CHROME_ICONS` getter, and `render(dv, adapter)`)
- Test: `platform/test/run-chrome-bar.js`

- [ ] **Step 1: Write the failing test**

Insert after the existing `CB-SMOKE-1` block (around line 42, at the `PLACEHOLDER-ANCHOR` comment) in `platform/test/run-chrome-bar.js`:

```javascript
// ── CB-HOME-1..3 — CHROME_ICONS.home glyph + render() emits a Home button
// before the Go button, wired to adapter.openNavTarget("spice/home/Home.md").
{
  const ic = inst.CHROME_ICONS;
  ok('CB-HOME-1 CHROME_ICONS has a home SVG', ic && /svg/.test(ic.home));
}
async function cbHomeButtonCase() {
  const prevApp = global.app, prevCJS = global.customJS, prevAD = global.activeDocument;
  global.activeDocument = { body: makeEl('body'), createElement: (t) => makeEl(t), addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
  global.app = { isMobile: false, workspace: { openLinkText() {}, getLeaf: () => ({ openFile() {} }) } };
  global.customJS = {
    RenderSafe: { page: (dv) => (dv && dv.current ? dv.current() : null) },
    Breadcrumb: { buildSegments: async () => ([]) },
    MenuPopover: { open: () => makeEl('div') },
  };
  const opened = [];
  const adapter = {
    resolve: () => ({ ctx: {}, spec: { primary: null, overflow: [] } }),
    navEntries: async () => ([]),
    dispatch: () => {},
    openNavTarget: (p) => opened.push(p),
    rootClass: 'x-root',
    btnClass: (v) => `x-btn x-btn-${v}`,
  };
  const container = makeEl('div');
  const dv = { container, current: () => ({ file: { path: 'spice/x/y.md', name: 'y' } }) };
  await inst.render(dv, adapter);
  const desc = allDescendants(container);
  const homeBtn = desc.find((e) => e.className && String(e.className).includes('x-btn-home'));
  ok('CB-HOME-2 renders a Home button (x-btn-home via adapter.btnClass)', !!homeBtn);
  if (homeBtn && typeof homeBtn.onclick === 'function') homeBtn.onclick();
  ok('CB-HOME-3 clicking Home calls adapter.openNavTarget("spice/home/Home.md")',
    opened.length === 1 && opened[0] === 'spice/home/Home.md');
  global.app = prevApp; global.customJS = prevCJS; global.activeDocument = prevAD;
}
```

Wire the new async case into the IIFE at the bottom (it currently reads `await cbVaultCases(); await cbVaultEmpty(); await cbRenderCases(); await cbFactoryCases(); summarize();`):

```javascript
(async () => {
  await cbVaultCases();
  await cbVaultEmpty();
  await cbRenderCases();
  await cbHomeButtonCase();
  await cbFactoryCases();
  summarize();
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-chrome-bar.js`
Expected: `CB-HOME-1`/`CB-HOME-2`/`CB-HOME-3` FAIL (no `home` icon, no Home button rendered).

- [ ] **Step 3: Add the `home` glyph to `CHROME_ICONS`**

In `platform/mechanisms/chrome-bar/chrome-bar.js`, inside the `get CHROME_ICONS()` getter, add a `home` key alongside `compass`/`chevronDown`/`moreHorizontal` (same stroke-width/viewBox conventions):

```javascript
home: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
```

- [ ] **Step 4: Render the Home button as the first control in the right-hand cluster**

In `render(dv, adapter)`, locate where the `right` container is created and the Go button is the first thing appended to it (immediately after `const right = bar.createEl("div"); right.style.cssText = "margin-left: auto; ...";`). Insert the Home button BEFORE the existing Go-button `renderChromeButton` call:

```javascript
this.renderChromeButton(right, {
  cls: adapter.btnClass("home"),
  icon: ICON.home,
  onClick: () => adapter.openNavTarget("spice/home/Home.md", dv),
});
```

(`ICON` is already the local alias for `this.CHROME_ICONS` at the top of `render`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `node platform/test/run-chrome-bar.js`
Expected: all `CB-HOME-*` PASS, plus every pre-existing case still PASS (0 regressions).

- [ ] **Step 6: Commit**

```bash
git add platform/mechanisms/chrome-bar/chrome-bar.js platform/test/run-chrome-bar.js
git commit -m "feat(chrome-bar): add a persistent Home button to the shared chrome bar"
```

---

## Task 2: `chrome-bar` — trailing hairline divider

**Files:**
- Modify: `platform/mechanisms/chrome-bar/chrome-bar.js`
- Test: `platform/test/run-chrome-bar.js`

- [ ] **Step 1: Write the failing test**

Add to `cbRenderCases()` in `run-chrome-bar.js`, right after the existing `CB-RENDER-3` breadcrumb assertion:

```javascript
  const divider = desc.find((e) => e.className && String(e.className).includes('chrome-bar-divider'));
  ok('CB-RENDER-3b renders a trailing divider after the bar row', !!divider);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-chrome-bar.js`
Expected: `CB-RENDER-3b` FAILS (no divider element yet).

- [ ] **Step 3: Append the divider inside `root`, after `bar`**

In `render(dv, adapter)`, immediately after the `bar` row and ALL of its children have been fully assembled (i.e., at the very end of the method, right before `render` returns — after the primary/overflow button blocks), append:

```javascript
const divider = root.createEl("div", { cls: "chrome-bar-divider" });
divider.style.cssText = "border-top: 1px solid var(--background-modifier-border-hover); margin-top: 10px;";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-chrome-bar.js`
Expected: `CB-RENDER-3b` PASSes, no regressions.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/chrome-bar/chrome-bar.js platform/test/run-chrome-bar.js
git commit -m "feat(chrome-bar): add trailing hairline divider between bar and content"
```

- [ ] **Step 6: Update `Docs/agent-guides/note-chrome.md` § 1d**

Add one sentence after the existing `ChromeBar.makeAdapter(config)` paragraph noting the divider is now bar-owned:

```
`ChromeBar.render` also appends a trailing hairline divider (`.chrome-bar-divider`, `border-top: 1px solid var(--background-modifier-border-hover)`) as the LAST element of its root container, after the bar row — every adopter gets a consistent nav-to-content separator with no per-blueprint CSS needed. This supersedes the earlier "no leading hairline above content" note: the bar now owns the boundary from its own trailing edge instead.
```

```bash
git add Docs/agent-guides/note-chrome.md
git commit -m "docs: note chrome-bar's new trailing-divider ownership"
```

---

## Task 3: `chrome-bar` — `adapter.dayNav` support (left-slot override)

**Files:**
- Modify: `platform/mechanisms/chrome-bar/chrome-bar.js`
- Test: `platform/test/run-chrome-bar.js`

- [ ] **Step 1: Write the failing test**

Add a new async case to `run-chrome-bar.js` (call it from the bottom IIFE alongside the others):

```javascript
// ── CB-DAYNAV-1..3 — adapter.dayNav(dv) overrides the breadcrumb left-slot
// with prev/next day-nav spans; absent on every other adapter (no regression).
async function cbDayNavCase() {
  const prevApp = global.app, prevCJS = global.customJS, prevAD = global.activeDocument;
  global.activeDocument = { body: makeEl('body'), createElement: (t) => makeEl(t), addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
  global.app = { isMobile: false, workspace: { openLinkText() {}, getLeaf: () => ({ openFile() {} }) } };
  global.customJS = {
    RenderSafe: { page: (dv) => (dv && dv.current ? dv.current() : null) },
    Breadcrumb: { buildSegments: async () => ([{ label: 'SHOULD NOT RENDER', link: 'x.md' }]) },
    MenuPopover: { open: () => makeEl('div') },
  };
  const adapter = {
    resolve: () => ({ ctx: {}, spec: { primary: null, overflow: [] } }),
    navEntries: async () => ([]),
    dispatch: () => {},
    openNavTarget: () => {},
    dayNav: () => ({
      prevLabel: 'Tue, Jul 7', prevPath: 'spice/daily/2026-07-07.md',
      nextLabel: 'Thu, Jul 9', nextPath: null, // no later daily note → inert
    }),
    rootClass: 'x-root',
    btnClass: (v) => `x-btn x-btn-${v}`,
  };
  const container = makeEl('div');
  const dv = { container, current: () => ({ file: { path: 'spice/daily/2026-07-08.md', name: '2026-07-08' } }) };
  await inst.render(dv, adapter);
  const desc = allDescendants(container);
  ok('CB-DAYNAV-1 breadcrumb is NOT rendered when adapter.dayNav is present',
    !desc.some((e) => e.className && String(e.className).includes('project-breadcrumb')));
  const dayNavEl = desc.find((e) => e.className && String(e.className).includes('chrome-bar-day-nav'));
  ok('CB-DAYNAV-2 renders a day-nav element with both labels', !!dayNavEl
    && String(dayNavEl.innerHTML || '').includes('Tue, Jul 7')
    && String(dayNavEl.innerHTML || '').includes('Thu, Jul 9'));
  const nextSpan = allDescendants(dayNavEl).find((e) => e.className && String(e.className).includes('chrome-bar-day-nav-next'));
  ok('CB-DAYNAV-3 a null nextPath renders an inert (no onclick) next control', !!nextSpan && typeof nextSpan.onclick !== 'function');
  global.app = prevApp; global.customJS = prevCJS; global.activeDocument = prevAD;
}
```

Update the bottom IIFE to also `await cbDayNavCase();`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-chrome-bar.js`
Expected: `CB-DAYNAV-*` FAIL (no `dayNav` branch exists yet).

- [ ] **Step 3: Implement the left-slot branch**

In `render(dv, adapter)`, find the existing breadcrumb-left block:

```javascript
let segments = [];
try {
  if (customJS && customJS.Breadcrumb && typeof customJS.Breadcrumb.buildSegments === "function") {
    segments = await customJS.Breadcrumb.buildSegments(dv);
  }
} catch (_e) { segments = []; }
if (Array.isArray(segments) && segments.length > 0) {
  const left = bar.createEl("div", { cls: "project-breadcrumb" });
  // ... existing segment-rendering loop
}
```

Replace it with a branch that checks `adapter.dayNav` FIRST, falling through to the existing breadcrumb path only when absent:

```javascript
if (typeof adapter.dayNav === "function") {
  let nav = null;
  try { nav = adapter.dayNav(dv); } catch (_e) { nav = null; }
  if (nav) {
    const left = bar.createEl("div", { cls: "chrome-bar-day-nav" });
    left.style.cssText = "font-size: 0.85em; color: var(--text-muted); display: flex; align-items: center; gap: 6px; min-width: 0;";
    const mkSide = (label, targetPath, cls) => {
      const el = left.createEl(targetPath ? "a" : "span", { cls: "chrome-bar-day-nav-" + cls });
      el.textContent = label || "—";
      el.style.cssText = targetPath
        ? "cursor: pointer; text-decoration: none; color: var(--text-muted);"
        : "opacity: 0.4;";
      if (targetPath) el.onclick = (e) => { if (e && e.preventDefault) e.preventDefault(); adapter.openNavTarget(targetPath, dv); };
      return el;
    };
    mkSide(nav.prevLabel, nav.prevPath, "prev");
    mkSide(nav.nextLabel, nav.nextPath, "next");
  }
} else {
  let segments = [];
  try {
    if (customJS && customJS.Breadcrumb && typeof customJS.Breadcrumb.buildSegments === "function") {
      segments = await customJS.Breadcrumb.buildSegments(dv);
    }
  } catch (_e) { segments = []; }
  if (Array.isArray(segments) && segments.length > 0) {
    const left = bar.createEl("div", { cls: "project-breadcrumb" });
    // ... existing segment-rendering loop, UNCHANGED
  }
}
```

Keep the existing segment-rendering loop body verbatim inside the `else` branch — only the `if (Array.isArray(segments)...)` wrapper moves under `else`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-chrome-bar.js`
Expected: `CB-DAYNAV-*` PASS; `CB-RENDER-3` (breadcrumb path, no `dayNav` on that adapter) still PASSES unchanged.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/chrome-bar/chrome-bar.js platform/test/run-chrome-bar.js
git commit -m "feat(chrome-bar): support adapter.dayNav to replace the breadcrumb slot"
```

---

## Task 4: `daily` — `DailyChromeBar` adapter

**Files:**
- Create: `platform/blueprints/daily/helpers/daily-chrome-bar.js`
- Test: `platform/test/run-daily-chrome-bar.js` (new, mirrors `run-wiki-chrome-bar.js` / `run-todo-chrome-bar.js` structure)

- [ ] **Step 1: Write the failing test**

Create `platform/test/run-daily-chrome-bar.js`:

```javascript
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(relPath, className) {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  return new Function(`${src}\nreturn ${className};`)();
}
const DailyChromeBar = loadClass('platform/blueprints/daily/helpers/daily-chrome-bar.js', 'DailyChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

// DCB-1: resolveDayNav — middle of the run, both neighbors exist.
{
  const dates = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09'];
  const nav = DailyChromeBar.resolveDayNav('2026-07-08', dates);
  ok('DCB-1a prevPath resolves to the nearest earlier date', nav.prevPath && nav.prevPath.includes('2026-07-07'));
  ok('DCB-1b nextPath resolves to the nearest later date', nav.nextPath && nav.nextPath.includes('2026-07-09'));
  ok('DCB-1c prevLabel is a human weekday/date string', /\w{3},\s*\w{3}\s*\d{1,2}/.test(nav.prevLabel));
}
// DCB-2: resolveDayNav — no earlier daily note → prevPath null (grey-out).
{
  const dates = ['2026-07-08', '2026-07-09'];
  const nav = DailyChromeBar.resolveDayNav('2026-07-08', dates);
  ok('DCB-2a no earlier daily → prevPath null', nav.prevPath === null);
  ok('DCB-2b later daily still resolves', !!nav.nextPath);
}
// DCB-3: resolveDayNav — no later daily note → nextPath null (grey-out).
{
  const dates = ['2026-07-07', '2026-07-08'];
  const nav = DailyChromeBar.resolveDayNav('2026-07-08', dates);
  ok('DCB-3 no later daily → nextPath null', nav.nextPath === null);
}
// DCB-4: detect() — matches a daily-folder note, null otherwise.
{
  const inst = new DailyChromeBar();
  const cfg = inst._config();
  const hit = cfg.detect({}, { type: 'cowork-daily', file: { path: 'spice/daily/2026/07-July/Wednesday-2026-07-08.md', name: 'Wednesday-2026-07-08' } });
  ok('DCB-4a detect() matches type:cowork-daily', !!hit);
  const miss = cfg.detect({}, { type: 'home', file: { path: 'spice/home/Home.md', name: 'Home' } });
  ok('DCB-4b detect() returns null for a non-daily page', miss === null);
}
// DCB-5: surfaceSpec() — no primary, no overflow (capture stays Home's job).
{
  const inst = new DailyChromeBar();
  const cfg = inst._config();
  const spec = cfg.surfaceSpec({});
  ok('DCB-5 surfaceSpec has no primary and empty overflow', spec.primary === null && Array.isArray(spec.overflow) && spec.overflow.length === 0);
}

const failed = results.filter(([, c]) => !c);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.error(`FAILED: ${failed.map(([n]) => n).join(', ')}`); process.exit(1); }
process.exit(0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-daily-chrome-bar.js`
Expected: FAIL — `platform/blueprints/daily/helpers/daily-chrome-bar.js` does not exist yet.

- [ ] **Step 3: Read `SpaceNavButtons`'s existing day-arrow logic before porting it**

Read `platform/mechanisms/nav-buttons/space-nav-buttons.js` lines 220–253 (the arrow-row block inside `render(dv)`) — this is the exact nearest-earlier/nearest-later lookup being ported into a pure static. Confirm the moment-diff comparison and the folder-prefix + basename-date-regex approach before writing `resolveDayNav`.

- [ ] **Step 4: Write `daily-chrome-bar.js`**

Create `platform/blueprints/daily/helpers/daily-chrome-bar.js`:

```javascript
/**
 * DailyChromeBar (CustomJS) — the daily blueprint's ChromeBar adapter config.
 *
 * Renders the shared Go ▾ / ⋯ bar on Daily notes via
 * customJS.ChromeBar.makeAdapter(this._config()), replacing SpaceNavButtons.
 * The bar's left slot renders smart day-nav (nearest earlier/later daily note,
 * greyed out + inert at either end of the run) via adapter.dayNav instead of
 * a breadcrumb — Daily notes have no ancestor trail. No primary/overflow
 * actions: task/meeting/sticky-note capture stays Home's job (explicit user
 * decision, 2026-07-11 brainstorm).
 */
class DailyChromeBar {
  /**
   * Pure day-nav resolver. `currentDateStr` is the current daily note's
   * YYYY-MM-DD date; `allDateStrs` is every OTHER daily note's date string
   * found in the daily folder (duplicates/invalid entries are tolerated —
   * filtered here). Returns { prevLabel, prevPath, nextLabel, nextPath } —
   * `*Path` is null when there is no earlier/later daily note (caller greys
   * it out). Paths are synthetic ("...<date>...") — the REAL adapter wires
   * actual file paths via _config()'s dayNav closure, which has the live
   * app.vault.getMarkdownFiles() listing; this static only computes WHICH
   * date is nearest, given a plain array of date strings, so it's testable
   * without any Obsidian global. Never throws — malformed input returns
   * { prevLabel: null, prevPath: null, nextLabel: null, nextPath: null }.
   */
  static resolveDayNav(currentDateStr, allDateStrs) {
    const cur = window.moment(currentDateStr, "YYYY-MM-DD", true);
    if (!cur || !cur.isValid || !cur.isValid()) {
      return { prevLabel: null, prevPath: null, nextLabel: null, nextPath: null };
    }
    const parsed = (Array.isArray(allDateStrs) ? allDateStrs : [])
      .map((s) => window.moment(s, "YYYY-MM-DD", true))
      .filter((m) => m && m.isValid && m.isValid());
    const earlier = parsed.filter((m) => m.isBefore(cur, "day")).sort((a, b) => a.diff(b)).pop();
    const later = parsed.filter((m) => m.isAfter(cur, "day")).sort((a, b) => a.diff(b))[0];
    return {
      prevLabel: earlier ? earlier.format("ddd, MMM D") : null,
      prevPath: earlier ? earlier.format("YYYY-MM-DD") : null,
      nextLabel: later ? later.format("ddd, MMM D") : null,
      nextPath: later ? later.format("YYYY-MM-DD") : null,
    };
  }

  render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.makeAdapter !== "function"
        || typeof customJS.ChromeBar.render !== "function") return;
      return customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
    } catch (_e) { /* never throw */ }
  }

  _config() {
    return {
      // Classify by frontmatter type only — daily notes carry type:cowork-daily
      // (the daily-template.md frontmatter). null → not a daily surface.
      detect: (dv, page) => {
        if (!page || page.type !== "cowork-daily") return null;
        const p = (page.file && page.file.path) || "";
        return { path: p };
      },
      surfaceSpec: () => ({ primary: null, overflow: [] }),
      dispatch: () => {},
      destinations: () => ([]),
      rootClass: "daily-chrome-root",
      btnClass: (v) => `daily-chrome-btn daily-chrome-btn-${v}`,
    };
  }

  // Wired onto the resolved adapter as `dayNav` by `render()`'s caller path
  // through ChromeBar.makeAdapter — see the resolve()/dayNav bridge added in
  // Task 4 Step 5 below (ChromeBar.render checks adapter.dayNav directly, and
  // makeAdapter's returned object does not proxy unknown config keys, so this
  // instance method is invoked from a small wrapper — see Step 5).
  async _dayNav(dv) {
    try {
      const cur = dv && dv.current ? dv.current() : null;
      const curPath = (cur && cur.file && cur.file.path) || "";
      const m = curPath.match(/(\d{4}-\d{2}-\d{2})/);
      if (!m) return null;
      const currentDateStr = m[1];
      let cfg = null;
      try {
        const raw = await app.vault.adapter.read(".obsidian/daily-notes.json");
        cfg = JSON.parse(raw);
      } catch (_e) { cfg = null; }
      if (!cfg || typeof cfg.folder !== "string" || !cfg.folder) return null;
      const allDateStrs = app.vault.getMarkdownFiles()
        .filter((f) => f.path.startsWith(cfg.folder + "/"))
        .map((f) => { const fm = f.name.match(/(\d{4}-\d{2}-\d{2})/); return fm ? fm[1] : null; })
        .filter(Boolean);
      const nav = DailyChromeBar.resolveDayNav(currentDateStr, allDateStrs);
      const filesByDate = {};
      for (const f of app.vault.getMarkdownFiles()) {
        if (!f.path.startsWith(cfg.folder + "/")) continue;
        const fm = f.name.match(/(\d{4}-\d{2}-\d{2})/);
        if (fm) filesByDate[fm[1]] = f.path;
      }
      return {
        prevLabel: nav.prevLabel,
        prevPath: nav.prevPath ? (filesByDate[nav.prevPath] || null) : null,
        nextLabel: nav.nextLabel,
        nextPath: nav.nextPath ? (filesByDate[nav.nextPath] || null) : null,
      };
    } catch (_e) { return null; }
  }
}
```

- [ ] **Step 5: Wire `dayNav` onto the adapter `ChromeBar.makeAdapter` returns**

`ChromeBar.makeAdapter(config)` (from Task 3's precedent) only forwards the keys it explicitly destructures. Since `dayNav` is a NEW capability, `makeAdapter` needs one more line. In `platform/mechanisms/chrome-bar/chrome-bar.js`, inside `makeAdapter(config)`'s returned object, add:

```javascript
dayNav: (typeof config.dayNav === "function") ? config.dayNav : undefined,
```

Then in `DailyChromeBar._config()`, add the `dayNav` key so it flows through:

```javascript
dayNav: (dv) => this._dayNav(dv),
```

Note: `_dayNav` is `async`, but `ChromeBar.render`'s day-nav branch (Task 3, Step 3) calls `adapter.dayNav(dv)` synchronously (`let nav = null; try { nav = adapter.dayNav(dv); } ...`). Fix that branch now to `await` it, since a real day-nav lookup needs `app.vault.adapter.read(...)`:

```javascript
if (typeof adapter.dayNav === "function") {
  let nav = null;
  try { nav = await adapter.dayNav(dv); } catch (_e) { nav = null; }
  ...
```

(`render` is already `async`, so this is a one-word fix — add `await`. Re-run `platform/test/run-chrome-bar.js` from Task 3 after this change: the `CB-DAYNAV-*` cases use a SYNC `dayNav` closure returning a plain object, which still works fine `await`-ed.)

- [ ] **Step 6: Add the `makeAdapter` forwarding + `await` fix, then run Task 3's test again**

Run: `node platform/test/run-chrome-bar.js`
Expected: still 100% green (no regression from the `await` addition).

- [ ] **Step 7: Run the new Daily test to verify it passes**

Run: `node platform/test/run-daily-chrome-bar.js`
Expected: all `DCB-*` cases PASS.

- [ ] **Step 8: Commit**

```bash
git add platform/mechanisms/chrome-bar/chrome-bar.js platform/blueprints/daily/helpers/daily-chrome-bar.js platform/test/run-daily-chrome-bar.js platform/test/run-chrome-bar.js
git commit -m "feat(daily): add DailyChromeBar adapter with smart day-nav"
```

---

## Task 5: `daily` — manifest + template wiring

**Files:**
- Modify: `platform/blueprints/daily/manifest.json`
- Modify: `platform/blueprints/daily/content/daily-template.md`

- [ ] **Step 1: Add the `chrome-bar` dependency + register the new helper + class**

In `platform/blueprints/daily/manifest.json`, add to `depends_on` (alongside the existing `nav-buttons`/`customjs-guard`/`convenience`/`activity-feed`/`kanban-status-sync` entries):

```json
{
  "name": "chrome-bar",
  "range": ">=0.3.1"
}
```

Add `"DailyChromeBar"` to `customjs_classes`:

```json
"customjs_classes": [
  "SpaceDailyDashboard",
  "DailyChromeBar"
],
```

Add the helper file to `files`:

```json
{
  "source": "helpers/daily-chrome-bar.js",
  "dest": "{{scripts_path}}/daily/daily-chrome-bar.js"
}
```

Leave the existing `nav_buttons` array (the `daily-today` entry) UNCHANGED — that's a registry contribution consumed by OTHER surfaces' "Go ▾ → Vault" grid, unrelated to what renders ON the daily note itself.

- [ ] **Step 2: Rewrite `daily-template.md`'s chrome block**

Replace:

```
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceDailyDashboard" });
```

---
```

with:

```
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "DailyChromeBar" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceDailyDashboard" });
```
```

(Two `---` literal separators removed — Task 2's trailing hairline divider now owns that boundary, and note-chrome.md's "no literal `---`" rule now applies to this template too.)

- [ ] **Step 3: Verify via `node --check` + a self-install dry run (deferred to Task 9's full preflight)**

Run: `node --check platform/blueprints/daily/manifest.json` is not valid (manifests are JSON, not JS) — instead run:

```bash
node -e "JSON.parse(require('fs').readFileSync('platform/blueprints/daily/manifest.json', 'utf8')); console.log('valid JSON')"
```

Expected: `valid JSON`.

- [ ] **Step 4: Commit**

```bash
git add platform/blueprints/daily/manifest.json platform/blueprints/daily/content/daily-template.md
git commit -m "feat(daily): wire DailyChromeBar into the daily template"
```

---

## Task 6: `home` — `HomeChromeBar` adapter + manifest + template wiring

**Files:**
- Create: `platform/blueprints/home/helpers/home-chrome-bar.js`
- Modify: `platform/blueprints/home/manifest.json`
- Modify: `platform/blueprints/home/content/home-template.md`
- Test: `platform/test/run-home-chrome-bar.js` (new)

- [ ] **Step 1: Write the failing test**

Create `platform/test/run-home-chrome-bar.js`:

```javascript
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(relPath, className) {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  return new Function(`${src}\nreturn ${className};`)();
}
const HomeChromeBar = loadClass('platform/blueprints/home/helpers/home-chrome-bar.js', 'HomeChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

// HCB-1: detect() — matches ONLY spice/home/Home.md.
{
  const inst = new HomeChromeBar();
  const cfg = inst._config();
  const hit = cfg.detect({}, { type: 'home', file: { path: 'spice/home/Home.md', name: 'Home' } });
  ok('HCB-1a detect() matches spice/home/Home.md', !!hit);
  const miss = cfg.detect({}, { type: 'cowork-daily', file: { path: 'spice/daily/2026-07-08.md', name: '2026-07-08' } });
  ok('HCB-1b detect() returns null for a non-Home page', miss === null);
}
// HCB-2: surfaceSpec() — no primary, no overflow (Home's own bespoke capture menu stays untouched).
{
  const inst = new HomeChromeBar();
  const cfg = inst._config();
  const spec = cfg.surfaceSpec({});
  ok('HCB-2 surfaceSpec has no primary and empty overflow', spec.primary === null && Array.isArray(spec.overflow) && spec.overflow.length === 0);
}
// HCB-3: no dayNav — Home is a single fixed page, not a per-day note.
{
  const inst = new HomeChromeBar();
  const cfg = inst._config();
  ok('HCB-3 config has no dayNav key', !('dayNav' in cfg));
}
// HCB-4: destinations() — empty (Vault grid only, no "This home" section).
{
  const inst = new HomeChromeBar();
  const cfg = inst._config();
  ok('HCB-4 destinations() returns []', Array.isArray(cfg.destinations({}, {})) && cfg.destinations({}, {}).length === 0);
}

const failed = results.filter(([, c]) => !c);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.error(`FAILED: ${failed.map(([n]) => n).join(', ')}`); process.exit(1); }
process.exit(0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-home-chrome-bar.js`
Expected: FAIL — file doesn't exist yet.

- [ ] **Step 3: Write `home-chrome-bar.js`**

Create `platform/blueprints/home/helpers/home-chrome-bar.js`:

```javascript
/**
 * HomeChromeBar (CustomJS) — the home blueprint's ChromeBar adapter config.
 *
 * Renders the shared Go ▾ / ⋯ bar on Home.md via
 * customJS.ChromeBar.makeAdapter(this._config()), replacing SpaceNavButtons.
 * Sits ABOVE SpaceHome's existing bespoke greeting + quick-capture header,
 * which is completely untouched — no primary/overflow actions here (explicit
 * user decision, 2026-07-11 brainstorm). No dayNav — Home.md is a single
 * fixed page, not a per-day note, so the left slot renders nothing (empty
 * breadcrumb array — ChromeBar.render's existing empty-segments guard
 * already no-ops cleanly).
 */
class HomeChromeBar {
  render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.makeAdapter !== "function"
        || typeof customJS.ChromeBar.render !== "function") return;
      return customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
    } catch (_e) { /* never throw */ }
  }

  _config() {
    return {
      detect: (dv, page) => {
        const p = (page && page.file && page.file.path) || "";
        if (p !== "spice/home/Home.md") return null;
        return { path: p };
      },
      surfaceSpec: () => ({ primary: null, overflow: [] }),
      dispatch: () => {},
      destinations: () => ([]),
      rootClass: "home-chrome-root",
      btnClass: (v) => `home-chrome-btn home-chrome-btn-${v}`,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-home-chrome-bar.js`
Expected: all `HCB-*` PASS.

- [ ] **Step 5: Wire into `home` manifest + template**

In `platform/blueprints/home/manifest.json`, add to `depends_on`:

```json
{
  "name": "chrome-bar",
  "range": ">=0.3.1"
}
```

Add to `customjs_classes`:

```json
"customjs_classes": [
  "SpaceHome",
  "HomeCommandsInit",
  "HomeChromeBar"
],
```

Add to `files`:

```json
{
  "source": "helpers/home-chrome-bar.js",
  "dest": "{{scripts_path}}/home/home-chrome-bar.js"
}
```

In `platform/blueprints/home/content/home-template.md`, replace:

```
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceHome" });
```

[//]: # (HOME_CHROME_END)
```

with:

```
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "HomeChromeBar" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceHome" });
```

[//]: # (HOME_CHROME_END)
```

- [ ] **Step 6: Validate JSON + commit**

```bash
node -e "JSON.parse(require('fs').readFileSync('platform/blueprints/home/manifest.json', 'utf8')); console.log('valid JSON')"
git add platform/blueprints/home/helpers/home-chrome-bar.js platform/blueprints/home/manifest.json platform/blueprints/home/content/home-template.md platform/test/run-home-chrome-bar.js
git commit -m "feat(home): add HomeChromeBar adapter, wire into the Home template"
```

---

## Task 7: `activity-feed` — count-based default-collapse threshold

**Files:**
- Modify: `platform/mechanisms/activity-feed/activity-feed.js` (`_renderGroupedByBlueprint`)
- Test: `platform/test/run-activity-feed.js`

- [ ] **Step 1: Write the failing tests**

Add after the existing `AF-V070-CLOSED-1` block in `platform/test/run-activity-feed.js`:

```javascript
// AF-COLLAPSE-1: a group with exactly 3 pages (the threshold) stays OPEN.
try {
  const pages = [1, 2, 3].map((n) => ({ file: { path: `w${n}.md`, name: `w${n}` }, type: "wiki", created_at: `2026-05-19T1${n}:00:00Z` }));
  const dv = v066_makeFakeDv(pages);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, { scope: "today", asOf: "2026-05-19", blueprints: ["wiki"], framed: true, groupOrder: ["wiki"] });
  const findDetails = (el) => { for (const c of (el._children || [])) { if (c.tag === "details") return c; const inner = findDetails(c); if (inner) return inner; } return null; };
  const d = findDetails(dv.container);
  assertTrue("AF-COLLAPSE-1: exactly-3-item group stays open by default", d && d.open === true);
} catch (e) {
  assertTrue("AF-COLLAPSE-1: exactly-3-item group stays open by default", false, e && e.message);
}
// AF-COLLAPSE-2: a group with 4 pages (over the threshold) collapses by default.
try {
  const pages = [1, 2, 3, 4].map((n) => ({ file: { path: `w${n}.md`, name: `w${n}` }, type: "wiki", created_at: `2026-05-19T1${n}:00:00Z` }));
  const dv = v066_makeFakeDv(pages);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, { scope: "today", asOf: "2026-05-19", blueprints: ["wiki"], framed: true, groupOrder: ["wiki"] });
  const findDetails = (el) => { for (const c of (el._children || [])) { if (c.tag === "details") return c; const inner = findDetails(c); if (inner) return inner; } return null; };
  const d = findDetails(dv.container);
  assertTrue("AF-COLLAPSE-2: 4-item group collapses by default (no defaultClosed opt needed)", d && d.open === false);
} catch (e) {
  assertTrue("AF-COLLAPSE-2: 4-item group collapses by default", false, e && e.message);
}
// AF-COLLAPSE-3: a custom collapseThreshold is honored (2 items collapses at threshold:1).
try {
  const pages = [1, 2].map((n) => ({ file: { path: `w${n}.md`, name: `w${n}` }, type: "wiki", created_at: `2026-05-19T1${n}:00:00Z` }));
  const dv = v066_makeFakeDv(pages);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, { scope: "today", asOf: "2026-05-19", blueprints: ["wiki"], framed: true, groupOrder: ["wiki"], collapseThreshold: 1 });
  const findDetails = (el) => { for (const c of (el._children || [])) { if (c.tag === "details") return c; const inner = findDetails(c); if (inner) return inner; } return null; };
  const d = findDetails(dv.container);
  assertTrue("AF-COLLAPSE-3: explicit collapseThreshold:1 collapses a 2-item group", d && d.open === false);
} catch (e) {
  assertTrue("AF-COLLAPSE-3: explicit collapseThreshold honored", false, e && e.message);
}
// AF-COLLAPSE-4: defaultClosed still forces closed even when under threshold (1 item, threshold 3).
try {
  const pages = [{ file: { path: "w1.md", name: "w1" }, type: "wiki", created_at: "2026-05-19T11:00:00Z" }];
  const dv = v066_makeFakeDv(pages);
  const ActivityFeed = v066_loadAF();
  const af = new ActivityFeed();
  af.render(dv, { scope: "today", asOf: "2026-05-19", blueprints: ["wiki"], framed: true, groupOrder: ["wiki"], defaultClosed: ["wiki"] });
  const findDetails = (el) => { for (const c of (el._children || [])) { if (c.tag === "details") return c; const inner = findDetails(c); if (inner) return inner; } return null; };
  const d = findDetails(dv.container);
  assertTrue("AF-COLLAPSE-4: defaultClosed still forces closed under the count threshold", d && d.open === false);
} catch (e) {
  assertTrue("AF-COLLAPSE-4: defaultClosed forces closed under threshold", false, e && e.message);
}
```

(`v066_makeFakeDv` / `v066_loadAF` / `assertTrue` are the pre-existing harness helpers already used by every other case in this file — reuse verbatim, don't redefine.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-activity-feed.js`
Expected: `AF-COLLAPSE-2` and `AF-COLLAPSE-3` FAIL (no count-based collapse exists yet); `AF-COLLAPSE-1` and `AF-COLLAPSE-4` already PASS (they describe today's behavior — small groups open, `defaultClosed` closed — included as regression guards).

- [ ] **Step 3: Implement `collapseThreshold`**

In `platform/mechanisms/activity-feed/activity-feed.js`'s `_renderGroupedByBlueprint`, find:

```javascript
const defaultClosed = new Set(Array.isArray(safe.defaultClosed) ? safe.defaultClosed.map(String) : []);  // NEW v0.4.0
```

Add immediately after it:

```javascript
// NEW — count-based auto-collapse (2026-07-11 daily/home audit cycle). Any
// group exceeding this many items collapses by default, on top of (not
// instead of) the static defaultClosed list — the static list still forces
// a group closed regardless of count. Default 3 when omitted.
const collapseThreshold = (typeof safe.collapseThreshold === "number" && safe.collapseThreshold >= 0)
  ? safe.collapseThreshold
  : 3;
```

Then find the per-group render loop:

```javascript
for (const t of sortedKeys) {
  const groupPages = groups.get(t);
  const color = (colorByType && colorByType[t]) ? colorByType[t] : "var(--color-base-50)";
  const isClosed = defaultClosed.has(t);
```

Change the `isClosed` line to:

```javascript
  const isClosed = defaultClosed.has(t) || (Array.isArray(groupPages) && groupPages.length > collapseThreshold);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-activity-feed.js`
Expected: all `AF-COLLAPSE-*` PASS, and every pre-existing case (including `AF-V070-CLOSED-1`, which uses tiny 1-item groups, well under the default threshold) still PASSES.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/activity-feed/activity-feed.js platform/test/run-activity-feed.js
git commit -m "feat(activity-feed): count-based default-collapse threshold (default 3)"
```

---

## Task 8: `daily` — Activity allowlist gains wiki + project docs; sticky-note loses its always-open special-case

**Files:**
- Modify: `platform/blueprints/daily/helpers/space-daily-dashboard.js`
- Test: `platform/test/run-daily-dashboard.js`

- [ ] **Step 1: Write the failing tests**

Find `run-daily-dashboard.js`'s existing test(s) that assert against `_DEFAULT_DASHBOARD_BLUEPRINTS` / `bucketByBlueprint` (grep the file for `_DEFAULT_DASHBOARD_BLUEPRINTS` first to find the right insertion point and the harness's `loadClass`/`ok`/`assertTrue` helper names, then match that file's existing convention exactly). Add:

```javascript
// SDD-ALLOWLIST-1: wiki-page, wiki-section, doc-note are in the Activity allowlist.
{
  const inst = new SpaceDailyDashboard();
  const list = inst._DEFAULT_DASHBOARD_BLUEPRINTS;
  ok('SDD-ALLOWLIST-1a wiki-page is allowlisted', list.includes('wiki-page'));
  ok('SDD-ALLOWLIST-1b wiki-section is allowlisted', list.includes('wiki-section'));
  ok('SDD-ALLOWLIST-1c doc-note is allowlisted', list.includes('doc-note'));
}
// SDD-ALLOWLIST-2: bucketByBlueprint folds wiki-page + wiki-section into "wiki".
{
  const pages = [
    { type: 'wiki-page' }, { type: 'wiki-section' }, { type: 'wiki-page' },
  ];
  const buckets = SpaceDailyDashboard.bucketByBlueprint(pages);
  ok('SDD-ALLOWLIST-2 wiki-page + wiki-section fold into one "wiki" bucket of 3', buckets.wiki === 3 && !('wiki-page' in buckets) && !('wiki-section' in buckets));
}
// SDD-ALLOWLIST-3: _BLUEPRINT_COLORS has a wiki entry.
{
  const inst = new SpaceDailyDashboard();
  ok('SDD-ALLOWLIST-3 _BLUEPRINT_COLORS has a wiki accent color', typeof inst._BLUEPRINT_COLORS.wiki === 'string' && inst._BLUEPRINT_COLORS.wiki.length > 0);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-daily-dashboard.js`
Expected: `SDD-ALLOWLIST-*` FAIL (types not yet present; `bucketByBlueprint` doesn't know about `wiki-page`/`wiki-section` yet).

- [ ] **Step 3: Widen the allowlist**

In `platform/blueprints/daily/helpers/space-daily-dashboard.js`, in `get _DEFAULT_DASHBOARD_BLUEPRINTS()`, change:

```javascript
    return [
      "sticky-note", "journal",
      "project", "person", "team", "product", "trip",
      "budget", "paycheck", "invoice",
      "kanban", "board-card",
      "cowork-morning-briefing", "cowork-midday-tripwire", "cowork-eod-review",
      "cowork-finance-snapshot", "cowork-weekly-review", "cowork-monthly-review"
    ];
```

to:

```javascript
    // v0.14.0 (2026-07-11 daily/home audit cycle): wiki-page/wiki-section/
    // doc-note added — wiki edits and project docs were previously INVISIBLE
    // to Activity (allowlist filter runs before rollup logic, so an
    // un-listed type never enters the query at all, not even via rollup).
    // doc-note needs no new rollup rule: it already lives under
    // spice/projects/<slug>/..., which the existing project rollup rule
    // (see _ROLLUP_RULES below) already matches by path, so it folds into
    // its parent project's hub card automatically once selectable.
    //
    // NOTE for future blueprint authors: any NEW per-day auto-created "hub"
    // note type (the sticky-day/to-do shape) MUST be excluded here — see the
    // v0.5.2/v0.5.3 comments above for precedent. Audited 2026-07-11: no
    // such gap exists today across any subscribed blueprint.
    return [
      "sticky-note", "journal",
      "project", "person", "team", "product", "trip",
      "budget", "paycheck", "invoice",
      "kanban", "board-card",
      "wiki-page", "wiki-section", "doc-note",
      "cowork-morning-briefing", "cowork-midday-tripwire", "cowork-eod-review",
      "cowork-finance-snapshot", "cowork-weekly-review", "cowork-monthly-review"
    ];
```

- [ ] **Step 4: Fold `wiki-section` into `wiki` in `bucketByBlueprint`**

In `bucketByBlueprint(pages)`, change:

```javascript
  static bucketByBlueprint(pages) {
    const bucket = (t) => {
      if (!t) return "(unknown)";
      const s = String(t);
      if (s === "project" || s.startsWith("project-")) return "project";
      if (s === "trip" || s.startsWith("trip-")) return "trip";
      return s;
    };
```

to:

```javascript
  static bucketByBlueprint(pages) {
    const bucket = (t) => {
      if (!t) return "(unknown)";
      const s = String(t);
      if (s === "project" || s.startsWith("project-")) return "project";
      if (s === "trip" || s.startsWith("trip-")) return "trip";
      if (s === "wiki-page" || s === "wiki-section") return "wiki";
      return s;
    };
```

- [ ] **Step 5: Add the same bucketing rule to `_buildActivityOpts`'s `bucketRules`, plus color + groupOrder**

In `_buildActivityOpts`, find:

```javascript
      bucketRules: [
        { bucketKey: "cowork", match: (t) => typeof t === "string" && t.indexOf("cowork-") === 0 },
      ],
      groupOrder: ["cowork", "project", "kanban", "trip"],
```

Change to:

```javascript
      bucketRules: [
        { bucketKey: "cowork", match: (t) => typeof t === "string" && t.indexOf("cowork-") === 0 },
        { bucketKey: "wiki", match: (t) => t === "wiki-page" || t === "wiki-section" },
      ],
      groupOrder: ["cowork", "project", "wiki", "kanban", "trip"],
```

In `get _BLUEPRINT_COLORS()`, add a `wiki` entry (reusing `--color-yellow`, currently only claimed by `product` — see the design doc's color-reuse rationale):

```javascript
      product:   "var(--color-yellow)",
      wiki:      "var(--color-yellow)",
```

(insert the `wiki:` line directly after the existing `product:` line, inside the returned object.)

Also add `"wiki": "Wiki"` to the existing `groupLabels` opt in `_buildActivityOpts` (find `groupLabels: { "sticky-note": "Sticky Notes" },` and change to `groupLabels: { "sticky-note": "Sticky Notes", "wiki": "Wiki" },`).

- [ ] **Step 6: Remove the sticky-note always-open special-case**

In `_buildActivityOpts`, find:

```javascript
      // Sticky-note group now opens by default (was defaultClosed) and renders
      // oldest-first so the day's sticky notes read in the order they were
      // taken. See the "Daily Hub Sticky Notes" card.
      defaultClosed: [],
      ascendingGroups: ["sticky-note"],
```

Change `defaultClosed: []` to remain `[]` (no change needed there — the static list was ALREADY empty; the special-casing was implicit via `defaultClosed:[]` never forcing anything closed, relying entirely on there being no count-based rule). Update the comment only, since Task 7's `collapseThreshold` (default 3) now governs sticky-note's open/closed state just like every other group:

```javascript
      // Sticky-note renders oldest-first so the day's sticky notes read in
      // the order they were taken. Open/closed-by-default now follows the
      // SAME count-based collapseThreshold every other group uses (Task 7,
      // 2026-07-11 audit cycle) — no more special-casing here.
      defaultClosed: [],
      ascendingGroups: ["sticky-note"],
```

- [ ] **Step 7: Run test to verify it passes**

Run: `node platform/test/run-daily-dashboard.js`
Expected: all `SDD-ALLOWLIST-*` PASS, no regressions in existing dashboard cases.

- [ ] **Step 8: Commit**

```bash
git add platform/blueprints/daily/helpers/space-daily-dashboard.js platform/test/run-daily-dashboard.js
git commit -m "feat(daily): surface wiki edits + project docs in the Activity panel"
```

---

## Task 9: Install heal — migrate existing Daily/Home notes to the new chrome bars

**Files:**
- Modify: `platform/install.js` (new `_healDailyChromeBody`/`_healHomeChromeBody` pure transforms + `applyDailyHomeChromeBarHeal` async driver + call site)
- Test: `platform/test/run-daily-home-chrome-bar-heal.js` (new, mirrors `run-project-chrome-bar-heal.js`)

- [ ] **Step 1: Read the exact precedent before writing anything**

Read `platform/install.js` lines 6204–6239 (`_healWikiChromeBody`) and lines 3715–3924 (`_projectChromeBarBody` + `applyProjectChromeBarHeal`), and `platform/test/run-project-chrome-bar-heal.js` lines 1–70 and 260–290, to confirm the exact idempotency-guard regex, `.sauce-backup` path format, and history-event shape before writing the new functions below — this task's code must match that shape exactly, not approximate it.

- [ ] **Step 2: Write the failing test**

Create `platform/test/run-daily-home-chrome-bar-heal.js`:

```javascript
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const installSrc = fs.readFileSync(path.join(ROOT, 'platform/install.js'), 'utf8');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

function makeAdapter(initial) {
  const files = new Map(Object.entries(initial || {}));
  const dirs = new Set();
  return {
    async exists(p) { return files.has(p) || dirs.has(p); },
    async read(p) { if (!files.has(p)) throw new Error('ENOENT ' + p); return files.get(p); },
    async write(p, b) { files.set(p, b); },
    async mkdir(p) { dirs.add(p); },
    _files: files,
  };
}
const makeTp = (adapter) => ({ app: { vault: { adapter } } });
const GIT = { commit: null, tag: null, dirty: null };

const LEGACY_DAILY = `---
type: cowork-daily
day: "2026-07-08"
day_label: "Wednesday, July 8, 2026"
created_at: "2026-07-08T08:00:00-0700"
cssclasses:
  - wide
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceDailyDashboard" });
\`\`\`

---
`;

const LEGACY_HOME = `---
type: home
cssclasses:
  - wide
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceHome" });
\`\`\`

[//]: # (HOME_CHROME_END)
`;

async function run() {
  const m = installSrc.match(/async function applyDailyHomeChromeBarHeal\(tp, manifest, variables, history, git\) \{[\s\S]*?\n\}\n/);
  if (!m) { ok('DHH-0 applyDailyHomeChromeBarHeal exists in install.js', false); console.log(`\n0/1 passed`); process.exit(1); }

  // DHH-1: daily note migrates — one DailyChromeBar block, no SpaceNavButtons, no literal ---.
  {
    const p = 'spice/daily/2026/07-July/Wednesday-2026-07-08.md';
    const adapter = makeAdapter({ [p]: LEGACY_DAILY });
    const history = [];
    const { applyDailyHomeChromeBarHeal } = eval('(function(){' + installSrc.replace(/^#!.*\n/, '') + '\nreturn { applyDailyHomeChromeBarHeal };})()');
    await applyDailyHomeChromeBarHeal(makeTp(adapter), { name: 'daily' }, {}, history, GIT);
    const after = adapter._files.get(p);
    ok('DHH-1a daily migrated: one DailyChromeBar block', (after.match(/class:\s*"DailyChromeBar"/g) || []).length === 1);
    ok('DHH-1b daily migrated: no SpaceNavButtons block remains', !after.includes('class: "SpaceNavButtons"'));
    ok('DHH-1c daily migrated: no literal --- chrome divider remains', !/^-{3,}\s*$/m.test(after.split('---\n')[2] || ''));
    ok('DHH-1d .sauce-backup written for the daily note', [...adapter._files.keys()].some((k) => k.startsWith('.sauce-backup/') && k.endsWith('/' + p)));
    ok('DHH-1e history event logged for the daily note', history.some((h) => h.step === 'daily_home_chrome_bar_heal' && h.action === 'migrated' && h.target === p));
  }

  // DHH-2: home note migrates — one HomeChromeBar block, no SpaceNavButtons.
  {
    const p = 'spice/home/Home.md';
    const adapter = makeAdapter({ [p]: LEGACY_HOME });
    const history = [];
    const { applyDailyHomeChromeBarHeal } = eval('(function(){' + installSrc.replace(/^#!.*\n/, '') + '\nreturn { applyDailyHomeChromeBarHeal };})()');
    await applyDailyHomeChromeBarHeal(makeTp(adapter), { name: 'home' }, {}, history, GIT);
    const after = adapter._files.get(p);
    ok('DHH-2a home migrated: one HomeChromeBar block', (after.match(/class:\s*"HomeChromeBar"/g) || []).length === 1);
    ok('DHH-2b home migrated: no SpaceNavButtons block remains', !after.includes('class: "SpaceNavButtons"'));
    ok('DHH-2c home migrated: HOME_CHROME_END marker preserved', after.includes('[//]: # (HOME_CHROME_END)'));
  }

  // DHH-3: idempotent — second pass on already-migrated bodies is a byte-for-byte no-op.
  {
    const p1 = 'spice/daily/2026/07-July/Wednesday-2026-07-08.md';
    const p2 = 'spice/home/Home.md';
    const adapter = makeAdapter({ [p1]: LEGACY_DAILY, [p2]: LEGACY_HOME });
    const { applyDailyHomeChromeBarHeal } = eval('(function(){' + installSrc.replace(/^#!.*\n/, '') + '\nreturn { applyDailyHomeChromeBarHeal };})()');
    await applyDailyHomeChromeBarHeal(makeTp(adapter), { name: 'daily' }, {}, [], GIT);
    const afterFirst1 = adapter._files.get(p1), afterFirst2 = adapter._files.get(p2);
    await applyDailyHomeChromeBarHeal(makeTp(adapter), { name: 'daily' }, {}, [], GIT);
    ok('DHH-3 second pass is a no-op (byte-identical)', adapter._files.get(p1) === afterFirst1 && adapter._files.get(p2) === afterFirst2);
  }

  const failed = results.filter(([, c]) => !c);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.error(`FAILED: ${failed.map(([n]) => n).join(', ')}`); process.exit(1); }
  process.exit(0);
}
run();
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node platform/test/run-daily-home-chrome-bar-heal.js`
Expected: FAIL — `applyDailyHomeChromeBarHeal` doesn't exist in `install.js` yet.

- [ ] **Step 4: Write the two pure body transforms**

In `platform/install.js`, near `_healWikiChromeBody` (same file region), add:

```javascript
// _healDailyChromeBody(body) — pure transform. Rewrites a legacy Daily note
// (type: cowork-daily) that still has the old SpaceNavButtons block into the
// new DailyChromeBar block, stripping the literal "---" chrome dividers the
// old template used (DailyChromeBar's trailing hairline divider now owns
// that boundary — see chrome-bar's Task 2). Idempotent: a note that already
// has a DailyChromeBar block is returned unchanged.
function _healDailyChromeBody(body) {
  if (/class:\s*"DailyChromeBar"/.test(body)) return body;
  let out = body;
  // Strip the legacy SpaceNavButtons block.
  out = out.replace(/```dataviewjs\n(?:\/\/[^\n]*\n)?await dv\.view\("[^"]*",\s*\{\s*class:\s*"SpaceNavButtons"\s*\}\);\n```\n?/g, "");
  // Strip literal "---" chrome dividers (blank-line-tolerant) between the
  // frontmatter close and the SpaceDailyDashboard block, and any trailing one.
  out = out.replace(/^\s*-{3,}[ \t]*\r?\n\s*/m, "");
  out = out.replace(/(```dataviewjs\nawait dv\.view\("[^"]*",\s*\{\s*class:\s*"SpaceDailyDashboard"\s*\}\);\n```\n)\s*-{3,}[ \t]*\r?\n?\s*$/, "$1");
  const barBlock = '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "DailyChromeBar" });\n```\n';
  const fm = out.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  const head = fm ? out.slice(0, fm[0].length) : "";
  let rest = fm ? out.slice(fm[0].length) : out;
  rest = rest.replace(/^\s*/, "");
  return head + (head ? "\n" : "") + barBlock + "\n" + rest;
}

// _healHomeChromeBody(body) — pure transform. Rewrites a legacy Home.md
// (type: home) that still has the old SpaceNavButtons block into the new
// HomeChromeBar block, preserving the HOME_CHROME_END marker verbatim.
// Idempotent: a note that already has a HomeChromeBar block is returned
// unchanged.
function _healHomeChromeBody(body) {
  if (/class:\s*"HomeChromeBar"/.test(body)) return body;
  let out = body;
  out = out.replace(/```dataviewjs\n(?:\/\/[^\n]*\n)?await dv\.view\("[^"]*",\s*\{\s*class:\s*"SpaceNavButtons"\s*\}\);\n```\n?/g, "");
  out = out.replace(/^\s*-{3,}[ \t]*\r?\n\s*/m, "");
  const barBlock = '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "HomeChromeBar" });\n```\n';
  const fm = out.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  const head = fm ? out.slice(0, fm[0].length) : "";
  let rest = fm ? out.slice(fm[0].length) : out;
  rest = rest.replace(/^\s*/, "");
  return head + (head ? "\n" : "") + barBlock + "\n" + rest;
}
```

- [ ] **Step 5: Write the async driver**

Add, near `applyProjectChromeBarHeal` (matching its exact backup/history/summary shape):

```javascript
// applyDailyHomeChromeBarHeal(tp, manifest, variables, history, git) — walks
// every Daily note (type: cowork-daily under the daily module_directory) and
// Home.md (type: home), rewriting legacy SpaceNavButtons chrome to the new
// DailyChromeBar/HomeChromeBar block via the pure transforms above.
// .sauce-backup-first, idempotent, never throws. Ungated (runs on every
// install) — both transforms are self-guarding no-ops on already-migrated
// bodies, matching applyProjectChromeBarHeal's precedent.
async function applyDailyHomeChromeBarHeal(tp, manifest, variables, history, git) {
  const adapter = tp.app.vault.adapter;
  const ts = (git && git.commit) ? String(git.commit).slice(0, 8) : String(Date.now());
  let healed = 0, skipped = 0, warned = 0;

  const candidates = [];
  try {
    const walk = async (dir) => {
      let entries;
      try { entries = await adapter.list(dir); } catch (_e) { return; }
      for (const f of (entries && entries.files) || []) if (f.endsWith(".md")) candidates.push(f);
      for (const d of (entries && entries.folders) || []) await walk(d);
    };
    if (await adapter.exists("spice/daily")) await walk("spice/daily");
  } catch (_e) { /* best-effort discovery */ }
  if (await adapter.exists("spice/home/Home.md")) candidates.push("spice/home/Home.md");

  for (const fpath of candidates) {
    let before;
    try { before = await adapter.read(fpath); } catch (_e) { continue; }
    const isHome = fpath === "spice/home/Home.md";
    const after = isHome ? _healHomeChromeBody(before) : _healDailyChromeBody(before);
    if (after === before) { skipped++; continue; }
    const backupPath = `.sauce-backup/${ts}/${fpath}`;
    const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
    try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
    try { await adapter.write(backupPath, before); } catch (_e) { /* best-effort */ }
    try {
      await adapter.write(fpath, after);
      healed++;
      history.push({ event: "info", step: "daily_home_chrome_bar_heal", target: fpath, action: "migrated" });
    } catch (e) {
      warned++;
      history.push({ event: "warning", step: "daily_home_chrome_bar_heal", target: fpath, reason: (e && e.message) || String(e) });
    }
  }
  history.push({ event: "info", step: "daily_home_chrome_bar_heal", name: "vault", summary: { healed, skipped, warned } });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node platform/test/run-daily-home-chrome-bar-heal.js`
Expected: all `DHH-*` PASS.

If `DHH-1c` fails on the exact `---`-stripping regex against the real `LEGACY_DAILY` fixture, adjust the regex to match the fixture precisely (the fixture has a `---` immediately after the frontmatter's closing `---`, then the SpaceNavButtons block, then another `---`, then SpaceDailyDashboard, then a trailing `---`) — iterate the regex against THIS fixture until green rather than guessing further variants blind.

- [ ] **Step 7: Wire the call site into the main install flow**

In `platform/install.js`, find the heal-chain block (around the existing sequence ending in `await applyHomeScaffoldHeal(tp, history, git);` / `await applyReaderScaffoldHeal(tp, history, git);`). Add the new call AFTER `applyHomeScaffoldHeal` (Home must already be scaffolded before this heal can find it) and BEFORE `applyReaderScaffoldHeal`:

```javascript
  await applyHomeScaffoldHeal(tp, history, git);
  await applyDailyHomeChromeBarHeal(tp, mech, variables, history, git);
  await applyReaderScaffoldHeal(tp, history, git);
```

- [ ] **Step 8: Self-install dogfood**

Run: `node platform/install.js --vault . --auto-approve`
Expected: exits clean; check the workshop's own `spice/daily/**/*.md` and `spice/home/Home.md` (if present in this workshop vault — dogfood applies to whatever the workshop's OWN vault subscription contains) now render `DailyChromeBar`/`HomeChromeBar` instead of `SpaceNavButtons`.

- [ ] **Step 9: Commit**

```bash
git add platform/install.js platform/test/run-daily-home-chrome-bar-heal.js
git commit -m "feat(install): heal existing Daily/Home notes onto the new chrome bars"
```

---

## Task 10: Full preflight + bumped-state check

**Files:** none (verification-only task)

- [ ] **Step 1: Run the canonical preflight**

Run: `npm run release:preflight`
Expected: every harness green, including all NEW files added in Tasks 1–9 (`release:preflight` globs `platform/test/run-*.js`, so the new files are picked up automatically — verify this is true by checking `package.json`'s `release:preflight` script definition if the count doesn't match expectations).

- [ ] **Step 2: Run the bumped-state check**

Run: `npm run release:preflight-bumped`
Expected: green on a clean tree (this task's own worktree should already be clean after Task 9's commit — if not, commit first). This catches any hardcoded-version-literal wedge before merge, per `build-test-verify.md`.

- [ ] **Step 3: Re-run workshop self-install (final dogfood pass)**

Run: `node platform/install.js --vault . --auto-approve`
Expected: clean exit, no new warnings beyond Task 9's expected `daily_home_chrome_bar_heal` info events.

- [ ] **Step 4: If anything failed in Steps 1–3, fix forward and re-run from Step 1 — do not proceed to Task 11 on red.**

---

## Task 11: Push, open PR, wait for CI, merge, then follow the release pipeline through to consumer deploy

**Files:** none (process-only task)

- [ ] **Step 1: Push the branch**

This work happens directly on `worktree-bridge-cse_017zYhzaPsr3BR5RmnkDJPMh` (the current worktree branch — already isolated, no new worktree needed).

```bash
git push -u origin worktree-bridge-cse_017zYhzaPsr3BR5RmnkDJPMh
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat: daily/home ChromeBar migration + Activity coverage (wiki + docs)" --body "$(cat <<'EOF'
## Summary
- ChromeBar mechanism gains a persistent Home button + trailing hairline divider + adapter.dayNav support (vault-wide — every ChromeBar surface gets these).
- Daily note + Home page migrate off SpaceNavButtons onto new DailyChromeBar/HomeChromeBar adapters. Daily's chrome bar replaces the breadcrumb slot with smart day-nav (grey-out at either end of the daily-note run).
- Activity panel's blueprint allowlist gains wiki-page, wiki-section, doc-note — previously invisible entirely (allowlist filter runs before rollup, so un-listed types never even entered the query).
- Activity feed gains a count-based default-collapse threshold (default 3) applied uniformly to every group, replacing the sticky-note-specific always-open special-case.
- Install heal migrates existing Daily/Home notes on every subscribed vault.

Design: `Docs/plans/2026-07-11-daily-home-nav-activity-design.md`
Plan: `Docs/plans/2026-07-11-daily-home-nav-activity-plan.md`

## Test plan
- [x] `npm run release:preflight` green
- [x] `npm run release:preflight-bumped` green
- [x] Workshop self-install dogfood clean
EOF
)"
```

- [ ] **Step 3: Watch CI until green**

Use the Monitor tool (poll loop) or repeated `gh pr checks <PR#>` calls until both `preflight (macos-latest)` and `preflight (ubuntu-latest)` report success. If either goes red, read the failing job's log (`gh run view <run-id> --log-failed`), fix forward on this branch, push, and wait again — do not merge on red.

- [ ] **Step 4: Merge the PR**

```bash
gh pr merge <PR#> --squash
```

- [ ] **Step 5: Wait for the automated release pipeline**

Per `Docs/agent-guides/build-test-verify.md` § Release workflow, merging to `main` triggers, with ZERO further manual action: `prepare-release` bumps every version record and opens a release PR with GitHub auto-merge enabled → the release PR's required checks pass → it auto-squash-merges → `tag-and-ship` tags `v<X.Y.Z>`, patches the homebrew tap formula, and auto-merges the tap PR. **Do not merge the release PR or the tap PR by hand** — both are explicitly the pipeline's job (`build-test-verify.md` §§ "What Claude does (and does NOT do)" and "How the pipeline works" step 4). Poll `gh pr list --repo willfell/sauce --state all --search "chore(release)"` and `gh pr list --repo willfell/homebrew-sauce --state all` until both show `MERGED`, and confirm a new `v<X.Y.Z>` tag exists via `gh api repos/willfell/sauce/tags` (or `git ls-remote --tags origin`).

- [ ] **Step 6: Update brew + deploy to all 3 consumer vaults**

Once the tap PR is merged (confirmed in Step 5):

```bash
brew update && brew upgrade sauce
```

Then, for each of the three consumer vaults (paths from `Docs/agent-guides/vault-paths.md`), run:

```bash
bash -c 'cd <accuris-vault-path> && sauce update --bump-pins'
bash -c 'cd <headspace-vault-path> && sauce update --bump-pins'
bash -c 'cd <ero-vault-path> && sauce update --bump-pins'
```

This is a MODIFICATION of already-subscribed components (`chrome-bar`, `daily`, `home`, `activity-feed`) — no new `ranch/platform-subscription.json` entries are needed on any consumer vault (per the design doc's Rollout section). If any vault's pins are ahead of what `--bump-pins` will touch (a stale-pin mismatch per the `lesson_redeploy_version_bump_needs_pin_bump` memory), diff that vault's `ranch/platform-subscription.json` against the newly-brewed `libexec/platform/manifest.json` catalogue and bump exactly the stale entries, then retry.

- [ ] **Step 7: Verify each vault landed the new version**

For each vault, confirm the Daily and Home notes now render the new chrome (grep the vault's `.obsidian/plugins/customjs/...` scripts dir, or a live note's rendered dataviewjs class name, for `DailyChromeBar`/`HomeChromeBar`), and that a wiki/doc edit made today shows up under a "Wiki" group in that day's Activity panel.

- [ ] **Step 8: Only after Steps 1–7 all confirm green/merged/deployed, report back to the user** with: the PR number, the shipped version, and a one-paragraph summary of what changed — per the user's explicit instruction not to report back any earlier than this.

---

## Self-Review Notes (already applied above)

- **Spec coverage:** every design-doc bullet (Home button, trailing divider, day-nav grey-out, Daily/Home ChromeBar adoption, activity-feed collapse threshold, wiki/doc-note allowlist + bucketing + color, daily-hub-pollution doc note, install heal) has a corresponding task.
- **Type consistency:** `DailyChromeBar._config()` / `HomeChromeBar._config()` both return the exact `{ detect, surfaceSpec, dispatch, destinations, rootClass, btnClass }` shape `ChromeBar.makeAdapter` already consumes (verified against `WikiChromeBar`'s precedent in Task 4/6's read-first step); `dayNav` is the one NEW key, and Task 3 Step 5 explicitly patches `makeAdapter` to forward it — Task 4 depends on that patch landing first (task order matters: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11).
- **No placeholders:** every step has literal code, exact file paths, and exact run commands with expected outcomes.
