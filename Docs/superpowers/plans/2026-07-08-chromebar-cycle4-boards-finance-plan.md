# ChromeBar Cycle 4: Boards + Finance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the shared `chrome-bar` mechanism to the two blueprints deferred from cycle 3 — `boards` (simple single-surface swap) and `finance` (partial integration: ChromeBar owns only the top bar; `FinanceNav` is untouched below it).

**Architecture:** `BoardsChromeBar` mirrors `JournalChromeBar` exactly (single surface, no primary/overflow, always leaf). `FinanceChromeBar` mirrors `PeopleChromeBar`'s multi-context shape (no primary/overflow anywhere; `leaf` = hub vs. entity/defaults/plan) but classifies **17** distinct `page.type` values (7 hubs + 6 entities + 3 defaults + the `finance-plan` singleton) and adds a breadcrumb declaration to finance's manifest — the first time finance gets ancestor breadcrumbs. Both adapters wire into the existing generic `CHROME_BAR_MAP` / `_healChromeBarMigration` / `applyNoteChromeHeal` install-heal pipeline; `_healChromeBarMigration`'s `LEGACY_CLASSES` list does **not** include `FinanceNav`, so healing a finance note strips only its `SpaceNavButtons` block and inserts `FinanceChromeBar` in place — `FinanceNav` survives untouched below it, with zero code changes required to the heal function itself.

**Tech Stack:** CustomJS (Obsidian), Dataview `dataviewjs`, Templater, Node.js test harnesses (`platform/test/run-*.js`), the `chrome-bar` mechanism (`platform/mechanisms/chrome-bar/chrome-bar.js`).

---

## Reference: the generic heal pipeline (read once, applies to every task below)

- `CHROME_BAR_MAP` (an object literal in `platform/install.js`, ~line 6031) maps a frontmatter `type:` value → the CustomJS class name to install. `_healNoteChromeBody` (the function containing the map) calls `_healChromeBarMigration(out, type, barClass)` when `CHROME_BAR_MAP[type]` exists.
- `_healChromeBarMigration(body, type, barClass)` (`platform/install.js`, ~line 6222): idempotent (no-op if `body.includes(barClass)`), strips any dataviewjs block whose `class:` matches one of `LEGACY_CLASSES` (`SpaceNavButtons`, `ProjectNavButtons`, `ToDoHubActions`, `ToDoLeafActions`, `MeetingLeafActions`, `ScratchHubActions`, `ScratchDayActions`, `ScratchLeafActions`, `TripNavButtons`, `ReaderArticleActions`, `ProductActionButtons`, `TeamActionButtons`), collapses orphaned `---` dividers, then inserts one `dataviewjs` block invoking `barClass` right after the frontmatter close (skipping a leading `# Heading` if present). `FinanceNav` is deliberately **not** in `LEGACY_CLASSES`, so it is never touched.
- `applyNoteChromeHeal` (`platform/install.js`, ~line 6453) walks a fixed `roots` array of vault folders, reads every markdown file, extracts `type` via `_noteChromeFrontmatterType`, and — if `type` is in an allow-list (`WIKI_TYPES` ∪ `CYCLE3_TYPES` ∪ a handful of hardcoded to-do/meeting/scratch/person types) — calls `_healNoteChromeBody`, snapshotting to `.sauce-backup/<ts>/<path>` before any write.
- Cycle 4 needs: (a) two new `CHROME_BAR_MAP` entries/groups, (b) `"spice/boards"` and `"spice/finance"` added to the `roots` array, (c) a new `CYCLE4_TYPES` array (mirroring `CYCLE3_TYPES`) folded into the allow-list.

---

### Task 1: `BoardsChromeBar` helper (mirrors `JournalChromeBar`)

**Files:**
- Create: `platform/blueprints/boards/helpers/boards-chrome-bar.js`
- Test: `platform/test/run-boards-chrome-bar.js`
- Modify: `package.json` (add `test:boards-chrome-bar` script + append to `release:preflight` chain)

- [ ] **Step 1: Write the failing test**

Create `platform/test/run-boards-chrome-bar.js`:

```javascript
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const BoardsChromeBar = loadClass('platform/blueprints/boards/helpers/boards-chrome-bar.js', 'BoardsChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new BoardsChromeBar();
const cfg = inst._config();

// BCB-DETECT
{
  const card = cfg.detect({}, { file: { path: 'spice/boards/cards/2026/07-July/Ship the widget.md' }, type: 'board-card' });
  const off = cfg.detect({}, { file: { path: 'spice/other/x.md' }, type: 'meeting' });
  ok('BCB-DETECT-1 board-card classifies; non-board → null', card && card.context === 'board-card' && off === null);
}
// BCB-SPEC — no primary/overflow, always leaf (single-surface blueprint).
{
  const c = cfg.surfaceSpec({ context: 'board-card' });
  ok('BCB-SPEC-1 board-card: primary null + overflow empty + leaf', c.primary === null && c.overflow.length === 0 && c.leaf === true);
}
// BCB-DISPATCH — no ids to dispatch; must never throw.
{
  let threw = false;
  try { cfg.dispatch({}, { context: 'board-card' }, 'anything'); } catch (_e) { threw = true; }
  ok('BCB-DISPATCH-1 dispatch never throws (no-op surface)', threw === false);
}
// BCB-DEST — just the section marker, no further entries (no hub-and-spoke relation).
{
  const dest = cfg.destinations({}, { context: 'board-card', path: 'spice/boards/cards/2026/07-July/Ship the widget.md' });
  ok('BCB-DEST-1 destinations lead with This boards marker', dest[0] && dest[0].section === 'This boards');
  ok('BCB-DEST-2 destinations has exactly one entry (no hub link)', dest.length === 1);
}
console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-boards-chrome-bar.js`
Expected: throws (module file doesn't exist yet) or FAIL on every assertion.

- [ ] **Step 3: Write the implementation**

Create `platform/blueprints/boards/helpers/boards-chrome-bar.js`:

```javascript
/**
 * BoardsChromeBar (CustomJS) — the boards blueprint's ChromeBar adapter
 * config. Board cards have a single surface (one card note per kanban
 * item, no hub, no nav beyond the global vault launcher) — no primary
 * action, no overflow, always leaf. Mirrors JournalChromeBar exactly.
 * Instance methods; never-throw; cold-load-safe.
 */
class BoardsChromeBar {
  get ICON() {
    return {
      trello: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><rect width="4" height="10" x="7" y="7" rx="1"/><rect width="4" height="6" x="13" y="7" rx="1"/></svg>`,
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
      detect: (dv, page) => {
        const t = page && page.type;
        if (t !== "board-card") return null;
        return { context: t, path: (page.file && page.file.path) || "" };
      },
      surfaceSpec: () => ({ primary: null, overflow: [], leaf: true }),
      dispatch: () => { /* no actions on this surface */ },
      destinations: () => [{ section: "This boards" }],
      rootClass: "boards-chrome-root",
      btnClass: (v) => `boards-chrome-btn boards-chrome-btn-${v}`,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-boards-chrome-bar.js`
Expected: `6/6 passed`, exit 0.

- [ ] **Step 5: Wire the npm script**

In `package.json`, add a line adjacent to the other `test:*-chrome-bar` scripts (near line 76, after `"test:journal-chrome-bar"`):

```json
    "test:boards-chrome-bar": "node platform/test/run-boards-chrome-bar.js",
```

And append `&& node platform/test/run-boards-chrome-bar.js` to the end of the `release:preflight` chain (immediately after `... run-journal-chrome-bar.js`), before the final closing quote.

- [ ] **Step 6: Commit**

```bash
git add platform/blueprints/boards/helpers/boards-chrome-bar.js platform/test/run-boards-chrome-bar.js package.json
git commit -m "feat(boards): add BoardsChromeBar adapter (cycle 4)"
```

---

### Task 2: Boards manifest + template wiring

**Files:**
- Modify: `platform/blueprints/boards/manifest.json`
- Modify: `platform/blueprints/boards/templates/Template, Board Card.md`

- [ ] **Step 1: Update the manifest**

In `platform/blueprints/boards/manifest.json`:

1. Add `chrome-bar` to `depends_on` (after the `customjs-guard` entry):

```json
    { "name": "chrome-bar", "range": ">=0.3.0" }
```

2. Add a `customjs_classes` array (boards currently has none — insert after `depends_on`, before `external_plugins`):

```json
  "customjs_classes": ["BoardsChromeBar"],
```

3. Add a new entry to `files[]` (alongside the existing `content/To-Do-Board.md` and `templates/Template, Board Card.md` entries):

```json
    {
      "source": "helpers/boards-chrome-bar.js",
      "dest": "{{scripts_path}}/boards/boards-chrome-bar.js"
    },
```

4. Bump `"version"` from `"0.2.1"` to `"0.3.0"` — **NO.** Per `CLAUDE.md`, version bumping is the release pipeline's job. Do not touch `"version"`.

- [ ] **Step 2: Update the template**

In `platform/blueprints/boards/templates/Template, Board Card.md`, replace:

```markdown
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

---
```

with:

```markdown
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "BoardsChromeBar" });
```
```

