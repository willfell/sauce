# chrome-bar Mechanism Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the ProjectChromeBar chrome system (button look, chrome glyphs, Vault-entries builder, full bar render) into a new shared `chrome-bar` mechanism, and consolidate the registry ordering rule into `nav-buttons` — a strictly no-behavior-change dedupe so every blueprint can render the identical `Go ▾ / primary / ⋯` bar from one place.

**Architecture:** A new `ChromeBar` customJS mechanism owns `renderChromeButton`, `CHROME_ICONS`, `vaultEntries(dv, open)`, and `render(dv, adapter)`. `SpaceNavButtons` gains a pure `firstEntryPerSource(registry)` (the single ordering impl) that `ChromeBar.vaultEntries` consumes. `ProjectChromeBar` keeps all project-specific logic and shrinks to a thin adapter (`resolve`/`navEntries`/`dispatch`/`openNavTarget`/`rootClass`/`btnClass`) whose `render` delegates to `ChromeBar.render`. Because the adapter feeds back the same `pcb-root`/`pcb-btn` marker classes + identical icons/labels/handlers, the rendered DOM is byte-identical.

**Tech Stack:** CustomJS classes (no imports/exports; filesystem-scanned; instantiated → all methods are INSTANCE methods). Node test harnesses via `new Function` loader. Design doc: `Docs/plans/2026-07-06-chrome-bar-mechanism-extraction-design.md`.

**Base:** worktree `sauce-chrome-bar` on branch `feat/chrome-bar-mechanism` off `origin/main` (v0.196.0).

**Global rules for every task:**
- Work only in the worktree `/Users/willfellhoelter/projects/repos/sauce-chrome-bar`.
- Verbatim moves = copy the exact bytes from the current worktree file (it already IS the origin/main reference). Do not retype SVGs or bodies from memory.
- NEVER hand-bump `workshop_version` / `package.json` version / existing component versions / existing subscription pins. The ONLY version records this plan hand-authors are the NEW `chrome-bar` entries (initial `0.1.0`) — that is legitimate new-component registration, not a bump.
- customjs classes are INSTANCE methods; internal calls use `this.`; tests drive `new ClassName()`.

---

### Task 1: nav-buttons — single ordering rule (`_sortNavEntries` + `firstEntryPerSource`)

**Files:**
- Modify: `platform/mechanisms/nav-buttons/space-nav-buttons.js` (methods `_orderedEntries` ~line 74; add two methods)
- Test: `platform/test/run-nav-launcher.js` (append NL-firstEntryPerSource cases)

- [ ] **Step 1: Write the failing test** — append to `platform/test/run-nav-launcher.js` BEFORE its final summary/`process.exit` block:

```js
// ── firstEntryPerSource: ONE representative per source, sorted (order, source, id) ──
{
  const reg = { contributions: {
    zeta:  [{ id: 'z1', label: 'Z', order: 100, action: { type: 'openLink', target: 'z.md' } }],
    alpha: [{ id: 'a1', label: 'A', order: 100, action: { type: 'openLink', target: 'a.md' } },
            { id: 'a2', label: 'A2', order: 100, action: { type: 'openLink', target: 'a2.md' } }],
    mid:   [{ id: 'm1', label: 'M', order: 50,  action: { type: 'openLink', target: 'm.md' } }],
  } };
  const reps = inst.firstEntryPerSource(reg);
  ok('NL-FEPS-1 one entry per source (a source with 2 contributions yields 1 rep)',
    reps.length === 3);
  ok('NL-FEPS-2 each rep is tagged with its _source',
    reps.every((r) => typeof r._source === 'string') &&
    reps.filter((r) => r._source === 'alpha').length === 1);
  ok('NL-FEPS-3 the alpha rep is that source\'s registry list[0] (id a1, not a2)',
    (reps.find((r) => r._source === 'alpha') || {}).id === 'a1');
  ok('NL-FEPS-4 ordered by (order, source, id): mid(50) first, then alpha, then zeta',
    reps[0]._source === 'mid' && reps[1]._source === 'alpha' && reps[2]._source === 'zeta');
  ok('NL-FEPS-5 empty/absent contributions → []',
    inst.firstEntryPerSource({}).length === 0 &&
    inst.firstEntryPerSource({ contributions: {} }).length === 0);
}
```

Note: `inst` is the existing `SpaceNavButtons` instance already constructed near the top of `run-nav-launcher.js` (the file that tests `_orderedEntries`). If the existing instance variable is named differently (e.g. `inst2`), reuse whichever instance the `_orderedEntries` NL cases use.

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-nav-launcher.js`
Expected: FAIL — `inst.firstEntryPerSource is not a function`.

- [ ] **Step 3: Implement** — in `platform/mechanisms/nav-buttons/space-nav-buttons.js`, replace the existing `_orderedEntries(registry)` method with the refactor below AND add the two new methods immediately after it:

```js
  // The ONE canonical nav comparator — null-safe. Sorts a COPY by
  // (order ?? 100, source, id). Identical output to the prior inline comparators
  // for well-formed registries (every _source/id present). Pure; Node-testable.
  _sortNavEntries(entries) {
    return (entries || []).slice().sort((a, b) =>
      (a.order ?? 100) - (b.order ?? 100)
      || String(a._source || "").localeCompare(String(b._source || ""))
      || String(a.id || "").localeCompare(String(b.id || "")));
  }

  // Flatten registry.contributions.<source>[] into a single array tagged with
  // _source, sorted by (order, source, id). Pure; Node-testable.
  _orderedEntries(registry) {
    const entries = [];
    const contributions = (registry && registry.contributions) || {};
    for (const [source, btns] of Object.entries(contributions)) {
      if (!Array.isArray(btns)) continue;
      for (const btn of btns) entries.push({ ...btn, _source: source });
    }
    return this._sortNavEntries(entries);
  }

  // ONE representative entry per source (the registry's list[0]), tagged _source,
  // sorted by (order, source, id). This is exactly what a Go-launcher Vault
  // section needs; consumed by ChromeBar.vaultEntries so the ordering rule lives
  // in one place. Pure; Node-testable.
  firstEntryPerSource(registry) {
    const reps = [];
    const contributions = (registry && registry.contributions) || {};
    for (const [src, list] of Object.entries(contributions)) {
      if (!Array.isArray(list) || list.length === 0) continue;
      reps.push({ ...list[0], _source: src });
    }
    return this._sortNavEntries(reps);
  }
