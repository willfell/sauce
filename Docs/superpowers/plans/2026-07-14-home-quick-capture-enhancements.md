# Home Quick-Capture Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a conditionally-visible Journal capture button to the Home "+" quick-capture menu, gate the existing Article button the same way, fix the inline task-capture due-date bug, and fix the input-row alignment — bringing the stale `ranch/` dogfood mirror back in sync with the canonical `platform/` file along the way.

**Architecture:** All changes live in `SpaceHome` (`platform/blueprints/home/helpers/space-home.js`, mirrored byte-for-byte to `ranch/scripts/home/space-home.js`) plus one CSS rule in `.obsidian/snippets/sauce-home.css`. `_captureSpec()` stays a pure/sync method returning the full candidate button list; `render()` (already `async`) filters it via two `await cjs.EntityCreate._loadSpec(instance)` registry checks before building DOM, so gating lives at the render boundary and the spec itself stays Node-testable without async stubs. `_dispatch()` gains a `journal` branch mirroring the existing `meeting`/`sticky-note` shape.

**Tech Stack:** CustomJS (Obsidian), Dataview (`dv`), plain Node test harness (`platform/test/run-home.js`, loads the class via `new Function()` — no real module system).

---

## Current-state baseline (verified this session — corrects the design doc's assumptions)

The design doc at `docs/superpowers/specs/2026-07-14-home-quick-capture-enhancements-design.md` assumed the workshop had only `meeting` + `sticky-note` buttons and that Article was purely a live-vault/workshop parity gap. Direct inspection shows the two copies have actually **drifted apart**:

- **`platform/blueprints/home/helpers/space-home.js` (canonical, loaded by tests)** already has a 3rd `_captureSpec()` entry — `article` — added in an earlier, never-fully-finished cycle. Its dispatch branch calls `cjs.ReaderArticlePaste.open(dv)` (NOT `EntityCreate.create`), and it renders **unconditionally** (no registry gating). There is no test coverage for the article button's dispatch in `run-home.js`.
- **`ranch/scripts/home/space-home.js` (dogfood mirror)** is stale: it still has the old 2-item spec (`meeting`, `sticky-note`) and a dead `openDaily` case in `_dispatch()` that is unreachable (no captureSpec entry produces that key).
- The entity-create registry ids are confirmed: `platform/blueprints/reader/manifest.json` registers `"id": "reader-article"`; `platform/blueprints/journal/manifest.json` registers `"id": "journal-entry"`.
- `EntityCreate._loadSpec(instance)` (`platform/mechanisms/entity-create/entity-create.js:298`) is `async`, reads `ranch/entity-create-registry.json`, and returns `null` if the given id isn't registered — exactly the shape needed for a gating check. Call pattern (matches existing `.create()` calls elsewhere in this file): `cjs.EntityCreate._loadSpec(instance)`, no `new`.

This plan's tasks therefore: (1) sync `ranch/` to `platform/`'s current article-inclusive state as a foundation, (2) add gating for both `article` and `journal`, (3) add the `journal` button + dispatch, (4) fix the due-date bug, (5) fix the CSS alignment, keeping both copies byte-identical throughout.

---

### Task 1: Sync `ranch/` mirror to `platform/`'s current state (pre-existing drift, no behavior change yet)

