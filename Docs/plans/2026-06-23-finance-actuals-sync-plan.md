# Copilot Actuals-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull real Copilot category spend into the governed month's `Budget-<month>.md` `categories[].actual`, and surface on the hub whether those actuals are live, stale, or hand-typed.

**Architecture:** One sync route (in the finance skill) with two modes — interactive (`/finance sync`, preview+confirm) and `--unattended` (a weekly launchd cron via headless `claude -p`). Underneath, a **pure deterministic core** does the mapping/sums/diff (no file I/O, no LLM in the numbers); the skill does the surgical, snapshot-backed write. Separately, a thin **shipped blueprint** piece adds a generic `actuals_synced_at`/`actuals_source` marker and a live/stale/typed badge on the hub + month dashboard.

**Tech Stack:** Node (zero-dep), CustomJS (FinanceMath instance methods), Obsidian/Dataview, launchd, copilot-money stdio MCP.

**Two homes:**
- **SHIPPED** (workshop repo, finance 0.11.0 / workshop 0.131.0): Tasks 1–3, 7–9.
- **LOCAL** (`~/.claude/skills/finance/`, not released, not in CI): Tasks 4–6.

---

## SHIPPED — blueprint freshness badge

### Task 1: `FinanceMath.actualsFreshness` helper (the badge's shared math)

**Files:**
- Modify: `platform/blueprints/finance/helpers/finance-math.js` (add a method to the `FinanceMath` class; insert after `readBudgetForMonth` ends at line 56)
- Test: `platform/test/run-finance-plan-state.js` (add the FRESH-* family before the final `console.log` at line 225)

- [ ] **Step 1: Write the failing tests** — append before the summary `console.log` (line ~225) in `run-finance-plan-state.js`:

```javascript
// ===== HC-V0128-FRESH-* — actualsFreshness badge math =====
{
    const NOW = Date.parse("2026-07-20T00:00:00Z");
    const govBudgetLive  = { type: "budget", month: "2026-07", actuals_synced_at: "2026-07-18T09:00:00Z", categories: [] };
    const govBudgetStale = { type: "budget", month: "2026-07", actuals_synced_at: "2026-06-25T09:00:00Z", categories: [] };
    const govBudgetTyped = { type: "budget", month: "2026-07", categories: [] };
    ok("HC-V0128-FRESH-1 recent sync → live",   fm.actualsFreshness(govBudgetLive,  "2026-07", "2026-07", NOW).state === "live");
    ok("HC-V0128-FRESH-2 old sync → stale",     fm.actualsFreshness(govBudgetStale, "2026-07", "2026-07", NOW).state === "stale");
    ok("HC-V0128-FRESH-3 no sync stamp → typed", fm.actualsFreshness(govBudgetTyped, "2026-07", "2026-07", NOW).state === "typed");
    ok("HC-V0128-FRESH-4 baseline month → none", fm.actualsFreshness(govBudgetLive, "2026-06", "2026-07", NOW).state === "none");
    ok("HC-V0128-FRESH-5 no budget → none",      fm.actualsFreshness(null,           "2026-07", "2026-07", NOW).state === "none");
    ok("HC-V0128-FRESH-6 live label carries date", /2026-07-18/.test(fm.actualsFreshness(govBudgetLive, "2026-07", "2026-07", NOW).label));
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node platform/test/run-finance-plan-state.js`
Expected: FAIL on HC-V0128-FRESH-1..6 (`fm.actualsFreshness is not a function`).

- [ ] **Step 3: Implement the helper** — insert into `finance-math.js` right after `readBudgetForMonth` closes (after line 56, before `monthBounds`):