(swap the class name, drop the trailing `---` — the file should now end right after the closing ` ``` ` of the dataviewjs block, no blank divider line).

- [ ] **Step 3: Commit**

```bash
git add platform/blueprints/boards/manifest.json "platform/blueprints/boards/templates/Template, Board Card.md"
git commit -m "feat(boards): wire BoardsChromeBar into manifest + template"
```

---

### Task 3: `CHROME_BAR_MAP` + heal wiring for boards, `install.js` heal test

**Files:**
- Modify: `platform/install.js` (three spots: `CHROME_BAR_MAP`, `roots` array, `CYCLE4_TYPES`)
- Modify: `platform/test/run-chrome-bar-cycle3-heal.js` → rename usage pattern by adding cycle-4 cases (do NOT rename the file — see note below)

- [ ] **Step 1: Add the `CHROME_BAR_MAP` entry**

In `platform/install.js`, inside the `CHROME_BAR_MAP` object literal (~line 6031-6041), add a line after the `"journal": "JournalChromeBar",` line:

```javascript
  "board-card": "BoardsChromeBar",
```

- [ ] **Step 2: Add `"spice/boards"` to heal roots**

In `applyNoteChromeHeal` (~line 6456), the `roots` array currently reads:

```javascript
  const roots = ["spice/meetings", "spice/scratch", "spice/to-do", "spice/people", "spice/wiki", "spice/projects", "spice/trips", "spice/reader", "spice/products", "spice/teams", "spice/journal"];
```

Change to:

```javascript
  const roots = ["spice/meetings", "spice/scratch", "spice/to-do", "spice/people", "spice/wiki", "spice/projects", "spice/trips", "spice/reader", "spice/products", "spice/teams", "spice/journal", "spice/boards", "spice/finance"];
```

(This also covers Task 9's finance root — do it here once.)

- [ ] **Step 3: Add a `CYCLE4_TYPES` array and fold it into the allow-list**

Immediately after the `const CYCLE3_TYPES = [...]` line (~line 6476), add:

```javascript
        const CYCLE4_TYPES = ["board-card", "finance-hub", "budgets-hub", "paychecks-hub", "invoices-hub", "debts-hub", "months-hub", "savings-hub", "budget", "paycheck", "invoice", "debt", "month", "savings-account", "budget-defaults", "paycheck-defaults", "debt-defaults", "finance-plan"];
```

Change the allow-list check on the next line from:

```javascript
        if (!["meeting", "scratch", "scratch-day", "scratch-hub", "to-do", "to-do-hub", "project-todo", "to-do-recurring", "person", ...WIKI_TYPES, ...CYCLE3_TYPES].includes(type)) continue;
```

to:

```javascript
        if (!["meeting", "scratch", "scratch-day", "scratch-hub", "to-do", "to-do-hub", "project-todo", "to-do-recurring", "person", ...WIKI_TYPES, ...CYCLE3_TYPES, ...CYCLE4_TYPES].includes(type)) continue;
```

- [ ] **Step 4: Add heal-transform unit tests**

In `platform/test/run-chrome-bar-cycle3-heal.js`, append two new blocks before the final `console.log`/`process.exit` lines (the file name stays `run-chrome-bar-cycle3-heal.js` — it's already wired into `test:chrome-bar-cycle3-heal` and `release:preflight`; renaming it would require touching those wiring points for no functional benefit, so just extend it in place):

```javascript
// ---- boards: board-card body carries SpaceNavButtons + trailing bare "---" divider ----
{
  const before = `---
type: board-card
created_at: "2026-07-08T09:00:00-06:00"
source_board: boards/To-Do-Board.md
tags:
  - kanban-card
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

---
`;
  const after = _healNoteChromeBody(before, 'board-card');
  ok('CBC4-BOARDS-1: board-card heal inserts BoardsChromeBar', after.includes('class: "BoardsChromeBar"'));
  ok('CBC4-BOARDS-2: board-card heal strips legacy SpaceNavButtons', !after.includes('class: "SpaceNavButtons"'));
  ok('CBC4-BOARDS-3: idempotent — second pass is a no-op', _healNoteChromeBody(after, 'board-card') === after);
}

// ---- finance: finance-hub body carries SpaceNavButtons + FinanceNav — FinanceNav MUST survive ----
{
  const before = `---
type: finance-hub
created_at: "2026-05-17T16:45:00-06:00"
tags:
  - finance-hub
cssclasses:
  - wide
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceNav" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceHubSummary" });
\`\`\`
`;
  const after = _healNoteChromeBody(before, 'finance-hub');
  ok('CBC4-FINANCE-1: finance-hub heal inserts FinanceChromeBar', after.includes('class: "FinanceChromeBar"'));
  ok('CBC4-FINANCE-2: finance-hub heal strips legacy SpaceNavButtons', !after.includes('class: "SpaceNavButtons"'));
  ok('CBC4-FINANCE-3: finance-hub heal KEEPS FinanceNav untouched', after.includes('class: "FinanceNav"'));
  ok('CBC4-FINANCE-4: finance-hub heal KEEPS FinanceHubSummary untouched', after.includes('class: "FinanceHubSummary"'));
  ok('CBC4-FINANCE-5: FinanceChromeBar is inserted BEFORE FinanceNav', after.indexOf('FinanceChromeBar') < after.indexOf('FinanceNav'));
  ok('CBC4-FINANCE-6: idempotent — second pass is a no-op', _healNoteChromeBody(after, 'finance-hub') === after);
}

// ---- finance: entity-level type (budget) — same guarantee ----
{
  const before = `---
type: budget
month: "2026-07"
categories: []
groups: []
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceNavRow" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "BudgetSummary" });
\`\`\`
`;
  const after = _healNoteChromeBody(before, 'budget');
  ok('CBC4-BUDGET-1: budget heal inserts FinanceChromeBar', after.includes('class: "FinanceChromeBar"'));
  ok('CBC4-BUDGET-2: budget heal strips legacy SpaceNavButtons', !after.includes('class: "SpaceNavButtons"'));
  ok('CBC4-BUDGET-3: budget heal KEEPS FinanceNavRow untouched (not in scope to fix)', after.includes('class: "FinanceNavRow"'));
}
```

- [ ] **Step 5: Run the heal test**

Run: `node platform/test/run-chrome-bar-cycle3-heal.js`
Expected: all `CBC3-*` and `CBC4-*` lines print `ok`, final line `N passed, 0 failed`, exit 0. (This test requires `BoardsChromeBar`/`FinanceChromeBar` to be reachable only by name-string — it doesn't load the actual helper classes, so it will pass even before Task 4 lands. Still run it now to lock in the boards half; the finance assertions will already pass too since `_healNoteChromeBody` is generic and only needs the `CHROME_BAR_MAP` entries from Task 9, which haven't landed yet — if this test is run before Task 9, the `CBC4-FINANCE-*`/`CBC4-BUDGET-*` blocks will FAIL because `_healNoteChromeBody('finance-hub')` won't find `barClass` yet. Sequence: land Task 9's `CHROME_BAR_MAP` entries before running this full test file, or run only the `CBC4-BOARDS-*` block in isolation now and the rest after Task 9.)

- [ ] **Step 6: Commit**

```bash
git add platform/install.js platform/test/run-chrome-bar-cycle3-heal.js
git commit -m "feat(boards): wire board-card into CHROME_BAR_MAP + heal roots"
```

---

### Task 4: `FinanceChromeBar` helper (mirrors `PeopleChromeBar`'s multi-context shape)

**Files:**
- Create: `platform/blueprints/finance/helpers/finance-chrome-bar.js`
- Test: `platform/test/run-finance-chrome-bar.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Create `platform/test/run-finance-chrome-bar.js`:

```javascript
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const FinanceChromeBar = loadClass('platform/blueprints/finance/helpers/finance-chrome-bar.js', 'FinanceChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new FinanceChromeBar();
const cfg = inst._config();

const HUB_TYPES = ['finance-hub', 'budgets-hub', 'paychecks-hub', 'invoices-hub', 'debts-hub', 'months-hub', 'savings-hub'];
const ENTITY_TYPES = ['budget', 'paycheck', 'invoice', 'debt', 'month', 'savings-account'];
const DEFAULTS_TYPES = ['budget-defaults', 'paycheck-defaults', 'debt-defaults', 'finance-plan'];

// FCB-DETECT — every one of the 17 types classifies; unrelated types → null.
{
  let allHubs = true, allEntities = true, allDefaults = true;
  for (const t of HUB_TYPES) { const r = cfg.detect({}, { file: { path: 'x' }, type: t }); if (!r || r.context !== t) allHubs = false; }
  for (const t of ENTITY_TYPES) { const r = cfg.detect({}, { file: { path: 'x' }, type: t }); if (!r || r.context !== t) allEntities = false; }
  for (const t of DEFAULTS_TYPES) { const r = cfg.detect({}, { file: { path: 'x' }, type: t }); if (!r || r.context !== t) allDefaults = false; }
  const off = cfg.detect({}, { file: { path: 'spice/other/x.md' }, type: 'meeting' });
  ok('FCB-DETECT-1 all 7 hub types classify', allHubs);
  ok('FCB-DETECT-2 all 6 entity types classify', allEntities);
  ok('FCB-DETECT-3 all 4 defaults/plan types classify', allDefaults);
  ok('FCB-DETECT-4 non-finance type → null', off === null);
}
// FCB-SPEC — no primary/overflow anywhere (FinanceNav already owns "+ New X" + defaults links);
// hubs are not leaf, entities/defaults/plan are leaf.
{
  let hubsOk = true, entitiesOk = true, defaultsOk = true;
  for (const t of HUB_TYPES) { const s = cfg.surfaceSpec({ context: t }); if (s.primary !== null || s.overflow.length !== 0 || s.leaf !== false) hubsOk = false; }
  for (const t of ENTITY_TYPES) { const s = cfg.surfaceSpec({ context: t }); if (s.primary !== null || s.overflow.length !== 0 || s.leaf !== true) entitiesOk = false; }
  for (const t of DEFAULTS_TYPES) { const s = cfg.surfaceSpec({ context: t }); if (s.primary !== null || s.overflow.length !== 0 || s.leaf !== true) defaultsOk = false; }
  ok('FCB-SPEC-1 hubs: primary null + overflow empty + not leaf', hubsOk);
  ok('FCB-SPEC-2 entities: primary null + overflow empty + leaf', entitiesOk);
  ok('FCB-SPEC-3 defaults/plan: primary null + overflow empty + leaf', defaultsOk);
}
// FCB-DISPATCH — never throws (no chrome-owned actions on any surface).
{
  let threw = false;
  try { cfg.dispatch({}, { context: 'budget' }, 'unknown-id'); } catch (_e) { threw = true; }
  ok('FCB-DISPATCH-1 dispatch never throws (no-op surface)', !threw);
}
// FCB-DEST — This finance marker + 7 hub entries; current hub omits its own self-link.
{
  const prevCJS = global.customJS;
  global.customJS = { ChromeBar: { openNavTarget: () => {} } };
  const fromEntity = cfg.destinations({}, { context: 'budget', path: 'spice/finance/budgets/2026-07/Budget-2026-07.md' });
  const fromFinanceHub = cfg.destinations({}, { context: 'finance-hub', path: 'spice/finance/Finance.md' });
  const fromBudgetsHub = cfg.destinations({}, { context: 'budgets-hub', path: 'spice/finance/budgets/Budgets.md' });
  global.customJS = prevCJS;
  ok('FCB-DEST-1 leads with This finance marker', fromEntity[0] && fromEntity[0].section === 'This finance');
  ok('FCB-DEST-2 entity surface lists all 7 hubs (no self to omit)', fromEntity.length === 8);
  ok('FCB-DEST-3 Finance hub omits its own self-link (6 remaining)', fromFinanceHub.length === 7);
  ok('FCB-DEST-4 Budgets hub omits its own self-link, keeps Finance', fromBudgetsHub.length === 7 && fromBudgetsHub.some((e) => e && e.label === 'Finance'));
}
console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-finance-chrome-bar.js`
Expected: throws (module doesn't exist) or FAIL on every assertion.

- [ ] **Step 3: Write the implementation**

Create `platform/blueprints/finance/helpers/finance-chrome-bar.js`:

```javascript
/**
 * FinanceChromeBar (CustomJS) — the finance blueprint's ChromeBar adapter
 * config. PARTIAL INTEGRATION (mirrors the PersonNavButtons precedent):
 * FinanceNav's per-mode layout (cross-hub row, +New X, defaults links,
 * prev/next sibling nav) is richer than ChromeBar's one-primary +
 * flat-overflow model, so this adapter renders ONLY the shared top bar —
 * breadcrumb (new for finance) + a Go▾ launcher listing the 7 hubs. No
 * chrome-owned actions on any surface (FinanceNav already owns "+ New X"
 * and defaults links) — primary/overflow are always empty. FinanceNav is
 * left completely untouched below the bar; nothing here retires or
 * duplicates its logic. Detects by page.type across all 17 finance
 * frontmatter types (7 hubs, 6 entities, 3 defaults pages, the
 * finance-plan singleton). Instance methods; never-throw; cold-load-safe.
 */
class FinanceChromeBar {
  get ICON() {
    return {
      wallet: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>`,
      calculator: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/></svg>`,
      coins: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/></svg>`,
      fileText: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`,
      creditCard: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`,
      calendar: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
      piggyBank: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5c-1.5 0-2.8 1.4-3 2.5S17.5 10 19 10c.5 0 .9-.1 1.3-.3.4 1.1.7 2.3.7 3.3 0 4.4-3.6 8-8 8s-8-3.6-8-8 3.6-8 8-8c1.4 0 2.7.4 3.9 1"/><path d="M9 11h.01"/></svg>`,
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
    const ICON = this.ICON;
    const HUB_TYPES = ["finance-hub", "budgets-hub", "paychecks-hub", "invoices-hub", "debts-hub", "months-hub", "savings-hub"];
    const ENTITY_TYPES = ["budget", "paycheck", "invoice", "debt", "month", "savings-account"];
    const DEFAULTS_TYPES = ["budget-defaults", "paycheck-defaults", "debt-defaults", "finance-plan"];
    const HUBS = [
      { key: "finance-hub", label: "Finance", icon: ICON.wallet, path: "spice/finance/Finance.md" },
      { key: "budgets-hub", label: "Budgets", icon: ICON.calculator, path: "spice/finance/budgets/Budgets.md" },
      { key: "paychecks-hub", label: "Paychecks", icon: ICON.coins, path: "spice/finance/paychecks/Paychecks.md" },
      { key: "invoices-hub", label: "Invoices", icon: ICON.fileText, path: "spice/finance/invoices/Invoices.md" },
      { key: "debts-hub", label: "Debts", icon: ICON.creditCard, path: "spice/finance/debts/Debts.md" },
      { key: "months-hub", label: "Months", icon: ICON.calendar, path: "spice/finance/months/Months.md" },
      { key: "savings-hub", label: "Savings", icon: ICON.piggyBank, path: "spice/finance/savings/Savings.md" },
    ];

    return {
      detect: (dv, page) => {
        const t = page && page.type;
        if (!HUB_TYPES.includes(t) && !ENTITY_TYPES.includes(t) && !DEFAULTS_TYPES.includes(t)) return null;
        return { context: t, path: (page.file && page.file.path) || "" };
      },
      surfaceSpec: (ctx) => ({ primary: null, overflow: [], leaf: !HUB_TYPES.includes(ctx.context) }),
      dispatch: (dv, ctx, id) => { /* no chrome-owned actions — FinanceNav owns +New X / defaults links */ },
      destinations: (dv, ctx) => {
        const out = [{ section: "This finance" }];
        const open = (p) => { try { customJS.ChromeBar.openNavTarget(p, dv); } catch (_e) {} };
        for (const hub of HUBS) {
          if (hub.key === ctx.context) continue;
          out.push({ label: hub.label, icon: hub.icon, _navTarget: hub.path, onSelect: () => open(hub.path) });
        }
        return out;
      },
      rootClass: "finance-chrome-root",
      btnClass: (v) => `finance-chrome-btn finance-chrome-btn-${v}`,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-finance-chrome-bar.js`
Expected: `13/13 passed`, exit 0.

- [ ] **Step 5: Wire the npm script**

In `package.json`, add (adjacent to `test:boards-chrome-bar` from Task 1):

```json
    "test:finance-chrome-bar": "node platform/test/run-finance-chrome-bar.js",
```

Append `&& node platform/test/run-finance-chrome-bar.js` to the `release:preflight` chain, right after the `run-boards-chrome-bar.js` entry added in Task 1.

- [ ] **Step 6: Commit**

```bash
git add platform/blueprints/finance/helpers/finance-chrome-bar.js platform/test/run-finance-chrome-bar.js package.json
git commit -m "feat(finance): add FinanceChromeBar adapter (cycle 4)"
```

---

### Task 5: Finance manifest wiring — `depends_on`, `customjs_classes`, `files[]`, breadcrumb

**Files:**
- Modify: `platform/blueprints/finance/manifest.json`

- [ ] **Step 1: Add the `chrome-bar` dependency**

In `depends_on` (after the `entity-create` entry):

```json
    { "name": "chrome-bar", "range": ">=0.3.0" }
```

- [ ] **Step 2: Register the CustomJS class**

In `customjs_classes` array, add `"FinanceChromeBar"` (anywhere in the list — alphabetical position not enforced elsewhere in this file, so append it after `"SavingsCards"`).

- [ ] **Step 3: Add the file entry**

In `files[]`, add (alongside the other `helpers/finance-*.js` entries):

```json
    {
      "source": "helpers/finance-chrome-bar.js",
      "dest": "{{scripts_path}}/finance/finance-chrome-bar.js"
    },
```

- [ ] **Step 4: Add a `breadcrumb` block — new capability for finance**

At the top level of the manifest (a sibling of `rule_fragments`, `nav_buttons`, etc.), add:

```json
  "breadcrumb": {
    "types": {
      "finance-hub": { "ancestors": [], "current": { "label": "lit:Finance" } },
      "budgets-hub": { "ancestors": [{ "label": "lit:Finance", "link": "spice/finance/Finance.md" }], "current": { "label": "lit:Budgets" } },
      "paychecks-hub": { "ancestors": [{ "label": "lit:Finance", "link": "spice/finance/Finance.md" }], "current": { "label": "lit:Paychecks" } },
      "invoices-hub": { "ancestors": [{ "label": "lit:Finance", "link": "spice/finance/Finance.md" }], "current": { "label": "lit:Invoices" } },
      "debts-hub": { "ancestors": [{ "label": "lit:Finance", "link": "spice/finance/Finance.md" }], "current": { "label": "lit:Debts" } },
      "months-hub": { "ancestors": [{ "label": "lit:Finance", "link": "spice/finance/Finance.md" }], "current": { "label": "lit:Months" } },
      "savings-hub": { "ancestors": [{ "label": "lit:Finance", "link": "spice/finance/Finance.md" }], "current": { "label": "lit:Savings" } },
      "budget": {
        "ancestors": [
          { "label": "lit:Finance", "link": "spice/finance/Finance.md" },
          { "label": "lit:Budgets", "link": "spice/finance/budgets/Budgets.md" }
        ],
        "current": { "label": "fm:month|file:basename" }
      },
      "paycheck": {
        "ancestors": [
          { "label": "lit:Finance", "link": "spice/finance/Finance.md" },
          { "label": "lit:Paychecks", "link": "spice/finance/paychecks/Paychecks.md" }
        ],
        "current": { "label": "fm:month|file:basename" }
      },
      "invoice": {
        "ancestors": [
          { "label": "lit:Finance", "link": "spice/finance/Finance.md" },
          { "label": "lit:Invoices", "link": "spice/finance/invoices/Invoices.md" }
        ],
        "current": { "label": "fm:month|file:basename" }
      },
      "debt": {
        "ancestors": [
          { "label": "lit:Finance", "link": "spice/finance/Finance.md" },
          { "label": "lit:Debts", "link": "spice/finance/debts/Debts.md" }
        ],
        "current": { "label": "fm:name|file:basename" }
      },
      "month": {
        "ancestors": [
          { "label": "lit:Finance", "link": "spice/finance/Finance.md" },
          { "label": "lit:Months", "link": "spice/finance/months/Months.md" }
        ],
        "current": { "label": "fm:month|file:basename" }
      },
      "savings-account": {
        "ancestors": [
          { "label": "lit:Finance", "link": "spice/finance/Finance.md" },
          { "label": "lit:Savings", "link": "spice/finance/savings/Savings.md" }
        ],
        "current": { "label": "fm:name|file:basename" }
      },
      "budget-defaults": { "ancestors": [{ "label": "lit:Finance", "link": "spice/finance/Finance.md" }], "current": { "label": "lit:Budget Defaults" } },
      "paycheck-defaults": { "ancestors": [{ "label": "lit:Finance", "link": "spice/finance/Finance.md" }], "current": { "label": "lit:Paycheck Defaults" } },
      "debt-defaults": { "ancestors": [{ "label": "lit:Finance", "link": "spice/finance/Finance.md" }], "current": { "label": "lit:Debt Defaults" } },
      "finance-plan": { "ancestors": [{ "label": "lit:Finance", "link": "spice/finance/Finance.md" }], "current": { "label": "lit:Plan" } }
    }
  },
```

- [ ] **Step 5: Verify JSON validity + schema lint**

Run: `node -e "JSON.parse(require('fs').readFileSync('platform/blueprints/finance/manifest.json','utf8'))"`
Expected: no output (valid JSON), exit 0.

Run: `npm run lint-schemas`
Expected: passes (this validates `rule_fragments`, not the new `breadcrumb`/`customjs_classes` additions, but confirms the manifest as a whole still parses against the schema registry).

- [ ] **Step 6: Commit**

```bash
git add platform/blueprints/finance/manifest.json
git commit -m "feat(finance): wire FinanceChromeBar + breadcrumb into manifest"
```

---

### Task 6: Swap `SpaceNavButtons` → `FinanceChromeBar` in the 7 finance content hubs

**Files:**
- Modify: `platform/blueprints/finance/content/Finance.md`
- Modify: `platform/blueprints/finance/content/Budgets.md`
- Modify: `platform/blueprints/finance/content/Paychecks.md`
- Modify: `platform/blueprints/finance/content/Invoices.md`
- Modify: `platform/blueprints/finance/content/Debts.md`
- Modify: `platform/blueprints/finance/content/Months.md`
- Modify: `platform/blueprints/finance/content/Savings.md`

Every one of these 7 files has an identical dataviewjs block to replace — only the class name changes, `FinanceNav`'s block (and everything after it) is untouched.

- [ ] **Step 1: `Finance.md`**

Replace:
```
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```
```
with:
```
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "FinanceChromeBar" });
```
```

- [ ] **Step 2: `Budgets.md`, `Paychecks.md`, `Invoices.md`, `Debts.md`, `Months.md`, `Savings.md`**

Each of these six files has the exact same block, immediately followed by an `// entity-create:<type>` comment line and the `FinanceNav` invocation — leave the comment and `FinanceNav` block untouched, replace only the `SpaceNavButtons` block:

```
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```
```
→
```
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "FinanceChromeBar" });
```
```

Apply this identically to `Budgets.md`, `Paychecks.md`, `Invoices.md`, `Debts.md`, `Months.md`, and `Savings.md`.

- [ ] **Step 3: Verify no `SpaceNavButtons` remains in any of the 7 content files**

Run: `grep -l 'SpaceNavButtons' platform/blueprints/finance/content/*.md`
Expected: no output (no matches).

Run: `grep -c 'FinanceChromeBar' platform/blueprints/finance/content/*.md`
Expected: `1` for each of the 7 files.

- [ ] **Step 4: Commit**

```bash
git add platform/blueprints/finance/content/*.md
git commit -m "feat(finance): swap SpaceNavButtons for FinanceChromeBar in hub content files"
```

---

### Task 7: Swap in the 3 finance templates

**Files:**
- Modify: `platform/blueprints/finance/templates/Budget Template.md`
- Modify: `platform/blueprints/finance/templates/Paycheck Template.md`
- Modify: `platform/blueprints/finance/templates/Invoice Template.md`

Each template has `SpaceNavButtons` as its first dataviewjs block, immediately followed by a `FinanceNavRow` block (a legacy widget — leave it exactly as-is; not in scope to fix per the design doc).

- [ ] **Step 1: `Budget Template.md`**

Replace lines 13-15:
```
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```
```
with:
```
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceChromeBar" });
```
```

- [ ] **Step 2: `Paycheck Template.md`**

Same replacement (lines 12-14).

- [ ] **Step 3: `Invoice Template.md`**

Same replacement (lines 14-16).

- [ ] **Step 4: Verify**

Run: `grep -L 'FinanceChromeBar' "platform/blueprints/finance/templates/Budget Template.md" "platform/blueprints/finance/templates/Paycheck Template.md" "platform/blueprints/finance/templates/Invoice Template.md"`
Expected: no output (all three now contain `FinanceChromeBar`).

- [ ] **Step 5: Commit**

```bash
git add "platform/blueprints/finance/templates/Budget Template.md" "platform/blueprints/finance/templates/Paycheck Template.md" "platform/blueprints/finance/templates/Invoice Template.md"
git commit -m "feat(finance): swap SpaceNavButtons for FinanceChromeBar in templates"
```

---

### Task 8: Swap in the 6 `new_entity_buttons[].inline_body` strings (manifest.json)

**Files:**
- Modify: `platform/blueprints/finance/manifest.json`

Each of `new_entity_buttons[]` entries with `id` = `budget`, `paycheck`, `invoice`, `debt`, `month`, `savings` has an `inline_body` string whose first dataviewjs block invokes `SpaceNavButtons`. Every one of the six strings begins:

```
```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });\n```\n\n
```