```

(Leave `_partitionEntries` and every other method exactly as-is.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node platform/test/run-nav-launcher.js`
Expected: PASS — all NL-* including NL-FEPS-1..5. Also confirm the pre-existing NL cases for `_orderedEntries`/`_partitionEntries` still pass (they exercise the refactored comparator).

- [ ] **Step 5: Commit**

```bash
cd /Users/willfellhoelter/projects/repos/sauce-chrome-bar
git add platform/mechanisms/nav-buttons/space-nav-buttons.js platform/test/run-nav-launcher.js
git commit -m "refactor(nav-buttons): single ordering rule — _sortNavEntries + firstEntryPerSource"
```

---

### Task 2: Scaffold the `chrome-bar` mechanism (files + registration + loadable)

**Files:**
- Create: `platform/mechanisms/chrome-bar/manifest.json`
- Create: `platform/mechanisms/chrome-bar/chrome-bar.js`
- Create: `platform/test/run-chrome-bar.js`
- Modify: `platform/manifest.json` (add to `mechanisms[]` catalogue)
- Modify: `ranch/platform-subscription.json` (workshop dogfood — add mechanism)
- Modify: `platform/test/seed-vault/ranch/platform-subscription.json` (seed vault — add mechanism)
- Modify: `package.json` (`scripts."test:chrome-bar"` + append to `release:preflight`)

- [ ] **Step 1: Create `platform/mechanisms/chrome-bar/manifest.json`**

```json
{
  "name": "chrome-bar",
  "version": "0.1.0",
  "kind": "mechanism",
  "description": "Shared per-surface chrome bar. customJS.ChromeBar.render(dv, adapter) draws the breadcrumb-left + Go/primary/overflow-right control the project button-nav-refactor introduced, parameterized by a per-blueprint adapter (resolve/navEntries/dispatch/openNavTarget/rootClass/btnClass) so every blueprint renders the identical bar from ONE place. Also exposes renderChromeButton (the 32px icon-first hover-lift/press-scale button look), CHROME_ICONS (compass/chevronDown/moreHorizontal), and vaultEntries(dv, open) — the Go launcher's Vault section built from every registered nav-registry source, ordered via SpaceNavButtons.firstEntryPerSource and rendered as MenuPopover's 2-column grid.",
  "depends_on": [
    { "name": "nav-buttons", "range": ">=2.14.0" },
    { "name": "menu-popover", "range": ">=0.2.0" },
    { "name": "breadcrumb", "range": ">=0.1.0" },
    { "name": "render-safe", "range": ">=0.1.0" },
    { "name": "icons", "range": ">=0.1.0" }
  ],
  "customjs_classes": [
    "ChromeBar"
  ],
  "files": [
    {
      "source": "chrome-bar.js",
      "dest": "{{scripts_path}}/chrome-bar/chrome-bar.js"
    }
  ],
  "post_install": [],
  "rule_fragments": []
}
```

- [ ] **Step 2: Create `platform/mechanisms/chrome-bar/chrome-bar.js`** — the class shell with `CHROME_ICONS` only (methods added in Tasks 3-5). Copy the three SVG strings VERBATIM from the current `platform/blueprints/project/helpers/project-chrome-bar.js` `ICON` getter entries `compass`, `chevronDown`, `moreHorizontal`.

```js
/**
 * ChromeBar (CustomJS) — the shared per-surface chrome bar.
 *
 * The blueprint-agnostic extraction of ProjectChromeBar's chrome system: the
 * breadcrumb-left + Go/primary/overflow-right control, its button look, the
 * chrome glyphs, and the Go launcher's Vault section. Any blueprint renders the
 * identical bar by handing render(dv, adapter) an adapter that supplies the
 * blueprint-specific parts (which surface, what controls, where nav points, what
 * actions do, and its own marker classes). ProjectChromeBar is the first consumer.
 *
 * customJS class — NO imports/exports; loaded by the filesystem scan; the plugin
 * stores it as an INSTANCE, so every method is an INSTANCE method (internal calls
 * use this.*). Every method is never-throw + cold-load-safe.
 */
class ChromeBar {
  // ── CHROME_ICONS — the bar's own control glyphs (compass = Go, chevronDown =
  // the Go caret, moreHorizontal = the ⋯ overflow). Blueprint-destination glyphs
  // stay with each blueprint's helper.
  get CHROME_ICONS() {
    return {
      compass: `<PASTE compass SVG VERBATIM FROM project-chrome-bar.js ICON.compass>`,
      chevronDown: `<PASTE chevronDown SVG VERBATIM FROM project-chrome-bar.js ICON.chevronDown>`,
      moreHorizontal: `<PASTE moreHorizontal SVG VERBATIM FROM project-chrome-bar.js ICON.moreHorizontal>`,
    };
  }
}
```

- [ ] **Step 3: Register in `platform/manifest.json`** — add to the `mechanisms` array (keep it adjacent to `menu-popover` for readability; array order is not significant):

```json
{ "name": "chrome-bar", "version": "0.1.0", "path": "mechanisms/chrome-bar" }
```

- [ ] **Step 4: Subscribe in both subscription files** — add this object to the `mechanisms` array in BOTH `ranch/platform-subscription.json` AND `platform/test/seed-vault/ranch/platform-subscription.json`:

```json
{ "name": "chrome-bar", "version": "0.1.0" }
```

- [ ] **Step 5: Register the test** — in `package.json`:
  - Add to `scripts`: `"test:chrome-bar": "node platform/test/run-chrome-bar.js"`
  - Append to the END of the `release:preflight` chain: ` && node platform/test/run-chrome-bar.js`

