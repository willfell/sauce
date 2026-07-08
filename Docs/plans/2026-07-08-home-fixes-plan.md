# Home fixes + nav Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 Home/daily-nav defects: to-do-page task creation not showing in the daily, Home's Enter-key capture not submitting, Home's load-time flash/widen, retarget `Cmd+[` to Home, and add a "previous day" nav button to Home.

**Architecture:** Five small, independently-testable changes across `task-entity`, `home`, `to-do`, and `daily`. No new mechanisms/blueprints are introduced. `HomeCommandsInit` is a new customJS class following the existing `ProjectCommandsInit` pattern. All fixes are covered by the existing zero-dependency DOM/Dataview-stub Node harnesses (`run-task-entity.js`, `run-home.js`), extended in place.

**Tech Stack:** Vanilla customJS classes (no framework), Node `assert`-based test harnesses, Obsidian Plugin API surface (mocked via DOM/Dataview stubs).

---

### Task 1: Fix to-do-page "New Task" surface mismatch

**Files:**
- Modify: `platform/blueprints/to-do/helpers/todo-chrome-bar.js:92`
- Test: `platform/test/run-task-entity.js`

- [ ] **Step 1: Write the failing test**

Add near the existing `TD-1`/`TD-2`/`TD-3` cases in `platform/test/run-task-entity.js` (right after `TD-3`, ~line 197):

```js
// TD-4. The to-do page's "New Task" button must dispatch surface:'daily' (NOT
// 'today') so defaultsForSurface actually seeds scheduled+source. Regression
// net for the "New Task on daily to-do never shows in Today" bug.
ok('TD-4 to-do chrome bar New Task dispatch uses surface "daily"', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'blueprints', 'to-do', 'helpers', 'todo-chrome-bar.js'),
    'utf8'
  );
  assert(
    /TaskDialog\.open\(\{\s*surface:\s*"daily"/.test(src),
    'todo-chrome-bar.js must call TaskDialog.open({ surface: "daily", ... }) for the daily to-do New Task button'
  );
  assert(
    !/TaskDialog\.open\(\{\s*surface:\s*"today"/.test(src),
    'todo-chrome-bar.js must not use the unrecognized surface "today" anymore'
  );
});
```