```javascript
    // ---- actuals freshness (finance 0.11.0) ----
    // Classifies a governed month's budget actuals for the hub/month badge.
    // Returns { state, label, tone } where state ∈ "live" | "stale" | "typed" | "none".
    // "none" = not applicable (baseline month or no budget) → caller renders no badge.
    // nowMs defaults to Date.now(); tests pass an explicit ms for determinism.
    actualsFreshness(budget, monthKey, governedFrom, nowMs) {
        if (!budget) return { state: "none", label: "", tone: "muted" };
        const gf = this._coerceMonthString(governedFrom);
        const mk = this._coerceMonthString(monthKey);
        if (!(gf && mk && mk >= gf)) return { state: "none", label: "", tone: "muted" };
        const syncedRaw = this._coerceDateString(budget.actuals_synced_at);
        if (!syncedRaw) return { state: "typed", label: "typed", tone: "muted" };
        const t = Date.parse(syncedRaw.length <= 10 ? syncedRaw + "T00:00:00Z" : syncedRaw);
        const now = (typeof nowMs === "number") ? nowMs : Date.now();
        const ageDays = Number.isFinite(t) ? (now - t) / 86400000 : Infinity;
        const dateLabel = syncedRaw.slice(0, 10);
        if (ageDays <= 8) return { state: "live", label: `live · ${dateLabel}`, tone: "green" };
        return { state: "stale", label: `stale · synced ${dateLabel}`, tone: "amber" };
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node platform/test/run-finance-plan-state.js`
Expected: PASS — count rises from 45 to **51 passed, 0 failed**.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/finance/helpers/finance-math.js platform/test/run-finance-plan-state.js
git commit -m "feat(finance): actualsFreshness badge math (live/stale/typed/none)"
```

---

### Task 2: Render the badge in the hub + month dashboard

**Files:**
- Modify: `platform/blueprints/finance/helpers/finance-hub-summary.js` (Budget tile `_renderBudgetTile`, after line 206)
- Modify: `platform/blueprints/finance/helpers/month-dashboard.js` (`_renderBudgetAnalysis`, after the header at line 109)
- Test: `platform/test/run-finance-plan-widgets.js` (add WIDGET-FRESH-* + a MonthDashboard render)

- [ ] **Step 1: Write the failing widget tests** — in `run-finance-plan-widgets.js`, just before the final `console.log` (line ~219), add:

```javascript
        // ===== HC-V0128-WIDGET-FRESH-* — actuals freshness badge =====
        // Budget synced "yesterday" relative to real now → must read "live" regardless of CI clock.
        const _y = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const SYNCED_BUDGET = { type: "budget", month: NOW_MONTH, actuals_synced_at: _y,
            categories: [{ group: "D", name: "All", planned: 3120, actual: 1200 }],
            file: { path: `spice/finance/budgets/${NOW_MONTH}/Budget-${NOW_MONTH}.md`, name: `Budget-${NOW_MONTH}` } };

        // MonthDashboard on a governed month note
        const MD = loadClass("month-dashboard.js", "MonthDashboard", env);
        const monthPage = { type: "month", month: NOW_MONTH, file: { path: `spice/finance/months/Month-${NOW_MONTH}.md`, name: `Month-${NOW_MONTH}` } };
        const mdDv = makeDv([PLAN, ...DEBTS, SYNCED_BUDGET, PAYCHECK, monthPage], monthPage);
        let mdErr = null;
        try { await new MD().render(mdDv); } catch (e) { mdErr = e; }
        ok("HC-V0128-WIDGET-FRESH-1 MonthDashboard renders without throwing", mdErr === null, mdErr && mdErr.message);
        ok("HC-V0128-WIDGET-FRESH-2 MonthDashboard shows live badge", /live ·/.test(treeText(mdDv.container)), mdErr && mdErr.message);

        // FinanceHubSummary Budget tile
        const FHS = loadClass("finance-hub-summary.js", "FinanceHubSummary", env);
        const finPage = { type: "finance-hub", file: { path: "spice/finance/Finance.md", name: "Finance" } };
        const fhsDv = makeDv([PLAN, ...DEBTS, SYNCED_BUDGET, PAYCHECK, finPage], finPage);
        let fhsErr = null;
        try { await new FHS().render(fhsDv); } catch (e) { fhsErr = e; }
        ok("HC-V0128-WIDGET-FRESH-3 FinanceHubSummary renders without throwing", fhsErr === null, fhsErr && fhsErr.message);
        ok("HC-V0128-WIDGET-FRESH-4 FinanceHubSummary Budget tile shows live badge", /live ·/.test(treeText(fhsDv.container)), fhsErr && fhsErr.message);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node platform/test/run-finance-plan-widgets.js`
Expected: FAIL on WIDGET-FRESH-2 and WIDGET-FRESH-4 (badge text absent; renders may pass).

- [ ] **Step 3a: Implement in `finance-hub-summary.js`** — inside `_renderBudgetTile`, replace the `else { … }` block that ends at line 207 so the freshness pill is appended after the `% spent · day` line. Insert immediately after the existing `this._tileMuted(tile, \`${pct}% spent · day ${currentDay}/${daysInMonth}\`);` (line 206) and before the closing `}` of the else:

```javascript
            this._tileMuted(tile, `${pct}% spent · day ${currentDay}/${daysInMonth}`);

            const plan = customJS.FinanceMath.readPlan(dv);
            const fresh = customJS.FinanceMath.actualsFreshness(budget, currentMonth, plan && plan.governed_from);
            if (fresh.state !== "none") this._freshBadge(tile, fresh);
```

Then add the `_freshBadge` helper to the class (after `_tileMuted`, line 175):

```javascript
    _freshBadge(tile, fresh) {
        const COLORS = { green: "#16a34a", amber: "#b45309", muted: "var(--text-muted)" };
        const fg = COLORS[fresh.tone] || COLORS.muted;
        const pill = tile.createEl("div");
        pill.textContent = fresh.label || fresh.state;
        pill.style.cssText = `align-self: flex-start; margin-top: 2px; font-size: 0.62em; letter-spacing: 0.04em; text-transform: uppercase; font-weight: 600; color: ${fg};`;
    }
```

- [ ] **Step 3b: Implement in `month-dashboard.js`** — in `_renderBudgetAnalysis`, right after the `headerEl` style line (line 109), insert:

```javascript
        headerEl.style.cssText = "font-size: 0.9em; font-variant-numeric: tabular-nums; margin-bottom: 10px;";

        const plan = customJS.FinanceMath.readPlan(dv);
        const fresh = customJS.FinanceMath.actualsFreshness(budget, monthKey, plan && plan.governed_from);
        if (fresh.state !== "none") {
            const COLORS = { green: "#16a34a", amber: "#b45309", muted: "var(--text-muted)" };
            const badge = section.createEl("div");
            badge.textContent = fresh.label || fresh.state;
            badge.style.cssText = `display: inline-block; font-size: 0.66em; letter-spacing: 0.04em; text-transform: uppercase; font-weight: 600; margin-bottom: 10px; color: ${COLORS[fresh.tone] || COLORS.muted};`;
        }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node platform/test/run-finance-plan-widgets.js`
Expected: PASS — count rises from 28 to **32 passed, 0 failed**.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/finance/helpers/finance-hub-summary.js platform/blueprints/finance/helpers/month-dashboard.js platform/test/run-finance-plan-widgets.js
git commit -m "feat(finance): live/stale/typed actuals badge on hub + month dashboard"
```

---

### Task 3: Version bump + preflight (driven by the bumper, not hand-edited)

**Files (all written by the bumper, except the seed pin):**
- `platform/manifest.json`, `platform/blueprints/finance/manifest.json`, `ranch/platform-subscription.json` (finance not pinned there — workshop doesn't subscribe; only `workshop_version` updates), `package.json`, `platform/test/fixtures/component-versions.snapshot.json`
- Modify by hand: `platform/test/seed-vault/ranch/platform-subscription.json` (finance pin)

- [ ] **Step 1: Dry-run the bumper to confirm the computed plan**

Run: `node scripts/release/compute-release.js`
Expected: prints `finance 0.10.3 → 0.11.0 (minor)` and `workshop_version: 0.130.0 -> 0.131.0 (minor)` (the two `feat(finance)` commits drive finance minor; umbrella tracks it).

- [ ] **Step 2: Apply the bump**

Run: `node scripts/release/compute-release.js --write`
Expected: `compute-release: version records updated.` — manifest/per-component manifest/ranch workshop_version/package.json/snapshot all updated.

- [ ] **Step 3: Bump the seed-vault finance pin to match the catalogue** — edit `platform/test/seed-vault/ranch/platform-subscription.json`, change the finance blueprint entry `"version": "0.10.3"` → `"version": "0.11.0"`.

- [ ] **Step 4: Run the finance harnesses + version-sync**

Run: `node scripts/check-version-sync.js && node platform/test/run-finance-plan-state.js && node platform/test/run-finance-plan-widgets.js && node platform/test/run-helper-cases.js`
Expected: `version-sync ok: 0.131.0`; finance-plan-state **51/0**; finance-plan-widgets **32/0**; helper-cases all pass (snapshot mirrors agree — no manual sweep).

- [ ] **Step 5: Full preflight**

Run: `npm run release:preflight`
Expected: exit 0 (all harnesses green, including run-release-bumper + run-seed).

- [ ] **Step 6: Commit**

```bash
git add platform/manifest.json platform/blueprints/finance/manifest.json ranch/platform-subscription.json package.json platform/test/fixtures/component-versions.snapshot.json platform/test/seed-vault/ranch/platform-subscription.json
git commit -m "chore(release): finance 0.11.0 / workshop 0.131.0 (actuals-sync badge)"
```

---

## LOCAL — skill + cron infra (`~/.claude/skills/finance/`, not released)

### Task 4: Deterministic mapping core + unit test

**Files:**
- Create: `~/.claude/skills/finance/scripts/sync-actuals-core.mjs`
- Create: `~/.claude/skills/finance/scripts/sync-actuals-core.test.mjs`

- [ ] **Step 1: Write the failing test** — `sync-actuals-core.test.mjs`:

```javascript
import assert from "node:assert";
import { mapActuals, normalize } from "./sync-actuals-core.mjs";

const EXCLUDE = ["Brex", "Consulting", "Claude", "AWS", "Rent", "Uncategorized"];
const ALIASES = { "Bud": "Alcohol/Bud/Misc" };
const budgetCats = [
    { group: "Variable Essentials", name: "Groceries", planned: 600, actual: 0 },
    { group: "Lifestyle", name: "Alcohol/Bud/Misc", planned: 120, actual: 0 },
    { group: "Lifestyle", name: "Golf", planned: 100, actual: 0 },
];
const copilotCats = [
    { name: "Groceries", amount: 412.55 },
    { name: "Bud", amount: 45.00 },          // alias → Alcohol/Bud/Misc
    { name: "Claude", amount: 200 },          // excluded
    { name: "Mystery Shop", amount: 30 },     // unmapped
];

const r = mapActuals({ copilotCats, budgetCats, aliases: ALIASES, exclude: EXCLUDE });

// Groceries matched exactly
assert.equal(r.updates.find(u => u.name === "Groceries").newActual, 412.55);
// Bud aliased into Alcohol/Bud/Misc
assert.equal(r.updates.find(u => u.name === "Alcohol/Bud/Misc").newActual, 45.00);
// Golf has no Copilot source → flagged, not zeroed silently
assert.ok(r.unsourcedBudget.some(u => u.name === "Golf"));
// Claude excluded → not in unmapped
assert.ok(!r.unmappedCopilot.some(u => u.name === "Claude"));
// Mystery Shop unmapped
assert.ok(r.unmappedCopilot.some(u => u.name === "Mystery Shop"));
// idempotency: feeding the produced actuals back yields zero-delta updates
const budget2 = budgetCats.map(c => ({ ...c, actual: (r.updates.find(u => u.name === c.name) || {}).newActual ?? c.actual }));
const r2 = mapActuals({ copilotCats, budgetCats: budget2, aliases: ALIASES, exclude: EXCLUDE });
assert.ok(r2.updates.filter(u => u.oldActual !== u.newActual).length === 0);
console.log("sync-actuals-core.test.mjs: all assertions passed");
```

- [ ] **Step 2: Run to verify it fails**

Run: `node ~/.claude/skills/finance/scripts/sync-actuals-core.test.mjs`
Expected: FAIL (module not found / `mapActuals` undefined).

- [ ] **Step 3: Implement `sync-actuals-core.mjs`**

```javascript
// sync-actuals-core.mjs — PURE deterministic Copilot→budget actuals mapper.
// No file I/O, no network, no LLM. The skill route feeds it JSON and applies
// the result (surgical write). Zero-dep (Node built-ins only).

export function normalize(s) {
    return String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// mapActuals({ copilotCats:[{name,amount}], budgetCats:[{name,group,planned,actual}],
//             aliases:{copilotName->budgetName}, exclude:[name] })
//   -> { updates:[{name,group,oldActual,newActual}], unmappedCopilot:[{name,amount}],
//        unsourcedBudget:[{name}], totalActual }
export function mapActuals({ copilotCats = [], budgetCats = [], aliases = {}, exclude = [] }) {
    const excludeSet = new Set(exclude.map(normalize));
    const aliasByNorm = {};
    for (const [from, to] of Object.entries(aliases)) aliasByNorm[normalize(from)] = to;

    // budget index by normalized name
    const budgetByNorm = new Map();
    for (const c of budgetCats) budgetByNorm.set(normalize(c.name), c);

    const sums = new Map();        // budget category name -> summed amount
    const unmappedCopilot = [];
    for (const cc of copilotCats) {
        const n = normalize(cc.name);
        if (excludeSet.has(n)) continue;
        const aliasTarget = aliasByNorm[n];
        const budgetCat = aliasTarget ? budgetByNorm.get(normalize(aliasTarget)) : budgetByNorm.get(n);
        if (!budgetCat) { unmappedCopilot.push({ name: cc.name, amount: round2(cc.amount) }); continue; }
        sums.set(budgetCat.name, round2((sums.get(budgetCat.name) || 0) + (Number(cc.amount) || 0)));
    }

    const updates = [];
    const unsourcedBudget = [];
    for (const c of budgetCats) {
        if (sums.has(c.name)) {
            updates.push({ name: c.name, group: c.group, oldActual: Number(c.actual) || 0, newActual: sums.get(c.name) });
        } else {
            // no Copilot source matched this budget category → flag, leave its actual untouched
            unsourcedBudget.push({ name: c.name });
        }
    }
    const totalActual = round2([...sums.values()].reduce((s, v) => s + v, 0));
    return { updates, unmappedCopilot, unsourcedBudget, totalActual };
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// CLI: node sync-actuals-core.mjs <copilot.json> <budget-cats.json> <map.json>
// prints the result JSON to stdout. map.json = { aliases, exclude }.
if (import.meta.url === `file://${process.argv[1]}`) {
    const fs = await import("node:fs");
    const [, , copilotPath, budgetPath, mapPath] = process.argv;
    const copilotCats = JSON.parse(fs.readFileSync(copilotPath, "utf8"));
    const budgetCats = JSON.parse(fs.readFileSync(budgetPath, "utf8"));
    const { aliases = {}, exclude = [] } = mapPath ? JSON.parse(fs.readFileSync(mapPath, "utf8")) : {};
    process.stdout.write(JSON.stringify(mapActuals({ copilotCats, budgetCats, aliases, exclude }), null, 2) + "\n");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node ~/.claude/skills/finance/scripts/sync-actuals-core.test.mjs`
Expected: `sync-actuals-core.test.mjs: all assertions passed`.

- [ ] **Step 5: Commit** — the finance skill dir is under `~/.claude/`; if it is a git repo, commit there. Otherwise note it as an untracked local artifact (no workshop commit).

```bash
cd ~/.claude/skills/finance && git add scripts/sync-actuals-core.mjs scripts/sync-actuals-core.test.mjs 2>/dev/null && git commit -m "feat(finance-skill): deterministic Copilot actuals mapper + test" 2>/dev/null || echo "skill dir not a git repo — local artifact"
```

---

### Task 5: Category map + sync route (both modes)

**Files:**
- Create: `~/.claude/skills/finance/references/copilot-category-map.md` (EXCLUDE set + alias table, as JSON-in-fence the core can read)
- Create: `~/.claude/skills/finance/references/sync-actuals.md` (the route: interactive + `--unattended`)
- Modify: `~/.claude/skills/finance/references/map.md` (add a pointer to sync-actuals.md)
- Modify: `~/.claude/skills/finance/references/sync.md` (step 3 → defer to sync-actuals.md)

- [ ] **Step 1: Write `copilot-category-map.md`** — include a fenced ```json block with `{ "exclude": [...], "aliases": {...} }`. Seed `exclude` from `map.md` line 60 (Rent, Taco Lease, insurance, Student Loans, Utilities, Phone, Credit Payment, Interest Charge, Consulting, Claude, AWS, Brex, Uncategorized) and `aliases` empty `{}` (refine on first July run). Document that the budget category names are the envelope list from `map.md` line 58 and are ~1:1.

- [ ] **Step 2: Write `sync-actuals.md`** — the route. Steps:
  1. `get_connection_status` → if stale/disconnected: **abort** (unattended: log + notify "skipped: Copilot stale"; interactive: tell Will).
  2. Resolve target month = current calendar month; read the Finance Plan `governed_from`; if `month < governed_from` → "baseline month, nothing to sync", stop. If `Budget-<month>.md` missing → "no budget for <month>, seed it first", stop.
  3. `get_categories` (this_month) → write the array to a temp `copilot.json`; write the budget's `categories[]` to `budget-cats.json`; read `copilot-category-map.md`'s JSON into `map.json`.
  4. Run `node scripts/sync-actuals-core.mjs copilot.json budget-cats.json map.json` → parse the result.
  5. **Interactive:** show the per-category old→new diff + `unmappedCopilot` + `unsourcedBudget`; on confirm, **snapshot** `.sauce-backup/<ts>/Budget-<month>.md`, then edit ONLY each updated category's `actual:` line in the budget file, set `actuals_synced_at: "<ISO>"` + `actuals_source: copilot`. **`--unattended`:** skip confirm; snapshot; write; append a reverse-chron entry to `spice/finance/Sync Log.md` (timestamp · month · N cats · total · Δ · unmapped count); fire `osascript -e 'display notification "…" with title "Finance sync"'`.
  6. Never write a non-governed or non-current month. Idempotent: re-running writes the same numbers (zero-delta).

- [ ] **Step 3: Wire pointers** — in `map.md`, under the Copilot section, add: "To pull actuals into the governed month's budget, follow `references/sync-actuals.md` (interactive or `--unattended`)." In `sync.md` step 3, replace the inline "(Optional, ask first) get_categories…" with: "→ see `references/sync-actuals.md` for the full actuals-sync route (preview+confirm, or `--unattended` for the cron)."

- [ ] **Step 4: Verify the route reads cleanly** — re-read all four files; confirm the JSON fence in `copilot-category-map.md` parses:

Run: `node -e "const fs=require('fs');const m=fs.readFileSync(process.env.HOME+'/.claude/skills/finance/references/copilot-category-map.md','utf8');const j=m.match(/\`\`\`json\n([\s\S]*?)\`\`\`/)[1];const o=JSON.parse(j);console.log('exclude',o.exclude.length,'aliases',Object.keys(o.aliases).length)"`
Expected: prints `exclude <n> aliases 0`.

- [ ] **Step 5: Commit** (skill dir, same caveat as Task 4 Step 5).

---

### Task 6: launchd cron + setup doc + dry-run validation

**Files:**
- Create: `~/.claude/skills/finance/cron/com.will.finance-actuals-sync.plist`
- Create: `~/.claude/skills/finance/references/cron-setup.md`

- [ ] **Step 1: Write the plist** — `com.will.finance-actuals-sync.plist`, weekly (Sunday 18:00), runs headless Claude on the sync route. `ProgramArguments`: the user's `claude` binary with `-p` and a prompt that invokes `/finance sync --unattended`. Include `StandardOutPath`/`StandardErrorPath` to `~/.claude/skills/finance/cron/sync.log`, and `EnvironmentVariables` with `PATH` including `/opt/homebrew/bin` (so `copilot-money-mcp` + `osascript` resolve). `StartCalendarInterval`: `{ Weekday = 0; Hour = 18; Minute = 0; }`.

- [ ] **Step 2: Write `cron-setup.md`** — install/uninstall: `cp` the plist into `~/Library/LaunchAgents/`, `launchctl load -w …`, how to test (`launchctl start com.will.finance-actuals-sync`), how to read the log, and how to disable (`launchctl unload -w …`). Note: cron is a **no-op until July** (governed_from gate), and that headless Claude must stay authed.

- [ ] **Step 3: Validate the unattended path is a safe no-op today** — run the route's unattended logic by hand for the current month (June, baseline):

Run: `claude -p "/finance sync --unattended"` (or manually walk steps 1–2)
Expected: stops at "baseline month — nothing to sync" with NO write to any budget file and NO `.sauce-backup` created. Confirm `git status` in headspace shows no finance changes.

- [ ] **Step 4: Install + load the launchd agent**

Run: `cp ~/.claude/skills/finance/cron/com.will.finance-actuals-sync.plist ~/Library/LaunchAgents/ && launchctl load -w ~/Library/LaunchAgents/com.will.finance-actuals-sync.plist && launchctl list | grep finance-actuals`
Expected: the job appears in `launchctl list`.

- [ ] **Step 5: Commit** (skill dir, same caveat).

---

## SHIP — release the blueprint

### Task 7: PR → CI green → merge

- [ ] **Step 1: Push the branch + open the PR**

```bash
git push -u origin cycle/finance-actuals-sync
gh pr create --title "feat(finance): Copilot actuals-sync badge (finance 0.11.0)" --body "Sub-project 2 of the hub-as-brain arc. Ships the generic actuals_synced_at/actuals_source marker + live/stale/typed badge on the hub + month dashboard. Local skill+cron infra (the actual Copilot sync) lives in ~/.claude/skills/finance and is not part of this PR. Design+plan: Docs/plans/2026-06-23-finance-actuals-sync-*." --base main
```

- [ ] **Step 2: Wait for CI green** — `gh pr checks --watch`. Expected: ci.yml preflight green on macOS + Ubuntu.

- [ ] **Step 3: Merge**

```bash
gh pr merge --merge --delete-branch
```

---

### Task 8: Tag → release.yml → tap PR → brew → deploy

- [ ] **Step 1: Tag main**

```bash
git checkout main && git pull && git tag -a v0.131.0 -m "v0.131.0 — finance actuals-sync badge (finance 0.11.0)" && git push origin v0.131.0
```

- [ ] **Step 2: Watch release.yml** — `gh run watch` on the release workflow. Expected: preflight (macos) green → bump-tap opens a PR in `willfell/homebrew-sauce`.

- [ ] **Step 3: Merge the tap PR**

```bash
gh pr list --repo willfell/homebrew-sauce
gh pr merge <n> --repo willfell/homebrew-sauce --merge
```

- [ ] **Step 4: Upgrade brew**

```bash
brew update && brew upgrade sauce && sauce --version
```
Expected: `0.131.0`.

- [ ] **Step 5: Deploy to the consumer vaults** — for each vault that subscribes to finance, `sauce update --bump-pins` and confirm `drift: none`. Determine the set first:

```bash
for v in headspace ero accuris; do echo "== $v =="; grep -A1 '"finance"' /Users/willfellhoelter/notes/sauce/$v-sauce/ranch/platform-subscription.json 2>/dev/null || echo "no finance"; done
```
Then per subscribing vault: `cd <vault> && sauce update --bump-pins` and verify the finance pin → 0.11.0 + `sauce doctor` drift none. (ero stays brew-only — never flip its workshop path.)

---

### Task 9: Cycle-close docs + memory

- [ ] **Step 1: Write the result doc** `Docs/plans/2026-06-23-finance-actuals-sync-result.md` (what shipped, gates, real-data note, carry-forwards = sub-project 3).
- [ ] **Step 2: Append the v0.131.0 entry** to `Docs/cycle-history.md` and regenerate `Docs/agent-guides/cycle-status.md` (`npm run` status/regen script per dev-workflow).
- [ ] **Step 3: Commit on main** (or a docs branch + fast PR if main is protected): `docs(finance): v0.131.0 cycle-close (actuals-sync badge)`.
- [ ] **Step 4: Update memory** — new `project_v01310_finance_actuals_sync.md` + MEMORY.md pointer; note the cron is live-but-dormant-until-July and the alias table finalizes on the first real sync.

---

## Self-review

- **Spec coverage:** §A architecture → Tasks 1–6; §B core → Task 4; §C route 2 modes → Task 5; §D cron → Task 6; §E badge → Tasks 1–2; §F testing → Task 1 (engine), Task 2 (widget), Task 4 (core); §G versioning → Task 3; ship → Tasks 7–8; cycle-close → Task 9. No gaps.
- **Placeholder scan:** none — every code step shows real code; release steps show exact commands.
- **Type consistency:** `actualsFreshness(budget, monthKey, governedFrom, nowMs) → {state,label,tone}` used identically in Tasks 1/2; `mapActuals({copilotCats,budgetCats,aliases,exclude}) → {updates,unmappedCopilot,unsourcedBudget,totalActual}` used identically in Tasks 4/5; `actuals_synced_at`/`actuals_source` consistent across Tasks 1,2,5.
- **Risk:** the only test that depends on wall-clock is WIDGET-FRESH (uses `Date.now()-1d` → always "live"); engine FRESH-* are clock-independent (explicit `nowMs`).