- [ ] **Step 6: Create `platform/test/run-chrome-bar.js`** — loader + a smoke case (the method cases land in Tasks 3-5). Mirror the `run-menu-popover.js` loader (customjs classes have no module system; drive `new ChromeBar()`):

```js
#!/usr/bin/env node
/**
 * run-chrome-bar.js — ChromeBar is the shared per-surface chrome bar mechanism.
 * Drives the REAL ChromeBar (loaded via new Function — no module system in
 * customJS) against DOM + customJS stubs. ChromeBar is an INSTANCE (customJS
 * stores instances), so every case uses `new ChromeBar()`.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(relPath, className) {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  return new Function(`${src}\nreturn ${className};`)();
}
const ChromeBar = loadClass('platform/mechanisms/chrome-bar/chrome-bar.js', 'ChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new ChromeBar();

// Minimal element supporting createEl (Obsidian) + appendChild/createElement +
// querySelector/getBoundingClientRect. Mirrors run-project-chrome-bar.js makeEl.
function makeEl(tag) {
  const el = { tag, textContent: '', innerHTML: '', className: '', style: { cssText: '', setProperty() {} }, children: [], onclick: null, disabled: false };
  el.createEl = (t, opts) => { const c = makeEl(t); if (opts && opts.cls) c.className = opts.cls; if (opts && opts.text) c.textContent = opts.text; el.children.push(c); return c; };
  el.appendChild = (c) => { el.children.push(c); return c; };
  el.querySelector = () => null;
  el.querySelectorAll = () => [];
  el.getBoundingClientRect = () => ({ left: 0, bottom: 0, width: 100 });
  el.remove = () => {};
  el.addEventListener = () => {};
  el.removeEventListener = () => {};
  return el;
}
function allDescendants(el) { const out = []; for (const c of (el.children || [])) { out.push(c); out.push(...allDescendants(c)); } return out; }

// ── CB-SMOKE-1 — CHROME_ICONS exposes the three control glyphs as SVG strings.
{
  const ic = inst.CHROME_ICONS;
  ok('CB-SMOKE-1 CHROME_ICONS has compass/chevronDown/moreHorizontal SVGs',
    ic && /svg/.test(ic.compass) && /svg/.test(ic.chevronDown) && /svg/.test(ic.moreHorizontal));
}

// ── (Task 3 appends CB-BTN-*, Task 4 CB-VAULT-*, Task 5 CB-RENDER-* here) ──
// PLACEHOLDER-ANCHOR: additional cases inserted above the summary block below.

function summarize() {
  const failed = results.filter(([, c]) => !c);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.error(`FAILED: ${failed.map(([n]) => n).join(', ')}`); process.exit(1); }
  process.exit(0);
}
summarize();
```

Note: Tasks 3-5 add async cases; when the first async case is added, convert the tail so `summarize()` runs AFTER the async chain resolves (mirror run-project-chrome-bar.js's `finish()`/`runRenderCases()` pattern). For this scaffold, the synchronous `summarize()` is correct.

- [ ] **Step 7: Verify loadable + registered**

Run: `node platform/test/run-chrome-bar.js`
Expected: PASS — CB-SMOKE-1.
Run: `node platform/test/run-customjs-loadable.js`
Expected: PASS (ChromeBar is a valid, loadable customjs class).

- [ ] **Step 8: Commit**

```bash
cd /Users/willfellhoelter/projects/repos/sauce-chrome-bar
git add platform/mechanisms/chrome-bar/ platform/test/run-chrome-bar.js platform/manifest.json ranch/platform-subscription.json platform/test/seed-vault/ranch/platform-subscription.json package.json
git commit -m "feat(chrome-bar): scaffold new mechanism (manifest, class shell, registration, test)"
```

---

### Task 3: `ChromeBar.renderChromeButton` (the button look)

**Files:**
- Modify: `platform/mechanisms/chrome-bar/chrome-bar.js` (add method)
- Modify: `platform/test/run-chrome-bar.js` (add CB-BTN cases + async-safe tail if needed)

- [ ] **Step 1: Write the failing tests** — insert at the PLACEHOLDER-ANCHOR in `run-chrome-bar.js`:

```js
// ── CB-BTN-1..4 — renderChromeButton: caller-supplied cls, icon-only vs labeled,
// onClick wiring, hover/press motion handlers.
{
  const parent = makeEl('div');
  let clicked = 0;
  const btn = inst.renderChromeButton(parent, { cls: 'pcb-btn pcb-btn-go', icon: '<svg id="i"/>', onClick: () => { clicked += 1; } });
  ok('CB-BTN-1 button carries the caller-supplied cls verbatim', btn.className === 'pcb-btn pcb-btn-go');
  ok('CB-BTN-2 icon-only (no label) → innerHTML has the icon, no label span',
    (btn.innerHTML || '').indexOf('<svg id="i"/>') >= 0 && (btn.innerHTML || '').indexOf('<span') < 0);
  if (typeof btn.onclick === 'function') btn.onclick();
  ok('CB-BTN-3 onClick is wired to btn.onclick', clicked === 1);
  ok('CB-BTN-4 wires hover-lift + press-scale handlers + a CSS transition',
    typeof btn.onmouseenter === 'function' && typeof btn.onmouseleave === 'function' &&
    typeof btn.onmousedown === 'function' && typeof btn.onmouseup === 'function' &&
    /transition:/.test(btn.style.cssText || ''));
}
{
  const parent = makeEl('div');
  const btn = inst.renderChromeButton(parent, { cls: 'pcb-btn pcb-btn-primary', label: 'New Task', icon: '<svg/>', onClick: () => {} });
  ok('CB-BTN-5 labeled button renders the label inside a span', (btn.innerHTML || '').indexOf('New Task') >= 0 && (btn.innerHTML || '').indexOf('<span') >= 0);
}
```

- [ ] **Step 2: Run to verify fail**

Run: `node platform/test/run-chrome-bar.js`
Expected: FAIL — `inst.renderChromeButton is not a function`.

- [ ] **Step 3: Implement** — add `renderChromeButton` to `ChromeBar`. Copy the BODY VERBATIM from the current `ProjectChromeBar._renderChromeButton` (in `project-chrome-bar.js`), with exactly TWO changes: (a) the button class comes from `opts.cls` (not the hardcoded `pcb-btn pcb-btn-${opts.variant}`), and (b) drop the `variant` references. Structure:

```js
  // ── renderChromeButton — the bar's own button look ──────────────────────────
  // 32px, icon-first, hover-lift + press-scale micro-motion. The CALLER supplies
  // opts.cls (its marker class, e.g. "pcb-btn pcb-btn-go") so each blueprint's
  // rendered DOM stays byte-identical. Icon-only when opts.label is omitted.
  // opts: { cls, label?, icon?, onClick }.
  renderChromeButton(parent, opts) {
    const o = opts || {};
    const btn = parent.createEl("button", { cls: o.cls || "sc-chrome-btn" });
    const hasLabel = !!o.label;
    const iconHtml = o.icon || "";
    const labelHtml = hasLabel
      ? `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;">${o.label}</span>`
      : "";
    btn.innerHTML = iconHtml + labelHtml;
    const EASE = "cubic-bezier(0.2, 0.9, 0.25, 1)";
    btn.style.cssText = "cursor: pointer; display: inline-flex; align-items: center; justify-content: center;"
      + " gap: 6px; height: 32px; box-sizing: border-box;"
      + ` padding: 0 ${hasLabel ? "16" : "12"}px;`
      + (hasLabel ? "" : " min-width: 38px;")
      + " border-radius: 8px; border: 1px solid var(--interactive-accent);"
      + " background: var(--background-primary); color: var(--interactive-accent);"
      + " font-size: 0.82em; font-weight: 500; font-family: inherit; letter-spacing: 0.01em;"
      + " overflow: hidden; transform: scale(1); box-shadow: none;"
      + ` transition: background 0.15s ${EASE}, color 0.15s ${EASE}, border-color 0.15s ${EASE},`
      + ` box-shadow 0.15s ${EASE}, transform 0.15s ${EASE};`;
    btn.onmouseenter = () => {
      if (btn.disabled) return;
      btn.style.background = "var(--interactive-accent)";
      btn.style.color = "var(--text-on-accent)";
      btn.style.boxShadow = "0 2px 10px rgba(0, 0, 0, 0.14)";
    };
    btn.onmouseleave = () => {
      if (btn.disabled) return;
      btn.style.background = "var(--background-primary)";
      btn.style.color = "var(--interactive-accent)";
      btn.style.boxShadow = "none";
      btn.style.transform = "scale(1)";
    };
    btn.onmousedown = () => { if (!btn.disabled) btn.style.transform = "scale(0.94)"; };
    btn.onmouseup = () => { if (!btn.disabled) btn.style.transform = "scale(1)"; };
    btn.onclick = o.onClick;
    return btn;
  }