**Files:**
- Modify: `ranch/scripts/home/space-home.js` (overwrite with `platform/blueprints/home/helpers/space-home.js`'s current content)

- [ ] **Step 1: Confirm the two files are the only difference (no independent ranch-only changes to lose)**

Run: `diff platform/blueprints/home/helpers/space-home.js ranch/scripts/home/space-home.js | head -5`
Expected: non-empty diff output (confirms drift, matches this session's earlier finding — ranch lacks the `article` entry and still has the dead `openDaily` dispatch branch).

- [ ] **Step 2: Copy canonical over the mirror**

Run: `cp platform/blueprints/home/helpers/space-home.js ranch/scripts/home/space-home.js`

- [ ] **Step 3: Verify the copy landed and existing tests still pass**

Run: `diff platform/blueprints/home/helpers/space-home.js ranch/scripts/home/space-home.js && echo IDENTICAL`
Expected: `IDENTICAL` (no diff output before it)

Run: `cd platform/test && node run-home.js 2>&1 | tail -3`
Expected: `150 passed, 0 failed, 150 total` (baseline unchanged — this step is pure sync, no new behavior)

- [ ] **Step 4: Commit**

```bash
git add ranch/scripts/home/space-home.js
git commit -m "fix(home): sync ranch dogfood mirror to canonical space-home.js (article button drift)"
```

---

### Task 2: Fix due-date bug — inline task capture should not default `due` to today

**Files:**
- Modify: `platform/blueprints/home/helpers/space-home.js:499` (the `submitCapture` function)
- Modify: `ranch/scripts/home/space-home.js` (same line, kept in sync)
- Test: `platform/test/run-home.js:554-557` (`HOME-CAP-19`)

- [ ] **Step 1: Update the failing-first test — HOME-CAP-19 should assert `today` is absent**

In `platform/test/run-home.js`, replace lines 554-557:

```js
      assertTrue("HOME-CAP-19 Add → createQuick carries title + today + source",
        calls.createQuick[0] && calls.createQuick[0].title === "buy milk"
          && calls.createQuick[0].today === "2026-07-02" && calls.createQuick[0].source === "daily",
        `expected createQuick({title:'buy milk',today:'2026-07-02',source:'daily'}); got ${JSON.stringify(calls.createQuick[0])}`);
```

with:

```js
      assertTrue("HOME-CAP-19 Add → createQuick carries title + source, no today (no default due date)",
        calls.createQuick[0] && calls.createQuick[0].title === "buy milk"
          && calls.createQuick[0].today === undefined && calls.createQuick[0].source === "daily",
        `expected createQuick({title:'buy milk',source:'daily'}) with no today; got ${JSON.stringify(calls.createQuick[0])}`);
```

- [ ] **Step 2: Run test to verify it now fails**

Run: `cd platform/test && node run-home.js 2>&1 | grep "HOME-CAP-19"`
Expected: `FAIL HOME-CAP-19 ...` (current code still passes `today`, so the new assertion fails)

- [ ] **Step 3: Fix `submitCapture` in the canonical file**

In `platform/blueprints/home/helpers/space-home.js`, find (near line 499):

```js
          await td.createQuick({ title: text, today, source: "daily" });
```

Replace with:

```js
          await td.createQuick({ title: text, source: "daily" });
```

- [ ] **Step 4: Mirror the same one-line change into `ranch/scripts/home/space-home.js`**

Apply the identical replacement (same surrounding function) in `ranch/scripts/home/space-home.js`.

- [ ] **Step 5: Run test to verify it passes, and diff the two files stay identical**

Run: `cd platform/test && node run-home.js 2>&1 | grep "HOME-CAP-19"`
Expected: `PASS HOME-CAP-19 ...`

Run: `diff platform/blueprints/home/helpers/space-home.js ranch/scripts/home/space-home.js && echo IDENTICAL`
Expected: `IDENTICAL`

- [ ] **Step 6: Commit**

```bash
git add platform/blueprints/home/helpers/space-home.js ranch/scripts/home/space-home.js platform/test/run-home.js
git commit -m "fix(home): quick-captured tasks get no default due date"
```

---

### Task 3: Fix input-row alignment CSS

**Files:**
- Modify: `.obsidian/snippets/sauce-home.css:169`

- [ ] **Step 1: Change the padding rule**

In `.obsidian/snippets/sauce-home.css`, find:

```css
.sauce-home .sauce-home-add-input-row {
  display: flex;
  align-items: stretch;
  gap: 6px;
  padding: 2px 2px 6px 2px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--background-modifier-border);
}
```

Replace with:

```css
.sauce-home .sauce-home-add-input-row {
  display: flex;
  align-items: stretch;
  gap: 6px;
  padding: 8px 11px 6px 11px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--background-modifier-border);
}
```

- [ ] **Step 2: Visually sanity-check the rule change (no automated CSS test exists for this file)**

Run: `grep -A6 "sauce-home-add-input-row {" .obsidian/snippets/sauce-home.css`
Expected: shows `padding: 8px 11px 6px 11px;` — matching `.sauce-home-add-item`'s `8px 11px` left/right inset (grep that selector too to confirm: `grep -A4 "sauce-home-add-item {" .obsidian/snippets/sauce-home.css`).

- [ ] **Step 3: Commit**

```bash
git add .obsidian/snippets/sauce-home.css
git commit -m "fix(home): align jot-a-task input row with button rows below it"
```

---

### Task 4: Add registry-gated visibility helper + gate the existing Article button

**Files:**
- Modify: `platform/blueprints/home/helpers/space-home.js` (render, item-loop section around line 515)
- Modify: `ranch/scripts/home/space-home.js` (same)
- Test: `platform/test/run-home.js`

- [ ] **Step 1: Write failing tests — article hidden when registry has no `reader-article` entry, shown when it does**

In `platform/test/run-home.js`, the `HOME-CAP` block's `EntityCreate` stub (line 504) currently is:

```js
      EntityCreate: { create: (opts) => { calls.entityCreate.push(opts); return Promise.resolve(); } },
```

This single shared block is reused by the existing "3 action items" assertion (`HOME-CAP-7`) and by the dispatch tests. Since gating changes what "3 items" means, split this into two separate sub-blocks: one exercising the "nothing registered" case, one exercising the "both registered" case. Replace the entire `HOME-CAP` test block (lines 492-586, the whole `{ ... }` starting at `installMoment("2026-07-02", 6);`) — first, insert this **new** sub-block immediately before the existing one, using its own scope:

```js
  // ── HOME-CAP-REG: article/journal buttons are gated by EntityCreate._loadSpec ──
  installMoment("2026-07-02", 6);
  {
    const dv = makeDv();
    const loadSpecCalls = [];

    // Case A: neither reader-article nor journal-entry registered → only meeting + sticky-note render.
    global.customJS = {
      SpaceDailyDashboard: { computeCounts: () => ({ today: 0, overdue: 0, done: 0, meetings: 0 }) },
      TaskEntity: {},
      TaskDialog: { createQuick: () => Promise.resolve() },
      EntityCreate: {
        create: () => Promise.resolve(),
        _loadSpec: (instance) => { loadSpecCalls.push(instance); return Promise.resolve(null); },
      },
    };
    global.app = { commands: { executeCommandById: () => {} } };
    global.window.customJS = global.customJS;
    global.window.app = global.app;

    await home_.render(dv, {});
    const home = dv.container.querySelector(".sauce-home");
    const hasCls = (n, cls) => (n.cls || "").split(/\s+/).indexOf(cls) >= 0;
    const menu = home ? descendants(home).find((n) => hasCls(n, "sauce-home-add-menu")) : null;
    const items = menu ? descendants(menu).filter((n) => n.tag === "button" && hasCls(n, "sauce-home-add-item")) : [];
    assertEq("HOME-CAP-REG-1 neither registered → 2 items (meeting, sticky-note)", items.length, 2);
    assertTrue("HOME-CAP-REG-2 _loadSpec checked for reader-article", loadSpecCalls.indexOf("reader-article") >= 0,
      `expected a _loadSpec('reader-article') call; got ${JSON.stringify(loadSpecCalls)}`);
    assertTrue("HOME-CAP-REG-3 _loadSpec checked for journal-entry", loadSpecCalls.indexOf("journal-entry") >= 0,
      `expected a _loadSpec('journal-entry') call; got ${JSON.stringify(loadSpecCalls)}`);

    // Case B: both registered → all 4 buttons render, in order meeting, sticky-note, article, journal.
    loadSpecCalls.length = 0;
    global.customJS.EntityCreate._loadSpec = (instance) => {
      loadSpecCalls.push(instance);
      if (instance === "reader-article") return Promise.resolve({ id: "reader-article" });
      if (instance === "journal-entry") return Promise.resolve({ id: "journal-entry" });
      return Promise.resolve(null);
    };
    await home_.render(dv, {});
    const home2 = dv.container.querySelector(".sauce-home");
    const menu2 = home2 ? descendants(home2).find((n) => hasCls(n, "sauce-home-add-menu")) : null;
    const items2 = menu2 ? descendants(menu2).filter((n) => n.tag === "button" && hasCls(n, "sauce-home-add-item")) : [];
    assertEq("HOME-CAP-REG-4 both registered → 4 items", items2.length, 4);
    assertEq("HOME-CAP-REG-5 order: meeting, sticky-note, article, journal",
      items2.map((n) => n.dataset && n.dataset.captureKey).join(","),
      "meeting,sticky-note,article,journal");
  }

```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd platform/test && node run-home.js 2>&1 | grep "HOME-CAP-REG"`
Expected: `FAIL` lines — `_loadSpec` isn't called by `render()` yet, article renders unconditionally (so Case A currently gives 3 items not 2, and Case B gives 3 not 4 since journal doesn't exist yet).

- [ ] **Step 3: Add `_captureSpec()`'s journal entry (candidate list grows to 4; gating happens in render, not here)**

In `platform/blueprints/home/helpers/space-home.js`, find the `_captureSpec()` return array (ends with the `article` entry, around line 212):

```js
      { key: "article", label: "＋ Article", icon: svg(`<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>`) },
    ];
  }
