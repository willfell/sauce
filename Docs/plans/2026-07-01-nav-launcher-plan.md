# Nav launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the always-visible, truncating multi-row blueprint button grid with a single collapsed "Go to…" launcher that opens a native Obsidian menu (bottom sheet on mobile, dropdown on desktop).

**Architecture:** Pure renderer swap inside `platform/mechanisms/nav-buttons/space-nav-buttons.js`. The registry read, entry flatten/sort, daily-arrow logic, and `_dispatchAction` are preserved. The multi-row grid block is replaced with a one-line chrome row (daily arrows + centered pill) whose pill opens a `new Menu()` built from the same ordered entries. If the `Menu` constructor is not obtainable at runtime, the pill falls back to an inline accordion panel — so correctness never depends on a live Obsidian spike.

**Tech Stack:** CustomJS class (loaded via `eval("(" + file + ")")`), Obsidian `Menu` API, DataviewJS view host, zero-dependency Node test harness.

**Design doc:** `Docs/plans/2026-07-01-nav-launcher-design.md`

**Landmine guardrails (non-negotiable):**
- File stays a **bare single class expression** — no trailing statements (CJS-LOAD preflight; `eval("(" + file + ")")` parses the whole file as one expression).
- All `customJS.*` calls **optional-chained** (cold-load safety).
- Keep the `.vault-nav` remove-before-render guard (Dataview double-execution).
- **Do NOT** hand-edit `manifest.json` `version`, `workshop_version`, `package.json`, pins, or tags — the release pipeline computes them from conventional commits.

---

## File structure

| File | Responsibility | Change |
| --- | --- | --- |
| `platform/mechanisms/nav-buttons/space-nav-buttons.js` | The renderer | Modify: extract `_orderedEntries`, add `_getMenuCtor` + `_openLauncher` + `_buildMenu` + `_renderAccordion`, rewrite the `render()` grid block into a one-line chrome row + pill | 
| `platform/test/run-nav-launcher.js` | Node regression net for the pure logic | Create |
| `package.json` | Preflight wiring | Modify: add `test:nav-launcher` + append to `release:preflight` chain |
| `platform/mechanisms/nav-buttons/manifest.json` | Prose changelog | Modify: append a description note (NO version edit) |

---

## Task 1: Extract `_orderedEntries` (pure) + regression harness

Make the flatten/sort logic a pure method so it's Node-testable, and stand up the harness. TDD: harness first (fails: method missing), then extract.

**Files:**
- Create: `platform/test/run-nav-launcher.js`
- Modify: `platform/mechanisms/nav-buttons/space-nav-buttons.js` (extract method from `render()` lines ~84–94)
- Modify: `package.json`

- [ ] **Step 1: Write the failing test** — create `platform/test/run-nav-launcher.js`:

```js
'use strict';
// Zero-dep harness for SpaceNavButtons pure logic (order + menu model + Menu ctor acquisition).
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'mechanisms', 'nav-buttons', 'space-nav-buttons.js'),
  'utf8'
);
// Load the bare class expression the same way customJS does, then hand back the ctor.
const SpaceNavButtons = new Function(`return (${SRC});`)();

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  PASS: ${name}`); } else { fail++; console.log(`  FAIL: ${name}`); } };

// ── _orderedEntries: flatten contributions + sort by (order, source, id) ──
const inst = new SpaceNavButtons();
const registry = {
  contributions: {
    zeta: [{ id: 'z1', label: 'Zeta', icon: 'board', order: 100, action: { type: 'openLink', target: 'Z.md' } }],
    alpha: [
      { id: 'a2', label: 'Alpha2', icon: 'daily', order: 50, action: { type: 'openLink', target: 'A2.md' } },
      { id: 'a1', label: 'Alpha1', icon: 'todo', order: 50, action: { type: 'openLink', target: 'A1.md' } },
    ],
  },
};
const ordered = inst._orderedEntries(registry);
ok('NL-1 flattens all contributions', ordered.length === 3);
ok('NL-2 sorts by order first (a2/a1 before z1)', ordered[2].id === 'z1');
ok('NL-3 tie on order → source then id (a1 before a2)', ordered[0].id === 'a1' && ordered[1].id === 'a2');
ok('NL-4 carries _source tag', ordered[0]._source === 'alpha');
ok('NL-5 empty/absent contributions → []', inst._orderedEntries({}).length === 0 && inst._orderedEntries({ contributions: {} }).length === 0);