```

Verify the copied style/motion bytes match the source `_renderChromeButton` exactly (diff them): the only intended differences are the class source and removal of `variant`.

- [ ] **Step 4: Run to verify pass**

Run: `node platform/test/run-chrome-bar.js`
Expected: PASS — CB-SMOKE-1, CB-BTN-1..5.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/chrome-bar/chrome-bar.js platform/test/run-chrome-bar.js
git commit -m "feat(chrome-bar): renderChromeButton — shared bar button look"
```

---

### Task 4: `ChromeBar.vaultEntries` (the Go-launcher Vault section)

**Files:**
- Modify: `platform/mechanisms/chrome-bar/chrome-bar.js` (add async method + async-safe test tail)
- Modify: `platform/test/run-chrome-bar.js` (add CB-VAULT cases)

- [ ] **Step 1: Write the failing tests** — insert at the PLACEHOLDER-ANCHOR. Since `vaultEntries` is async, this is the point to convert the test tail to run `summarize()` after the async chain (mirror run-project-chrome-bar.js: wrap async cases in an IIFE that calls `summarize()` at the end; move the synchronous cases before it). Add:

```js
// ── CB-VAULT-1..4 — vaultEntries reads the registry, delegates ordering to
// SpaceNavButtons.firstEntryPerSource, emits a { section:"Vault", layout:"grid" }
// marker + one entry per source, openLink→open / else→_dispatchAction, []-when-empty.
async function cbVaultCases() {
  const registryJson = JSON.stringify({ schema_version: 1, contributions: {
    project:  [{ id: 'projects-hub', label: 'Projects', icon: 'projects', order: 100, action: { type: 'openLink', target: 'spice/projects/Projects.md' } }],
    'to-do':  [{ id: 'todo-today', label: 'To Do', icon: 'todo', order: 110, action: { type: 'runTemplaterTemplate', template_source: 'x' } }],
  } });
  const opened = [];
  const dispatched = [];
  const prevApp = global.app, prevCJS = global.customJS;
  global.app = { vault: { adapter: { read: async (p) => (p === 'ranch/nav-buttons-registry.json' ? registryJson : (() => { throw new Error('ENOENT'); })()) } } };
  global.customJS = {
    Icons: { resolve: () => '<svg/>' },
    SpaceNavButtons: {
      // The REAL ordering rule: delegate to a genuine SpaceNavButtons instance so
      // this test also locks the chrome-bar→nav-buttons ordering contract.
      firstEntryPerSource: (reg) => {
        const reps = [];
        for (const [src, list] of Object.entries((reg && reg.contributions) || {})) {
          if (Array.isArray(list) && list.length) reps.push({ ...list[0], _source: src });
        }
        return reps.sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a._source.localeCompare(b._source));
      },
      _dispatchAction: (entry) => dispatched.push(entry),
    },
  };
  const entries = await inst.vaultEntries({ current: () => ({ file: { path: 'x.md' } }) }, (p) => opened.push(p));
  global.app = prevApp; global.customJS = prevCJS;

  ok('CB-VAULT-1 first element is the { section:"Vault", layout:"grid" } marker',
    entries[0] && entries[0].section === 'Vault' && entries[0].layout === 'grid');
  const rows = entries.filter((e) => e && !('section' in e));
  ok('CB-VAULT-2 one row per registry source', rows.length === 2);
  ok('CB-VAULT-3 every row carries an onSelect handler', rows.every((e) => typeof e.onSelect === 'function'));
  // openLink row → open(target); non-openLink row → SpaceNavButtons._dispatchAction.
  const projRow = rows.find((e) => e.label === 'Projects');
  const todoRow = rows.find((e) => e.label === 'To Do');
  if (projRow) projRow.onSelect();
  if (todoRow) todoRow.onSelect();
  ok('CB-VAULT-4 openLink→open(target), non-openLink→_dispatchAction',
    opened.length === 1 && opened[0] === 'spice/projects/Projects.md' && dispatched.length === 1);
}
async function cbVaultEmpty() {
  const prevApp = global.app, prevCJS = global.customJS;
  global.app = { vault: { adapter: { read: async () => { throw new Error('ENOENT'); } } } };
  global.customJS = { SpaceNavButtons: { firstEntryPerSource: () => [] }, Icons: { resolve: () => '' } };
  const entries = await inst.vaultEntries({ current: () => ({ file: { path: 'x.md' } }) }, () => {});
  global.app = prevApp; global.customJS = prevCJS;
  ok('CB-VAULT-5 no registry / no sources → [] (no Vault marker)', Array.isArray(entries) && entries.length === 0);
}
```