```

Replace with:

```js
      { key: "article", label: "＋ Article", icon: svg(`<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>`) },
      { key: "journal", label: "＋ Journal", icon: svg(`<path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M16 2v20"/>`) },
    ];
  }
```

(The journal icon's inner markup is lifted from the existing `notebook` glyph in `platform/mechanisms/icons/icons.js`, re-wrapped by this file's own local 18×18 `svg()` helper for visual consistency with the other three buttons.)

- [ ] **Step 4: Gate `article` and `journal` in the render item-loop**

In `platform/blueprints/home/helpers/space-home.js`, find the item-loop (around line 515):

```js
    for (const item of SpaceHome._captureSpec()) {
      const mi = menu.createEl("button", { cls: "sauce-home-add-item" });
      mi.setAttribute("type", "button");
      mi.dataset.captureKey = item.key;
      const iconSpan = mi.createEl("span", "sauce-home-capture-icon");
      iconSpan.innerHTML = item.icon;
      const labelSpan = mi.createEl("span", "sauce-home-capture-label");
      labelSpan.textContent = item.label;
      mi.onclick = () => { SpaceHome._dispatch(item.key, dv, today); setMenu(false); };
    }
```

Replace with:

```js
    const registryIdFor = { article: "reader-article", journal: "journal-entry" };
    const cjsForGate = (typeof customJS !== "undefined" && customJS) || (typeof window !== "undefined" && window.customJS) || null;
    for (const item of SpaceHome._captureSpec()) {
      const registryId = registryIdFor[item.key];
      if (registryId) {
        let spec = null;
        try {
          if (cjsForGate && cjsForGate.EntityCreate && typeof cjsForGate.EntityCreate._loadSpec === "function") {
            spec = await cjsForGate.EntityCreate._loadSpec(registryId);
          }
        } catch (_e) { /* gating is best-effort; hide the button on any error */ }
        if (!spec) continue;
      }
      const mi = menu.createEl("button", { cls: "sauce-home-add-item" });
      mi.setAttribute("type", "button");
      mi.dataset.captureKey = item.key;
      const iconSpan = mi.createEl("span", "sauce-home-capture-icon");
      iconSpan.innerHTML = item.icon;
      const labelSpan = mi.createEl("span", "sauce-home-capture-label");
      labelSpan.textContent = item.label;
      mi.onclick = () => { SpaceHome._dispatch(item.key, dv, today); setMenu(false); };
    }