console.log(`\n  ${pass} pass · ${fail} fail`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-nav-launcher.js`
Expected: FAIL — `inst._orderedEntries is not a function`.

- [ ] **Step 3: Extract `_orderedEntries` into the class**

In `space-nav-buttons.js`, add this method (place it above `render`):

```js
  // Flatten registry.contributions.<source>[] into a single array tagged with
  // _source, sorted by (order ?? 100, source, id). Pure; Node-testable.
  _orderedEntries(registry) {
    const entries = [];
    const contributions = (registry && registry.contributions) || {};
    for (const [source, btns] of Object.entries(contributions)) {
      if (!Array.isArray(btns)) continue;
      for (const btn of btns) entries.push({ ...btn, _source: source });
    }
    entries.sort((a, b) =>
      (a.order ?? 100) - (b.order ?? 100) ||
      a._source.localeCompare(b._source) ||
      a.id.localeCompare(b.id)
    );
    return entries;
  }
```

Then in `render()`, replace the inline flatten+sort (current lines ~84–93) with:

```js
    const entries = this._orderedEntries(registry);
```

(Leave the `if (entries.length === 0) return;` guard immediately after.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-nav-launcher.js`
Expected: PASS — `5 pass · 0 fail`.

- [ ] **Step 5: Wire into preflight** — in `package.json`, add a `test:nav-launcher` script and append it to the `release:preflight` chain (find the `&&`-joined chain and insert ` && npm run test:nav-launcher` after `test:registry`):

```
"test:nav-launcher": "node platform/test/run-nav-launcher.js",
```

- [ ] **Step 6: Verify preflight still green for the two nav-relevant harnesses**

Run: `node platform/test/run-registry.js && node platform/test/run-customjs-loadable.js && node platform/test/run-nav-launcher.js`
Expected: registry 18/0, CJS-LOAD ok, nav-launcher 5/0.

- [ ] **Step 7: Commit**

```bash
git add platform/test/run-nav-launcher.js platform/mechanisms/nav-buttons/space-nav-buttons.js package.json
git commit -m "test(nav-buttons): extract _orderedEntries + add run-nav-launcher harness"
```

---

## Task 2: `_getMenuCtor()` — defensive Menu acquisition + test

Acquire the Obsidian `Menu` constructor robustly, returning `null` when unavailable (→ triggers accordion fallback). TDD.

**Files:**
- Modify: `platform/test/run-nav-launcher.js`
- Modify: `platform/mechanisms/nav-buttons/space-nav-buttons.js`

- [ ] **Step 1: Add the failing test** — append before the summary line in `run-nav-launcher.js`:

```js
// ── _getMenuCtor: global Menu → require('obsidian').Menu → null ──
const inst2 = new SpaceNavButtons();
// (a) global present
globalThis.Menu = function MenuStub() {};
ok('NL-6 returns global Menu when present', inst2._getMenuCtor() === globalThis.Menu);
delete globalThis.Menu;
// (b) absent everywhere (no global, require('obsidian') throws under node) → null
ok('NL-7 returns null when Menu unobtainable', inst2._getMenuCtor() === null);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node platform/test/run-nav-launcher.js`
Expected: FAIL — `inst2._getMenuCtor is not a function`.

- [ ] **Step 3: Implement `_getMenuCtor`** — add to the class:

```js
  // Acquire the Obsidian Menu constructor. Order: bare global (Obsidian
  // globalizes several API classes in the customJS/Dataview eval context, e.g.
  // Notice) → require('obsidian').Menu → null. Never throws. Null → caller
  // uses the inline-accordion fallback.
  _getMenuCtor() {
    try { if (typeof Menu !== "undefined" && Menu) return Menu; } catch (_e) {}
    try {
      const req = (typeof require === "function") ? require : null;
      if (req) {
        const obs = req("obsidian");
        if (obs && obs.Menu) return obs.Menu;
      }
    } catch (_e) {}
    return null;
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node platform/test/run-nav-launcher.js`
Expected: PASS — `7 pass · 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add platform/test/run-nav-launcher.js platform/mechanisms/nav-buttons/space-nav-buttons.js
git commit -m "feat(nav-buttons): _getMenuCtor defensive Menu acquisition with fallback"
```

---

## Task 3: Rewrite `render()` — one-line chrome row + launcher pill

Replace the daily-arrow-row + multi-row button grid with a single chrome row: daily prev/next arrows (unchanged behavior) with a centered "Go to…" pill between them. The pill opens the native menu, or an inline accordion when `_getMenuCtor()` returns null.

**Files:**
- Modify: `platform/mechanisms/nav-buttons/space-nav-buttons.js`

- [ ] **Step 1: Restructure the chrome row.** In `render()`, keep everything through `const container = dv.el("div", "", { cls: "vault-nav" });` and its `cssText`. Keep `_readDailyNotesMeta()` call. Replace the **entire** block from the `const topRow = container.createEl("div");` daily-arrow assembly AND the subsequent `rowStyle`/`btnBase`/multi-row grid (current lines ~149–246) with a single chrome row that hosts the arrows + pill:

```js
    // ── One-line chrome row: [ ‹ prev ]   [ ⧉ Go to… ]   [ next › ] ──
    const chromeRow = container.createEl("div");
    chromeRow.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    `;

    const arrowBaseStyle = `
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--text-muted);
      font-size: 0.8em;
      font-family: inherit;
      transition: color 0.15s, background 0.15s;
    `;
    const chevronLeft = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`;
    const chevronRight = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;

    // Left slot: prev-day arrow (or an empty spacer to keep the pill centered).
    if (dailyMeta) {
      const currentFile = dv.current && dv.current();
      const fileName = (currentFile && currentFile.file && currentFile.file.name) || "";
      const dm = fileName.match(/(\d{4}-\d{2}-\d{2})/);
      const currentDate = dm ? window.moment(dm[1], "YYYY-MM-DD", true) : window.moment();
      const allDailies = app.vault.getMarkdownFiles()
        .filter(f => f.path.startsWith(dailyMeta.folder + "/"))
        .map(f => { const fdm = f.name.match(/(\d{4}-\d{2}-\d{2})/); return fdm ? { file: f, m: window.moment(fdm[1], "YYYY-MM-DD", true) } : null; })
        .filter(x => x && x.m.isValid())
        .sort((a, b) => a.m.diff(b.m));
      const earlier = allDailies.filter(x => x.m.isBefore(currentDate, "day")).pop();
      const later = allDailies.filter(x => x.m.isAfter(currentDate, "day"))[0];

      const prevBtn = chromeRow.createEl("button");
      prevBtn.innerHTML = chevronLeft + `<span>${earlier ? earlier.m.format("ddd, MMM D") : "—"}</span>`;
      prevBtn.style.cssText = arrowBaseStyle + (earlier ? "cursor: pointer;" : "opacity: 0.4; cursor: default;");
      if (earlier) {
        prevBtn.onmouseenter = () => { prevBtn.style.color = "var(--text-normal)"; prevBtn.style.background = "var(--background-modifier-hover)"; };
        prevBtn.onmouseleave = () => { prevBtn.style.color = "var(--text-muted)"; prevBtn.style.background = "transparent"; };
        prevBtn.onclick = () => app.workspace.openLinkText(earlier.file.path, "");
      }

      // Pill in the middle.
      this._renderPill(chromeRow, entries, dv);

      const nextBtn = chromeRow.createEl("button");
      nextBtn.innerHTML = `<span>${later ? later.m.format("ddd, MMM D") : "—"}</span>` + chevronRight;
      nextBtn.style.cssText = arrowBaseStyle + (later ? "cursor: pointer;" : "opacity: 0.4; cursor: default;");
      if (later) {
        nextBtn.onmouseenter = () => { nextBtn.style.color = "var(--text-normal)"; nextBtn.style.background = "var(--background-modifier-hover)"; };
        nextBtn.onmouseleave = () => { nextBtn.style.color = "var(--text-muted)"; nextBtn.style.background = "transparent"; };
        nextBtn.onclick = () => app.workspace.openLinkText(later.file.path, "");
      }
    } else {
      // No daily blueprint → pill centers alone.
      chromeRow.style.justifyContent = "center";
      this._renderPill(chromeRow, entries, dv);
    }
```

Note: this removes the old separate `topRow` daily block AND the `btnGrid`/`rows` grid. The `dailyMeta` const (from `await this._readDailyNotesMeta();`) must remain declared above this block.

- [ ] **Step 2: Add `_renderPill`** — the launcher button:

```js
  // Render the "Go to…" pill into the given row; wire its click to the launcher.
  _renderPill(row, entries, dv) {
    const pill = row.createEl("button");
    const gridIcon = (customJS.Icons?.resolve?.("layout-grid")) ||
      `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>`;
    const chevronDown = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
    pill.innerHTML = gridIcon + `<span>Go to…</span>` + chevronDown;
    pill.style.cssText = `
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 16px;
      border-radius: 6px;
      border: 1px solid var(--background-modifier-border);
      background: var(--background-primary);
      color: var(--text-muted);
      font-size: 0.82em;
      font-weight: 500;
      font-family: inherit;
      letter-spacing: 0.01em;
      transition: all 0.15s ease;
    `;
    pill.onmouseenter = () => {
      pill.style.background = "var(--interactive-accent)";
      pill.style.color = "var(--text-on-accent)";
      pill.style.borderColor = "var(--interactive-accent)";
    };
    pill.onmouseleave = () => {
      pill.style.background = "var(--background-primary)";
      pill.style.color = "var(--text-muted)";
      pill.style.borderColor = "var(--background-modifier-border)";
    };
    pill.onclick = (evt) => this._openLauncher(evt, pill, entries, dv);
  }
```

- [ ] **Step 3: Add `_openLauncher` + `_buildMenu` + `_renderAccordion`**:

```js
  // Open the launcher: native Menu if available, else inline accordion.
  _openLauncher(evt, pill, entries, dv) {
    const MenuCtor = this._getMenuCtor();
    if (MenuCtor) {
      const menu = new MenuCtor();
      this._buildMenu(menu, entries, dv);
      if (typeof menu.showAtMouseEvent === "function" && evt) menu.showAtMouseEvent(evt);
      else if (typeof menu.showAtPosition === "function") {
        const r = pill.getBoundingClientRect();
        menu.showAtPosition({ x: r.left, y: r.bottom });
      }
      return;
    }
    this._renderAccordion(pill, entries, dv);
  }

  // Populate a native Menu with one item per entry (icon + label via a
  // DocumentFragment title so we reuse the exact vendored glyphs).
  _buildMenu(menu, entries, dv) {
    for (const btn of entries) {
      menu.addItem((item) => {
        const svg = customJS.Icons?.resolve?.(btn.icon);
        if (svg) {
          const frag = document.createDocumentFragment();
          const iconSpan = document.createElement("span");
          iconSpan.innerHTML = svg;
          iconSpan.style.cssText = "display:inline-flex;align-items:center;margin-right:8px;vertical-align:middle;";
          const labelSpan = document.createElement("span");
          labelSpan.textContent = btn.label;
          frag.appendChild(iconSpan);
          frag.appendChild(labelSpan);
          item.setTitle(frag);
        } else {
          item.setTitle(btn.label);
        }
        item.onClick(() => this._dispatchAction(btn, dv));
      });
    }
  }

  // Fallback when no Menu constructor: toggle an inline panel below the pill.
  _renderAccordion(pill, entries, dv) {
    const container = pill.closest(".vault-nav");
    if (!container) return;
    const existing = container.querySelector(".vault-nav-accordion");
    if (existing) { existing.remove(); return; } // toggle closed
    const panel = container.createEl("div", { cls: "vault-nav-accordion" });
    panel.style.cssText = `
      display: flex; flex-direction: column; gap: 2px;
      margin-top: 6px; padding: 6px;
      border: 1px solid var(--background-modifier-border);
      border-radius: 6px; background: var(--background-primary);
    `;
    for (const btn of entries) {
      const row = panel.createEl("button");
      const svg = customJS.Icons?.resolve?.(btn.icon) || "";
      row.innerHTML = `<span style="display:inline-flex;align-items:center;margin-right:8px;">${svg}</span><span>${btn.label}</span>`;
      row.style.cssText = `
        cursor: pointer; display: inline-flex; align-items: center;
        gap: 4px; padding: 8px 10px; border-radius: 4px;
        border: none; background: transparent; color: var(--text-normal);
        font-size: 0.85em; font-family: inherit; text-align: left; width: 100%;
      `;
      row.onmouseenter = () => { row.style.background = "var(--background-modifier-hover)"; };
      row.onmouseleave = () => { row.style.background = "transparent"; };
      row.onclick = () => { panel.remove(); this._dispatchAction(btn, dv); };
    }
  }
```

- [ ] **Step 4: Sanity — the file still loads as one class expression**

Run: `node platform/test/run-customjs-loadable.js`
Expected: `ok CJS-LOAD` (no "Unexpected token" — proves no trailing statements crept in).

- [ ] **Step 5: Full nav test + registry**

Run: `node platform/test/run-nav-launcher.js && node platform/test/run-registry.js`
Expected: nav-launcher 7/0, registry 18/0.

- [ ] **Step 6: Commit**

```bash
git add platform/mechanisms/nav-buttons/space-nav-buttons.js
git commit -m "feat(nav-buttons): collapse nav grid into one-line Go-to launcher"
```

---

## Task 4: Manifest prose note (NO version edit)

**Files:**
- Modify: `platform/mechanisms/nav-buttons/manifest.json`

- [ ] **Step 1: Append a changelog sentence** to the end of the `description` string (do NOT touch `version`, `files`, `depends_on`, `customjs_classes`). Append:

```
 v2.9.0 MINOR (nav launcher): the always-visible multi-row button grid is replaced by a single collapsed 'Go to…' pill merged into the daily-arrow row (one chrome line); tapping it opens a native Obsidian Menu (bottom-sheet on mobile, dropdown on desktop) built from the same registry entries via _buildMenu, dispatching through the unchanged _dispatchAction. Falls back to an inline accordion when the Menu constructor is unobtainable (_getMenuCtor). Fixes mobile label truncation + reclaims ~3 rows of vertical chrome on every note. Registry/action schema/consumer declarations unchanged.
```

- [ ] **Step 2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('platform/mechanisms/nav-buttons/manifest.json','utf8')); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add platform/mechanisms/nav-buttons/manifest.json
git commit -m "docs(nav-buttons): changelog note for Go-to launcher"
```

---

## Task 5: Full preflight + workshop dogfood + bumped preflight

**Files:** none (verification only)

- [ ] **Step 1: Full preflight**

Run: `npm run release:preflight`
Expected: whole suite GREEN (includes the new `test:nav-launcher`).

- [ ] **Step 2: Workshop dogfood self-install**

Run: `node platform/install.js --vault . --auto-approve`
Expected: install completes; `ranch/scripts/nav-buttons/space-nav-buttons.js` materialized; no error entries.

- [ ] **Step 3: Confirm the materialized file matches (dogfood parity)**

Run: `diff platform/mechanisms/nav-buttons/space-nav-buttons.js ranch/scripts/nav-buttons/space-nav-buttons.js && echo "PARITY OK"`
Expected: `PARITY OK`.

- [ ] **Step 4: Bumped preflight (catches prepare-release wedges) — clean tree required**

Run: `git status --porcelain` (expect empty), then `npm run release:preflight-bumped`
Expected: green on the bumped tree; working tree hard-restored after.

---

## Post-plan: ship + deploy (driven by the operator, not a code task)

These are operational steps performed after the plan's tasks are green. Recorded here for traceability; they are NOT subagent tasks.

1. Push branch `feat/nav-launcher`; open PR against `main`.
2. Wait for CI (`preflight (macos-latest)` + `preflight (ubuntu-latest)`) → green.
3. Merge the **feature** PR (squash). This is the only manual release step.
4. Pipeline auto-runs: `prepare-release` opens the release PR → it **auto-merges** on green CI → `tag-and-ship` tags `v<X.Y.Z>`, patches the tap Formula, and **auto-merges the tap PR**. Do NOT touch the release PR except `gh pr update-branch <n>` if it is green-but-BEHIND. NEVER admin-merge the release PR.
5. Deploy to all consumers: `node scripts/autoloop/deploy.js run` (brew update + `brew upgrade sauce` + per-vault `sauce update --bump-pins` + version verify for ero, accuris, headspace).
6. Verify: each vault's `ranch/platform-installed.json` `workshop_version` equals the shipped version.

---

## Self-review

**Spec coverage:**
- One-line chrome row + centered pill → Task 3. ✓
- Native Menu reveal (bottom sheet mobile / dropdown desktop) → Task 2 (`_getMenuCtor`) + Task 3 (`_buildMenu`, `showAtMouseEvent`). ✓
- Accordion fallback when Menu unobtainable → Task 3 (`_renderAccordion`). ✓
- Reuse existing `_dispatchAction` verbatim → Task 3 (`onClick`/`onclick` call it). ✓
- Same ordered registry entries → Task 1 (`_orderedEntries`). ✓
- Icons via `customJS.Icons.resolve` (no icons bump) → Task 3 pill + menu + accordion. ✓
- Daily arrows preserved → Task 3 (arrow assembly retained inside chrome row). ✓
- Landmine guards (bare class, optional-chaining, .vault-nav guard) → Task 3 Step 4 checks CJS-LOAD; `.vault-nav` remove guard is retained from the original `render()` head. ✓
- Node tests + preflight wiring → Tasks 1–2 + Task 5. ✓
- No hand-versioning → Task 4 explicitly avoids `version`. ✓

**Placeholder scan:** none — every code step shows complete code and exact commands.

**Type consistency:** method names consistent across tasks: `_orderedEntries`, `_getMenuCtor`, `_renderPill`, `_openLauncher`, `_buildMenu`, `_renderAccordion`, `_dispatchAction` (existing), `_readDailyNotesMeta` (existing), `_resolveActionDate` (existing). `entries` is the ordered array throughout.