- [ ] **Step 2: Run to verify fail**

Run: `node platform/test/run-chrome-bar.js`
Expected: FAIL — `inst.vaultEntries is not a function`.

- [ ] **Step 3: Implement** — add `vaultEntries` to `ChromeBar`. Copy the Vault-section logic VERBATIM from the current `ProjectChromeBar._navEntries` (the block from `let registry = null;` through the `entries.push({ section: "Vault", layout: "grid" })` loop), adapted to: read the registry itself, call `customJS.SpaceNavButtons.firstEntryPerSource(registry)` instead of the inline `bySource`/`sort`, and RETURN the built array (rather than pushing into a caller's `entries`).

```js
  // ── vaultEntries — the Go launcher's Vault section ──────────────────────────
  // Reads ranch/nav-buttons-registry.json (raw — no cache, matching the prior
  // inline read), delegates ordering to SpaceNavButtons.firstEntryPerSource (the
  // single ordering rule), maps each source's representative entry to
  // { label, icon, onSelect } (openLink → open(target); else →
  // SpaceNavButtons._dispatchAction so Templater/command actions behave exactly
  // like the vault nav bar), and returns [{ section:"Vault", layout:"grid" },
  // ...dests] — or [] when the registry is absent/empty. Never throws.
  async vaultEntries(dv, open) {
    let registry = null;
    try {
      const raw = await app.vault.adapter.read("ranch/nav-buttons-registry.json");
      registry = JSON.parse(raw);
    } catch (_e) { registry = null; }

    const iconFor = (name) => {
      try { return (customJS.Icons && customJS.Icons.resolve && customJS.Icons.resolve(name)) || ""; }
      catch (_e) { return ""; }
    };
    let reps = [];
    try {
      if (customJS && customJS.SpaceNavButtons && typeof customJS.SpaceNavButtons.firstEntryPerSource === "function") {
        reps = customJS.SpaceNavButtons.firstEntryPerSource(registry) || [];
      }
    } catch (_e) { reps = []; }

    const vaultDests = [];
    for (const entry of reps) {
      const action = (entry && entry.action) || {};
      const label = (entry && entry.label) || (entry && entry._source) || "";
      const icon = iconFor(entry && entry.icon);
      if (action.type === "openLink" && action.target) {
        const target = action.target;
        vaultDests.push({ label, icon, onSelect: () => { try { open(target); } catch (_e) {} } });
      } else {
        const dispatchEntry = entry;
        vaultDests.push({ label, icon, onSelect: () => {
          try {
            if (customJS && customJS.SpaceNavButtons && typeof customJS.SpaceNavButtons._dispatchAction === "function") {
              customJS.SpaceNavButtons._dispatchAction(dispatchEntry, dv);
            }
          } catch (_e) { /* never throw */ }
        } });
      }
    }

    const out = [];
    if (vaultDests.length > 0) {
      out.push({ section: "Vault", layout: "grid" });
      for (const d of vaultDests) out.push(d);
    }
    return out;
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `node platform/test/run-chrome-bar.js`
Expected: PASS — CB-SMOKE-1, CB-BTN-*, CB-VAULT-1..5.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/chrome-bar/chrome-bar.js platform/test/run-chrome-bar.js
git commit -m "feat(chrome-bar): vaultEntries — Go launcher Vault section (delegates ordering to nav-buttons)"
```

---

### Task 5: `ChromeBar.render(dv, adapter)` (the full bar)

**Files:**
- Modify: `platform/mechanisms/chrome-bar/chrome-bar.js` (add async method)
- Modify: `platform/test/run-chrome-bar.js` (add CB-RENDER cases)

- [ ] **Step 1: Write the failing tests** — insert into the async chain in `run-chrome-bar.js`:

```js
// ── CB-RENDER-1..5 — render(dv, adapter): guards, adapter.resolve gate, root/btn
// classes from the adapter, Go/primary/⋯ wiring to adapter.navEntries/dispatch.
async function cbRenderCases() {
  const prevApp = global.app, prevCJS = global.customJS, prevAD = global.activeDocument;
  const menuOpens = [];
  global.activeDocument = { body: makeEl('body'), createElement: (t) => makeEl(t), addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
  global.app = { isMobile: false, workspace: { openLinkText() {}, getLeaf: () => ({ openFile() {} }) } };
  global.customJS = {
    RenderSafe: { page: (dv) => (dv && dv.current ? dv.current() : null) },
    Breadcrumb: { buildSegments: async () => ([{ label: 'Projects', link: 'p.md' }, { label: 'Docs', link: null }]) },
    MenuPopover: { open: (entries, opts) => { menuOpens.push({ entries, opts }); return makeEl('div'); } },
  };
  const dispatched = [];
  const navEntries = [{ section: 'This project' }, { label: 'Board', onSelect() {} }, { section: 'Vault', layout: 'grid' }, { label: 'Home', onSelect() {} }];
  const adapter = {
    resolve: (dv, page) => ({ ctx: { context: 'docs-hub' }, spec: { primary: { id: 'new-doc', label: 'New Doc', icon: '<svg/>' }, overflow: [{ id: 'move-docs', label: 'Move', icon: '<svg/>' }], leaf: false } }),
    navEntries: async () => navEntries,
    dispatch: (dv, ctx, id) => dispatched.push(id),
    openNavTarget: () => {},
    rootClass: 'pcb-root',
    btnClass: (v) => `pcb-btn pcb-btn-${v}`,
  };
  const container = makeEl('div');
  const dv = { container, current: () => ({ file: { path: 'spice/projects/x/docs/Docs.md', name: 'Docs' } }) };
  await inst.render(dv, adapter);

  const desc = allDescendants(container);
  const root = desc.find((e) => e.className && String(e.className).includes('pcb-root'));
  ok('CB-RENDER-1 dedupe root uses adapter.rootClass (pcb-root)', !!root);
  const goBtn = desc.find((e) => e.className && String(e.className).includes('pcb-btn-go'));
  const primaryBtn = desc.find((e) => e.className && String(e.className).includes('pcb-btn-primary'));
  const dotsBtn = desc.find((e) => e.className && String(e.className).includes('pcb-btn-dots'));
  ok('CB-RENDER-2 renders Go (pcb-btn-go), primary (pcb-btn-primary), ⋯ (pcb-btn-dots) via adapter.btnClass', !!goBtn && !!primaryBtn && !!dotsBtn);
  ok('CB-RENDER-3 renders a breadcrumb sub-div', desc.some((e) => e.className && String(e.className).includes('project-breadcrumb')));
  if (goBtn && typeof goBtn.onclick === 'function') await goBtn.onclick();
  ok('CB-RENDER-4 clicking Go calls MenuPopover.open with the adapter.navEntries', menuOpens.length === 1 && menuOpens[0].entries === navEntries);
  if (primaryBtn && typeof primaryBtn.onclick === 'function') primaryBtn.onclick();
  ok('CB-RENDER-5 clicking primary routes to adapter.dispatch with the primary id', dispatched.includes('new-doc'));

  // adapter.resolve → null renders nothing.
  const c2 = makeEl('div');
  const nullAdapter = Object.assign({}, adapter, { resolve: () => null });
  await inst.render({ container: c2, current: () => ({ file: { path: 'x.md', name: 'x' } }) }, nullAdapter);
  ok('CB-RENDER-6 adapter.resolve → null renders nothing', allDescendants(c2).length === 0);

  global.app = prevApp; global.customJS = prevCJS; global.activeDocument = prevAD;
}
```

- [ ] **Step 2: Run to verify fail**

Run: `node platform/test/run-chrome-bar.js`
Expected: FAIL — `inst.render is not a function` (or the CB-RENDER asserts fail).

- [ ] **Step 3: Implement** — add `render(dv, adapter)` to `ChromeBar`. Copy the BODY of the current `ProjectChromeBar.render(dv)` (in `project-chrome-bar.js`), transformed per the design §Architecture step-list:
  - `const ICON = ProjectChromeBar.ICON;` → `const ICON = this.CHROME_ICONS;`
  - after the RenderSafe/container/embed guards, replace `const ctx = this.detectContext(...); if (non-project/unknown) return; const spec = this._surfaceSpec(...)` with:
    `const resolved = adapter.resolve(dv, page); if (!resolved) return; const ctx = resolved.ctx; const spec = resolved.spec;`
  - dedupe root: `querySelector(":scope > ." + adapter.rootClass)` and `createEl("div", { cls: adapter.rootClass })`
  - breadcrumb ancestor click: `this._... ` → `adapter.openNavTarget(target, dv)`
  - Go button: `this._renderChromeButton(right, { variant:"go", ... })` → `this.renderChromeButton(right, { cls: adapter.btnClass("go"), icon: goIcon, onClick: ... })`; keep `goIcon = "<span…>" + ICON.compass + ICON.chevronDown + "</span>"`; keep the `MenuPopover.open(navEntries, { anchor: goBtn, title: "Go to" })` wiring but source `navEntries` from `await adapter.navEntries(dv, ctx)`.
  - primary: `this.renderChromeButton(right, { cls: adapter.btnClass("primary"), label: p.label, icon: p.icon, onClick: () => adapter.dispatch(dv, ctx, p.id) })`
  - ⋯: `this.renderChromeButton(right, { cls: adapter.btnClass("dots"), icon: ICON.moreHorizontal, onClick: ... })` with the overflow menu mapping `onSelect: () => adapter.dispatch(dv, ctx, o.id)`.
  - Keep the `root.style.cssText = "margin-bottom: 12px;"`, the bar flex styles, the breadcrumb rendering loop, and all never-throw guards VERBATIM.

The method signature is `async render(dv, adapter)`. Guard `adapter` (never-throw): if `!adapter || typeof adapter.resolve !== "function"` return.

- [ ] **Step 4: Run to verify pass**

Run: `node platform/test/run-chrome-bar.js`
Expected: PASS — all CB-* cases.

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/chrome-bar/chrome-bar.js platform/test/run-chrome-bar.js
git commit -m "feat(chrome-bar): render(dv, adapter) — the full shared chrome bar"
```

---

### Task 6: Repoint `ProjectChromeBar` at `ChromeBar` (thin adapter)

**Files:**
- Modify: `platform/blueprints/project/helpers/project-chrome-bar.js`
- Modify: `platform/blueprints/project/manifest.json` (add `chrome-bar` to `depends_on`)
- Modify: `platform/test/run-project-chrome-bar.js` (render-case customJS stub gains a real `ChromeBar`)

- [ ] **Step 1: Update the render-case stub** — in `platform/test/run-project-chrome-bar.js`, the render cases (`runRenderCases`) build a `global.customJS` stub. Add a `ChromeBar` entry pointing at the REAL class (loaded via the same `loadClass` helper at the top of the file):

At the top, after the existing `ProjectChromeBar = loadClass(...)`:
```js
const ChromeBar = loadClass('platform/mechanisms/chrome-bar/chrome-bar.js', 'ChromeBar');
```
In the `global.customJS = { … }` inside `runRenderCases`, add:
```js
  ChromeBar: new ChromeBar(),
```
Remove the `AccentButton` stub ONLY if it is no longer referenced by any surviving assertion (the origin render cases already find controls by `pcb-btn-<variant>` class, not by spying AccentButton — verify by grep; if an `AccentButton` spy is still asserted, leave it). The render cases already stub `Breadcrumb`, `MenuPopover`, `SpaceNavButtons._dispatchAction`, `RenderSafe`, `SectionLabel` — those remain and are consumed by the real ChromeBar.render.

- [ ] **Step 2: Run to verify it fails** (ProjectChromeBar still has its own render, so ChromeBar isn't exercised yet — the render cases should still pass here; this step confirms the stub wiring doesn't break anything BEFORE the swap):

Run: `node platform/test/run-project-chrome-bar.js`
Expected: PASS (unchanged) — this is a pre-swap safety checkpoint, not a red test. If it FAILS, the stub wiring is wrong; fix before proceeding.

- [ ] **Step 3: Implement the swap** in `platform/blueprints/project/helpers/project-chrome-bar.js`:

  (a) In the `ICON` getter, REMOVE the `compass`, `chevronDown`, `moreHorizontal` entries (they now live in `ChromeBar.CHROME_ICONS`). Keep every project-destination glyph.

  (b) DELETE the entire `_renderChromeButton` method.

  (c) REPLACE the whole `async render(dv)` method with the thin delegating version + a new `_adapter()` helper:

```js
  // ── _adapter — the ChromeBar adapter for the project blueprint ───────────────
  // Supplies the blueprint-specific parts; ChromeBar.render owns the generic bar.
  _adapter() {
    return {
      resolve: (dv, page) => {
        const filePath = (page && page.file && page.file.path) || "";
        const ctx = this.detectContext(filePath, dv);
        if (ctx.context === "non-project" || ctx.context === "unknown") return null;
        return { ctx, spec: this._surfaceSpec(ctx.context) };
      },
      navEntries: (dv, ctx) => this._navEntries(dv, ctx),
      dispatch: (dv, ctx, id) => this._dispatch(dv, ctx, id),
      openNavTarget: (path, dv) => this._openNavTarget(path, dv),
      rootClass: "pcb-root",
      btnClass: (v) => `pcb-btn pcb-btn-${v}`,
    };
  }

  // ── render — delegate the shared bar to the ChromeBar mechanism ──────────────
  async render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.render !== "function") return;
      return await customJS.ChromeBar.render(dv, this._adapter());
    } catch (_e) { /* never throw */ }
  }