```

- [ ] **Step 5: Add `journal` to `_dispatch()`**

In `platform/blueprints/home/helpers/space-home.js`, find the `sticky-note` branch in `_dispatch()` (around line 581):

```js
      if (key === "sticky-note") {
        if (cjs && cjs.EntityCreate && typeof cjs.EntityCreate.create === "function") {
          cjs.EntityCreate.create({ instance: "sticky-note", dv: dv });
        }
        return;
      }
```

Insert immediately after it:

```js
      if (key === "journal") {
        if (cjs && cjs.EntityCreate && typeof cjs.EntityCreate.create === "function") {
          cjs.EntityCreate.create({ instance: "journal-entry", dv: dv });
        }
        return;
      }
```

- [ ] **Step 6: Mirror all three edits (Steps 3-5) into `ranch/scripts/home/space-home.js`**

Apply the identical `_captureSpec()` array addition, item-loop gating replacement, and `_dispatch()` journal branch to `ranch/scripts/home/space-home.js`.

- [ ] **Step 7: Run all HOME-CAP tests to verify they pass, and re-diff the two files**

Run: `cd platform/test && node run-home.js 2>&1 | tail -5`
Expected: all tests pass, `0 failed`.

Run: `diff platform/blueprints/home/helpers/space-home.js ranch/scripts/home/space-home.js && echo IDENTICAL`
Expected: `IDENTICAL`

- [ ] **Step 8: Commit**

```bash
git add platform/blueprints/home/helpers/space-home.js ranch/scripts/home/space-home.js platform/test/run-home.js
git commit -m "feat(home): add conditionally-visible Journal capture button, gate Article the same way"
```

---

### Task 5: Update the existing HOME-CAP-7 / HOME-CAP-11..14 tests for the new gated baseline

Tasks 1-4 changed what "no registry entries present" and "some present" mean for the original `HOME-CAP` block (lines 492-586), which stubbed `EntityCreate` with only `.create` (no `_loadSpec`) and asserted exactly 2 dispatch calls for `[meeting, sticky-note]`. With `_loadSpec` now called by `render()`, that original block's stub needs `_loadSpec` added (returning `null` for everything, preserving its original "just meeting + sticky-note" semantics) so its unrelated assertions (glance chips, jot-input, Enter-key capture, blank-input) keep passing unchanged.

**Files:**
- Modify: `platform/test/run-home.js:504`

- [ ] **Step 1: Run the full suite first to see current state**

Run: `cd platform/test && node run-home.js 2>&1 | tail -5`
Expected (from Task 4's work): should already be all-passing, since `HOME-CAP-7`'s original `EntityCreate` stub (`create` only, no `_loadSpec`) falls into the `typeof ... === "function"` false branch added in Task 4 Step 4, which means `spec` stays `null` and gated items are skipped — i.e., `items.length === 3` (original assertion) now would be WRONG since article is gated out. Confirm this by grepping the specific test.

Run: `cd platform/test && node run-home.js 2>&1 | grep "HOME-CAP-7 "`

- [ ] **Step 2: If HOME-CAP-7 now fails (expected — it must go from 3 to 2), fix its assertion and stub**

In `platform/test/run-home.js`, at line 504, replace:

```js
      EntityCreate: { create: (opts) => { calls.entityCreate.push(opts); return Promise.resolve(); } },