- [ ] **Step 1: Edit each `inline_body` in place**

For each of the six `new_entity_buttons[]` entries (`budget`, `paycheck`, `invoice`, `debt`, `month`, `savings`), find its `inline_body` string and replace the substring:

```
```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"SpaceNavButtons\" });\n```\n\n
```

with:

```
```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"FinanceChromeBar\" });\n```\n\n
```

(Only the `class:` value changes — the `FinanceNav` / `FinanceNavRow` / `InvoiceWorkspaceNav` blocks immediately following stay byte-identical.) This is a `str_replace`-per-occurrence edit since each `inline_body` is a distinct JSON string value — use a tool that can target each occurrence individually (e.g. `mcp__tokensave__tokensave_multi_str_replace` with the six `inline_body` values as distinct old/new pairs, since a plain global string replace across the whole file would also incorrectly touch Task 5's breadcrumb block if it happened to reuse the same literal — it doesn't, but treat each of the 6 as its own targeted replacement to avoid ambiguity).

- [ ] **Step 2: Verify JSON validity**

Run: `node -e "JSON.parse(require('fs').readFileSync('platform/blueprints/finance/manifest.json','utf8'))"`
Expected: no output, exit 0.

- [ ] **Step 3: Verify all 6 swapped**

Run:
```bash
node -e '
const m = JSON.parse(require("fs").readFileSync("platform/blueprints/finance/manifest.json","utf8"));
for (const b of m.new_entity_buttons) {
  const hasOld = b.inline_body.includes("SpaceNavButtons");
  const hasNew = b.inline_body.includes("FinanceChromeBar");
  console.log(b.id, "old:", hasOld, "new:", hasNew);
}
'
```
Expected: every row prints `old: false new: true`.

- [ ] **Step 4: Commit**

```bash
git add platform/blueprints/finance/manifest.json
git commit -m "feat(finance): swap SpaceNavButtons for FinanceChromeBar in new_entity_buttons inline_body"
```

---

### Task 9: Swap in the 8 `install.js` scaffolding constants + `CHROME_BAR_MAP` for finance

**Files:**
- Modify: `platform/install.js`

Eight string constants in `platform/install.js` (~lines 7574-7785) each begin their body with a `SpaceNavButtons` dataviewjs block: `FINANCE_BUDGET_DEFAULTS_CONTENT`, `FINANCE_PAYCHECK_DEFAULTS_CONTENT`, `FINANCE_DEBTS_HUB_TEMPLATE`, `FINANCE_DEBT_DEFAULTS_TEMPLATE`, `FINANCE_PLAN_TEMPLATE`, `FINANCE_SAVINGS_HUB_TEMPLATE`, `FINANCE_SAVINGS_EMERGENCY_TEMPLATE`, `FINANCE_MONTHS_HUB_BODY`. (`FINANCE_HUB_BODY_TEMPLATES`, ~line 8476, is used only by the version-gated `applyFinanceHubsRepair`, permanently gated to `0.110.0` which has long passed — leave it untouched; it is dead code for any install running today or in the future.)

- [ ] **Step 1: `FINANCE_BUDGET_DEFAULTS_CONTENT`** (line ~7581-7583)

Replace:
```javascript
\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`
```
with:
```javascript
\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceChromeBar" });
\`\`\`
```
(this is the first dataviewjs block in the constant — `FinanceNav` immediately below stays untouched)