```

  (d) In `_navEntries`, REPLACE the entire `// ── Vault ──` block (the `let registry = null;` read through the `entries.push({ section: "Vault", layout: "grid" })` loop) with:

```js
    // ── Vault ── delegated to the shared ChromeBar mechanism (single source of
    // the all-registry-sources + ordering + grid-marker logic).
    try {
      if (customJS && customJS.ChromeBar && typeof customJS.ChromeBar.vaultEntries === "function") {
        const vault = await customJS.ChromeBar.vaultEntries(dv, open);
        for (const e of vault) entries.push(e);
      }
    } catch (_e) { /* never throw */ }
```

Keep the `// ── This project ──` loop and the local `open`/`currentPath` setup in `_navEntries` exactly as-is.

- [ ] **Step 4: Add the dependency** — in `platform/blueprints/project/manifest.json`, add to `depends_on`:

```json
{ "name": "chrome-bar", "range": ">=0.1.0" }
```

- [ ] **Step 5: Run the project contract tests**

Run: `node platform/test/run-project-chrome-bar.js`
Expected: PASS — all PCB-SPEC / PCB-OPEN / PCB-DISPATCH / PCB-NAV-1*/1g / PCB-NAV-3* / PCB-RENDER / PCB-STYLE-1* (the render + style cases now flow through the real ChromeBar via the stub, producing byte-identical `pcb-root`/`pcb-btn` DOM).
Run: `node platform/test/run-project-commands.js`
Expected: PASS (ProjectCommandsInit reuses `_dispatch`/`navTarget`/`_openNavTarget`, all unchanged).
Run: `node platform/test/run-project-nav-buttons.js`
Expected: PASS.