Check the top of `run-task-entity.js` already imports `fs`/`path`/`__dirname`-relative reads (it does, for loading `TaskDialog`'s source elsewhere in the file) — if not already present at file scope, add `const fs = require('fs'); const path = require('path');` near the top requires.

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-task-entity.js`
Expected: FAIL on `TD-4 to-do chrome bar New Task dispatch uses surface "daily"` (source still says `surface: "today"`).

- [ ] **Step 3: Fix the call site**

In `platform/blueprints/to-do/helpers/todo-chrome-bar.js`, find:

```js
window.customJS.TaskDialog.open({ surface: "today", scheduled: window.moment().format("YYYY-MM-DD") });
```

Replace with:

```js
window.customJS.TaskDialog.open({ surface: "daily", today: window.moment().format("YYYY-MM-DD") });
```

(`defaultsForSurface('daily')` reads `o.today`, not `o.scheduled` — see `platform/mechanisms/task-entity/task-dialog.js:71-72`: `case 'daily': return { scheduled: o.today || '', source: 'daily' };`. Passing `today` is what actually flows into `scheduled`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-task-entity.js`
Expected: PASS, all cases including `TD-4`.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/to-do/helpers/todo-chrome-bar.js platform/test/run-task-entity.js
git commit -m "fix(to-do): New Task button on daily to-do page now shows in Today

surface:\"today\" was never a recognized case in
TaskDialog.defaultsForSurface — it silently fell through to the
'manual' default, dropping the scheduled date. Use surface:\"daily\"
(what defaultsForSurface actually implements) instead."
```

---

### Task 2: Home Enter-key capture — harden against a swallowed keydown

**Files:**
- Modify: `platform/blueprints/home/helpers/space-home.js`
- Test: `platform/test/run-home.js`

**Context:** `platform/test/run-home.js`'s `HOME-CAP-20`/`HOME-CAP-21` cases already assert Enter → `createQuick`, and they pass against current code in an isolated DOM stub — the wiring is logically correct. The most likely real-world cause of "Enter does nothing" is a document/window-level keydown listener (Obsidian's own hotkey dispatch, or another plugin) receiving the same event during the bubble phase and consuming/redirecting it before — or racing with — our handler, since the current handler calls `preventDefault()` but never `stopPropagation()`. This step hardens the handler defensively; it is a real, non-regressive fix regardless of which listener is actually racing it.

- [ ] **Step 1: Write the failing test**

In `platform/test/run-home.js`, inside the existing "Inline capture: Enter → createQuick" block (~line 430), extend the dispatched event to include a `stopPropagation` spy and assert it fires:

```js
    // ── Inline capture: Enter → createQuick (re-locate after the Add re-render). ──
    {
      calls.createQuick.length = 0;
      const home2 = dv.container.querySelector(".sauce-home");
      const menu2 = home2 ? descendants(home2).find((n) => hasCls(n, "sauce-home-add-menu")) : null;
      const input2 = menu2 ? descendants(menu2).filter((n) => n.tag === "input")[0] : null;
      input2.value = "call mom";
      let stopped = false;
      if (input2 && typeof input2.dispatch === "function") {
        await input2.dispatch("keydown", { key: "Enter", stopPropagation: () => { stopped = true; } });
      }
      assertEq("HOME-CAP-20 Enter → createQuick called once", calls.createQuick.length, 1);
      assertEq("HOME-CAP-21 Enter → createQuick carries the typed title", calls.createQuick[0] && calls.createQuick[0].title, "call mom");
      assertTrue("HOME-CAP-21b Enter → keydown handler calls stopPropagation", stopped,
        "the Enter handler must stopPropagation so a higher-level (Obsidian/document) keydown listener can't swallow or redirect the same event");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-home.js`
Expected: FAIL on `HOME-CAP-21b` (current handler never calls `stopPropagation`).

- [ ] **Step 3: Implement the fix**

In `platform/blueprints/home/helpers/space-home.js`, find:

```js
    input.addEventListener("keydown", (ev) => {
      if (ev && ev.key === "Enter" && !ev.isComposing) {
        if (typeof ev.preventDefault === "function") ev.preventDefault();
        submitCapture();
      }
    });
```

Replace with:

```js
    input.addEventListener("keydown", (ev) => {
      if (ev && ev.key === "Enter" && !ev.isComposing) {
        if (typeof ev.preventDefault === "function") ev.preventDefault();
        if (typeof ev.stopPropagation === "function") ev.stopPropagation();
        submitCapture();
      }
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-home.js`
Expected: PASS, all cases including `HOME-CAP-21b`.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/home/helpers/space-home.js platform/test/run-home.js
git commit -m "fix(home): stopPropagation on Enter in quick-capture input

Enter already called preventDefault and reached submitCapture in
isolation, but a higher document/window-level keydown listener could
still observe (and potentially act on) the same bubbling event. Stop
propagation once we've claimed the keystroke."
```

---

### Task 3: Home load — defer first render until workspace layout is ready

**Files:**
- Modify: `platform/blueprints/home/helpers/space-home.js`
- Test: `platform/test/run-home.js`

**Context:** The reported symptom (content flash + pane widening, ~3s) matches Obsidian's own cold-launch sequence: dataviewjs blocks on the note that becomes active during app startup can execute before the workspace has finished restoring pane/sidebar layout and before the note's `cssclasses` frontmatter has been applied, producing a visible reflow moments later. `app.workspace.onLayoutReady(cb)` is the standard Obsidian guard for this (already used by the vault's own `new-tab-default-page` plugin). Since `render()` is invoked by `dv.view(...)` on every dataviewjs execution (not just once at startup), the guard only needs to delay the FIRST render pass per app session, not every call.

- [ ] **Step 1: Write the failing test**

Add a new case near the `HOME-DAY` section of `platform/test/run-home.js` (after the existing day-refresh tests, before `HOME-HEAL-0`):

```js
// ── HOME-READY: first render defers to workspace.onLayoutReady (cold-start
// flash/reflow mitigation); later renders in the same session run immediately.
{
  installMoment("2026-07-05", 9);
  const dv = makeDv();
  let readyCb = null;
  let layoutReady = false;
  global.app = {
    workspace: {
      onLayoutReady: (cb) => { readyCb = cb; if (layoutReady) cb(); },
      on: () => ({}),
      getActiveFile: () => null,
    },
    commands: { executeCommandById: () => {} },
  };
  global.window.app = global.app;
  delete global.window.__sauceHomeLayoutReady;

  let resolved = false;
  const p = home_.render(dv, {});
  p.then(() => { resolved = true; });
  await Promise.resolve();
  assertTrue("HOME-READY-1 render awaits onLayoutReady before painting on a cold session",
    !resolved && dv.container.querySelector(".sauce-home") === null,
    "before layout is ready, render() must not have appended .sauce-home yet");

  layoutReady = true;
  if (typeof readyCb === "function") readyCb();
  await p;
  assertTrue("HOME-READY-2 render paints once layout is ready",
    dv.container.querySelector(".sauce-home") !== null, "expected .sauce-home after onLayoutReady fires");

  // A SECOND render call in the same app session (layout already marked ready)
  // must NOT wait again — it should paint synchronously.
  const dv2 = makeDv();
  let resolved2 = false;
  const p2 = home_.render(dv2, {});
  p2.then(() => { resolved2 = true; });
  await Promise.resolve();
  assertTrue("HOME-READY-3 subsequent renders in the same session do not re-wait",
    resolved2 || dv2.container.querySelector(".sauce-home") !== null,
    "a second render() in the same session must not block on onLayoutReady again");

  delete global.customJS;
  delete global.app;
  delete global.window.app;
  delete global.window.__sauceHomeLayoutReady;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-home.js`
Expected: FAIL on `HOME-READY-1` (current `render()` paints immediately, with no `onLayoutReady` gate at all).

- [ ] **Step 3: Implement the fix**

In `platform/blueprints/home/helpers/space-home.js`, inside `async render(dv, params) {`, right after the `const self = this;` line, add a one-time-per-session layout-ready gate:

```js
    const self = this;

    // Cold-start reflow guard: on the FIRST render of any app session, wait for
    // Obsidian's workspace layout (panes/sidebars) to finish restoring before
    // painting. Firing during layout restore is what produces the visible
    // "flash then widen" on a cold app open — deferring the first paint avoids
    // racing that restore. Deduped via a window flag so this never delays a
    // SECOND render in the same session (e.g. day-rollover force-refresh).
    try {
      const w = (typeof window !== "undefined" && window) || null;
      const A = (typeof app !== "undefined" && app) || (w && w.app) || null;
      if (w && !w.__sauceHomeLayoutReady) {
        if (A && A.workspace && typeof A.workspace.onLayoutReady === "function") {
          await new Promise((resolve) => {
            A.workspace.onLayoutReady(() => { w.__sauceHomeLayoutReady = true; resolve(); });
          });
        } else {
          w.__sauceHomeLayoutReady = true;
        }
      }
    } catch (_e) { /* never throw — fall through to an immediate render */ }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-home.js`
Expected: PASS, all cases including `HOME-READY-1/2/3`. Also re-run the full file to confirm no other case (e.g. `HOME-CAP-*`, `HOME-DAY-*`) regressed — those don't set `global.app.workspace.onLayoutReady`, so double-check they still pass; if any pre-existing case's stub `app`/`window.app` lacks a `workspace` object entirely, the guard's `A.workspace &&` check keeps it a no-op (falls to the `else` branch, setting the flag and continuing synchronously) — no fixture changes should be needed, but verify.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/home/helpers/space-home.js platform/test/run-home.js
git commit -m "fix(home): defer first render to onLayoutReady (cold-start flash/widen)

Reported symptom (content flash + pane widening on Home's first
open, ~3s) matches Dataview executing the note's block before
Obsidian's workspace layout (panes/sidebars, cssclasses application)
has settled on a cold launch. Gate the FIRST render per app session
on workspace.onLayoutReady; subsequent renders in the same session
are unaffected."
```

---

### Task 4: Retarget `Cmd+[` from the daily note to Home

**Files:**
- Create: `platform/blueprints/home/helpers/home-commands-init.js`
- Modify: `platform/blueprints/home/manifest.json`
- Modify: `platform/blueprints/daily/manifest.json`
- Modify: `platform/install.js` (new heal + wiring call)
- Test: `platform/test/run-home.js`

**Step 4a — `HomeCommandsInit`**

- [ ] **Step 1: Write the failing test**

Add to `platform/test/run-home.js` (a new section after the `HOME-HEAL-*` cases):

```js
// ── HOME-CMD: HomeCommandsInit registers sauce-home:open, mirroring
// ProjectCommandsInit's pattern (idempotent, cold-load-safe, delegates to the
// same navigation the "Open today's daily" / Go-to launcher path uses).
{
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'blueprints', 'home', 'helpers', 'home-commands-init.js'), 'utf8'
  );
  const HomeCommandsInit = new Function(src + "; return HomeCommandsInit;")();

  // Cold-load guard: no app.commands → never throws, never registers.
  {
    let threw = false;
    try { new HomeCommandsInit().invoke(); } catch (_e) { threw = true; }
    assertTrue("HOME-CMD-1 invoke() never throws when app/commands is absent", !threw);
  }

  // Registers exactly one command, id sauce-home:open, and its callback opens Home.
  {
    const registered = [];
    global.app = { commands: { addCommand: (c) => registered.push(c) } };
    global.window.app = global.app;
    const inst = new HomeCommandsInit();
    inst.invoke();
    assertEq("HOME-CMD-2 registers exactly one command", registered.length, 1);
    assertEq("HOME-CMD-3 command id is sauce-home:open", registered[0].id, "sauce-home:open");
    assertTrue("HOME-CMD-4 command has a name", typeof registered[0].name === "string" && registered[0].name.length > 0);

    const opened = [];
    global.app.workspace = { openLinkText: (p, s, nl) => opened.push({ p, s, nl }) };
    registered[0].callback();
    assertEq("HOME-CMD-5 callback opens spice/home/Home.md", opened[0] && opened[0].p, "spice/home/Home.md");

    // Second invoke() is a no-op (idempotent).
    inst.invoke();
    assertEq("HOME-CMD-6 a second invoke() does not re-register", registered.length, 1);

    delete global.app;
    delete global.window.app;
  }
}
```

Make sure `fs`/`path` are required at the top of `run-home.js` (check first; add `const fs = require('fs'); const path = require('path');` near the existing requires if missing).

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-home.js`
Expected: FAIL — `platform/blueprints/home/helpers/home-commands-init.js` does not exist yet (`ENOENT`).

- [ ] **Step 3: Create `HomeCommandsInit`**

Create `platform/blueprints/home/helpers/home-commands-init.js`:

```js
/**
 * HomeCommandsInit — customjs startup-script bootstrap that registers ONE
 * Obsidian command, "sauce-home:open", so Home is reachable from the command
 * palette (Cmd+P) and bindable to a hotkey (see the home blueprint's
 * manifest.json hotkeys[] entry, and applyHomeHotkeyRemapHeal in install.js
 * for already-installed vaults).
 *
 * Mirrors platform/blueprints/project/helpers/project-commands-init.js:
 * registered in customjs's startupScriptNames[] via the home blueprint's
 * customjs_startup_scripts[] manifest entry; customjs invokes this class's
 * invoke() at plugin init time.
 *
 * customJS class — NO imports/exports; loaded by the filesystem scan. invoke()
 * and the command callback are never-throw + cold-load-safe: a missing
 * app.commands degrades to a no-op, never a throw.
 */
class HomeCommandsInit {
  invoke() {
    try {
      this._registerCommands();
    } catch (e) {
      if (typeof console !== "undefined") console.error("[HomeCommandsInit]", e);
    }
  }

  _registerCommands() {
    // Idempotent: a second invoke() is a no-op.
    if (this._registered) return;
    const appRef = (typeof app !== "undefined" && app)
      || (typeof window !== "undefined" && window.app)
      || null;
    // Cold-load guard: bail (never throw) when the command API isn't available.
    if (!appRef || !appRef.commands || typeof appRef.commands.addCommand !== "function") return;

    appRef.commands.addCommand({
      id: "sauce-home:open",
      name: "Sauce Home: Open",
      callback: () => {
        try {
          const a = (typeof app !== "undefined" && app)
            || (typeof window !== "undefined" && window.app)
            || null;
          if (a && a.workspace && typeof a.workspace.openLinkText === "function") {
            a.workspace.openLinkText("spice/home/Home.md", "", false);
          }
        } catch (_e) { /* never throw */ }
      },
    });

    this._registered = true;
    if (typeof console !== "undefined") {
      console.log("[HomeCommandsInit] registered sauce-home:open at " + new Date().toISOString());
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-home.js`
Expected: PASS, all `HOME-CMD-*` cases.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/home/helpers/home-commands-init.js platform/test/run-home.js
git commit -m "feat(home): add HomeCommandsInit registering sauce-home:open

Mirrors ProjectCommandsInit's pattern. Makes Home reachable via the
command palette and bindable to a hotkey — the seam Cmd+[ retargets
onto in the next step."
```

**Step 4b — manifest wiring**

- [ ] **Step 1: Read the current manifests**

```bash
python3 -c "import json; print(json.dumps(json.load(open('platform/blueprints/home/manifest.json')), indent=2))" | head -40
python3 -c "import json; d=json.load(open('platform/blueprints/daily/manifest.json')); print(json.dumps(d.get('hotkeys'), indent=2))"
```

- [ ] **Step 2: Edit `platform/blueprints/home/manifest.json`**

Add `"HomeCommandsInit"` to the existing `customjs_classes` array (create the array with just this entry if the home manifest doesn't already have one — check Step 1's output first), add a `customjs_startup_scripts` array containing `["HomeCommandsInit"]` (create if absent), and add a `hotkeys` array:

```json
"hotkeys": [
  { "command_id": "sauce-home:open", "modifiers": ["Mod"], "key": "[" }
]
```

Bump the manifest's own `"version"` field per semver MINOR (new customJS class + new hotkey = additive feature) — read the current version first and increment the middle number, e.g. `"1.2.0"` → `"1.3.0"` (do NOT guess; read the actual current value from Step 1's output before editing).

- [ ] **Step 3: Edit `platform/blueprints/daily/manifest.json`**

Remove the existing `hotkeys` entry entirely (or set `"hotkeys": []` if the schema expects the key to stay present — check `platform/schemas-index.json` / `npm run lint-schemas` after editing to confirm the shape is still valid):

```json
"hotkeys": []
```

Bump this manifest's version per semver PATCH (removing a hotkey seed for brand-new installs; not a breaking change to any existing behavior of the daily blueprint itself).

- [ ] **Step 4: Verify the schema linter is still green**

Run: `npm run lint-schemas`
Expected: PASS (no errors about the manifests' shape).

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/home/manifest.json platform/blueprints/daily/manifest.json
git commit -m "feat(home): wire HomeCommandsInit + seed Cmd+[ for sauce-home:open

daily's manifest no longer seeds daily-notes/Cmd+[ for brand-new
installs; home's manifest now seeds sauce-home:open/Cmd+[ instead.
Already-installed vaults are handled by applyHomeHotkeyRemapHeal
(next step) since applyHotkeys() only adds bindings, never reassigns
an existing one."
```

**Step 4c — `applyHomeHotkeyRemapHeal` for already-installed vaults**

- [ ] **Step 1: Locate the existing heal precedent**

```bash
grep -n "async function applyHomeScaffoldHeal" platform/install.js
grep -n "await applyHomeScaffoldHeal" platform/install.js
```

Read ~40 lines around each hit so the new heal's signature, backup convention, and history-push shape match exactly (`applyHotkeys`, read earlier in this cycle, is the closest sibling for the backup-write + JSON-parse-guard conventions specifically for `.obsidian/hotkeys.json`).

- [ ] **Step 2: Write the failing test**

Add to `platform/test/run-home.js` (a new `HOME-HOTKEY-*` section):

Assert against a small **pure** helper that Step 3 will define alongside the IO-performing heal (this mirrors how `_healDocsHubBody` / `_healHomeChromeBody` are pure string/object transforms called BY the IO-performing `apply*Heal` function):

```js
// ── HOME-HOTKEY: _planHomeHotkeyRemap — pure decision logic backing
// applyHomeHotkeyRemapHeal. Given the parsed hotkeys.json object, decide
// whether/how to move the Mod+[ binding from daily-notes to sauce-home:open.
{
  const installSrc = fs.readFileSync(path.join(__dirname, '..', 'install.js'), 'utf8');
  const fnMatch = installSrc.match(/function _planHomeHotkeyRemap\([\s\S]*?\n}\n/);
  assertTrue("HOME-HOTKEY-0 _planHomeHotkeyRemap is defined in install.js", !!fnMatch,
    "expected a pure _planHomeHotkeyRemap(existing) function in platform/install.js");
  const _planHomeHotkeyRemap = new Function(fnMatch[0] + "; return _planHomeHotkeyRemap;")();

  // Case A: daily-notes bound to exactly Mod+[, sauce-home:open unbound → act.
  {
    const existing = { "daily-notes": [{ modifiers: ["Mod"], key: "[" }] };
    const plan = _planHomeHotkeyRemap(existing);
    assertTrue("HOME-HOTKEY-1 acts when daily-notes owns Mod+[ and sauce-home:open is unbound", plan.act === true);
    assertTrue("HOME-HOTKEY-2 result clears daily-notes' Mod+[ entry",
      !plan.next["daily-notes"] || plan.next["daily-notes"].length === 0,
      `got ${JSON.stringify(plan.next["daily-notes"])}`);
    assertTrue("HOME-HOTKEY-3 result binds sauce-home:open to Mod+[",
      Array.isArray(plan.next["sauce-home:open"]) && plan.next["sauce-home:open"].length === 1
        && plan.next["sauce-home:open"][0].key === "[" && deepEq(plan.next["sauce-home:open"][0].modifiers, ["Mod"]),
      `got ${JSON.stringify(plan.next["sauce-home:open"])}`);
  }

  // Case B: daily-notes has OTHER bindings too (user customized) — only the
  // Mod+[ entry is removed, any other binding for daily-notes survives.
  {
    const existing = { "daily-notes": [{ modifiers: ["Mod"], key: "[" }, { modifiers: ["Mod", "Shift"], key: "d" }] };
    const plan = _planHomeHotkeyRemap(existing);
    assertTrue("HOME-HOTKEY-4 preserves a daily-notes binding that isn't Mod+[",
      Array.isArray(plan.next["daily-notes"]) && plan.next["daily-notes"].length === 1
        && plan.next["daily-notes"][0].key === "d");
  }

  // Case C: already remapped (sauce-home:open already bound) → no-op.
  {
    const existing = { "sauce-home:open": [{ modifiers: ["Mod"], key: "[" }] };
    const plan = _planHomeHotkeyRemap(existing);
    assertTrue("HOME-HOTKEY-5 no-ops when sauce-home:open is already bound", plan.act === false);
  }

  // Case D: daily-notes never had Mod+[ (e.g. user rebound it elsewhere) → no-op.
  {
    const existing = { "daily-notes": [{ modifiers: ["Mod", "Shift"], key: "d" }] };
    const plan = _planHomeHotkeyRemap(existing);
    assertTrue("HOME-HOTKEY-6 no-ops when daily-notes doesn't own Mod+[", plan.act === false);
  }

  // Case E: fresh/empty hotkeys.json → no-op (nothing to remap; the manifest
  // hotkeys[] seed path handles brand-new installs instead).
  {
    const plan = _planHomeHotkeyRemap({});
    assertTrue("HOME-HOTKEY-7 no-ops on an empty hotkeys object", plan.act === false);
  }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node platform/test/run-home.js`
Expected: FAIL — `_planHomeHotkeyRemap` does not exist in `install.js` yet.

- [ ] **Step 4: Implement `_planHomeHotkeyRemap` + `applyHomeHotkeyRemapHeal`**

In `platform/install.js`, near the existing `applyHomeScaffoldHeal` (found in Step 1 of this sub-task), add:

```js
// _planHomeHotkeyRemap — PURE decision logic for applyHomeHotkeyRemapHeal.
// Given the parsed .obsidian/hotkeys.json object, decide whether the
// daily-notes -> Mod+[ binding (seeded by an OLDER daily blueprint manifest)
// should move to sauce-home:open. Only acts when daily-notes owns EXACTLY a
// Mod+[ entry and sauce-home:open has no binding yet; any OTHER daily-notes
// binding is preserved untouched. Never mutates its input.
function _planHomeHotkeyRemap(existing) {
  const src = (existing && typeof existing === "object" && !Array.isArray(existing)) ? existing : {};
  const isModBracket = (b) => b && Array.isArray(b.modifiers) && b.modifiers.length === 1
    && b.modifiers[0] === "Mod" && b.key === "[";

  const homeAlreadyBound = Array.isArray(src["sauce-home:open"]) && src["sauce-home:open"].length > 0;
  const dailyBindings = Array.isArray(src["daily-notes"]) ? src["daily-notes"] : [];
  const dailyOwnsModBracket = dailyBindings.some(isModBracket);

  if (homeAlreadyBound || !dailyOwnsModBracket) {
    return { act: false, next: src };
  }

  const next = Object.assign({}, src);
  next["daily-notes"] = dailyBindings.filter((b) => !isModBracket(b));
  next["sauce-home:open"] = [{ modifiers: ["Mod"], key: "[" }];
  return { act: true, next };
}

// applyHomeHotkeyRemapHeal — IO wrapper around _planHomeHotkeyRemap. Mirrors
// applyHotkeys's read/parse-guard/backup-then-write posture for
// .obsidian/hotkeys.json. Never throws; no-ops on any read/parse failure or
// when the plan says nothing to do. NEW (home fixes cycle).
async function applyHomeHotkeyRemapHeal(tp, history, git) {
  const adapter = tp.app.vault.adapter;
  const target = ".obsidian/hotkeys.json";
  if (!(await adapter.exists(target))) return;

  let raw;
  try {
    raw = await adapter.read(target);
  } catch (e) {
    new Notice(`applyHomeHotkeyRemapHeal: cannot read ${target} (${e.message}); skipping`, 8000);
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    new Notice(`applyHomeHotkeyRemapHeal: ${target} malformed JSON (${e.message}); skipping`, 8000);
    return;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return;

  const plan = _planHomeHotkeyRemap(parsed);
  if (!plan.act) return;

  try {
    await adapter.write(`${target}.sauce-backup`, raw);
  } catch (e) {
    new Notice(`applyHomeHotkeyRemapHeal: backup write failed (${e.message}); aborting`, 8000);
    return;
  }

  try {
    await adapter.write(target, JSON.stringify(plan.next, null, 2));
    if (history) {
      history.push({
        event: "info",
        step: "home_hotkey_remap",
        message: "moved Mod+[ from daily-notes to sauce-home:open",
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
  } catch (e) {
    new Notice(`applyHomeHotkeyRemapHeal: write failed (${e.message})`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "home_hotkey_remap",
        message: `write failed: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
  }
}
```

Then wire the call — find where `applyHomeScaffoldHeal` is invoked (`await applyHomeScaffoldHeal(tp, history, git);`) and add immediately after it:

```js
await applyHomeHotkeyRemapHeal(tp, history, git); // NEW — retargets Cmd+[ from daily-notes to sauce-home:open on already-installed vaults
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node platform/test/run-home.js`
Expected: PASS, all `HOME-HOTKEY-*` cases.

- [ ] **Step 6: Run full preflight**

Run: `npm run release:preflight`
Expected: all harnesses PASS (this exercises the install pipeline end-to-end via `run-bootstrap.js` / `run-install-sh.js`, which will now also invoke the new heal — confirm no unrelated regression).

- [ ] **Step 7: Commit**

```bash
git add platform/install.js platform/test/run-home.js
git commit -m "feat(home): applyHomeHotkeyRemapHeal for already-installed vaults

applyHotkeys() only adds bindings — it can't reassign Cmd+[ from
daily-notes (seeded by an older daily manifest) to sauce-home:open
(seeded by the new home manifest) on a vault that's already
installed. This idempotent heal does exactly that migration, backup-
first, preserving any OTHER daily-notes binding the user added."
```

---

### Task 5: "‹ Yesterday" nav button on Home

**Files:**
- Modify: `platform/blueprints/home/helpers/space-home.js`
- Modify: `platform/blueprints/home/helpers/sauce-home.css`
- Test: `platform/test/run-home.js`

**Step 5a — pure path computation**

- [ ] **Step 1: Write the failing test**

Add to `platform/test/run-home.js`:

```js
// ── HOME-PREV: SpaceHome._previousDailyPath — pure date math computing
// yesterday's daily-note path from daily-notes.json's folder/format config
// (mirrors the moment-format folder convention todo-chrome-bar.js already
// uses for its own today/back-to-today path).
{
  const path1 = SpaceHome._previousDailyPath("2026-07-08", {
    folder: "spice/daily", format: "YYYY/MM-MMMM/dddd-YYYY-MM-DD",
  });
  assertEq("HOME-PREV-1 computes yesterday's path from today + daily-notes config",
    path1, "spice/daily/2026/07-July/Tuesday-2026-07-07.md");

  // Month/year boundary.
  const path2 = SpaceHome._previousDailyPath("2026-01-01", {
    folder: "spice/daily", format: "YYYY/MM-MMMM/dddd-YYYY-MM-DD",
  });
  assertEq("HOME-PREV-2 crosses a year boundary correctly",
    path2, "spice/daily/2025/12-December/Wednesday-2025-12-31.md");

  // Missing/malformed config → null (caller shows a Notice, never throws).
  assertTrue("HOME-PREV-3 null config → null path", SpaceHome._previousDailyPath("2026-07-08", null) === null);
  assertTrue("HOME-PREV-4 missing folder → null path",
    SpaceHome._previousDailyPath("2026-07-08", { format: "YYYY/MM-MMMM/dddd-YYYY-MM-DD" }) === null);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-home.js`
Expected: FAIL — `SpaceHome._previousDailyPath` is not a function.

- [ ] **Step 3: Implement `_previousDailyPath`**

In `platform/blueprints/home/helpers/space-home.js`, add a new static method right after `_dayNumber` (it needs the same Hinnant day-math already in the file — reuse `_ymd`/`_dayNumber`, do not reimplement date arithmetic):

```js
  /**
   * Compute yesterday's daily-note VAULT PATH from `today` (YYYY-MM-DD) and
   * the parsed `.obsidian/daily-notes.json` config ({ folder, format }).
   * PURE — never touches the wall clock or the vault; the caller resolves
   * `today` and reads daily-notes.json. `format` is a moment.js-style token
   * string (folder/file segments); this only needs the tokens the daily
   * blueprint's own config actually uses: YYYY, MM, MMMM, dddd, YYYY-MM-DD.
   * Returns null when `today` or `config.folder`/`config.format` are missing
   * or unparseable — the caller shows a Notice rather than guessing a path.
   */
  static _previousDailyPath(today, config) {
    if (!config || typeof config.folder !== "string" || !config.folder
      || typeof config.format !== "string" || !config.format) return null;
    const ymd = SpaceHome._ymd(today);
    if (!ymd) return null;
    const dn = SpaceHome._dayNumber(ymd);
    if (dn == null) return null;

    // Convert the PREVIOUS absolute day number back to { y, mo, d } via the
    // inverse of _dayNumber's Howard Hinnant civil_from_days algorithm.
    const civilFromDays = (z) => {
      z += 719468;
      const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
      const doe = z - era * 146097;                                  // [0, 146096]
      const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365); // [0, 399]
      const y = yoe + era * 400;
      const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
      const mp = Math.floor((5 * doy + 2) / 153);                     // [0, 11]
      const d = doy - Math.floor((153 * mp + 2) / 5) + 1;             // [1, 31]
      const m = mp + (mp < 10 ? 3 : -9);                              // [1, 12]
      return { y: y + (m <= 2 ? 1 : 0), mo: m, d };
    };
    const prev = civilFromDays(dn - 1);

    const WD = ["Thursday", "Friday", "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday"];
    const MO = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const pad2 = (n) => String(n).padStart(2, "0");
    const wd = WD[(((dn - 1) % 7) + 7) % 7];
    const tokens = {
      YYYY: String(prev.y),
      MM: pad2(prev.mo),
      MMMM: MO[prev.mo - 1],
      dddd: wd,
      DD: pad2(prev.d),
    };
    // Build the literal "YYYY-MM-DD" composite token first (longest match),
    // then the remaining single tokens — longest-token-first avoids MM being
    // consumed inside a not-yet-replaced YYYY-MM-DD literal.
    const isoDate = tokens.YYYY + "-" + tokens.MM + "-" + pad2(prev.d);
    let out = config.format.split("YYYY-MM-DD").join(isoDate);
    out = out.split("YYYY").join(tokens.YYYY);
    out = out.split("MMMM").join(tokens.MMMM);
    out = out.split("MM").join(tokens.MM);
    out = out.split("dddd").join(tokens.dddd);
    return config.folder.replace(/\/+$/, "") + "/" + out + ".md";
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-home.js`
Expected: PASS, all `HOME-PREV-*` cases.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/home/helpers/space-home.js platform/test/run-home.js
git commit -m "feat(home): SpaceHome._previousDailyPath pure date math

Computes yesterday's daily-note vault path from today + the parsed
daily-notes.json {folder, format} config. Backing the new '<
Yesterday' nav button; reuses the file's existing Hinnant day-number
helpers rather than duplicating date arithmetic."
```

**Step 5b — the button itself**

- [ ] **Step 1: Write the failing test**

Add to `platform/test/run-home.js`, in the render-behavior section (near the existing header/glance assertions, reusing the `dv`/`calls` setup already built for `HOME-CAP-*`):

```js
// ── HOME-PREV-BTN: a "‹" button renders in the header, opens yesterday's
// daily note when it exists, and shows a Notice (never creates a file) when
// it doesn't.
{
  installMoment("2026-07-02", 9);
  const dv = makeDv();
  const opened = [];
  const notices = [];
  global.Notice = function (msg) { notices.push(msg); };
  global.app = {
    vault: {
      adapter: { read: async (p) => {
        if (p === ".obsidian/daily-notes.json") {
          return JSON.stringify({ folder: "spice/daily", format: "YYYY/MM-MMMM/dddd-YYYY-MM-DD" });
        }
        throw new Error("not found");
      } },
      getAbstractFileByPath: (p) => (p === "spice/daily/2026/07-July/Wednesday-2026-07-01.md" ? { path: p } : null),
    },
    workspace: { openLinkText: (p, s, nl) => opened.push({ p, s, nl }) },
  };
  global.window.app = global.app;
  global.customJS = {};
  global.window.customJS = global.customJS;

  await home_.render(dv, {});
  await home_.render(dv, {}); // second render (async config load may resolve after first paint) — assert on the settled DOM

  const home = dv.container.querySelector(".sauce-home");
  const hasCls = (n, cls) => (n.cls || "").split(/\s+/).indexOf(cls) >= 0;
  const all = home ? descendants(home) : [];
  const prevBtn = all.find((n) => n.tag === "button" && hasCls(n, "sauce-home-prev-day"));
  assertTrue("HOME-PREV-BTN-1 a previous-day button renders in the header", !!prevBtn);

  if (prevBtn && typeof prevBtn.onclick === "function") await prevBtn.onclick({});
  assertEq("HOME-PREV-BTN-2 clicking it opens yesterday's existing daily note",
    opened[0] && opened[0].p, "spice/daily/2026/07-July/Wednesday-2026-07-01.md");

  delete global.customJS;
  delete global.app;
  delete global.window.app;
  delete global.window.customJS;
  delete global.Notice;
}

// Missing-file case: same setup but getAbstractFileByPath always returns null.
{
  installMoment("2026-07-02", 9);
  const dv = makeDv();
  const notices = [];
  global.Notice = function (msg) { notices.push(msg); };
  global.app = {
    vault: {
      adapter: { read: async (p) => JSON.stringify({ folder: "spice/daily", format: "YYYY/MM-MMMM/dddd-YYYY-MM-DD" }) },
      getAbstractFileByPath: () => null,
    },
    workspace: { openLinkText: () => { throw new Error("should not be called"); } },
  };
  global.window.app = global.app;
  global.customJS = {};
  global.window.customJS = global.customJS;

  await home_.render(dv, {});
  await home_.render(dv, {});
  const home = dv.container.querySelector(".sauce-home");
  const hasCls = (n, cls) => (n.cls || "").split(/\s+/).indexOf(cls) >= 0;
  const all = home ? descendants(home) : [];
  const prevBtn = all.find((n) => n.tag === "button" && hasCls(n, "sauce-home-prev-day"));

  let threw = false;
  try { if (prevBtn && typeof prevBtn.onclick === "function") await prevBtn.onclick({}); } catch (_e) { threw = true; }
  assertTrue("HOME-PREV-BTN-3 missing yesterday note never throws", !threw);
  assertTrue("HOME-PREV-BTN-4 missing yesterday note shows a Notice, no file created",
    notices.length === 1, `expected exactly one Notice; got ${JSON.stringify(notices)}`);

  delete global.customJS;
  delete global.app;
  delete global.window.app;
  delete global.window.customJS;
  delete global.Notice;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-home.js`
Expected: FAIL — no `.sauce-home-prev-day` button exists yet.

- [ ] **Step 3: Implement the button**

In `platform/blueprints/home/helpers/space-home.js`, inside `render()`, right after the `sub.textContent = SpaceHome._humanDate(today, today);` line (still inside the `head`/`greeting` block, before the `addWrap` quick-add button is built), add:

```js
    // 1a) "‹ Yesterday" — opens the actual previous day's daily note (Home
    // itself always stays pinned to today; this navigates AWAY, it does not
    // re-render Home for another day). Never creates a file: if yesterday's
    // note doesn't exist yet, show a Notice instead.
    const prevBtn = greeting.createEl("button", { cls: "sauce-home-prev-day" });
    prevBtn.setAttribute("type", "button");
    prevBtn.setAttribute("aria-label", "Previous day");
    prevBtn.innerHTML =
      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
    prevBtn.onclick = async () => {
      try {
        const appRef = (typeof app !== "undefined" && app) || (typeof window !== "undefined" && window.app) || null;
        if (!appRef || !appRef.vault || !appRef.vault.adapter) return;
        let cfg = null;
        try {
          const raw = await appRef.vault.adapter.read(".obsidian/daily-notes.json");
          cfg = JSON.parse(raw);
        } catch (_e) { cfg = null; }
        const p = SpaceHome._previousDailyPath(today, cfg);
        if (!p) {
          try { new Notice("Could not determine yesterday's daily note path."); } catch (_e) {}
          return;
        }
        const file = appRef.vault.getAbstractFileByPath ? appRef.vault.getAbstractFileByPath(p) : null;
        if (!file) {
          try { new Notice("No daily note for yesterday yet."); } catch (_e) {}
          return;
        }
        if (appRef.workspace && typeof appRef.workspace.openLinkText === "function") {
          appRef.workspace.openLinkText(p, "", false);
        }
      } catch (_e) { /* never throw out of a click handler */ }
    };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-home.js`
Expected: PASS, all `HOME-PREV-BTN-*` cases.

- [ ] **Step 5: Add CSS for the button**

In `platform/blueprints/home/helpers/sauce-home.css`, right after the `.sauce-home .sauce-home-greeting-date::before { ... }` rule, add:

```css
/* "‹ Yesterday" nav — a quiet icon button beside the date, same visual
 * weight as the "+" quick-add so the header reads as one control cluster. */
.sauce-home .sauce-home-prev-day {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  margin-left: 8px;
  border: none;
  border-radius: var(--sh-radius);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 120ms var(--sh-ease), color 120ms var(--sh-ease);
}
.sauce-home .sauce-home-prev-day:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}
```

- [ ] **Step 6: Run the full home harness once more**

Run: `node platform/test/run-home.js`
Expected: PASS (all cases, including every pre-existing `HOME-CAP-*`/`HOME-DAY-*`/`HOME-HEAL-*`/`HOME-CMD-*`/`HOME-HOTKEY-*`/`HOME-READY-*` case from earlier tasks).

- [ ] **Step 7: Commit**

```bash
git add platform/blueprints/home/helpers/space-home.js platform/blueprints/home/helpers/sauce-home.css platform/test/run-home.js
git commit -m "feat(home): add '‹ Yesterday' nav button

Opens the actual previous day's daily note (spice/daily/...) via the
same daily-notes.json folder/format convention already used
elsewhere. Home itself stays pinned to today; this navigates away
rather than re-rendering Home for another day. Never creates a file
— shows a Notice if yesterday's note doesn't exist yet."
```

---

### Task 6: Manifest version bump sanity + full preflight

**Files:** none (verification only)

- [ ] **Step 1: Confirm manifest edits are internally consistent**

```bash
node -e "
const home = require('./platform/blueprints/home/manifest.json');
const daily = require('./platform/blueprints/daily/manifest.json');
console.log('home version:', home.version, 'classes:', home.customjs_classes, 'startup:', home.customjs_startup_scripts, 'hotkeys:', home.hotkeys);
console.log('daily version:', daily.version, 'hotkeys:', daily.hotkeys);
"
```

Confirm `HomeCommandsInit` appears in both `customjs_classes` and `customjs_startup_scripts`, home's `hotkeys` has the `sauce-home:open` entry, and daily's `hotkeys` is empty.

- [ ] **Step 2: Run full preflight**

Run: `npm run release:preflight`
Expected: every harness PASSES, including `run-bootstrap.js`, `run-install-sh.js`, and `run-seed-migrations.js` (the seed vault install exercises the manifest + heal changes end-to-end).

- [ ] **Step 3: Workshop self-install dogfood**

Run: `node platform/install.js --vault . --auto-approve`
Expected: succeeds; then confirm the workshop's own `.obsidian/hotkeys.json` now has `sauce-home:open` bound to Mod+[ (or, if the workshop's hotkeys.json never had `daily-notes`/Mod+[ to begin with, confirm the manifest-seed path applied it fresh via `applyHotkeys`):

```bash
python3 -c "import json; print(json.load(open('.obsidian/hotkeys.json')).get('sauce-home:open'), json.load(open('.obsidian/hotkeys.json')).get('daily-notes'))"
```

- [ ] **Step 4: Check for stray runtime artifacts**

```bash
git status --short
```

If `ranch/claude-surface-registry.json` / `ranch/platform-installed.json` / `ranch/bootstrap-last-install.log` changed from the dogfood run in Step 3, stage and commit them in their OWN commit (never mixed with feature code), per `Docs/agent-guides/vault-paths.md` § Don't ship runtime artifacts:

```bash
git add ranch/claude-surface-registry.json ranch/platform-installed.json ranch/bootstrap-last-install.log
git commit -m "chore: post-cycle dogfood refresh"
```

(Only run this if `git status --short` actually shows those files changed — skip entirely otherwise.)

---

### Task 7: Push branch, open PR, get CI green, merge

**Files:** none (process only)

- [ ] **Step 1: Push the branch**

```bash
git push -u origin worktree-bridge-cse_01Lbmv3dkznWzkbEURyLQ8WK
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "fix(home): task-creation surface bug, Enter capture, load flash, Cmd+[ retarget, previous-day nav" --body "$(cat <<'EOF'
## Summary
- Fix: daily to-do page's "New Task" button used an unrecognized TaskDialog surface ("today"), silently dropping the scheduled date and source — the task never showed in Today. Now uses surface:"daily".
- Fix: Home's inline quick-capture Enter-key handler now stopPropagation()s, hardening against a higher-level keydown listener racing/swallowing the same event.
- Fix: Home's first render per app session now defers to workspace.onLayoutReady, mitigating the cold-start content flash + pane-width reflow.
- Feat: Cmd+[ now opens Home (new sauce-home:open command) instead of the core daily-notes command. Already-installed vaults get an idempotent hotkeys.json heal; brand-new installs get it via manifest hotkeys[] seeding.
- Feat: Home gains a "‹ Yesterday" button that opens the actual previous day's daily note (never creates one).

See `Docs/plans/2026-07-08-home-fixes-design.md` and `-plan.md` for full detail.

## Test plan
- [x] `node platform/test/run-task-entity.js` — PASS
- [x] `node platform/test/run-home.js` — PASS
- [x] `npm run release:preflight` — PASS
- [x] Workshop self-install dogfood — PASS
EOF
)"
```

- [ ] **Step 3: Wait for CI**

```bash
gh pr checks --watch
```

If any check fails, read the failure output, fix, commit, push, and re-watch — do not merge on red.

- [ ] **Step 4: Merge once green**

```bash
gh pr merge --squash --auto
```

(`--auto` merges automatically once the required checks — already green from Step 3 — are satisfied; safe to use since we already confirmed green.)

- [ ] **Step 5: Confirm the merge landed on `main`**

```bash
git fetch origin main
git log --oneline origin/main -5
```

Expected: the squash commit for this PR is at the top of `origin/main`.

---

### Task 8: Wait for the automated release pipeline (no manual merges)

**Files:** none (process only)

Per `Docs/agent-guides/build-test-verify.md` § Release workflow: **do not** manually merge or edit the release PR or the homebrew tap PR — both auto-merge once required checks pass. This task is polling/observation only.

- [ ] **Step 1: Watch for the release PR to open**

```bash
gh pr list --repo willfell/sauce --state open --search "chore(release)"
```

Poll every ~30-60s (a few minutes typically) until a `chore(release): vX.Y.Z` PR appears.

- [ ] **Step 2: Watch it auto-merge**

```bash
gh pr checks <release-pr-number> --watch
gh pr view <release-pr-number> --json state,mergedAt
```

Expected: `state` becomes `MERGED` once checks pass, with no manual `gh pr merge` call from us.

- [ ] **Step 3: Confirm the tag was pushed**

```bash
git fetch --tags
git tag --list "v*" --sort=-creatordate | head -3
```

Expected: a new `v<X.Y.Z>` tag matching the release PR's version.

- [ ] **Step 4: Watch for the tap PR to open + auto-merge**

```bash
gh pr list --repo willfell/homebrew-sauce --state all --limit 5
```

Poll until a PR bumping `Formula/sauce.rb` to the new version appears, then confirm its `state` is `MERGED` (again, no manual merge from us — `TAP_PR_TOKEN` auto-merges it per the pipeline).

---

### Task 9: brew update + deploy to consumer vaults

**Files:** none (process only, run from outside the workshop worktree)

- [ ] **Step 1: brew update**

```bash
brew update
brew upgrade sauce
sauce --version
```

Confirm the version matches the new tag from Task 8.

- [ ] **Step 2: Deploy to each consumer vault**

All three consumer vaults already subscribe to `task-entity`, `home`, `to-do`, and `daily` — this cycle only bumps existing components (no new blueprint/mechanism subscription needed). Per `Docs/agent-guides/vault-paths.md`, run for each:

```bash
cd /Users/willfellhoelter/notes/sauce/accuris-sauce
sauce update --bump-pins
sauce status

cd /Users/willfellhoelter/notes/sauce/ero-sauce
sauce update --bump-pins
sauce status

cd /Users/willfellhoelter/notes/sauce/headspace-sauce
sauce update --bump-pins
sauce status
```

Expected per vault: `sauce status` reports `drift: none` and the new component versions.

- [ ] **Step 3: Verify the hotkey heal landed in each consumer vault**

```bash
for v in accuris-sauce ero-sauce headspace-sauce; do
  echo "== $v =="
  python3 -c "import json; d=json.load(open('/Users/willfellhoelter/notes/sauce/$v/.obsidian/hotkeys.json')); print('sauce-home:open:', d.get('sauce-home:open'), '| daily-notes:', d.get('daily-notes'))"
done
```

Expected per vault: `sauce-home:open` bound to `Mod+[`; `daily-notes` either absent or bound to something other than `Mod+[`.

- [ ] **Step 4: Verify the to-do surface fix + Home file landed**

```bash
for v in accuris-sauce ero-sauce headspace-sauce; do
  echo "== $v =="
  grep -c 'surface: "daily"' "/Users/willfellhoelter/notes/sauce/$v/ranch/scripts/to-do/todo-chrome-bar.js"
  grep -c "sauce-home-prev-day" "/Users/willfellhoelter/notes/sauce/$v/ranch/scripts/home/space-home.js"
done
```

Expected: `1` for both greps, in all three vaults.

Note in the final report to the user: each consumer vault needs a manual **Cmd+R** (reload) in Obsidian to pick up the new customJS classes, and the hotkeys.json change takes effect immediately (no reload needed, but Obsidian must be told to re-read hotkeys — a restart is the safe bet if Cmd+R alone doesn't pick it up, matching the existing `bundled_plugin` restart guidance in `build-test-verify.md`).

---

### Task 10: Cycle-close artifacts

**Files:**
- Create: `Docs/plans/2026-07-08-<version>-home-fixes-result.md` (fill in the actual shipped version from Task 8)
- Modify: `Docs/cycle-history.md`
- Modify: `Docs/agent-guides/cycle-status.md`
- Modify: `Docs/install.md`

- [ ] **Step 1: Write the result doc**

Follow the exact structure of the most recent `Docs/plans/*-result.md` file (read one for the template — e.g. the chrome-bar-mechanism-extraction result doc referenced in auto-memory). Cover: what shipped (the 5 fixes), surfaces hit (to-do, home, daily manifests, install.js), any NEW lessons (e.g. "applyHotkeys is add-if-absent only — reassigning a bound key needs a dedicated heal"), carry-forward items (none expected), and the full commit list from `git log origin/main..HEAD` before the merge (or `git log <merge-commit>` after).

- [ ] **Step 2: Append to `Docs/cycle-history.md`**

Add a `## v<X.Y.Z> home-fixes CLOSED 2026-07-08` section summarizing the 5 fixes (mirror the terse style of the existing entries in that file).

- [ ] **Step 3: Update `Docs/agent-guides/cycle-status.md`**

```bash
npm run regen-cycle-status
```

- [ ] **Step 4: Update `Docs/install.md`**

Add an "Upgrading from vX.Y.Z" section noting: the `daily-notes` hotkey has moved to `sauce-home:open` (Cmd+[ now opens Home); users who'd customized `Cmd+[` for something else are unaffected (the heal only acts when `daily-notes` still owns exactly that binding).

- [ ] **Step 5: Commit**

```bash
git add Docs/plans/2026-07-08-*-home-fixes-result.md Docs/cycle-history.md Docs/agent-guides/cycle-status.md Docs/install.md
git commit -m "docs: cycle-close artifacts for home-fixes cycle"
git push
```

---

### Task 11: Report back

Only after Tasks 1-10 are ALL complete (implementation merged to main, release pipeline auto-shipped + tagged, tap PR auto-merged, brew upgraded locally, all three consumer vaults updated + verified, cycle-close docs committed) — report back to the user with: the shipped version number, a one-line summary of each of the 5 fixes, confirmation of the 3 consumer vaults' updated status, and the Cmd+R / restart reminder for each vault.