- [ ] **Step 2: `FINANCE_PAYCHECK_DEFAULTS_CONTENT`** (line ~7608-7610)

Same swap.

- [ ] **Step 3: `FINANCE_DEBTS_HUB_TEMPLATE`** (line ~7639-7641)

Same swap. (This constant's second block invokes `FinanceNavRow`, not `FinanceNav` — leave that untouched; it's a legacy widget reference and out of scope.)

- [ ] **Step 4: `FINANCE_DEBT_DEFAULTS_TEMPLATE`** (line ~7667-7669)

Same swap.

- [ ] **Step 5: `FINANCE_PLAN_TEMPLATE`** (line ~7708-7710)

Same swap.

- [ ] **Step 6: `FINANCE_SAVINGS_HUB_TEMPLATE`** (line ~7730-7732)

Same swap.

- [ ] **Step 7: `FINANCE_SAVINGS_EMERGENCY_TEMPLATE`** (line ~7757-7759)

Same swap.

- [ ] **Step 8: `FINANCE_MONTHS_HUB_BODY`** (line ~7773-7775)

Same swap.

Because all eight constants share the identical three-line substring `\`\`\`dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });\n\`\`\`` as their FIRST occurrence in the file only within this constant block, use `mcp__tokensave__tokensave_multi_str_replace` targeting each constant individually by including enough of its surrounding unique context (e.g. the preceding `type: budget-defaults` / `type: paycheck-defaults` / etc. frontmatter line) in the `old_str` so each replacement is unambiguous, rather than a blind global replace (a global replace would also hit `FINANCE_HUB_BODY_TEMPLATES`, which must stay untouched per its dead-code status above — actually `FINANCE_HUB_BODY_TEMPLATES`'s strings use escaped `\"` not backtick-template literals, so a backtick-scoped tool call is naturally safe, but be deliberate about scoping each edit to its own constant to avoid double-applying).

- [ ] **Step 9: Add the finance `CHROME_BAR_MAP` entries**

In `platform/install.js`, inside `CHROME_BAR_MAP` (same object edited in Task 3 Step 1), add a line after the boards entry:

```javascript
  "finance-hub": "FinanceChromeBar", "budgets-hub": "FinanceChromeBar", "paychecks-hub": "FinanceChromeBar",
  "invoices-hub": "FinanceChromeBar", "debts-hub": "FinanceChromeBar", "months-hub": "FinanceChromeBar", "savings-hub": "FinanceChromeBar",
  "budget": "FinanceChromeBar", "paycheck": "FinanceChromeBar", "invoice": "FinanceChromeBar", "debt": "FinanceChromeBar",
  "month": "FinanceChromeBar", "savings-account": "FinanceChromeBar",
  "budget-defaults": "FinanceChromeBar", "paycheck-defaults": "FinanceChromeBar", "debt-defaults": "FinanceChromeBar", "finance-plan": "FinanceChromeBar",
```

- [ ] **Step 10: Verify no stray `SpaceNavButtons` remains in the 8 constants**

Run:
```bash
node -e '
const install = require("./platform/install.js");
const consts = ["FINANCE_BUDGET_DEFAULTS_CONTENT","FINANCE_PAYCHECK_DEFAULTS_CONTENT","FINANCE_DEBTS_HUB_TEMPLATE","FINANCE_DEBT_DEFAULTS_TEMPLATE","FINANCE_PLAN_TEMPLATE","FINANCE_SAVINGS_HUB_TEMPLATE","FINANCE_SAVINGS_EMERGENCY_TEMPLATE","FINANCE_MONTHS_HUB_BODY"];
for (const c of consts) {
  const v = install[c];
  console.log(c, typeof v === "string" ? (v.includes("FinanceChromeBar") ? "OK" : "MISSING") : "NOT EXPORTED — add module.exports." + c);
}
'
```

If any constant prints `NOT EXPORTED`, add a `module.exports.<CONST> = <CONST>;` line near the existing `module.exports._healChromeBarMigration = _healChromeBarMigration;` line (~line 20087) for each of the 8 constants — this is required for this verification script AND for any future test harness to introspect them (mirrors the existing export pattern for other install.js internals).

Expected after export fix: every row prints `OK`.

- [ ] **Step 11: Run the full cycle-3/4 heal test**

Run: `node platform/test/run-chrome-bar-cycle3-heal.js`
Expected: `N passed, 0 failed` (now that `CHROME_BAR_MAP` has the finance entries, the `CBC4-FINANCE-*` and `CBC4-BUDGET-*` assertions from Task 3 Step 4 will pass).

- [ ] **Step 12: Commit**

```bash
git add platform/install.js
git commit -m "feat(finance): swap SpaceNavButtons for FinanceChromeBar in scaffolding constants + CHROME_BAR_MAP"
```

---

### Task 10: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run every new/modified test individually**

```bash
node platform/test/run-boards-chrome-bar.js
node platform/test/run-finance-chrome-bar.js
node platform/test/run-chrome-bar-cycle3-heal.js
```
Expected: all three exit 0.

- [ ] **Step 2: Run schema + note-chrome lints**

```bash
node scripts/lint-schemas.js
node scripts/lint-note-chrome.js
node scripts/check-version-sync.js
```
Expected: all exit 0. (`lint-note-chrome.js`'s Rule 4, the no-literal-`---`-divider check, is scoped to `opts.blueprint === 'project'` per `Docs/agent-guides/note-chrome.md` §1 — the boards trailing `---` we removed in Task 2 isn't enforced by this linter, but removing it is still correct per the design.)

- [ ] **Step 3: Run the finance-specific pre-existing suites (regression check)**

```bash
npm run test:finance-plan-state
npm run test:finance-plan-widgets
npm run test:finance-frontmatter
node platform/test/run-finance-template-classes.js
```
Expected: all pass unchanged — these exercise `FinanceMath`/`FinancePlanDashboard`/`FinanceFrontmatter` logic, none of which this cycle touches.

- [ ] **Step 4: Run the full `release:preflight` chain**

```bash
npm run release:preflight
```
Expected: exits 0. This is the full gate the CI pipeline runs — it now includes `run-boards-chrome-bar.js` and `run-finance-chrome-bar.js` (wired in Tasks 1 and 4).

- [ ] **Step 5: Run the complete seed-vault migration harness**

```bash
npm run test:seed
npm run test:seed-migrations
```
Expected: both pass — confirms the new `CHROME_BAR_MAP` entries and `applyNoteChromeHeal` root additions don't break the seed-vault install/heal simulation.

- [ ] **Step 6: If anything fails, stop and fix before proceeding to PR**

Do not open a PR with a red `release:preflight`.