If any PCB-RENDER/PCB-STYLE case fails, the swap diverged from byte-identical — diff the produced DOM against the pre-swap output and reconcile (do NOT weaken the assertion).

- [ ] **Step 6: Commit**

```bash
git add platform/blueprints/project/helpers/project-chrome-bar.js platform/blueprints/project/manifest.json platform/test/run-project-chrome-bar.js
git commit -m "refactor(project): ProjectChromeBar delegates to the chrome-bar mechanism (thin adapter)"
```

---

### Task 7: Docs — mark ChromeBar canonical

**Files:**
- Modify: `Docs/agent-guides/note-chrome.md` (§1c)
- Modify: `Docs/agent-guides/project-blueprint-ui.md` (pointer to the new mechanism)

- [ ] **Step 1: Update `note-chrome.md` §1c** — append a paragraph noting that the `Go ▾ / primary / ⋯` bar is now rendered by the shared **`chrome-bar` mechanism (`customJS.ChromeBar`)**, canonical for all blueprints wanting this bar; ProjectChromeBar is a thin adapter; **`AccentButton` stays the primitive for one-off buttons elsewhere** (chrome-bar's `renderChromeButton` is only for the 3 bar controls). Note the ordering rule lives once in `SpaceNavButtons.firstEntryPerSource`. Keep it to ~4-6 sentences; do not duplicate the design doc.

- [ ] **Step 2: Update `project-blueprint-ui.md`** — add a one-line pointer under the shared-primitives section: the project chrome bar is rendered by the `chrome-bar` mechanism (`ChromeBar.render(dv, adapter)`); ProjectChromeBar supplies the adapter. Link the design doc.

- [ ] **Step 3: Lint docs pass**

Run: `node scripts/lint-note-chrome.js`
Expected: PASS (docs edits don't affect templates, but confirm no regression).

- [ ] **Step 4: Commit**

```bash
git add Docs/agent-guides/note-chrome.md Docs/agent-guides/project-blueprint-ui.md Docs/plans/2026-07-06-chrome-bar-mechanism-extraction-design.md Docs/plans/2026-07-06-chrome-bar-mechanism-extraction-plan.md
git commit -m "docs(chrome-bar): mark ChromeBar canonical for Go/primary/overflow chrome + land design+plan"
```

---

### Task 8: Full preflight + visual verification

**Files:** none (verification only; fixes land in whichever task's file regressed)

- [ ] **Step 1: Run the full release preflight**

Run: `npm run release:preflight`
Expected: whole-suite GREEN, including `run-nav-launcher`, `run-menu-popover`, `run-chrome-bar`, `run-project-chrome-bar`, `run-project-commands`, `run-project-nav-buttons`, `run-customjs-loadable`, `run-install`, `run-seed`, `check-version-sync`. Any failure → fix in the owning task's file, re-commit, re-run.

- [ ] **Step 2: Visual verification (Playwright HTML harness)** — reuse the approved pattern (`lesson_verify_chrome_visually_with_playwright_harness`): build a served HTML replica that renders the ChromeBar bar via the ProjectChromeBar adapter (exact renderChromeButton CSS + CHROME_ICONS + grid Vault popover), serve over `python3 -m http.server`, screenshot at desktop + 390px, and confirm the Go/primary/⋯ bar + grid Vault popover are pixel-identical to the pre-extraction bar (compare against a screenshot rendered from `origin/main`'s ProjectChromeBar). Since the extraction is byte-identical by construction, this is a confirmation gate, not a design pass.

- [ ] **Step 3: Confirm clean tree + push**

```bash
cd /Users/willfellhoelter/projects/repos/sauce-chrome-bar
git status --short   # expect clean
git log --oneline origin/main..HEAD   # expect the 5 feature commits
git push -u origin feat/chrome-bar-mechanism
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --repo <origin> --base main --head feat/chrome-bar-mechanism \
  --title "feat(chrome-bar): extract shared ChromeBar mechanism from ProjectChromeBar" \
  --body "<summary: extraction, no-behavior-change, decisions, tests, deploy note>"
```

---

## Self-Review

**Spec coverage:**
- nav-buttons `firstEntryPerSource` + single comparator → Task 1. ✓
- chrome-bar mechanism (renderChromeButton, CHROME_ICONS, vaultEntries, render(dv, adapter)) → Tasks 2-5. ✓
- ProjectChromeBar thin adapter + keeps project logic + ProjectCommandsInit unchanged → Task 6. ✓
- New-mechanism registration (manifest catalogue, both subscriptions, project depends_on, preflight+package.json) → Tasks 2 & 6. ✓
- Tests byte-for-byte (PCB-*, MP-*, NL-*, new CB-*) → Tasks 1-6, gated in Task 8. ✓
- Docs (note-chrome §1c, project-blueprint-ui) → Task 7. ✓
- Visual verification → Task 8. ✓
- Deploy (new mechanism → subscriptions + `sauce update`) → post-merge runbook (below), out of PR scope. ✓
- Wiki adoption plan-only → design §7 (not implemented). ✓

**Placeholder scan:** SVG bodies in Task 2 are explicit "PASTE VERBATIM FROM <file> <entry>" instructions (the exact source is in the worktree) — not open-ended TBDs. Verbatim-move steps name the exact source method + the exact transformations. No "add error handling"/"similar to Task N".

**Type consistency:** adapter shape `{ resolve, navEntries, dispatch, openNavTarget, rootClass, btnClass }` is identical in Task 5 (consumer), Task 5 tests, and Task 6 (`_adapter`). `firstEntryPerSource(registry)` signature identical in Task 1 (impl), Task 4 (consumer + test stub). `renderChromeButton(parent, opts{cls,label,icon,onClick})` identical in Tasks 3 & 5. `vaultEntries(dv, open)` identical in Tasks 4 & 6. `CHROME_ICONS` getter identical in Tasks 2, 3, 5. ✓

---

## Post-merge deploy runbook (executed after the feature PR merges + auto-release ships)

1. **Wait for auto-release.** The bumper opens/auto-merges the release PR, tags, and ships to the brew tap automatically. Do NOT merge the release PR / tap PR / create tags by hand. Watch `gh pr list` + `gh run list` until the release PR merges and the new `v0.19x.0` tag exists on `origin`.
2. **Wait for brew to serve it.** `brew update && brew info sauce` shows the new version. (Transient `brew update` failures → just re-run.)
3. **Upgrade brew:** `brew upgrade sauce` (ensure `/opt/homebrew/bin` is on PATH).
4. **New mechanism → subscribe each consumer.** For accuris, headspace, ero: add `{ "name": "chrome-bar", "version": "<released chrome-bar version>" }` to that vault's `ranch/platform-subscription.json` `mechanisms` array (the released version = whatever the bumper assigned chrome-bar; read it from the brewed `libexec/platform/manifest.json`).
5. **Install per vault:** `cd <vault> && sauce update --force` (cwd-ancestor detection wins; `SAUCE_VAULT` ignored). Because chrome-bar is a NEW dep of the already-subscribed project blueprint, `--force` reinstalls project + pulls chrome-bar. If a pin-mismatch skip occurs, bump the stale pins first (`lesson_redeploy_version_bump_needs_pin_bump`) or use `--bump-pins`.
6. **Verify per vault:** `ranch/scripts/chrome-bar/chrome-bar.js` exists; `ProjectChromeBar` renders (open a project note); the Go ▾ grid Vault popover works. Workshop dogfood self-install too.
7. **Report:** versions shipped, all 4 vaults verified, user must Cmd+R each Obsidian.