```

with:

```js
      EntityCreate: {
        create: (opts) => { calls.entityCreate.push(opts); return Promise.resolve(); },
        _loadSpec: () => Promise.resolve(null),
      },
```

Then update line 520 from:

```js
    assertEq("HOME-CAP-7 render wired 3 action items", items.length, 3);
```

to:

```js
    assertEq("HOME-CAP-7 render wired 2 action items (article/journal ungated)", items.length, 2);
```

- [ ] **Step 3: Run the full suite again to verify everything passes**

Run: `cd platform/test && node run-home.js 2>&1 | tail -5`
Expected: `N passed, 0 failed, N total` (all tests green — this includes the new `HOME-CAP-REG-*` tests from Task 4 and every pre-existing test).

- [ ] **Step 4: Commit**

```bash
git add platform/test/run-home.js
git commit -m "test(home): fix HOME-CAP-7 baseline for gated article/journal buttons"
```

---

### Task 6: Full regression pass + final platform/ranch sync check

**Files:** none (verification only)

- [ ] **Step 1: Run the full home test suite**

Run: `cd platform/test && node run-home.js 2>&1 | tail -3`
Expected: `0 failed`

- [ ] **Step 2: Run the full workshop preflight** (per `Docs/agent-guides/build-test-verify.md`)

Run: `npm run release:preflight`
Expected: exits 0 (this covers schema lint + broader test suites, catching any collateral breakage)

- [ ] **Step 3: Final byte-identical check between the two `space-home.js` copies**

Run: `diff platform/blueprints/home/helpers/space-home.js ranch/scripts/home/space-home.js && echo IDENTICAL`
Expected: `IDENTICAL`

- [ ] **Step 4: Push branch and open PR**

```bash
git push -u origin HEAD
gh pr create --title "feat(home): Journal capture button + gated Article, due-date fix, alignment fix" --body "$(cat <<'EOF'
## Summary
- Add a conditionally-visible ＋ Journal quick-capture button (gated on the `journal-entry` entity-create registry entry)
- Gate the existing ＋ Article button the same way (was rendering unconditionally with no test coverage)
- Sync the stale `ranch/scripts/home/space-home.js` dogfood mirror back up to `platform/`'s current state
- Fix: quick-captured tasks ("Jot a task…") no longer default to a due date of today
- Fix: input-row left/right padding now matches the button rows below it

## Test plan
- [x] `node platform/test/run-home.js` — all tests pass
- [x] `npm run release:preflight` — green
- [x] `platform/` and `ranch/` copies of `space-home.js` verified byte-identical

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Post-implementation pipeline (not part of the coding plan — operator follow-through)

After the PR above is opened, the operator must: wait for CI to go green, merge the PR (squash), wait for the automatic release pipeline's tap PR, merge/verify it per repo convention, update brew (`brew upgrade sauce` or equivalent), then deploy to the `accuris`, `headspace`, and `ero` consumer vaults (`sauce update --force` per-vault, from within each vault as cwd). No new mechanism or manifest changes are required — `home`'s `depends_on` already includes `entity-create`, and both `journal-entry` and `reader-article` are existing registry entries owned by their respective blueprints.
